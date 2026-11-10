import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertTriangle,
  Check,
  Search
} from 'lucide-react';
import { api } from '../api/client';
import { OwnerSearchSelect } from './OwnerSearchSelect';
import type {
  ProfileGroupOwnerDto,
  ProfileInvoiceProcessedRowDto,
  ProfileInvoiceUnprocessedRowDto,
  ProfileInvoiceUnprocessedResult
} from '../types';

interface ProfileInvoiceDetailTabProps {
  groupOwners: ProfileGroupOwnerDto[];
  initialOwnerCode?: number | '';
  initialMonth?: string;
}

function formatMonthDisplay(m?: string): string {
  if (!m) return '—';
  const clean = m.trim().toUpperCase();
  if (clean.length === 5 && !clean.includes('-')) {
    return `${clean.substring(0, 3)}-${clean.substring(3)}`;
  }
  return clean;
}

function formatMoney(val?: number | null, currency?: string): string {
  if (val == null) return '—';
  const abs = Math.abs(val);
  let formatted: string;
  if (abs >= 1_000_000) formatted = `${(val / 1_000_000).toFixed(2)}M`;
  else if (abs >= 1_000) formatted = val.toLocaleString('en-US', { maximumFractionDigits: 0 });
  else formatted = val.toFixed(2);
  return currency ? `${currency} ${formatted}` : formatted;
}

type DetailSubTab = 'processed' | 'unprocessed';

export const ProfileInvoiceDetailTab: React.FC<ProfileInvoiceDetailTabProps> = ({
  groupOwners,
  initialOwnerCode = '',
  initialMonth = 'SEP26'
}) => {
  const [activeDetailTab, setActiveDetailTab] = useState<DetailSubTab>('processed');

  // Shared filters
  const [ownerCode, setOwnerCode] = useState<number | ''>(initialOwnerCode);
  const [month, setMonth] = useState<string>(initialMonth.replace('-', '').toUpperCase());

  // Posted owners for Processed sub-tab (filtered to posted invoices)
  const [postedOwners, setPostedOwners] = useState<ProfileGroupOwnerDto[]>([]);

  // Processed state
  const [processedRows, setProcessedRows] = useState<ProfileInvoiceProcessedRowDto[]>([]);
  const [processedLoading, setProcessedLoading] = useState<boolean>(false);
  const [processedError, setProcessedError] = useState<string | null>(null);
  const [hasLoadedProcessed, setHasLoadedProcessed] = useState<boolean>(false);

  // Unprocessed state
  const [unprocessedResult, setUnprocessedResult] = useState<ProfileInvoiceUnprocessedResult | null>(null);
  const [unprocessedLoading, setUnprocessedLoading] = useState<boolean>(false);
  const [unprocessedError, setUnprocessedError] = useState<string | null>(null);
  const [hasLoadedUnprocessed, setHasLoadedUnprocessed] = useState<boolean>(false);

  // Search
  const [searchQuery, setSearchQuery] = useState<string>('');

  const cleanMonth = month.trim().replace('-', '').toUpperCase();

  // Fetch posted owners fresh from DB (Processed sub-tab dropdown)
  const fetchPostedOwners = useCallback(async (m: string) => {
    try {
      const owners = await api.getPostedGroupOwners(m || undefined);
      setPostedOwners(owners);
    } catch {
      setPostedOwners([]);
    }
  }, []);

  useEffect(() => {
    fetchPostedOwners(cleanMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadProcessed = async () => {
    try {
      // Clear old state immediately so stale data is never shown
      setProcessedRows([]);
      setProcessedLoading(true);
      setProcessedError(null);
      const targetMonth = cleanMonth || 'SEP26';
      const rows = await api.getProcessedInvoices(ownerCode ? Number(ownerCode) : undefined, targetMonth);
      setProcessedRows(rows || []);
      setHasLoadedProcessed(true);
    } catch (err: any) {
      setProcessedError(err.message || 'Failed to load processed invoices.');
    } finally {
      setProcessedLoading(false);
    }
  };

  const handleLoadUnprocessed = async () => {
    try {
      // Clear old state immediately so stale data is never shown
      setUnprocessedResult(null);
      setUnprocessedLoading(true);
      setUnprocessedError(null);
      const targetMonth = cleanMonth || 'SEP26';
      const result = await api.getUnprocessedInvoices(targetMonth);
      setUnprocessedResult(result);
      setHasLoadedUnprocessed(true);
    } catch (err: any) {
      setUnprocessedError(err.message || 'Failed to load unprocessed invoices.');
    } finally {
      setUnprocessedLoading(false);
    }
  };

  const handleLoad = () => {
    setSearchQuery('');
    if (activeDetailTab === 'processed') handleLoadProcessed();
    else handleLoadUnprocessed();
  };

  // Filtered processed rows
  const filteredProcessed = processedRows.filter(r => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (r.profileName && r.profileName.toLowerCase().includes(q)) ||
      (r.prfgrpOwnName && r.prfgrpOwnName.toLowerCase().includes(q)) ||
      (r.stack && r.stack.toLowerCase().includes(q)) ||
      (r.projectName && r.projectName.toLowerCase().includes(q)) ||
      (r.invoiceToName && r.invoiceToName.toLowerCase().includes(q)) ||
      (r.invoiceMonth && r.invoiceMonth.toLowerCase().includes(q)) ||
      (r.status && r.status.toLowerCase().includes(q)) ||
      r.prfownCode.toString().includes(q) ||
      (r.cmpProfInvoiceCode && r.cmpProfInvoiceCode.toString().includes(q))
    );
  });

  const filteredUnprocessed: ProfileInvoiceUnprocessedRowDto[] = (unprocessedResult?.rows ?? []).filter(r => {
    if (ownerCode && r.prfownCode !== Number(ownerCode)) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (r.profileName && r.profileName.toLowerCase().includes(q)) || r.prfownCode.toString().includes(q);
  });

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.45rem 1rem',
    borderRadius: 'var(--radius-sm)',
    fontWeight: 600,
    fontSize: '0.8rem',
    cursor: 'pointer',
    border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
    background: active ? 'var(--accent-primary)' : 'var(--bg-secondary)',
    color: active ? '#fff' : 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    transition: 'all 0.15s'
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', animation: 'fadeIn 0.25s ease-in-out' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(99,102,241,0.1))',
          borderRadius: 'var(--radius-md)',
          padding: '0.65rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <CheckCircle2 size={22} color="#10b981" />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)' }}>
            Invoice Detail
          </h2>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            View processed and unprocessed profile invoices by owner and month.
          </p>
        </div>
      </div>

      {/* Sub-tab switcher */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button style={tabBtnStyle(activeDetailTab === 'processed')} onClick={() => { setActiveDetailTab('processed'); setSearchQuery(''); fetchPostedOwners(cleanMonth); }}>
          <Check size={14} />
          Processed
          {processedRows.length > 0 && (
            <span style={{ background: 'rgba(16,185,129,0.2)', color: '#10b981', padding: '0.05rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem' }}>
              {processedRows.length}
            </span>
          )}
        </button>
        <button style={tabBtnStyle(activeDetailTab === 'unprocessed')} onClick={() => { setActiveDetailTab('unprocessed'); setSearchQuery(''); }}>
          <Clock size={14} />
          Unprocessed
          {unprocessedResult && (
            <span style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b', padding: '0.05rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem' }}>
              {unprocessedResult.totalUnprocessedOwners}
            </span>
          )}
        </button>
      </div>

      {/* Filter Bar */}
      <div className="panel-card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px' }}>
          <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600, textTransform: 'uppercase' }}>
            {activeDetailTab === 'processed' ? 'Profile Group Owner' : 'Profile Owner (Optional)'}
          </label>
          <OwnerSearchSelect
            owners={activeDetailTab === 'processed' ? postedOwners : groupOwners}
            value={ownerCode}
            onChange={setOwnerCode}
            allowAll={true}
            allLabel="All Owners"
            placeholder={
              activeDetailTab === 'processed'
                ? postedOwners.length === 0
                  ? 'No posted invoices found'
                  : 'All Owners (or Select Specific)'
                : 'All Owners (or Filter by Owner)'
            }
            emptyMessage={
              activeDetailTab === 'processed' && postedOwners.length === 0
                ? 'No posted invoices found'
                : 'No owners found'
            }
          />
        </div>

        <div style={{ flex: '0 0 130px' }}>
          <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600, textTransform: 'uppercase' }}>
            Invoice Month
          </label>
          <input
            type="text"
            value={month}
            onChange={e => setMonth(e.target.value.toUpperCase())}
            onBlur={() => {
              const m = month.trim().replace('-', '').toUpperCase();
              if (m.length >= 5) {
                fetchPostedOwners(m);
              }
            }}
            placeholder="e.g. SEP26"
            maxLength={7}
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.5rem 0.75rem',
              fontSize: '0.875rem',
              fontFamily: 'var(--font-mono)',
              width: '100%'
            }}
          />
        </div>

        <div style={{ flex: '1 1 180px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Search size={16} color="var(--text-subtle)" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search..."
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.5rem 0.75rem',
              fontSize: '0.875rem',
              width: '100%'
            }}
          />
        </div>

        <button
          onClick={handleLoad}
          disabled={processedLoading || unprocessedLoading}
          className="btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.5rem 1rem', alignSelf: 'flex-end' }}
        >
          <RefreshCw size={15} className={(processedLoading || unprocessedLoading) ? 'spin' : ''} />
          Load
        </button>
      </div>

      {/* PROCESSED TAB CONTENT */}
      {activeDetailTab === 'processed' && (
        <>
          {processedError && (
            <div style={{ padding: '0.85rem 1.1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)', color: '#ef4444', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <AlertTriangle size={16} /> <span>{processedError}</span>
            </div>
          )}

          {/* KPI strip */}
          {processedRows.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
              <div className="panel-card" style={{ padding: '0.9rem 1.1rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Rows</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#818cf8', fontFamily: 'var(--font-mono)' }}>{filteredProcessed.length}</div>
              </div>
              <div className="panel-card" style={{ padding: '0.9rem 1.1rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Charged USD</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                  {formatMoney(filteredProcessed.reduce((s, r) => s + (r.chargedAmtUsd || 0), 0), 'USD')}
                </div>
              </div>
              <div className="panel-card" style={{ padding: '0.9rem 1.1rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total PKR</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
                  {formatMoney(filteredProcessed.reduce((s, r) => s + (r.totalIncomePkr || 0), 0), 'PKR')}
                </div>
              </div>
              <div className="panel-card" style={{ padding: '0.9rem 1.1rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Month</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>{formatMonthDisplay(cleanMonth)}</div>
              </div>
              <div className="panel-card" style={{ padding: '0.9rem 1.1rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Branch</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
                  <span style={{ width: '10px', height: '10px', background: 'var(--bg-foreign-row)', border: '1px solid var(--border-foreign, #2563eb)', borderRadius: '2px', display: 'inline-block' }} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--border-foreign, #2563eb)' }}>Foreign (Branch 5)</span>
                </div>
              </div>
            </div>
          )}

          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '50px' }}>#</th>
                  <th>Code</th>
                  <th>Profile Owner</th>
                  <th>Group Owner</th>
                  <th>Stack</th>
                  <th>Project</th>
                  <th>Invoice To</th>
                  <th>Month</th>
                  <th style={{ textAlign: 'right' }}>Income PKR</th>
                  <th style={{ textAlign: 'right' }}>Charged PKR</th>
                  <th style={{ textAlign: 'right' }}>Charged USD</th>
                  <th>CCY</th>
                  <th>Status</th>
                  <th>Inserted By</th>
                  <th>Insert Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredProcessed.length === 0 ? (
                  <tr>
                    <td colSpan={15} style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
                      {processedLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}>
                          <RefreshCw size={18} className="spin" color="var(--accent-primary)" />
                          <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>Loading live data directly from database...</span>
                        </div>
                      ) : hasLoadedProcessed ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                          <Search size={32} color="var(--text-subtle)" style={{ opacity: 0.5, marginBottom: '0.25rem' }} />
                          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-main)' }}>
                            No invoices found
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', maxWidth: '420px' }}>
                            No processed profile invoices found in database for month {cleanMonth}{ownerCode ? ` and Owner #${ownerCode}` : ''}.
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.875rem' }}>
                          Select owner &amp; month, then click <strong style={{ color: 'var(--text-main)' }}>Load</strong> to fetch live records.
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredProcessed.map((row, idx) => (
                    <tr key={row.cmpProfInvoiceCode} className={row.isForeign ? 'foreign-row' : undefined} style={{ background: row.isForeign ? 'var(--bg-foreign-row)' : undefined }}>
                      <td style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        borderLeft: row.isForeign ? '3px solid var(--border-foreign, #2563eb)' : undefined
                      }}>
                        {idx + 1}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{row.cmpProfInvoiceCode}</td>
                      <td style={{ fontWeight: 600 }}>{row.profileName || '—'}</td>
                      <td>{row.prfgrpOwnName || '—'}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{row.stack || '—'}</td>
                      <td>{row.projectName ? `${row.projectCode ?? ''} – ${row.projectName}`.trim() : (row.projectCode ? `#${row.projectCode}` : '—')}</td>
                      <td>{row.invoiceToName || row.invoiceTo}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{formatMonthDisplay(row.invoiceMonth)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{formatMoney(row.totalIncomePkr)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{formatMoney(row.chargedAmtPkr)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#10b981', textAlign: 'right' }}>{formatMoney(row.chargedAmtUsd)}</td>
                      <td style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>{row.ccy === 1 ? 'PKR' : 'USD'}</td>
                      <td>
                        <span style={{
                          background: row.status === 'P' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                          color: row.status === 'P' ? '#10b981' : '#ef4444',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 700
                        }}>
                          {row.status === 'P' ? 'Paid' : (row.status || 'Due')}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{row.insertBy || '—'}</td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', fontFamily: 'var(--font-mono)' }}>
                        {row.insertTime ? new Date(row.insertTime).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* UNPROCESSED TAB CONTENT */}
      {activeDetailTab === 'unprocessed' && (
        <>
          {unprocessedError && (
            <div style={{ padding: '0.85rem 1.1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)', color: '#ef4444', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <AlertTriangle size={16} /> <span>{unprocessedError}</span>
            </div>
          )}

          {/* KPI strip */}
          {unprocessedResult && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
              <div className="panel-card" style={{ padding: '0.9rem 1.1rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Unprocessed Owners</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>{unprocessedResult.totalUnprocessedOwners}</div>
              </div>
              <div className="panel-card" style={{ padding: '0.9rem 1.1rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Pending Rows</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#818cf8', fontFamily: 'var(--font-mono)' }}>{unprocessedResult.totalPendingRows}</div>
              </div>
              <div className="panel-card" style={{ padding: '0.9rem 1.1rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Pending USD</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                  {formatMoney(unprocessedResult.totalPendingUsd, 'USD')}
                </div>
              </div>
              <div className="panel-card" style={{ padding: '0.9rem 1.1rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Month</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>{formatMonthDisplay(cleanMonth)}</div>
              </div>
              <div className="panel-card" style={{ padding: '0.9rem 1.1rem', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Branch</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
                  <span style={{ width: '10px', height: '10px', background: 'var(--bg-foreign-row)', border: '1px solid var(--border-foreign, #2563eb)', borderRadius: '2px', display: 'inline-block' }} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--border-foreign, #2563eb)' }}>Foreign (Branch 5)</span>
                </div>
              </div>
            </div>
          )}

          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '50px' }}>#</th>
                  <th>Code</th>
                  <th>Profile Owner</th>
                  <th>Month</th>
                  <th style={{ textAlign: 'right' }}>Company Rows</th>
                  <th style={{ textAlign: 'right' }}>Interview Rows</th>
                  <th style={{ textAlign: 'right' }}>Recurring Rows</th>
                  <th style={{ textAlign: 'right' }}>Pending Rows</th>
                  <th style={{ textAlign: 'right' }}>Pending USD</th>
                </tr>
              </thead>
              <tbody>
                {filteredUnprocessed.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)' }}>
                      {unprocessedLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}>
                          <RefreshCw size={18} className="spin" color="var(--accent-primary)" />
                          <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>Loading live data directly from database...</span>
                        </div>
                      ) : hasLoadedUnprocessed ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                          <Search size={32} color="var(--text-subtle)" style={{ opacity: 0.5, marginBottom: '0.25rem' }} />
                          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-main)' }}>
                            No invoices found
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', maxWidth: '420px' }}>
                            No unprocessed invoices found in database for month {cleanMonth}{ownerCode ? ` and Owner #${ownerCode}` : ''}.
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.875rem' }}>
                          Enter month and click <strong style={{ color: 'var(--text-main)' }}>Load</strong> to fetch live records.
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredUnprocessed.map((row, idx) => (
                    <tr key={`${row.prfownCode}_${row.invoiceMonth}`}>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{idx + 1}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{row.prfownCode}</td>
                      <td style={{ fontWeight: 600 }}>{row.profileName || '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{formatMonthDisplay(row.invoiceMonth)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{row.companyRows}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{row.interviewRows}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{row.recurringRows}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right', fontWeight: 700, color: '#f59e0b' }}>{row.pendingRows}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right', fontWeight: 700, color: '#10b981' }}>
                        {formatMoney(row.totalPendingUsd, 'USD')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
