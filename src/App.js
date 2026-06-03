import React, { useState, useEffect } from 'react';
import { sb } from './supabase';
import DashboardTab from './tabs/DashboardTab';
import LibraryTab from './tabs/LibraryTab';
import BulkTab from './tabs/BulkTab';
import ConfigTab from './tabs/ConfigTab';
import './App.css';

const NAV = [
  { id: 'dashboard', icon: 'ti-layout-dashboard', label: 'Dashboard' },
  { id: 'library', icon: 'ti-database', label: 'Fitment Library' },
  { id: 'bulk', icon: 'ti-upload', label: 'Bulk Upload' },
  { id: 'config', icon: 'ti-settings', label: 'Config' },
];

export default function App() {
  const [tab, setTab] = useState('dashboard');
  const [dbStatus, setDbStatus] = useState('checking');

  useEffect(() => {
    sb.from('listings').select('id').limit(1)
      .then(({ error }) => setDbStatus(error ? 'error' : 'connected'))
      .catch(() => setDbStatus('error'));
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div className="header-logo">
          <i className="ti ti-bolt" />
          Quick<span>Fit</span>
        </div>
        <div className="header-spacer" />
        <div className={`db-pill ${dbStatus}`}>
          <span className="db-dot" />
          {dbStatus === 'connected' ? 'Database connected' : dbStatus === 'checking' ? 'Connecting...' : 'DB error'}
        </div>
      </header>

      <div className="body">
        <nav className="sidebar">
          <div className="nav-section">Menu</div>
          {NAV.map(n => (
            <div key={n.id} className={`nav-item ${tab === n.id ? 'active' : ''}`} onClick={() => setTab(n.id)}>
              <i className={`ti ${n.icon}`} />
              {n.label}
            </div>
          ))}
        </nav>

        <main className="main">
          {tab === 'dashboard' && <DashboardTab />}
          {tab === 'library' && <LibraryTab />}
          {tab === 'bulk' && <BulkTab />}
          {tab === 'config' && <ConfigTab />}
        </main>
      </div>
    </div>
  );
}
