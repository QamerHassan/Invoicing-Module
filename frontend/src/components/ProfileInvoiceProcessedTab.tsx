import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Archive, RefreshCw, AlertTriangle, Search, CheckCircle, RotateCcw, X, Eye, Mail, ArrowLeft } from 'lucide-react';
import { api } from '../api/client';
import type { ProfileGroupOwnerDto, ProfileInvoiceProcessedProfileDto } from '../types';
import { OwnerSearchSelect } from './OwnerSearchSelect';
import { LoadingIndicator } from './LoadingIndicator';
import { ProfileInvoiceEmailTab } from './ProfileInvoiceEmailTab';

interface Props {
  groupOwners: ProfileGroupOwnerDto[];
  initialOwnerCode?: number | '';
  initialMonth?: string;
  initialComposing?: boolean;
  onRefreshUnprocessed?: () => void;
  onViewInExcel?: (ownerCode: number, month: string) => void;
}

// In-memory client cache to persist processed profiles across tab switches
const processedProfilesCache = new Map<string, ProfileInvoiceProcessedProfileDto[]>();

export const ProfileInvoiceProcessedTab: React.FC<Props> = ({
  groupOwners,
  initialOwnerCode,
  initialMonth,
  initialComposing,
  onRefreshUnprocessed,
  onViewInExcel
}) => {
  const [month, setMonth] = useState(initialMonth || 'OCT26');
  const [ownerCode, setOwnerCode] = useState<number | ''>(initialOwnerCode || '');
  const cleanMonth = (month || '').trim().replace('-', '').toUpperCase();
  const cacheKey = `${cleanMonth}_${ownerCode}`;

  const [profiles, setProfiles] = useState<ProfileInvoiceProcessedProfileDto[]>(() => {
    return processedProfilesCache.get(cacheKey) || [];
  });
  const [loading, setLoading] = useState<boolean>(() => {
    return !processedProfilesCache.has(cacheKey);
  });
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [selectedOwnerCodes, setSelectedOwnerCodes] = useState<Set<number>>(new Set());

  // Email compose state
  const [emailComposing, setEmailComposing] = useState(Boolean(initialComposing && initialOwnerCode));
  const [emailOwnerCode, setEmailOwnerCode] = useState<number | ''>(initialComposing && initialOwnerCode ? initialOwnerCode : '');

  const getEmailedOwnersMap = useCallback((): Record<string, { emailedAt: string; toEmail?: string }> => {
    try {
      const raw = localStorage.getItem(`profile_invoice_emailed_${cleanMonth}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [cleanMonth]);

  const [emailedOwners, setEmailedOwners] = useState<Record<string, { emailedAt: string; toEmail?: string }>>({});

  useEffect(() => {
    setEmailedOwners(getEmailedOwnersMap());
  }, [getEmailedOwnersMap]);

  // Sync with parent props
  useEffect(() => {
    if (initialOwnerCode !== undefined) setOwnerCode(initialOwnerCode);
    if (initialComposing && initialOwnerCode) {
      setEmailComposing(true);
      setEmailOwnerCode(initialOwnerCode);
    }
  }, [initialOwnerCode, initialComposing]);
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

  const load = useCallback(async (force = false) => {
    if (!month) return;
    const currentKey = `${cleanMonth}_${ownerCode}`;
    if (!force && processedProfilesCache.has(currentKey)) {
      setProfiles(processedProfilesCache.get(currentKey)!);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setEmailedOwners(getEmailedOwnersMap());
      const data = await api.getProcessedProfiles(ownerCode !== '' ? ownerCode : undefined, month, force);
      const list = Array.isArray(data) ? data : [];
      processedProfilesCache.set(currentKey, list);
      setProfiles(list);
      setSelectedOwnerCodes(new Set()); // Reset selection on reload
    } catch (err: any) {
      flashError(err?.message || 'Failed to load processed profiles.');
    } finally {
      setLoading(false);
    }
  }, [month, ownerCode, cleanMonth, getEmailedOwnersMap]);

  // Load when month or owner changes
  useEffect(() => {
    load(false);
  }, [load]);

  const filteredProfiles = useMemo(() => {
    // Sort: not-emailed owners at TOP, emailed owners at BOTTOM
    return [...profiles].sort((a, b) => {
      const aEmailed = Boolean(emailedOwners[String(a.ownerCode)]);
      const bEmailed = Boolean(emailedOwners[String(b.ownerCode)]);
      if (aEmailed === bEmailed) return 0;
      return aEmailed ? 1 : -1; // not-emailed (false) → top, emailed (true) → bottom
    });
  }, [profiles, emailedOwners]);

  const allFilteredCodes = useMemo(() => {
    return filteredProfiles.map(p => p.ownerCode);
  }, [filteredProfiles]);

  const isAllSelected = allFilteredCodes.length > 0 && allFilteredCodes.every(c => selectedOwnerCodes.has(c));
  const someSelected = selectedOwnerCodes.size > 0;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedOwnerCodes(new Set());
    } else {
      setSelectedOwnerCodes(new Set(allFilteredCodes));
    }
  };

  const handleToggleOwner = (code: number) => {
    setSelectedOwnerCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  // Grand totals
  const totalInvoiceSum = useMemo(() => {
    return filteredProfiles.reduce((acc, p) => acc + (p.totalInvoice != null ? p.totalInvoice : 0), 0);
  }, [filteredProfiles]);

  const totalCostSum = useMemo(() => {
    return filteredProfiles.reduce((acc, p) => acc + (p.totalCost != null ? p.totalCost : 0), 0);
  }, [filteredProfiles]);

  const totalRowsSum = useMemo(() => {
    return filteredProfiles.reduce((acc, p) => acc + (p.rowsCount || 0), 0);
  }, [filteredProfiles]);

  // Undo / Move back to Unprocessed
  const handleBatchUnprocess = async () => {
    if (selectedOwnerCodes.size === 0) return;
    const selectedList = profiles.filter(p => selectedOwnerCodes.has(p.ownerCode));
    const allInvoiceCodes = selectedList.flatMap(p => p.invoiceCodes);
    const count = selectedOwnerCodes.size;

    const confirmed = window.confirm(`Move ${count} selected profile(s) (${allInvoiceCodes.length} invoices) back to Unprocessed?`);
    if (!confirmed) return;

    setActionLoading(true);
    try {
      const res = await api.unprocessInvoices(allInvoiceCodes);
      flashSuccess(res.message || `${count} profile(s) moved back to Unprocessed.`);
      processedProfilesCache.clear();
      setSelectedOwnerCodes(new Set());
      await load(true);
      onRefreshUnprocessed?.();
      if (count === 1 && selectedList.length === 1) {
        onViewInExcel?.(selectedList[0].ownerCode, selectedList[0].month || month);
      }
    } catch (err: any) {
      flashError(err?.message || 'Failed to unprocess selected profiles.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSingleUnprocess = async (p: ProfileInvoiceProcessedProfileDto) => {
    const confirmed = window.confirm(`Move profile "${p.ownerName}" (${p.rowsCount} invoices) back to Unprocessed?`);
    if (!confirmed) return;
    setActionLoading(true);
    try {
      const res = await api.unprocessInvoices(p.invoiceCodes);
      flashSuccess(res.message || `Profile "${p.ownerName}" moved back to Unprocessed.`);
      setSelectedOwnerCodes(prev => {
        const next = new Set(prev);
        next.delete(p.ownerCode);
        return next;
      });
      processedProfilesCache.clear();
      await load(true);
      onRefreshUnprocessed?.();
      onViewInExcel?.(p.ownerCode, p.month || month);
    } catch (err: any) {
      flashError(err?.message || 'Failed to unprocess profile.');
    } finally {
      setActionLoading(false);
    }
  };

  const fmtUsd = (v: number) =>
    v == null ? '$0' : '$' + Math.round(v).toLocaleString();

  // ─── EMAIL COMPOSE VIEW ──────────────────────────────────────────────
  if (emailComposing && emailOwnerCode !== '') {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {/* Back bar */}
        <div className="compact-toolbar" style={{ minHeight: '28px', padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={() => {
              setEmailComposing(false);
              setEmailOwnerCode('');
              // Refresh emailed status
              setEmailedOwners(getEmailedOwnersMap());
              load();
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '2px 8px',
              height: '24px',
              fontSize: '0.72rem',
              fontWeight: 700,
              background: 'var(--bg-secondary)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer'
            }}
          >
            <ArrowLeft size={12} />
            <span>← Back to Processed & Email</span>
          </button>
        </div>
        <ProfileInvoiceEmailTab
          groupOwners={groupOwners}
          initialOwnerCode={emailOwnerCode}
          initialMonth={cleanMonth}
          initialViewMode="compose"
          onBackToList={() => {
            setEmailComposing(false);
            setEmailOwnerCode('');
            setEmailedOwners(getEmailedOwnersMap());
            load();
          }}
          onNavigateToUnprocessed={(targetOwner, targetMonth) => {
            setEmailComposing(false);
            setEmailOwnerCode('');
            if (targetOwner && onViewInExcel) {
              onViewInExcel(targetOwner, targetMonth || cleanMonth);
            }
          }}
          onOwnerChange={() => {}}
          onMonthChange={() => {}}
        />
      </div>
    );
  }

  // ─── PROCESSED & EMAIL LIST VIEW ─────────────────────────────────────
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {/* Toolbar */}
      <div className="compact-toolbar" style={{ minHeight: '28px', padding: '2px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <Archive size={13} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
            Processed Invoices
          </span>

          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: '0.2rem' }}>
            Owner:
          </span>
          <div style={{ width: '170px' }}>
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
            placeholder="OCT26"
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
            onClick={() => load(true)}
            disabled={loading || actionLoading}
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '1px 7px', height: '24px', fontSize: '0.75rem', fontWeight: 600 }}
          >
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>

          {/* Undo / Move back to Unprocessed Button */}
          <button
            onClick={handleBatchUnprocess}
            disabled={!someSelected || actionLoading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '2px 9px',
              height: '24px',
              fontSize: '0.74rem',
              fontWeight: 700,
              background: someSelected ? '#2563eb' : 'var(--bg-secondary)',
              color: someSelected ? '#ffffff' : 'var(--text-muted)',
              border: `1px solid ${someSelected ? '#2563eb' : 'var(--border-subtle)'}`,
              borderRadius: 'var(--radius-sm)',
              cursor: someSelected && !actionLoading ? 'pointer' : 'not-allowed',
              opacity: someSelected ? 1 : 0.6,
              transition: 'all 0.15s ease'
            }}
            title={someSelected ? `Move ${selectedOwnerCodes.size} profile(s) back to Unprocessed` : 'Select profiles to undo'}
          >
            <RotateCcw size={12} className={actionLoading ? 'spin' : ''} />
            {actionLoading ? 'Moving...' : `Undo to Unprocessed ${someSelected ? `(${selectedOwnerCodes.size})` : ''}`}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {someSelected && (
            <span style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              color: '#2563eb',
              background: 'rgba(37, 99, 235, 0.08)',
              border: '1px solid rgba(37, 99, 235, 0.25)',
              borderRadius: '10px',
              padding: '1px 8px',
              fontFamily: 'var(--font-mono)'
            }}>
              Selected: {selectedOwnerCodes.size} of {filteredProfiles.length}
            </span>
          )}
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {filteredProfiles.length} profile{filteredProfiles.length !== 1 ? 's' : ''}
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
        {loading ? (
          <LoadingIndicator message="Loading processed profiles..." fullHeight />
        ) : (
          <table className="compact-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'center', width: '36px' }}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleToggleSelectAll}
                    disabled={filteredProfiles.length === 0}
                    style={{ cursor: 'pointer', width: '13px', height: '13px' }}
                    title={isAllSelected ? 'Deselect All' : 'Select All'}
                  />
                </th>
                <th style={{ textAlign: 'center', width: '40px' }}>#</th>
                <th style={{ minWidth: '260px', textAlign: 'left' }}>Profile Name</th>
                <th style={{ minWidth: '70px', textAlign: 'center' }}>Month</th>
                <th style={{ minWidth: '110px', textAlign: 'center' }}>Processed Invoices</th>
                <th style={{ minWidth: '120px', textAlign: 'right' }}>Total Cost</th>
                <th style={{ minWidth: '130px', textAlign: 'right' }}>Total Invoice</th>
                <th style={{ minWidth: '110px', textAlign: 'center' }}>Emailed</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    No processed invoices found for this month.
                  </td>
                </tr>
              ) : (
                filteredProfiles.map((p, i) => {
                  const isChecked = selectedOwnerCodes.has(p.ownerCode);
                  const isEmailed = Boolean(emailedOwners[String(p.ownerCode)]);
                  const emailInfo = emailedOwners[String(p.ownerCode)];
                  return (
                    <tr
                      key={p.ownerCode}
                      className="table-row-hover"
                      style={{
                        background: isChecked ? 'rgba(59, 130, 246, 0.08)' : undefined,
                        cursor: 'pointer'
                      }}
                      onClick={() => handleToggleOwner(p.ownerCode)}
                      onDoubleClick={() => onViewInExcel?.(p.ownerCode, p.month || month)}
                      title="Double click to open invoice in Excel Sheet View"
                    >
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleOwner(p.ownerCode)}
                          style={{ cursor: 'pointer', width: '13px', height: '13px' }}
                        />
                      </td>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                        {i + 1}
                      </td>

                      {/* Profile Name cell: Send Email on left, Name in middle, View+Undo on right */}
                      <td style={{ fontWeight: 600 }} onClick={e => e.stopPropagation()} onDoubleClick={() => onViewInExcel?.(p.ownerCode, p.month || month)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%' }}>
                          {/* Send Email button on the LEFT */}
                          <button
                            type="button"
                            onClick={() => {
                              setEmailOwnerCode(p.ownerCode);
                              setEmailComposing(true);
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.2rem',
                              padding: '2px 7px',
                              height: '22px',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              background: isEmailed ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.12)',
                              color: '#6366f1',
                              border: '1px solid rgba(99,102,241,0.35)',
                              borderRadius: 'var(--radius-sm)',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              flexShrink: 0
                            }}
                            title={isEmailed ? `Re-send email for ${p.ownerName}` : `Send email for ${p.ownerName}`}
                          >
                            <Mail size={11} />
                            <span>{isEmailed ? 'Re-send' : 'Send Email'}</span>
                          </button>

                          {/* Profile Name in the middle */}
                          <span style={{ fontWeight: 700, fontSize: '0.80rem', color: 'var(--text-main)', whiteSpace: 'nowrap', flex: '1 1 auto' }}>
                            {p.ownerName}
                          </span>

                          {/* View + Undo buttons on the RIGHT */}
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0, marginLeft: 'auto' }}>
                            {/* View button */}
                            <button
                              type="button"
                              onClick={() => onViewInExcel?.(p.ownerCode, p.month || month)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                padding: '2px 7px',
                                height: '22px',
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                background: 'rgba(16, 185, 129, 0.1)',
                                color: '#059669',
                                border: '1px solid rgba(16, 185, 129, 0.35)',
                                borderRadius: 'var(--radius-sm)',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                              }}
                              title={`Open ${p.ownerName}'s invoice in Excel Sheet View`}
                            >
                              <Eye size={11} />
                              <span>View</span>
                            </button>

                            {/* Undo button */}
                            <button
                              type="button"
                              onClick={() => handleSingleUnprocess(p)}
                              disabled={actionLoading}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.2rem',
                                padding: '2px 6px',
                                height: '22px',
                                fontSize: '0.67rem',
                                fontWeight: 600,
                                background: 'transparent',
                                color: '#2563eb',
                                border: '1px solid rgba(37, 99, 235, 0.3)',
                                borderRadius: 'var(--radius-sm)',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                              }}
                              title="Move back to Unprocessed"
                            >
                              <RotateCcw size={10} />
                              <span>Undo</span>
                            </button>
                          </div>
                        </div>
                      </td>

                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                        {p.month}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}>
                        {p.rowsCount} rows
                      </td>

                      {/* Total Cost column */}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-main)' }}>
                        {fmtUsd(p.totalCost != null ? p.totalCost : 0)}
                      </td>

                      {/* Total Invoice column */}
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#2563eb' }}>
                        {fmtUsd(p.totalInvoice != null ? p.totalInvoice : 0)}
                      </td>

                      {/* Emailed status */}
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        {isEmailed ? (
                          <div
                            title={`Emailed to ${emailInfo?.toEmail || 'recipient'}${emailInfo?.emailedAt ? ` on ${new Date(emailInfo.emailedAt).toLocaleDateString()}` : ''}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              background: 'rgba(16, 185, 129, 0.12)',
                              border: '1.5px solid #10b981',
                              color: '#059669',
                              borderRadius: '5px',
                              padding: '2px 8px',
                              fontSize: '0.72rem',
                              fontWeight: 800
                            }}
                          >
                            <CheckCircle size={12} color="#10b981" />
                            <span>Emailed</span>
                          </div>
                        ) : (
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              background: 'rgba(100, 116, 139, 0.08)',
                              border: '1px dashed rgba(100, 116, 139, 0.35)',
                              color: 'var(--text-muted)',
                              borderRadius: '5px',
                              padding: '2px 8px',
                              fontSize: '0.70rem',
                              fontWeight: 600
                            }}
                          >
                            <span>Not Emailed</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredProfiles.length > 0 && (
              <tfoot>
                <tr style={{ background: 'var(--bg-surface)', fontWeight: 800, borderTop: '2px solid var(--border-medium)' }}>
                  <td style={{ textAlign: 'center' }}>—</td>
                  <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.7rem' }}>Total</td>
                  <td style={{ color: 'var(--text-main)', fontSize: '0.76rem' }}>
                    Grand Total ({filteredProfiles.length} Profiles)
                  </td>
                  <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.72rem' }}>—</td>
                  <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}>
                    {totalRowsSum} rows
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-main)', fontWeight: 800 }}>
                    {fmtUsd(totalCostSum)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#2563eb' }}>
                    {fmtUsd(totalInvoiceSum)}
                  </td>
                  <td style={{ textAlign: 'center' }}>—</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  );
};
