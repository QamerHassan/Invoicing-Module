import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Archive, RefreshCw, AlertTriangle, Search, CheckCircle, RotateCcw } from 'lucide-react';
import { api } from '../api/client';
import type { ProfileGroupOwnerDto, ProfileInvoiceProcessedRowDto } from '../types';
import { OwnerSearchSelect } from './OwnerSearchSelect';

interface Props {
  groupOwners: ProfileGroupOwnerDto[];
  initialOwnerCode?: number | '';
  initialMonth?: string;
}

export const ProfileInvoiceProcessedTab: React.FC<Props> = ({
  groupOwners,
  initialOwnerCode,
  initialMonth,
}) => {
  const [month, setMonth] = useState(initialMonth || '');
  const [ownerCode, setOwnerCode] = useState<number | ''>(initialOwnerCode || '');
  const [rows, setRows] = useState<ProfileInvoiceProcessedRowDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // Sync with parent props
  useEffect(() => {
    if (initialOwnerCode !== undefined) setOwnerCode(initialOwnerCode);
  }, [initialOwnerCode]);
  useEffect(() => {
    if (initialMonth) setMonth(initialMonth);
  }, [initialMonth]);

  const flashSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };
  const flashError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 6000);
  };

  const load = useCallback(async () => {
    if (!month) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProcessedInvoices(ownerCode !== '' ? ownerCode : undefined, month);
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      flashError(err?.message || 'Failed to load processed invoices.');
    } finally {
      setLoading(false);
    }
  }, [month, ownerCode]);

  // Load when month or owner changes
  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      (r.profileName || '').toLowerCase().includes(q) ||
      (r.projectName || '').toLowerCase().includes(q) ||
      (r.stack || '').toLowerCase().includes(q) ||
      (r.invoiceToName || '').toLowerCase().includes(q) ||
      (r.invoiceMonth || '').toLowerCase().includes(q) ||
      String(r.cmpProfInvoiceCode).includes(q)
    );
  }, [rows, search]);

  const handleUnprocess = async (code: number) => {
    const confirmed = window.confirm('Move this invoice back to active (unprocess)?');
    if (!confirmed) return;
    setActionLoading(code);
    try {
      await api.unprocessInvoices([code]);
      flashSuccess('Invoice moved back to active.');
      load();
    } catch (err: any) {
      flashError(err?.message || 'Failed to unprocess invoice.');
    } finally {
      setActionLoading(null);
    }
  };

  const fmtUsd = (v: number) =>
    v == null ? '' : '$' + Math.round(v).toLocaleString();

  const fmtPkr = (v: number) =>
    v == null ? '' : 'Rs ' + Math.round(v).toLocaleString();

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {/* Toolbar */}
      <div className="compact-toolbar" style={{ minHeight: '28px', padding: '2px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <Archive size={13} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
            Processed Invoices
          </span>

          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: '0.4rem' }}>
            Owner:
          </span>
          <div style={{ width: '180px' }}>
            <OwnerSearchSelect
              owners={groupOwners}
              value={ownerCode}
              onChange={(val) => setOwnerCode(val)}
              allowAll={true}
              placeholder="All Owners"
              emptyMessage="No owners found"
              compact={true}
            />
          </div>

          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            Month:
          </span>
          <input
            type="text"
            value={month}
            onChange={e => setMonth(e.target.value.toUpperCase())}
            placeholder="SEP26"
            maxLength={7}
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '1px 5px',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
              width: '70px',
              height: '24px',
              boxSizing: 'border-box'
            }}
          />

          <button
            onClick={load}
            disabled={loading}
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '1px 7px', height: '24px', fontSize: '0.75rem', fontWeight: 600 }}
          >
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>

          {/* Search */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={11} style={{ position: 'absolute', left: '5px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              style={{
                background: 'var(--bg-surface)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 5px 1px 20px',
                fontSize: '0.72rem',
                width: '130px',
                height: '24px',
                boxSizing: 'border-box'
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {filteredRows.length} row{filteredRows.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div style={{
          padding: '0.25rem 0.6rem',
          background: 'rgba(16,185,129,0.12)',
          border: '1px solid rgba(16,185,129,0.3)',
          borderRadius: 'var(--radius-sm)',
          color: '#10b981',
          fontSize: '0.75rem',
          display: 'flex', alignItems: 'center', gap: '0.4rem'
        }}>
          <CheckCircle size={13} />
          {successMsg}
        </div>
      )}
      {error && (
        <div style={{
          padding: '0.25rem 0.6rem',
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 'var(--radius-sm)',
          color: '#ef4444',
          fontSize: '0.75rem',
          display: 'flex', alignItems: 'center', gap: '0.4rem'
        }}>
          <AlertTriangle size={13} />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="compact-table-container">
        <table className="compact-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'center', width: '40px' }}>#</th>
              <th style={{ minWidth: '130px', textAlign: 'left' }}>Profile Owner</th>
              <th style={{ minWidth: '80px', textAlign: 'left' }}>Stack</th>
              <th style={{ minWidth: '130px', textAlign: 'left' }}>Project</th>
              <th style={{ minWidth: '120px', textAlign: 'left' }}>Invoice To</th>
              <th style={{ minWidth: '65px', textAlign: 'center' }}>Month</th>
              <th style={{ minWidth: '70px', textAlign: 'right' }}>Charged USD</th>
              <th style={{ minWidth: '80px', textAlign: 'right' }}>Charged PKR</th>
              <th style={{ minWidth: '55px', textAlign: 'center' }}>Status</th>
              <th style={{ minWidth: '100px', textAlign: 'left' }}>Insert By</th>
              <th style={{ minWidth: '55px', textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  Loading processed invoices...
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  {rows.length === 0 ? `No processed invoices found for ${month}.` : 'No results match your search.'}
                </td>
              </tr>
            ) : (
              filteredRows.map((row, idx) => (
                <tr
                  key={row.cmpProfInvoiceCode}
                  className={`table-row-hover ${row.isForeign ? 'foreign-row' : ''}`.trim()}
                  style={{
                    background: row.isForeign ? 'var(--bg-foreign-row)' : idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)',
                    borderLeft: row.isForeign ? '3px solid var(--border-foreign, #2563eb)' : undefined
                  }}
                >
                  <td style={{ textAlign: 'center', padding: '0.2rem 0.3rem', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                    {idx + 1}
                  </td>
                  <td style={{ padding: '0.2rem 0.35rem', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-main)' }}>{row.profileName}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>#{row.cmpProfInvoiceCode}</div>
                  </td>
                  <td style={{ padding: '0.2rem 0.35rem', fontSize: '0.75rem', border: '1px solid var(--border-subtle)' }}>
                    {row.stack || ''}
                  </td>
                  <td style={{ padding: '0.2rem 0.35rem', fontSize: '0.75rem', border: '1px solid var(--border-subtle)' }}>
                    {row.projectName || ''}
                    {row.projectCode ? <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>({row.projectCode})</span> : null}
                  </td>
                  <td style={{ padding: '0.2rem 0.35rem', fontSize: '0.75rem', border: '1px solid var(--border-subtle)' }}>
                    {row.invoiceToName}
                  </td>
                  <td style={{ padding: '0.2rem 0.35rem', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', border: '1px solid var(--border-subtle)' }}>
                    {row.invoiceMonth}
                  </td>
                  <td style={{ padding: '0.2rem 0.35rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', border: '1px solid var(--border-subtle)' }}>
                    {fmtUsd(row.chargedAmtUsd)}
                  </td>
                  <td style={{ padding: '0.2rem 0.35rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', border: '1px solid var(--border-subtle)' }}>
                    {fmtPkr(row.chargedAmtPkr)}
                  </td>
                  <td style={{ padding: '0.2rem 0.35rem', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
                    <span style={{
                      fontSize: '0.68rem',
                      padding: '0.1rem 0.3rem',
                      borderRadius: '3px',
                      background: 'rgba(16,185,129,0.15)',
                      color: '#10b981',
                      fontWeight: 600
                    }}>
                      {row.status || 'P'}
                    </span>
                  </td>
                  <td style={{ padding: '0.2rem 0.35rem', fontSize: '0.7rem', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                    {row.insertBy || ''}
                    {row.insertTime ? (
                      <div style={{ fontSize: '0.65rem' }}>
                        {new Date(row.insertTime).toLocaleDateString()}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: '0.2rem 0.3rem', textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
                    <button
                      onClick={() => handleUnprocess(row.cmpProfInvoiceCode)}
                      disabled={actionLoading === row.cmpProfInvoiceCode}
                      title="Move back to Active"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.2rem',
                        padding: '1px 5px',
                        height: '20px',
                        fontSize: '0.65rem',
                        border: '1px solid #f59e0b',
                        background: 'rgba(245,158,11,0.1)',
                        color: '#f59e0b',
                        borderRadius: '3px',
                        cursor: actionLoading === row.cmpProfInvoiceCode ? 'not-allowed' : 'pointer',
                        opacity: actionLoading === row.cmpProfInvoiceCode ? 0.6 : 1
                      }}
                    >
                      <RotateCcw size={10} />
                      Undo
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
