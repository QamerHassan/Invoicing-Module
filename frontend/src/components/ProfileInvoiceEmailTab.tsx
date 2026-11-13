import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Send,
  AlertTriangle,
  FileSpreadsheet,
  KeyRound,
  X,
  CheckCircle2,
  RefreshCw,
  Download,
  Mail,
  User,
  ArrowRight,
  Clock,
  ArrowLeft,
  Search
} from 'lucide-react';
import { api } from '../api/client';
import { LoadingIndicator } from './LoadingIndicator';
import type { ProfileGroupOwnerDto, ProfileInvoiceProcessedRowDto, ProfileInvoiceProcessedProfileDto } from '../types';

interface ProfileInvoiceEmailTabProps {
  groupOwners: ProfileGroupOwnerDto[];
  initialOwnerCode?: number | '';
  initialMonth?: string;
  onNavigateToUnprocessed?: (ownerCode?: number, month?: string) => void;
  onOwnerChange?: (ownerCode: number | '') => void;
  onMonthChange?: (month: string) => void;
  selectedCodes?: number[];
  selectedRowsPreview?: any[];
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function formatMonthDisplay(m?: string): string {
  if (!m) return '';
  const clean = m.trim().toUpperCase();
  if (clean.length === 5 && !clean.includes('-')) {
    return `${clean.substring(0, 3)}-${clean.substring(3)}`;
  }
  return clean;
}

function formatCleanFilename(name: string): string {
  return name.replace(/[\s/\\()]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

export const ProfileInvoiceEmailTab: React.FC<ProfileInvoiceEmailTabProps> = ({
  groupOwners,
  initialOwnerCode = '',
  initialMonth = 'OCT26',
  onNavigateToUnprocessed,
  onOwnerChange,
  onMonthChange,
  selectedCodes,
  selectedRowsPreview
}) => {
  const [month, setMonth] = useState<string>(
    (initialMonth || 'OCT26').replace('-', '').toUpperCase()
  );
  const cleanMonth = month.trim().replace('-', '').toUpperCase();

  // Mode: 'list' (default: show processed profiles with Email buttons) OR 'compose' (email compose form)
  const isSelectedMode = Boolean(selectedCodes && selectedCodes.length > 0);
  const [viewMode, setViewMode] = useState<'list' | 'compose'>(() => {
    return isSelectedMode ? 'compose' : 'list';
  });

  const [ownerCode, setOwnerCode] = useState<number | ''>(initialOwnerCode);

  // Sync props from parent
  useEffect(() => {
    if (initialOwnerCode !== undefined && initialOwnerCode !== '') {
      setOwnerCode(initialOwnerCode);
      if (isSelectedMode) {
        setViewMode('compose');
      }
    }
  }, [initialOwnerCode, isSelectedMode]);

  useEffect(() => {
    if (initialMonth) {
      setMonth(initialMonth.replace('-', '').toUpperCase());
    }
  }, [initialMonth]);

  // ─── LIST VIEW STATE (Processed Profiles List) ──────────────────────
  const [processedProfiles, setProcessedProfiles] = useState<ProfileInvoiceProcessedProfileDto[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState<boolean>(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');

  const loadProcessedProfiles = useCallback(async () => {
    if (!cleanMonth) return;
    setLoadingProfiles(true);
    setProfilesError(null);
    try {
      const data = await api.getProcessedProfiles(undefined, cleanMonth);
      setProcessedProfiles(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setProfilesError(err?.message || 'Failed to load processed profiles.');
      setProcessedProfiles([]);
    } finally {
      setLoadingProfiles(false);
    }
  }, [cleanMonth]);

  useEffect(() => {
    if (viewMode === 'list') {
      loadProcessedProfiles();
    }
  }, [viewMode, loadProcessedProfiles]);

  const filteredProfiles = useMemo(() => {
    if (!search.trim()) return processedProfiles;
    const q = search.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    return processedProfiles.filter(p => {
      const text = `${p.ownerName || ''} ${p.ownerCode} ${p.month || ''}`.toLowerCase();
      return words.every(w => text.includes(w));
    });
  }, [processedProfiles, search]);

  // ─── COMPOSE VIEW STATE ─────────────────────────────────────────────
  const [processedRows, setProcessedRows] = useState<ProfileInvoiceProcessedRowDto[]>([]);
  const [loadingProcessed, setLoadingProcessed] = useState<boolean>(false);
  const [processedError, setProcessedError] = useState<string | null>(null);

  const [unprocessedWarning, setUnprocessedWarning] = useState<{
    show: boolean;
    ownerName: string;
    count: number;
    usd: number;
    dismissed: boolean;
  }>({ show: false, ownerName: '', count: 0, usd: 0, dismissed: false });

  const [downloadingExcel, setDownloadingExcel] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);

  const [toEmail, setToEmail] = useState<string>('');
  const [replyToEmail, setReplyToEmail] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');

  const [senderEmail, setSenderEmail] = useState<string>('');
  const [appPassword, setAppPassword] = useState<string>('');
  const [rememberSettings, setRememberSettings] = useState<boolean>(false);
  const [savedSenderEmail, setSavedSenderEmail] = useState<string | null>(null);
  const [hasSavedPassword, setHasSavedPassword] = useState<boolean>(false);
  const [showChangeForm, setShowChangeForm] = useState<boolean>(false);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const currentOwner = useMemo(() => {
    if (!ownerCode) return null;
    return groupOwners.find(o => o.prfOwnCode === ownerCode) || null;
  }, [groupOwners, ownerCode]);

  const activeOwnerProfile = useMemo(() => {
    if (!ownerCode) return null;
    return processedProfiles.find(p => p.ownerCode === ownerCode) || null;
  }, [processedProfiles, ownerCode]);

  const activeOwnerName = currentOwner?.profileName || activeOwnerProfile?.ownerName || (processedRows.length > 0 ? processedRows[0].profileName : `Owner #${ownerCode}`);

  useEffect(() => {
    api.getEmailSettings()
      .then(s => {
        setSavedSenderEmail(s.senderEmail);
        setHasSavedPassword(s.hasSavedPassword);
      })
      .catch(() => { /* silently ignore */ });
  }, []);

  const hasSavedSettings = !!savedSenderEmail && hasSavedPassword;

  const loadOwnerProcessedInvoices = useCallback(async () => {
    if (!ownerCode || !cleanMonth) {
      setProcessedRows([]);
      return;
    }

    setLoadingProcessed(true);
    setProcessedError(null);

    try {
      const data = await api.getProcessedInvoices(Number(ownerCode), cleanMonth);
      setProcessedRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setProcessedError(err?.message || 'Failed to load processed invoices.');
      setProcessedRows([]);
    } finally {
      setLoadingProcessed(false);
    }
  }, [ownerCode, cleanMonth]);

  const checkOwnerUnprocessedStatus = useCallback(async () => {
    if (!ownerCode || !cleanMonth) {
      setUnprocessedWarning(prev => ({ ...prev, show: false }));
      return;
    }

    try {
      const status = await api.getOwnerUnprocessedStatus(Number(ownerCode), cleanMonth);
      if (status.hasUnprocessed && status.unprocessedCount > 0) {
        setUnprocessedWarning({
          show: true,
          ownerName: status.ownerName || activeOwnerName,
          count: status.unprocessedCount,
          usd: status.unprocessedUsd,
          dismissed: false
        });
      } else {
        setUnprocessedWarning(prev => ({ ...prev, show: false, dismissed: false, count: 0, usd: 0 }));
      }
    } catch {
      setUnprocessedWarning(prev => ({ ...prev, show: false }));
    }
  }, [ownerCode, cleanMonth, activeOwnerName]);

  useEffect(() => {
    if (viewMode === 'compose' && ownerCode) {
      loadOwnerProcessedInvoices();
      checkOwnerUnprocessedStatus();
    }
  }, [viewMode, ownerCode, loadOwnerProcessedInvoices, checkOwnerUnprocessedStatus]);

  const displayRows = useMemo(() => {
    if (selectedRowsPreview && selectedRowsPreview.length > 0) {
      return selectedRowsPreview;
    }
    return processedRows;
  }, [selectedRowsPreview, processedRows]);

  // Update default email recipient, subject, and body
  useEffect(() => {
    if (!ownerCode || viewMode !== 'compose') return;

    const cachedEmail = localStorage.getItem(`profile_invoice_email_recipient_${ownerCode}`) || '';
    setToEmail(cachedEmail);

    const monthFormatted = formatMonthDisplay(cleanMonth);
    const invoiceTotal = activeOwnerProfile ? activeOwnerProfile.totalInvoice : displayRows.reduce((acc, r: any) => acc + (r.chargedAmtUsd ?? r.finalUsd ?? r.totalCost ?? 0), 0);

    setSubject(`Profile Invoice – ${activeOwnerName} – ${monthFormatted}`);
    setBody(
      `Dear ${activeOwnerName},\n\n` +
      `Please find attached your ${isSelectedMode ? 'selected' : 'processed'} profile invoice for ${monthFormatted}.\n\n` +
      `Summary:\n` +
      `• Total Invoice Amount: $${Math.round(invoiceTotal).toLocaleString()}\n` +
      `• Processed Invoices: ${activeOwnerProfile ? activeOwnerProfile.rowsCount : displayRows.length}\n\n` +
      `Please review the attached Excel workbook for complete line-item breakdown.\n\n` +
      `Regards,\n` +
      `Rizviz Invoicing Team`
    );
    setFieldErrors({});
  }, [ownerCode, cleanMonth, activeOwnerName, displayRows, isSelectedMode, viewMode, activeOwnerProfile]);

  const ownerTotals = useMemo(() => {
    const usd = activeOwnerProfile ? activeOwnerProfile.totalInvoice : displayRows.reduce((acc, r: any) => acc + (r.chargedAmtUsd ?? r.finalUsd ?? r.totalCost ?? 0), 0);
    const count = activeOwnerProfile ? activeOwnerProfile.rowsCount : displayRows.length;
    return { count, usd };
  }, [activeOwnerProfile, displayRows]);

  const attachmentFilename = ownerCode && cleanMonth
    ? (isSelectedMode
        ? `Selected_Invoice_${formatCleanFilename(activeOwnerName)}_${cleanMonth}.xlsx`
        : `Processed_Invoice_${formatCleanFilename(activeOwnerName)}_${cleanMonth}.xlsx`)
    : null;

  const handleReviewAttachment = async () => {
    if (!ownerCode || !cleanMonth) return;
    try {
      setDownloadingExcel(true);
      setErrorMsg(null);
      const blob = await api.downloadProfileInvoiceExcel(
        Number(ownerCode),
        cleanMonth,
        isSelectedMode ? false : true,
        isSelectedMode ? true : false
      );
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = isSelectedMode
        ? `Selected_Invoice_${formatCleanFilename(activeOwnerName)}_${cleanMonth}.xlsx`
        : `Processed_Invoice_${formatCleanFilename(activeOwnerName)}_${cleanMonth}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to download Excel attachment preview.');
    } finally {
      setDownloadingExcel(false);
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!ownerCode) errs.owner = 'Select a Profile Owner.';
    if (!cleanMonth || cleanMonth.length < 5) errs.month = 'Enter valid month (e.g. OCT26).';

    if (!hasSavedSettings || showChangeForm) {
      if (senderEmail.trim() && !validateEmail(senderEmail))
        errs.senderEmail = 'Enter a valid sender email.';
      if (senderEmail.trim() && !appPassword.trim())
        errs.appPassword = 'App Password required when Sender Email is set.';
    }

    if (replyToEmail.trim() && !validateEmail(replyToEmail)) errs.replyToEmail = 'Enter a valid email address.';
    if (!toEmail.trim()) errs.toEmail = 'Recipient email is required.';
    else if (!validateEmail(toEmail)) errs.toEmail = 'Enter a valid email address.';
    if (!subject.trim()) errs.subject = 'Subject is required.';
    if (!body.trim()) errs.body = 'Message body is required.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSend = async () => {
    setSuccessMsg(null);
    setErrorMsg(null);
    if (!validate() || !ownerCode) return;

    let activeSenderEmail: string | undefined;
    let activeAppPassword: string | undefined;
    let activeRemember = false;

    if (showChangeForm || !hasSavedSettings) {
      if (senderEmail.trim() && appPassword.trim()) {
        activeSenderEmail = senderEmail.trim();
        activeAppPassword = appPassword;
        activeRemember = rememberSettings;
      }
    }

    try {
      setSending(true);
      localStorage.setItem(`profile_invoice_email_recipient_${ownerCode}`, toEmail.trim());

      const result = await api.sendProfileInvoiceEmail({
        groupOwnerCode: Number(ownerCode),
        month: cleanMonth,
        replyToEmail: replyToEmail.trim() || undefined,
        toEmail: toEmail.trim(),
        subject: subject.trim(),
        body: body.trim(),
        senderEmail: activeSenderEmail,
        appPassword: activeAppPassword,
        rememberSettings: activeRemember,
        processedOnly: isSelectedMode ? false : true,
        excludeToBeDiscussed: true,
        specificCodes: isSelectedMode && selectedCodes && selectedCodes.length > 0 ? selectedCodes : undefined
      });

      if (result.success) {
        setSuccessMsg(result.message || `Invoice email sent successfully to ${toEmail.trim()}!`);
        setFieldErrors({});

        if (activeRemember && activeSenderEmail) {
          setSavedSenderEmail(activeSenderEmail);
          setHasSavedPassword(true);
          setShowChangeForm(false);
          setSenderEmail('');
        }

        // Return to processed profiles list after successful send
        setTimeout(() => {
          setViewMode('list');
          setOwnerCode('');
          loadProcessedProfiles();
        }, 1500);
      } else {
        setErrorMsg(result.message || 'Failed to send email.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error while sending email.');
    } finally {
      setSending(false);
    }
  };

  const fmtUsd = (v: number) =>
    v == null ? '$0' : '$' + Math.round(v).toLocaleString();

  const inputStyle = (hasError: boolean): React.CSSProperties => ({
    width: '100%',
    background: 'var(--bg-surface)',
    color: 'var(--text-main)',
    border: hasError ? '1px solid #ef4444' : '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.35rem 0.55rem',
    fontSize: '0.8rem',
    outline: 'none',
    boxSizing: 'border-box'
  });

  // ═════════════════════════════════════════════════════════════════════
  // ─── VIEW 1: PROCESSED PROFILES LIST VIEW (Default / Tab Open) ───────
  // ═════════════════════════════════════════════════════════════════════
  if (viewMode === 'list') {
    return (
      <div style={{ flex: 1, minHeight: 0, padding: '2px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {/* Toolbar */}
        <div className="compact-toolbar" style={{ minHeight: '30px', padding: '2px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Mail size={14} style={{ color: 'var(--accent-primary)' }} />
              <span style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-main)' }}>
                Email Processed Invoices
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                Month:
              </span>
              <input
                type="text"
                value={month}
                onChange={e => {
                  const val = e.target.value.toUpperCase();
                  setMonth(val);
                  if (onMonthChange) onMonthChange(val);
                }}
                placeholder="OCT26"
                maxLength={7}
                style={{
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface)',
                  color: 'var(--text-main)',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  width: '68px',
                  height: '24px',
                  boxSizing: 'border-box'
                }}
              />
              <button
                onClick={loadProcessedProfiles}
                disabled={loadingProfiles}
                title="Refresh processed profiles"
                style={{
                  height: '24px',
                  padding: '0 6px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: loadingProfiles ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)'
                }}
              >
                <RefreshCw size={11} className={loadingProfiles ? 'spin' : ''} />
                <span>Refresh</span>
              </button>
            </div>

            {/* Search */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={11} style={{ position: 'absolute', left: '6px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search profiles..."
                style={{
                  background: 'var(--bg-surface)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '1px 22px 1px 20px',
                  fontSize: '0.72rem',
                  width: '140px',
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
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {filteredProfiles.length} processed profile{filteredProfiles.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Notifications */}
        {successMsg && (
          <div style={{
            padding: '0.3rem 0.6rem',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: 'var(--radius-sm)',
            color: '#10b981',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}>
            <CheckCircle2 size={13} />
            <span>{successMsg}</span>
          </div>
        )}
        {profilesError && (
          <div style={{
            padding: '0.3rem 0.6rem',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-sm)',
            color: '#ef4444',
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}>
            <AlertTriangle size={13} />
            <span>{profilesError}</span>
          </div>
        )}

        {/* Table */}
        <div className="compact-table-container">
          {loadingProfiles ? (
            <LoadingIndicator message="Loading processed profiles for email..." fullHeight />
          ) : (
            <table className="compact-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'center', width: '40px' }}>#</th>
                  <th style={{ minWidth: '180px', textAlign: 'left' }}>Profile Owner Name</th>
                  <th style={{ minWidth: '70px', textAlign: 'center' }}>Month</th>
                  <th style={{ minWidth: '110px', textAlign: 'center' }}>Total Invoices</th>
                  <th style={{ minWidth: '130px', textAlign: 'right' }}>Total Amount (USD)</th>
                  <th style={{ minWidth: '90px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      <Mail size={24} style={{ color: 'var(--text-subtle)', margin: '0 auto 8px', display: 'block' }} />
                      {search ? `No processed profiles matching "${search}".` : 'Koi processed invoice nahi.'}
                    </td>
                  </tr>
                ) : (
                  filteredProfiles.map((p, i) => (
                    <tr
                      key={p.ownerCode}
                      className="table-row-hover"
                    >
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                        {i + 1}
                      </td>
                      <td style={{ fontWeight: 600 }}>{p.ownerName}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                        {p.month}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.74rem', fontWeight: 600 }}>
                        {p.rowsCount.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--excel-actual-color)' }}>
                        {fmtUsd(p.totalInvoice)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setOwnerCode(p.ownerCode);
                            if (onOwnerChange) onOwnerChange(p.ownerCode);
                            setViewMode('compose');
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            padding: '2px 10px',
                            height: '22px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            background: '#2563eb',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                          }}
                          title={`Compose invoice email for ${p.ownerName}`}
                        >
                          <Mail size={11} />
                          <span>Send Email</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════
  // ─── VIEW 2: COMPOSE VIEW FOR SELECTED PROFILE ───────────────────────
  // ═════════════════════════════════════════════════════════════════════
  return (
    <div style={{ flex: 1, minHeight: 0, padding: '2px', display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative' }}>
      
      {/* ─── UNPROCESSED INVOICE WARNING POPUP MODAL ─── */}
      {unprocessedWarning.show && !unprocessedWarning.dismissed && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100, padding: '1rem'
        }}>
          <div style={{
            background: 'var(--bg-surface, #1e293b)',
            border: '2px solid #f59e0b',
            borderRadius: 'var(--radius-md, 8px)',
            maxWidth: '520px',
            width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            overflow: 'hidden'
          }}>
            <div style={{
              background: 'rgba(245, 158, 11, 0.15)',
              borderBottom: '1px solid rgba(245, 158, 11, 0.35)',
              padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: '10px'
            }}>
              <div style={{
                background: '#f59e0b', color: '#000', borderRadius: '50%',
                width: '28px', height: '28px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
              }}>
                <AlertTriangle size={17} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-main, #f8fafc)' }}>
                  Unprocessed Invoices Pending
                </h3>
                <span style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 600 }}>
                  Action required before sending email
                </span>
              </div>
            </div>

            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main, #f8fafc)' }}>
                Some invoices for <span style={{ color: '#f59e0b' }}>{unprocessedWarning.ownerName}</span> are still unprocessed.
              </p>

              <div style={{
                background: 'var(--bg-secondary, #0f172a)',
                border: '1px solid var(--border-subtle, #334155)',
                borderRadius: 'var(--radius-sm, 4px)',
                padding: '10px 14px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
              }}>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #94a3b8)', fontWeight: 600 }}>Unprocessed Count</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>
                    {unprocessedWarning.count} invoices
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #94a3b8)', fontWeight: 600 }}>Pending Amount</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>
                    ${Math.round(unprocessedWarning.usd).toLocaleString()}
                  </div>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)', lineHeight: 1.4 }}>
                The email attachment will strictly contain currently processed invoices only.
              </p>
            </div>

            <div style={{
              background: 'var(--bg-secondary, #0f172a)',
              borderTop: '1px solid var(--border-subtle, #334155)',
              padding: '10px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px'
            }}>
              <button
                onClick={() => setUnprocessedWarning(prev => ({ ...prev, dismissed: true }))}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-sm, 4px)',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Continue to Email View
              </button>

              <button
                onClick={() => {
                  setUnprocessedWarning(prev => ({ ...prev, dismissed: true }));
                  if (onNavigateToUnprocessed) {
                    onNavigateToUnprocessed(Number(ownerCode), cleanMonth);
                  }
                }}
                className="btn-primary"
                style={{
                  padding: '6px 16px',
                  borderRadius: 'var(--radius-sm, 4px)',
                  background: '#f59e0b',
                  color: '#000',
                  border: 'none',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}
              >
                <span>Go to Unprocessed Invoices</span>
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Top Navigation Bar with Back Button ─── */}
      <div className="compact-toolbar" style={{ minHeight: '32px', padding: '2px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => {
              setViewMode('list');
              setSuccessMsg(null);
              setErrorMsg(null);
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
            title="Wapas Processed Profiles List Par"
          >
            <ArrowLeft size={12} />
            <span>Processed List</span>
          </button>

          {/* Profile Name & Stats Pill */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.74rem',
            padding: '2px 10px',
            borderRadius: '12px',
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            color: 'var(--text-main)'
          }}>
            <span>Owner: <strong>{activeOwnerName}</strong></span>
            <span style={{ color: 'var(--text-subtle)' }}>•</span>
            <span>Month: <strong>{cleanMonth}</strong></span>
            <span style={{ color: 'var(--text-subtle)' }}>•</span>
            <span>Processed: <strong>{ownerTotals.count}</strong> invoices</span>
            <span style={{ color: 'var(--text-subtle)' }}>•</span>
            <span style={{ color: 'var(--excel-actual-color)', fontWeight: 800 }}>${Math.round(ownerTotals.usd).toLocaleString()}</span>
          </div>

          {unprocessedWarning.count > 0 && (
            <button
              onClick={() => {
                if (onNavigateToUnprocessed) onNavigateToUnprocessed(Number(ownerCode), cleanMonth);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.70rem',
                padding: '2px 8px',
                borderRadius: '12px',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid #f59e0b',
                color: '#f59e0b',
                cursor: 'pointer',
                fontWeight: 700
              }}
              title="Click to navigate and process pending invoices"
            >
              <Clock size={11} />
              <span>{unprocessedWarning.count} Unprocessed Pending</span>
            </button>
          )}
        </div>

        {/* Send Action Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
          <button
            onClick={handleSend}
            disabled={sending || !ownerCode || !cleanMonth || displayRows.length === 0}
            className="btn-primary"
            style={{
              height: '26px',
              padding: '2px 14px',
              fontSize: '0.75rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: '#2563eb',
              opacity: (sending || !ownerCode || !cleanMonth || displayRows.length === 0) ? 0.6 : 1,
              cursor: (sending || !ownerCode || !cleanMonth || displayRows.length === 0) ? 'not-allowed' : 'pointer'
            }}
          >
            <Send size={12} className={sending ? 'spin' : ''} />
            <span>{sending ? 'Sending...' : 'Send Invoice Email'}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {processedError && (
        <div style={{
          padding: '0.3rem 0.6rem',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: '#ef4444',
          fontSize: '0.75rem',
          display: 'flex', alignItems: 'center', gap: '0.4rem'
        }}>
          <AlertTriangle size={13} />
          <span>{processedError}</span>
        </div>
      )}

      {errorMsg && (
        <div style={{
          padding: '0.3rem 0.6rem',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: '#ef4444',
          fontSize: '0.75rem',
          display: 'flex', alignItems: 'center', gap: '0.4rem'
        }}>
          <AlertTriangle size={13} />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div style={{
          padding: '0.3rem 0.6rem',
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: '#10b981',
          fontSize: '0.75rem',
          display: 'flex', alignItems: 'center', gap: '0.4rem'
        }}>
          <CheckCircle2 size={13} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* ─── Main 2-Panel Content Layout ─── */}
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(380px, 1.15fr) minmax(380px, 1.25fr)',
        gap: '8px',
        overflow: 'hidden'
      }}>

        {/* ═════════ LEFT PANE: Selected Owner's Processed Invoices Table ═════════ */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-secondary)',
          padding: '6px',
          overflow: 'hidden'
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '3px 6px',
            background: 'rgba(99, 102, 241, 0.06)',
            borderRadius: 'var(--radius-sm)',
            borderBottom: '1px solid var(--border-subtle)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <User size={13} color="var(--accent-primary, #6366f1)" />
              <span style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {isSelectedMode ? 'Selected Invoices:' : 'Processed Invoices:'} <strong>{activeOwnerName}</strong>
              </span>
              <span style={{ fontSize: '0.68rem', color: isSelectedMode ? '#10b981' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: isSelectedMode ? 700 : 400 }}>
                ({isSelectedMode ? `Selected rows: ${displayRows.length}` : `${displayRows.length} rows`})
              </span>
            </div>

            {/* Quick Preview Button */}
            {displayRows.length > 0 && (
              <button
                onClick={handleReviewAttachment}
                disabled={downloadingExcel}
                title="Download Excel containing this owner's processed invoices"
                style={{
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#10b981',
                  borderRadius: '3px',
                  padding: '1px 7px',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  cursor: downloadingExcel ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px'
                }}
              >
                <Download size={10} className={downloadingExcel ? 'spin' : ''} />
                <span>Review Excel</span>
              </button>
            )}
          </div>

          {/* Processed Invoices Table */}
          <div style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-surface)'
          }}>
            {loadingProcessed ? (
              <LoadingIndicator message={`Loading processed invoices for ${activeOwnerName}...`} />
            ) : displayRows.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <FileSpreadsheet size={24} color="#f59e0b" style={{ margin: '0 auto 8px' }} />
                <h5 style={{ margin: '0 0 4px', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                  No Processed Invoices for {activeOwnerName}
                </h5>
                <p style={{ margin: '0 0 12px', fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {unprocessedWarning.count > 0 ? (
                    <span>This owner currently has <strong>{unprocessedWarning.count} unprocessed invoice(s)</strong> waiting to be saved.</span>
                  ) : (
                    <span>No processed invoices found for {formatMonthDisplay(cleanMonth)}.</span>
                  )}
                </p>
                {unprocessedWarning.count > 0 && onNavigateToUnprocessed && (
                  <button
                    onClick={() => onNavigateToUnprocessed(Number(ownerCode), cleanMonth)}
                    className="btn-primary"
                    style={{
                      padding: '4px 12px',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      background: '#f59e0b',
                      color: '#000',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)'
                    }}
                  >
                    Go to Unprocessed
                  </button>
                )}
              </div>
            ) : (
              <table className="compact-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: '30px', textAlign: 'center' }}>#</th>
                    <th style={{ minWidth: '90px', textAlign: 'left' }}>Project</th>
                    <th style={{ minWidth: '80px', textAlign: 'left' }}>Stack</th>
                    <th style={{ minWidth: '80px', textAlign: 'left' }}>Invoice To</th>
                    <th style={{ minWidth: '70px', textAlign: 'right' }}>Charged USD</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((r: any, idx: number) => (
                    <tr key={r.cmpProfInvoiceCode || idx}>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                        {idx + 1}
                      </td>
                      <td style={{ fontWeight: 600 }}>{r.projectName || '-'}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{r.stack || '-'}</td>
                      <td>{r.invoiceToName || '-'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--excel-actual-color)' }}>
                        {fmtUsd(r.chargedAmtUsd ?? r.finalUsd ?? r.totalCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Attachment Banner */}
          <div style={{
            background: 'rgba(99, 102, 241, 0.05)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <div style={{
                background: '#10b981',
                color: '#fff',
                borderRadius: '4px',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <FileSpreadsheet size={16} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {attachmentFilename || 'invoice.xlsx'}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  Excel Invoice Attachment (Generated from live data)
                </div>
              </div>
            </div>

            <button
              onClick={handleReviewAttachment}
              disabled={downloadingExcel || !ownerCode || displayRows.length === 0}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-main)',
                borderRadius: 'var(--radius-sm)',
                padding: '3px 8px',
                fontSize: '0.70rem',
                fontWeight: 700,
                cursor: (downloadingExcel || !ownerCode || displayRows.length === 0) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                flexShrink: 0
              }}
            >
              <Download size={11} className={downloadingExcel ? 'spin' : ''} />
              <span>{downloadingExcel ? 'Downloading...' : 'Review File'}</span>
            </button>
          </div>
        </div>

        {/* ═════════ RIGHT PANE: Email Compose Form ═════════ */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-secondary)',
          padding: '8px 12px',
          overflowY: 'auto'
        }}>
          {/* Recipient */}
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px' }}>
              To (Recipient Email) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="email"
              value={toEmail}
              onChange={e => {
                setToEmail(e.target.value);
                setFieldErrors(prev => ({ ...prev, toEmail: '' }));
              }}
              placeholder={`e.g. ${formatCleanFilename(activeOwnerName).toLowerCase()}@client.com`}
              style={inputStyle(!!fieldErrors.toEmail)}
            />
            {fieldErrors.toEmail && (
              <span style={{ fontSize: '0.68rem', color: '#ef4444' }}>{fieldErrors.toEmail}</span>
            )}
          </div>

          {/* Reply-To */}
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px' }}>
              Reply-To (Optional)
            </label>
            <input
              type="email"
              value={replyToEmail}
              onChange={e => {
                setReplyToEmail(e.target.value);
                setFieldErrors(prev => ({ ...prev, replyToEmail: '' }));
              }}
              placeholder="e.g. accounts@rizviz.com"
              style={inputStyle(!!fieldErrors.replyToEmail)}
            />
            {fieldErrors.replyToEmail && (
              <span style={{ fontSize: '0.68rem', color: '#ef4444' }}>{fieldErrors.replyToEmail}</span>
            )}
          </div>

          {/* Subject */}
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px' }}>
              Subject <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => {
                setSubject(e.target.value);
                setFieldErrors(prev => ({ ...prev, subject: '' }));
              }}
              placeholder="Invoice Subject..."
              style={inputStyle(!!fieldErrors.subject)}
            />
            {fieldErrors.subject && (
              <span style={{ fontSize: '0.68rem', color: '#ef4444' }}>{fieldErrors.subject}</span>
            )}
          </div>

          {/* Body */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px' }}>
              Message Body <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <textarea
              value={body}
              onChange={e => {
                setBody(e.target.value);
                setFieldErrors(prev => ({ ...prev, body: '' }));
              }}
              rows={8}
              style={{
                ...inputStyle(!!fieldErrors.body),
                flex: 1,
                minHeight: '130px',
                resize: 'vertical',
                fontFamily: 'inherit',
                lineHeight: 1.45
              }}
            />
            {fieldErrors.body && (
              <span style={{ fontSize: '0.68rem', color: '#ef4444' }}>{fieldErrors.body}</span>
            )}
          </div>

          {/* Sender Credentials Settings Accordion / Box */}
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 10px',
            fontSize: '0.75rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <KeyRound size={12} color="var(--accent-primary)" />
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                  Sender Settings:
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                  {hasSavedSettings && !showChangeForm
                    ? `Using ${savedSenderEmail}`
                    : 'System Default SMTP'}
                </span>
              </div>

              {hasSavedSettings && (
                <button
                  type="button"
                  onClick={() => setShowChangeForm(!showChangeForm)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-primary)',
                    fontSize: '0.70rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  {showChangeForm ? 'Cancel' : 'Change Credentials'}
                </button>
              )}
            </div>

            {(!hasSavedSettings || showChangeForm) && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div>
                  <input
                    type="email"
                    value={senderEmail}
                    onChange={e => setSenderEmail(e.target.value)}
                    placeholder="Custom Gmail / SMTP Sender Email"
                    style={inputStyle(!!fieldErrors.senderEmail)}
                  />
                  {fieldErrors.senderEmail && (
                    <span style={{ fontSize: '0.65rem', color: '#ef4444' }}>{fieldErrors.senderEmail}</span>
                  )}
                </div>

                <div>
                  <input
                    type="password"
                    value={appPassword}
                    onChange={e => setAppPassword(e.target.value)}
                    placeholder="16-character Google App Password"
                    style={inputStyle(!!fieldErrors.appPassword)}
                  />
                  {fieldErrors.appPassword && (
                    <span style={{ fontSize: '0.65rem', color: '#ef4444' }}>{fieldErrors.appPassword}</span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="checkbox"
                    id="rememberSettings"
                    checked={rememberSettings}
                    onChange={e => setRememberSettings(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="rememberSettings" style={{ fontSize: '0.70rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    Remember credentials for future sessions
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};