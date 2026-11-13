import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2, ExternalLink, Search, X } from 'lucide-react';
import { api } from '../api/client';
import type { ProfileInvoiceUnprocessedResult } from '../types';
import { formatMoney } from '../utils/format';
import { LoadingIndicator } from './LoadingIndicator';

interface Props {
  initialMonth?: string;
  onSelectOwner?: (prfownCode: number, month: string) => void;
  onSaved?: () => void;
  refreshKey?: number;
}

export const ProfileInvoiceUnprocessedTab: React.FC<Props> = ({ initialMonth, onSelectOwner, refreshKey }) => {
  const [month, setMonth] = useState(initialMonth || '');
  const [result, setResult] = useState<ProfileInvoiceUnprocessedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingCode, setOpeningCode] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (initialMonth && initialMonth !== month) {
      setMonth(initialMonth);
    }
  }, [initialMonth]);

  const load = useCallback(async () => {
    if (!month) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getUnprocessedInvoices(month);
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load unprocessed invoices');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    if (month) load();
  }, [load, refreshKey]);

  const handleOpen = (prfownCode: number, invoiceMonth: string) => {
    // Opening an invoice ONLY navigates to Excel Sheet View — does NOT change processing status.
    setOpeningCode(prfownCode);
    onSelectOwner?.(prfownCode, invoiceMonth.trim() || month);
    // Reset after a tick (parent will navigate away)
    setTimeout(() => setOpeningCode(null), 800);
  };

  // ── Multi-word AND filter across owner / profile name ──
  const filteredRows = useMemo(() => {
    if (!result?.rows) return [];
    const query = search.trim().toLowerCase();
    if (!query) return result.rows;
    const words = query.split(/\s+/).filter(Boolean);
    return result.rows.filter(row => {
      const searchable = `${row.profileName || ''} ${row.prfownCode} ${row.invoiceMonth || ''}`.toLowerCase();
      return words.every(word => searchable.includes(word));
    });
  }, [result?.rows, search]);

  return (
    <div style={{ flex: 1, minHeight: 0, padding: '2px', display: 'flex', flexDirection: 'column', gap: '3px' }}>

      {/* ── Compact Filter Toolbar ── */}
      <div className="compact-toolbar" style={{ minHeight: '28px', padding: '2px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700 }}>Month:</span>
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
          <button
            onClick={load}
            disabled={loading || !month}
            className="btn-secondary"
            style={{ padding: '1px 7px', height: '24px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600 }}
          >
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>

          {/* ── Search Box with clear (x) button ── */}
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <Search size={12} style={{ position: 'absolute', left: '6px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search owner..."
              style={{
                padding: '1px 22px 1px 22px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontSize: '0.74rem',
                width: '150px',
                height: '24px',
                boxSizing: 'border-box'
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute',
                  right: '4px',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center'
                }}
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {search && result && (
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {filteredRows.length} result{filteredRows.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* ── KPI strip ── */}
        {result && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>
              Unprocessed: <strong style={{ color: 'var(--accent-primary)', fontSize: '0.78rem' }}>{result.totalUnprocessedOwners}</strong>
            </span>
            <span style={{ color: 'var(--border-subtle)' }}>|</span>
            <span style={{ color: 'var(--text-muted)' }}>
              Total Cost: <strong style={{ color: 'var(--excel-cost-color)', fontSize: '0.82rem', fontFamily: 'var(--font-mono)' }}>{formatMoney(result.totalCostSum ?? 0)}</strong>
            </span>
            <span style={{ color: 'var(--border-subtle)' }}>|</span>
            <span style={{ color: 'var(--text-muted)' }}>
              Pending Rows: <strong style={{ color: 'var(--text-primary)', fontSize: '0.78rem' }}>{result.totalPendingRows}</strong>
            </span>
            <span style={{ color: 'var(--border-subtle)' }}>|</span>
            <span style={{ color: 'var(--text-muted)' }}>
              Pending USD: <strong style={{ color: 'var(--excel-actual-color)', fontSize: '0.82rem', fontFamily: 'var(--font-mono)' }}>{formatMoney(result.totalPendingUsd)}</strong>
            </span>
          </div>
        )}
      </div>

      {/* ── Info banner ── */}
      <div style={{
        padding: '0.3rem 0.6rem',
        background: 'rgba(99, 102, 241, 0.08)',
        border: '1px solid rgba(99, 102, 241, 0.2)',
        borderRadius: 'var(--radius-sm)',
        fontSize: '0.72rem',
        color: 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem'
      }}>
        <ExternalLink size={12} style={{ flexShrink: 0 }} />
        <span>
          Click <strong>Open</strong> (or double-click row) to view an owner's invoices in Excel Sheet View. Select rows there and click
          {' '}<strong>Save & Process</strong> to mark them as Processed. Opening an invoice does <em>not</em> change its status.
        </span>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '0.3rem 0.6rem', borderRadius: 'var(--radius-sm)', display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.75rem' }}>
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="compact-table-container">
        {loading ? (
          <LoadingIndicator message="Loading unprocessed invoices..." fullHeight />
        ) : result && result.rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#15803d' }}>
            <CheckCircle2 size={32} style={{ marginBottom: '0.35rem', opacity: 0.7 }} />
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>All invoices processed for {month}! ✓</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>No unprocessed owners found.</div>
          </div>
        ) : (
          <table className="compact-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', minWidth: '160px' }}>Profile Owner</th>
                <th style={{ textAlign: 'right', minWidth: '110px' }}>Total Cost</th>
                <th style={{ textAlign: 'right', minWidth: '95px' }}>Pending Rows</th>
                <th style={{ textAlign: 'right', minWidth: '110px' }}>Pending USD</th>
                <th style={{ textAlign: 'center', width: '80px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {!result || filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {search ? `No owners matching "${search}".` : month ? 'No data found.' : 'Enter a month above to load data.'}
                  </td>
                </tr>
              ) : (
                filteredRows.map(row => {
                  const isOpening = openingCode === row.prfownCode;
                  return (
                    <tr
                      key={row.prfownCode}
                      className="table-row-hover"
                      style={{ cursor: 'pointer', transition: 'background-color 0.15s ease' }}
                      onDoubleClick={() => handleOpen(row.prfownCode, row.invoiceMonth?.trim() || month)}
                      title="Double-click to open in Excel Sheet View"
                    >
                      <td style={{ fontWeight: 600 }}>{row.profileName}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--excel-cost-color)' }}>
                        {formatMoney(row.totalCost)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        {row.pendingRows}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--excel-actual-color)', fontWeight: 700 }}>
                        {formatMoney(row.totalPendingUsd)}
                      </td>
                      <td style={{ textAlign: 'center', padding: '2px 4px' }}>
                        <button
                          type="button"
                          disabled={isOpening}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpen(row.prfownCode, row.invoiceMonth?.trim() || month);
                          }}
                          style={{
                            padding: '2px 8px',
                            height: '22px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            background: 'transparent',
                            color: 'var(--accent-primary, #6366f1)',
                            border: '1px solid rgba(99, 102, 241, 0.4)',
                            borderRadius: 'var(--radius-sm)',
                            cursor: isOpening ? 'wait' : 'pointer',
                            opacity: isOpening ? 0.6 : 1,
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <ExternalLink size={11} />
                          {isOpening ? 'Opening...' : 'Open'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
