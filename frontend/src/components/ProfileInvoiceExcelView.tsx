import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Download, 
  RefreshCw, 
  AlertTriangle,
  Check,
  FileSpreadsheet,
  History,
  Clock,
  MessageSquare,
  Mail,
  CheckCircle,
  Archive
} from 'lucide-react';
import { api } from '../api/client';
import { OwnerSearchSelect } from './OwnerSearchSelect';
import { ProfileInvoiceAuditTab } from './ProfileInvoiceAuditTab';
import { ProfileInvoiceUnprocessedTab } from './ProfileInvoiceUnprocessedTab';
import { ProfileInvoiceToBeDiscussedTab } from './ProfileInvoiceToBeDiscussedTab';
import { ProfileInvoiceEmailTab } from './ProfileInvoiceEmailTab';
import { ProfileInvoiceProcessedTab } from './ProfileInvoiceProcessedTab';
import type { 
  ProfileGroupOwnerDto, 
  ProfileInvoiceExcelViewResult,
  ProfileInvoiceRowUpdateRequest,
  ProfileInvoiceProjectUpdateRequest
} from '../types';

interface ProfileInvoiceExcelViewProps {
  groupOwners: ProfileGroupOwnerDto[];
  initialOwnerCode?: number | '';
  initialMonth?: string;
  onMonthChange?: (month: string) => void;
  onOwnerChange?: (ownerCode: number | '') => void;
  initialExcelTab?: 'sheet' | 'audit' | 'unprocessed' | 'discussed' | 'email' | 'processed';
}

export const ProfileInvoiceExcelView: React.FC<ProfileInvoiceExcelViewProps> = ({
  groupOwners: _groupOwners, // kept for prop compat, not used for dropdown
  initialOwnerCode = '',
  initialMonth = 'SEP26',
  onMonthChange,
  onOwnerChange,
  initialExcelTab
}) => {
  const [selectedOwnerCode, setSelectedOwnerCode] = useState<number | ''>(initialOwnerCode);
  const [monthYear, setMonthYear] = useState<string>(initialMonth.replace('-', '').toUpperCase());
  const [data, setData] = useState<ProfileInvoiceExcelViewResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingCode, setTogglingCode] = useState<number | null>(null);
  type EditableField = 'finalUsd' | 'totalCost' | 'agreedRate' | 'hoursDays' | 'otherCharge' | 'salaryRate' | 'serviceHead';
  const [editingCell, setEditingCell] = useState<{
    rowIdx: number;
    rowType: 'ProjectHeader' | 'Detail' | 'Standalone';
    code?: number;
    projectCode?: number;
    field: EditableField;
    value: string;
  } | null>(null);
  const [savingCell, setSavingCell] = useState<boolean>(false);
  const [selectedCell, setSelectedCell] = useState<{ rowIdx: number; colKey: string } | null>(null);
  const [hasConfirmedFinalized, setHasConfirmedFinalized] = useState<boolean>(false);
  type ExcelSubTab = 'sheet' | 'audit' | 'unprocessed' | 'discussed' | 'email' | 'processed';
  const [activeExcelTab, setActiveExcelTab] = useState<ExcelSubTab>(initialExcelTab || 'sheet');

  // Row selection for To Be Discussed / Process actions
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Multi-row checkbox selection for batch processing
  // Stores row indices of selectable (unprocessed Detail/Standalone/ProjectHeader) rows
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [processingSelected, setProcessingSelected] = useState<boolean>(false);
  const [processMsg, setProcessMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Owners fetched fresh from posted-group-owners endpoint
  const [postedOwners, setPostedOwners] = useState<ProfileGroupOwnerDto[]>([]);
  const [ownersLoading, setOwnersLoading] = useState<boolean>(false);

  // KAAM 4: Available months from backend
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [monthsLoading, setMonthsLoading] = useState<boolean>(false);

  // Email sub-tab integration for Save & Email
  const [emailSelectedCodes, setEmailSelectedCodes] = useState<number[] | null>(null);
  const [emailSelectedRows, setEmailSelectedRows] = useState<any[] | null>(null);

  // Helper to compute initial selected row indices: all non-processed rows CHECKED by default,
  // except rows already marked to_be_discussed = 1 which start UNCHECKED and red.
  const computeInitialSelectedIndices = (viewData: ProfileInvoiceExcelViewResult): Set<number> => {
    const indices = new Set<number>();
    viewData.rows.forEach((row, idx) => {
      if (row.isProcessed || row.rowType === 'Blank' || row.rowType === 'StackHeader') return;
      const isDiscuss = !!(row.isToBeDiscussed || row.toBeDiscussed);
      if (isDiscuss) {
        // to_be_discussed = 1 rows start UNCHECKED
        return;
      }
      if (row.rowType === 'ProjectHeader') {
        if ((row.childInvoiceCodes?.length ?? 0) > 0) indices.add(idx);
      } else if ((row.rowType === 'Detail' || row.rowType === 'Standalone') && row.cmpProfInvoiceCode) {
        indices.add(idx);
      }
    });
    return indices;
  };

  const cleanMonth = monthYear.trim().replace('-', '').toUpperCase();

  // Reset confirmation on month or owner switch
  useEffect(() => {
    setHasConfirmedFinalized(false);
  }, [selectedOwnerCode, cleanMonth]);

  const checkConfirmFinalized = (): boolean => {
    if (!data?.isFinalized || hasConfirmedFinalized) return true;
    const ok = window.confirm("Ye month final ho chuka hai, edit se final amount se farq aa sakta hai. Continue?");
    if (ok) {
      setHasConfirmedFinalized(true);
      return true;
    }
    return false;
  };

  // KAAM 4: Fetch invoiced months for selected owner or all
  const fetchMonths = useCallback(async (ownerCode?: number | '') => {
    setMonthsLoading(true);
    try {
      const code = typeof ownerCode === 'number' && ownerCode > 0 ? ownerCode : undefined;
      const list = await api.getInvoicedMonths(code);
      setAvailableMonths(list);
      if (list.length > 0) {
        setMonthYear(prev => {
          const cur = prev.trim().replace('-', '').toUpperCase();
          if (cur && list.includes(cur)) return cur;
          const initClean = initialMonth ? initialMonth.trim().replace('-', '').toUpperCase() : '';
          const nextMonth = (initClean && list.includes(initClean)) ? initClean : list[list.length - 1];
          if (onMonthChange) onMonthChange(nextMonth);
          return nextMonth;
        });
      }
    } catch (err) {
      console.error('Failed to load invoiced months', err);
      setAvailableMonths([]);
    } finally {
      setMonthsLoading(false);
    }
  }, [onMonthChange]);

  useEffect(() => {
    fetchMonths(selectedOwnerCode);
  }, [selectedOwnerCode, fetchMonths]);

  // Sync prop changes from parent
  useEffect(() => {
    if (initialMonth) {
      const clean = initialMonth.replace('-', '').toUpperCase();
      setMonthYear(clean);
    }
  }, [initialMonth]);

  useEffect(() => {
    if (initialOwnerCode !== undefined && initialOwnerCode !== selectedOwnerCode) {
      setSelectedOwnerCode(initialOwnerCode);
    }
  }, [initialOwnerCode]);

  // Sync initialExcelTab from parent navigation
  useEffect(() => {
    if (initialExcelTab) {
      setActiveExcelTab(initialExcelTab);
    }
  }, [initialExcelTab]);

  // Fetch posted owners whenever month changes (or on mount)
  const fetchPostedOwners = useCallback(async (month: string) => {
    setOwnersLoading(true);
    try {
      const owners = await api.getPostedGroupOwners(month || undefined);
      setPostedOwners(owners);
      // Preserve current selection if non-empty; only default to owners[0] when empty
      setSelectedOwnerCode(prev => {
        if (prev === '') {
          return owners.length > 0 ? owners[0].prfOwnCode : '';
        }
        return prev;
      });
    } catch (err) {
      console.error('Failed to load posted group owners', err);
      setPostedOwners([]);
    } finally {
      setOwnersLoading(false);
    }
  }, []);

  // Load posted owners when month changes
  useEffect(() => {
    fetchPostedOwners(cleanMonth);
  }, [cleanMonth, fetchPostedOwners]);

  const skipAutoLoadRef = useRef<boolean>(false);

  const handleLoad = async () => {
    if (!selectedOwnerCode) {
      setError('Please select a Profile Group Owner.');
      return;
    }
    if (!cleanMonth) {
      setError('Please enter a valid invoice month (e.g. SEP26).');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Direct fast excel-view load (auto-generates if not yet present)
      const freshData = await api.getProfileInvoiceExcelView(Number(selectedOwnerCode), cleanMonth);
      setData(freshData);
      setSelectedRowIndices(computeInitialSelectedIndices(freshData));
      setProcessMsg(null);
    } catch (err: any) {
      console.error('Failed to load excel view', err);
      setError(err?.message || 'Failed to load excel view from server.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!selectedOwnerCode || !cleanMonth) return;

    setDownloading(true);
    try {
      const blob = await api.downloadProfileInvoiceExcel(Number(selectedOwnerCode), cleanMonth);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Profile_Invoice_${selectedOwnerCode}_${cleanMonth}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error('Download failed', err);
      setError(err?.message || 'Failed to download Excel file.');
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    if (skipAutoLoadRef.current) {
      skipAutoLoadRef.current = false;
      return;
    }
    if (selectedOwnerCode && cleanMonth && activeExcelTab === 'sheet') {
      handleLoad();
    }
  }, [selectedOwnerCode, cleanMonth, activeExcelTab]);

  // Navigate from Unprocessed tab to Excel Sheet View
  const handleNavigateFromUnprocessed = useCallback(async (prfownCode: number, month: string) => {
    const cleaned = month.trim().replace('-', '').toUpperCase();
    skipAutoLoadRef.current = true;
    setActiveExcelTab('sheet');
    setMonthYear(cleaned);
    if (onMonthChange) onMonthChange(cleaned);

    setLoading(true);
    setError(null);
    try {
      // 1. Generate invoices (if not yet generated) and load complete Excel view
      const genResult = await api.generateAndOpenProfileInvoices(prfownCode, cleaned);
      const targetOwnerCode = genResult.groupOwnerCode || prfownCode;

      setSelectedOwnerCode(targetOwnerCode);
      if (onOwnerChange) onOwnerChange(targetOwnerCode);

      const genData = genResult.excelView || (await api.getProfileInvoiceExcelView(targetOwnerCode, cleaned));
      setData(genData);
      setSelectedRowIndices(computeInitialSelectedIndices(genData));
      setProcessMsg(null);

      // Refresh posted owners list and ensure this owner is present in dropdown
      const owners = await api.getPostedGroupOwners(cleaned);
      if (genResult.groupOwnerName && !owners.some(o => o.prfOwnCode === targetOwnerCode)) {
        owners.push({
          prfOwnCode: targetOwnerCode,
          profileName: genResult.groupOwnerName
        });
      }
      setPostedOwners(owners);

      const monthsList = await api.getInvoicedMonths(targetOwnerCode);
      setAvailableMonths(monthsList);
    } catch (err: any) {
      console.error('Failed to generate and open excel view from unprocessed', err);
      try {
        const fallback = await api.getProfileInvoiceExcelView(prfownCode, cleaned);
        const resolvedCode = fallback.groupOwnerCode || prfownCode;
        setSelectedOwnerCode(resolvedCode);
        if (onOwnerChange) onOwnerChange(resolvedCode);
        setData(fallback);
        setSelectedRowIndices(computeInitialSelectedIndices(fallback));
        const owners = await api.getPostedGroupOwners(cleaned);
        if (fallback.groupOwnerName && !owners.some(o => o.prfOwnCode === resolvedCode)) {
          owners.push({ prfOwnCode: resolvedCode, profileName: fallback.groupOwnerName });
        }
        setPostedOwners(owners);
      } catch (fallbackErr: any) {
        setError(err?.message || fallbackErr?.message || 'Failed to load excel view from server.');
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, [onMonthChange, onOwnerChange]);

  const handleToggleIncluded = async (code: number, checked: boolean) => {
    if (!checkConfirmFinalized()) return;

    const prevData = data;
    setTogglingCode(code);
    setError(null);
    try {
      const payload: ProfileInvoiceRowUpdateRequest = { isIncluded: checked };

      // Bundle active cell edit on this row if any
      if (editingCell && editingCell.code === code) {
        const val = parseFloat(editingCell.value);
        if (!isNaN(val)) {
          if (editingCell.field === 'finalUsd' || editingCell.field === 'otherCharge') {
            payload.chargedAmtUsd = val;
            payload.totalCost = val;
          } else if (editingCell.field === 'totalCost') {
            payload.totalCost = val;
          } else if (editingCell.field === 'agreedRate') {
            payload.agreedRate = val;
          }
        } else if (editingCell.field === 'serviceHead') {
          payload.remarks = editingCell.value;
        }
        setEditingCell(null);
      }

      const res = await api.updateProfileInvoiceRow(code, payload);
      if (res.excelView) {
        setData(res.excelView);
      } else {
        const fresh = await api.getProfileInvoiceExcelView(Number(selectedOwnerCode), cleanMonth);
        setData(fresh);
      }
    } catch (err: any) {
      console.error('Failed to update included status', err);
      setData(prevData); // rollback on fail
      setError(err?.message || 'Failed to update checkbox status.');
    } finally {
      setTogglingCode(null);
    }
  };

  const handleCellSave = async () => {
    if (!editingCell || !data) return;
    const { rowType, code, projectCode, field, value } = editingCell;

    if (!checkConfirmFinalized()) {
      setEditingCell(null);
      return;
    }

    const prevData = data;
    try {
      setSavingCell(true);
      setError(null);

      if ((rowType === 'ProjectHeader' || field === 'agreedRate') && projectCode) {
        const req: ProfileInvoiceProjectUpdateRequest = {
          monthYear: cleanMonth,
          groupOwnerCode: Number(selectedOwnerCode)
        };

        if (field === 'agreedRate') {
          const cleanVal = (value || '').replace(/[^0-9.-]+/g, '');
          const num = parseFloat(cleanVal);
          if (isNaN(num) || num < 0) {
            flashMsg('error', 'Please enter a valid non-negative rate.');
            setEditingCell(null);
            return;
          }
          req.agreedRate = num;
        } else if (field === 'hoursDays') {
          const parts = value.split('/');
          if (parts.length === 2) {
            req.proRateDays = parseInt(parts[0], 10) || 0;
            req.monthDays = parseInt(parts[1], 10) || 0;
          } else {
            req.proRateDays = parseInt(parts[0], 10) || 0;
          }
        } else if (field === 'salaryRate') {
          req.salaryRate = value;
        }

        const res = await api.updateProfileInvoiceProject(projectCode, req);
        if (res.excelView) {
          setData(res.excelView);
        } else {
          const fresh = await api.getProfileInvoiceExcelView(Number(selectedOwnerCode), cleanMonth);
          setData(fresh);
        }
        flashMsg('success', res.message || `Project #${projectCode} rate successfully updated in database.`);
      } else if (code) {
        const req: ProfileInvoiceRowUpdateRequest = {};
        if (field === 'finalUsd' || field === 'otherCharge') {
          const cleanVal = (value || '').replace(/[^0-9.-]+/g, '');
          const num = parseFloat(cleanVal);
          if (isNaN(num)) { setEditingCell(null); return; }
          req.chargedAmtUsd = num;
          req.totalCost = num;
        } else if (field === 'totalCost') {
          const cleanVal = (value || '').replace(/[^0-9.-]+/g, '');
          const num = parseFloat(cleanVal);
          if (isNaN(num)) { setEditingCell(null); return; }
          req.totalCost = num;
        } else if (field === 'agreedRate') {
          const cleanVal = (value || '').replace(/[^0-9.-]+/g, '');
          const num = parseFloat(cleanVal);
          if (isNaN(num) || num < 0) {
            flashMsg('error', 'Please enter a valid non-negative rate.');
            setEditingCell(null);
            return;
          }
          req.agreedRate = num;
        } else if (field === 'serviceHead') {
          req.remarks = value;
        }

        const res = await api.updateProfileInvoiceRow(code, req);
        if (res.excelView) {
          setData(res.excelView);
        } else {
          const fresh = await api.getProfileInvoiceExcelView(Number(selectedOwnerCode), cleanMonth);
          setData(fresh);
        }
        flashMsg('success', res.message || 'Row successfully updated.');
      }
    } catch (err: any) {
      console.error('Failed to update cell amount', err);
      setData(prevData); // rollback on fail
      setError(err?.message || 'Failed to update amount.');
      flashMsg('error', err?.message || 'Failed to update amount.');
    } finally {
      setSavingCell(false);
      setEditingCell(null);
    }
  };

  const renderEditableCell = (
    rowIdx: number,
    field: EditableField,
    displayValue: React.ReactNode,
    rawValue: string | number | null | undefined,
    rowType: 'ProjectHeader' | 'Detail' | 'Standalone',
    code?: number | null,
    projectCode?: number | null,
    align: 'left' | 'right' | 'center' = 'right'
  ) => {
    const isEditing = editingCell?.rowIdx === rowIdx && editingCell.field === field;
    const canEdit = (rowType === 'ProjectHeader' && (field === 'agreedRate' || field === 'hoursDays' || field === 'salaryRate')) ||
                   ((rowType === 'Detail' || rowType === 'Standalone') && (field === 'finalUsd' || field === 'totalCost' || field === 'otherCharge' || field === 'serviceHead' || field === 'agreedRate'));

    if (!canEdit) {
      return displayValue;
    }

    if (isEditing) {
      return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start', width: '100%' }}>
          <input
            type={field === 'hoursDays' || field === 'salaryRate' || field === 'serviceHead' ? 'text' : 'number'}
            autoFocus
            value={editingCell.value}
            disabled={savingCell}
            onChange={(e) => setEditingCell(prev => prev ? { ...prev, value: e.target.value } : null)}
            onBlur={handleCellSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCellSave();
              if (e.key === 'Escape') setEditingCell(null);
            }}
            style={{
              width: field === 'hoursDays' || field === 'serviceHead' ? '95px' : '70px',
              padding: '0.1rem 0.25rem',
              fontSize: '0.75rem',
              textAlign: align,
              background: 'var(--bg-surface)',
              border: '2px solid #3b82f6',
              borderRadius: '3px',
              color: 'var(--text-main)',
              fontFamily: 'var(--font-mono)'
            }}
          />
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              handleCellSave();
            }}
            title="Save (Tick)"
            style={{
              background: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: '3px',
              padding: '2px 4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <Check size={11} />
          </button>
        </div>
      );
    }

    return (
      <div
        onClick={() => {
          if (!checkConfirmFinalized()) return;
          setEditingCell({
            rowIdx,
            rowType,
            code: code ?? undefined,
            projectCode: projectCode ?? undefined,
            field,
            value: String(rawValue ?? '')
          });
        }}
        title="Click to edit"
        style={{
          cursor: 'pointer',
          padding: '0.1rem 0.2rem',
          borderRadius: '3px',
          display: 'inline-block',
          minWidth: '20px'
        }}
        className="editable-cell-hover"
      >
        {displayValue}
      </div>
    );
  };

  // ── Flash helper ─────────────────────────────────────────────────────────────
  const flashMsg = (type: 'success' | 'error', text: string) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), 4000);
  };

  // ── Helpers for batch selection ───────────────────────────────────────────────
  // Returns rows that can be selected: Detail/Standalone (cmpProfInvoiceCode) or
  // ProjectHeader (childInvoiceCodes), that are NOT already processed.
  const getSelectableRows = (): { idx: number; codes: number[] }[] => {
    if (!data) return [];
    return data.rows.reduce<{ idx: number; codes: number[] }[]>((acc, row, idx) => {
      if (row.isProcessed) return acc;
      if (row.isToBeDiscussed || row.toBeDiscussed) return acc;
      if (row.rowType === 'ProjectHeader') {
        const codes = row.childInvoiceCodes?.length ? row.childInvoiceCodes : [];
        if (codes.length > 0) acc.push({ idx, codes });
      } else if ((row.rowType === 'Detail' || row.rowType === 'Standalone') && row.cmpProfInvoiceCode) {
        acc.push({ idx, codes: [row.cmpProfInvoiceCode] });
      }
      return acc;
    }, []);
  };

  // Collect all invoice codes for currently selected row indices
  const getSelectedCodes = (): number[] => {
    if (!data) return [];
    const unique = new Set<number>();
    data.rows.forEach((row, idx) => {
      if (!selectedRowIndices.has(idx)) return;
      if (row.rowType === 'ProjectHeader') {
        (row.childInvoiceCodes ?? []).forEach(c => unique.add(c));
      } else if ((row.rowType === 'Detail' || row.rowType === 'Standalone') && row.cmpProfInvoiceCode) {
        unique.add(row.cmpProfInvoiceCode);
      }
    });
    return [...unique];
  };

  const selectableRows = getSelectableRows();
  const allSelectableIndices = new Set(selectableRows.map(r => r.idx));
  const allSelected = allSelectableIndices.size > 0 && [...allSelectableIndices].every(i => selectedRowIndices.has(i));
  const someSelected = [...allSelectableIndices].some(i => selectedRowIndices.has(i));
  const selectedCodesCount = getSelectedCodes().length;

  const handleSelectAll = async () => {
    if (!data || allSelectableIndices.size === 0) return;
    if (!checkConfirmFinalized()) return;

    // Collect all codes for currently unchecked rows
    const uncheckedCodes: number[] = [];
    selectableRows.forEach(sr => {
      if (!selectedRowIndices.has(sr.idx)) {
        uncheckedCodes.push(...sr.codes);
      }
    });

    const uniqueUncheckedCodes = [...new Set(uncheckedCodes)];
    if (uniqueUncheckedCodes.length > 0) {
      try {
        await api.removeFromToBeDiscussed(uniqueUncheckedCodes);
        setData(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            rows: prev.rows.map(r => {
              if (r.cmpProfInvoiceCode && uniqueUncheckedCodes.includes(r.cmpProfInvoiceCode)) {
                return { ...r, isToBeDiscussed: false, toBeDiscussed: false };
              }
              return r;
            })
          };
        });
      } catch (err: any) {
        flashMsg('error', err?.message || 'Failed to remove from To Be Discussed.');
        return;
      }
    }

    setSelectedRowIndices(new Set(allSelectableIndices));
  };

  const handleDeselectAll = async () => {
    if (!data || allSelectableIndices.size === 0) return;
    if (!checkConfirmFinalized()) return;

    // Collect all codes for currently checked rows
    const checkedCodes: number[] = [];
    selectableRows.forEach(sr => {
      if (selectedRowIndices.has(sr.idx)) {
        checkedCodes.push(...sr.codes);
      }
    });

    const uniqueCheckedCodes = [...new Set(checkedCodes)];
    if (uniqueCheckedCodes.length > 0) {
      try {
        await api.addToBeDiscussed(uniqueCheckedCodes);
        setData(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            rows: prev.rows.map(r => {
              if (r.cmpProfInvoiceCode && uniqueCheckedCodes.includes(r.cmpProfInvoiceCode)) {
                return { ...r, isToBeDiscussed: true, toBeDiscussed: true };
              }
              return r;
            })
          };
        });
      } catch (err: any) {
        flashMsg('error', err?.message || 'Failed to mark as To Be Discussed.');
        return;
      }
    }

    setSelectedRowIndices(new Set());
  };

  const handleToggleRowSelection = async (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data) return;

    const row = data.rows[idx];
    if (row.isProcessed || row.rowType === 'Blank' || row.rowType === 'StackHeader') return;

    if (!checkConfirmFinalized()) return;

    const isCurrentlyChecked = selectedRowIndices.has(idx);

    let codes: number[] = [];
    const affectedIndices = new Set<number>([idx]);

    if (row.rowType === 'ProjectHeader') {
      codes = row.childInvoiceCodes?.length ? [...row.childInvoiceCodes] : [];
      data.rows.forEach((r, i) => {
        if ((r.rowType === 'Detail' || r.rowType === 'Standalone') && r.cmpProfInvoiceCode && codes.includes(r.cmpProfInvoiceCode)) {
          affectedIndices.add(i);
        }
      });
    } else if ((row.rowType === 'Detail' || row.rowType === 'Standalone') && row.cmpProfInvoiceCode) {
      codes = [row.cmpProfInvoiceCode];
    }

    if (codes.length === 0) return;

    if (isCurrentlyChecked) {
      // ── Uncheck: send to To Be Discussed (turn row red) ──
      try {
        await api.addToBeDiscussed(codes);
        setData(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            rows: prev.rows.map((r, i) => {
              if (affectedIndices.has(i) || (r.cmpProfInvoiceCode && codes.includes(r.cmpProfInvoiceCode))) {
                return { ...r, isToBeDiscussed: true, toBeDiscussed: true };
              }
              return r;
            })
          };
        });
        setSelectedRowIndices(prev => {
          const next = new Set(prev);
          affectedIndices.forEach(i => next.delete(i));
          return next;
        });
      } catch (err: any) {
        flashMsg('error', err?.message || 'Failed to mark as To Be Discussed.');
      }
    } else {
      // ── Check: remove from To Be Discussed (revert row to normal) ──
      try {
        await api.removeFromToBeDiscussed(codes);
        setData(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            rows: prev.rows.map((r, i) => {
              if (affectedIndices.has(i) || (r.cmpProfInvoiceCode && codes.includes(r.cmpProfInvoiceCode))) {
                return { ...r, isToBeDiscussed: false, toBeDiscussed: false };
              }
              return r;
            })
          };
        });
        setSelectedRowIndices(prev => {
          const next = new Set(prev);
          affectedIndices.forEach(i => next.add(i));
          return next;
        });
      } catch (err: any) {
        flashMsg('error', err?.message || 'Failed to remove from To Be Discussed.');
      }
    }
  };

  const handleSaveAndEmail = async () => {
    if (!someSelected || !data) return;
    if (editingCell) {
      try {
        await handleCellSave();
      } catch (err: any) {
        flashMsg('error', err?.message || 'Failed to save pending cell edit.');
        return;
      }
    }
    const codes = getSelectedCodes();
    if (codes.length === 0) return;

    const previewRows: any[] = [];
    data.rows.forEach(row => {
      if ((row.rowType === 'Detail' || row.rowType === 'Standalone') && row.cmpProfInvoiceCode && codes.includes(row.cmpProfInvoiceCode)) {
        previewRows.push({
          cmpProfInvoiceCode: row.cmpProfInvoiceCode,
          projectName: row.projectName,
          stack: row.stack,
          invoiceToName: row.profileOwner || data.groupOwnerName,
          chargedAmtUsd: row.chargedAmtUsd ?? ((row.finalUsd ?? 0) + (row.shareAmount ?? 0)),
          profileName: row.profileOwner || data.groupOwnerName,
          isForeign: row.isForeign,
          isProcessed: row.isProcessed
        });
      }
    });

    setEmailSelectedCodes(codes);
    setEmailSelectedRows(previewRows);
    setActiveExcelTab('email');
  };

  const handleSaveAndProcess = async () => {
    if (!someSelected || !data) return;
    if (editingCell) {
      try {
        await handleCellSave();
      } catch (err: any) {
        flashMsg('error', err?.message || 'Failed to save pending cell edit.');
        return;
      }
    }
    const codes = getSelectedCodes();
    if (codes.length === 0) return;

    const ok = window.confirm(`${codes.length} rows process hongi. Kya aap sure hain?`);
    if (!ok) return;

    setProcessingSelected(true);
    setProcessMsg(null);
    try {
      const res = await api.processInvoices(codes);
      if (!res.success) {
        setProcessMsg({ type: 'error', text: res.message || 'Failed to process invoices.' });
        flashMsg('error', res.message || 'Failed to process invoices.');
        return;
      }
      setProcessMsg({ type: 'success', text: res.message || `${res.updatedCount} invoice(s) processed successfully.` });
      flashMsg('success', res.message || `${res.updatedCount} invoice(s) processed successfully.`);
      await handleLoad();
    } catch (err: any) {
      const msg = err?.message || 'Failed to process invoices.';
      setProcessMsg({ type: 'error', text: msg });
      flashMsg('error', msg);
    } finally {
      setProcessingSelected(false);
    }
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {/* Sub-tabs inside Excel View */}
      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => setActiveExcelTab('sheet')}
          className="compact-tab-btn"
          style={{
            border: activeExcelTab === 'sheet' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
            background: activeExcelTab === 'sheet' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
            color: activeExcelTab === 'sheet' ? '#fff' : 'var(--text-muted)'
          }}
        >
          <FileSpreadsheet size={13} />
          Excel Sheet View
        </button>

        <button
          onClick={() => setActiveExcelTab('unprocessed')}
          className="compact-tab-btn"
          style={{
            border: activeExcelTab === 'unprocessed' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
            background: activeExcelTab === 'unprocessed' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
            color: activeExcelTab === 'unprocessed' ? '#fff' : 'var(--text-muted)'
          }}
        >
          <Clock size={13} />
          Unprocessed
        </button>

        <button
          onClick={() => setActiveExcelTab('discussed')}
          className="compact-tab-btn"
          style={{
            border: activeExcelTab === 'discussed' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
            background: activeExcelTab === 'discussed' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
            color: activeExcelTab === 'discussed' ? '#fff' : 'var(--text-muted)'
          }}
        >
          <MessageSquare size={13} />
          To Be Discussed
        </button>

        <button
          onClick={() => setActiveExcelTab('processed')}
          className="compact-tab-btn"
          style={{
            border: activeExcelTab === 'processed' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
            background: activeExcelTab === 'processed' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
            color: activeExcelTab === 'processed' ? '#fff' : 'var(--text-muted)'
          }}
        >
          <Archive size={13} />
          Processed
        </button>

        <button
          onClick={() => setActiveExcelTab('email')}
          className="compact-tab-btn"
          style={{
            border: activeExcelTab === 'email' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
            background: activeExcelTab === 'email' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
            color: activeExcelTab === 'email' ? '#fff' : 'var(--text-muted)'
          }}
        >
          <Mail size={13} />
          Email
        </button>

        <button
          onClick={() => setActiveExcelTab('audit')}
          className="compact-tab-btn"
          style={{
            border: activeExcelTab === 'audit' ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
            background: activeExcelTab === 'audit' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
            color: activeExcelTab === 'audit' ? '#fff' : 'var(--text-muted)'
          }}
        >
          <History size={13} />
          Change Summary
        </button>

        {/* Divider */}
        {activeExcelTab === 'sheet' && (
          <>
            <div style={{ width: '1px', height: '20px', background: 'var(--border-subtle)', margin: '0 2px' }} />
          </>
        )}
      </div>

      {activeExcelTab === 'audit' ? (
        <ProfileInvoiceAuditTab
          groupOwners={postedOwners}
          initialOwnerCode={selectedOwnerCode}
          initialMonth={cleanMonth}
        />
      ) : activeExcelTab === 'unprocessed' ? (
        <ProfileInvoiceUnprocessedTab
          initialMonth={cleanMonth}
          onSelectOwner={handleNavigateFromUnprocessed}
        />
      ) : activeExcelTab === 'discussed' ? (
        <ProfileInvoiceToBeDiscussedTab
          groupOwners={postedOwners}
          initialOwnerCode={selectedOwnerCode}
          initialMonth={cleanMonth}
        />
      ) : activeExcelTab === 'processed' ? (
        <ProfileInvoiceProcessedTab
          groupOwners={postedOwners}
          initialOwnerCode={selectedOwnerCode}
          initialMonth={cleanMonth}
        />
      ) : activeExcelTab === 'email' ? (
        <ProfileInvoiceEmailTab
          groupOwners={postedOwners.length > 0 ? postedOwners : _groupOwners}
          initialOwnerCode={selectedOwnerCode}
          initialMonth={cleanMonth}
          selectedCodes={emailSelectedCodes ?? undefined}
          selectedRowsPreview={emailSelectedRows ?? undefined}
          onNavigateToUnprocessed={(targetOwner, targetMonth) => {
            if (targetOwner) setSelectedOwnerCode(targetOwner);
            if (targetMonth) setMonthYear(targetMonth);
            setActiveExcelTab('sheet');
            setEmailSelectedCodes(null);
            setEmailSelectedRows(null);
          }}
          onOwnerChange={(newOwner) => {
            setSelectedOwnerCode(newOwner);
            if (onOwnerChange) onOwnerChange(newOwner);
          }}
          onMonthChange={(newMonth) => {
            setMonthYear(newMonth);
            if (onMonthChange) onMonthChange(newMonth);
          }}
        />
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {/* Action notification banner */}
          {actionMsg && (
            <div style={{
              padding: '0.25rem 0.6rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: actionMsg.type === 'success' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${actionMsg.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              color: actionMsg.type === 'success' ? '#10b981' : '#ef4444'
            }}>
              {actionMsg.type === 'success' ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
              {actionMsg.text}
            </div>
          )}
          <div className="compact-toolbar" style={{ minHeight: '28px', padding: '2px 6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                Owner:
              </span>
              <div style={{ width: '200px' }}>
                <OwnerSearchSelect
                  owners={postedOwners}
                  value={selectedOwnerCode}
                  onChange={(val) => setSelectedOwnerCode(val)}
                  allowAll={false}
                  placeholder={ownersLoading ? 'Loading...' : postedOwners.length === 0 ? 'No posted invoices' : 'Select Owner...'}
                  emptyMessage={postedOwners.length === 0 ? 'No posted invoices' : 'No owners found'}
                  compact={true}
                />
              </div>

              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: '0.2rem' }}>
                Month:
              </span>
              <select
                value={cleanMonth}
                onChange={(e) => {
                  const val = e.target.value;
                  setMonthYear(val);
                  if (onMonthChange) onMonthChange(val);
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

              <button
                onClick={handleLoad}
                disabled={loading || downloading}
                className="btn-secondary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  padding: '1px 7px',
                  height: '24px',
                  fontSize: '0.75rem',
                  fontWeight: 600
                }}
              >
                <RefreshCw size={12} className={loading ? 'spin' : ''} />
                {loading ? 'Loading...' : 'Refresh Excel View'}
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <button
                onClick={handleDownload}
                disabled={loading || downloading || !data || data.rows.length === 0}
                className="btn-primary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  padding: '1px 8px',
                  height: '24px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  background: '#059669',
                  borderColor: '#059669'
                }}
              >
                <Download size={12} className={downloading ? 'spin' : ''} />
                {downloading ? 'Downloading...' : 'Download XLSX'}
              </button>

              {/* Save & Email button */}
              <button
                onClick={handleSaveAndEmail}
                disabled={!someSelected || processingSelected || !data}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.3rem',
                  padding: '1px 8px', height: '24px', fontSize: '0.75rem', fontWeight: 600,
                  background: someSelected ? '#6366f1' : 'var(--bg-secondary)',
                  color: someSelected ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${someSelected ? '#6366f1' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: someSelected ? 'pointer' : 'not-allowed',
                  opacity: someSelected ? 1 : 0.5
                }}
                title={someSelected ? `Send ${selectedCodesCount} selected invoices by email` : 'Select rows first'}
              >
                <Mail size={12} />
                Save & Email
              </button>

              {/* Save & Process button */}
              <button
                onClick={handleSaveAndProcess}
                disabled={!someSelected || processingSelected || !data}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.3rem',
                  padding: '1px 8px', height: '24px', fontSize: '0.75rem', fontWeight: 600,
                  background: someSelected ? '#10b981' : 'var(--bg-secondary)',
                  color: someSelected ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${someSelected ? '#10b981' : 'var(--border-subtle)'}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: someSelected ? 'pointer' : 'not-allowed',
                  opacity: someSelected ? 1 : 0.5
                }}
                title={someSelected ? `Process ${selectedCodesCount} selected invoices` : 'Select rows first'}
              >
                <CheckCircle size={12} />
                {processingSelected ? 'Processing...' : 'Save & Process'}
              </button>
            </div>
          </div>

          {error && (
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
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Excel Sheet Table Container with full viewport height & sticky header */}
          {/* ── Batch Selection Toolbar ──────────────────────────────────── */}
          {data && data.rows.length > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '3px 6px',
              background: someSelected ? 'rgba(16,185,129,0.07)' : 'var(--bg-secondary)',
              border: `1px solid ${someSelected ? 'rgba(16,185,129,0.3)' : 'var(--border-subtle)'}`,
              borderRadius: 'var(--radius-sm)',
              flexWrap: 'wrap',
              transition: 'background 0.2s, border-color 0.2s'
            }}>
              {/* Select All / Deselect All buttons */}
              <button
                onClick={handleSelectAll}
                disabled={allSelected || allSelectableIndices.size === 0}
                style={{
                  padding: '2px 10px',
                  height: '24px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  background: allSelected ? 'rgba(16,185,129,0.15)' : '#10b981',
                  color: allSelected ? '#10b981' : '#fff',
                  border: `1px solid ${allSelected ? '#10b981' : '#10b981'}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: (allSelected || allSelectableIndices.size === 0) ? 'not-allowed' : 'pointer',
                  opacity: (allSelected || allSelectableIndices.size === 0) ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}
              >
                ✓ Select All ({allSelectableIndices.size})
              </button>

              {someSelected && (
                <button
                  onClick={handleDeselectAll}
                  style={{
                    padding: '2px 10px',
                    height: '24px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}
                >
                  ✕ Deselect All
                </button>
              )}

              {/* Selected count badge */}
              {someSelected && (
                <span style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: '#10b981',
                  background: 'rgba(16,185,129,0.12)',
                  border: '1px solid rgba(16,185,129,0.3)',
                  borderRadius: '10px',
                  padding: '1px 8px',
                  fontFamily: 'var(--font-mono)'
                }}>
                  Selected: {selectedCodesCount} of {selectableRows.reduce((acc, r) => acc + r.codes.length, 0)}
                </span>
              )}

              {/* Not-selected hint */}
              {!someSelected && allSelectableIndices.size > 0 && (
                <span style={{ fontSize: '0.68rem', color: 'var(--text-subtle)', marginLeft: '2px' }}>
                  Check/uncheck rows to select for email or processing →
                </span>
              )}
              {allSelectableIndices.size === 0 && (
                <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 600 }}>
                  ✓ All invoices for this owner are already processed
                </span>
              )}
            </div>
          )}

          {/* Process result message */}
          {processMsg && (
            <div style={{
              padding: '0.3rem 0.6rem',
              background: processMsg.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${processMsg.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              borderRadius: 'var(--radius-sm)',
              color: processMsg.type === 'success' ? '#10b981' : '#ef4444',
              fontSize: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}>
              {processMsg.type === 'success' ? '✓' : '⚠'} {processMsg.text}
            </div>
          )}

          <div className="compact-table-container">
            <table className="compact-table">
              <thead>
                {/* ── Summary Totals Row (Directly Above Respective Columns) ── */}
                {data && (
                  <tr className="summary-header-row">
                    {/* colSpan=6: Checkbox, Profile Owner (A), Proj (B), Stack (C), Project Name (D), Service Head (E) */}
                    <th
                      colSpan={6}
                      style={{
                        background: 'var(--bg-secondary)',
                        borderRight: '1px solid var(--border-subtle)',
                        borderBottom: '2px solid var(--border-medium)',
                        padding: '4px 10px',
                        textAlign: 'left',
                        verticalAlign: 'middle',
                        position: 'sticky',
                        top: 0,
                        zIndex: 12
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                          <span style={{ fontSize: '0.94rem', fontWeight: 900, color: 'var(--text-main)' }}>
                            {data.groupOwnerName}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                            ({data.monthYear})
                          </span>
                        </div>

                        {/* TOTAL INVOICE prominent display */}
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'baseline',
                          gap: '0.35rem',
                          background: 'rgba(16, 185, 129, 0.12)',
                          border: '1.5px solid rgba(16, 185, 129, 0.35)',
                          padding: '2px 8px',
                          borderRadius: '4px'
                        }}>
                          <span style={{ fontSize: '0.70rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            TOTAL INVOICE:
                          </span>
                          <span style={{ fontSize: '1.12rem', fontWeight: 900, color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                            ${data.totalInvoice.toLocaleString()}
                          </span>
                        </div>

                        <div style={{ fontSize: '0.70rem', color: 'var(--text-subtle)', fontWeight: 600 }}>
                          {data.totalSavedRows} rows ({data.totalProjectBlocks} proj)
                        </div>
                      </div>
                    </th>

                    {/* Column 7: Directly above Final USD / Total Cost */}
                    <th
                      style={{
                        background: 'var(--bg-secondary)',
                        borderRight: '1px solid var(--border-subtle)',
                        borderBottom: '2px solid var(--border-medium)',
                        padding: '4px 8px',
                        textAlign: 'right',
                        verticalAlign: 'middle',
                        position: 'sticky',
                        top: 0,
                        zIndex: 12
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
                          TOTAL COST / TOTAL USD
                        </div>
                        <div style={{ fontSize: '1.12rem', fontWeight: 900, color: 'var(--excel-cost-color)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                          ${(data.finalUsdSum ?? data.totalCostSum).toLocaleString()}
                        </div>
                      </div>
                    </th>

                    {/* Column 8: Directly above Agreed (H) */}
                    <th
                      style={{
                        background: 'var(--bg-secondary)',
                        borderRight: '1px solid var(--border-subtle)',
                        borderBottom: '2px solid var(--border-medium)',
                        padding: '4px 8px',
                        textAlign: 'right',
                        verticalAlign: 'middle',
                        position: 'sticky',
                        top: 0,
                        zIndex: 12
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
                          TOTAL AGREED
                        </div>
                        <div style={{ fontSize: '1.12rem', fontWeight: 900, color: 'var(--excel-agreed-color)', fontFamily: 'var(--font-mono)' }}>
                          ${(data.agreedRateSum ?? 0).toLocaleString()}
                        </div>
                      </div>
                    </th>

                    {/* Column 9: Directly above Hrs/Dys (I) */}
                    <th
                      style={{
                        background: 'var(--bg-secondary)',
                        borderRight: '1px solid var(--border-subtle)',
                        borderBottom: '2px solid var(--border-medium)',
                        padding: '4px',
                        textAlign: 'center',
                        verticalAlign: 'middle',
                        position: 'sticky',
                        top: 0,
                        zIndex: 12
                      }}
                    >
                      <span style={{ fontSize: '0.70rem', color: 'var(--text-subtle)' }}>—</span>
                    </th>

                    {/* Column 10: Directly above Actual (J) */}
                    <th
                      style={{
                        background: 'var(--bg-secondary)',
                        borderRight: '1px solid var(--border-subtle)',
                        borderBottom: '2px solid var(--border-medium)',
                        padding: '4px 8px',
                        textAlign: 'right',
                        verticalAlign: 'middle',
                        position: 'sticky',
                        top: 0,
                        zIndex: 12
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
                          TOTAL ACTUAL
                        </div>
                        <div style={{ fontSize: '1.12rem', fontWeight: 900, color: 'var(--excel-actual-color)', fontFamily: 'var(--font-mono)' }}>
                          ${data.actualChargesSum.toLocaleString()}
                        </div>
                      </div>
                    </th>

                    {/* Column 11: Directly above Other (K) */}
                    <th
                      style={{
                        background: 'var(--bg-secondary)',
                        borderRight: '1px solid var(--border-subtle)',
                        borderBottom: '2px solid var(--border-medium)',
                        padding: '4px 8px',
                        textAlign: 'right',
                        verticalAlign: 'middle',
                        position: 'sticky',
                        top: 0,
                        zIndex: 12
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
                          TOTAL OTHER
                        </div>
                        <div style={{ fontSize: '1.12rem', fontWeight: 900, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>
                          ${data.otherChargeSum.toLocaleString()}
                        </div>
                      </div>
                    </th>

                    {/* Columns 12-16: Inc, Salary Rate / Job Type, Dates (M), Status / Handled In, Nature (P) */}
                    <th
                      colSpan={5}
                      style={{
                        background: 'var(--bg-secondary)',
                        borderBottom: '2px solid var(--border-medium)',
                        padding: '4px 10px',
                        verticalAlign: 'middle',
                        textAlign: 'right',
                        position: 'sticky',
                        top: 0,
                        zIndex: 12
                      }}
                    >
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ width: '10px', height: '10px', background: 'var(--bg-foreign-row)', border: '1.5px solid var(--border-foreign, #2563eb)', borderRadius: '2px', display: 'inline-block' }} />
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--border-foreign, #2563eb)' }}>
                          Foreign (Branch 5)
                        </span>
                      </div>
                    </th>
                  </tr>
                )}

                {/* ── Table Column Headers Row ── */}
                <tr className={`column-header-row ${data ? '' : 'solo'}`}>
                  <th style={{ width: '30px', textAlign: 'center', padding: '0.15rem 0.25rem' }}
                    title="Select / deselect all unprocessed rows"
                  >
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={e => e.target.checked ? handleSelectAll() : handleDeselectAll()}
                      style={{ cursor: 'pointer', width: '13px', height: '13px' }}
                    />
                  </th>
                  <th style={{ minWidth: '110px', textAlign: 'left' }}>Profile Owner (A)</th>
                  <th style={{ width: '45px', textAlign: 'center' }}>Proj (B)</th>
                  <th style={{ minWidth: '85px', textAlign: 'left' }}>Stack (C)</th>
                  <th style={{ minWidth: '120px', textAlign: 'left' }}>Project Name (D)</th>
                  <th style={{ minWidth: '100px', textAlign: 'left' }}>Service Head (E)</th>
                  <th style={{ minWidth: '120px', textAlign: 'right' }}>Final USD / Total Cost</th>
                  <th style={{ minWidth: '70px', textAlign: 'right' }}>Agreed (H)</th>
                  <th style={{ minWidth: '55px', textAlign: 'center' }}>Hrs/Dys (I)</th>
                  <th style={{ minWidth: '70px', textAlign: 'right' }}>Actual (J)</th>
                  <th style={{ minWidth: '65px', textAlign: 'right' }}>Other (K)</th>
                  <th style={{ width: '36px', textAlign: 'center', padding: '0.2rem 0.15rem' }}>Inc</th>
                  <th style={{ minWidth: '100px', textAlign: 'center' }}>Salary Rate / Job Type</th>
                  <th style={{ minWidth: '75px', textAlign: 'center' }}>Dates (M)</th>
                  <th style={{ minWidth: '100px', textAlign: 'center' }}>Status / Handled In</th>
                  <th style={{ minWidth: '60px', textAlign: 'center' }}>Nature (P)</th>
                </tr>
              </thead>
              <tbody>
              {!data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={16} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                    {loading ? 'Loading Excel view...' : 'No saved invoice rows found for this Group Owner and Month.'}
                  </td>
                </tr>
              ) : (
                data.rows.map((row, idx) => {
                  if (row.rowType === 'Blank') {
                    return (
                      <tr key={idx} style={{ height: '8px', background: 'rgba(0,0,0,0.02)' }}>
                        <td colSpan={16} style={{ border: '1px solid var(--border-subtle)', padding: 0 }} />
                      </tr>
                    );
                  }

                  if (row.rowType === 'StackHeader') {
                    return (
                      <tr
                        key={idx}
                        style={{
                          background: 'rgba(99, 102, 241, 0.12)',
                          borderTop: '2px solid rgba(99, 102, 241, 0.35)',
                          borderBottom: '1px solid rgba(99, 102, 241, 0.2)'
                        }}
                      >
                        <td style={{ padding: '0.1rem 0.25rem', border: '1px solid var(--border-subtle)' }} />
                        <td
                          colSpan={15}
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontWeight: 800,
                            fontSize: '0.78rem',
                            color: 'var(--text-main)',
                            border: '1px solid var(--border-subtle)',
                            letterSpacing: '0.02em'
                          }}
                        >
                          <span style={{ color: 'var(--accent-primary)', marginRight: '0.4rem', fontSize: '0.7rem', fontWeight: 700 }}>
                            STACK:
                          </span>
                          {row.stack || 'No Stack'}
                        </td>
                      </tr>
                    );
                  }

                  const isHeader = row.rowType === 'ProjectHeader';
                  const isStandalone = row.rowType === 'Standalone';
                  const isDetail = row.rowType === 'Detail';

                  // Determine if this row is selectable for batch processing
                  const isSelectable = !row.isProcessed && (
                    (isHeader && (row.childInvoiceCodes?.length ?? 0) > 0) ||
                    ((isDetail || isStandalone) && !!row.cmpProfInvoiceCode)
                  );
                  const isCheckedForProcess = selectedRowIndices.has(idx);

                  const getCellHighlight = (colKey: string) => {
                    const isSelected = selectedCell?.rowIdx === idx && selectedCell?.colKey === colKey;
                    return isSelected ? { outline: '2px solid #3b82f6', outlineOffset: '-2px' } : {};
                  };

                  const isDiscuss = !!(row.isToBeDiscussed || row.toBeDiscussed);
                  const isRowSelected = selectedRowIdx === idx;
                  const rowBg = isCheckedForProcess
                    ? isDiscuss ? 'rgba(239, 68, 68, 0.32)' : 'rgba(16,185,129,0.09)'
                    : isRowSelected
                    ? isDiscuss ? 'rgba(239, 68, 68, 0.35)' : 'rgba(59, 130, 246, 0.15)'
                    : isDiscuss
                    ? 'var(--bg-discuss-row)'
                    : row.isForeign
                    ? 'var(--bg-foreign-row)'
                    : isHeader
                    ? 'rgba(99, 102, 241, 0.12)'
                    : isStandalone
                    ? 'rgba(245, 158, 11, 0.04)'
                    : 'transparent';

                  return (
                    <tr 
                      key={idx}
                      className={`table-row-hover ${isDiscuss ? 'discuss-row' : row.isForeign ? 'foreign-row' : ''}`.trim()}
                      onClick={() => setSelectedRowIdx(prev => prev === idx ? null : idx)}
                      style={{
                        background: rowBg,
                        fontWeight: isHeader ? 700 : 400,
                        cursor: 'pointer',
                        outline: isRowSelected ? '2px solid #3b82f6' : undefined,
                        outlineOffset: isRowSelected ? '-1px' : undefined,
                        borderTop: isHeader ? '2px solid rgba(99, 102, 241, 0.4)' : undefined,
                        borderBottom: isHeader ? '2px solid rgba(99, 102, 241, 0.4)' : undefined
                      }}
                    >
                      {/* Checkbox column for batch processing */}
                      <td
                        style={{
                          textAlign: 'center',
                          padding: '0.1rem 0.25rem',
                          border: '1px solid var(--border-subtle)',
                          verticalAlign: 'middle'
                        }}
                        onClick={e => isSelectable ? handleToggleRowSelection(idx, e) : e.stopPropagation()}
                      >
                        {isSelectable && (
                          <input
                            type="checkbox"
                            checked={isCheckedForProcess}
                            onChange={() => {/* handled by td onClick */}}
                            style={{ cursor: 'pointer', width: '13px', height: '13px' }}
                            title={row.isProcessed ? 'Already processed' : 'Select for batch processing'}
                          />
                        )}
                        {row.isProcessed && (isDetail || isStandalone || isHeader) && (
                          <span title="Already processed" style={{ fontSize: '0.65rem', color: '#10b981' }}>✓</span>
                        )}
                      </td>

                      {/* A: Profile Owner */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'A' })}
                        style={{
                          padding: '0.2rem 0.35rem',
                          color: isDiscuss ? 'var(--text-discuss-row)' : isHeader ? 'var(--text-main)' : 'var(--text-muted)',
                          fontWeight: isHeader ? 800 : 400,
                          fontSize: isHeader ? '16px' : 'inherit',
                          border: '1px solid var(--border-subtle)',
                          borderLeft: isDiscuss ? '3px solid var(--border-discuss-row, #dc2626)' : row.isForeign ? '3px solid var(--border-foreign, #2563eb)' : '1px solid var(--border-subtle)',
                          ...getCellHighlight('A')
                        }}
                      >
                        {row.profileOwner || ''}
                      </td>

                      {/* B: Project Code */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'B' })}
                        style={{
                          padding: '0.2rem 0.35rem',
                          textAlign: 'center',
                          fontFamily: 'var(--font-mono)',
                          color: row.projectCode ? 'var(--excel-proj-color)' : 'inherit',
                          fontWeight: isHeader ? 900 : row.projectCode ? 700 : 400,
                          fontSize: isHeader ? '18px' : 'inherit',
                          border: '1px solid var(--border-subtle)',
                          ...getCellHighlight('B')
                        }}
                      >
                        {row.projectCode || ''}
                      </td>

                      {/* C: Stack */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'C' })}
                        style={{
                          padding: '0.2rem 0.35rem',
                          border: '1px solid var(--border-subtle)',
                          color: ((row.stack || '').trim() !== '' && (row.stack || '').trim().toLowerCase() !== 'servicenow')
                            ? 'var(--excel-non-servicenow-color)'
                            : 'inherit',
                          fontWeight: isHeader ? 800 : ((row.stack || '').trim() !== '' && (row.stack || '').trim().toLowerCase() !== 'servicenow') ? 600 : 400,
                          fontSize: isHeader ? '16px' : 'inherit',
                          ...getCellHighlight('C')
                        }}
                      >
                        {row.stack || ''}
                      </td>

                      {/* D: Project Name */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'D' })}
                        style={{
                          padding: '0.2rem 0.35rem',
                          color: isDiscuss ? 'var(--text-discuss-row)' : 'var(--text-main)',
                          fontWeight: isHeader ? 800 : 400,
                          fontSize: isHeader ? '16px' : 'inherit',
                          border: '1px solid var(--border-subtle)',
                          ...getCellHighlight('D')
                        }}
                      >
                        {row.projectName || ''}
                      </td>

                      {/* E: Service Head */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'E' })}
                        style={{ padding: '0.2rem 0.35rem', color: isDiscuss ? 'var(--text-discuss-row)' : !isHeader ? 'var(--text-main)' : 'inherit', border: '1px solid var(--border-subtle)', ...getCellHighlight('E') }}
                      >
                        {renderEditableCell(idx, 'serviceHead', row.serviceHead || '', row.serviceHead, row.rowType, row.cmpProfInvoiceCode, row.projectCode, 'left')}
                      </td>

                      {/* F/G: Final USD / Total Cost */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'FG' })}
                        style={{
                          padding: isHeader ? '0.3rem 0.4rem' : '0.2rem 0.35rem',
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                          border: '1px solid var(--border-subtle)',
                          verticalAlign: 'middle',
                          ...getCellHighlight('FG')
                        }}
                      >
                        {isHeader && (
                          <span style={{ fontWeight: 900, fontSize: '16px', color: 'var(--excel-cost-color)' }}>
                            {renderEditableCell(idx, 'totalCost', row.totalCost != null ? `$${row.totalCost.toLocaleString()}` : '-', row.totalCost, row.rowType, row.cmpProfInvoiceCode, row.projectCode, 'right')}
                          </span>
                        )}

                        {isDetail && (
                          <span style={{ fontWeight: 600, fontSize: '13px', color: isDiscuss ? 'var(--text-discuss-row)' : 'var(--text-main)' }}>
                            {renderEditableCell(idx, 'finalUsd', row.finalUsd != null ? `$${row.finalUsd.toLocaleString()}` : '-', row.finalUsd, row.rowType, row.cmpProfInvoiceCode, row.projectCode, 'right')}
                          </span>
                        )}

                        {isStandalone && (() => {
                          if (row.totalCost != null && row.finalUsd != null && row.totalCost !== row.finalUsd) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
                                <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--excel-cost-color)' }}>
                                  {renderEditableCell(idx, 'totalCost', `$${row.totalCost.toLocaleString()}`, row.totalCost, row.rowType, row.cmpProfInvoiceCode, row.projectCode, 'right')}
                                </span>
                                <span style={{ fontWeight: 600, fontSize: '13px', color: isDiscuss ? 'var(--text-discuss-row)' : 'var(--text-main)' }}>
                                  {renderEditableCell(idx, 'finalUsd', `$${row.finalUsd.toLocaleString()}`, row.finalUsd, row.rowType, row.cmpProfInvoiceCode, row.projectCode, 'right')}
                                </span>
                              </div>
                            );
                          }
                          const val = row.finalUsd ?? row.totalCost;
                          return (
                            <span style={{ fontWeight: 700, fontSize: '14px', color: isDiscuss ? 'var(--text-discuss-row)' : 'var(--text-main)' }}>
                              {renderEditableCell(idx, 'finalUsd', val != null ? `$${val.toLocaleString()}` : '-', val, row.rowType, row.cmpProfInvoiceCode, row.projectCode, 'right')}
                            </span>
                          );
                        })()}
                      </td>

                      {/* H: Agreed Rate */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'H' })}
                        style={{
                          padding: isHeader ? '0.3rem 0.4rem' : '0.2rem 0.35rem',
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: isHeader ? 900 : 700,
                          fontSize: isHeader ? '19px' : '15px',
                          color: 'var(--excel-agreed-color)',
                          border: '1px solid var(--border-subtle)',
                          ...getCellHighlight('H')
                        }}
                      >
                        {renderEditableCell(idx, 'agreedRate', row.agreedRate != null ? `$${row.agreedRate.toLocaleString()}` : '', row.agreedRate, row.rowType, row.cmpProfInvoiceCode, row.projectCode, 'right')}
                      </td>

                      {/* I: Hours/Days */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'I' })}
                        style={{
                          padding: isHeader ? '0.3rem 0.4rem' : '0.2rem 0.35rem',
                          textAlign: 'center',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: isHeader ? 900 : 400,
                          fontSize: isHeader ? '17px' : 'var(--excel-cell-font-size, 15px)',
                          color: isDiscuss ? 'var(--text-discuss-row)' : isHeader ? 'var(--text-main)' : 'inherit',
                          border: '1px solid var(--border-subtle)',
                          ...getCellHighlight('I')
                        }}
                      >
                        {renderEditableCell(idx, 'hoursDays', row.hoursDays || '', row.hoursDays, row.rowType, row.cmpProfInvoiceCode, row.projectCode, 'center')}
                      </td>

                      {/* J: Actual Charges */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'J' })}
                        style={{
                          padding: isHeader ? '0.3rem 0.4rem' : '0.2rem 0.35rem',
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: isHeader ? 900 : 700,
                          fontSize: isHeader ? '19px' : '15px',
                          color: 'var(--excel-actual-color)',
                          border: '1px solid var(--border-subtle)',
                          ...getCellHighlight('J')
                        }}
                      >
                        {row.actualCharges != null ? `$${row.actualCharges.toLocaleString()}` : ''}
                      </td>

                      {/* K: Other Charge */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'K' })}
                        style={{ padding: '0.2rem 0.35rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#b45309', fontWeight: 700, fontSize: '15px', border: '1px solid var(--border-subtle)', ...getCellHighlight('K') }}
                      >
                        {renderEditableCell(idx, 'otherCharge', row.otherCharge != null ? `$${row.otherCharge.toLocaleString()}` : '', row.otherCharge, row.rowType, row.cmpProfInvoiceCode, row.projectCode, 'right')}
                      </td>

                      {/* Inc Checkbox Column (After Other Charge) */}
                      <td style={{
                        textAlign: 'center',
                        padding: '0.15rem 0.25rem',
                        border: '1px solid var(--border-subtle)',
                        whiteSpace: 'nowrap'
                      }}>
                        {(isDetail || isStandalone) && row.cmpProfInvoiceCode ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <input
                              type="checkbox"
                              checked={row.isIncluded ?? true}
                              disabled={togglingCode === row.cmpProfInvoiceCode}
                              onChange={(e) => handleToggleIncluded(row.cmpProfInvoiceCode!, e.target.checked)}
                              title="Include in totals - click to toggle & save"
                              style={{ cursor: 'pointer', width: '14px', height: '14px' }}
                            />
                            {editingCell?.rowIdx === idx && (
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  handleCellSave();
                                }}
                                title="Save changes (Tick)"
                                style={{
                                  background: '#10b981',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '3px',
                                  padding: '2px 4px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                              >
                                <Check size={11} />
                              </button>
                            )}
                          </div>
                        ) : isHeader && editingCell?.rowIdx === idx ? (
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleCellSave();
                            }}
                            title="Save project changes (Tick)"
                            style={{
                              background: '#10b981',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '3px',
                              padding: '2px 4px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              margin: '0 auto'
                            }}
                          >
                            <Check size={11} />
                          </button>
                        ) : null}
                      </td>

                      {/* L/O: Salary Rate / Job Type */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'LO' })}
                        style={{
                          padding: '0.2rem 0.35rem',
                          textAlign: 'center',
                          fontFamily: 'var(--font-mono)',
                          border: '1px solid var(--border-subtle)',
                          verticalAlign: 'middle',
                          ...getCellHighlight('LO')
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center', justifyContent: 'center' }}>
                          {(row.salaryRate || isHeader) ? (
                            <div style={{ fontSize: isHeader ? '15px' : '13px', fontWeight: isHeader ? 800 : 500, lineHeight: 1.2 }}>
                              {renderEditableCell(idx, 'salaryRate', row.salaryRate || (isHeader ? '-' : ''), row.salaryRate, row.rowType, row.cmpProfInvoiceCode, row.projectCode, 'center')}
                            </div>
                          ) : null}
                          {row.jobType ? (
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '0.08rem 0.4rem',
                              borderRadius: '3px',
                              background: 'rgba(99, 102, 241, 0.12)',
                              color: 'var(--accent-primary, #6366f1)',
                              lineHeight: 1.2,
                              whiteSpace: 'nowrap'
                            }}>
                              {row.jobType}
                            </span>
                          ) : null}
                        </div>
                      </td>

                      {/* M: Start / End Date */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'M' })}
                        style={{
                          padding: isHeader ? '0.3rem 0.4rem' : '0.2rem 0.35rem',
                          textAlign: 'center',
                          fontSize: isHeader ? '16px' : 'var(--excel-cell-font-size, 15px)',
                          fontWeight: isHeader ? 800 : 400,
                          color: isDiscuss ? 'var(--text-discuss-row)' : isHeader ? 'var(--text-main)' : 'inherit',
                          border: '1px solid var(--border-subtle)',
                          ...getCellHighlight('M')
                        }}
                      >
                        {row.startEndDate || ''}
                      </td>

                      {/* N/Q: Status / Handled In */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'NQ' })}
                        style={{
                          padding: '0.2rem 0.35rem',
                          textAlign: 'center',
                          border: '1px solid var(--border-subtle)',
                          verticalAlign: 'middle',
                          ...getCellHighlight('NQ')
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center', justifyContent: 'center' }}>
                          {row.projStatus ? (
                            <span style={{
                              fontSize: isHeader ? '13px' : '11px',
                              fontWeight: 800,
                              padding: isHeader ? '0.15rem 0.55rem' : '0.1rem 0.35rem',
                              borderRadius: '4px',
                              background: row.projStatus === 'In-Progress' ? '#047857' : '#b91c1c',
                              color: '#ffffff',
                              lineHeight: 1.2,
                              whiteSpace: 'nowrap'
                            }}>
                              {row.projStatus}
                            </span>
                          ) : null}
                          {row.handledFrom ? (
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              color: '#6366f1',
                              lineHeight: 1.2,
                              whiteSpace: 'nowrap'
                            }}>
                              {row.handledFrom}
                            </span>
                          ) : null}
                        </div>
                      </td>

                      {/* P: Profile Nature */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'P' })}
                        style={{
                          padding: isHeader ? '0.3rem 0.4rem' : '0.2rem 0.35rem',
                          textAlign: 'center',
                          fontWeight: isHeader ? 800 : 400,
                          fontSize: isHeader ? '16px' : 'var(--excel-cell-font-size, 15px)',
                          color: isDiscuss ? 'var(--text-discuss-row)' : isHeader ? 'var(--text-main)' : 'inherit',
                          border: '1px solid var(--border-subtle)',
                          ...getCellHighlight('P')
                        }}
                      >
                        {row.profileNature || ''}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  );
};
