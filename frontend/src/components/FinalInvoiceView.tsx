import React, { useState, useEffect, useMemo } from 'react';
import { 
  Download, 
  Printer, 
  Save, 
  RefreshCw, 
  AlertTriangle, 
  Check, 
  Calculator, 
  Eye, 
  FileText, 
  Layers, 
  DollarSign, 
  CreditCard, 
  Calendar,
  X
} from 'lucide-react';
import { api } from '../api/client';
import { useMonth } from '../context/MonthContext';
import type { FinalInvoiceDto, FinalInvoiceCalculationResult, AdvanceFundDto } from '../types';
import { formatMoney } from '../utils/format';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const YEARS = ['26', '25', '24'];

interface FinalInvoiceViewProps {
  initialMonth?: string;
  onMonthChange?: (month: string) => void;
}

export const FinalInvoiceView: React.FC<FinalInvoiceViewProps> = ({ initialMonth = 'OCT26', onMonthChange }) => {
  const { selectedMonth: globalMonth, setSelectedMonth: setGlobalMonth } = useMonth();
  const effectiveMonth = globalMonth || initialMonth;

  // Parse initialMonth into month and year
  const initM = effectiveMonth.length >= 5 ? effectiveMonth.substring(0, 3).toUpperCase() : 'OCT';
  const initY = effectiveMonth.length >= 5 ? effectiveMonth.substring(3).toUpperCase() : '26';

  const [selectedMonth, setSelectedMonth] = useState(initM);
  const [selectedYear, setSelectedYear] = useState(initY);
  const monthYear = useMemo(() => `${selectedMonth}${selectedYear}`, [selectedMonth, selectedYear]);

  // Sync with globalMonth from context
  useEffect(() => {
    if (globalMonth && globalMonth.length >= 5) {
      const m = globalMonth.substring(0, 3).toUpperCase();
      const y = globalMonth.substring(3).toUpperCase();
      if (m !== selectedMonth || y !== selectedYear) {
        setSelectedMonth(m);
        setSelectedYear(y);
      }
    }
  }, [globalMonth]);

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

  const [calcResult, setCalcResult] = useState<FinalInvoiceCalculationResult | null>(null);
  const [savedInvoice, setSavedInvoice] = useState<FinalInvoiceDto | null>(null);
  const [advanceFunds, setAdvanceFunds] = useState<AdvanceFundDto[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'interactive' | 'print-view'>('interactive');
  const [showBreakdownModal, setShowBreakdownModal] = useState(false);

  // Load data for selected month
  const loadMonthData = async (targetMonth = monthYear) => {
    try {
      setLoading(true);
      setError(null);
      setSuccessMsg(null);

      const [preview, saved, advances] = await Promise.all([
        api.getFinalInvoicePreview(targetMonth.trim()),
        api.getFinalInvoice(targetMonth.trim()).catch(() => null),
        api.getAdvanceFunds(targetMonth.trim()).catch(() => [])
      ]);

      setCalcResult(preview);
      setSavedInvoice(saved);
      setAdvanceFunds(advances || preview?.advanceFunds || []);
    } catch (err: any) {
      setError(err.message || 'Failed to calculate final invoice settlement.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMonthData(monthYear);
  }, [monthYear]);

  // BUTTON 1: Calculate (cb_final_calculate -> uf_final_calculate)
  const handleCalculate = async () => {
    await loadMonthData(monthYear);
    setSuccessMsg(`Settlement figures live calculated from database for period ${monthYear}.`);
  };

  // BUTTON 2: Finalize & Save (cb_final_save -> uf_final_save)
  const handleSave = async () => {
    if (savedInvoice) {
      if (!window.confirm(`Final invoice already exists for month ${monthYear} (Invoice Code #${savedInvoice.invCode}). Do you want to update it?`)) {
        return;
      }
    } else {
      if (!window.confirm(`Finalize and save final invoice settlement for period ${monthYear}?\n\nThis will atomically allocate the next official InvCode from NumberControl ('FIN') and persist the settlement report.`)) {
        return;
      }
    }

    try {
      setSaveLoading(true);
      setError(null);
      const res = await api.saveFinalInvoice(monthYear.trim());
      setSavedInvoice(res);
      setSuccessMsg(`Final invoice successfully finalized & saved with official Invoice Code #${res.invCode}!`);
      await loadMonthData(monthYear);
    } catch (err: any) {
      setError(err.message || 'Failed to save final invoice settlement.');
    } finally {
      setSaveLoading(false);
    }
  };

  // BUTTON 3: Download PDF (QuestPDF server-side vector generation)
  const handleDownloadPdf = async () => {
    try {
      setPdfLoading(true);
      setError(null);
      const blob = await api.downloadFinalInvoicePdf(monthYear.trim());
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Silmun_Final_Invoice_${monthYear.trim()}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setSuccessMsg(`PDF Report for ${monthYear} downloaded successfully.`);
    } catch (err: any) {
      setError(err.message || 'Failed to generate PDF document.');
    } finally {
      setPdfLoading(false);
    }
  };

  // Derived figures matching PowerBuilder
  const isFinalized = !!savedInvoice;
  const invCodeDisplay = savedInvoice?.invCode ?? calcResult?.invCode ?? null;
  const silmunTotal = calcResult?.silmunInvoiceAmt ?? 0;
  const paidExpensesTotal = calcResult?.paidInvoiceAmt ?? 0;
  const allTotalRevenue = calcResult?.totalAllRevenue ?? 0;
  const advanceDeductionsTotal = calcResult?.advancesFundAmt ?? 0;
  const finalPayable = calcResult?.finalInvoiceAmt ?? 0;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* ── Top Bar: Title & Navigation Controls ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em', margin: 0 }}>
            Final Invoice & PDF Module
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.2rem 0 0' }}>
            1:1 PowerBuilder Replica: <code style={{ color: 'var(--accent-primary)' }}>w_invoicing_generation (tabpage_final)</code> &amp; <code style={{ color: 'var(--accent-primary)' }}>d_rpt_final_invoice</code>
          </p>
        </div>

        {/* Action Buttons Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          {/* Month / Year Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'var(--bg-secondary)', padding: '0.3rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
            <Calendar size={15} color="var(--accent-primary)" />
            <select
              value={selectedMonth}
              onChange={(e) => handleMonthSelect(e.target.value)}
              style={{ padding: '0.3rem 0.5rem', fontSize: '0.825rem', fontWeight: 700, borderRadius: 'var(--radius-sm)' }}
            >
              {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => handleYearSelect(e.target.value)}
              style={{ padding: '0.3rem 0.5rem', fontSize: '0.825rem', fontWeight: 700, borderRadius: 'var(--radius-sm)' }}
            >
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button
              className="btn-secondary"
              onClick={() => loadMonthData(monthYear)}
              disabled={loading}
              style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem' }}
              title="Reload live month data"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>Load</span>
            </button>
          </div>

          {/* Button: Calculate */}
          <button
            id="btn-final-calculate"
            className="btn-primary"
            onClick={handleCalculate}
            disabled={loading}
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)' }}
          >
            <Calculator size={16} />
            <span>Calculate</span>
          </button>

          {/* Button: Finalize & Save */}
          <button
            id="btn-final-save"
            className="btn-primary"
            onClick={handleSave}
            disabled={saveLoading || !calcResult}
            style={{ background: isFinalized ? 'linear-gradient(135deg, #059669 0%, #10b981 100%)' : undefined }}
          >
            <Save size={16} />
            <span>{saveLoading ? 'Saving...' : isFinalized ? 'Update / Re-Save' : 'Finalize & Save'}</span>
          </button>

          {/* Button: Download PDF */}
          <button
            id="btn-final-pdf"
            className="btn-secondary"
            onClick={handleDownloadPdf}
            disabled={pdfLoading || !calcResult}
            style={{ background: 'var(--accent-primary-light)', color: '#818cf8', borderColor: 'rgba(99,102,241,0.3)' }}
          >
            <Download size={16} />
            <span>{pdfLoading ? 'Generating...' : 'Download PDF'}</span>
          </button>

          {/* Toggle View Mode */}
          <button
            className={activeTab === 'print-view' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setActiveTab(activeTab === 'interactive' ? 'print-view' : 'interactive')}
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.825rem' }}
          >
            {activeTab === 'interactive' ? (
              <>
                <Printer size={15} />
                <span>Show Print View</span>
              </>
            ) : (
              <>
                <FileText size={15} />
                <span>Show Interactive View</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Status Banners / Notifications ── */}
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

      {/* ── KPI Strip: Key Financial Settlement Indicators ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '0.85rem'
      }}>
        {/* KPI 1: Silmun Total Invoice */}
        <div className="panel-card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Silmun Total Invoice
            </span>
            <DollarSign size={16} color="var(--accent-primary)" />
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-mono)', marginTop: '0.35rem' }}>
            {formatMoney(silmunTotal, 'USD', 'Silmun Total')}
          </div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-subtle)', marginTop: '0.2rem' }}>
            Silmun Charged + Paid Exp Share
          </div>
        </div>

        {/* KPI 2: Paid Expenses Total */}
        <div className="panel-card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Paid Expenses Total
            </span>
            <CreditCard size={16} color="#818cf8" />
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#818cf8', fontFamily: 'var(--font-mono)', marginTop: '0.35rem' }}>
            {formatMoney(paidExpensesTotal, 'USD', 'Paid Expenses Total')}
          </div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-subtle)', marginTop: '0.2rem' }}>
            Vendor cost only (invoice_to = 2)
          </div>
        </div>

        {/* KPI 3: Advance Deductions */}
        <div className="panel-card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Total Advance Deductions
            </span>
            <span style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 700 }}>
              {advanceFunds.length} Record{advanceFunds.length === 1 ? '' : 's'}
            </span>
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#f59e0b', fontFamily: 'var(--font-mono)', marginTop: '0.35rem' }}>
            -{formatMoney(advanceDeductionsTotal, 'USD', 'Advance Deductions')}
          </div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-subtle)', marginTop: '0.2rem' }}>
            Disbursed advance funds deducted
          </div>
        </div>

        {/* KPI 4: FINAL PAYABLE AMOUNT */}
        <div className="panel-card" style={{
          padding: '1rem 1.25rem',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(16, 185, 129, 0.12) 100%)',
          border: '1px solid rgba(16, 185, 129, 0.4)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#34d399', textTransform: 'uppercase' }}>
              Final Payable Amount
            </span>
            <span className={`badge ${isFinalized ? 'badge-posted' : 'badge-pending'}`}>
              {isFinalized ? `Finalized #${invCodeDisplay}` : 'Draft Calculation'}
            </span>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 900, color: '#10b981', fontFamily: 'var(--font-mono)', marginTop: '0.35rem' }}>
            {formatMoney(finalPayable, 'USD', 'Final Payable')}
          </div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-subtle)', marginTop: '0.2rem' }}>
            Formula: Silmun Total ({formatMoney(silmunTotal, 'USD')}) - Advances ({formatMoney(advanceDeductionsTotal, 'USD')})
          </div>
        </div>
      </div>

      {/* ── UPPER PANEL: PowerBuilder dw_final_invoicing DataWindow ── */}
      <div className="panel-card" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Layers size={17} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              Final Invoicing Record (<code style={{ color: 'var(--accent-primary)' }}>dw_final_invoicing</code>)
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Period: <strong>{monthYear}</strong>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {isFinalized ? (
              <span className="badge badge-posted" style={{ padding: '0.25rem 0.65rem', fontSize: '0.75rem' }}>
                ✓ Official Final Invoice #{invCodeDisplay} (Saved by {savedInvoice?.insertBy || 'Admin'})
              </span>
            ) : (
              <span className="badge badge-pending" style={{ padding: '0.25rem 0.65rem', fontSize: '0.75rem' }}>
                Draft Preview (Click "Finalize &amp; Save" to persist)
              </span>
            )}
            <button
              className="btn-secondary"
              onClick={() => setShowBreakdownModal(true)}
              style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
              title="Inspect Statement Breakdown"
            >
              <Eye size={13} />
              <span>Inspect Statement Breakdown</span>
            </button>
          </div>
        </div>

        {/* 2-Row Layout matching PowerBuilder dw_final_invoicing */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '0.75rem',
          background: 'var(--bg-secondary)',
          padding: '1rem',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)'
        }}>
          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Final Invoice Code
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
              {invCodeDisplay ? `#${invCodeDisplay}` : '— (Pending Save)'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Month / Year
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
              {monthYear}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Invoice To
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '0.25rem' }}>
              Silmun (Vendor #1)
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Silmun Invoice Amt (All Revenue)
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
              {formatMoney(allTotalRevenue, 'USD', 'silmun_invoice_amt')}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Paid Expense Amt
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#818cf8', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
              {formatMoney(paidExpensesTotal, 'USD', 'paid_invoice_amt')}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Advance Funds Amt
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f59e0b', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
              {formatMoney(advanceDeductionsTotal, 'USD', 'advances_fund_amt')}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Final Invoice Amt
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)', marginTop: '0.25rem' }}>
              {formatMoney(finalPayable, 'USD', 'final_invoice_amt')}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Database Sync Status
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: isFinalized ? '#34d399' : 'var(--text-subtle)', marginTop: '0.25rem' }}>
              {isFinalized ? `Persisted (${savedInvoice?.insertTime ? new Date(savedInvoice.insertTime).toLocaleDateString() : 'Today'})` : 'Calculated In Memory'}
            </div>
          </div>
        </div>
      </div>

      {/* ── LOWER PANEL: 1:1 REPLICA of PowerBuilder d_rpt_final_invoice ── */}
      <div className="panel-card" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: '#ffffff', color: '#111827', borderRadius: 'var(--radius-md)', boxShadow: '0 4px 18px rgba(0,0,0,0.06)' }}>
        {/* Report Top Header Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e5e7eb', paddingBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            PowerBuilder Report Replica: <code style={{ color: '#2563eb' }}>d_rpt_final_invoice</code>
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => window.print()}
              style={{
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                padding: '0.35rem 0.75rem',
                borderRadius: '4px',
                fontWeight: 600,
                fontSize: '0.8rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}
            >
              <Printer size={14} />
              <span>Print Browser</span>
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={pdfLoading}
              style={{
                background: '#059669',
                color: '#ffffff',
                border: 'none',
                padding: '0.35rem 0.75rem',
                borderRadius: '4px',
                fontWeight: 600,
                fontSize: '0.8rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}
            >
              <Download size={14} />
              <span>{pdfLoading ? 'Exporting...' : 'Export QuestPDF'}</span>
            </button>
          </div>
        </div>

        {/* Printable Report Surface */}
        <div id="pb-final-report-document" style={{ maxWidth: '960px', margin: '0 auto', width: '100%', fontFamily: 'Arial, sans-serif' }}>
          {/* Main Title matching d_rpt_final_invoice */}
          <div style={{ textAlign: 'center', margin: '0.5rem 0 1rem' }}>
            <h2 style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              margin: 0,
              color: '#000000'
            }}>
              SILMUN FINAL INVOICE &amp; ADVANCE DEDUCTIONS REPORT
            </h2>
            <div style={{ borderBottom: '2.5px solid #000000', marginTop: '0.65rem' }}></div>
          </div>

          {/* Report Header Metadata Row matching d_rpt_final_invoice */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.65rem 0',
            fontSize: '0.9rem',
            color: '#000000',
            fontWeight: 700
          }}>
            <div>
              <span>Billing Month Year: </span>
              <span style={{ color: '#1d4ed8' }}>{monthYear}</span>
              {invCodeDisplay && (
                <span style={{ marginLeft: '1.25rem', color: '#4b5563', fontSize: '0.8rem' }}>
                  [Inv Code: #{invCodeDisplay}]
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <span>Silmun Total Invoice: </span>
                <span style={{ fontFamily: 'Courier New, monospace', fontSize: '1rem' }}>
                  {formatMoney(silmunTotal, 'USD')}
                </span>
              </div>
              <div>
                <span>Paid Expenses Total: </span>
                <span style={{ fontFamily: 'Courier New, monospace', fontSize: '1rem' }}>
                  {formatMoney(paidExpensesTotal, 'USD')}
                </span>
              </div>
            </div>
          </div>

          <div style={{ borderBottom: '1.5px solid #000000', marginBottom: '1rem' }}></div>

          {/* Section Header: ADVANCE RECEIVED DEDUCTIONS */}
          <div style={{
            fontSize: '0.95rem',
            fontWeight: 800,
            textTransform: 'uppercase',
            color: '#000000',
            marginBottom: '0.5rem'
          }}>
            ADVANCE RECEIVED DEDUCTIONS
          </div>

          {/* Table: Advance Received Deductions */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', color: '#111827' }}>
            <thead>
              <tr style={{ borderTop: '2px solid #000000', borderBottom: '2px solid #000000', background: '#f9fafb' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.35rem', fontWeight: 800, width: '32%' }}>Company / Vendor</th>
                <th style={{ textAlign: 'center', padding: '0.5rem 0.35rem', fontWeight: 800, width: '14%' }}>Currency</th>
                <th style={{ textAlign: 'right', padding: '0.5rem 0.5rem', fontWeight: 800, width: '22%' }}>Advance Amount</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.5rem', fontWeight: 800, width: '32%' }}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {advanceFunds.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '1.5rem', color: '#6b7280', fontStyle: 'italic' }}>
                    No advance deductions recorded for {monthYear}.
                  </td>
                </tr>
              ) : (
                advanceFunds.map((adv, idx) => (
                  <tr key={adv.invoiceCode || idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '0.5rem 0.35rem', fontWeight: 600 }}>{adv.vendorName}</td>
                    <td style={{ padding: '0.5rem 0.35rem', textAlign: 'center' }}>{adv.currencyName || 'USD'}</td>
                    <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: 600 }}>
                      {formatMoney(adv.amount, 'USD')}
                    </td>
                    <td style={{ padding: '0.5rem 0.5rem', color: '#4b5563' }}>{adv.remarks || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {/* Summary Section matching d_rpt_final_invoice */}
          <div style={{ marginTop: '0.75rem', borderTop: '1.5px solid #000000', paddingTop: '0.5rem' }}>
            {/* Total Advance Deductions row */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '0.35rem 0', fontSize: '0.9rem', fontWeight: 700 }}>
              <div style={{ width: '380px', textAlign: 'right', paddingRight: '1rem' }}>
                Total Advance Deductions:
              </div>
              <div style={{ width: '160px', textAlign: 'right', fontFamily: 'Courier New, monospace', fontSize: '0.95rem', color: '#dc2626' }}>
                {formatMoney(advanceDeductionsTotal, 'USD')}
              </div>
            </div>

            <div style={{ borderBottom: '1.5px solid #000000', margin: '0.4rem 0' }}></div>

            {/* FINAL PAYABLE AMOUNT row */}
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              padding: '0.5rem 0',
              fontSize: '0.95rem',
              fontWeight: 800,
              color: '#000000'
            }}>
              <div style={{ width: '480px', textAlign: 'right', paddingRight: '1rem' }}>
                FINAL PAYABLE AMOUNT (Silmun Total - Advance Deductions):
              </div>
              <div style={{
                width: '160px',
                textAlign: 'right',
                fontFamily: 'Courier New, monospace',
                fontSize: '1.15rem',
                fontWeight: 900,
                color: '#15803d'
              }}>
                {formatMoney(finalPayable, 'USD')}
              </div>
            </div>

            <div style={{ borderBottom: '3px double #000000', marginBottom: '1.5rem' }}></div>

            {/* Audit / Signatures Row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2.5rem', paddingTop: '1rem', fontSize: '0.85rem', color: '#374151' }}>
              <div style={{ width: '220px', textAlign: 'center' }}>
                <div style={{ fontWeight: 700 }}>Prepared By</div>
                <div style={{ color: '#4b5563', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                  {savedInvoice?.insertBy || calcResult?.insertBy || 'Admin'}
                </div>
                <div style={{ borderTop: '1px solid #000000', marginTop: '1.75rem', paddingTop: '0.25rem', fontSize: '0.75rem', color: '#6b7280' }}>
                  Date: {savedInvoice?.insertTime ? new Date(savedInvoice.insertTime).toLocaleDateString() : new Date().toLocaleDateString()}
                </div>
              </div>

              <div style={{ width: '220px', textAlign: 'center' }}>
                <div style={{ fontWeight: 700 }}>Verified &amp; Approved By</div>
                <div style={{ borderTop: '1px solid #000000', marginTop: '2.5rem', paddingTop: '0.25rem', fontSize: '0.75rem', color: '#6b7280' }}>
                  Authorized Signatory
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Statement Breakdown Modal ── */}
      {showBreakdownModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div className="panel-card" style={{
            maxWidth: '680px',
            width: '100%',
            padding: '1.5rem',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-xl)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Eye size={18} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                  Statement Breakdown ({monthYear})
                </h3>
              </div>
              <button
                onClick={() => setShowBreakdownModal(false)}
                className="btn-secondary"
                style={{ padding: '0.25rem 0.5rem', border: 'none' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Underlying components evaluated from <code style={{ color: 'var(--accent-primary)' }}>dbo.company_invoicing</code> and <code style={{ color: 'var(--accent-primary)' }}>dbo.invoice_advance_funds</code>:
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontWeight: 600 }}>1. Silmun Invoices Charged Amount (invoice_to = 1):</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                  {formatMoney(calcResult ? ((calcResult.silmunInvoiceAmt ?? 0) - ((calcResult.totalAllRevenue ?? 0) - (calcResult.silmunInvoiceAmt ?? 0) - (calcResult.paidInvoiceAmt ?? 0))) : 0, 'USD')}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontWeight: 600 }}>2. Paid Expense Vendor Cost (invoice_to = 2, total_usd_cost):</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#818cf8' }}>
                  {formatMoney(paidExpensesTotal, 'USD')}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontWeight: 600 }}>3. Paid Expense Vendor Share (invoice_to = 2, share_amount):</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                  {formatMoney(calcResult ? ((calcResult.totalAllRevenue ?? 0) - (calcResult.silmunInvoiceAmt ?? 0) - (calcResult.paidInvoiceAmt ?? 0)) : 0, 'USD')}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontWeight: 700 }}>Silmun Total Invoice (1 + 3):</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--text-main)' }}>
                  {formatMoney(silmunTotal, 'USD')}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontWeight: 700 }}>Total All Revenue (1 + 2 + 3):</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--text-main)' }}>
                  {formatMoney(allTotalRevenue, 'USD')}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontWeight: 700, color: '#f59e0b' }}>Less: Advance Funds Disbursed:</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#f59e0b' }}>
                  -{formatMoney(advanceDeductionsTotal, 'USD')}
                </span>
              </div>

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '0.85rem',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(16, 185, 129, 0.15) 100%)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(16, 185, 129, 0.4)'
              }}>
                <span style={{ fontWeight: 800, color: '#34d399' }}>Final Payable Settlement:</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: '1.15rem', color: '#10b981' }}>
                  {formatMoney(finalPayable, 'USD')}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button
                className="btn-secondary"
                onClick={() => setShowBreakdownModal(false)}
                style={{ padding: '0.4rem 1rem' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
