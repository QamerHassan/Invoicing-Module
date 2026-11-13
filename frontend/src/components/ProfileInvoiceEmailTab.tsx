import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Send,
  Paperclip,
  Check,
  AlertTriangle,
  FileSpreadsheet,
  KeyRound,
  X,
  Save,
  CheckCircle2,
  RefreshCw,
  Download,
  Mail,
  User,
  ArrowRight,
  Clock
} from 'lucide-react';
import { api } from '../api/client';
import { OwnerSearchSelect } from './OwnerSearchSelect';
import { LoadingIndicator } from './LoadingIndicator';
import type { ProfileGroupOwnerDto, ProfileInvoiceProcessedRowDto } from '../types';

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
  const [ownerCode, setOwnerCode] = useState<number | ''>(initialOwnerCode);
  const [month, setMonth] = useState<string>(
    (initialMonth || 'OCT26').replace('-', '').toUpperCase()
  );

  const cleanMonth = month.trim().replace('-', '').toUpperCase();

  // Sync props from parent
  useEffect(() => {
    if (initialOwnerCode !== undefined && initialOwnerCode !== '') {
      setOwnerCode(initialOwnerCode);
    }
  }, [initialOwnerCode]);

  useEffect(() => {
    if (initialMonth) {
      setMonth(initialMonth.replace('-', '').toUpperCase());
    }
  }, [initialMonth]);

  // Processed invoices state (STRICTLY for this owner)
  const [processedRows, setProcessedRows] = useState<ProfileInvoiceProcessedRowDto[]>([]);
  const [loadingProcessed, setLoadingProcessed] = useState<boolean>(false);
  const [processedError, setProcessedError] = useState<string | null>(null);

  // Unprocessed warning state for this owner
  const [unprocessedWarning, setUnprocessedWarning] = useState<{
    show: boolean;
    ownerName: string;
    count: number;
    usd: number;
    dismissed: boolean;
  }>({ show: false, ownerName: '', count: 0, usd: 0, dismissed: false });

  // Download & Send state
  const [downloadingExcel, setDownloadingExcel] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [emailSent, setEmailSent] = useState<boolean>(false);

  // Email form state
  const [toEmail, setToEmail] = useState<string>('');
  const [replyToEmail, setReplyToEmail] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');

  // Multi-sender & credential settings state
  const [senderEmail, setSenderEmail] = useState<string>('');
  const [appPassword, setAppPassword] = useState<string>('');
  const [rememberSettings, setRememberSettings] = useState<boolean>(false);
  const [savedSenderEmail, setSavedSenderEmail] = useState<string | null>(null);
  const [hasSavedPassword, setHasSavedPassword] = useState<boolean>(false);
  const [showChangeForm, setShowChangeForm] = useState<boolean>(false);
  const [loadingSettings, setLoadingSettings] = useState<boolean>(true);
  const [removingSettings, setRemovingSettings] = useState<boolean>(false);

  // Notifications & validation
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Resolve active owner name
  const currentOwner = useMemo(() => {
    if (!ownerCode) return null;
    return groupOwners.find(o => o.prfOwnCode === ownerCode) || null;
  }, [groupOwners, ownerCode]);

  const activeOwnerName = currentOwner?.profileName || (processedRows.length > 0 ? processedRows[0].profileName : `Owner #${ownerCode}`);

  // Load saved sender settings on mount
  useEffect(() => {
    setLoadingSettings(true);
    api.getEmailSettings()
      .then(s => {
        setSavedSenderEmail(s.senderEmail);
        setHasSavedPassword(s.hasSavedPassword);
      })
      .catch(() => { /* silently ignore */ })
      .finally(() => setLoadingSettings(false));
  }, []);

  const hasSavedSettings = !!savedSenderEmail && hasSavedPassword;

  // 1. Fetch Processed Invoices ONLY for the selected owner & month
  const loadOwnerProcessedInvoices = useCallback(async () => {
    if (!ownerCode || !cleanMonth) {
      setProcessedRows([]);
      return;
    }

    setLoadingProcessed(true);
    setProcessedError(null);

    try {
      // Backend-level filtering: passes ownerCode so API returns ONLY this owner's processed rows
      const data = await api.getProcessedInvoices(Number(ownerCode), cleanMonth);
      setProcessedRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setProcessedError(err?.message || 'Failed to load processed invoices.');
      setProcessedRows([]);
    } finally {
      setLoadingProcessed(false);
    }
  }, [ownerCode, cleanMonth]);

  // 2. Check Unprocessed Invoices status for this owner & month
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
      // Non-fatal if warning check fails
      setUnprocessedWarning(prev => ({ ...prev, show: false }));
    }
  }, [ownerCode, cleanMonth, activeOwnerName]);

  // Reload data whenever ownerCode or cleanMonth changes
  useEffect(() => {
    loadOwnerProcessedInvoices();
    checkOwnerUnprocessedStatus();
  }, [loadOwnerProcessedInvoices, checkOwnerUnprocessedStatus]);

  const isSelectedMode = Boolean(selectedCodes && selectedCodes.length > 0);

  const displayRows = useMemo(() => {
    if (selectedRowsPreview && selectedRowsPreview.length > 0) {
      return selectedRowsPreview;
    }
    return processedRows;
  }, [selectedRowsPreview, processedRows]);

  // Update default email recipient, subject, and body when owner or rows change
  useEffect(() => {
    if (!ownerCode) {
      setToEmail('');
      setSubject('');
      setBody('');
      return;
    }

    const cachedEmail = localStorage.getItem(`profile_invoice_email_recipient_${ownerCode}`) || '';
    setToEmail(cachedEmail);

    const monthFormatted = formatMonthDisplay(cleanMonth);
    const totalUsd = displayRows.reduce((acc, r: any) => acc + (r.chargedAmtUsd ?? r.finalUsd ?? r.totalCost ?? 0), 0);

    setSubject(`Profile Invoice – ${activeOwnerName} – ${monthFormatted}`);
    setBody(
      `Dear ${activeOwnerName},\n\n` +
      `Please find attached your ${isSelectedMode ? 'selected' : 'processed'} profile invoice for ${monthFormatted}.\n\n` +
      `Summary:\n` +
      `• ${isSelectedMode ? 'Selected' : 'Processed'} Invoices: ${displayRows.length}\n` +
      `• Total Amount: $${Math.round(totalUsd).toLocaleString()}\n\n` +
      `Please review the attached Excel workbook for complete line-item breakdown.\n\n` +
      `Regards,\n` +
      `Rizviz Invoicing Team`
    );
    setFieldErrors({});
    setSuccessMsg(null);
    setErrorMsg(null);
    setEmailSent(false);
  }, [ownerCode, cleanMonth, activeOwnerName, displayRows, isSelectedMode]);

  // Calculated totals for this owner's display rows
  const ownerTotals = useMemo(() => {
    const usd = displayRows.reduce((acc, r: any) => acc + (r.chargedAmtUsd ?? r.finalUsd ?? r.totalCost ?? 0), 0);
    const pkr = displayRows.reduce((acc, r: any) => acc + (r.chargedAmtPkr ?? 0), 0);
    return { count: displayRows.length, usd, pkr };
  }, [displayRows]);

  const attachmentFilename = ownerCode && cleanMonth
    ? (isSelectedMode
        ? `Selected_Invoice_${formatCleanFilename(activeOwnerName)}_${cleanMonth}.xlsx`
        : `Processed_Invoice_${formatCleanFilename(activeOwnerName)}_${cleanMonth}.xlsx`)
    : null;

  // Review / Download Excel attachment preview
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

  const handleRemoveSettings = async () => {
    setRemovingSettings(true);
    try {
      await api.deleteEmailSettings();
      setSavedSenderEmail(null);
      setHasSavedPassword(false);
      setShowChangeForm(false);
      setSenderEmail('');
      setAppPassword('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to remove settings.');
    } finally {
      setRemovingSettings(false);
    }
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

      // Cache recipient email for this owner
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
        setSuccessMsg((result.message || `Invoice email sent successfully to ${toEmail.trim()}!`) + ' Invoices processed tab mein move ho chuki hain.');
        setEmailSent(true);
        setFieldErrors({});

        if (activeRemember && activeSenderEmail) {
          setSavedSenderEmail(activeSenderEmail);
          setHasSavedPassword(true);
          setShowChangeForm(false);
          setSenderEmail('');
        }
      } else {
        setErrorMsg(result.message || 'Failed to send email.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'An unexpected error occurred while sending email.');
    } finally {
      setSending(false);
    }
  };

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

  return (
    <div style={{ flex: 1, minHeight: 0, padding: '2px', display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative' }}>
      
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ─── UNPROCESSED INVOICE WARNING POPUP MODAL ─────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {unprocessedWarning.show && !unprocessedWarning.dismissed && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: '1rem'
        }}>
          <div style={{
            background: 'var(--bg-surface, #1e293b)',
            border: '2px solid #f59e0b',
            borderRadius: 'var(--radius-md, 8px)',
            maxWidth: '520px',
            width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)',
            overflow: 'hidden',
            animation: 'fadeIn 0.2s ease-out'
          }}>
            {/* Modal Header */}
            <div style={{
              background: 'rgba(245, 158, 11, 0.15)',
              borderBottom: '1px solid rgba(245, 158, 11, 0.35)',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <div style={{
                background: '#f59e0b',
                color: '#000',
                borderRadius: '50%',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
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

            {/* Modal Body */}
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main, #f8fafc)' }}>
                Some invoices for <span style={{ color: '#f59e0b' }}>{unprocessedWarning.ownerName}</span> are still unprocessed.
              </p>

              <div style={{
                background: 'var(--bg-secondary, #0f172a)',
                border: '1px solid var(--border-subtle, #334155)',
                borderRadius: 'var(--radius-sm, 6px)',
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Profile Owner:</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{unprocessedWarning.ownerName}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Invoice Month:</span>
                  <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{formatMonthDisplay(cleanMonth)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Pending Unprocessed:</span>
                  <span style={{ fontWeight: 800, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>
                    {unprocessedWarning.count} invoice(s) ({unprocessedWarning.usd > 0 ? `$${Math.round(unprocessedWarning.usd).toLocaleString()}` : 'pending'})
                  </span>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                Email View and Excel attachments include <strong>only processed invoices</strong>. To include these pending invoices in this owner's email, please process them in Excel Sheet View / Unprocessed.
              </p>
            </div>

            {/* Modal Actions */}
            <div style={{
              padding: '12px 16px',
              background: 'var(--bg-secondary, #0f172a)',
              borderTop: '1px solid var(--border-subtle, #334155)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '8px'
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
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>Go to Unprocessed Invoices</span>
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Compact Top Filter Toolbar ─── */}
      <div className="compact-toolbar" style={{ minHeight: '30px', padding: '2px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '0.70rem', fontWeight: 800, color: 'var(--accent-primary, #6366f1)', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Mail size={13} />
              <span>Email:</span>
            </span>
            <div style={{ width: '220px' }}>
              <OwnerSearchSelect
                owners={groupOwners}
                value={ownerCode}
                onChange={val => {
                  setOwnerCode(val);
                  if (onOwnerChange) onOwnerChange(val);
                  setFieldErrors(prev => ({ ...prev, owner: '' }));
                  setSuccessMsg(null);
                }}
                allowAll={false}
                placeholder="Select Owner..."
                compact={true}
              />
            </div>
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
                setFieldErrors(prev => ({ ...prev, month: '' }));
                setSuccessMsg(null);
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
              onClick={() => {
                loadOwnerProcessedInvoices();
                checkOwnerUnprocessedStatus();
              }}
              disabled={loadingProcessed}
              title="Refresh processed invoices for this owner"
              style={{
                height: '24px',
                padding: '0 6px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                cursor: loadingProcessed ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '0.7rem',
                color: 'var(--text-muted)'
              }}
            >
              <RefreshCw size={11} className={loadingProcessed ? 'spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>

          {/* Owner Processed summary pill */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.72rem',
            padding: '2px 8px',
            borderRadius: '12px',
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            color: 'var(--text-main)'
          }}>
            <span>Owner: <strong>{activeOwnerName}</strong></span>
            <span style={{ color: 'var(--text-subtle)' }}>•</span>
            <span>Processed: <strong>{ownerTotals.count}</strong> invoices</span>
            <span style={{ color: 'var(--text-subtle)' }}>•</span>
            <span style={{ color: '#10b981', fontWeight: 800 }}>${Math.round(ownerTotals.usd).toLocaleString()}</span>
          </div>

          {/* Pending Unprocessed indicator badge if any */}
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
              <span>{unprocessedWarning.count} Unprocessed Pending (Click to Process)</span>
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
              background: 'var(--accent-primary)',
              opacity: (sending || !ownerCode || !cleanMonth || displayRows.length === 0) ? 0.6 : 1,
              cursor: (sending || !ownerCode || !cleanMonth || displayRows.length === 0) ? 'not-allowed' : 'pointer'
            }}
          >
            <Send size={12} className={sending ? 'spin' : ''} />
            <span>{sending ? 'Sending...' : 'Send Invoice Email'}</span>
          </button>
        </div>
      </div>

      {/* ─── Compact Notifications ─── */}
      {processedError && (
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
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
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
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <CheckCircle2 size={13} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* ─── Main 2-Panel Content Layout (Strictly for Selected Owner) ─── */}
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
                title={isSelectedMode ? "Download Excel containing selected invoices" : "Download Excel containing only this owner's processed invoices"}
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
                  {isSelectedMode ? `No Selected Invoices for ${activeOwnerName}` : `No Processed Invoices for ${activeOwnerName}`}
                </h5>
                <p style={{ margin: '0 0 12px', fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {unprocessedWarning.count > 0 ? (
                    <span>This owner currently has <strong>{unprocessedWarning.count} unprocessed invoice(s)</strong> waiting to be saved.</span>
                  ) : (
                    <span>{isSelectedMode ? 'No invoices selected from Excel View.' : `No processed invoices found for ${formatMonthDisplay(cleanMonth)}.`}</span>
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
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span>Process Pending Rows</span>
                    <ArrowRight size={12} />
                  </button>
                )}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)', position: 'sticky', top: 0, zIndex: 1 }}>
                    <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--text-muted)', width: '55px' }}>Code</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--text-muted)' }}>Project</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--text-muted)', width: '85px' }}>Stack</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--text-muted)' }}>Invoice To</th>
                    <th style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-muted)', width: '75px' }}>USD</th>
                    <th style={{ textAlign: 'center', padding: '4px 6px', color: 'var(--text-muted)', width: '65px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((r: any) => (
                    <tr key={r.cmpProfInvoiceCode} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)', color: 'var(--text-subtle)' }}>
                        #{r.cmpProfInvoiceCode}
                      </td>
                      <td style={{ padding: '4px 6px', fontWeight: 600, color: 'var(--text-main)' }}>
                        {r.projectName || '—'}
                      </td>
                      <td style={{ padding: '4px 6px', color: 'var(--text-muted)' }}>
                        {r.stack || '—'}
                      </td>
                      <td style={{ padding: '4px 6px', color: 'var(--text-muted)' }}>
                        {r.invoiceToName || r.profileName || '—'}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#10b981' }}>
                        ${Math.round(r.chargedAmtUsd ?? r.finalUsd ?? r.totalCost ?? 0).toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'center', padding: '4px 6px' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '2px',
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          color: '#10b981',
                          background: 'rgba(16, 185, 129, 0.12)',
                          padding: '1px 5px',
                          borderRadius: '3px'
                        }}>
                          <Check size={9} /> {r.isProcessed ? 'Processed' : 'Selected'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Table Footer with Totals */}
          {displayRows.length > 0 && (
            <div style={{
              padding: '4px 8px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.72rem'
            }}>
              <span style={{ color: 'var(--text-muted)' }}>
                {isSelectedMode ? 'Total Selected Records:' : 'Total Processed Records:'} <strong>{ownerTotals.count}</strong>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Amount:</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 900, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                  ${Math.round(ownerTotals.usd).toLocaleString()} USD
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ═════════ RIGHT PANE: Email Composer & Attachment Review ═════════ */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-secondary)',
          padding: '8px',
          overflowY: 'auto'
        }}>

          {/* Recipient Attachment Banner with Direct Review Button */}
          <div style={{
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
              <Paperclip size={13} color="#818cf8" />
              <FileSpreadsheet size={13} color="#10b981" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {attachmentFilename || 'Select an owner and month'}
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-subtle)' }}>
                  {displayRows.length > 0
                    ? `Contains only ${displayRows.length} ${isSelectedMode ? 'selected' : 'processed'} records for ${activeOwnerName}`
                    : 'Excel attachment'}
                </div>
              </div>
            </div>

            {ownerCode && (
              <button
                onClick={handleReviewAttachment}
                disabled={downloadingExcel || displayRows.length === 0}
                className="btn-secondary"
                style={{
                  height: '24px',
                  padding: '0 8px',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  cursor: (downloadingExcel || processedRows.length === 0) ? 'not-allowed' : 'pointer',
                  opacity: (downloadingExcel || processedRows.length === 0) ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: 'var(--bg-surface)'
                }}
              >
                <Download size={11} className={downloadingExcel ? 'spin' : ''} />
                <span>{downloadingExcel ? 'Generating...' : 'Review / Download Attachment'}</span>
              </button>
            )}
          </div>

          {/* Recipient To Email */}
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.2rem', fontWeight: 700, textTransform: 'uppercase' }}>
              To (Recipient Email) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="email"
              value={toEmail}
              onChange={e => {
                setToEmail(e.target.value);
                setFieldErrors(prev => ({ ...prev, toEmail: '' }));
                setSuccessMsg(null);
              }}
              placeholder="recipient@example.com"
              style={inputStyle(!!fieldErrors.toEmail)}
            />
            {fieldErrors.toEmail && (
              <span style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: '0.15rem', display: 'block' }}>{fieldErrors.toEmail}</span>
            )}
          </div>

          {/* Reply-To Email */}
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.2rem', fontWeight: 700, textTransform: 'uppercase' }}>
              Reply-To <span style={{ fontSize: '0.68rem', fontWeight: 400, color: 'var(--text-subtle)' }}>(Optional)</span>
            </label>
            <input
              type="email"
              value={replyToEmail}
              onChange={e => {
                setReplyToEmail(e.target.value);
                setFieldErrors(prev => ({ ...prev, replyToEmail: '' }));
                setSuccessMsg(null);
              }}
              placeholder="billing@example.com (replies come here)"
              style={inputStyle(!!fieldErrors.replyToEmail)}
            />
            {fieldErrors.replyToEmail && (
              <span style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: '0.15rem', display: 'block' }}>{fieldErrors.replyToEmail}</span>
            )}
          </div>

          {/* Subject */}
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.2rem', fontWeight: 700, textTransform: 'uppercase' }}>
              Subject <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => {
                setSubject(e.target.value);
                setFieldErrors(prev => ({ ...prev, subject: '' }));
                setSuccessMsg(null);
              }}
              placeholder={`Profile Invoice – ${activeOwnerName} – ${formatMonthDisplay(cleanMonth)}`}
              style={inputStyle(!!fieldErrors.subject)}
            />
            {fieldErrors.subject && (
              <span style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: '0.15rem', display: 'block' }}>{fieldErrors.subject}</span>
            )}
          </div>

          {/* Sender Settings Panel */}
          <div style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-surface)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '4px 8px',
              background: 'rgba(99,102,241,0.06)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}>
              <KeyRound size={12} color="#818cf8" />
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Sender Settings
              </span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-subtle)' }}>
                (Optional – leave blank for system default)
              </span>
            </div>

            <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {!loadingSettings && hasSavedSettings && !showChangeForm ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: 'rgba(16,185,129,0.1)',
                    border: '1px solid rgba(16,185,129,0.3)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '3px 7px',
                    flex: 1,
                    minWidth: 0
                  }}>
                    <Check size={12} color="#10b981" />
                    <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600 }}>Saved:</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {savedSenderEmail}
                    </span>
                    <span style={{
                      fontSize: '0.65rem',
                      background: 'rgba(16,185,129,0.2)',
                      color: '#10b981',
                      padding: '0.05rem 0.35rem',
                      borderRadius: '3px',
                      fontWeight: 600
                    }}>
                      Password Saved
                    </span>
                  </div>
                  <button
                    onClick={() => { setShowChangeForm(true); setSenderEmail(savedSenderEmail ?? ''); }}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '2px 7px',
                      fontSize: '0.7rem',
                      color: 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    Change
                  </button>
                  <button
                    onClick={handleRemoveSettings}
                    disabled={removingSettings}
                    style={{
                      background: 'transparent',
                      border: '1px solid rgba(239,68,68,0.4)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '2px 7px',
                      fontSize: '0.7rem',
                      color: '#ef4444',
                      cursor: removingSettings ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.2rem'
                    }}
                  >
                    <X size={11} />
                    {removingSettings ? '...' : 'Remove'}
                  </button>
                </div>
              ) : (
                <>
                  {showChangeForm && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => { setShowChangeForm(false); setSenderEmail(''); setAppPassword(''); }}
                        style={{ background: 'transparent', border: 'none', fontSize: '0.7rem', color: 'var(--text-subtle)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                      >
                        <X size={11} /> Cancel change
                      </button>
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.2rem', fontWeight: 600 }}>
                        Sender Email
                      </label>
                      <input
                        type="email"
                        value={senderEmail}
                        autoComplete="off"
                        onChange={e => {
                          setSenderEmail(e.target.value);
                          setFieldErrors(prev => ({ ...prev, senderEmail: '' }));
                          setSuccessMsg(null);
                        }}
                        placeholder="youremail@gmail.com"
                        style={inputStyle(!!fieldErrors.senderEmail)}
                      />
                      {fieldErrors.senderEmail && (
                        <span style={{ fontSize: '0.68rem', color: '#ef4444', marginTop: '0.1rem', display: 'block' }}>{fieldErrors.senderEmail}</span>
                      )}
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.2rem', fontWeight: 600 }}>
                        App Password
                      </label>
                      <input
                        type="password"
                        value={appPassword}
                        autoComplete="new-password"
                        onChange={e => {
                          setAppPassword(e.target.value);
                          setFieldErrors(prev => ({ ...prev, appPassword: '' }));
                          setSuccessMsg(null);
                        }}
                        placeholder="Gmail app password"
                        style={inputStyle(!!fieldErrors.appPassword)}
                      />
                      {fieldErrors.appPassword && (
                        <span style={{ fontSize: '0.68rem', color: '#ef4444', marginTop: '0.1rem', display: 'block' }}>{fieldErrors.appPassword}</span>
                      )}
                    </div>
                  </div>

                  {(senderEmail.trim() || showChangeForm) && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      <input
                        type="checkbox"
                        checked={rememberSettings}
                        onChange={e => setRememberSettings(e.target.checked)}
                        style={{ width: '13px', height: '13px', cursor: 'pointer' }}
                      />
                      <Save size={11} color="#818cf8" />
                      Remember settings (saved on successful send)
                    </label>
                  )}

                  <p style={{ margin: 0, fontSize: '0.67rem', color: 'var(--text-subtle)', lineHeight: 1.35 }}>
                    For Gmail: Use an <strong>App Password</strong> from Google Account → Security → 2-Step Verification.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Message Body */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '160px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                Message Body <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <span style={{ fontSize: '0.67rem', color: 'var(--text-subtle)' }}>
                Excel attachment is automatically attached
              </span>
            </div>

            <textarea
              value={body}
              onChange={e => {
                setBody(e.target.value);
                setFieldErrors(prev => ({ ...prev, body: '' }));
                setSuccessMsg(null);
              }}
              placeholder="Dear Sir/Madam..."
              style={{
                ...inputStyle(!!fieldErrors.body),
                flex: 1,
                minHeight: '150px',
                resize: 'vertical',
                lineHeight: 1.5,
                fontFamily: 'inherit'
              }}
            />
            {fieldErrors.body && (
              <span style={{ fontSize: '0.7rem', color: '#ef4444', display: 'block' }}>{fieldErrors.body}</span>
            )}
          </div>

          {/* Bottom Actions Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Sending for: <strong>{activeOwnerName}</strong>
              </span>
              {emailSent && (
                <span style={{
                  fontSize: '0.68rem',
                  color: '#10b981',
                  background: 'rgba(16, 185, 129, 0.1)',
                  padding: '1px 6px',
                  borderRadius: '3px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px'
                }}>
                  <Check size={10} /> Sent
                </span>
              )}
            </div>

            <button
              onClick={handleSend}
              disabled={sending || !ownerCode || !cleanMonth || processedRows.length === 0}
              className="btn-primary"
              style={{
                height: '28px',
                padding: '2px 16px',
                fontSize: '0.75rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: 'var(--accent-primary)',
                opacity: (sending || !ownerCode || !cleanMonth || processedRows.length === 0) ? 0.6 : 1,
                cursor: (sending || !ownerCode || !cleanMonth || processedRows.length === 0) ? 'not-allowed' : 'pointer'
              }}
            >
              <Send size={12} className={sending ? 'spin' : ''} />
              <span>{sending ? 'Sending...' : 'Send Invoice Email'}</span>
            </button>
          </div>

        </div>

      </div>

    </div>
  );
};
