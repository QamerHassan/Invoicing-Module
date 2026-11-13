import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '../api/client';
import type { ProfileGroupOwnerDto, ProfileInvoiceAuditLogDto } from '../types';
import { LoadingIndicator } from './LoadingIndicator';

interface Props {
  groupOwners: ProfileGroupOwnerDto[];
  initialOwnerCode?: number | '';
  initialMonth?: string;
}

export const ProfileInvoiceAuditTab: React.FC<Props> = ({
  groupOwners,
  initialOwnerCode,
  initialMonth,
}) => {
  const [month, setMonth] = useState(initialMonth || '');
  const [ownerCode, setOwnerCode] = useState<number | ''>(initialOwnerCode || '');
  const [rows, setRows] = useState<ProfileInvoiceAuditLogDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!month) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAuditLogs(
        month,
        ownerCode !== '' ? ownerCode : undefined
      );
      setRows(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [month, ownerCode]);

  // Auto-load when month/owner changes
  useEffect(() => {
    if (initialMonth && initialMonth !== month) setMonth(initialMonth);
  }, [initialMonth]);

  useEffect(() => {
    if (initialOwnerCode !== undefined && initialOwnerCode !== ownerCode) setOwnerCode(initialOwnerCode);
  }, [initialOwnerCode]);

  useEffect(() => {
    if (month) load();
  }, [load, month, ownerCode]);

  // KPI summary
  const uniqueUsers = [...new Set(rows.map(r => r.username))].length;
  const dateRange =
    rows.length > 0
      ? `${new Date(rows[rows.length - 1].timestamp).toLocaleDateString()} – ${new Date(rows[0].timestamp).toLocaleDateString()}`
      : '-';

  const fmt = (val?: string | null) => val ?? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>;

  return (
    <div style={{ flex: 1, minHeight: 0, padding: '2px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {/* Compact Filters & KPI Toolbar */}
      <div className="compact-toolbar" style={{ minHeight: '28px', padding: '2px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700 }}>
            Month:
          </span>
          <input
            type="text"
            value={month}
            onChange={e => setMonth(e.target.value.toUpperCase())}
            placeholder="SEP26"
            style={{
              padding: '1px 5px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
              width: '70px',
              height: '24px',
              boxSizing: 'border-box'
            }}
          />

          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700, marginLeft: '0.2rem' }}>
            Owner:
          </span>
          <select
            value={ownerCode}
            onChange={e => setOwnerCode(e.target.value ? Number(e.target.value) : '')}
            style={{
              padding: '1px 5px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontSize: '0.75rem',
              width: '180px',
              height: '24px',
              boxSizing: 'border-box'
            }}
          >
            <option value="">All Owners</option>
            {groupOwners.map(o => (
              <option key={o.prfOwnCode} value={o.prfOwnCode}>
                {o.profileName} (#{o.prfOwnCode})
              </option>
            ))}
          </select>

          <button
            onClick={load}
            disabled={loading || !month}
            className="btn-secondary"
            style={{
              padding: '1px 7px',
              height: '24px',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              fontWeight: 600
            }}
          >
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {/* Compact KPI strip in filter bar */}
        {rows.length > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>
              Changes: <strong style={{ color: 'var(--accent-primary)', fontSize: '0.78rem' }}>{rows.length}</strong>
            </span>
            <span style={{ color: 'var(--border-subtle)' }}>|</span>
            <span style={{ color: 'var(--text-muted)' }}>
              Users: <strong style={{ color: 'var(--text-primary)', fontSize: '0.78rem' }}>{uniqueUsers}</strong>
            </span>
            <span style={{ color: 'var(--border-subtle)' }}>|</span>
            <span style={{ color: 'var(--text-muted)' }}>
              Range: <span style={{ fontFamily: 'var(--font-mono)' }}>{dateRange}</span>
            </span>
            <span style={{ color: 'var(--border-subtle)' }}>|</span>
            {/* Legend: Foreign (Branch 5) */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', color: 'var(--border-foreign, #2563eb)', fontWeight: 600 }}>
              <span style={{ width: '9px', height: '9px', background: 'var(--bg-foreign-row)', border: '1px solid var(--border-foreign, #2563eb)', borderRadius: '2px', display: 'inline-block' }} />
              <span>Foreign (Branch 5)</span>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '0.3rem 0.6rem', borderRadius: 'var(--radius-sm)', display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.75rem' }}>
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Table Container */}
      <div className="compact-table-container">
        <table className="compact-table">
          <thead>
            <tr>
              {['Date / Time', 'User', 'Field Changed', 'Old Value', 'New Value', 'Invoice Code', 'Stack', 'Project', 'Month', 'Finalized?'].map(h => (
                <th key={h} style={{ textAlign: 'left' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} style={{ padding: '2.5rem' }}>
                  <LoadingIndicator message="Loading change history..." />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  {month ? 'No changes recorded for this selection.' : 'Enter a month to view change history.'}
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr key={row.id} className={`table-row-hover ${row.isForeign ? 'foreign-row' : ''}`.trim()}
                  style={{ background: row.isForeign ? 'var(--bg-foreign-row)' : undefined }}
                  onMouseEnter={e => { if (!row.isForeign) e.currentTarget.style.background = 'var(--bg-surface)'; }}
                  onMouseLeave={e => { if (!row.isForeign) e.currentTarget.style.background = ''; }}
                >
                  <td style={{
                    whiteSpace: 'nowrap',
                    color: 'var(--text-muted)',
                    borderLeft: row.isForeign ? '3px solid var(--border-foreign, #2563eb)' : undefined
                  }}>
                    {new Date(row.timestamp).toLocaleString()}
                  </td>
                  <td style={{ fontWeight: 600 }}>{row.username}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--accent-primary)' }}>
                    {row.fieldName}
                  </td>
                  <td style={{ color: '#b91c1c', fontStyle: row.oldValue ? 'normal' : 'italic' }}>
                    {fmt(row.oldValue)}
                  </td>
                  <td style={{ color: '#15803d', fontWeight: row.newValue ? 600 : 400 }}>
                    {fmt(row.newValue)}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>
                    {row.cmpProfInvoiceCode ?? '—'}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{row.stack || '—'}</td>
                  <td>{row.projectName ? `${row.projectCode ?? ''} – ${row.projectName}`.trim() : (row.projectCode ?? '—')}</td>
                  <td>{row.invoiceMonth}</td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '0.05rem 0.4rem', borderRadius: '9999px', fontSize: '0.65rem', fontWeight: 700,
                      background: row.isMonthFinalized ? '#fef3c7' : '#dcfce7',
                      color: row.isMonthFinalized ? '#92400e' : '#15803d'
                    }}>
                      {row.isMonthFinalized ? 'Finalized' : 'Open'}
                    </span>
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

