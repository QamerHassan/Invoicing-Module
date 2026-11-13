import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  MessageSquare, RefreshCw, AlertTriangle, Plus, X, CheckSquare,
  Square, Edit2, Save, Trash2, Search, CheckCircle
} from 'lucide-react';
import { api } from '../api/client';
import type {
  ProfileGroupOwnerDto,
  ProfileInvoiceDiscussedRowDto,
  ProfileInvoiceRowDto
} from '../types';
import { formatMoney } from '../utils/format';
import { LoadingIndicator } from './LoadingIndicator';

interface Props {
  groupOwners: ProfileGroupOwnerDto[];
  initialOwnerCode?: number | '';
  initialMonth?: string;
}

export const ProfileInvoiceToBeDiscussedTab: React.FC<Props> = ({
  groupOwners,
  initialOwnerCode,
  initialMonth,
}) => {
  // ── Filter state ────────────────────────────────────────────────────────────
  const [month, setMonth] = useState(initialMonth || '');
  const [ownerCode, setOwnerCode] = useState<number | ''>(initialOwnerCode || '');

  // ── Table state ─────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<ProfileInvoiceDiscussedRowDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ── Table selection (bulk remove) ───────────────────────────────────────────
  const [selectedTableCodes, setSelectedTableCodes] = useState<Set<number>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);

  // ── Inline note editing ─────────────────────────────────────────────────────
  const [editingNoteCode, setEditingNoteCode] = useState<number | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // ── Add Modal state ─────────────────────────────────────────────────────────
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [availableInvoices, setAvailableInvoices] = useState<ProfileInvoiceRowDto[]>([]);
  const [modalSearch, setModalSearch] = useState('');
  const [modalSelectedCodes, setModalSelectedCodes] = useState<Set<number>>(new Set());
  const [modalNote, setModalNote] = useState('');
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // ── Sync with parent props ─────────────────────────────────────────────────
  useEffect(() => {
    if (initialOwnerCode !== undefined) setOwnerCode(initialOwnerCode);
  }, [initialOwnerCode]);
  useEffect(() => {
    if (initialMonth) setMonth(initialMonth);
  }, [initialMonth]);

  // ── Flash success/error helpers ─────────────────────────────────────────────
  const flashSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };
  const flashError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 6000);
  };

  // ── Load To-Be-Discussed rows ───────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!month) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getToBeDiscussed(month, ownerCode !== '' ? ownerCode : undefined);
      const sorted = (Array.isArray(data) ? data : []).sort((a, b) => {
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
      setRows(sorted);
      setSelectedTableCodes(new Set());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load discussed invoices');
    } finally {
      setLoading(false);
    }
  }, [month, ownerCode]);

  useEffect(() => {
    if (month) load();
  }, [load, month, ownerCode]);

  // ── Set of codes already in the "discussed" list ───────────────────────────
  const alreadyDiscussedCodes = useMemo(
    () => new Set(rows.map(r => r.cmpProfInvoiceCode)),
    [rows]
  );

  // ── Open Add Modal: fetch all invoices for month+owner ─────────────────────
  const handleOpenAddModal = async () => {
    if (!month || ownerCode === '') {
      flashError('Please select a month and owner before adding invoices.');
      return;
    }
    setModalError(null);
    setModalSearch('');
    setModalSelectedCodes(new Set());
    setModalNote('');
    setIsModalOpen(true);
    setModalLoading(true);
    try {
      const data = await api.getSavedProfileInvoices(Number(ownerCode), month);
      setAvailableInvoices(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : 'Failed to load invoices');
    } finally {
      setModalLoading(false);
    }
  };

  // ── Modal filtered list ────────────────────────────────────────────────────
  const filteredModal = useMemo(() => {
    const q = modalSearch.toLowerCase().trim();
    if (!q) return availableInvoices;
    return availableInvoices.filter(inv =>
      (inv.projectName ?? '').toLowerCase().includes(q) ||
      (inv.invoiceNumber ?? '').toLowerCase().includes(q) ||
      (inv.profileOwnerName ?? '').toLowerCase().includes(q) ||
      (inv.serviceHeadName ?? inv.remarks ?? '').toLowerCase().includes(q)
    );
  }, [availableInvoices, modalSearch]);

  // ── Modal: select all filtered (non-already-discussed) ────────────────────
  const handleSelectAllFiltered = () => {
    const eligible = filteredModal
      .filter(inv => inv.cmpProfInvoiceCode != null && !alreadyDiscussedCodes.has(inv.cmpProfInvoiceCode))
      .map(inv => inv.cmpProfInvoiceCode as number);
    setModalSelectedCodes(new Set(eligible));
  };

  // ── Modal: toggle individual row ───────────────────────────────────────────
  const toggleModalCode = (code: number) => {
    setModalSelectedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  // ── Modal: submit ──────────────────────────────────────────────────────────
  const handleModalSubmit = async () => {
    if (modalSelectedCodes.size === 0) {
      setModalError('Please select at least one invoice.');
      return;
    }
    setModalSubmitting(true);
    setModalError(null);
    try {
      const result = await api.addToBeDiscussed(
        Array.from(modalSelectedCodes),
        modalNote.trim() || undefined
      );
      setIsModalOpen(false);
      flashSuccess(result.message || `${result.updatedCount} invoice(s) added to To Be Discussed.`);
      await load();
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : 'Failed to add invoices');
    } finally {
      setModalSubmitting(false);
    }
  };

  // ── Remove single row ──────────────────────────────────────────────────────
  const handleRemoveSingle = async (code: number) => {
    if (!window.confirm('Remove this invoice from To Be Discussed?')) return;
    setActionLoading(true);
    try {
      const result = await api.removeFromToBeDiscussed([code]);
      flashSuccess(result.message || 'Invoice removed.');
      await load();
    } catch (e: unknown) {
      flashError(e instanceof Error ? e.message : 'Failed to remove invoice');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Bulk remove ────────────────────────────────────────────────────────────
  const handleBulkRemove = async () => {
    if (selectedTableCodes.size === 0) return;
    if (!window.confirm(`Remove ${selectedTableCodes.size} invoice(s) from To Be Discussed?`)) return;
    setActionLoading(true);
    try {
      const result = await api.removeFromToBeDiscussed(Array.from(selectedTableCodes));
      flashSuccess(result.message || `${result.updatedCount} invoice(s) removed.`);
      await load();
    } catch (e: unknown) {
      flashError(e instanceof Error ? e.message : 'Failed to remove invoices');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Table row checkbox ─────────────────────────────────────────────────────
  const toggleTableCode = (code: number) => {
    setSelectedTableCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };
  const toggleAllTable = () => {
    if (selectedTableCodes.size === rows.length) {
      setSelectedTableCodes(new Set());
    } else {
      setSelectedTableCodes(new Set(rows.map(r => r.cmpProfInvoiceCode)));
    }
  };

  // ── Inline note edit ────────────────────────────────────────────────────────
  const startEditNote = (code: number, currentNote: string | null | undefined) => {
    setEditingNoteCode(code);
    setEditingNoteText(currentNote ?? '');
  };
  const cancelEditNote = () => {
    setEditingNoteCode(null);
    setEditingNoteText('');
  };
  const saveNote = async (code: number) => {
    setSavingNote(true);
    try {
      await api.updateDiscussNote(code, editingNoteText.trim() || undefined);
      setEditingNoteCode(null);
      flashSuccess('Note updated.');
      await load();
    } catch (e: unknown) {
      flashError(e instanceof Error ? e.message : 'Failed to save note');
    } finally {
      setSavingNote(false);
    }
  };

  // ── Status badge ───────────────────────────────────────────────────────────
  const statusBadge = (s: string) => {
    if (s === 'D') return { label: 'Due', color: '#b45309', bg: '#fef3c7' };
    if (s === 'P') return { label: 'Paid', color: '#15803d', bg: '#dcfce7' };
    return { label: s || '—', color: 'var(--text-muted)', bg: 'var(--bg-secondary)' };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>

      {/* ── Compact Toolbar ────────────────────────────────────────────────── */}
      <div className="compact-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>
            MONTH:
          </span>
          <input
            type="text"
            value={month}
            onChange={e => setMonth(e.target.value.toUpperCase())}
            placeholder="SEP26"
            style={{
              padding: '1px 6px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
              width: '75px',
              height: '24px',
              boxSizing: 'border-box'
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>
            OWNER:
          </span>
          <select
            value={ownerCode}
            onChange={e => setOwnerCode(e.target.value ? Number(e.target.value) : '')}
            style={{
              padding: '1px 6px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontSize: '0.75rem',
              width: '170px',
              height: '24px',
              boxSizing: 'border-box'
            }}
          >
            <option value="">All Owners</option>
            {groupOwners.map(o => (
              <option key={o.prfOwnCode} value={o.prfOwnCode}>
                {o.profileName} (#{o.prfOwnCode})
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={load}
          disabled={loading || !month}
          className="btn-secondary"
          style={{
            padding: '1px 7px',
            borderRadius: 'var(--radius-sm)',
            cursor: loading || !month ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            fontSize: '0.75rem',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
            opacity: loading || !month ? 0.7 : 1
          }}
        >
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
          {loading ? 'Loading...' : 'Refresh'}
        </button>

        <button
          onClick={handleOpenAddModal}
          disabled={loading || !month || ownerCode === ''}
          style={{
            height: '24px',
            padding: '1px 8px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent-primary)',
            color: '#fff',
            border: 'none',
            cursor: (loading || !month || ownerCode === '') ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
            opacity: (loading || !month || ownerCode === '') ? 0.6 : 1
          }}
        >
          <Plus size={12} />
          Add Invoices
        </button>

        {selectedTableCodes.size > 0 && (
          <button
            onClick={handleBulkRemove}
            disabled={actionLoading}
            style={{
              height: '24px',
              padding: '1px 8px',
              borderRadius: 'var(--radius-sm)',
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              cursor: actionLoading ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              opacity: actionLoading ? 0.7 : 1
            }}
          >
            <Trash2 size={12} />
            Remove ({selectedTableCodes.size})
          </button>
        )}

        {/* Compact KPI strip in filter bar */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            Discuss Items: <strong style={{ color: 'var(--accent-primary)', fontSize: '0.78rem' }}>{rows.length}</strong>
          </span>
          <span style={{ color: 'var(--border-subtle)' }}>|</span>
          <span style={{ color: 'var(--text-muted)' }}>
            Discuss USD: <strong style={{ color: '#10b981', fontSize: '0.82rem', fontFamily: 'var(--font-mono)' }}>{formatMoney(rows.reduce((sum, r) => sum + (r.chargedAmtUsd ?? 0), 0))}</strong>
          </span>
          <span style={{ color: 'var(--border-subtle)' }}>|</span>
          {/* Legend: Foreign (Branch 5) */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', color: 'var(--border-foreign, #2563eb)', fontWeight: 600 }}>
            <span style={{ width: '9px', height: '9px', background: 'var(--bg-foreign-row)', border: '1px solid var(--border-foreign, #2563eb)', borderRadius: '2px', display: 'inline-block' }} />
            <span>Foreign (Branch 5)</span>
          </div>
        </div>
      </div>

      {/* ── Messages ───────────────────────────────────────────────────────── */}
      {successMsg && (
        <div style={{ background: '#dcfce7', color: '#15803d', padding: '0.3rem 0.6rem', borderRadius: 'var(--radius-sm)', display: 'flex', gap: '0.4rem', alignItems: 'center', fontWeight: 600, fontSize: '0.75rem' }}>
          <CheckCircle size={14} />
          {successMsg}
        </div>
      )}
      {error && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '0.3rem 0.6rem', borderRadius: 'var(--radius-sm)', display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.75rem' }}>
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* ── Table Container ────────────────────────────────────────────────── */}
      <div className="compact-table-container">
        <table className="compact-table">
          <thead>
            <tr>
              <th style={{ width: '28px', textAlign: 'center' }}>
                <button
                  onClick={toggleAllTable}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'flex' }}
                  title={selectedTableCodes.size === rows.length && rows.length > 0 ? 'Deselect all' : 'Select all'}
                >
                  {selectedTableCodes.size === rows.length && rows.length > 0
                    ? <CheckSquare size={13} color="#818cf8" />
                    : <Square size={13} />}
                </button>
              </th>
              {['Code', 'Profile Owner', 'Stack', 'Project', 'Service Head', 'Status', 'Charged USD', 'Note', 'Marked By', 'Marked At', 'Actions'].map(h => (
                <th key={h} style={{ textAlign: h === 'Charged USD' ? 'right' : 'left' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={12} style={{ padding: '2.5rem' }}>
                  <LoadingIndicator message="Loading To Be Discussed items..." />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={12} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  {month
                    ? 'No items to be discussed for this month / owner. ✓'
                    : 'Enter a month above to load data.'}
                </td>
              </tr>
            ) : (
              rows.map(row => {
                const sl = statusBadge(row.status);
                const isChecked = selectedTableCodes.has(row.cmpProfInvoiceCode);
                const isEditingNote = editingNoteCode === row.cmpProfInvoiceCode;
                const rowBg = isChecked
                  ? 'rgba(99,102,241,0.07)'
                  : row.isForeign
                  ? 'var(--bg-foreign-row)'
                  : undefined;
                return (
                  <tr
                    key={row.cmpProfInvoiceCode}
                    className={row.isForeign ? 'foreign-row' : undefined}
                    style={{
                      borderBottom: '1px solid var(--border-subtle)',
                      background: rowBg
                    }}
                    onMouseEnter={e => { if (!isChecked && !row.isForeign) e.currentTarget.style.background = 'var(--bg-surface)'; }}
                    onMouseLeave={e => { if (!isChecked && !row.isForeign) e.currentTarget.style.background = ''; }}
                  >
                    {/* Checkbox */}
                    <td style={{
                      padding: '0.2rem 0.35rem',
                      textAlign: 'center',
                      borderLeft: row.isForeign ? '3px solid var(--border-foreign, #2563eb)' : undefined
                    }}>
                      <button
                        onClick={() => toggleTableCode(row.cmpProfInvoiceCode)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--text-muted)' }}
                      >
                        {isChecked
                          ? <CheckSquare size={14} color="var(--accent-primary)" />
                          : <Square size={14} />}
                      </button>
                    </td>
                    <td style={{ padding: '0.2rem 0.4rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{row.cmpProfInvoiceCode}</td>
                    <td style={{ padding: '0.2rem 0.4rem', fontWeight: 600 }}>{row.profileName}</td>
                    <td style={{ padding: '0.2rem 0.4rem', color: 'var(--text-muted)' }}>{row.stack || '—'}</td>
                    <td style={{ padding: '0.2rem 0.4rem' }}>
                      {row.projectCode ? `${row.projectCode} – ${row.projectName ?? ''}` : '—'}
                    </td>
                    <td style={{ padding: '0.2rem 0.4rem', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={row.serviceHead ?? ''}>
                      {row.serviceHead || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>}
                    </td>
                    <td style={{ padding: '0.2rem 0.4rem' }}>
                      <span style={{ display: 'inline-block', padding: '0.1rem 0.45rem', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 700, background: sl.bg, color: sl.color }}>
                        {sl.label}
                      </span>
                    </td>
                    <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', color: 'var(--accent-primary)', fontWeight: 700 }}>
                      {formatMoney(row.chargedAmtUsd)}
                    </td>
                    {/* Note column */}
                    <td style={{ padding: '0.2rem 0.4rem', minWidth: '160px' }}>
                      {isEditingNote ? (
                        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                          <input
                            value={editingNoteText}
                            onChange={e => setEditingNoteText(e.target.value)}
                            maxLength={500}
                            autoFocus
                            style={{
                              flex: 1,
                              padding: '0.15rem 0.4rem',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--accent-primary)',
                              background: 'var(--bg-secondary)',
                              color: 'var(--text-primary)',
                              fontSize: '0.75rem',
                              height: '24px'
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveNote(row.cmpProfInvoiceCode);
                              if (e.key === 'Escape') cancelEditNote();
                            }}
                          />
                          <button
                            onClick={() => saveNote(row.cmpProfInvoiceCode)}
                            disabled={savingNote}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#15803d', padding: '0.15rem' }}
                            title="Save"
                          >
                            <Save size={13} />
                          </button>
                          <button
                            onClick={cancelEditNote}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: '0.15rem' }}
                            title="Cancel"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                          <span style={{ color: row.discussNote ? 'var(--text-primary)' : 'var(--text-muted)', fontStyle: row.discussNote ? 'normal' : 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '130px' }}
                            title={row.discussNote ?? ''}>
                            {row.discussNote || 'No note'}
                          </span>
                          <button
                            onClick={() => startEditNote(row.cmpProfInvoiceCode, row.discussNote)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.15rem', flexShrink: 0 }}
                            title="Edit note"
                          >
                            <Edit2 size={12} />
                          </button>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.2rem 0.4rem', color: 'var(--text-muted)', fontSize: '0.74rem' }}>{row.discussMarkedBy ?? '—'}</td>
                    <td style={{ padding: '0.2rem 0.4rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '0.74rem' }}>
                      {row.discussMarkedTime ? new Date(row.discussMarkedTime).toLocaleDateString() : '—'}
                    </td>
                    {/* Actions */}
                    <td style={{ padding: '0.2rem 0.4rem', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => handleRemoveSingle(row.cmpProfInvoiceCode)}
                        disabled={actionLoading}
                        style={{
                          padding: '0.15rem 0.5rem',
                          borderRadius: 'var(--radius-sm)',
                          background: '#fee2e2',
                          color: '#dc2626',
                          border: '1px solid #fca5a5',
                          cursor: actionLoading ? 'not-allowed' : 'pointer',
                          fontWeight: 600,
                          fontSize: '0.7rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          opacity: actionLoading ? 0.6 : 1
                        }}
                      >
                        <Trash2 size={11} />
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Add Invoices Modal ─────────────────────────────────────────────── */}
      {isModalOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
          onClick={e => { if (e.target === e.currentTarget && !modalSubmitting) setIsModalOpen(false); }}
        >
          <div style={{
            background: 'var(--bg-primary)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            width: '760px',
            maxWidth: '95vw',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <MessageSquare size={20} color="var(--accent-primary)" />
                <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                  Add Invoices to &quot;To Be Discussed&quot;
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {month} · Owner #{ownerCode}
                </span>
              </div>
              <button
                onClick={() => !modalSubmitting && setIsModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Search */}
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  value={modalSearch}
                  onChange={e => setModalSearch(e.target.value)}
                  placeholder="Search by project, invoice #, name, service head…"
                  style={{
                    width: '100%',
                    paddingLeft: '2rem',
                    padding: '0.5rem 0.75rem 0.5rem 2rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <button
                onClick={handleSelectAllFiltered}
                style={{
                  padding: '0.45rem 0.9rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap'
                }}
              >
                Select all filtered ({filteredModal.filter(i => i.cmpProfInvoiceCode != null && !alreadyDiscussedCodes.has(i.cmpProfInvoiceCode)).length})
              </button>
            </div>

            {/* Modal Error */}
            {modalError && (
              <div style={{ padding: '0.6rem 1.5rem', background: '#fee2e2', color: '#b91c1c', fontSize: '0.875rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <AlertTriangle size={15} />
                {modalError}
              </div>
            )}

            {/* Modal List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0' }}>
              {modalLoading ? (
                <LoadingIndicator message="Loading invoices..." />
              ) : filteredModal.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  {availableInvoices.length === 0 ? 'No saved invoices found for this month / owner.' : 'No matches for your search.'}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary)', zIndex: 1 }}>
                    <tr>
                      <th style={{ width: '44px', padding: '0.5rem 0.75rem' }}></th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600 }}>Code</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600 }}>Profile / Project</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600 }}>Service Head</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600 }}>Charged USD</th>
                      <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredModal.map(inv => {
                      if (!inv.cmpProfInvoiceCode) return null;
                      const code = inv.cmpProfInvoiceCode;
                      const alreadyAdded = alreadyDiscussedCodes.has(code);
                      const isSelected = modalSelectedCodes.has(code);
                      const modalRowBg = alreadyAdded
                        ? 'var(--bg-secondary)'
                        : isSelected
                        ? 'rgba(99,102,241,0.08)'
                        : inv.isForeign
                        ? 'var(--bg-foreign-row)'
                        : undefined;
                      return (
                        <tr
                          key={code}
                          className={inv.isForeign ? 'foreign-row' : undefined}
                          style={{
                            borderBottom: '1px solid var(--border-subtle)',
                            background: modalRowBg,
                            opacity: alreadyAdded ? 0.55 : 1,
                            cursor: alreadyAdded ? 'not-allowed' : 'pointer'
                          }}
                          onClick={() => !alreadyAdded && toggleModalCode(code)}
                        >
                          <td style={{
                            padding: '0.45rem 0.75rem',
                            textAlign: 'center',
                            borderLeft: inv.isForeign ? '3px solid var(--border-foreign, #2563eb)' : undefined
                          }}>
                            {alreadyAdded ? (
                              <CheckCircle size={15} color="#15803d" />
                            ) : isSelected ? (
                              <CheckSquare size={15} color="var(--accent-primary)" />
                            ) : (
                              <Square size={15} color="var(--text-muted)" />
                            )}
                          </td>
                          <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontSize: '0.77rem' }}>
                            {code}
                            {alreadyAdded && <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', color: '#15803d', fontFamily: 'sans-serif' }}>Already added</span>}
                          </td>
                          <td style={{ padding: '0.45rem 0.75rem' }}>
                            <div style={{ fontWeight: 600 }}>{inv.profileOwnerName || '—'}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                              {inv.stack ? `[${inv.stack}] ` : ''}{inv.projectCode ? `${inv.projectCode} – ${inv.projectName ?? ''}` : ''}
                            </div>
                          </td>
                          <td style={{ padding: '0.45rem 0.75rem', color: 'var(--text-muted)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {inv.serviceHeadName || inv.remarks || '—'}
                          </td>
                          <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', color: 'var(--accent-primary)', fontWeight: 700 }}>
                            {formatMoney(inv.chargedAmtUsd ?? 0)}
                          </td>
                          <td style={{ padding: '0.45rem 0.75rem', textAlign: 'center' }}>
                            <span style={{
                              padding: '0.12rem 0.5rem', borderRadius: '9999px', fontSize: '0.68rem', fontWeight: 700,
                              background: inv.status === 'P' ? '#dcfce7' : inv.status === 'D' ? '#fef3c7' : 'var(--bg-secondary)',
                              color: inv.status === 'P' ? '#15803d' : inv.status === 'D' ? '#b45309' : 'var(--text-muted)'
                            }}>
                              {inv.status || '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal Note + Footer */}
            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem', fontWeight: 600 }}>
                  REASON / NOTE (optional, max 500 chars)
                </label>
                <input
                  value={modalNote}
                  onChange={e => setModalNote(e.target.value.slice(0, 500))}
                  placeholder="Why are these being flagged for discussion?"
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {modalSelectedCodes.size} invoice{modalSelectedCodes.size !== 1 ? 's' : ''} selected
                </span>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    onClick={() => !modalSubmitting && setIsModalOpen(false)}
                    disabled={modalSubmitting}
                    style={{
                      padding: '0.5rem 1.25rem',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '0.875rem'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleModalSubmit}
                    disabled={modalSubmitting || modalSelectedCodes.size === 0}
                    style={{
                      padding: '0.5rem 1.5rem',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--accent-primary)',
                      color: '#fff',
                      border: 'none',
                      cursor: (modalSubmitting || modalSelectedCodes.size === 0) ? 'not-allowed' : 'pointer',
                      fontWeight: 700,
                      fontSize: '0.875rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      opacity: (modalSubmitting || modalSelectedCodes.size === 0) ? 0.65 : 1
                    }}
                  >
                    <MessageSquare size={15} />
                    {modalSubmitting ? 'Sending…' : `Send to To Be Discussed (${modalSelectedCodes.size})`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
