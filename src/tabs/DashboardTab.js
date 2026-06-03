import React, { useState, useEffect, useCallback } from 'react';
import { sb } from '../supabase';
import { getEbayConfig, getItem, reviseItem, extractItemId, extractKeywords, scoreMatch } from '../ebay';

const SORT_OPTIONS = [
  { value: 'missing', label: 'Missing fitment first' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'sku', label: 'SKU' },
];

export default function DashboardTab() {
  const [listings, setListings] = useState([]);
  const [donors, setDonors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [sort, setSort] = useState('missing');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [donorInputs, setDonorInputs] = useState({});
  const [rowStatus, setRowStatus] = useState({});
  const [stats, setStats] = useState({ total: 0, withFitment: 0, missing: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await sb.from('listings_summary').select('*').order('created_at', { ascending: false });
    const { data: donorData } = await sb.from('donor_library').select('*');
    const rows = data || [];
    setListings(rows);
    setDonors(donorData || []);
    setStats({
      total: rows.length,
      withFitment: rows.filter(r => r.has_fitment).length,
      missing: rows.filter(r => !r.has_fitment).length,
    });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function syncFromEbay() {
    const cfg = getEbayConfig();
    if (!cfg.token) { alert('eBay token not configured. Go to Config.'); return; }
    setSyncing(true);
    try {
      const { getMyListings } = await import('../ebay');
      const ebayListings = await getMyListings(cfg);
      for (const listing of ebayListings) {
        await sb.from('listings').upsert(listing, { onConflict: 'ebay_item_id' });
      }
      await load();
    } catch(e) {
      alert('Sync failed: ' + e.message);
    }
    setSyncing(false);
  }

  function getBestMatch(listing) {
    if (!listing.title || !donors.length) return null;
    const titleKw = extractKeywords(listing.title);
    let best = null;
    let bestScore = 0;
    donors.forEach(d => {
      const score = scoreMatch(titleKw, d.keywords || []);
      if (score > bestScore && score >= 40) { best = d; bestScore = score; }
    });
    return best ? { donor: best, score: bestScore } : null;
  }

  async function applyDonor(listing, donorUrl) {
    const cfg = getEbayConfig();
    if (!cfg.token) { setRowStatus(s => ({...s, [listing.id]: { msg: 'No eBay token', type: 'error' }})); return; }
    if (!listing.ebay_item_id) { setRowStatus(s => ({...s, [listing.id]: { msg: 'No eBay item ID', type: 'error' }})); return; }

    setRowStatus(s => ({...s, [listing.id]: { msg: 'Fetching donor...', type: 'info' }}));
    try {
      const donorId = extractItemId(donorUrl);
      if (!donorId) throw new Error('Invalid donor URL');

      const donorData = await getItem(donorId, cfg);
      if (!donorData.compatibilities?.length) throw new Error('Donor has no fitment data');

      setRowStatus(s => ({...s, [listing.id]: { msg: 'Applying fitment...', type: 'info' }}));
      const ok = await reviseItem(listing.ebay_item_id, donorData.compatibilities, cfg);
      if (!ok) throw new Error('eBay returned error');

      const keywords = extractKeywords(listing.title || '');
      let profileId = null;

      const { data: existingDonor } = await sb.from('donor_urls').select('id,profile_id,use_count').eq('url', donorUrl).single();

      if (existingDonor) {
        await sb.from('donor_urls').update({ use_count: (existingDonor.use_count || 0) + 1 }).eq('id', existingDonor.id);
        profileId = existingDonor.profile_id;
      } else {
        const { data: profile } = await sb.from('fitment_profiles').insert({
          name: donorData.title || 'Profile from ' + donorId,
          keywords,
          vehicle_count: donorData.compatibilities.length
        }).select().single();

        if (profile) {
          profileId = profile.id;
          const entries = donorData.compatibilities.map(c => ({ profile_id: profile.id, year: c.Year||null, make: c.Make||null, model: c.Model||null, trim: c.Trim||null, engine: c.Engine||null }));
          await sb.from('fitment_entries').insert(entries);
          await sb.from('donor_urls').insert({ url: donorUrl, ebay_item_id: donorId, title: donorData.title, profile_id: profile.id, keywords, use_count: 1 });
        }
      }

      await sb.from('listings').update({ has_fitment: true, applied_profile_id: profileId, applied_at: new Date().toISOString() }).eq('id', listing.id);
      await sb.from('fitment_log').insert({ listing_id: listing.id, profile_id: profileId, action: 'applied', vehicle_count: donorData.compatibilities.length, applied_by: 'manual' });

      setRowStatus(s => ({...s, [listing.id]: { msg: `Applied ${donorData.compatibilities.length} vehicles!`, type: 'success' }}));
      setDonorInputs(d => ({...d, [listing.id]: ''}));
      load();
    } catch(e) {
      setRowStatus(s => ({...s, [listing.id]: { msg: e.message, type: 'error' }}));
    }
  }

  function applyMatch(listing, match) {
    setDonorInputs(d => ({...d, [listing.id]: match.donor.url}));
  }

  function sorted(rows) {
    return [...rows].sort((a, b) => {
      if (sort === 'missing') return (a.has_fitment === b.has_fitment) ? 0 : a.has_fitment ? 1 : -1;
      if (sort === 'newest') return new Date(b.created_at) - new Date(a.created_at);
      if (sort === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
      if (sort === 'title') return (a.title||'').localeCompare(b.title||'');
      if (sort === 'sku') return (a.sku||'').localeCompare(b.sku||'');
      return 0;
    });
  }

  function filtered(rows) {
    let r = rows;
    if (filter === 'missing') r = r.filter(x => !x.has_fitment);
    if (filter === 'has') r = r.filter(x => x.has_fitment);
    if (filter === 'active') r = r.filter(x => x.status === 'active');
    if (filter === 'scheduled') r = r.filter(x => x.status === 'scheduled');
    if (search) r = r.filter(x => (x.title||'').toLowerCase().includes(search.toLowerCase()) || (x.sku||'').toLowerCase().includes(search.toLowerCase()) || (x.ebay_item_id||'').includes(search));
    return sorted(r);
  }

  const rows = filtered(listings);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Listings Dashboard</div>
          <div className="page-subtitle">Manage fitment across your active and scheduled listings</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button className="btn" onClick={load}><i className="ti ti-refresh" /> Refresh</button>
          <button className="btn btn-primary" onClick={syncFromEbay} disabled={syncing}>
            {syncing ? <><span className="spinner" /> Syncing...</> : <><i className="ti ti-cloud-download" /> Sync from eBay</>}
          </button>
        </div>
      </div>

      <div className="metrics">
        <div className="metric">
          <div className="metric-label"><i className="ti ti-list" /> Total listings</div>
          <div className="metric-val">{stats.total}</div>
        </div>
        <div className="metric">
          <div className="metric-label"><i className="ti ti-circle-check" /> Have fitment</div>
          <div className="metric-val green">{stats.withFitment}</div>
        </div>
        <div className="metric">
          <div className="metric-label"><i className="ti ti-alert-circle" /> Missing fitment</div>
          <div className="metric-val red">{stats.missing}</div>
        </div>
        <div className="metric">
          <div className="metric-label"><i className="ti ti-database" /> Donor URLs saved</div>
          <div className="metric-val amber">{donors.length}</div>
        </div>
      </div>

      <div className="card" style={{padding:'1rem'}}>
        <div className="toolbar">
          <div className="search-wrap">
            <i className="ti ti-search" />
            <input className="input" style={{paddingLeft:32,width:220}} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search listings..." />
          </div>
          <select className="input" style={{width:'auto'}} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All listings</option>
            <option value="missing">Missing fitment</option>
            <option value="has">Has fitment</option>
            <option value="active">Active only</option>
            <option value="scheduled">Scheduled only</option>
          </select>
          <select className="input" style={{width:'auto'}} value={sort} onChange={e => setSort(e.target.value)}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="toolbar-right">
            <span style={{fontSize:12,color:'var(--text3)',alignSelf:'center'}}>{rows.length} listing{rows.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {loading ? (
          <div className="empty"><span className="spinner" /><p style={{marginTop:12}}>Loading listings...</p></div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <i className="ti ti-layout-dashboard" />
            <p>No listings yet. Click "Sync from eBay" to load your listings, or add them manually via Bulk Upload.</p>
            <button className="btn btn-primary" onClick={syncFromEbay}><i className="ti ti-cloud-download" /> Sync from eBay</button>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{width:50}}></th>
                  <th>Listing</th>
                  <th style={{width:100}}>Status</th>
                  <th style={{width:90}}>Fitment</th>
                  <th>Donor URL / Smart match</th>
                  <th style={{width:80}}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(listing => {
                  const match = !listing.has_fitment ? getBestMatch(listing) : null;
                  const status = rowStatus[listing.id];
                  const donorVal = donorInputs[listing.id] || '';
                  return (
                    <tr key={listing.id}>
                      <td>
                        {listing.thumbnail_url
                          ? <img src={listing.thumbnail_url} alt="" className="thumb" />
                          : <div className="thumb-placeholder"><i className="ti ti-photo" style={{fontSize:16}} /></div>
                        }
                      </td>
                      <td>
                        <div className="title-cell">
                          <div>
                            <div className="title-text">
                              <a href={listing.url} target="_blank" rel="noreferrer" style={{color:'var(--text)',textDecoration:'none'}}>
                                {listing.title || 'Untitled'}
                              </a>
                            </div>
                            <div className="title-sub">
                              {listing.sku && <span>SKU: {listing.sku} · </span>}
                              {listing.ebay_item_id && <span>#{listing.ebay_item_id}</span>}
                              {listing.profile_name && <span> · {listing.profile_name}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge badge-${listing.status === 'active' ? 'green' : 'blue'}`}>
                          {listing.status}
                        </span>
                      </td>
                      <td>
                        {listing.has_fitment
                          ? <span className="badge badge-green"><i className="ti ti-check" /> Yes</span>
                          : <span className="badge badge-red"><i className="ti ti-x" /> Missing</span>
                        }
                      </td>
                      <td>
                        {listing.has_fitment ? (
                          <div style={{fontSize:12,color:'var(--text3)'}}>
                            {listing.donor_url
                              ? <a href={listing.donor_url} target="_blank" rel="noreferrer" style={{color:'var(--blue)'}}>View donor ↗</a>
                              : 'Fitment applied'
                            }
                          </div>
                        ) : (
                          <div style={{display:'flex',flexDirection:'column',gap:4}}>
                            {match && !donorVal && (
                              <div className="match-pill" onClick={() => applyMatch(listing, match)} title={match.donor.url}>
                                <i className="ti ti-sparkles" style={{fontSize:11}} />
                                {match.score}% match: {match.donor.title?.substring(0,30) || 'donor'}...
                              </div>
                            )}
                            <div className="donor-cell">
                              <input
                                className="input"
                                style={{fontSize:12,padding:'5px 9px'}}
                                value={donorVal}
                                onChange={e => setDonorInputs(d => ({...d, [listing.id]: e.target.value}))}
                                placeholder="Paste donor eBay URL..."
                              />
                              <button
                                className="btn btn-success btn-sm"
                                disabled={!donorVal}
                                onClick={() => applyDonor(listing, donorVal)}
                              >
                                <i className="ti ti-check" /> Apply
                              </button>
                            </div>
                            {status && <div className={`status ${status.type}`} style={{fontSize:11,marginTop:0}}>{status.msg}</div>}
                          </div>
                        )}
                      </td>
                      <td>
                        {listing.ebay_item_id && (
                          <a href={listing.url} target="_blank" rel="noreferrer" className="btn btn-sm">
                            <i className="ti ti-external-link" />
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
