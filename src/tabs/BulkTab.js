import React, { useState, useRef } from 'react';
import { sb } from '../supabase';

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,''));
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g,''));
    const row = {};
    headers.forEach((h,i) => row[h] = values[i]||'');
    return row;
  });
  return { headers, rows };
}

const FIELDS = [
  { key:'sku', label:'SKU', icon:'ti-tag', placeholder:'e.g. CP-247' },
  { key:'ebay_item_id', label:'eBay Item ID', icon:'ti-hash', placeholder:'e.g. 123456789012' },
  { key:'title', label:'Listing title', icon:'ti-text-size', placeholder:'e.g. 07-12 Honda Accord Strut' },
  { key:'donor_url', label:'Donor URL', icon:'ti-link', placeholder:'https://ebay.com/itm/...' },
];

export default function BulkTab() {
  const [step, setStep] = useState('upload');
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();

  function handleFile(file) {
    if (!file || !file.name.endsWith('.csv')) { alert('Please upload a .csv file'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const { headers, rows } = parseCSV(e.target.result);
        setParsed({ headers, rows });
        const autoMap = {};
        FIELDS.forEach(f => {
          const match = headers.find(h => h.includes(f.key.replace('ebay_item_id','item').replace('_','')));
          if (match) autoMap[f.key] = match;
        });
        setMapping(autoMap);
        setSelected(rows.map((_,i) => i));
        setStep('map');
      } catch(e) { alert('Could not parse CSV: ' + e.message); }
    };
    reader.readAsText(file);
  }

  function get(row, field) { return mapping[field] ? (row[mapping[field]] || '') : ''; }

  async function saveToDatabase() {
    setSaving(true);
    setSaved(0);
    let count = 0;
    for (const i of selected) {
      const row = parsed.rows[i];
      const record = {
        sku: get(row,'sku') || null,
        ebay_item_id: get(row,'ebay_item_id') || null,
        title: get(row,'title') || null,
        url: get(row,'ebay_item_id') ? `https://www.ebay.com/itm/${get(row,'ebay_item_id')}` : null,
        status: 'active',
        has_fitment: false,
      };
      if (record.ebay_item_id) {
        await sb.from('listings').upsert(record, { onConflict: 'ebay_item_id' });
      } else if (record.sku) {
        await sb.from('listings').upsert(record, { onConflict: 'sku' });
      } else {
        await sb.from('listings').insert(record);
      }
      count++;
      setSaved(count);
    }
    setSaving(false);
    setStep('done');
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Bulk Upload</div>
          <div className="page-subtitle">Import multiple listings from a CSV file</div>
        </div>
      </div>

      {step === 'upload' && (
        <div>
          <div className="card">
            <div
              className={`drop-zone ${dragging ? 'dragging' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => fileRef.current.click()}
            >
              <i className="ti ti-file-spreadsheet" style={{fontSize:40,display:'block',marginBottom:12,color:'var(--text3)'}} />
              <div style={{fontSize:15,fontWeight:500,marginBottom:6}}>Drop your CSV here</div>
              <div style={{fontSize:13,color:'var(--text2)'}}>or click to browse files</div>
              <input ref={fileRef} type="file" accept=".csv" style={{display:'none'}} onChange={e => handleFile(e.target.files[0])} />
            </div>
          </div>
          <div className="card">
            <div className="card-title"><i className="ti ti-info-circle" /> Expected CSV format</div>
            <div style={{fontSize:13,color:'var(--text2)',marginBottom:12}}>Your CSV can have any column names — you'll map them in the next step. Here's a recommended format:</div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>sku</th><th>ebay_item_id</th><th>title</th><th>donor_url</th></tr></thead>
                <tbody>
                  <tr><td>CP-247</td><td>123456789012</td><td>07-12 Honda Accord Front Strut</td><td>https://ebay.com/itm/987654321</td></tr>
                  <tr><td>CP-248</td><td>987654321098</td><td>05-09 Toyota Camry Rotor</td><td></td></tr>
                  <tr><td>CP-249</td><td></td><td>03-07 Accord Control Arm</td><td>https://ebay.com/itm/111222333</td></tr>
                </tbody>
              </table>
            </div>
            <div style={{fontSize:12,color:'var(--text3)',marginTop:10}}>
              Only <strong>title</strong> or <strong>ebay_item_id</strong> is required. All other columns are optional.
            </div>
          </div>
        </div>
      )}

      {step === 'map' && parsed && (
        <div className="card">
          <div className="card-title"><i className="ti ti-columns" /> Map your columns</div>
          <div style={{fontSize:13,color:'var(--text2)',marginBottom:16}}>
            Found <strong>{parsed.rows.length} rows</strong> and <strong>{parsed.headers.length} columns</strong>. Match your columns to the right fields:
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
            {FIELDS.map(f => (
              <div className="field" key={f.key}>
                <label><i className={`ti ${f.icon}`} /> {f.label}</label>
                <select className="input" value={mapping[f.key]||''} onChange={e => setMapping(m => ({...m,[f.key]:e.target.value}))}>
                  <option value="">— not in this CSV —</option>
                  {parsed.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => setStep('preview')} disabled={!mapping.title && !mapping.ebay_item_id}>
              <i className="ti ti-arrow-right" /> Preview listings
            </button>
            <button className="btn" onClick={() => { setParsed(null); setStep('upload'); }}><i className="ti ti-x" /> Start over</button>
          </div>
          {!mapping.title && !mapping.ebay_item_id && (
            <div className="status error" style={{marginTop:8}}>Map at least the Title or eBay Item ID column to continue.</div>
          )}
        </div>
      )}

      {step === 'preview' && parsed && (
        <div>
          <div className="card">
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
              <div className="card-title" style={{margin:0}}><i className="ti ti-list-check" /> Preview — {selected.length} of {parsed.rows.length} selected</div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-sm" onClick={() => setSelected(parsed.rows.map((_,i)=>i))}>Select all</button>
                <button className="btn btn-sm" onClick={() => setSelected([])}>Deselect all</button>
                <button className="btn btn-sm" onClick={() => setStep('map')}><i className="ti ti-arrow-left" /> Back</button>
              </div>
            </div>
            <div className="table-wrap" style={{maxHeight:400,overflowY:'auto'}}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{width:32}}><input type="checkbox" checked={selected.length===parsed.rows.length} onChange={e => setSelected(e.target.checked ? parsed.rows.map((_,i)=>i) : [])} /></th>
                    <th>SKU</th><th>eBay Item ID</th><th>Title</th><th>Donor URL</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((row,i) => (
                    <tr key={i} style={{opacity:selected.includes(i)?1:0.4}}>
                      <td><input type="checkbox" checked={selected.includes(i)} onChange={() => setSelected(s => s.includes(i) ? s.filter(x=>x!==i) : [...s,i])} /></td>
                      <td>{get(row,'sku')||'—'}</td>
                      <td>{get(row,'ebay_item_id')||'—'}</td>
                      <td style={{maxWidth:240,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{get(row,'title')||'—'}</td>
                      <td>{get(row,'donor_url') ? <span style={{color:'var(--teal)',fontSize:12}}>✓ has donor</span> : <span style={{color:'var(--text3)',fontSize:12}}>none</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-title"><i className="ti ti-database" /> Save to database</div>
            <div style={{fontSize:13,color:'var(--text2)',marginBottom:12}}>
              {selected.length} listing{selected.length!==1?'s':''} will be added to your QuickFit database. You can then apply fitment from the Dashboard.
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={saveToDatabase} disabled={saving||selected.length===0}>
                {saving ? <><span className="spinner" /> Saving {saved}/{selected.length}...</> : <><i className="ti ti-database" /> Save {selected.length} listings</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="card" style={{textAlign:'center',padding:'3rem 1rem'}}>
          <i className="ti ti-circle-check" style={{fontSize:48,color:'var(--teal)',display:'block',marginBottom:12}} />
          <div style={{fontSize:18,fontWeight:500,marginBottom:8}}>{saved} listings saved!</div>
          <div style={{fontSize:13,color:'var(--text2)',marginBottom:24}}>Head to the Dashboard to apply fitment to your listings.</div>
          <div className="btn-row" style={{justifyContent:'center'}}>
            <button className="btn btn-primary" onClick={() => { setParsed(null); setStep('upload'); setSelected([]); setSaved(0); }}><i className="ti ti-upload" /> Upload another CSV</button>
          </div>
        </div>
      )}
    </div>
  );
}
