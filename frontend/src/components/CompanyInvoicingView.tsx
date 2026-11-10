import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calculator, 
  CheckCircle, 
  Search, 
  RefreshCw, 
  AlertTriangle, 
  Check, 
  FileSpreadsheet,
  Layers,
  Building2
} from 'lucide-react';
import { api } from '../api/client';
import { useMonth } from '../context/MonthContext';
import type { CompanyInvoiceDto, ProfileOwnerDto, ProfileProjectDto } from '../types';
import { formatMoney, formatCount, formatRate } from '../utils/format';

const SERVICE_HEAD_MAP: Record<string, string> = {
  'JH': 'Job Holder',
  'SP': 'Support Provider',
  'IS': 'Interview Support',
  'C': 'Consultancy',
  'DR': '2nd Resource',
  'SJ': 'Supporting Job',
  'SL': 'Special',
  'OE': 'Operating Expense',
  'BO': 'Bonus',
  'BS': 'Basic Salary',
  'B': 'BD Commission (OT)',
  'E': 'BD Commission (EXE)',
  'X': 'Dev Commission',
  'R': 'BD Commission (REG)',
  'IT': 'Technical / Recruiter',
  'I': 'Interview 1st Commission',
  'J': 'Interview 2nd Commission',
  'TZ': 'TimeZone Allowance',
  'BD': 'Business Development',
  'BR': 'Basic Resource',
  'ST': 'Stipend',
  'OJ': 'On-Job Support',
  'EXP': 'Expense',
  'INV': 'Inventory',
  'PRF': 'Profile Holder',
  'TZA': 'TimeZone Allowance',
  'BON': 'Bonus',
  'DED': 'Deduction',
  'COM': 'Commission',
  'IC1': '1st Commission',
  'IC2': '2nd Commission',
  'OTI': 'Other Increments',
  'JOB': 'Job Holder',
  'SPO': 'Support to Others',
  'SDR': '2nd Resource',
  'SPC': 'Special',
  'ESP': 'External Support',
  'ADC': 'Additional Charges',
  'SCR': 'Self Closer Recurring',
  'OCR': 'Other Closer Recurring',
};

function formatServiceHead(codeOrName?: string | null): string {
  if (!codeOrName) return '—';
  const trimmed = codeOrName.trim();
  return SERVICE_HEAD_MAP[trimmed] || trimmed;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const YEARS = ['25', '26', '27', '28'];

interface CompanyInvoicingViewProps {
  initialMonth?: string;
  onNavigateToUnprocessed?: (month: string) => void;
  onMonthChange?: (month: string) => void;
}

export const CompanyInvoicingView: React.FC<CompanyInvoicingViewProps> = ({
  initialMonth = 'OCT26',
  onNavigateToUnprocessed,
  onMonthChange
}) => {
  const { selectedMonth: globalMonth, setSelectedMonth: setGlobalMonth } = useMonth();
  const effectiveMonth = globalMonth || initialMonth;

  // Parse month e.g. "OCT26" -> month = "OCT", year = "26"
  const parsedMonth = effectiveMonth.length >= 5 ? effectiveMonth.substring(0, 3).toUpperCase() : 'OCT';
  const parsedYear = effectiveMonth.length >= 5 ? effectiveMonth.substring(3).toUpperCase() : '26';

  const [selectedMonth, setSelectedMonth] = useState(parsedMonth);
  const [selectedYear, setSelectedYear] = useState(parsedYear);
  const monthYear = `${selectedMonth}${selectedYear}`;

  const handleMonthSelect = (m: string) => {
    setSelectedMonth(m);
    const newMY = `${m}${selectedYear}`;
    setGlobalMonth(newMY);
    onMonthChange?.(newMY);
  };

  const handleYearSelect = (y: string) => {
    setSelectedYear(y);
    const newMY = `${selectedMonth}${y}`;
    setGlobalMonth(newMY);
    onMonthChange?.(newMY);
  };

  // Sync with globalMonth from context
  useEffect(() => {
    if (globalMonth && globalMonth.length >= 5) {
      const m = globalMonth.substring(0, 3).toUpperCase();
      const y = globalMonth.substring(3).toUpperCase();
      setSelectedMonth(m);
      setSelectedYear(y);
      fetchInvoices(`${m}${y}`);
    }
  }, [globalMonth]);

  // Process Mode: "Bulk" vs "Single"
  const [processType, setProcessType] = useState<'Bulk' | 'Single'>('Bulk');

  // Profile Owners state
  const [profileOwners, setProfileOwners] = useState<ProfileOwnerDto[]>([]);
  const [selectedOwnerId, setSelectedOwnerId] = useState<number | ''>('');

  // Top Grid: Profile Owners - Projects (dw_prf_invoicing)
  const [profileProjects, setProfileProjects] = useState<ProfileProjectDto[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProjectCode, setSelectedProjectCode] = useState<number | null>(null);

  // Bottom Grid: Invoice Activity Details (dw_company_invoicing)
  const [invoices, setInvoices] = useState<CompanyInvoiceDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filter / Search for bottom grid
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'P' | 'U'>('ALL');

  // Loading states
  const [calcLoading, setCalcLoading] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);

  // Recalculate confirmation modal
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Load Profile Owners list on mount
  useEffect(() => {
    api.getProfileOwners()
      .then(data => setProfileOwners(data))
      .catch(err => console.error('Failed to load profile owners', err));
  }, []);

  // Fetch Profile Projects for top grid
  const fetchProfileProjects = async (ownerId?: number | '') => {
    try {
      setProjectsLoading(true);
      const prfId = (processType === 'Single' && ownerId && typeof ownerId === 'number') ? ownerId : undefined;
      const data = await api.getProfileProjects(prfId);
      setProfileProjects(data);
    } catch (err: any) {
      console.error('Failed to load profile projects', err);
    } finally {
      setProjectsLoading(false);
    }
  };

  // Fetch Invoices for bottom grid
  const fetchInvoices = async (targetMonth = monthYear) => {
    try {
      setLoading(true);
      setError(null);
      setSuccessMsg(null);
      const data = await api.getCompanyInvoices(targetMonth.trim());
      setInvoices(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  // Load on initial render and when monthYear changes
  useEffect(() => {
    fetchInvoices(monthYear);
    fetchProfileProjects(selectedOwnerId);
  }, [monthYear]);

  // When owner selection changes in Single mode, update top grid filter
  const handleOwnerChange = (val: string) => {
    const num = val === '' ? '' : Number(val);
    setSelectedOwnerId(num);
    if (processType === 'Single') {
      fetchProfileProjects(num);
    }
  };

  // When process type changes
  const handleProcessTypeChange = (type: 'Bulk' | 'Single') => {
    setProcessType(type);
    if (type === 'Bulk') {
      setSelectedOwnerId('');
      fetchProfileProjects('');
    } else if (selectedOwnerId) {
      fetchProfileProjects(selectedOwnerId);
    }
  };

  // Top Grid filtered projects
  const filteredProjects = useMemo(() => {
    if (processType === 'Single' && selectedOwnerId && typeof selectedOwnerId === 'number') {
      return profileProjects.filter(p => p.prfownCode === selectedOwnerId);
    }
    return profileProjects;
  }, [profileProjects, processType, selectedOwnerId]);

  // BUTTON 1: "Generate Excel" (cb_11 -> uf_calculate_salary)
  const handleDownloadExcel = async () => {
    if (!monthYear.trim()) {
      setError('Please select Month and Year first');
      return;
    }
    try {
      setExcelLoading(true);
      setError(null);
      const blob = await api.exportCompanyInvoicesExcel(monthYear.trim());
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Silmun_Invoice_${monthYear.trim()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setSuccessMsg(`Excel file exported successfully for ${monthYear.trim()}`);
    } catch (err: any) {
      setError(err.message || 'Failed to export Excel');
    } finally {
      setExcelLoading(false);
    }
  };

  // Execution of Calculation
  const executeCalculation = async (replaceExisting: boolean) => {
    try {
      setCalcLoading(true);
      setError(null);
      setSuccessMsg(null);
      setConfirmModal(null);

      const ownerId = processType === 'Single' && selectedOwnerId ? Number(selectedOwnerId) : null;
      const res = await api.calculateInvoices({
        monthYear: monthYear.trim(),
        mode: processType,
        profileOwnerId: ownerId,
        replaceExisting
      });

      setSuccessMsg(`Calculation completed: ${res.message || 'Processed successfully.'}`);
      await fetchInvoices(monthYear);
    } catch (err: any) {
      setError(err.message || 'Calculation failed');
    } finally {
      setCalcLoading(false);
    }
  };

  // BUTTON 2: "Calculate" (cb_6 -> uf_bulk_processing / uf_calc_single_invoice)
  const handleCalculateClick = () => {
    setError(null);

    // Validation for Single Process
    if (processType === 'Single' && !selectedOwnerId) {
      setError('Please select a Profile Owner for Single Process Invoice.');
      return;
    }

    // PB check: If invoices for this month already exist
    const relevantInvoices = processType === 'Single' && selectedOwnerId
      ? invoices.filter(inv => inv.prfownCode === selectedOwnerId)
      : invoices;

    if (relevantInvoices.length > 0) {
      setConfirmModal({
        isOpen: true,
        title: 'Invoices Already Exist',
        message: `Invoices for ${monthYear} are already created / posted.\n\nDo you want to recalculate them?`,
        onConfirm: () => executeCalculation(true)
      });
    } else {
      executeCalculation(false);
    }
  };

  // BUTTON 3: "Generate & Review Invoices" — navigate to Profile Invoicing → Excel → Unprocessed
  const handlePost = () => {
    const unposted = invoices.filter(x => x.status !== 'P');
    if (unposted.length === 0) {
      setError(`No pending invoices for ${monthYear}.`);
      return;
    }
    if (onNavigateToUnprocessed) {
      onNavigateToUnprocessed(monthYear.trim());
    }
  };

  // Filtered invoices for Bottom Grid
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q ||
        (inv.invoiceNumber?.toLowerCase().includes(q)) ||
        (inv.vendorName?.toLowerCase().includes(q)) ||
        (inv.profileOwnerName?.toLowerCase().includes(q)) ||
        (inv.projectName?.toLowerCase().includes(q)) ||
        (inv.developerName?.toLowerCase().includes(q)) ||
        (inv.stack?.toLowerCase().includes(q)) ||
        (inv.serviceHead?.toLowerCase().includes(q)) ||
        (inv.resourceType?.toLowerCase().includes(q)) ||
        (inv.projectNumber?.toString().includes(q)) ||
        (inv.projectCode?.toString().includes(q)) ||
        (inv.invoiceTo?.toString().includes(q));

      const matchesStatus = 
        statusFilter === 'ALL' || 
        (statusFilter === 'P' && inv.status === 'P') ||
        (statusFilter === 'U' && inv.status !== 'P');

      return matchesSearch && matchesStatus;
    });
  }, [invoices, searchQuery, statusFilter]);

  // Totals
  const hasMissingUsd = filteredInvoices.some(inv => inv.chargedAmtUsd === null && inv.finalUsd === null);
  const totalUsd = hasMissingUsd ? null : filteredInvoices.reduce((sum, inv) => sum + (inv.chargedAmtUsd ?? inv.finalUsd ?? 0), 0);
  const totalUsdCost = filteredInvoices.reduce((sum, inv) => sum + (inv.totalUsdCost != null ? Number(inv.totalUsdCost) : 0), 0);
  const totalPkr = filteredInvoices.reduce((sum, inv) => sum + (inv.totalIncomePkr || 0), 0);
  const pendingCount = filteredInvoices.filter(x => x.status !== 'P').length;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* ── TOP CONTROLS SECTION (PB Window Controls) ────────────────────── */}
      <div className="panel-card" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          
          {/* Month / Year selection */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <label htmlFor="select-invoice-month" style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Month:</label>
              <select
                id="select-invoice-month"
                value={selectedMonth}
                onChange={(e) => handleMonthSelect(e.target.value)}
                style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', fontWeight: 700, borderRadius: '4px' }}
              >
                {MONTHS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <label htmlFor="select-invoice-year" style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Year:</label>
              <select
                id="select-invoice-year"
                value={selectedYear}
                onChange={(e) => handleYearSelect(e.target.value)}
                style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', fontWeight: 700, borderRadius: '4px' }}
              >
                {YEARS.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            <button
              className="btn-secondary"
              onClick={() => { fetchInvoices(monthYear); fetchProfileProjects(selectedOwnerId); }}
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              title="Refresh month data"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Load ({monthYear})</span>
            </button>
          </div>

          {/* Radio Buttons: Single Process Invoice vs Bulk Process Invoices */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', background: 'var(--bg-surface)', padding: '0.4rem 0.85rem', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontSize: '0.825rem', fontWeight: 600 }}>
              <input
                type="radio"
                name="processType"
                value="Bulk"
                checked={processType === 'Bulk'}
                onChange={() => handleProcessTypeChange('Bulk')}
              />
              <span>Bulk Process Invoices</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontSize: '0.825rem', fontWeight: 600 }}>
              <input
                type="radio"
                name="processType"
                value="Single"
                checked={processType === 'Single'}
                onChange={() => handleProcessTypeChange('Single')}
              />
              <span>Single Process Invoice</span>
            </label>
          </div>

          {/* Profile Owner Dropdown (Disabled in Bulk Mode) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '260px' }}>
            <label htmlFor="select-profile-owner" style={{ fontSize: '0.8rem', fontWeight: 600, color: processType === 'Bulk' ? 'var(--text-subtle)' : 'var(--text-muted)' }}>
              Profile Owner:
            </label>
            <select
              id="select-profile-owner"
              value={selectedOwnerId}
              onChange={(e) => handleOwnerChange(e.target.value)}
              disabled={processType === 'Bulk'}
              style={{
                flex: 1,
                padding: '0.35rem 0.6rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                borderRadius: '4px',
                opacity: processType === 'Bulk' ? 0.45 : 1,
                cursor: processType === 'Bulk' ? 'not-allowed' : 'pointer'
              }}
            >
              <option value="">{processType === 'Bulk' ? '— All Owners (Bulk) —' : '— Select Profile Owner —'}</option>
              {profileOwners.map(po => (
                <option key={po.prfOwnCode} value={po.prfOwnCode}>
                  {po.profileName} (#{po.prfOwnCode})
                </option>
              ))}
            </select>
          </div>

        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div style={{
          padding: '0.85rem 1.25rem',
          background: 'var(--accent-rose-light)',
          border: '1px solid rgba(244, 63, 94, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: '#fb7185',
          fontSize: '0.875rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div style={{
          padding: '0.85rem 1.25rem',
          background: 'var(--accent-emerald-light)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: '#34d399',
          fontSize: '0.875rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <Check size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* ── TOP GRID: Profile Owners - Projects (dw_prf_invoicing) ─────────── */}
      <div className="panel-card" style={{ padding: '0.85rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Layers size={17} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              Profile Owners - Projects
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              ({formatCount(filteredProjects.length, 'Projects count')})
            </span>
          </div>
          {selectedProjectCode && (
            <span style={{ fontSize: '0.775rem', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
              Selected Proj: #{selectedProjectCode}
            </span>
          )}
        </div>

        <div className="data-table-container" style={{ maxHeight: '180px', overflowY: 'auto' }}>
          <table className="data-table" style={{ fontSize: '0.825rem' }}>
            <thead>
              <tr>
                <th>Profile Owner</th>
                <th>Job Holder</th>
                <th style={{ textAlign: 'center' }}>Project No.</th>
                <th>Project Name</th>
                <th style={{ textAlign: 'center' }}>Project Status</th>
              </tr>
            </thead>
            <tbody>
              {projectsLoading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '1.25rem', color: 'var(--text-muted)' }}>
                    <RefreshCw size={18} className="animate-spin" style={{ margin: '0 auto 0.25rem' }} />
                    <div>Loading Profile Projects...</div>
                  </td>
                </tr>
              ) : filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '1.25rem', color: 'var(--text-muted)' }}>
                    No active projects found {processType === 'Single' && selectedOwnerId ? 'for this owner' : ''}.
                  </td>
                </tr>
              ) : (
                filteredProjects.map((p) => {
                  const isSelected = selectedProjectCode === p.projectCode;
                  return (
                    <tr
                      key={`${p.prfownCode}-${p.projectCode}`}
                      onClick={() => {
                        setSelectedProjectCode(p.projectCode);
                        if (processType === 'Single') {
                          setSelectedOwnerId(p.prfownCode);
                        }
                      }}
                      style={{
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(99, 102, 241, 0.18)' : undefined
                      }}
                    >
                      <td style={{ fontWeight: 600 }}>{p.profileOwner}</td>
                      <td>{p.developerName}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{p.projectCode}</td>
                      <td>{p.projectName}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`badge ${p.projStatus === 'In-Progress' ? 'badge-posted' : 'badge-pending'}`}>
                          {p.projStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── ACTION BUTTONS ROW (PB Order: Generate Excel, Calculate, Generate & Post Invoice) ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.75rem',
        background: 'var(--bg-secondary)',
        padding: '0.75rem 1.25rem',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-subtle)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          <span>Billing Period:</span>
          <strong style={{ color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>{monthYear}</strong>
          <span>• Mode:</span>
          <strong style={{ color: processType === 'Single' ? '#f59e0b' : 'var(--accent-primary)' }}>{processType}</strong>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Button 1: Generate Excel (cb_11) */}
          <button
            id="btn-excel-file"
            className="btn-secondary"
            onClick={handleDownloadExcel}
            disabled={excelLoading || invoices.length === 0}
            title={invoices.length === 0 ? 'No invoices to export' : `Export Excel file for ${monthYear}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.45rem 0.9rem' }}
          >
            <FileSpreadsheet size={16} />
            <span>{excelLoading ? 'Generating...' : 'Generate Excel'}</span>
          </button>

          {/* Button 2: Calculate (cb_6) */}
          <button
            id="btn-open-calculate"
            className="btn-primary"
            onClick={handleCalculateClick}
            disabled={calcLoading}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.45rem 1.1rem' }}
          >
            <Calculator size={16} />
            <span>{calcLoading ? 'Calculating...' : 'Calculate'}</span>
          </button>

          {/* Button 3: Generate & Review Invoices (navigates to Unprocessed) */}
          <button
            id="btn-post-invoices"
            className="btn-success"
            onClick={handlePost}
            disabled={pendingCount === 0}
            title={pendingCount === 0 ? 'No pending invoices to review' : `Review ${pendingCount} pending invoices in Unprocessed tab`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.45rem 1.1rem' }}
          >
            <CheckCircle size={16} />
            <span>{`Generate & Review Invoices (${pendingCount})`}</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Strip (Matching PB Computed Summary Band) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: '0.85rem'
      }}>
        <div className="panel-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Total Invoice Amount
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
            {formatMoney(totalUsd, 'USD', 'CompanyInvoicing Total Invoice USD')}
          </div>
        </div>

        <div className="panel-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            $ Equivalent Total
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#06b6d4', fontFamily: 'var(--font-mono)' }}>
            {formatMoney(totalUsdCost, 'USD', 'CompanyInvoicing Total Usd Cost')}
          </div>
        </div>

        <div className="panel-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Filtered Total PKR
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
            {formatMoney(totalPkr, 'PKR', 'CompanyInvoicing Total PKR')}
          </div>
        </div>

        <div className="panel-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Invoices Count
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#818cf8', fontFamily: 'var(--font-mono)' }}>
            {formatCount(filteredInvoices.length, 'Filtered Invoices Count')} <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>({formatCount(invoices.length, 'Total Invoices Count')} total)</span>
          </div>
        </div>

        <div className="panel-card" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Pending Posting
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: pendingCount > 0 ? '#f59e0b' : '#10b981', fontFamily: 'var(--font-mono)' }}>
            {pendingCount}
          </div>
        </div>
      </div>

      {/* ── BOTTOM GRID: Invoice Activity Details (dw_company_invoicing) ───── */}
      <div className="panel-card" style={{ padding: '0.85rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        
        {/* Header & Filter Controls for Invoice Activity Details */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building2 size={17} color="var(--accent-cyan)" />
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              Invoice Activity Details
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            {/* Search Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--bg-surface)', padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
              <Search size={14} color="var(--text-subtle)" />
              <input
                id="input-company-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search invoices..."
                style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: '0.8rem', width: '160px' }}
              />
            </div>

            {/* Status Filter */}
            <div style={{ display: 'flex', gap: '0.2rem', background: 'var(--bg-surface)', padding: '0.15rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
              {(['ALL', 'U', 'P'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  style={{
                    background: statusFilter === st ? 'var(--accent-primary)' : 'transparent',
                    color: statusFilter === st ? '#fff' : 'var(--text-muted)',
                    border: 'none',
                    padding: '0.25rem 0.6rem',
                    borderRadius: '3px',
                    fontSize: '0.725rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {st === 'ALL' ? 'All' : st === 'U' ? 'Pending' : 'Posted'}
                </button>
              ))}
            </div>

            {/* Foreign Legend */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.725rem', color: 'var(--border-foreign, #2563eb)', fontWeight: 600 }}>
              <span style={{ width: '9px', height: '9px', background: 'var(--bg-foreign-row)', border: '1px solid var(--border-foreign, #2563eb)', borderRadius: '2px', display: 'inline-block' }} />
              <span>Foreign (Br 5)</span>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="data-table-container">
          <table className="data-table" style={{ fontSize: '0.825rem' }}>
            <thead>
              <tr>
                <th className="sticky-col-1">Inv No.</th>
                <th>Profile Owner</th>
                <th>Job Holder</th>
                <th>Support Provider</th>
                <th>Service Head</th>
                <th style={{ textAlign: 'center' }}>Interview Code</th>
                <th style={{ textAlign: 'center' }}>Project No.</th>
                <th>Inv. To</th>
                <th>Inv. Month</th>
                <th style={{ textAlign: 'center' }}>Ccy</th>
                <th style={{ textAlign: 'right' }}>Project Cost (Rs./$)</th>
                <th style={{ textAlign: 'right' }}>Exch. Rate</th>
                <th style={{ textAlign: 'right' }}>$ Equivalent</th>
                <th style={{ textAlign: 'right' }}>Rizviz Share Amount</th>
                <th style={{ textAlign: 'right' }}>Arrears</th>
                <th style={{ textAlign: 'right' }}>Total Inv. Amount</th>
                <th style={{ textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={17} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    <RefreshCw size={22} className="animate-spin" style={{ margin: '0 auto 0.5rem' }} />
                    <div>Loading invoices for {monthYear}...</div>
                  </td>
                </tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={17} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    No invoice activity details found for period <strong>{monthYear}</strong>.
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => (
                  <tr
                    key={inv.cmpInvoiceSeqCode}
                    className={inv.isForeign ? 'foreign-row' : undefined}
                    style={{ background: inv.isForeign ? 'var(--bg-foreign-row)' : undefined }}
                  >
                    <td className="sticky-col-1" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#818cf8', borderLeft: inv.isForeign ? '3px solid var(--border-foreign, #2563eb)' : undefined }}>
                      {inv.invoiceNumber || '-'}
                    </td>
                    <td style={{ fontWeight: 600 }}>{inv.profileOwnerName || 'N/A'}</td>
                    <td>{inv.developerName || '—'}</td>
                    <td>{inv.secondaryDevName || (inv.secondaryDevCode ? `Dev ${inv.secondaryDevCode}` : '—')}</td>
                    <td>
                      <span style={{ 
                        fontSize: '0.75rem', 
                        fontWeight: 600,
                        padding: '0.15rem 0.45rem', 
                        borderRadius: '3px', 
                        background: 'var(--bg-surface)', 
                        border: '1px solid var(--border-subtle)',
                        display: 'inline-block',
                        whiteSpace: 'nowrap'
                      }}>
                        {formatServiceHead(inv.serviceHead || inv.resourceType)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                      {inv.interviewSeqCode ?? inv.interviewCode ?? '—'}
                    </td>
                    <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                      {inv.projectNumber ?? inv.projectCode ?? '—'}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {inv.vendorName || `Vendor ${inv.invoiceTo}`}
                    </td>
                    <td>{inv.invoiceMonth}</td>
                    <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                      {inv.ccy === 1 ? 'PKR' : 'USD'}
                    </td>
                    <td className="num-cell">
                      {formatMoney(inv.totalIncomePkr, 'PKR', `Invoice ${inv.cmpInvoiceSeqCode} totalIncomePkr`)}
                    </td>
                    <td className="num-cell">
                      {formatRate(inv.exchangeRate, `Invoice ${inv.cmpInvoiceSeqCode} exchangeRate`)}
                    </td>
                    <td className="num-cell">
                      {formatMoney(inv.totalUsdCost != null ? Number(inv.totalUsdCost) : null, 'USD', `Invoice ${inv.cmpInvoiceSeqCode} totalUsdCost`)}
                    </td>
                    <td className="num-cell">
                      {formatMoney(inv.shareAmount, 'USD', `Invoice ${inv.cmpInvoiceSeqCode} shareAmount`)}
                    </td>
                    <td className="num-cell">
                      {formatMoney(inv.arrears, 'USD', `Invoice ${inv.cmpInvoiceSeqCode} arrears`)}
                    </td>
                    <td className="num-cell" style={{ color: '#10b981', fontWeight: 700 }}>
                      {formatMoney(inv.chargedAmtUsd, 'USD', `Invoice ${inv.cmpInvoiceSeqCode} chargedAmtUsd`)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {inv.status === 'P' ? (
                        <span className="badge badge-posted">Posted</span>
                      ) : (
                        <span className="badge badge-pending">Pending</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── RECALCULATE CONFIRMATION MODAL (Matching PB MessageBox) ───────── */}
      {confirmModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1.5rem'
        }}>
          <div className="glass-panel animate-fade-in" style={{
            maxWidth: '480px',
            width: '100%',
            padding: '1.75rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                background: 'rgba(245, 158, 11, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f59e0b'
              }}>
                <AlertTriangle size={20} />
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                {confirmModal.title}
              </h3>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.5, whiteSpace: 'pre-line', marginBottom: '1.5rem' }}>
              {confirmModal.message}
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                className="btn-secondary"
                onClick={() => setConfirmModal(null)}
              >
                No, Keep Existing
              </button>
              <button
                className="btn-primary"
                onClick={confirmModal.onConfirm}
              >
                Yes, Recalculate
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
