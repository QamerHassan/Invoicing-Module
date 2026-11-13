import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Archive, RefreshCw, AlertTriangle, Search, CheckCircle, RotateCcw, X } from 'lucide-react';
import { api } from '../api/client';
import type { ProfileGroupOwnerDto, ProfileInvoiceProcessedRowDto } from '../types';
import { OwnerSearchSelect } from './OwnerSearchSelect';
import { LoadingIndicator } from './LoadingIndicator';

interface Props {
  groupOwners: ProfileGroupOwnerDto[];
  initialOwnerCode?: number | '';
  initialMonth?: string;
  onRefreshUnprocessed?: () => void;
}

export const ProfileInvoiceProcessedTab: React.FC<Props> = ({
  groupOwners,
  initialOwnerCode,
  initialMonth,
  onRefreshUnprocessed
}) => {
  const [month, setMonth] = useState(initialMonth || '');
  const [ownerCode, setOwnerCode] = useState<number | ''>(initialOwnerCode || '');
  const [rows, setRows] = useState<ProfileInvoiceProcessedRowDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [selectedCodes, setSelectedCodes] = useState<Set<number>>(new Set());

  // Sync with parent props
  useEffect(() => {
    if (initialOwnerCode !== undefined) setOwnerCode(initialOwnerCode);
  }, [initialOwnerCode]);
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

  const load = useCallback(async () => {
    if (!month) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProcessedInvoices(ownerCode !== '' ? ownerCode : undefined, month);
      setRows(Array.isArray(data) ? data : []);
      setSelectedCodes(new Set()); // Reset selection on reload
    } catch (err: any) {
      flashError(err?.message || 'Failed to load processed invoices.');
    } finally {
      setLoading(false);
    }
  }, [month, ownerCode]);

  // Load when month or owner changes
  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    return rows.filter(r => {
      const text = `${r.profileName || ''} ${r.projectName || ''} ${r.stack || ''} ${r.invoiceToName || ''} ${r.invoiceMonth || ''} ${r.cmpProfInvoiceCode}`.toLowerCase();
      return words.every(w => text.includes(w));
    });
  }, [rows, search]);

  const allFilteredCodes = useMemo(() => {
    return filteredRows.map(r => r.cmpProfInvoiceCode);
  }, [filteredRows]);

  const isAllSelected = allFilteredCodes.length > 0 && allFilteredCodes.every(c => selectedCodes.has(c));
  const someSelected = selectedCodes.size > 0;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedCodes(new Set());
    } else {
      setSelectedCodes(new Set(allFilteredCodes));
    }
  };

  const handleToggleRow = (code: number) => {
    setSelectedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  // Undo / Move back to Unprocessed
  const handleBatchUnprocess = async () => {
    if (selectedCodes.size === 0) return;
    const count = selectedCodes.size;
    const confirmed = window.confirm(`Move ${count} selected invoice(s) back to Unprocessed?`);
    if (!confirmed) return;

    setActionLoading(true);
    try {
      const res = await api.unprocessInvoices(Array.from(selectedCodes));
      flashSuccess(res.message || `${count} invoice(s) moved back to Unprocessed.`);
      setSelectedCodes(new Set());
      await load();
      onRefreshUnprocessed?.();
    } catch (err: any) {
      flashError(err?.message || 'Failed to unprocess invoices.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSingleUnprocess = async (code: number) => {
    const confirmed = window.confirm('Move this invoice back to Unprocessed?');
    if (!confirmed) return;
    setActionLoading(true);
    try {
      const res = await api.unprocessInvoices([code]);
      flashSuccess(res.message || 'Invoice moved back to Unprocessed.');
      setSelectedCodes(prev => {
        const next = new Set(prev);
        next.delete(code);
        return next;
      });
      await load();
      onRefreshUnprocessed?.();
    } catch (err: any) {
      flashError(err?.message || 'Failed to unprocess invoice.');
    } finally {
      setActionLoading(false);
    }
  };

  const fmtUsd = (v: number) =>
    v == null ? '' : '$' + Math.round(v).toLocaleString();

  const fmtPkr = (v: number) =>
    v == null ? '' : 'Rs ' + Math.round(v).toLocaleString();

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
            placeholder="SEP26"
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
            onClick={load}
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
            title={someSelected ? `Move ${selectedCodes.size} invoice(s) back to Unprocessed` : 'Select rows to undo'}
          >
            <RotateCcw size={12} className={actionLoading ? 'spin' : ''} />
            {actionLoading ? 'Moving...' : `Undo to Unprocessed ${someSelected ? `(${selectedCodes.size})` : ''}`}
          </button>

          {/* Search */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={11} style={{ position: 'absolute', left: '6px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              style={{
                background: 'var(--bg-surface)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '1px 22px 1px 20px',
                fontSize: '0.72rem',
                width: '130px',
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
              Selected: {selectedCodes.size} of {filteredRows.length}
            </span>
          )}
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {filteredRows.length} row{filteredRows.length !== 1 ? 's' : ''}
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
          <LoadingIndicator message="Loading processed invoices..." fullHeight />
        ) : (
          <table className="compact-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'center', width: '36px' }}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleToggleSelectAll}
                    disabled={filteredRows.length === 0}
                    style={{ cursor: 'pointer', width: '13px', height: '13px' }}
                    title={isAllSelected ? 'Deselect All' : 'Select All'}
                  />
                </th>
                <th style={{ textAlign: 'center', width: '40px' }}>#</th>
                <th style={{ minWidth: '130px', textAlign: 'left' }}>Profile Owner</th>
                <th style={{ minWidth: '80px', textAlign: 'left' }}>Stack</th>
                <th style={{ minWidth: '130px', textAlign: 'left' }}>Project</th>
                <th style={{ minWidth: '120px', textAlign: 'left' }}>Invoice To</th>
                <th style={{ minWidth: '65px', textAlign: 'center' }}>Month</th>
                <th style={{ minWidth: '70px', textAlign: 'right' }}>Charged USD</th>
                <th style={{ minWidth: '80px', textAlign: 'right' }}>Charged PKR</th>
                <th style={{ minWidth: '55px', textAlign: 'center' }}>Status</th>
                <th style={{ minWidth: '100px', textAlign: 'left' }}>Insert By</th>
                <th style={{ minWidth: '65px', textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {search ? `No processed invoices matching "${search}".` : 'No processed invoices found.'}
                  </td>
                </tr>
              ) : (
                filteredRows.map((r, i) => {
                  const isChecked = selectedCodes.has(r.cmpProfInvoiceCode);
                  return (
                    <tr
                      key={r.cmpProfInvoiceCode}
                      className="table-row-hover"
                      style={{
                        background: isChecked ? 'rgba(59, 130, 246, 0.08)' : undefined,
                        cursor: 'pointer'
                      }}
                      onClick={() => handleToggleRow(r.cmpProfInvoiceCode)}
                    >
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleRow(r.cmpProfInvoiceCode)}
                          style={{ cursor: 'pointer', width: '13px', height: '13px' }}
                        />
                      </td>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                        {i + 1}
                      </td>
                      <td style={{ fontWeight: 600 }}>{r.profileName}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{r.stack || '-'}</td>
                      <td>{r.projectName || '-'}</td>
                      <td>{r.invoiceToName || '-'}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                        {r.invoiceMonth}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--excel-actual-color)' }}>
                        {fmtUsd(r.chargedAmtUsd)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        {fmtPkr(r.chargedAmtPkr)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          background: 'rgba(59, 130, 246, 0.1)',
                          color: '#2563eb'
                        }}>
                          PROCESSED
                        </span>
                      </td>
                      <td style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{r.insertBy || '-'}</td>
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleSingleUnprocess(r.cmpProfInvoiceCode)}
                          disabled={actionLoading}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.2rem',
                            padding: '1px 5px',
                            height: '20px',
                            fontSize: '0.68rem',
                            background: 'transparent',
                            color: '#2563eb',
                            border: '1px solid rgba(37, 99, 235, 0.3)',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer'
                          }}
                          title="Move back to Unprocessed"
                        >
                          <RotateCcw size={10} />
                          Undo
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
};
