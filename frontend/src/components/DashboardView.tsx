import React, { useState, useEffect, useCallback } from 'react';
import { 
  DollarSign, 
  Coins, 
  Receipt, 
  Calendar, 
  TrendingUp, 
  Building, 
  ArrowUpRight, 
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { api } from '../api/client';
import { useMonth } from '../context/MonthContext';
import type { DashboardSummaryDto } from '../types';
import { formatMoney, formatCount, formatRate } from '../utils/format';

interface DashboardViewProps {
  onSelectMonth: (month: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onSelectMonth }) => {
  const { selectedMonth, setSelectedMonth, availableMonths, loadingMonths } = useMonth();
  const [data, setData] = useState<DashboardSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async (targetMonth = selectedMonth) => {
    if (!targetMonth) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.getDashboard(targetMonth);
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    if (selectedMonth) {
      fetchDashboard(selectedMonth);
    }
  }, [selectedMonth, fetchDashboard]);

  const activeMonth = selectedMonth || data?.latestMonth || '';

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      {/* Top Banner / Action */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em', margin: 0 }}>
            Executive Dashboard
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
            Live status of migrated company invoices, advance deductions, and final settlements.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {/* Global Month Selector */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            background: 'var(--bg-surface)',
            border: '1.5px solid var(--accent-primary)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 8px',
            height: '32px',
            boxShadow: '0 0 10px rgba(99, 102, 241, 0.15)'
          }}>
            <Calendar size={15} color="var(--accent-primary)" />
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Month:
            </span>
            <select
              id="global-dashboard-month-select"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              disabled={loadingMonths}
              style={{
                background: 'transparent',
                color: 'var(--text-main)',
                border: 'none',
                outline: 'none',
                fontSize: '0.85rem',
                fontWeight: 800,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer'
              }}
            >
              {availableMonths.map((m) => (
                <option key={m} value={m} style={{ background: 'var(--bg-surface)', color: 'var(--text-main)' }}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <button
            className="btn-secondary"
            onClick={() => fetchDashboard(selectedMonth)}
            disabled={loading}
            title="Refresh Dashboard"
            style={{ height: '32px', display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          {activeMonth && (
            <button 
              className="btn-primary"
              onClick={() => onSelectMonth(activeMonth)}
              style={{ height: '32px', display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}
            >
              <span>Manage {activeMonth}</span>
              <ArrowUpRight size={15} />
            </button>
          )}
        </div>
      </div>

      {loading && !data && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '350px', gap: '1rem' }}>
          <RefreshCw size={32} className="animate-spin" color="var(--accent-primary)" />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>Loading {selectedMonth} Financial Analytics...</p>
        </div>
      )}

      {error && (
        <div style={{
          padding: '1.25rem',
          background: 'var(--accent-rose-light)',
          border: '1px solid rgba(244, 63, 94, 0.3)',
          borderRadius: 'var(--radius-md)',
          color: '#fb7185',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertCircle size={22} />
            <div>{error}</div>
          </div>
          <button className="btn-secondary" onClick={() => fetchDashboard(selectedMonth)} style={{ background: 'rgba(255,255,255,0.1)' }}>
            Retry
          </button>
        </div>
      )}

      {data && (
        <>

      {/* KPI Metric Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '1.25rem'
      }}>
        {/* Total USD Charged */}
        <div className="panel-card" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Total Billed (USD)
            </span>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'var(--accent-primary-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#818cf8'
            }}>
              <DollarSign size={20} />
            </div>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
            {formatMoney(data.totalUsdCharged, 'USD', 'Dashboard totalUsdCharged')}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.4rem' }}>
            Aggregated across all company invoiced line items
          </div>
        </div>

        {/* Total PKR Income */}
        <div className="panel-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Total Income (PKR)
            </span>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'var(--accent-emerald-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-emerald)'
            }}>
              <Coins size={20} />
            </div>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
            {formatMoney(data.totalPkrIncome, 'PKR', 'Dashboard totalPkrIncome')}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.4rem' }}>
            Base resource revenue in local currency
          </div>
        </div>

        {/* Invoice Records */}
        <div className="panel-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Active Invoices
            </span>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'var(--accent-cyan-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-cyan)'
            }}>
              <Receipt size={20} />
            </div>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
            {formatCount(data.activeInvoiceCount, 'Dashboard activeInvoiceCount')}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.4rem' }}>
            Total company invoice records in database
          </div>
        </div>

        {/* Latest Period */}
        <div className="panel-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Latest Billing Cycle
            </span>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'var(--accent-amber-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-amber)'
            }}>
              <Calendar size={20} />
            </div>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--accent-amber)' }}>
            {data.latestMonth || 'N/A'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.4rem' }}>
            Most recently processed billing period
          </div>
        </div>
      </div>

      {/* Monthly Trends & Top Vendors Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
        gap: '1.5rem'
      }}>
        {/* Monthly Billing Trends */}
        <div className="panel-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={18} color="var(--accent-primary)" />
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>Recent Billing Cycles</h2>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Top periods</span>
          </div>

          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th style={{ textAlign: 'right' }}>Invoices</th>
                  <th style={{ textAlign: 'right' }}>Billed (USD)</th>
                  <th style={{ textAlign: 'right' }}>Income (PKR)</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(data.monthlyTrends || []).map((t) => (
                  <tr key={t.monthYear}>
                    <td style={{ fontWeight: 600, color: '#818cf8' }}>{t.monthYear}</td>
                    <td className="num-cell">{formatCount(t.invoiceCount, 'MonthlyTrend invoiceCount')}</td>
                    <td className="num-cell" style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>{formatMoney(t.totalChargedUsd, 'USD', 'MonthlyTrend totalChargedUsd')}</td>
                    <td className="num-cell">{formatMoney(t.totalIncomePkr, 'PKR', 'MonthlyTrend totalIncomePkr')}</td>
                    <td>
                      <button
                        onClick={() => t.monthYear && onSelectMonth(t.monthYear.trim())}
                        style={{
                          background: 'transparent',
                          color: 'var(--accent-primary)',
                          border: 'none',
                          padding: '0.2rem 0.5rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          fontSize: '0.8rem'
                        }}
                      >
                        <span>View</span>
                        <ArrowUpRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Vendors Distribution */}
        <div className="panel-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building size={18} color="var(--accent-cyan)" />
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>Top Invoiced Vendors</h2>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>By Total USD Billed</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {(data.topVendors || []).map((v) => {
              const maxUsd = Math.max(...(data.topVendors || []).map(x => x.totalChargedUsd ?? 0), 1);
              const pct = Math.round(((v.totalChargedUsd ?? 0) / maxUsd) * 100);
              return (
                <div key={v.vendorName} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{v.vendorName}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-emerald)', fontWeight: 600 }}>
                      {formatMoney(v.totalChargedUsd, 'USD', 'TopVendor totalChargedUsd')} <span style={{ color: 'var(--text-subtle)', fontSize: '0.75rem' }}>({formatCount(v.invoiceCount, 'TopVendor invoiceCount')} inv)</span>
                    </span>
                  </div>
                  <div style={{ height: '6px', background: 'var(--bg-surface)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #6366f1 0%, #06b6d4 100%)',
                      borderRadius: '3px',
                      transition: 'width 0.5s ease-out'
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent Invoices Table */}
      <div className="panel-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>Recent Invoices</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Latest generated company invoice items across all resources and vendors
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--border-foreign, #2563eb)', fontWeight: 600 }}>
              <span style={{ width: '10px', height: '10px', background: 'var(--bg-foreign-row)', border: '1px solid var(--border-foreign, #2563eb)', borderRadius: '2px', display: 'inline-block' }} />
              <span>Foreign (Branch 5)</span>
            </div>
            {data.latestMonth && (
              <button className="btn-secondary" onClick={() => data.latestMonth && onSelectMonth(data.latestMonth.trim())}>
                View All Invoices
              </button>
            )}
          </div>
        </div>

        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Month</th>
                <th>Vendor</th>
                <th>Resource / Profile</th>
                <th style={{ textAlign: 'right' }}>Charged (USD)</th>
                <th style={{ textAlign: 'right' }}>Income (PKR)</th>
                <th style={{ textAlign: 'right' }}>Exchange Rate</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(data.recentCompanyInvoices || []).slice(0, 10).map((inv) => (
                <tr
                  key={inv.cmpInvoiceSeqCode}
                  className={inv.isForeign ? 'foreign-row' : undefined}
                  style={{ background: inv.isForeign ? 'var(--bg-foreign-row)' : undefined }}
                >
                  <td style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    color: '#818cf8',
                    borderLeft: inv.isForeign ? '3px solid var(--border-foreign, #2563eb)' : undefined
                  }}>
                    {inv.invoiceNumber || `INV-${inv.cmpInvoiceSeqCode}`}
                  </td>
                  <td>{inv.invoiceMonth}</td>
                  <td style={{ fontWeight: 500 }}>{inv.vendorName || `Vendor ${inv.invoiceTo}`}</td>
                  <td>{inv.profileOwnerName || 'N/A'}</td>
                  <td className="num-cell" style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                    {formatMoney(inv.chargedAmtUsd, 'USD', 'RecentInvoice chargedAmtUsd')}
                  </td>
                  <td className="num-cell">
                    {formatMoney(inv.totalIncomePkr, 'PKR', 'RecentInvoice totalIncomePkr')}
                  </td>
                  <td className="num-cell">
                    {formatRate(inv.exchangeRate, 'RecentInvoice exchangeRate')}
                  </td>
                  <td>
                    {inv.status === 'P' ? (
                      <span className="badge badge-posted">Posted</span>
                    ) : (
                      <span className="badge badge-pending">Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
    </div>
  );
};
