import React, { useState, useEffect } from 'react';
import { 
  Wallet, 
  Plus, 
  Trash2, 
  Search, 
  RefreshCw, 
  AlertCircle, 
  Check
} from 'lucide-react';
import { api } from '../api/client';
import { useMonth } from '../context/MonthContext';
import type { AdvanceFundDto, CreateAdvanceFundDto, VendorDto } from '../types';
import { formatMoney, formatCount } from '../utils/format';

interface AdvanceFundsViewProps {
  initialMonth?: string;
  onMonthChange?: (month: string) => void;
}

export const AdvanceFundsView: React.FC<AdvanceFundsViewProps> = ({ initialMonth = 'OCT26', onMonthChange }) => {
  const { selectedMonth: globalMonth, setSelectedMonth: setGlobalMonth } = useMonth();
  const [monthYear, setMonthYear] = useState(globalMonth || initialMonth);
  const [funds, setFunds] = useState<AdvanceFundDto[]>([]);
  const [vendors, setVendors] = useState<VendorDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Add Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [newFund, setNewFund] = useState<CreateAdvanceFundDto>({
    monthYear: globalMonth || initialMonth,
    invoiceTo: 1,
    amount: 0,
    ccy: 2, // USD
    remarks: ''
  });

  const fetchData = async (targetMonth = monthYear) => {
    try {
      setLoading(true);
      setError(null);
      const [fundsData, vendorsData] = await Promise.all([
        api.getAdvanceFunds(targetMonth.trim()),
        api.getVendors()
      ]);
      setFunds(fundsData);
      setVendors(vendorsData);
      if (vendorsData.length > 0 && newFund.invoiceTo === 1) {
        setNewFund(prev => ({ ...prev, invoiceTo: vendorsData[0].vendCode }));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load advance funds');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(monthYear);
  }, []);

  // Sync with global month
  useEffect(() => {
    if (globalMonth && globalMonth !== monthYear) {
      setMonthYear(globalMonth);
      fetchData(globalMonth);
    }
  }, [globalMonth]);

  const handleMonthChange = (val: string) => {
    const clean = val.toUpperCase();
    setMonthYear(clean);
    if (clean.length >= 5) {
      setGlobalMonth(clean);
      onMonthChange?.(clean);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setAddLoading(true);
      setError(null);
      await api.createAdvanceFund({
        ...newFund,
        monthYear: monthYear.trim(),
        amount: Number(newFund.amount)
      });
      setSuccessMsg(`Advance fund successfully recorded.`);
      setIsAddModalOpen(false);
      setNewFund({
        monthYear: monthYear.trim(),
        invoiceTo: vendors[0]?.vendCode || 1,
        amount: 0,
        ccy: 2,
        remarks: ''
      });
      await fetchData(monthYear);
    } catch (err: any) {
      setError(err.message || 'Failed to create advance fund');
    } finally {
      setAddLoading(false);
    }
  };

  const handleDelete = async (invoiceCode: number) => {
    if (!window.confirm(`Are you sure you want to delete advance fund #${invoiceCode}?`)) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await api.deleteAdvanceFund(invoiceCode, monthYear.trim());
      setSuccessMsg(`Advance fund #${invoiceCode} deleted.`);
      await fetchData(monthYear);
    } catch (err: any) {
      setError(err.message || 'Failed to delete advance fund');
    } finally {
      setLoading(false);
    }
  };

  const filteredFunds = funds.filter(f => 
    (f.vendorName?.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (f.remarks?.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (f.invoiceCode !== undefined && f.invoiceCode.toString().includes(searchQuery))
  );

  const totalAdvanceUsd = filteredFunds
    .filter(f => f.ccy === 2 || f.currencyName === 'USD')
    .reduce((sum, f) => sum + (f.amount || 0), 0);

  const totalAdvancePkr = filteredFunds
    .filter(f => f.ccy === 1 || f.currencyName === 'PKR')
    .reduce((sum, f) => sum + (f.amount || 0), 0);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
            Invoice Advance Funds
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Track advance fund disbursements deducted on the final company invoice.
          </p>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-secondary)', padding: '0.3rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Period:</span>
            <input 
              id="input-advance-month"
              type="text" 
              value={monthYear} 
              onChange={(e) => handleMonthChange(e.target.value)}
              placeholder="e.g. SEP26"
              style={{ width: '90px', padding: '0.35rem 0.5rem', fontSize: '0.85rem', fontWeight: 700, textAlign: 'center' }}
            />
            <button 
              className="btn-secondary" 
              onClick={() => fetchData(monthYear)}
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
            >
              Load
            </button>
          </div>

          <button 
            id="btn-add-advance"
            className="btn-primary" 
            onClick={() => {
              setNewFund(prev => ({ ...prev, monthYear: monthYear.trim() }));
              setIsAddModalOpen(true);
            }}
          >
            <Plus size={16} />
            <span>Add Advance Fund</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div style={{
          padding: '0.9rem 1.25rem',
          background: 'var(--accent-rose-light)',
          border: '1px solid rgba(244, 63, 94, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: '#fb7185',
          fontSize: '0.9rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div style={{
          padding: '0.9rem 1.25rem',
          background: 'var(--accent-emerald-light)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: 'var(--radius-sm)',
          color: '#34d399',
          fontSize: '0.9rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <Check size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div className="panel-card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Total Advance (USD)
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
            {formatMoney(totalAdvanceUsd, 'USD', 'Total Advance USD')}
          </div>
        </div>

        <div className="panel-card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Total Advance (PKR)
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
            {formatMoney(totalAdvancePkr, 'PKR', 'Total Advance PKR')}
          </div>
        </div>

        <div className="panel-card" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Advance Records
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#818cf8', fontFamily: 'var(--font-mono)' }}>
            {formatCount(filteredFunds.length, 'Filtered Advance Funds Count')}
          </div>
        </div>
      </div>

      {/* Search Input */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '0.75rem 1.25rem',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.65rem'
      }}>
        <Search size={18} color="var(--text-subtle)" />
        <input
          id="input-advance-search"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by vendor, remarks, or code..."
          style={{ width: '100%', background: 'transparent', border: 'none', padding: '0.2rem' }}
        />
      </div>

      {/* Funds Table */}
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Period</th>
              <th>Vendor</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Currency</th>
              <th>Remarks</th>
              <th>Created By</th>
              <th>Created At</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 0.5rem' }} />
                  <div>Loading advance funds...</div>
                </td>
              </tr>
            ) : filteredFunds.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No advance funds recorded for <strong>{monthYear}</strong>.
                </td>
              </tr>
            ) : (
              filteredFunds.map((f) => (
                <tr key={`${f.invoiceCode}-${f.monthYear}`}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-subtle)' }}>
                    #{f.invoiceCode}
                  </td>
                  <td>{f.monthYear}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{f.vendorName || `Vendor ${f.invoiceTo}`}</td>
                  <td className="num-cell" style={{
                    color: f.amount !== null && f.amount !== undefined && f.amount < 0 ? '#fb7185' : '#10b981',
                    fontWeight: 700
                  }}>
                    {formatMoney(f.amount, f.ccy === 1 || f.currencyName === 'PKR' ? 'PKR' : 'USD', `AdvanceFund #${f.invoiceCode} amount`)}
                  </td>
                  <td>
                    <span className="badge badge-info">{f.currencyName || (f.ccy === 2 ? 'USD' : 'PKR')}</span>
                  </td>
                  <td style={{ color: 'var(--text-muted)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.remarks || '-'}
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>{f.insertBy || '-'}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
                    {f.insertTime ? new Date(f.insertTime).toLocaleDateString() : '-'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      onClick={() => f.invoiceCode !== undefined && handleDelete(f.invoiceCode)}
                      style={{
                        background: 'rgba(244, 63, 94, 0.1)',
                        border: '1px solid rgba(244, 63, 94, 0.2)',
                        color: '#fb7185',
                        padding: '0.3rem 0.5rem',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                      title="Delete Advance Fund"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Modal */}
      {isAddModalOpen && (
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
            padding: '2rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: 'var(--accent-primary-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#818cf8'
              }}>
                <Wallet size={22} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)' }}>Add Advance Fund</h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Record advance deduction for period {monthYear}</p>
              </div>
            </div>

            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                  Target Vendor
                </label>
                <select
                  value={newFund.invoiceTo}
                  onChange={(e) => setNewFund({ ...newFund, invoiceTo: Number(e.target.value) })}
                  style={{ width: '100%' }}
                  required
                >
                  {vendors.map((v) => (
                    <option key={v.vendCode} value={v.vendCode}>
                      {v.vendName} {v.shortcode ? `(${v.shortcode})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                    Amount
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={newFund.amount || ''}
                    onChange={(e) => setNewFund({ ...newFund, amount: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    style={{ width: '100%', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                    Currency
                  </label>
                  <select
                    value={newFund.ccy}
                    onChange={(e) => setNewFund({ ...newFund, ccy: Number(e.target.value) })}
                    style={{ width: '100%' }}
                  >
                    <option value={2}>USD</option>
                    <option value={1}>PKR</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                  Remarks / Purpose
                </label>
                <textarea
                  value={newFund.remarks || ''}
                  onChange={(e) => setNewFund({ ...newFund, remarks: e.target.value })}
                  placeholder="Optional notes or reference..."
                  rows={3}
                  style={{ width: '100%', resize: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={addLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={addLoading || !newFund.amount}
                >
                  {addLoading ? 'Saving...' : 'Save Advance Fund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
