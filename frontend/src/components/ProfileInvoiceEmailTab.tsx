import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useDebounce } from '../hooks/useDebounce';
import {
  Send,
  AlertTriangle,
  FileSpreadsheet,
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
  excelTotalInvoice?: number;
  initialViewMode?: 'list' | 'compose';
  onBackToList?: () => void;
}

function parseEmailList(input: string): string[] {
  if (!input) return [];
  return input
    .split(/[,;\s\r\n]+/)
    .map(e => e.trim())
    .filter(Boolean);
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
  selectedRowsPreview,
  excelTotalInvoice,
  initialViewMode,
  onBackToList
}) => {
  const [month, setMonth] = useState<string>(
    (initialMonth || 'OCT26').replace('-', '').toUpperCase()
  );
  const cleanMonth = month.trim().replace('-', '').toUpperCase();

  // Mode: 'list' (default: show processed profiles with Email buttons) OR 'compose' (email compose form)
  const isSelectedMode = Boolean(selectedCodes && selectedCodes.length > 0);
  const [viewMode, setViewMode] = useState<'list' | 'compose'>(() => {
    if (initialViewMode) return initialViewMode;
    return isSelectedMode ? 'compose' : 'list';
  });

  const [ownerCode, setOwnerCode] = useState<number | ''>(initialOwnerCode);

  useEffect(() => {
    if (initialViewMode) setViewMode(initialViewMode);
  }, [initialViewMode]);

  // Sync props from parent
  useEffect(() => {
    if (initialOwnerCode !== undefined && initialOwnerCode !== '') {
      setOwnerCode(initialOwnerCode);
      if (isSelectedMode || initialViewMode === 'compose') {
        setViewMode('compose');
      }
    }
  }, [initialOwnerCode, isSelectedMode, initialViewMode]);

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
  const debouncedSearch = useDebounce(search, 150);

  // Persisted emailed status map per month
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
    loadProcessedProfiles();
  }, [cleanMonth, loadProcessedProfiles]);

  const filteredProfiles = useMemo(() => {
    const list = processedProfiles.filter(p => {
      if (!debouncedSearch.trim()) return true;
      const q = debouncedSearch.trim().toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      const text = `${p.ownerName || ''} ${p.ownerCode} ${p.month || ''}`.toLowerCase();
      return words.every(w => text.includes(w));
    });

    // Partition: Un-emailed (Pending) at the top, Already Emailed at the bottom
    return [...list].sort((a, b) => {
      const aEmailed = Boolean(emailedOwners[String(a.ownerCode)]);
      const bEmailed = Boolean(emailedOwners[String(b.ownerCode)]);
      if (aEmailed !== bEmailed) {
        return aEmailed ? 1 : -1; // un-emailed first!
      }
      return (a.ownerName || '').localeCompare(b.ownerName || '');
    });
  }, [processedProfiles, debouncedSearch, emailedOwners]);

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
  const [withTotalCost, setWithTotalCost] = useState<boolean>(false);
  const [withTotalInvoice, setWithTotalInvoice] = useState<boolean>(true);

  const [toEmails, setToEmails] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState<string>('');

  const [ccInput, setCcInput] = useState<string>('');
  const [bccInput, setBccInput] = useState<string>('');

  const toEmail = useMemo(() => {
    const list = [...toEmails];
    if (recipientInput.trim()) {
      const extra = parseEmailList(recipientInput);
      for (const e of extra) {
        if (!list.includes(e)) list.push(e);
      }
    }
    return list.join(', ');
  }, [toEmails, recipientInput]);

  const ccEmail = useMemo(() => {
    return parseEmailList(ccInput).join(', ');
  }, [ccInput]);

  const bccEmail = useMemo(() => {
    return parseEmailList(bccInput).join(', ');
  }, [bccInput]);

  const [replyToEmail, setReplyToEmail] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');

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
    setToEmails(parseEmailList(cachedEmail));
    setRecipientInput('');
    setCcInput('');
    setBccInput('');

    const isAlreadyEmailed = Boolean(emailedOwners[String(ownerCode)]);
    setWithTotalInvoice(!isAlreadyEmailed);
    setWithTotalCost(false);

    const monthFormatted = formatMonthDisplay(cleanMonth);
    setSubject(`Profile Invoice – ${activeOwnerName} – ${monthFormatted}`);

    setBody(
      `Dear ${activeOwnerName},\n\n` +
      `Please find attached your ${isSelectedMode ? 'selected' : 'processed'} profile invoice for ${monthFormatted}.\n\n` +
      `Please review the attached Excel workbook for complete line-item breakdown.\n\n` +
      `Regards,\n` +
      `Rizviz Invoicing Team`
    );
    setFieldErrors({});
  }, [ownerCode, cleanMonth, activeOwnerName, isSelectedMode, viewMode, emailedOwners]);

  const ownerTotals = useMemo(() => {
    // Total Invoice from Excel Sheet View as single source of truth
    const isCurrentExcelOwner = !ownerCode || ownerCode === initialOwnerCode;
    const usd = (isCurrentExcelOwner && excelTotalInvoice !== undefined)
      ? excelTotalInvoice
      : (activeOwnerProfile?.totalInvoice != null
          ? activeOwnerProfile.totalInvoice
          : (excelTotalInvoice !== undefined ? excelTotalInvoice : 0));
    const count = activeOwnerProfile ? activeOwnerProfile.rowsCount : displayRows.length;
    const cost = activeOwnerProfile?.totalCost != null
      ? activeOwnerProfile.totalCost
      : displayRows.reduce((acc, r: any) => acc + (r.totalCost ?? 0), 0);
    return { count, usd, cost };
  }, [activeOwnerProfile, displayRows, excelTotalInvoice, ownerCode, initialOwnerCode]);

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
        isSelectedMode ? true : false,
        withTotalCost
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



    if (replyToEmail.trim() && !validateEmail(replyToEmail)) errs.replyToEmail = 'Enter a valid email address.';
    const parsedRecipients = parseEmailList(toEmail);
    if (parsedRecipients.length === 0) {
      errs.toEmail = 'At least one recipient email address is required.';
    } else {
      const invalid = parsedRecipients.filter(e => !validateEmail(e));
      if (invalid.length > 0) {
        errs.toEmail = `Invalid email address${invalid.length > 1 ? 'es' : ''}: ${invalid.join(', ')}`;
      }
    }

    if (ccEmail.trim()) {
      const parsedCc = parseEmailList(ccEmail);
      const invalidCc = parsedCc.filter(e => !validateEmail(e));
      if (invalidCc.length > 0) {
        errs.ccEmail = `Invalid CC email${invalidCc.length > 1 ? 's' : ''}: ${invalidCc.join(', ')}`;
      }
    }

    if (bccEmail.trim()) {
      const parsedBcc = parseEmailList(bccEmail);
      const invalidBcc = parsedBcc.filter(e => !validateEmail(e));
      if (invalidBcc.length > 0) {
        errs.bccEmail = `Invalid BCC email${invalidBcc.length > 1 ? 's' : ''}: ${invalidBcc.join(', ')}`;
      }
    }

    if (!subject.trim()) errs.subject = 'Subject is required.';
    if (!body.trim()) errs.body = 'Message body is required.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSend = async () => {
    setSuccessMsg(null);
    setErrorMsg(null);
    if (!validate() || !ownerCode) return;

    try {
      setSending(true);
      localStorage.setItem(`profile_invoice_email_recipient_${ownerCode}`, toEmail.trim());

      const result = await api.sendProfileInvoiceEmail({
        groupOwnerCode: Number(ownerCode),
        month: cleanMonth,
        replyToEmail: replyToEmail.trim() || undefined,
        toEmail: toEmail.trim(),
        ccEmail: ccEmail.trim() || undefined,
        bccEmail: bccEmail.trim() || undefined,
        subject: subject.trim(),
        body: body.trim(),
        processedOnly: isSelectedMode ? false : true,
        excludeToBeDiscussed: true,
        specificCodes: isSelectedMode && selectedCodes && selectedCodes.length > 0 ? selectedCodes : undefined,
        withTotalCost: withTotalCost
      });

      if (result.success) {
        setSuccessMsg(result.message || `Invoice email sent successfully to ${toEmail.trim()}!`);
        setFieldErrors({});

        // Persist emailed status for this owner & month
        if (ownerCode) {
          const updated = {
            ...getEmailedOwnersMap(),
            [String(ownerCode)]: {
              emailedAt: new Date().toISOString(),
              toEmail: toEmail.trim()
            }
          };
          try {
            localStorage.setItem(`profile_invoice_emailed_${cleanMonth}`, JSON.stringify(updated));
            setEmailedOwners(updated);
          } catch (e) {
            console.error('Failed to save emailed state', e);
          }
        }



        // Return to processed profiles list after successful send
        setTimeout(() => {
          if (onBackToList) {
            onBackToList();
          } else {
            setViewMode('list');
            setOwnerCode('');
            loadProcessedProfiles();
          }
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
            <table className="compact-table email-list-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'center', width: '40px' }}>#</th>
                  <th style={{ minWidth: '220px', textAlign: 'left' }}>Profile Owner Name</th>
                  <th style={{ minWidth: '130px', textAlign: 'right' }}>Total Invoice</th>
                  <th style={{ minWidth: '140px', textAlign: 'center' }}>Emailed</th>
                  <th style={{ minWidth: '100px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      <Mail size={24} style={{ color: 'var(--text-subtle)', margin: '0 auto 8px', display: 'block' }} />
                      {search ? `No processed profiles matching "${search}".` : 'Koi processed invoice nahi.'}
                    </td>
                  </tr>
                ) : (
                  filteredProfiles.map((p, i) => {
                    const isEmailed = Boolean(emailedOwners[String(p.ownerCode)]);
                    const emailInfo = emailedOwners[String(p.ownerCode)];
                    return (
                      <tr
                        key={p.ownerCode}
                        className="table-row-hover"
                        style={{
                          background: isEmailed ? 'rgba(16, 185, 129, 0.03)' : undefined
                        }}
                      >
                        <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                          {i + 1}
                        </td>
                        <td style={{ fontWeight: 600 }}>{p.ownerName}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#2563eb' }}>
                          {fmtUsd(p.totalInvoice != null ? p.totalInvoice : 0)}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {isEmailed ? (
                            <div 
                              title={`Emailed to ${emailInfo?.toEmail || 'recipient'}${emailInfo?.emailedAt ? ` on ${new Date(emailInfo.emailedAt).toLocaleDateString()}` : ''}`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                background: 'rgba(16, 185, 129, 0.12)',
                                border: '1.5px solid #10b981',
                                color: '#059669',
                                borderRadius: '5px',
                                padding: '2px 8px',
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                boxShadow: '0 1px 3px rgba(16, 185, 129, 0.12)'
                              }}
                            >
                              <CheckCircle2 size={13} color="#10b981" />
                              <span>Already Emailed</span>
                            </div>
                          ) : (
                            <div style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              background: 'rgba(100, 116, 139, 0.08)',
                              border: '1px dashed rgba(100, 116, 139, 0.35)',
                              color: 'var(--text-muted)',
                              borderRadius: '5px',
                              padding: '2px 8px',
                              fontSize: '0.70rem',
                              fontWeight: 600
                            }}>
                              <span>Not Emailed</span>
                            </div>
                          )}
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
                              height: '24px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              background: isEmailed ? 'var(--bg-surface)' : '#2563eb',
                              color: isEmailed ? 'var(--text-main)' : '#ffffff',
                              border: isEmailed ? '1px solid var(--border-medium)' : 'none',
                              borderRadius: 'var(--radius-sm)',
                              cursor: 'pointer',
                              boxShadow: isEmailed ? 'none' : '0 1px 2px rgba(0,0,0,0.1)'
                            }}
                            title={isEmailed ? `Re-send invoice email for ${p.ownerName}` : `Compose invoice email for ${p.ownerName}`}
                          >
                            <Mail size={12} />
                            <span>{isEmailed ? 'Re-send' : 'Send Email'}</span>
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
              if (onBackToList) {
                onBackToList();
              } else {
                setViewMode('list');
              }
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
            {withTotalInvoice && (
              <>
                <span style={{ color: 'var(--text-subtle)' }}>•</span>
                <span style={{ color: 'var(--excel-actual-color)', fontWeight: 800 }}>${Math.round(ownerTotals.usd).toLocaleString()}</span>
              </>
            )}
          </div>

          {/* Already Emailed Badge */}
          {Boolean(emailedOwners[String(ownerCode)]) && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '2px 10px',
              borderRadius: '12px',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1.5px solid #10b981',
              color: '#059669',
              fontSize: '0.74rem',
              fontWeight: 800
            }}>
              <CheckCircle2 size={13} color="#10b981" />
              <span>Already Emailed{emailedOwners[String(ownerCode)]?.toEmail ? ` to ${emailedOwners[String(ownerCode)].toEmail}` : ''}{emailedOwners[String(ownerCode)]?.emailedAt ? ` (${new Date(emailedOwners[String(ownerCode)].emailedAt).toLocaleDateString()})` : ''}</span>
            </div>
          )}

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

      {/* Already Emailed Info Banner */}
      {Boolean(emailedOwners[String(ownerCode)]) && (
        <div style={{
          padding: '0.35rem 0.75rem',
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.35)',
          borderRadius: 'var(--radius-sm)',
          color: '#059669',
          fontSize: '0.74rem',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: '0.45rem'
        }}>
          <CheckCircle2 size={14} color="#10b981" />
          <span>Already Emailed: This invoice was previously sent{emailedOwners[String(ownerCode)]?.toEmail ? ` to ${emailedOwners[String(ownerCode)].toEmail}` : ''}{emailedOwners[String(ownerCode)]?.emailedAt ? ` on ${new Date(emailedOwners[String(ownerCode)].emailedAt).toLocaleDateString()}` : ''}. You are viewing re-send mode.</span>
        </div>
      )}

      {/* ─── Main 2-Panel Content Layout ─── */}
      <div className="email-compose-grid">

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

            {/* Checkboxes: With Total Cost & With Total Invoice */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: withTotalCost ? '#2563eb' : 'var(--text-muted)',
                background: withTotalCost ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                border: withTotalCost ? '1px solid rgba(37, 99, 235, 0.3)' : '1px solid transparent',
                borderRadius: '4px',
                padding: '2px 6px',
                userSelect: 'none'
              }}
              title="Tick to show Total Cost"
              >
                <input
                  type="checkbox"
                  checked={withTotalCost}
                  onChange={e => setWithTotalCost(e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: '#2563eb' }}
                />
                <span>With Total Cost</span>
              </label>

              <label style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: withTotalInvoice ? '#2563eb' : 'var(--text-muted)',
                background: withTotalInvoice ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                border: withTotalInvoice ? '1px solid rgba(37, 99, 235, 0.3)' : '1px solid transparent',
                borderRadius: '4px',
                padding: '2px 6px',
                userSelect: 'none'
              }}
              title="Tick to show Total Invoice"
              >
                <input
                  type="checkbox"
                  checked={withTotalInvoice}
                  onChange={e => setWithTotalInvoice(e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: '#2563eb' }}
                />
                <span>With Total Invoice</span>
              </label>
            </div>
          </div>

          {/* Processed Invoices Table */}
          <div style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
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
              <table className="compact-table compose-table" style={{ width: '100%', minWidth: 0, tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ width: '38px', textAlign: 'center' }}>#</th>
                    <th style={{ textAlign: 'left' }}>Recipient</th>
                    {withTotalCost && (
                      <th style={{ width: '100px', textAlign: 'right', color: 'var(--excel-cost-color, #f59e0b)' }}>Total Cost</th>
                    )}
                    {withTotalInvoice && (
                      <th style={{ width: withTotalCost ? '105px' : '130px', textAlign: 'right' }}>Total Invoice</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>1</td>
                    <td style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeOwnerName || '-'}</td>
                    {withTotalCost && (
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.88rem', color: 'var(--excel-cost-color, #f59e0b)', whiteSpace: 'nowrap' }}>
                        {fmtUsd(ownerTotals.cost)}
                      </td>
                    )}
                    {withTotalInvoice && (
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.90rem', color: 'var(--excel-actual-color)', whiteSpace: 'nowrap' }}>
                        ${Math.round(ownerTotals.usd).toLocaleString()}
                      </td>
                    )}
                  </tr>
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
          {/* Recipient - Multi-email Gmail style */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                To (Recipient Email) <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {toEmails.length > 0 && (
                  <>
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--accent-primary)', background: 'rgba(99, 102, 241, 0.1)', padding: '1px 6px', borderRadius: '10px' }}>
                      {toEmails.length} recipient{toEmails.length !== 1 ? 's' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setToEmails([]);
                        setRecipientInput('');
                        setFieldErrors(prev => ({ ...prev, toEmail: '' }));
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-subtle)',
                        fontSize: '0.66rem',
                        cursor: 'pointer',
                        textDecoration: 'underline'
                      }}
                    >
                      Clear all
                    </button>
                  </>
                )}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 8px',
                background: 'var(--bg-surface)',
                border: fieldErrors.toEmail ? '1.5px solid #ef4444' : '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                minHeight: '38px',
                boxSizing: 'border-box',
                cursor: 'text'
              }}
              onClick={(e) => {
                const target = e.currentTarget.querySelector('input');
                if (target) target.focus();
              }}
            >
              {toEmails.map((email, idx) => {
                const isValid = validateEmail(email);
                return (
                  <span
                    key={`${email}-${idx}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: isValid ? 'rgba(99, 102, 241, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                      color: isValid ? 'var(--text-main)' : '#dc2626',
                      border: `1px solid ${isValid ? 'rgba(99, 102, 241, 0.3)' : 'rgba(239, 68, 68, 0.4)'}`,
                      padding: '2px 8px',
                      borderRadius: '16px',
                      fontSize: '0.74rem',
                      fontWeight: 600,
                      maxWidth: '100%',
                      wordBreak: 'break-all'
                    }}
                  >
                    <Mail size={11} color={isValid ? '#6366f1' : '#dc2626'} style={{ flexShrink: 0 }} />
                    <span>{email}</span>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setToEmails(prev => prev.filter((_, i) => i !== idx));
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        marginLeft: '2px'
                      }}
                      title="Remove recipient"
                    >
                      <X size={12} />
                    </button>
                  </span>
                );
              })}

              <input
                type="text"
                value={recipientInput}
                onChange={e => {
                  const val = e.target.value;
                  if (val.includes(',') || val.includes(';') || val.includes('\n')) {
                    const added = parseEmailList(val);
                    setToEmails(prev => Array.from(new Set([...prev, ...added])));
                    setRecipientInput('');
                  } else {
                    setRecipientInput(val);
                  }
                  setFieldErrors(prev => ({ ...prev, toEmail: '' }));
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
                    if (recipientInput.trim()) {
                      e.preventDefault();
                      const added = parseEmailList(recipientInput);
                      setToEmails(prev => Array.from(new Set([...prev, ...added])));
                      setRecipientInput('');
                      setFieldErrors(prev => ({ ...prev, toEmail: '' }));
                    }
                  } else if (e.key === 'Backspace' && !recipientInput && toEmails.length > 0) {
                    setToEmails(prev => prev.slice(0, -1));
                  }
                }}
                onPaste={e => {
                  const pasted = e.clipboardData.getData('text');
                  if (pasted.includes(',') || pasted.includes(';') || pasted.includes('\n') || pasted.includes(' ')) {
                    e.preventDefault();
                    const added = parseEmailList(pasted);
                    if (added.length > 0) {
                      setToEmails(prev => Array.from(new Set([...prev, ...added])));
                      setRecipientInput('');
                      setFieldErrors(prev => ({ ...prev, toEmail: '' }));
                    }
                  }
                }}
                placeholder={toEmails.length === 0 ? "Enter recipient emails (comma separated, paste multiple, or press Enter)..." : "Add more recipients..."}
                style={{
                  flex: 1,
                  minWidth: '180px',
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: 'var(--text-main)',
                  fontSize: '0.80rem',
                  padding: '3px 0'
                }}
              />
            </div>

            {fieldErrors.toEmail && (
              <span style={{ fontSize: '0.68rem', color: '#ef4444', display: 'block', marginTop: '2px' }}>
                {fieldErrors.toEmail}
              </span>
            )}
            <span style={{ fontSize: '0.65rem', color: 'var(--text-subtle)', display: 'block', marginTop: '2px' }}>
              Tip: You can add multiple recipients separated by commas, paste a list, or press Enter after each email.
            </span>
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

          {/* Cc (Optional) */}
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px' }}>
              Cc (Optional)
            </label>
            <input
              type="text"
              value={ccInput}
              onChange={e => {
                setCcInput(e.target.value);
                setFieldErrors(prev => ({ ...prev, ccEmail: '' }));
              }}
              placeholder="e.g. manager@rizviz.com, finance@rizviz.com"
              style={inputStyle(!!fieldErrors.ccEmail)}
            />
            {fieldErrors.ccEmail && (
              <span style={{ fontSize: '0.68rem', color: '#ef4444' }}>{fieldErrors.ccEmail}</span>
            )}
          </div>

          {/* Bcc (Optional) */}
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px' }}>
              Bcc (Optional)
            </label>
            <input
              type="text"
              value={bccInput}
              onChange={e => {
                setBccInput(e.target.value);
                setFieldErrors(prev => ({ ...prev, bccEmail: '' }));
              }}
              placeholder="e.g. archive@rizviz.com"
              style={inputStyle(!!fieldErrors.bccEmail)}
            />
            {fieldErrors.bccEmail && (
              <span style={{ fontSize: '0.68rem', color: '#ef4444' }}>{fieldErrors.bccEmail}</span>
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


        </div>
      </div>
    </div>
  );
};