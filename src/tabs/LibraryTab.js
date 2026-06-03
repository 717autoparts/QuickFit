import React, { useState, useEffect } from 'react';
import { sb } from '../supabase';

export default function LibraryTab() {
  const [tab, setTab] = useState('profiles');
  const [profiles, setProfiles] = useState([]);
  const [donors, setDonors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [entries, setEntries] = useState([]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [p, d] = await Promise.all([
      sb.from('fitment_profiles').select('*').order('use_count', { ascending: false }),
      sb.from('donor_library').select('*')
    ]);
    setProfiles(p.data || []);
    setDonors(d.data || []);
    setLoading(false);
  }

  async function loadEntries(profileId) {
    const { data } = await sb.from('fitment_entries').select('*').eq('profile_id', profileId).order('year');
    setEntries(data || []);
    setSelected(profileId);
  }

  async function deleteProfile(id) {
    await sb.from('fitment_profiles').delete().eq('id', id);
    if (selected === id) { setSelected(null); setEntries([]); }
    loadAll();
  }

  async function deleteDonor(id) {
    await sb.from('donor_urls').delete().eq('id', id);
    loadAll();
  }

  const filteredProfiles = profiles.filter(p =>
    (p.name||'').toLowerCase().includes(search.toLowerCase()) ||
    (p.part_category||'').toLowerCase().includes(search.toLowerCase())
  );

  const filteredDonors = donors.filter(d =>
    (d.title||'').toLowerCase().includes(search.toLowerCase()) ||
    (d.url||'').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Fitment Library</div>
          <div className="page-subtitle">Saved fitment profiles and donor URL history</div>
        </div>
        <button className="btn" onClick={loadAll}><i className="ti ti-refresh" /> Refresh</button>
      </div>

      <div style={{display:'flex',gap:4,marginBottom:'1rem',background:'var(--bg2)',padding:3,borderRadius:'var(--radius)',border:'1px solid var(--border)',width:'fit-content'}}>
        {[{id:'profiles',label:'Fitment profiles',icon:'ti-database'},{id:'donors',label:'Donor URL library',icon:'ti-link'}].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 14px',fontSize:13,fontWeight:500,borderRadius:6,border:'none',background:tab===t.id?'var(--bg)':'transparent',color:tab===t.id?'var(--text)':'var(--text2)',cursor:'pointer',boxShadow:tab===t.id?'0 0 0 1px var(--border)':'none'}}>
            <i className={`ti ${t.icon}`} style={{fontSize:14}} />{t.label}
          </button>
        ))}
      </div>

      <div className="toolbar" style={{marginBottom:'1rem'}}>
        <div className="search-wrap">
          <i className="ti ti-search" />
          <input className="input" style={{paddingLeft:32,width:260}} value={search} onChange={e => setSearch(e.target.value)} placeholder={tab==='profiles' ? 'Search profiles...' : 'Search donors...'} />
        </div>
        <span style={{fontSize:12,color:'var(--text3)',marginLeft:'auto'}}>
          {tab==='profiles' ? filteredProfiles.length : filteredDonors.length} results
        </span>
      </div>

      {tab === 'profiles' && (
        <div style={{display:'grid',gridTemplateColumns: selected ? '1fr 1fr' : '1fr',gap:'1rem'}}>
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            {loading ? (
              <div className="empty"><span className="spinner" /></div>
            ) : filteredProfiles.length === 0 ? (
              <div className="empty"><i className="ti ti-database-off" /><p>No profiles yet. Apply fitment to a listing to build your library.</p></div>
            ) : (
              <table className="table">
                <thead><tr><th>Profile</th><th>Vehicles</th><th>Used</th><th></th></tr></thead>
                <tbody>
                  {filteredProfiles.map(p => (
                    <tr key={p.id} onClick={() => loadEntries(p.id)} style={{cursor:'pointer',background:selected===p.id?'var(--blue-light)':''}}>
                      <td>
                        <div style={{fontWeight:500,fontSize:13}}>{p.name}</div>
                        {p.part_category && <div style={{fontSize:11,color:'var(--text3)'}}>{p.part_category}</div>}
                      </td>
                      <td><span className="badge badge-green">{p.vehicle_count}</span></td>
                      <td><span style={{fontSize:12,color:'var(--text3)'}}>{p.use_count}x</span></td>
                      <td>
                        <button className="btn btn-sm btn-danger" onClick={e => {e.stopPropagation(); deleteProfile(p.id);}}>
                          <i className="ti ti-trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {selected && (
            <div className="card">
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <div className="card-title" style={{margin:0}}>Vehicle compatibility</div>
                <button className="btn btn-sm" onClick={() => {setSelected(null);setEntries([]);}}><i className="ti ti-x" /></button>
              </div>
              <div className="table-wrap" style={{maxHeight:400,overflowY:'auto'}}>
                <table className="table">
                  <thead><tr><th>Year</th><th>Make</th><th>Model</th><th>Trim</th><th>Engine</th></tr></thead>
                  <tbody>
                    {entries.map(e => (
                      <tr key={e.id}>
                        <td>{e.year||'—'}</td><td>{e.make||'—'}</td><td>{e.model||'—'}</td><td>{e.trim||'—'}</td><td>{e.engine||'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'donors' && (
        <div className="card">
          {loading ? (
            <div className="empty"><span className="spinner" /></div>
          ) : filteredDonors.length === 0 ? (
            <div className="empty"><i className="ti ti-link-off" /><p>No donor URLs saved yet. Apply fitment from a donor listing to start building your library.</p></div>
          ) : filteredDonors.map(d => (
            <div className="donor-row" key={d.id}>
              <div className="donor-info">
                <div className="donor-title">{d.title || 'Untitled donor'}</div>
                <div className="donor-url">
                  <a href={d.url} target="_blank" rel="noreferrer" style={{color:'var(--blue)'}}>{d.url}</a>
                </div>
                <div className="donor-meta">
                  <span><i className="ti ti-car" style={{fontSize:11}} /> {d.vehicle_count || 0} vehicles</span>
                  <span><i className="ti ti-repeat" style={{fontSize:11}} /> Used {d.use_count || 0}x</span>
                  {d.profile_name && <span><i className="ti ti-database" style={{fontSize:11}} /> {d.profile_name}</span>}
                  <span>{new Date(d.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <button className="btn btn-sm btn-danger" onClick={() => deleteDonor(d.id)}><i className="ti ti-trash" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
