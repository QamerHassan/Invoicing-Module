import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  Users, 
  TrendingUp, 
  Briefcase, 
  Layers, 
  Search, 
  RefreshCw 
} from 'lucide-react';
import { api } from '../api/client';
import type { 
  VendorDto, 
  ProfileOwnerDto, 
  ExchangeRateDto, 
  EntityDto, 
  ProjectDto 
} from '../types';

/** Null-safe, case-insensitive substring test. Returns false when haystack is null/undefined and needle is non-empty. */
function safeIncludes(haystack: string | null | undefined, needle: string): boolean {
  if (!needle) return true;
  if (haystack == null) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Render an optional string field: shows em-dash when null/undefined/empty. */
function txt(value: string | null | undefined): React.ReactNode {
  return (value != null && value !== '') ? value : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>;
}

export const LookupsView: React.FC = () => {
  const [subTab, setSubTab] = useState<'vendors' | 'profileOwners' | 'exchangeRates' | 'entities' | 'projects'>('vendors');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [vendors, setVendors] = useState<VendorDto[]>([]);
  const [profileOwners, setProfileOwners] = useState<ProfileOwnerDto[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateDto[]>([]);
  const [entities, setEntities] = useState<EntityDto[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);

  const fetchLookups = async () => {
    try {
      setLoading(true);
      setFetchError(null);
      const [v, po, er, ent, prj] = await Promise.all([
        api.getVendors(),
        api.getProfileOwners(),
        api.getExchangeRates(),
        api.getEntities(),
        api.getProjects()
      ]);
      setVendors(v);
      setProfileOwners(po);
      setExchangeRates(er);
      setEntities(ent);
      setProjects(prj);
    } catch (err) {
      console.error('Failed to load master lookups', err);
      setFetchError('Failed to load lookup data. Check the console for details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLookups();
  }, []);

  // ── null-safe filtered slices ─────────────────────────────────────────────
  const filteredVendors = vendors.filter(v =>
    safeIncludes(v.vendName, search) || safeIncludes(v.shortcode, search)
  );
  const filteredProfileOwners = profileOwners.filter(p =>
    safeIncludes(p.profileName, search) || safeIncludes(p.profileType, search)
  );
  const filteredExchangeRates = exchangeRates.filter(er =>
    safeIncludes(String(er.exchangeRateCode ?? ''), search)
  );
  const filteredEntities = entities.filter(e =>
    safeIncludes(e.fullName, search) ||
    safeIncludes(e.shortcode, search) ||
    safeIncludes(String(e.entityCode ?? ''), search)
  );
  const filteredProjects = projects.filter(p =>
    safeIncludes(p.projName, search) || safeIncludes(p.projStatus, search)
  );

  const tabs = [
    { id: 'vendors', label: 'Vendors', count: vendors.length, icon: Building2 },
    { id: 'profileOwners', label: 'Profile Owners', count: profileOwners.length, icon: Users },
    { id: 'exchangeRates', label: 'Exchange Rates', count: exchangeRates.length, icon: TrendingUp },
    { id: 'entities', label: 'HRMS Entities', count: entities.length, icon: Layers },
    { id: 'projects', label: 'Projects', count: projects.length, icon: Briefcase },
  ] as const;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
            Lookups &amp; Master Data
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Live view of database lookup records used in drop-down DataWindows and company invoicing.
          </p>
        </div>
        <button id="lookups-reload" className="btn-secondary" onClick={fetchLookups}>
          <RefreshCw size={16} />
          <span>Reload Lookups</span>
        </button>
      </div>

      {fetchError && (
        <div style={{
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.4)',
          borderRadius: 'var(--radius-md)',
          padding: '0.75rem 1.25rem',
          color: '#f87171',
          fontSize: '0.9rem'
        }}>
          {fetchError}
        </div>
      )}

      {/* Sub Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              id={`lookups-tab-${t.id}`}
              onClick={() => { setSubTab(t.id); setSearch(''); }}
              style={{
                background: active ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                color: active ? '#fff' : 'var(--text-muted)',
                border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.5rem 0.9rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              <Icon size={16} />
              <span>{t.label}</span>
              <span style={{
                background: active ? 'rgba(255,255,255,0.2)' : 'var(--bg-surface)',
                padding: '0.1rem 0.4rem',
                borderRadius: '10px',
                fontSize: '0.75rem'
              }}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search Input */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '0.75rem 1.25rem',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.65rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flex: 1 }}>
          <Search size={18} color="var(--text-subtle)" />
          <input
            id="lookups-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${tabs.find(t => t.id === subTab)?.label}...`}
            style={{ width: '100%', background: 'transparent', border: 'none', padding: '0.2rem' }}
          />
        </div>
        {subTab === 'projects' && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--border-foreign, #2563eb)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            <span style={{ width: '10px', height: '10px', background: 'var(--bg-foreign-row)', border: '1px solid var(--border-foreign, #2563eb)', borderRadius: '2px', display: 'inline-block' }} />
            <span>Foreign (Branch 5)</span>
          </div>
        )}
      </div>

      {/* Content Table */}
      <div className="data-table-container">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 0.5rem' }} />
            <div>Loading records...</div>
          </div>
        ) : (
          <>
            {subTab === 'vendors' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Vendor Name</th>
                <th>Shortcode</th>
              </tr>
            </thead>
            <tbody>
              {filteredVendors.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No vendors match your search.</td></tr>
              ) : filteredVendors.map((v) => (
                <tr key={v.vendCode}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-subtle)' }}>#{v.vendCode}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{txt(v.vendName)}</td>
                  <td>{txt(v.shortcode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {subTab === 'profileOwners' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Profile Owner Name</th>
                <th>Type</th>
                <th>Group Owner?</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfileOwners.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No profile owners match your search.</td></tr>
              ) : filteredProfileOwners.map((p) => (
                <tr key={p.prfOwnCode}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-subtle)' }}>#{p.prfOwnCode}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{txt(p.profileName)}</td>
                  <td>{txt(p.profileType)}</td>
                  <td>{p.isProfgrpOwner === 'Y' ? <span className="badge badge-posted">Yes</span> : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {subTab === 'exchangeRates' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th style={{ textAlign: 'right' }}>Rate (PKR / USD)</th>
                <th>Effective Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredExchangeRates.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No exchange rates match your search.</td></tr>
              ) : filteredExchangeRates.map((er) => (
                <tr key={er.exchangeRateCode}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>#{er.exchangeRateCode}</td>
                  <td className="num-cell" style={{ color: '#10b981', fontWeight: 700 }}>
                    {er.rate != null ? `Rs ${er.rate.toFixed(2)}` : txt(null)}
                  </td>
                  <td>{er.effectiveFrom ? new Date(er.effectiveFrom).toLocaleDateString() : txt(null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {subTab === 'entities' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Entity Code</th>
                <th>Full Name</th>
                <th>Shortcode</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntities.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No entities match your search.</td></tr>
              ) : filteredEntities.map((e) => (
                <tr key={String(e.entityCode)}>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{txt(String(e.entityCode ?? ''))}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{txt(e.fullName)}</td>
                  <td>{txt(e.shortcode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {subTab === 'projects' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Project Code</th>
                <th>Project Name</th>
                <th>Branch</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No projects match your search.</td></tr>
              ) : filteredProjects.map((p) => {
                const isForeign = p.isForeign || p.branchCode === 5;
                return (
                  <tr
                    key={p.projectCode}
                    className={isForeign ? 'foreign-row' : undefined}
                    style={{ background: isForeign ? 'var(--bg-foreign-row)' : undefined }}
                  >
                    <td style={{
                      fontFamily: 'var(--font-mono)',
                      borderLeft: isForeign ? '3px solid var(--border-foreign, #2563eb)' : undefined
                    }}>
                      #{p.projectCode}
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{txt(p.projName)}</td>
                    <td>
                      {isForeign ? (
                        <span className="badge-foreign">Foreign (Branch 5)</span>
                      ) : (
                        txt(p.branchCode ? `Branch ${p.branchCode}` : null)
                      )}
                    </td>
                    <td>{txt(p.projStatus)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
          </>
        )}
      </div>
    </div>
  );
};
