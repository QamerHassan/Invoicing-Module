import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, ExternalLink, AlertTriangle, Layers, DollarSign, Wallet, TrendingUp } from 'lucide-react';
import { api } from '../api/client';
import type { ProfileTotalInvoiceDto, ProfileGroupOwnerDto } from '../types';
import { formatMoney } from '../utils/format';
import { LoadingIndicator } from './LoadingIndicator';
import { OwnerSearchSelect } from './OwnerSearchSelect';

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
  const [statusFilter, setStatusFilter] = useState<'all' | 'P' | 'U'>('all');
  const [rows, setRows] = useState<ProfileTotalInvoiceDto[]>([]);
  const [unprocessedRows, setUnprocessedRows] = useState<ProfileTotalInvoiceDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    const cleanMonth = month ? month.trim().replace('-', '').toUpperCase() : '';
    const selectedOwner = ownerCode !== '' ? Number(ownerCode) : undefined;
    try {
      const [totalData, unprocData] = await Promise.all([
        api.getProfileTotalInvoices(cleanMonth || undefined, selectedOwner),
        cleanMonth ? api.getUnprocessedInvoices(cleanMonth, force).catch(() => null) : Promise.resolve(null)
      ]);
      setRows(totalData);
      if (unprocData?.rows) {
        const mapped: ProfileTotalInvoiceDto[] = unprocData.rows
          .filter(u => selectedOwner === undefined || u.prfownCode === selectedOwner)
          .map(u => ({
            cmpProfTotalInvCode: -u.prfownCode,
            prfgrpOwnCode: u.prfownCode,
            groupOwnerName: u.profileName,
            invoiceMonth: (u.invoiceMonth || cleanMonth).trim(),
            status: 'U',
            insertBy: 'Unprocessed',
            insertTime: '',
            lastModifiedBy: 'Pending',
            lastModifiedTime: null,
            totalCost: u.totalCost || 0,
            totalInvoiceAmt: u.totalPendingUsd || 0,
          }));
        setUnprocessedRows(mapped);
      } else {
        setUnprocessedRows([]);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load total invoices');
    } finally {
      setLoading(false);
    }
  }, [month, ownerCode]);

  useEffect(() => {
    load(false);
  }, [load]);

  const handleOpenSheet = (code: number, invMonth: string) => {
    setOpeningCode(code);
    onViewInExcel?.(code, invMonth || month);
    setTimeout(() => setOpeningCode(null), 800);
  };

  const filteredRows = useMemo(() => {
    if (statusFilter === 'P') return rows;
    if (statusFilter === 'U') return unprocessedRows;
    return [...rows, ...unprocessedRows];
  }, [statusFilter, rows, unprocessedRows]);

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
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '8px',
        flexShrink: 0
      }}>
        {/* KPI 1: Owners Saved */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md, 6px)',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{
            width: '34px',
            height: '34px',
            borderRadius: '8px',
            background: 'rgba(79, 70, 229, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#4f46e5'
          }}>
            <Layers size={18} />
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Owners Saved
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1.1 }}>
              {summary.totalOwners}
            </div>
          </div>
        </div>

        {/* KPI 2: Total Invoice Amount */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md, 6px)',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{
            width: '34px',
            height: '34px',
            borderRadius: '8px',
            background: 'rgba(16, 185, 129, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#10b981'
          }}>
            <DollarSign size={18} />
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total Invoice Amount
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#10b981', lineHeight: 1.1 }}>
              {formatMoney(summary.totalInvoiceAmt)}
            </div>
          </div>
        </div>

        {/* KPI 3: Total Cost */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md, 6px)',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{
            width: '34px',
            height: '34px',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ef4444'
          }}>
            <Wallet size={18} />
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Total Cost
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#ef4444', lineHeight: 1.1 }}>
              {formatMoney(summary.totalCostAmt)}
            </div>
          </div>
        </div>

        {/* KPI 4: Net Difference / Margin */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md, 6px)',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{
            width: '34px',
            height: '34px',
            borderRadius: '8px',
            background: 'rgba(59, 130, 246, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#3b82f6'
          }}>
            <TrendingUp size={18} />
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Net Margin
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: summary.netMargin >= 0 ? '#10b981' : '#ef4444', lineHeight: 1.1 }}>
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

          {/* Group Owner dropdown + built-in search (matching Processed & Email tab) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>Owner:</span>
            <div style={{ width: '200px' }}>
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
          </div>

          {/* Status filter dropdown (single bold control) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 800 }}>Status:</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as 'all' | 'P' | 'U')}
              style={{
                padding: '3px 10px',
                borderRadius: '6px',
                border: '1.5px solid var(--border-medium, var(--border-subtle))',
                background: 'var(--bg-base)',
                color: 'var(--text-primary)',
                fontSize: '0.84rem',
                fontWeight: 800,
                height: '30px',
                minWidth: '140px',
                cursor: 'pointer'
              }}
            >
              <option value="all">All</option>
              <option value="P">Processed</option>
              <option value="U">Unprocessed</option>
            </select>
          </div>
        </div>

        {/* Refresh button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => load(true)}
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', textAlign: 'left' }}>
            <thead style={{
              position: 'sticky',
              top: 0,
              zIndex: 2,
              background: 'var(--bg-surface-elevated, var(--bg-surface))',
              borderBottom: '2px solid var(--border-subtle)'
            }}>
              <tr style={{ height: '34px', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                <th style={{ padding: '5px 10px', width: '55px', textAlign: 'center' }}>Code</th>
                <th style={{ padding: '5px 10px' }}>Profile Group Owner</th>
                <th style={{ padding: '5px 10px', width: '80px', textAlign: 'center' }}>Month</th>
                <th style={{ padding: '5px 10px', textAlign: 'right', width: '155px' }}>Total Invoice</th>
                <th style={{ padding: '5px 10px', textAlign: 'right', width: '155px' }}>Total Cost</th>
                <th style={{ padding: '5px 10px', textAlign: 'right', width: '155px' }}>Net Margin</th>
                <th style={{ padding: '5px 10px', width: '70px', textAlign: 'center' }}>Sheet</th>
                <th style={{ padding: '5px 10px', width: '130px' }}>Last Modified</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r, idx) => {
                const margin = (r.totalInvoiceAmt || 0) - (r.totalCost || 0);
                const isOpening = openingCode === r.prfgrpOwnCode;
                const isEven = idx % 2 === 0;

                return (
                  <tr
                    key={`${r.status === 'U' ? 'U' : 'P'}-${r.cmpProfTotalInvCode}-${r.prfgrpOwnCode}`}
                    style={{
                      height: '44px',
                      borderBottom: '1px solid var(--border-subtle)',
                      background: isEven ? 'transparent' : 'rgba(0, 0, 0, 0.015)'
                    }}
                  >
                    {/* Code */}
                    <td style={{ padding: '5px 10px', textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: '0.76rem', fontWeight: 600 }}>
                      {r.cmpProfTotalInvCode > 0 ? `#${r.cmpProfTotalInvCode}` : '—'}
                    </td>

                    {/* Profile Group Owner */}
                    <td style={{ padding: '5px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.86rem' }}>
                          {r.groupOwnerName}
                        </span>
                        <span style={{
                          fontSize: '0.68rem',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          background: 'rgba(79, 70, 229, 0.08)',
                          color: '#4f46e5',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700
                        }}>
                          #{r.prfgrpOwnCode}
                        </span>
                      </div>
                    </td>

                    {/* Invoice Month */}
                    <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: 'rgba(59, 130, 246, 0.1)',
                        color: '#2563eb',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 800,
                        fontSize: '0.78rem'
                      }}>
                        {r.invoiceMonth}
                      </span>
                    </td>

                    {/* Total Invoice */}
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 900, color: '#10b981', fontFamily: 'var(--font-mono)', fontSize: '1.05rem', letterSpacing: '-0.01em' }}>
                      {formatMoney(r.totalInvoiceAmt)}
                    </td>

                    {/* Total Cost */}
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 900, color: '#ef4444', fontFamily: 'var(--font-mono)', fontSize: '1.05rem', letterSpacing: '-0.01em' }}>
                      {formatMoney(r.totalCost)}
                    </td>

                    {/* Net Margin */}
                    <td style={{
                      padding: '5px 10px',
                      textAlign: 'right',
                      fontWeight: 900,
                      fontFamily: 'var(--font-mono)',
                      fontSize: '1.05rem',
                      letterSpacing: '-0.01em',
                      color: margin >= 0 ? '#10b981' : '#ef4444'
                    }}>
                      {formatMoney(margin)}
                    </td>

                    {/* Sheet Action (small, moved before Last Modified) */}
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      <button
                        onClick={() => handleOpenSheet(r.prfgrpOwnCode, r.invoiceMonth)}
                        disabled={isOpening}
                        title="Open Excel Sheet View for this owner"
                        className="compact-btn"
                        style={{
                          height: '22px',
                          padding: '0 6px',
                          fontSize: '0.68rem',
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
                        <ExternalLink size={10} />
                        <span>Sheet</span>
                      </button>
                    </td>

                    {/* Last Modified (at end, compact; prominent red pill for Pending) */}
                    <td style={{ padding: '5px 8px', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      {r.status === 'U' ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '2px 9px',
                          borderRadius: '9999px',
                          background: 'rgba(239, 68, 68, 0.14)',
                          border: '1px solid rgba(239, 68, 68, 0.45)',
                          color: '#ef4444',
                          fontSize: '0.70rem',
                          fontWeight: 800,
                          letterSpacing: '0.01em'
                        }}>
                          <span style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            background: '#ef4444',
                            display: 'inline-block',
                            flexShrink: 0
                          }} />
                          Pending
                        </span>
                      ) : (
                        <>
                          <div style={{ fontWeight: 600 }}>{r.lastModifiedBy || r.insertBy || 'System'}</div>
                          <div style={{ fontSize: '0.62rem', opacity: 0.75 }}>
                            {formatDate(r.lastModifiedTime || r.insertTime)}
                          </div>
                        </>
                      )}
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
