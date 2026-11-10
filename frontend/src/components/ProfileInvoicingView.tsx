import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Search, 
  RefreshCw, 
  AlertTriangle, 
  Check, 
  Save, 
  Play, 
  FileSpreadsheet
} from 'lucide-react';
import { api } from '../api/client';
import type { 
  ProfileInvoiceRowDto, 
  ProfileGroupOwnerDto, 
  UserInfo 
} from '../types';
import { formatMoney, formatCount } from '../utils/format';
import { ProfileInvoiceExcelView } from './ProfileInvoiceExcelView';
import { OwnerSearchSelect } from './OwnerSearchSelect';

const SERVICE_HEAD_MAP: Record<string, string> = {
  'JH': 'Job Holder',
  'SP': 'Support Provider',
  'SL': 'Special',
  'DR': 'Second Resource',
  'BB': 'BD-Commission',
  'BE': 'BD Recurr. Comm. - EXE',
  'BR': 'BD Recurr. Comm. - REG',
  'I1': 'Interview Commission - 1st',
  'J1': 'Interview Commission - 2nd',
  'X1': 'DEV Recurr. Comm.',
  'TZ': 'TimeZone Allowance',
  'BO': 'Bonus',
  'TL': 'TL-Allounce',
  'BS': 'DEV/Marketing',
  'IT': 'Interview',
  'OE': 'Operating Expense',
  'IS': 'Interview Support',
  'C': 'Consultancy',
  'SJ': 'Supporting Job'
};

function formatServiceHead(row: ProfileInvoiceRowDto): string {
  if (row.serviceHeadName && row.serviceHeadName.trim()) {
    return row.serviceHeadName.trim();
  }
  const code = (row.resourceType || (row.chargTypeCode ? String(row.chargTypeCode) : '')).trim();
  if (!code) return '—';
  return SERVICE_HEAD_MAP[code.toUpperCase()] || code;
}

function formatMonthDisplay(m?: string): string {
  if (!m) return '—';
  const clean = m.trim().toUpperCase();
  if (clean.length === 5 && !clean.includes('-')) {
    return `${clean.substring(0, 3)}-${clean.substring(3)}`;
  }
  return clean;
}

interface ProfileInvoicingViewProps {
  user: UserInfo;
  initialMonth?: string;
  onMonthChange?: (month: string) => void;
  navigateTo?: { subTab: 'excel'; excelTab: 'unprocessed'; month?: string } | null;
  onNavigateDone?: () => void;
}

export const ProfileInvoicingView: React.FC<ProfileInvoicingViewProps> = ({
  user,
  initialMonth = 'OCT26',
  onMonthChange,
  navigateTo,
  onNavigateDone
}) => {
  const [groupOwners, setGroupOwners] = useState<ProfileGroupOwnerDto[]>([]);
  const [selectedOwnerCode, setSelectedOwnerCode] = useState<number | ''>('');
  const [monthYear, setMonthYear] = useState<string>(initialMonth.replace('-', '').toUpperCase());
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [monthsLoading, setMonthsLoading] = useState<boolean>(false);

  // Fetch invoiced months from backend (owner-filtered if selected, latest first)
  useEffect(() => {
    const loadMonths = async () => {
      setMonthsLoading(true);
      try {
        const owner = typeof selectedOwnerCode === 'number' && selectedOwnerCode > 0 ? selectedOwnerCode : undefined;
        const list = await api.getInvoicedMonths(owner);
        setAvailableMonths(list);
        if (list.length > 0) {
          setMonthYear(prev => {
            const cur = prev.trim().replace('-', '').toUpperCase();
            if (cur && list.includes(cur)) return cur;
            const initClean = initialMonth ? initialMonth.trim().replace('-', '').toUpperCase() : '';
            if (initClean && list.includes(initClean)) return initClean;
            return list[list.length - 1];
          });
        }
      } catch (err) {
        console.error('Failed to load invoiced months', err);
        setAvailableMonths([]);
      } finally {
        setMonthsLoading(false);
      }
    };
    loadMonths();
  }, [selectedOwnerCode, initialMonth]);

  useEffect(() => {
    if (initialMonth) {
      setMonthYear(initialMonth.replace('-', '').toUpperCase());
    }
  }, [initialMonth]);
  
  // Data state
  const [rows, setRows] = useState<ProfileInvoiceRowDto[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'invoicing' | 'excel'>('invoicing');
  const [initialExcelTab, setInitialExcelTab] = useState<'sheet' | 'audit' | 'unprocessed' | 'discussed' | 'email' | 'processed' | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isMonthFinalized, setIsMonthFinalized] = useState<boolean>(false);
  const [hasConfirmedFinalized, setHasConfirmedFinalized] = useState<boolean>(false);
  
  // Search & Filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');

  // Inline editing state: rowKey -> partial fields
  const [editingRows, setEditingRows] = useState<Record<string, {
    invoiceNumber?: string;
    remarks?: string;
    status?: string;
    totalIncomePkr?: number;
    chargePercent?: number;
    exchangeRate?: number;
    arrears?: number;
    shareAmount?: number;
  }>>({});
  const [savingRowId, setSavingRowId] = useState<number | null>(null);
  const [serverTotalUsd, setServerTotalUsd] = useState<number | null>(null);
  const [serverTotalPkr, setServerTotalPkr] = useState<number | null>(null);

  const cleanMonth = monthYear.trim().replace('-', '').toUpperCase();

  const checkFinalized = async (month: string) => {
    try {
      const res = await api.checkProfileMonthFinalized(month);
      setIsMonthFinalized(res.isFinalized);
    } catch {
      setIsMonthFinalized(false);
    }
  };

  useEffect(() => {
    setHasConfirmedFinalized(false);
    if (cleanMonth) {
      checkFinalized(cleanMonth);
    }
  }, [cleanMonth]);

  // Handle external navigation request (e.g. from Company Invoices page)
  useEffect(() => {
    if (!navigateTo) return;
    if (navigateTo.subTab === 'excel') {
      if (navigateTo.month) {
        setMonthYear(navigateTo.month.trim().replace('-', '').toUpperCase());
      }
      setInitialExcelTab(navigateTo.excelTab);
      setActiveSubTab('excel');
    }
    onNavigateDone?.();
  }, [navigateTo]);

  const checkConfirmFinalized = (): boolean => {
    if (!isMonthFinalized || hasConfirmedFinalized) return true;
    const ok = window.confirm("This month has already been finalized. Editing it may affect the final amount. Do you want to continue?");
    if (ok) {
      setHasConfirmedFinalized(true);
      return true;
    }
    return false;
  };

  // Load Group Owners on Mount
  useEffect(() => {
    const fetchGroupOwners = async () => {
      try {
        const owners = await api.getProfileGroupOwners();
        setGroupOwners(owners);
        if (owners.length > 0 && !selectedOwnerCode) {
          setSelectedOwnerCode(owners[0].prfOwnCode);
        }
      } catch (err: any) {
        console.error('Failed to load profile group owners', err);
        setError('Failed to load profile group owners.');
      }
    };
    fetchGroupOwners();
  }, []);

  // 1. Load Saved Invoices
  const handleLoadSaved = async () => {
    if (!selectedOwnerCode) {
      setError('Please select a Profile Group Owner.');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setWarning(null);
      setSuccessMsg(null);
      const data = await api.getSavedProfileInvoices(Number(selectedOwnerCode), cleanMonth);
      setRows(data);
      setServerTotalUsd(null);
      setServerTotalPkr(null);
      if (data.length === 0) {
        setWarning(`No saved invoices found for ${formatMonthDisplay(cleanMonth)}. You can click "Generate Preview (Dry-Run)" to calculate.`);
      } else {
        setSuccessMsg(`Loaded ${data.length} saved invoice row(s).`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load saved invoices');
    } finally {
      setLoading(false);
    }
  };

  // 2. Generate Dry-Run Preview
  const handleGeneratePreview = async () => {
    if (!selectedOwnerCode) {
      setError('Please select a Profile Group Owner.');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setWarning(null);
      setSuccessMsg(null);
      const dryRun = await api.getProfileInvoiceDryRun(Number(selectedOwnerCode), cleanMonth);
      if (dryRun.alreadyExists) {
        setRows([]);
        setServerTotalUsd(null);
        setServerTotalPkr(null);
        setWarning(dryRun.warningMessage || `Invoices already exist for this Profile Group Owner and Month (${cleanMonth}). Duplicate generation stopped.`);
      } else {
        setRows(dryRun.rows);
        setServerTotalUsd(dryRun.totalUsdSum);
        setServerTotalPkr(dryRun.totalPkrSum);
        setSuccessMsg(`Calculated ${dryRun.rows.length} row(s) in preview mode.`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate invoice preview');

    } finally {
      setLoading(false);
    }
  };

  // 3. Save & Post Invoices
  const handleSaveInvoices = async () => {
    if (!selectedOwnerCode) {
      setError('Please select a Profile Group Owner.');
      return;
    }
    if (rows.length === 0) {
      setError('No invoice rows to save. Please generate a preview first.');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to Save & Post ${rows.length} invoice rows for ${formatMonthDisplay(cleanMonth)}?\nOnce posted (status='P'), rows cannot be deleted or re-generated.`
    );
    if (!confirmed) return;

    try {
      setSaving(true);
      setError(null);
      setWarning(null);
      setSuccessMsg(null);
      const result = await api.saveProfileInvoices({
        groupOwnerCode: Number(selectedOwnerCode),
        monthYear: cleanMonth,
        insertedBy: user.username || 'System'
      });

      if (result.success) {
        setSuccessMsg(`Successfully posted ${result.rowsInserted} invoice row(s) (PCOM: ${result.firstPcomCode} - ${result.lastPcomCode})!`);
        // Refresh with saved data
        await handleLoadSaved();
      } else {
        setError(result.errorMessage || 'Failed to save profile invoices.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to post invoices');
    } finally {
      setSaving(false);
    }
  };

  // Inline row field update handlers
  const handleFieldChange = (
    rowKey: string,
    field: 'invoiceNumber' | 'remarks' | 'status' | 'totalIncomePkr' | 'chargePercent' | 'exchangeRate' | 'arrears' | 'shareAmount',
    value: any
  ) => {
    setEditingRows(prev => ({
      ...prev,
      [rowKey]: {
        ...prev[rowKey],
        [field]: value
      }
    }));
  };

  const handleToggleIncluded = async (row: ProfileInvoiceRowDto, checked: boolean) => {
    if (!checkConfirmFinalized()) return;

    const code = row.cmpProfInvoiceCode;
    if (!code) {
      // For preview rows, update locally
      setRows(prev => prev.map(r => r === row ? { ...r, isIncluded: checked } : r));
      return;
    }

    const prevRows = rows;
    const prevUsd = serverTotalUsd;
    const prevPkr = serverTotalPkr;

    try {
      setSavingRowId(code);
      setError(null);
      const res = await api.updateProfileInvoiceRow(code, { isIncluded: checked });
      if (res.updatedRow) {
        setRows(prev => prev.map(r => r.cmpProfInvoiceCode === code ? res.updatedRow! : r));
      } else {
        setRows(prev => prev.map(r => r.cmpProfInvoiceCode === code ? { ...r, isIncluded: checked } : r));
      }
      setServerTotalUsd(res.totalUsdSum);
      setServerTotalPkr(res.totalPkrSum);
    } catch (err: any) {
      setRows(prevRows);
      setServerTotalUsd(prevUsd);
      setServerTotalPkr(prevPkr);
      setError(err.message || 'Failed to update include status.');
    } finally {
      setSavingRowId(null);
    }
  };

  const handleSaveRow = async (row: ProfileInvoiceRowDto, index: number) => {
    if (!checkConfirmFinalized()) return;

    const rowKey = row.cmpProfInvoiceCode ? String(row.cmpProfInvoiceCode) : `idx_${index}`;
    const edits = editingRows[rowKey];
    if (!edits) return;

    if (!row.cmpProfInvoiceCode) {
      // For preview rows, update locally
      setRows(prev => {
        const next = [...prev];
        next[index] = {
          ...next[index],
          ...edits
        };
        return next;
      });
      setSuccessMsg('Row changes updated in preview.');
      return;
    }

    const prevRows = rows;
    const prevUsd = serverTotalUsd;
    const prevPkr = serverTotalPkr;

    try {
      setSavingRowId(row.cmpProfInvoiceCode);
      setError(null);
      const res = await api.updateProfileInvoiceRow(row.cmpProfInvoiceCode, {
        invoiceNumber: edits.invoiceNumber !== undefined ? edits.invoiceNumber : row.invoiceNumber,
        remarks: edits.remarks !== undefined ? edits.remarks : row.remarks,
        status: edits.status !== undefined ? edits.status : row.status,
        totalIncomePkr: edits.totalIncomePkr !== undefined ? edits.totalIncomePkr : row.totalIncomePkr,
        chargePercent: edits.chargePercent !== undefined ? edits.chargePercent : row.chargePercent,
        exchangeRate: edits.exchangeRate !== undefined ? edits.exchangeRate : row.exchangeRate,
        arrears: edits.arrears !== undefined ? edits.arrears : row.arrears,
        shareAmount: edits.shareAmount !== undefined ? edits.shareAmount : row.shareAmount
      });

      if (res.updatedRow) {
        setRows(prev => prev.map(r => r.cmpProfInvoiceCode === row.cmpProfInvoiceCode ? res.updatedRow! : r));
      } else {
        setRows(prev => prev.map(r => r.cmpProfInvoiceCode === row.cmpProfInvoiceCode ? { ...r, ...edits } : r));
      }
      setServerTotalUsd(res.totalUsdSum);
      setServerTotalPkr(res.totalPkrSum);

      // Clear local edit tracking for this row
      setEditingRows(prev => {
        const copy = { ...prev };
        delete copy[rowKey];
        return copy;
      });
      setSuccessMsg(`Updated invoice #${row.cmpProfInvoiceCode} successfully.`);
    } catch (err: any) {
      setRows(prevRows);
      setServerTotalUsd(prevUsd);
      setServerTotalPkr(prevPkr);
      setError(err.message || 'Failed to update row.');
    } finally {
      setSavingRowId(null);
    }
  };

  // Filtered rows (ordered by Stack, then Project)
  const filteredRows = rows.filter(r => {
    if (sourceFilter !== 'ALL' && r.source !== sourceFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (r.invoiceNumber && r.invoiceNumber.toLowerCase().includes(q)) ||
      (r.profileOwnerName && r.profileOwnerName.toLowerCase().includes(q)) ||
      (r.groupOwnerName && r.groupOwnerName.toLowerCase().includes(q)) ||
      (r.entityName && r.entityName.toLowerCase().includes(q)) ||
      (r.secondaryDevName && r.secondaryDevName.toLowerCase().includes(q)) ||
      (r.projectName && r.projectName.toLowerCase().includes(q)) ||
      (r.stack && r.stack.toLowerCase().includes(q)) ||
      (r.invoiceToName && r.invoiceToName.toLowerCase().includes(q)) ||
      (r.remarks && r.remarks.toLowerCase().includes(q))
    );
  }).sort((a, b) => {
    const sA = (a.stack || '').trim();
    const sB = (b.stack || '').trim();
    if (!sA && sB) return 1;
    if (sA && !sB) return -1;
    const cmpStack = sA.localeCompare(sB);
    if (cmpStack !== 0) return cmpStack;
    const pA = (a.projectName || '').trim();
    const pB = (b.projectName || '').trim();
    return pA.localeCompare(pB);
  });

  // Aggregated KPIs (backend server totals take precedence per KAAM 1)
  const displayTotalUsd = serverTotalUsd !== null ? serverTotalUsd : filteredRows.filter(r => r.isIncluded !== false).reduce((sum, r) => sum + (r.chargedAmtUsd || 0), 0);
  const displayTotalPkr = serverTotalPkr !== null ? serverTotalPkr : filteredRows.filter(r => r.isIncluded !== false).reduce((sum, r) => sum + (r.totalIncomePkr || r.chargedAmtPkr || 0), 0);
  const uniqueSources = Array.from(new Set(rows.map(r => r.source).filter(Boolean)));

  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      animation: 'fadeIn 0.25s ease-in-out'
    }}>
      
      {/* Header & Sub-tab Bar */}
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.5rem',
        borderBottom: '1px solid var(--border-subtle)',
        paddingBottom: '3px',
        flexWrap: 'wrap',
        minHeight: '28px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <h1 style={{
            fontSize: '0.95rem',
            fontWeight: 800,
            color: 'var(--text-main)',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem'
          }}>
            <Users size={16} color="var(--accent-primary)" />
            Profile Invoicing
          </h1>

          {/* Month Dropdown in Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginLeft: '0.4rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Month:</span>
            <select
              value={monthYear.trim().replace('-', '').toUpperCase()}
              onChange={(e) => {
                const val = e.target.value;
                setMonthYear(val);
                onMonthChange?.(val);
              }}
              disabled={monthsLoading}
              style={{
                background: 'var(--bg-surface)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 5px',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                height: '24px',
                minWidth: '85px',
                boxSizing: 'border-box'
              }}
            >
              {availableMonths.length === 0 ? (
                <option value="">No invoiced months</option>
              ) : (
                availableMonths.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {activeSubTab === 'excel' && (
            <button
              onClick={() => setActiveSubTab('invoicing')}
              className="compact-tab-btn"
              style={{
                border: '1px solid var(--accent-primary)',
                background: 'var(--accent-primary)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                cursor: 'pointer'
              }}
            >
              <Users size={13} />
              Profile Invoicing
            </button>
          )}
        </div>
      </div>

      {activeSubTab === 'excel' ? (
        <ProfileInvoiceExcelView
          groupOwners={groupOwners}
          initialOwnerCode={selectedOwnerCode}
          initialMonth={monthYear}
          onMonthChange={(m) => {
            setMonthYear(m);
            onMonthChange?.(m);
          }}
          onOwnerChange={setSelectedOwnerCode}
          initialExcelTab={initialExcelTab}
        />
      ) : (
        <>
          {/* Primary Action & Filter Bar */}
          <div className="panel-card" style={{
            padding: '1.25rem',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-start',
            flexWrap: 'wrap',
            gap: '1.25rem'
          }}>
            {/* Dropdowns */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ width: '260px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 600 }}>
                  PROFILE GROUP OWNER
                </label>
                <OwnerSearchSelect
                  owners={groupOwners}
                  value={selectedOwnerCode}
                  onChange={(val) => setSelectedOwnerCode(val)}
                  allowAll={false}
                  placeholder="Select Profile Group Owner..."
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem', fontWeight: 600 }}>
                  INVOICE MONTH (MMMYY)
                </label>
                <select
                  value={monthYear.trim().replace('-', '').toUpperCase()}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMonthYear(val);
                    onMonthChange?.(val);
                  }}
                  disabled={monthsLoading}
                  style={{
                    background: 'var(--bg-surface)',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.55rem 0.85rem',
                    fontSize: '0.875rem',
                    fontFamily: 'var(--font-mono)',
                    minWidth: '120px',
                    height: '38px',
                    boxSizing: 'border-box'
                  }}
                >
                  {availableMonths.length === 0 ? (
                    <option value="">No invoiced months</option>
                  ) : (
                    availableMonths.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))
                  )}
                </select>
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button
                onClick={handleLoadSaved}
                disabled={loading || saving}
                className="btn-secondary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.55rem 1rem',
                  height: '38px',
                  boxSizing: 'border-box',
                  fontSize: '0.875rem',
                  fontWeight: 600
                }}
              >
                <RefreshCw size={16} className={loading ? 'spin' : ''} />
                Load Saved
              </button>

              <button
                onClick={handleGeneratePreview}
                disabled={loading || saving}
                className="btn-primary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.55rem 1rem',
                  height: '38px',
                  boxSizing: 'border-box',
                  fontSize: '0.875rem',
                  fontWeight: 600
                }}
              >
                <Play size={16} />
                Generate Preview (Dry-Run)
              </button>

              <button
                onClick={handleSaveInvoices}
                disabled={loading || saving || rows.length === 0}
                style={{
                  background: '#10b981',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.55rem 1.15rem',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  height: '38px',
                  boxSizing: 'border-box',
                  cursor: (loading || saving || rows.length === 0) ? 'not-allowed' : 'pointer',
                  opacity: (loading || saving || rows.length === 0) ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                <Save size={16} />
                {saving ? 'Posting...' : 'Save & Post Invoices'}
              </button>

              <button
                onClick={() => setActiveSubTab('excel')}
                style={{
                  background: '#6366f1',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.55rem 1.15rem',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  height: '38px',
                  boxSizing: 'border-box',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                }}
                title="Open Excel View"
              >
                <FileSpreadsheet size={16} />
                Excel View
              </button>
            </div>
          </div>

      {/* Notifications */}

      {error && (
        <div style={{
          padding: '0.9rem 1.25rem',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: '#ef4444',
          fontSize: '0.875rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {warning && (
        <div style={{
          padding: '0.9rem 1.25rem',
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: '#f59e0b',
          fontSize: '0.875rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <AlertTriangle size={18} />
          <span>{warning}</span>
        </div>
      )}

      {successMsg && (
        <div style={{
          padding: '0.9rem 1.25rem',
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: '#10b981',
          fontSize: '0.875rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <Check size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Summary KPI Strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem'
      }}>
        <div className="panel-card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Total Charged USD
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
            {formatMoney(displayTotalUsd, 'USD', 'Profile Total USD')}
          </div>
        </div>

        <div className="panel-card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Total PKR
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
            {formatMoney(displayTotalPkr, 'PKR', 'Profile Total PKR')}
          </div>
        </div>

        <div className="panel-card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Total Rows
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#818cf8', fontFamily: 'var(--font-mono)' }}>
            {formatCount(filteredRows.length, 'Filtered Rows')} <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>({formatCount(rows.length, 'Total Rows')} total)</span>
          </div>
        </div>

        <div className="panel-card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Invoice Month
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>
            {formatMonthDisplay(cleanMonth)}
          </div>
        </div>
      </div>

      {/* Grid Filters */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1rem',
        background: 'var(--bg-secondary)',
        padding: '0.85rem 1.25rem',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flex: 1, minWidth: '240px' }}>
          <Search size={18} color="var(--text-subtle)" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by invoice #, owner, entity, secondary dev, project, vendor..."
            style={{ width: '100%', background: 'var(--bg-surface)' }}
          />
        </div>

        {uniqueSources.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Source:</span>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              style={{
                background: 'var(--bg-surface)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.35rem 0.65rem',
                fontSize: '0.75rem'
              }}
            >
              <option value="ALL">All Sources</option>
              {uniqueSources.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}

        {/* Legend: Foreign (Branch 5) */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--border-foreign, #2563eb)', fontWeight: 600 }}>
          <span style={{ width: '10px', height: '10px', background: 'var(--bg-foreign-row)', border: '1px solid var(--border-foreign, #2563eb)', borderRadius: '2px', display: 'inline-block' }} />
          <span>Foreign (Branch 5)</span>
        </div>
      </div>

      {/* Data Table */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '45px', textAlign: 'center' }}>Inc</th>
              <th style={{ width: '50px' }}>SEQ</th>
              <th>Inv #</th>
              <th>Group Owner</th>
              <th>Profile Owner</th>
              <th>Job Holder / Entity</th>
              <th>Support Provider</th>
              <th>Service Head</th>
              <th>Stack</th>
              <th>Project</th>
              <th>Interview Code</th>
              <th>Inv To</th>
              <th>Month</th>
              <th>CCY</th>
              <th>Exch Rate</th>
              <th>Charged USD</th>
              <th>Charged PKR</th>
              <th>Total PKR</th>
              <th>Rizviz Share</th>
              <th>Arrears</th>
              <th>Total USD Cost</th>
              <th>Status</th>
              <th>Remarks</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={25} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  {loading ? 'Loading...' : 'No profile invoice rows loaded. Select an owner and month, then click "Generate Preview (Dry-Run)" or "Load Saved".'}
                </td>
              </tr>
            ) : (
              filteredRows.map((row, idx) => {
                const rowKey = row.cmpProfInvoiceCode ? String(row.cmpProfInvoiceCode) : `idx_${idx}`;
                const edits = editingRows[rowKey] || {};
                const currentInvNum = edits.invoiceNumber !== undefined ? edits.invoiceNumber : (row.invoiceNumber || '');
                const currentRemarks = edits.remarks !== undefined ? edits.remarks : (row.remarks || '');
                const currentStatus = edits.status !== undefined ? edits.status : (row.status || 'P');
                const isModified = Object.keys(edits).length > 0;
                const isSavingThis = savingRowId === row.cmpProfInvoiceCode;

                const rowBg = row.isForeign ? 'var(--bg-foreign-row)' : undefined;

                return (
                  <tr key={rowKey} className={row.isForeign ? 'foreign-row' : undefined} style={{ background: rowBg, opacity: row.isIncluded === false ? 0.6 : 1 }}>
                    {/* Include Checkbox Column */}
                    <td style={{ textAlign: 'center', borderLeft: row.isForeign ? '3px solid var(--border-foreign, #2563eb)' : undefined }}>
                      <input
                        type="checkbox"
                        checked={row.isIncluded ?? true}
                        disabled={isSavingThis}
                        onChange={(e) => handleToggleIncluded(row, e.target.checked)}
                        title={row.isExecutive ? 'Real Executive (Unchecked by default)' : 'Include in calculations'}
                        style={{ cursor: 'pointer', width: '15px', height: '15px' }}
                      />
                    </td>

                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {idx + 1}
                    </td>

                    {/* Invoice Number (Inline editable) */}
                    <td>
                      <input
                        type="text"
                        value={currentInvNum}
                        onChange={(e) => handleFieldChange(rowKey, 'invoiceNumber', e.target.value)}
                        onBlur={() => isModified && handleSaveRow(row, idx)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveRow(row, idx)}
                        disabled={false}
                        placeholder="Inv #"
                        style={{
                          width: '100px',
                          padding: '0.25rem 0.45rem',
                          fontSize: '0.8rem',
                          background: 'var(--bg-surface)',
                          border: edits.invoiceNumber !== undefined ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          color: 'var(--text-main)',
                          fontFamily: 'var(--font-mono)'
                        }}
                      />
                    </td>

                    <td style={{ fontWeight: 600 }}>{row.groupOwnerName || '—'}</td>
                    <td>{row.profileOwnerName || '—'}</td>
                    <td>{row.entityName || '—'}</td>
                    <td>{row.secondaryDevName || '—'}</td>
                    <td>
                      <span style={{
                        background: 'rgba(99, 102, 241, 0.12)',
                        color: '#818cf8',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        whiteSpace: 'nowrap'
                      }}>
                        {formatServiceHead(row)}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{row.stack || '—'}</td>
                    <td>{row.projectName || (row.projectCode ? `#${row.projectCode}` : '—')}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {row.interviewCode ? `${row.interviewCode}${row.interviewSeqCode ? `-${row.interviewSeqCode}` : ''}` : '—'}
                    </td>
                    <td>{row.invoiceToName || row.invoiceTo}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {formatMonthDisplay(row.invoiceMonth)}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {row.ccy === 1 ? 'PKR' : 'USD'}
                    </td>

                    {/* Exchange Rate (Inline editable) */}
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      <input
                        type="number"
                        step="0.01"
                        value={edits.exchangeRate !== undefined ? edits.exchangeRate : (row.exchangeRate ?? '')}
                        onChange={(e) => handleFieldChange(rowKey, 'exchangeRate', e.target.value === '' ? null : Number(e.target.value))}
                        onBlur={() => isModified && handleSaveRow(row, idx)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveRow(row, idx)}
                        disabled={false}
                        style={{
                          width: '75px',
                          textAlign: 'right',
                          padding: '0.2rem 0.35rem',
                          fontSize: '0.8rem',
                          background: 'var(--bg-surface)',
                          border: edits.exchangeRate !== undefined ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          color: 'var(--text-main)',
                          fontFamily: 'var(--font-mono)'
                        }}
                      />
                    </td>

                    {/* Charged USD (Computed) */}
                    <td style={{
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      color: '#10b981',
                      textAlign: 'right'
                    }}>
                      {formatMoney(row.chargedAmtUsd, 'USD', 'Row USD')}
                    </td>

                    {/* Charged PKR (Computed) */}
                    <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                      {formatMoney(row.chargedAmtPkr, 'PKR', 'Row PKR')}
                    </td>

                    {/* Total Income PKR (Inline editable) */}
                    <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                      <input
                        type="number"
                        value={edits.totalIncomePkr !== undefined ? edits.totalIncomePkr : (row.totalIncomePkr ?? '')}
                        onChange={(e) => handleFieldChange(rowKey, 'totalIncomePkr', e.target.value === '' ? null : Number(e.target.value))}
                        onBlur={() => isModified && handleSaveRow(row, idx)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveRow(row, idx)}
                        disabled={false}
                        style={{
                          width: '95px',
                          textAlign: 'right',
                          padding: '0.2rem 0.35rem',
                          fontSize: '0.8rem',
                          background: 'var(--bg-surface)',
                          border: edits.totalIncomePkr !== undefined ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          color: 'var(--text-main)',
                          fontFamily: 'var(--font-mono)'
                        }}
                      />
                    </td>

                    {/* Share Amount */}
                    <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                      {row.shareAmount != null ? formatMoney(row.shareAmount, 'USD', 'Share') : (row.chargePercent ? `${row.chargePercent}%` : '—')}
                    </td>

                    {/* Arrears */}
                    <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                      {row.arrears ? formatMoney(row.arrears, 'USD', 'Arrears') : '—'}
                    </td>

                    {/* Total USD Cost */}
                    <td style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                      {row.totalUsdCost != null ? formatMoney(row.totalUsdCost, 'USD', 'Cost') : '—'}
                    </td>

                    {/* Status (dropdown: P=Paid, D=Due) */}
                    <td>
                      <select
                        value={currentStatus}
                        onChange={(e) => handleFieldChange(rowKey, 'status', e.target.value)}
                        onBlur={() => isModified && handleSaveRow(row, idx)}
                        disabled={false}
                        style={{
                          padding: '0.2rem 0.4rem',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          borderRadius: '4px',
                          border: edits.status !== undefined ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                          background: currentStatus === 'P' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: currentStatus === 'P' ? '#10b981' : '#ef4444'
                        }}
                      >
                        <option value="P">Paid (P)</option>
                        <option value="D">Due (D)</option>
                      </select>
                    </td>

                    {/* Remarks (Inline editable) */}
                    <td>
                      <input
                        type="text"
                        value={currentRemarks}
                        onChange={(e) => handleFieldChange(rowKey, 'remarks', e.target.value)}
                        onBlur={() => isModified && handleSaveRow(row, idx)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveRow(row, idx)}
                        disabled={false}
                        placeholder="Remarks..."
                        style={{
                          width: '120px',
                          padding: '0.25rem 0.45rem',
                          fontSize: '0.8rem',
                          background: 'var(--bg-surface)',
                          border: edits.remarks !== undefined ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          color: 'var(--text-main)'
                        }}
                      />
                    </td>

                    {/* Source */}
                    <td>
                      <span style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--border-subtle)',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap'
                      }}>
                        {row.source || 'Saved'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td>
                      {isSavingThis ? (
                        <span style={{ color: '#3b82f6', fontSize: '0.75rem', fontWeight: 600 }}>saving...</span>
                      ) : isModified ? (
                        <button
                          onClick={() => handleSaveRow(row, idx)}
                          style={{
                            background: 'var(--accent-primary)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '0.25rem 0.6rem',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem'
                          }}
                        >
                          <Check size={12} />
                          Save
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
        </>
      )}

    </div>
  );
};
