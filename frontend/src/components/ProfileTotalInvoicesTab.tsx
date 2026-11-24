import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Search, ExternalLink, AlertTriangle, Layers, DollarSign, Wallet, TrendingUp } from 'lucide-react';
import { api } from '../api/client';
import type { ProfileTotalInvoiceDto, ProfileGroupOwnerDto } from '../types';
import { formatMoney } from '../utils/format';
import { LoadingIndicator } from './LoadingIndicator';

interface Props {
  groupOwners?: ProfileGroupOwnerDto[];
  initialMonth?: string;
  initialOwnerCode?: number | '';
  onViewInExcel?: (ownerCode: number, month: string) => void;
}

export const ProfileTotalInvoicesTab: React.FC<Props> = ({
  groupOwners = [],
  initialMonth = '',
  initialOwnerCode = '',
  onViewInExcel
}) => {
  const [month, setMonth] = useState(initialMonth || '');
  const [ownerCode, setOwnerCode] = useState<number | ''>(initialOwnerCode || '');
  const [rows, setRows] = useState<ProfileTotalInvoiceDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [openingCode, setOpeningCode] = useState<number | null>(null);

  useEffect(() => {
    if (initialMonth && initialMonth !== month) {
      setMonth(initialMonth);
    }
  }, [initialMonth]);

  useEffect(() => {
    if (initialOwnerCode !== undefined && initialOwnerCode !== ownerCode) {
      setOwnerCode(initialOwnerCode);
    }
  }, [initialOwnerCode]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProfileTotalInvoices(
        month ? month.trim().replace('-', '').toUpperCase() : undefined,
        ownerCode !== '' ? Number(ownerCode) : undefined
      );
      setRows(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load total invoices');
    } finally {
      setLoading(false);
    }
  }, [month, ownerCode]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenSheet = (code: number, invMonth: string) => {
    setOpeningCode(code);
    onViewInExcel?.(code, invMonth || month);
    setTimeout(() => setOpeningCode(null), 800);
  };

  // Search filter
  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const query = search.trim().toLowerCase();
    const words = query.split(/\s+/).filter(Boolean);
    return rows.filter(r => {
      const text = `${r.groupOwnerName || ''} ${r.prfgrpOwnCode} ${r.invoiceMonth || ''} ${r.insertBy || ''} ${r.lastModifiedBy || ''} ${r.status || ''}`.toLowerCase();
      return words.every(w => text.includes(w));
    });
  }, [rows, search]);

  // Aggregate KPI summary
  const summary = useMemo(() => {
    const totalOwners = filteredRows.length;
    const totalInvoiceAmt = filteredRows.reduce((acc, r) => acc + (r.totalInvoiceAmt || 0), 0);
    const totalCostAmt = filteredRows.reduce((acc, r) => acc + (r.totalCost || 0), 0);
    const netMargin = totalInvoiceAmt - totalCostAmt;
    return {
      totalOwners,
      totalInvoiceAmt,
      totalCostAmt,
      netMargin
    };
  }, [filteredRows]);

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div style={{ flex: 1, minHeight: 0, padding: '4px', display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
      
      {/* ── KPI Summary Strip ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '6px',
        flexShrink: 0
      }}>
        {/* KPI 1: Owners Saved */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md, 6px)',
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            background: 'rgba(79, 70, 229, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#4f46e5'
          }}>
            <Layers size={16} />
          </div>
          <div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Owners Saved
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              {summary.totalOwners}
            </div>
          </div>
        </div>

        {/* KPI 2: Total Invoice Amount */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md, 6px)',
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            background: 'rgba(16, 185, 129, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#10b981'
          }}>
            <DollarSign size={16} />
          </div>
          <div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Total Invoice Amount
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#10b981', lineHeight: 1.1 }}>
              {formatMoney(summary.totalInvoiceAmt)}
            </div>
          </div>
        </div>

        {/* KPI 3: Total Cost */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md, 6px)',
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            background: 'rgba(239, 68, 68, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ef4444'
          }}>
            <Wallet size={16} />
          </div>
          <div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Total Cost
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#ef4444', lineHeight: 1.1 }}>
              {formatMoney(summary.totalCostAmt)}
            </div>
          </div>
        </div>

        {/* KPI 4: Net Difference / Margin */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md, 6px)',
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            background: 'rgba(59, 130, 246, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#3b82f6'
          }}>
            <TrendingUp size={16} />
          </div>
          <div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
              Net Margin
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: summary.netMargin >= 0 ? '#10b981' : '#ef4444', lineHeight: 1.1 }}>
              {formatMoney(summary.netMargin)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Toolbar: Filters & Search ── */}
      <div className="compact-toolbar" style={{
        minHeight: '34px',
        padding: '3px 8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '6px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm, 4px)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Month input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>Month:</span>
            <input
              type="text"
              value={month}
              onChange={e => setMonth(e.target.value.toUpperCase())}
              placeholder="e.g. OCT26"
              style={{
                padding: '2px 6px',
                borderRadius: '4px',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-base)',
                color: 'var(--text-primary)',
                fontSize: '0.76rem',
                fontFamily: 'var(--font-mono)',
                width: '74px',
                height: '26px'
              }}
            />
          </div>

          {/* Group Owner dropdown */}
          {groupOwners.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>Owner:</span>
              <select
                value={ownerCode}
                onChange={e => setOwnerCode(e.target.value ? Number(e.target.value) : '')}
                style={{
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-base)',
                  color: 'var(--text-primary)',
                  fontSize: '0.76rem',
                  height: '26px',
                  maxWidth: '180px'
                }}
              >
                <option value="">All Owners</option>
                {groupOwners.map(o => (
                  <option key={o.prfOwnCode} value={o.prfOwnCode}>
                    {o.profileName} (#{o.prfOwnCode})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Search box */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'var(--bg-base)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '4px',
            padding: '1px 6px',
            height: '26px'
          }}>
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by owner or month..."
              style={{
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--text-primary)',
                fontSize: '0.75rem',
                width: '160px'
              }}
            />
          </div>
        </div>

        {/* Refresh button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => load()}
            disabled={loading}
            className="compact-btn"
            style={{
              height: '26px',
              padding: '0 8px',
              fontSize: '0.74rem',
              fontWeight: 600,
              borderRadius: '4px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-base)',
              color: 'var(--text-primary)',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div style={{
          padding: '6px 10px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '4px',
          fontSize: '0.75rem',
          color: '#ef4444',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexShrink: 0
        }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* ── Main Data Table Container ── */}
      <div style={{
        flex: 1,
        minHeight: 0,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md, 6px)',
        overflow: 'auto',
        position: 'relative'
      }}>
        {loading && rows.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <LoadingIndicator message="Loading total invoices from dbo.profile_total_invoices..." />
          </div>
        ) : filteredRows.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-muted)',
            gap: '8px'
          }}>
            <Layers size={32} style={{ opacity: 0.35 }} />
            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              No total invoice records found
            </div>
            <div style={{ fontSize: '0.75rem' }}>
              Records are saved automatically when clicking <b>Save</b> or <b>Save, Process & Email</b> in Excel Sheet View.
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', textAlign: 'left' }}>
            <thead style={{
              position: 'sticky',
              top: 0,
              zIndex: 2,
              background: 'var(--bg-surface-elevated, var(--bg-surface))',
              borderBottom: '2px solid var(--border-subtle)'
            }}>
              <tr style={{ height: '30px', color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                <th style={{ padding: '4px 8px', width: '50px', textAlign: 'center' }}>Code</th>
                <th style={{ padding: '4px 8px' }}>Profile Group Owner</th>
                <th style={{ padding: '4px 8px', width: '75px', textAlign: 'center' }}>Month</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', width: '130px' }}>Total Invoice</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', width: '130px' }}>Total Cost</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', width: '130px' }}>Net Margin</th>
                <th style={{ padding: '4px 8px', width: '60px', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '4px 8px', width: '130px' }}>Last Modified</th>
                <th style={{ padding: '4px 8px', width: '90px', textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r, idx) => {
                const margin = (r.totalInvoiceAmt || 0) - (r.totalCost || 0);
                const isOpening = openingCode === r.prfgrpOwnCode;
                const isEven = idx % 2 === 0;

                return (
                  <tr
                    key={r.cmpProfTotalInvCode}
                    style={{
                      height: '32px',
                      borderBottom: '1px solid var(--border-subtle)',
                      background: isEven ? 'transparent' : 'rgba(0, 0, 0, 0.015)'
                    }}
                  >
                    {/* Code */}
                    <td style={{ padding: '4px 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                      #{r.cmpProfTotalInvCode}
                    </td>

                    {/* Profile Group Owner */}
                    <td style={{ padding: '4px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          {r.groupOwnerName}
                        </span>
                        <span style={{
                          fontSize: '0.66rem',
                          padding: '1px 4px',
                          borderRadius: '3px',
                          background: 'rgba(79, 70, 229, 0.08)',
                          color: '#4f46e5',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 600
                        }}>
                          #{r.prfgrpOwnCode}
                        </span>
                      </div>
                    </td>

                    {/* Invoice Month */}
                    <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background: 'rgba(59, 130, 246, 0.1)',
                        color: '#2563eb',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        fontSize: '0.72rem'
                      }}>
                        {r.invoiceMonth}
                      </span>
                    </td>

                    {/* Total Invoice */}
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                      {formatMoney(r.totalInvoiceAmt)}
                    </td>

                    {/* Total Cost */}
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: '#ef4444', fontFamily: 'var(--font-mono)' }}>
                      {formatMoney(r.totalCost)}
                    </td>

                    {/* Net Margin */}
                    <td style={{
                      padding: '4px 8px',
                      textAlign: 'right',
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                      color: margin >= 0 ? '#10b981' : '#ef4444'
                    }}>
                      {formatMoney(margin)}
                    </td>

                    {/* Status */}
                    <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                      <span style={{
                        padding: '1px 5px',
                        borderRadius: '3px',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        background: r.status === 'P' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(100, 116, 139, 0.12)',
                        color: r.status === 'P' ? '#059669' : 'var(--text-muted)'
                      }}>
                        {r.status === 'P' ? 'Processed' : r.status || 'Active'}
                      </span>
                    </td>

                    {/* Last Modified */}
                    <td style={{ padding: '4px 8px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      <div>{r.lastModifiedBy || r.insertBy || 'System'}</div>
                      <div style={{ fontSize: '0.65rem', opacity: 0.8 }}>
                        {formatDate(r.lastModifiedTime || r.insertTime)}
                      </div>
                    </td>

                    {/* Action */}
                    <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                      <button
                        onClick={() => handleOpenSheet(r.prfgrpOwnCode, r.invoiceMonth)}
                        disabled={isOpening}
                        title="Open Excel Sheet View for this owner"
                        className="compact-btn"
                        style={{
                          height: '24px',
                          padding: '0 6px',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          borderRadius: '4px',
                          border: '1px solid rgba(79, 70, 229, 0.3)',
                          background: 'rgba(79, 70, 229, 0.08)',
                          color: '#4f46e5',
                          cursor: isOpening ? 'wait' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                      >
                        <ExternalLink size={12} />
                        <span>Sheet</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
