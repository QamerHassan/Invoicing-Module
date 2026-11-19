import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  Archive,
  Users,
  Save,
  Pencil
} from 'lucide-react';
import { api } from '../api/client';
import { LoadingIndicator } from './LoadingIndicator';
import { ProfileInvoiceAuditTab } from './ProfileInvoiceAuditTab';
import { ProfileInvoiceUnprocessedTab } from './ProfileInvoiceUnprocessedTab';
import { ProfileInvoiceToBeDiscussedTab } from './ProfileInvoiceToBeDiscussedTab';
import { ProfileInvoiceProcessedTab } from './ProfileInvoiceProcessedTab';
import { OwnerSearchSelect } from './OwnerSearchSelect';
import type { 
  ProfileGroupOwnerDto, 
  ProfileInvoiceExcelViewResult,
  ProfileInvoiceRowUpdateRequest,
  ProfileInvoiceProjectUpdateRequest,
  ProfileInvoiceUnprocessedRowDto
} from '../types';

interface ProfileInvoiceExcelViewProps {
  groupOwners: ProfileGroupOwnerDto[];
  initialOwnerCode?: number | '';
  initialMonth?: string;
  onMonthChange?: (month: string) => void;
  onOwnerChange?: (ownerCode: number | '') => void;
  initialExcelTab?: 'sheet' | 'audit' | 'unprocessed' | 'discussed' | 'email' | 'processed';
  lockedOwnerName?: string; // NEW: if set, owner is locked from parent
  headerRight?: React.ReactNode;
}

export const ProfileInvoiceExcelView: React.FC<ProfileInvoiceExcelViewProps> = ({
  groupOwners: _groupOwners, // kept for prop compat, not used for dropdown
  initialOwnerCode = '',
  initialMonth = 'SEP26',
  onMonthChange,
  onOwnerChange,
  initialExcelTab,
  lockedOwnerName = '',  // NEW
  headerRight,
}) => {
  const [selectedOwnerCode, setSelectedOwnerCode] = useState<number | ''>(initialOwnerCode);
  const [monthYear, setMonthYear] = useState<string>(initialMonth.replace('-', '').toUpperCase());
  const [data, setData] = useState<ProfileInvoiceExcelViewResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  type EditableField = 'finalUsd' | 'totalCost' | 'agreedRate' | 'appliedCharges' | 'actualCharges' | 'hoursDays' | 'otherCharge' | 'salaryRate' | 'serviceHead' | 'jobType' | 'startEndDate' | 'projStatus' | 'profileNature' | 'handledFrom' | 'projectName' | 'stack';
  const [editingCell, setEditingCell] = useState<{
    rowIdx: number;
    rowType: 'ProjectHeader' | 'Detail' | 'Standalone';
    code?: number;
    projectCode?: number;
    field: EditableField;
    value: string;
    
  } | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ rowIdx: number; colKey: string } | null>(null);
  const [hasConfirmedFinalized, setHasConfirmedFinalized] = useState<boolean>(false);
  type ExcelSubTab = 'sheet' | 'audit' | 'unprocessed' | 'discussed' | 'email' | 'processed';
  const [activeExcelTab, setActiveExcelTab] = useState<ExcelSubTab>(() => {
    if (initialExcelTab) return initialExcelTab;
    const saved = localStorage.getItem('profileInvoice_activeExcelTab');
    if (saved && ['sheet', 'audit', 'unprocessed', 'discussed', 'email', 'processed'].includes(saved)) {
      return saved as ExcelSubTab;
    }
    return 'sheet';
  });

  // Persist active sub-tab so page reloads stay on the same sub-tab (e.g. Email)
  useEffect(() => {
    localStorage.setItem('profileInvoice_activeExcelTab', activeExcelTab);
  }, [activeExcelTab]);

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
  const [allOwners, setAllOwners] = useState<ProfileGroupOwnerDto[]>([]);

  // Email sub-tab integration for Save & Email
  const [emailSelectedCodes, setEmailSelectedCodes] = useState<number[] | null>(null);
  const [, setEmailSelectedRows] = useState<any[] | null>(null);

  // Unprocessed owners for the top navigation dropdown
  const [unprocessedOwners, setUnprocessedOwners] = useState<ProfileInvoiceUnprocessedRowDto[]>([]);
  const [unprocessedLoading, setUnprocessedLoading] = useState<boolean>(false);
  const [unprocessedRefreshKey, setUnprocessedRefreshKey] = useState<number>(0);

  // Manual Save State (auto-save removed as per user request)
  const [pendingRowUpdates, setPendingRowUpdates] = useState<Map<number, ProfileInvoiceRowUpdateRequest>>(new Map());
  const [pendingProjectUpdates, setPendingProjectUpdates] = useState<Map<number, ProfileInvoiceProjectUpdateRequest>>(new Map());
  const [isSavingChanges, setIsSavingChanges] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  const hasUnsavedChanges = pendingRowUpdates.size > 0 || pendingProjectUpdates.size > 0;
  const unsavedCount = pendingRowUpdates.size + pendingProjectUpdates.size;

  const [pendingNavigationTab, setPendingNavigationTab] = useState<ExcelSubTab | null>(null);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState<boolean>(false);

  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([activeExcelTab === 'email' ? 'processed' : activeExcelTab]));
  useEffect(() => {
    const tabKey = (activeExcelTab === 'email') ? 'processed' : activeExcelTab;
    setVisitedTabs(prev => {
      if (prev.has(tabKey)) return prev;
      const next = new Set(prev);
      next.add(tabKey);
      return next;
    });
  }, [activeExcelTab]);

  const executeTabChange = (newTab: ExcelSubTab) => {
    setActiveExcelTab(newTab);
  };

  const handleTabChange = (newTab: ExcelSubTab) => {
    if (activeExcelTab === 'sheet' && newTab !== 'sheet' && hasUnsavedChanges) {
      setPendingNavigationTab(newTab);
      setShowUnsavedPrompt(true);
      return;
    }
    executeTabChange(newTab);
  };

  // Identifies heads that must start UNCHECKED by default (Job Holder, Support, Rizviz Share, Second Resource)
  const isDefaultUncheckedHead = (serviceHead?: string | null): boolean => {
    if (!serviceHead) return false;
    const s = serviceHead.trim().toLowerCase();
    return s.includes('job holder') || s.includes('support') || s.includes('rizviz share') || s.includes('second resource');
  };

  // Normalizes Excel view data:
  // - Default unchecked heads (Job Holder, Support Provider, Rizviz Share, Second Resource)
  //   start unchecked by default unless explicitly marked included in DB or has otherCharge > 0.
  // - All other heads start checked by default unless explicitly marked included = false in DB.
  // - For ANY service head: when included, otherCharge holds the row amount; when unchecked, null.
  // - Recalculates otherChargeSum and totalInvoice strictly from rows.
  // - Total Cost / Total USD (totalCostSum / finalUsdSum) remains strictly fixed and unchanged.
  const normalizeExcelViewData = (d: ProfileInvoiceExcelViewResult | null): ProfileInvoiceExcelViewResult | null => {
    if (!d || !d.rows) return d;
    const normalizedRows = d.rows.map(r => {
      if (r.rowType === 'Blank' || r.rowType === 'StackHeader' || r.rowType === 'ProjectHeader') {
        return r;
      }

      const headAmount = (r.finalUsd != null && r.finalUsd > 0) 
        ? r.finalUsd 
        : (r.totalCost || r.chargedAmtUsd || 0);

      let isInc = false;
      if (isDefaultUncheckedHead(r.serviceHead)) {
        isInc = r.isIncluded === true || (r.otherCharge != null && r.otherCharge > 0);
      } else {
        isInc = r.isIncluded !== false;
      }

      return {
        ...r,
        isIncluded: isInc,
        otherCharge: isInc ? (r.otherCharge != null ? r.otherCharge : headAmount) : null
      };
    });

    let newOtherSum = 0;
    for (const r of normalizedRows) {
      if (r.rowType === 'Blank' || r.rowType === 'StackHeader' || r.rowType === 'ProjectHeader') continue;
      if (r.isIncluded && r.otherCharge != null && r.otherCharge > 0) {
        newOtherSum += r.otherCharge;
      }
    }

    const actualSum = d.actualChargesSum || 0;

    return {
      ...d,
      rows: normalizedRows,
      otherChargeSum: Math.round(newOtherSum),
      totalInvoice: Math.round(actualSum + newOtherSum)
      // totalCostSum and finalUsdSum remain completely unchanged
    };
  };

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

  const displayOwnerName = useMemo(() => {
    if (lockedOwnerName && lockedOwnerName.trim()) return lockedOwnerName.trim();
    if (data?.groupOwnerName && data.groupOwnerName.trim()) return data.groupOwnerName.trim();
    if (selectedOwnerCode) {
      const match = allOwners.find(o => o.prfOwnCode === Number(selectedOwnerCode))
                 || postedOwners.find(o => o.prfOwnCode === Number(selectedOwnerCode))
                 || _groupOwners.find(o => o.prfOwnCode === Number(selectedOwnerCode));
      if (match?.profileName) return match.profileName.trim();
    }
    return '';
  }, [lockedOwnerName, data?.groupOwnerName, selectedOwnerCode, allOwners, postedOwners, _groupOwners]);

  // Only genuine Profile Group Owners who have UNPROCESSED invoices for this month
  // so processed owners (like Fawad) do NOT appear in the dropdown
  const groupOwnersList = useMemo(() => {
    let list: { prfOwnCode: number; profileName?: string | null; isProfgrpOwner?: string | null }[] = 
      unprocessedOwners.map(o => ({
        prfOwnCode: o.prfownCode,
        profileName: o.profileName,
        isProfgrpOwner: 'Y'
      }));

    // If an owner was specifically opened (e.g. navigated from Processed tab View button),
    // ensure their name displays properly in the trigger
    if (selectedOwnerCode && !list.some(o => o.prfOwnCode === Number(selectedOwnerCode))) {
      const selected = allOwners.find(o => o.prfOwnCode === Number(selectedOwnerCode));
      if (selected) {
        list = [selected, ...list];
      } else if (displayOwnerName) {
        list = [{ prfOwnCode: Number(selectedOwnerCode), profileName: displayOwnerName, isProfgrpOwner: 'Y' }, ...list];
      }
    }
    return list;
  }, [unprocessedOwners, allOwners, selectedOwnerCode, displayOwnerName]);

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

  // Sync locked owner from parent
  useEffect(() => {
    if (lockedOwnerName && initialOwnerCode !== '') {
      setSelectedOwnerCode(initialOwnerCode);
    }
  }, [lockedOwnerName, initialOwnerCode]);

  // Sync initialExcelTab from parent navigation
  useEffect(() => {
    if (initialExcelTab) {
      setActiveExcelTab(initialExcelTab);
    }
  }, [initialExcelTab]);

  // Fetch all owners (for unlocked dropdown) + posted owners (for sub-tabs) whenever month changes
  useEffect(() => {
    const fetchOwners = async () => {
      try {
        // Always fetch posted owners (used by sub-tabs)
        const posted = await api.getPostedGroupOwners(cleanMonth || undefined);
        setPostedOwners(posted);

        // If NOT locked: also fetch all owners for the dropdown
        if (!lockedOwnerName) {
          const all = await api.getProfileGroupOwners();
          setAllOwners(all);
          // Default selection when unlocked: preserve existing or pick nothing
          setSelectedOwnerCode(prev => {
            if (prev !== '') return prev;
            return '';  // Don't auto-select; show "Select Owner..."
          });
        }
      } catch (err) {
        console.error('Failed to load group owners', err);
        setPostedOwners([]);
        setAllOwners([]);
      }
    };
    fetchOwners();
  }, [cleanMonth, lockedOwnerName]);

  const fetchUnprocessedOwners = useCallback(async () => {
    if (!cleanMonth) return;
    setUnprocessedLoading(true);
    try {
      const res = await api.getUnprocessedInvoices(cleanMonth);
      setUnprocessedOwners(res?.rows || []);
    } catch (err) {
      console.error('Failed to load unprocessed owners', err);
      setUnprocessedOwners([]);
    } finally {
      setUnprocessedLoading(false);
    }
  }, [cleanMonth]);

  useEffect(() => {
    fetchUnprocessedOwners();
  }, [fetchUnprocessedOwners]);

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
      let freshData = await api.getProfileInvoiceExcelView(Number(selectedOwnerCode), cleanMonth);
      if (freshData.totalSavedRows === 0) {
        try {
          const genResult = await api.generateAndOpenProfileInvoices(Number(selectedOwnerCode), cleanMonth);
          if (genResult.excelView && genResult.excelView.totalSavedRows > 0) {
            freshData = genResult.excelView;
          }
        } catch { /* if no unbilled rows, keep freshData */ }
      }
      setData(normalizeExcelViewData(freshData));
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
      setData(normalizeExcelViewData(genData));
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
    } catch (err: any) {
      console.error('Failed to generate and open excel view from unprocessed', err);
      try {
        const fallback = await api.getProfileInvoiceExcelView(prfownCode, cleaned);
        const resolvedCode = fallback.groupOwnerCode || prfownCode;
        setSelectedOwnerCode(resolvedCode);
        if (onOwnerChange) onOwnerChange(resolvedCode);
        setData(normalizeExcelViewData(fallback));
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

  // Navigate from Processed tab to Excel Sheet View to view this owner's processed sheet
  const handleViewProcessedInExcel = useCallback(async (ownerCode: number, month: string) => {
    const cleaned = month.trim().replace('-', '').toUpperCase();
    skipAutoLoadRef.current = true;
    setActiveExcelTab('sheet');
    setMonthYear(cleaned);
    if (onMonthChange) onMonthChange(cleaned);

    setSelectedOwnerCode(ownerCode);
    if (onOwnerChange) onOwnerChange(ownerCode);

    setLoading(true);
    setError(null);
    try {
      const result = await api.getProfileInvoiceExcelView(ownerCode, cleaned);
      setData(normalizeExcelViewData(result));
      setSelectedRowIndices(computeInitialSelectedIndices(result));
      setProcessMsg(null);

      const owners = await api.getPostedGroupOwners(cleaned);
      if (result.groupOwnerName && !owners.some(o => o.prfOwnCode === ownerCode)) {
        owners.push({
          prfOwnCode: ownerCode,
          profileName: result.groupOwnerName
        });
      }
      setPostedOwners(owners);
    } catch (err: any) {
      setError(err?.message || 'Failed to load Excel sheet for processed profile.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [onMonthChange, onOwnerChange]);

  const handleToggleIncluded = (code: number, checked: boolean, rowIdx?: number) => {
    if (!checkConfirmFinalized() || !data) return;

    // 1. Instant optimistic state update
    const newRows = [...data.rows];
    let targetIdx = rowIdx !== undefined && rowIdx >= 0 ? rowIdx : newRows.findIndex(r => r.cmpProfInvoiceCode === code);
    if (targetIdx >= 0) {
      const targetRow = { ...newRows[targetIdx] };
      const headAmount = (targetRow.finalUsd != null && targetRow.finalUsd > 0)
        ? targetRow.finalUsd
        : (targetRow.totalCost || targetRow.chargedAmtUsd || 0);

      targetRow.isIncluded = checked;
      targetRow.otherCharge = checked ? headAmount : null;
      // Important: targetRow.totalCost and targetRow.finalUsd are strictly preserved!
      newRows[targetIdx] = targetRow;
    }

    // 2. Dynamic sum recalculation:
    let newOtherSum = 0;
    for (const r of newRows) {
      if (r.rowType === 'Blank' || r.rowType === 'StackHeader' || r.rowType === 'ProjectHeader') continue;
      if (r.isIncluded && r.otherCharge != null && r.otherCharge > 0) {
        newOtherSum += r.otherCharge;
      }
    }

    const newTotalInvoice = (data.actualChargesSum || 0) + newOtherSum;

    setData({
      ...data,
      rows: newRows,
      otherChargeSum: Math.round(newOtherSum),
      totalInvoice: Math.round(newTotalInvoice)
    });

    // 3. Record pending row update for manual save (auto-save removed)
    if (code !== 0) {
      setPendingRowUpdates(prev => {
        const next = new Map(prev);
        const existing = next.get(code) || {};
        next.set(code, {
          ...existing,
          isIncluded: checked,
          monthYear: cleanMonth,
          groupOwnerCode: Number(selectedOwnerCode) || undefined
        });
        return next;
      });
    }
  };

  const handleCellSave = () => {
    if (!editingCell || !data) return;
    const { rowType, code, projectCode, field, value, rowIdx } = editingCell;

    if (!checkConfirmFinalized()) {
      setEditingCell(null);
      return;
    }

    const newRows = [...data.rows];
    let targetIdx = rowIdx !== undefined && rowIdx >= 0 ? rowIdx : newRows.findIndex(r => r.cmpProfInvoiceCode === code);
    if (targetIdx >= 0) {
      const targetRow = { ...newRows[targetIdx] };
      const cleanVal = (value || '').replace(/[^0-9.-]+/g, '');
      const numVal = parseFloat(cleanVal);

      if (field === 'agreedRate') {
        const newAgreed = isNaN(numVal) ? (targetRow.agreedRate || 0) : numVal;
        targetRow.agreedRate = newAgreed;
        // Agreed Rate has ZERO effect on applied or actual charges in Excel View
      } else if (field === 'hoursDays') {
        targetRow.hoursDays = value;
        const parts = (value || '').trim().split('/');
        if (parts.length === 2) {
          const p = parseFloat(parts[0]);
          const m = parseFloat(parts[1]);
          if (!isNaN(p) && !isNaN(m) && m > 0) {
            targetRow.proDays = p;
            targetRow.monthDays = m;
            if (targetRow.agreedRate != null && targetRow.agreedRate > 0) {
              targetRow.actualCharges = Math.round((targetRow.agreedRate / m) * p);
            }
          }
        }
      } else if (field === 'appliedCharges') {
        const val = isNaN(numVal) ? (targetRow.appliedCharges ?? 0) : numVal;
        targetRow.appliedCharges = val;
        // Prorate actualCharges based on hoursDays (e.g. "31/31" or "15/31")
        let computedActual = val;
        if (targetRow.hoursDays) {
          const hParts = targetRow.hoursDays.trim().split('/');
          if (hParts.length === 2) {
            const proD = parseFloat(hParts[0]);
            const monD = parseFloat(hParts[1]);
            if (!isNaN(proD) && !isNaN(monD) && monD > 0) {
              computedActual = Math.round((val / monD) * proD);
            }
          }
        }
        targetRow.actualCharges = computedActual;
      } else if (field === 'actualCharges') {
        targetRow.actualCharges = isNaN(numVal) ? targetRow.actualCharges : numVal;
      } else if (field === 'otherCharge') {
        targetRow.otherCharge = isNaN(numVal) ? targetRow.otherCharge : numVal;
      } else if (field === 'serviceHead') {
        targetRow.serviceHead = value;
      } else if (field === 'projectName') {
        targetRow.projectName = value;
      } else if (field === 'salaryRate') {
        targetRow.salaryRate = value;
      } else if (field === 'projStatus') {
        targetRow.projStatus = value;
      } else if (field === 'stack') {
        targetRow.stack = value;
      }
      newRows[targetIdx] = targetRow;
    }

    // Recalculate sums if otherCharge, actualCharges, agreedRate or finalUsd changed
    let newOtherSum = 0;
    let newActualSum = 0;
    let newAgreedSum = 0;
    for (const r of newRows) {
      if (r.rowType === 'ProjectHeader' || r.rowType === 'Standalone') {
        if (r.isIncluded !== false && r.actualCharges != null) {
          newActualSum += r.actualCharges;
        }
        if (r.agreedRate != null && r.agreedRate > 0) {
          newAgreedSum += r.agreedRate;
        }
      }
      if (r.rowType === 'Blank' || r.rowType === 'StackHeader' || r.rowType === 'ProjectHeader') continue;
      if (r.isIncluded && r.otherCharge != null && r.otherCharge > 0) {
        newOtherSum += r.otherCharge;
      }
    }
    const newTotalInvoice = newActualSum + newOtherSum;

    setData({
      ...data,
      rows: newRows,
      agreedRateSum: Math.round(newAgreedSum),
      actualChargesSum: Math.round(newActualSum),
      otherChargeSum: Math.round(newOtherSum),
      totalInvoice: Math.round(newTotalInvoice)
    });

    // Record pending update for manual save (auto-save removed)
    if ((rowType === 'ProjectHeader' || field === 'agreedRate' || field === 'appliedCharges' || field === 'actualCharges') && projectCode) {
      setPendingProjectUpdates(prev => {
        const next = new Map(prev);
        const req: ProfileInvoiceProjectUpdateRequest = next.get(projectCode) || {
          monthYear: cleanMonth,
          groupOwnerCode: Number(selectedOwnerCode)
        };
        const cleanVal = (value || '').replace(/[^0-9.-]+/g, '');
        const num = parseFloat(cleanVal);
        if (field === 'agreedRate' && !isNaN(num)) req.agreedRate = num;
        else if (field === 'appliedCharges' && !isNaN(num)) {
          req.appliedCharges = num;
          // Prorate actualCharges for pendingProjectUpdates
          let computedActualPP = num;
          const hd = newRows.find(r => r.projectCode === projectCode || r.cmpProfInvoiceCode === projectCode)?.hoursDays;
          if (hd) {
            const ppParts = hd.trim().split('/');
            if (ppParts.length === 2) {
              const proDP = parseFloat(ppParts[0]);
              const monDP = parseFloat(ppParts[1]);
              if (!isNaN(proDP) && !isNaN(monDP) && monDP > 0) {
                computedActualPP = Math.round((num / monDP) * proDP);
              }
            }
          }
          req.actualCharges = computedActualPP;
        }
        else if (field === 'actualCharges' && !isNaN(num)) req.actualCharges = num;
        else if (field === 'hoursDays' && value) {
          const parts = value.trim().split('/');
          if (parts.length === 2) {
            const p = parseFloat(parts[0]);
            const m = parseFloat(parts[1]);
            if (!isNaN(p) && !isNaN(m) && m > 0) {
              req.proRateDays = p;
              req.monthDays = m;
            }
          }
        }
        else if (field === 'projectName') req.projectName = value;
        else if (field === 'salaryRate') req.salaryRate = value;
        else if (field === 'projStatus') req.projStatus = value;
        else if (field === 'stack') req.stack = value;
        next.set(projectCode, req);
        return next;
      });
    } else if (code) {
      setPendingRowUpdates(prev => {
        const next = new Map(prev);
        const req: ProfileInvoiceRowUpdateRequest = next.get(code) || {
          monthYear: cleanMonth,
          groupOwnerCode: Number(selectedOwnerCode)
        };
        const cleanVal = (value || '').replace(/[^0-9.-]+/g, '');
        const num = parseFloat(cleanVal);
        if (field === 'appliedCharges' && !isNaN(num)) {
          req.appliedCharges = num;
          // Prorate actualCharges for pendingRowUpdates using the row's hoursDays
          let computedActualPR = num;
          const rowForCode = newRows.find(r => r.cmpProfInvoiceCode === code);
          if (rowForCode?.hoursDays) {
            const prParts = rowForCode.hoursDays.trim().split('/');
            if (prParts.length === 2) {
              const proDR = parseFloat(prParts[0]);
              const monDR = parseFloat(prParts[1]);
              if (!isNaN(proDR) && !isNaN(monDR) && monDR > 0) {
                computedActualPR = Math.round((num / monDR) * proDR);
              }
            }
          }
          req.actualCharges = computedActualPR;
        } else if (field === 'actualCharges' && !isNaN(num)) {
          req.actualCharges = num;
        } else if (field === 'otherCharge' && !isNaN(num)) {
          req.chargedAmtUsd = num;
        } else if (field === 'serviceHead') {
          req.remarks = value;
        } else if (field === 'salaryRate') {
          req.salaryRate = value;
        } else if (field === 'projStatus') {
          req.status = value;
        }
        next.set(code, req);
        return next;
      });
    }

    setEditingCell(null);
  };

  const handleManualSave = async () => {
    if (!data || !hasUnsavedChanges || isSavingChanges) return;
    setIsSavingChanges(true);
    setError(null);
    try {
      // 1. Commit pending project updates
      for (const [projectCode, req] of pendingProjectUpdates.entries()) {
        await api.updateProfileInvoiceProject(projectCode, req);
      }
      // 2. Commit pending row updates
      for (const [code, req] of pendingRowUpdates.entries()) {
        await api.updateProfileInvoiceRow(code, req);
      }

      setPendingRowUpdates(new Map());
      setPendingProjectUpdates(new Map());
      setSaveSuccessMsg('All changes saved successfully!');
      setTimeout(() => setSaveSuccessMsg(null), 3500);
      flashMsg('success', '✓ All changes successfully saved to database.');
    } catch (err: any) {
      console.error('Failed to save changes to database', err);
      setError(err?.message || 'Failed to save changes to database.');
      flashMsg('error', err?.message || 'Failed to save changes.');
    } finally {
      setIsSavingChanges(false);
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
    const canEdit = (rowType === 'ProjectHeader' && (field === 'agreedRate' || field === 'appliedCharges' || field === 'actualCharges' || field === 'hoursDays' || field === 'salaryRate' || field === 'projectName' || field === 'stack' || field === 'jobType' || field === 'startEndDate' || field === 'projStatus' || field === 'profileNature' || field === 'handledFrom')) ||
                   ((rowType === 'Detail' || rowType === 'Standalone') && (field === 'appliedCharges' || field === 'actualCharges' || field === 'otherCharge' || field === 'serviceHead' || field === 'agreedRate' || field === 'salaryRate' || field === 'projectName' || field === 'stack' || field === 'jobType' || field === 'startEndDate' || field === 'projStatus' || field === 'profileNature' || field === 'handledFrom'));

    if (!canEdit) {
      if (field === 'totalCost' || field === 'finalUsd') {
        return (
          <span title="Calculated" style={{ cursor: 'default' }}>
            {displayValue}
          </span>
        );
      }
      return displayValue;
    }

    const isNumberField = field === 'agreedRate' || field === 'appliedCharges' || field === 'otherCharge' || field === 'actualCharges';

    if (isEditing) {
      return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start', width: '100%' }}>
          <input
            type={isNumberField ? 'number' : 'text'}
            autoFocus
            value={editingCell.value}
            disabled={isSavingChanges}
            onChange={(e) => setEditingCell(prev => prev ? { ...prev, value: e.target.value } : null)}
            onBlur={handleCellSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCellSave();
              if (e.key === 'Escape') setEditingCell(null);
            }}
            style={{
              width: isNumberField ? '75px' : '110px',
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
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          flexWrap: 'nowrap',
          gap: '0.2rem',
          justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
          width: '100%',
          overflow: 'hidden',
        }}
        className="editable-cell-hover"
      >
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: align }}>{displayValue}</span>
        <button
          type="button"
          title="Edit"
          onClick={(e) => {
            e.stopPropagation();
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
          style={{
            background: 'transparent',
            border: '1px solid transparent',
            borderRadius: '3px',
            padding: '1px 3px',
            cursor: 'pointer',
            color: 'var(--accent-primary, #6366f1)',
            display: 'inline-flex',
            alignItems: 'center',
            opacity: 0.4,
            flexShrink: 0,
            lineHeight: 1,
            transition: 'opacity 0.15s, background 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.opacity = '1';
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.12)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.3)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.opacity = '0.4';
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
          }}
        >
          <Pencil size={10} />
        </button>
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
        if (row.cmpProfInvoiceCode > 0) {
          acc.push({ idx, codes: [row.cmpProfInvoiceCode] });
        } else if (row.childInvoiceCodes?.length) {
          acc.push({ idx, codes: row.childInvoiceCodes.filter(c => c > 0) });
        }
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
        if (row.cmpProfInvoiceCode > 0) {
          unique.add(row.cmpProfInvoiceCode);
        } else if (row.childInvoiceCodes?.length) {
          row.childInvoiceCodes.forEach(c => { if (c > 0) unique.add(c); });
        }
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
      if (row.cmpProfInvoiceCode > 0) {
        codes = [row.cmpProfInvoiceCode];
      } else if (row.childInvoiceCodes?.length) {
        codes = row.childInvoiceCodes.filter(c => c > 0);
      }
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

  const handleSaveProcessAndEmail = async () => {
    if (!someSelected || !data || processingSelected) return;

    // 1. Save pending cell edit if actively editing
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

    // 2. Commit all pending project and row changes (everything regular Save button saves)
    if (pendingProjectUpdates.size > 0 || pendingRowUpdates.size > 0) {
      setIsSavingChanges(true);
      try {
        for (const [projCode, updateReq] of pendingProjectUpdates.entries()) {
          await api.updateProfileInvoiceProject(projCode, updateReq);
        }
        for (const [rowCode, updateReq] of pendingRowUpdates.entries()) {
          await api.updateProfileInvoiceRow(rowCode, updateReq);
        }
        setPendingProjectUpdates(new Map());
        setPendingRowUpdates(new Map());
        setSaveSuccessMsg('All changes saved successfully!');
        setTimeout(() => setSaveSuccessMsg(null), 3000);
      } catch (saveErr: any) {
        console.error('Pending save before process & email error:', saveErr);
        flashMsg('error', saveErr?.message || 'Failed to save pending changes.');
        setIsSavingChanges(false);
        return;
      } finally {
        setIsSavingChanges(false);
      }
    }

    // 3. Move selected rows to Processed (is_processed = 1)
    setProcessingSelected(true);
    setProcessMsg(null);
    try {
      const res = await api.processInvoices(codes);
      if (!res.success) {
        setProcessMsg({ type: 'error', text: res.message || 'Failed to process invoices.' });
        flashMsg('error', res.message || 'Failed to mark invoices as processed.');
        return;
      } else {
        setProcessMsg({ type: 'success', text: res.message || `${res.updatedCount} invoice(s) processed successfully.` });
        setUnprocessedRefreshKey(k => k + 1);
        fetchUnprocessedOwners();
      }
    } catch (err: any) {
      flashMsg('error', err?.message || 'Failed to process invoices.');
      return;
    } finally {
      setProcessingSelected(false);
    }

    // 4. Build preview rows and open email compose directly in Processed & Email tab
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
          isProcessed: true
        });
      }
    });

    setEmailSelectedCodes(codes);
    setEmailSelectedRows(previewRows);
    setActiveExcelTab('email');
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '3px', overflow: 'hidden' }}>
      {/* Header Row: Tabs on Left, Month Selector + Profile Invoicing Button on Right */}
      <div className="profile-subtabs-header" style={{ flexShrink: 0 }}>
        {/* Left Side: All 6 tabs in one line */}
        <div className="profile-subtabs-list">
          <button
            onClick={() => handleTabChange('sheet')}
            className="compact-tab-btn"
            style={{
              height: '32px',
              padding: '0 0.75rem',
              fontSize: '0.82rem',
              fontWeight: activeExcelTab === 'sheet' ? 800 : 700,
              borderRadius: '6px',
              border: activeExcelTab === 'sheet' ? '1.5px solid #3730a3' : '1.5px solid rgba(100, 116, 139, 0.35)',
              background: activeExcelTab === 'sheet' ? 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)' : 'var(--bg-surface)',
              color: activeExcelTab === 'sheet' ? '#ffffff' : 'var(--text-main)',
              boxShadow: activeExcelTab === 'sheet' ? '0 2px 6px rgba(79, 70, 229, 0.35)' : '0 1px 2px rgba(0, 0, 0, 0.04)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <FileSpreadsheet size={14} style={{ flexShrink: 0 }} />
            <span>Excel Sheet View</span>
          </button>

          <button
            onClick={() => handleTabChange('unprocessed')}
            className="compact-tab-btn"
            style={{
              height: '32px',
              padding: '0 0.75rem',
              fontSize: '0.82rem',
              fontWeight: activeExcelTab === 'unprocessed' ? 800 : 700,
              borderRadius: '6px',
              border: activeExcelTab === 'unprocessed' ? '1.5px solid #3730a3' : '1.5px solid rgba(100, 116, 139, 0.35)',
              background: activeExcelTab === 'unprocessed' ? 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)' : 'var(--bg-surface)',
              color: activeExcelTab === 'unprocessed' ? '#ffffff' : 'var(--text-main)',
              boxShadow: activeExcelTab === 'unprocessed' ? '0 2px 6px rgba(79, 70, 229, 0.35)' : '0 1px 2px rgba(0, 0, 0, 0.04)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <Clock size={14} style={{ flexShrink: 0 }} />
            <span>Unprocessed</span>
          </button>

          <button
            onClick={() => handleTabChange('discussed')}
            className="compact-tab-btn"
            style={{
              height: '32px',
              padding: '0 0.75rem',
              fontSize: '0.82rem',
              fontWeight: activeExcelTab === 'discussed' ? 800 : 700,
              borderRadius: '6px',
              border: activeExcelTab === 'discussed' ? '1.5px solid #3730a3' : '1.5px solid rgba(100, 116, 139, 0.35)',
              background: activeExcelTab === 'discussed' ? 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)' : 'var(--bg-surface)',
              color: activeExcelTab === 'discussed' ? '#ffffff' : 'var(--text-main)',
              boxShadow: activeExcelTab === 'discussed' ? '0 2px 6px rgba(79, 70, 229, 0.35)' : '0 1px 2px rgba(0, 0, 0, 0.04)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <MessageSquare size={14} style={{ flexShrink: 0 }} />
            <span>To Be Discussed</span>
          </button>

          <button
            onClick={() => handleTabChange('processed')}
            className="compact-tab-btn"
            style={{
              height: '32px',
              padding: '0 0.75rem',
              fontSize: '0.82rem',
              fontWeight: (activeExcelTab === 'processed' || activeExcelTab === 'email') ? 800 : 700,
              borderRadius: '6px',
              border: (activeExcelTab === 'processed' || activeExcelTab === 'email') ? '1.5px solid #3730a3' : '1.5px solid rgba(100, 116, 139, 0.35)',
              background: (activeExcelTab === 'processed' || activeExcelTab === 'email') ? 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)' : 'var(--bg-surface)',
              color: (activeExcelTab === 'processed' || activeExcelTab === 'email') ? '#ffffff' : 'var(--text-main)',
              boxShadow: (activeExcelTab === 'processed' || activeExcelTab === 'email') ? '0 2px 6px rgba(79, 70, 229, 0.35)' : '0 1px 2px rgba(0, 0, 0, 0.04)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <Archive size={14} style={{ flexShrink: 0 }} />
            <span>Processed & Email</span>
          </button>

          <button
            onClick={() => handleTabChange('audit')}
            className="compact-tab-btn"
            style={{
              height: '32px',
              padding: '0 0.75rem',
              fontSize: '0.82rem',
              fontWeight: activeExcelTab === 'audit' ? 800 : 700,
              borderRadius: '6px',
              border: activeExcelTab === 'audit' ? '1.5px solid #3730a3' : '1.5px solid rgba(100, 116, 139, 0.35)',
              background: activeExcelTab === 'audit' ? 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)' : 'var(--bg-surface)',
              color: activeExcelTab === 'audit' ? '#ffffff' : 'var(--text-main)',
              boxShadow: activeExcelTab === 'audit' ? '0 2px 6px rgba(79, 70, 229, 0.35)' : '0 1px 2px rgba(0, 0, 0, 0.04)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <History size={14} style={{ flexShrink: 0 }} />
            <span>Change Summary</span>
          </button>
        </div>

        {/* Right Side: Month dropdown + Profile Invoicing button */}
        {headerRight && (
          <div className="profile-subtabs-right">
            {headerRight}
          </div>
        )}
      </div>

      {visitedTabs.has('audit') && (
        <div style={{ display: activeExcelTab === 'audit' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <ProfileInvoiceAuditTab
            groupOwners={postedOwners}
            initialOwnerCode={selectedOwnerCode}
            initialMonth={cleanMonth}
          />
        </div>
      )}

      {visitedTabs.has('unprocessed') && (
        <div style={{ display: activeExcelTab === 'unprocessed' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <ProfileInvoiceUnprocessedTab
            initialMonth={cleanMonth}
            onSelectOwner={handleNavigateFromUnprocessed}
            refreshKey={unprocessedRefreshKey}
          />
        </div>
      )}

      {visitedTabs.has('discussed') && (
        <div style={{ display: activeExcelTab === 'discussed' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <ProfileInvoiceToBeDiscussedTab
            groupOwners={postedOwners}
            initialOwnerCode=""
            initialMonth={cleanMonth}
          />
        </div>
      )}

      {(visitedTabs.has('processed') || visitedTabs.has('email')) && (
        <div style={{ display: (activeExcelTab === 'processed' || activeExcelTab === 'email') ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <ProfileInvoiceProcessedTab
            groupOwners={postedOwners.length > 0 ? postedOwners : _groupOwners}
            initialOwnerCode={emailSelectedCodes ? selectedOwnerCode : ""}
            initialMonth={cleanMonth}
            initialComposing={activeExcelTab === 'email'}
            onRefreshUnprocessed={() => {
              setUnprocessedRefreshKey(k => k + 1);
              fetchUnprocessedOwners();
            }}
            onViewInExcel={handleViewProcessedInExcel}
          />
        </div>
      )}

      <div style={{ display: activeExcelTab === 'sheet' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column', gap: '3px', overflow: 'hidden' }}>
          {/* Action notification banner */}
          {actionMsg && (
            <div style={{
              flexShrink: 0,
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
          <div className="compact-toolbar" style={{ flexShrink: 0, minHeight: '34px', padding: '3px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
            <div className="compact-toolbar-left" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(79, 70, 229, 0.08) 100%)',
                border: '1.5px solid #6366f1',
                borderRadius: '7px',
                padding: '2px 8px',
                height: '32px',
                boxShadow: '0 1px 4px rgba(99, 102, 241, 0.15)',
                flex: '1 1 auto',
                maxWidth: '100%'
              }}>
                <Users size={15} color="#6366f1" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: '0.84rem', fontWeight: 800, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                  Profile Owner:
                </span>
                <div style={{ flex: '1 1 auto', minWidth: '130px', maxWidth: '300px' }}>
                  <OwnerSearchSelect
                    owners={groupOwnersList}
                    value={selectedOwnerCode}
                    onChange={(val) => {
                      if (hasUnsavedChanges) {
                        const ok = window.confirm(`You have ${unsavedCount} unsaved change(s) in this invoice sheet. Please save your changes before switching profile owners.\n\nClick OK to discard changes and switch, or Cancel to stay and click Save.`);
                        if (!ok) return;
                        setPendingRowUpdates(new Map());
                        setPendingProjectUpdates(new Map());
                      }
                      if (val) {
                        handleNavigateFromUnprocessed(Number(val), cleanMonth);
                      } else {
                        setSelectedOwnerCode('');
                        if (onOwnerChange) onOwnerChange('');
                        setData(null);
                      }
                    }}
                    placeholder={unprocessedLoading ? 'Loading owners...' : 'Select Profile Owner...'}
                    allowAll={false}
                    compact={true}
                    disabled={unprocessedLoading}
                    width="100%"
                  />
                </div>
              </div>

              <button
                onClick={handleLoad}
                disabled={loading || downloading}
                className="btn-secondary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '2px 9px',
                  height: '32px',
                  fontSize: '0.80rem',
                  fontWeight: 700,
                  borderRadius: '6px'
                }}
              >
                <RefreshCw size={13} className={loading ? 'spin' : ''} />
                {loading ? 'Loading...' : 'Refresh Excel View'}
              </button>

              {/* Manual Save Button (auto-save removed as per user request) */}
              <button
                onClick={handleManualSave}
                disabled={!hasUnsavedChanges || isSavingChanges}
                className={hasUnsavedChanges ? "btn-primary" : "btn-secondary"}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '2px 14px',
                  height: '32px',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  borderRadius: '6px',
                  background: hasUnsavedChanges
                    ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                    : 'var(--bg-surface)',
                  color: hasUnsavedChanges ? '#ffffff' : 'var(--text-muted)',
                  border: hasUnsavedChanges ? '1.5px solid #059669' : '1px solid var(--border-subtle)',
                  boxShadow: hasUnsavedChanges ? '0 0 12px rgba(16, 185, 129, 0.45)' : 'none',
                  cursor: hasUnsavedChanges ? 'pointer' : 'default',
                  transition: 'all 0.2s ease',
                  opacity: hasUnsavedChanges ? 1 : 0.65
                }}
                title={hasUnsavedChanges ? `Save ${unsavedCount} pending changes to database` : 'No unsaved changes to save'}
              >
                <Save size={15} className={isSavingChanges ? 'spin' : ''} />
                <span>{isSavingChanges ? 'Saving...' : hasUnsavedChanges ? `Save (${unsavedCount})` : 'Save'}</span>
              </button>

              {saveSuccessMsg && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: '#059669',
                  background: 'rgba(16, 185, 129, 0.1)',
                  padding: '2px 8px',
                  borderRadius: '4px'
                }}>
                  <Check size={12} /> Saved
                </span>
              )}
            </div>

            <div className="toolbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <button
                onClick={handleDownload}
                disabled={loading || downloading || !data || data.rows.length === 0}
                className="btn-primary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '2px 10px',
                  height: '30px',
                  fontSize: '0.80rem',
                  fontWeight: 700,
                  borderRadius: '6px',
                  background: '#059669',
                  borderColor: '#059669'
                }}
              >
                <Download size={13} className={downloading ? 'spin' : ''} />
                {downloading ? 'Downloading...' : 'Download XLSX'}
              </button>

              {/* Save, Process & Email button */}
              <button
                onClick={handleSaveProcessAndEmail}
                disabled={!someSelected || processingSelected || !data}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.35rem',
                  padding: '2px 12px', height: '30px', fontSize: '0.80rem', fontWeight: 800,
                  background: someSelected ? 'linear-gradient(135deg, #4f46e5 0%, #2563eb 100%)' : 'var(--bg-secondary)',
                  color: someSelected ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${someSelected ? '#2563eb' : 'var(--border-subtle)'}`,
                  borderRadius: '6px',
                  cursor: someSelected ? 'pointer' : 'not-allowed',
                  opacity: someSelected ? 1 : 0.5,
                  boxShadow: someSelected ? '0 2px 6px rgba(37, 99, 235, 0.3)' : 'none'
                }}
                title={someSelected ? `Save all changes, process ${selectedCodesCount} selected invoices and open email compose` : 'Select rows first'}
              >
                <Mail size={13} className={processingSelected ? 'spin' : ''} />
                <span>{processingSelected ? 'Processing...' : 'Save, Process & Email'}</span>
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

          {/* Placeholder: show when no owner selected and no data loading */}
          {activeExcelTab === 'sheet' && !selectedOwnerCode && !loading && !data ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              gap: '1rem',
              color: 'var(--text-muted)',
              padding: '6rem 2rem',
              textAlign: 'center'
            }}>
              <Users size={56} style={{ opacity: 0.25, color: 'var(--accent-primary)' }} />
              <p style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                Please select a Profile Owner to view the report.
              </p>
              <p style={{ fontSize: '0.85rem', margin: 0, opacity: 0.7 }}>
                Choose an owner from the Profile Owner dropdown above to load their invoice sheet.
              </p>
            </div>
          ) : (
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
                        {/* Left: Owner name + month + rows count */}
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
                          <span style={{ fontSize: '0.94rem', fontWeight: 900, color: 'var(--text-main)' }}>
                            {data.groupOwnerName}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                            ({data.monthYear})
                          </span>
                          <span style={{ fontSize: '0.70rem', color: 'var(--text-subtle)', fontWeight: 600 }}>
                            {data.totalSavedRows} rows ({data.totalProjectBlocks} proj)
                          </span>
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
                        borderBottom: '2px solid var(--border-medium)',
                        padding: '4px 8px',
                        position: 'sticky',
                        top: 0,
                        zIndex: 12
                      }}
                    />

                    {/* Column 9: Directly above Applied */}
                    <th
                      style={{
                        background: 'rgba(16, 185, 129, 0.15)',
                        borderBottom: '2px solid rgba(16, 185, 129, 0.35)',
                        padding: '4px 8px',
                        position: 'sticky',
                        top: 0,
                        zIndex: 12
                      }}
                    />

                    {/* Column 10: Directly above Hrs/Dys (I) */}
                    <th
                      style={{
                        background: 'var(--bg-secondary)',
                        borderBottom: '2px solid var(--border-medium)',
                        padding: '4px',
                        position: 'sticky',
                        top: 0,
                        zIndex: 12
                      }}
                    />

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
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem' }}>
                        {/* Foreign legend */}
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span style={{ width: '10px', height: '10px', background: 'var(--bg-foreign-row)', border: '1.5px solid var(--border-foreign, #2563eb)', borderRadius: '2px', display: 'inline-block' }} />
                          <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--border-foreign, #2563eb)' }}>
                            Foreign (Branch 5)
                          </span>
                        </div>

                        {/* TOTAL INVOICE badge - Prominent, Wide & Bold */}
                        <div
                          title="Calculated Total Invoice (Total Actual + Total Other)"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.16) 0%, rgba(79, 70, 229, 0.12) 100%)',
                            border: '2px solid #2563eb',
                            padding: '3px 14px',
                            borderRadius: '7px',
                            boxShadow: '0 2px 10px rgba(37, 99, 235, 0.25)',
                            cursor: 'default',
                            minWidth: '210px',
                            height: '38px',
                            boxSizing: 'border-box',
                            justifyContent: 'space-between'
                          }}
                        >
                          <span style={{
                            fontSize: '0.78rem',
                            fontWeight: 900,
                            color: 'var(--text-main)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            whiteSpace: 'nowrap'
                          }}>
                            TOTAL INVOICE:
                          </span>
                          <span style={{
                            fontSize: '1.25rem',
                            fontWeight: 900,
                            color: '#2563eb',
                            fontFamily: 'var(--font-mono)',
                            letterSpacing: '-0.02em',
                            textShadow: '0 1px 2px rgba(37, 99, 235, 0.20)'
                          }}>
                            ${data.totalInvoice.toLocaleString()}
                          </span>
                        </div>
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
                  <th style={{ minWidth: '70px', textAlign: 'right', background: 'rgba(16, 185, 129, 0.20)', color: '#047857', borderBottom: '2px solid rgba(16, 185, 129, 0.35)' }}>Applied</th>
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
              {loading ? (
                <tr>
                  <td colSpan={17} style={{ padding: '3rem' }}>
                    <LoadingIndicator message="Loading Excel view..." />
                  </td>
                </tr>
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={17} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                    {data && data.totalSavedRows === 0 && displayOwnerName
                      ? `No saved rows for ${displayOwnerName} in ${cleanMonth}. Profile Invoicing mein Save & Post karein.`
                      : 'No saved invoice rows found for this Group Owner and Month.'}
                  </td>
                </tr>
              ) : (
                data.rows.map((row, idx) => {
                  if (row.rowType === 'Blank') {
                    return (
                      <tr key={idx} style={{ height: '8px', background: 'rgba(0,0,0,0.02)' }}>
                        <td colSpan={17} style={{ border: '1px solid var(--border-subtle)', padding: 0 }} />
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
                          colSpan={16}
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

                  // Visual styling matching user requirement:
                  // 1. Job / ProjectHeader row: Highlighted slightly like Excel (#DDEBF7 style soft blue)
                  // 2. Heads division underneath (isDetail): PURE WHITE background (#ffffff) for crisp, proper Excel-like contrast
                  let rowBg = '#ffffff';
                  if (isDiscuss) {
                    rowBg = isRowSelected ? 'rgba(239, 68, 68, 0.35)' : 'var(--bg-discuss-row, #fee2e2)';
                  } else if (row.isForeign) {
                    rowBg = 'var(--bg-foreign-row, #e0f2fe)';
                  } else if (isHeader) {
                    // Job / Project row highlighted like Excel
                    rowBg = isRowSelected ? 'rgba(59, 130, 246, 0.22)' : 'rgba(59, 130, 246, 0.12)';
                  } else if (isDetail) {
                    // Heads division underneath: crisp white
                    rowBg = isRowSelected ? 'rgba(59, 130, 246, 0.08)' : '#ffffff';
                  } else if (isStandalone) {
                    rowBg = isRowSelected ? 'rgba(245, 158, 11, 0.12)' : '#ffffff';
                  }

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
                        borderTop: isHeader ? '2px solid rgba(59, 130, 246, 0.35)' : undefined,
                        borderBottom: isHeader ? '2px solid rgba(59, 130, 246, 0.25)' : isDetail ? '1px solid var(--border-subtle, #f1f5f9)' : undefined
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
                        {row.profileOwner ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
                            <span>{row.profileOwner}</span>
                            {row.ownerNature ? (
                              <span style={{
                                fontSize: '0.67rem',
                                fontWeight: 700,
                                color: row.ownerNature.toLowerCase() === 'executive' ? '#047857' : row.ownerNature.toLowerCase() === 'real' ? '#2563eb' : 'var(--text-muted)',
                                marginTop: '2px',
                                textTransform: 'capitalize',
                                letterSpacing: '0.02em',
                                background: row.ownerNature.toLowerCase() === 'executive' ? 'rgba(16, 185, 129, 0.12)' : row.ownerNature.toLowerCase() === 'real' ? 'rgba(37, 99, 235, 0.10)' : 'transparent',
                                padding: '1px 5px',
                                borderRadius: '3px'
                              }}>
                                {row.ownerNature}
                              </span>
                            ) : null}
                          </div>
                        ) : ''}
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
                          <span style={{ fontWeight: 900, fontSize: '16px', color: 'var(--excel-cost-color)', cursor: 'default' }}>
                            {row.totalCost != null ? `$${row.totalCost.toLocaleString()}` : '-'}
                          </span>
                        )}

                        {isDetail && (
                          <span style={{ fontWeight: 600, fontSize: '13px', color: isDiscuss ? 'var(--text-discuss-row)' : 'var(--text-main)', cursor: 'default' }}>
                            {row.finalUsd != null ? `$${row.finalUsd.toLocaleString()}` : '-'}
                          </span>
                        )}

                        {isStandalone && (() => {
                          if (row.totalCost != null && row.finalUsd != null && row.totalCost !== row.finalUsd) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end', cursor: 'default' }}>
                                <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--excel-cost-color)' }}>
                                  ${row.totalCost.toLocaleString()}
                                </span>
                                <span style={{ fontWeight: 600, fontSize: '13px', color: isDiscuss ? 'var(--text-discuss-row)' : 'var(--text-main)' }}>
                                  ${row.finalUsd.toLocaleString()}
                                </span>
                              </div>
                            );
                          }
                          const val = row.finalUsd ?? row.totalCost;
                          return (
                            <span style={{ fontWeight: 700, fontSize: '14px', color: isDiscuss ? 'var(--text-discuss-row)' : 'var(--text-main)', cursor: 'default' }}>
                              {val != null ? `$${val.toLocaleString()}` : '-'}
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

                      {/* Applied Charges (Directly after Agreed Rate H) */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'Applied' })}
                        style={{
                          padding: isHeader ? '0.3rem 0.4rem' : '0.2rem 0.35rem',
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: isHeader ? 900 : 700,
                          fontSize: isHeader ? '17px' : '14px',
                          color: '#047857',
                          background: 'rgba(16, 185, 129, 0.12)',
                          border: '1px solid rgba(16, 185, 129, 0.25)',
                          ...getCellHighlight('Applied')
                        }}
                      >
                        {(isHeader || row.rowType === 'Standalone')
                          ? renderEditableCell(idx, 'appliedCharges', row.appliedCharges != null ? `$${row.appliedCharges.toLocaleString()}` : '', row.appliedCharges, row.rowType, row.cmpProfInvoiceCode, row.projectCode, 'right')
                          : null}
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

                        {(isHeader || row.rowType === 'Standalone')
                          ? renderEditableCell(
                              idx,
                              'actualCharges',
                              row.actualCharges != null ? `$${row.actualCharges.toLocaleString()}` : '',
                              row.actualCharges,
                              row.rowType,
                              row.cmpProfInvoiceCode,
                              row.projectCode,
                              'right'
                            )
                          : null
                        }
                      </td>

                      {/* K: Other Charge */}
                      <td 
                        onClick={() => setSelectedCell({ rowIdx: idx, colKey: 'K' })}
                        style={{ padding: '0.2rem 0.35rem', textAlign: 'right', fontFamily: 'var(--font-mono)', color: '#b45309', fontWeight: 700, fontSize: '15px', border: '1px solid var(--border-subtle)', ...getCellHighlight('K') }}
                      >
                        {renderEditableCell(
                          idx, 
                          'otherCharge', 
                          row.isIncluded && row.otherCharge != null && row.otherCharge > 0 
                            ? `$${row.otherCharge.toLocaleString()}` 
                            : '', 
                          row.otherCharge, 
                          row.rowType, 
                          row.cmpProfInvoiceCode, 
                          row.projectCode, 
                          'right'
                        )}
                      </td>

                      {/* Inc Checkbox Column (After Other Charge) */}
                      <td style={{
                        textAlign: 'center',
                        padding: '0.15rem 0.25rem',
                        border: '1px solid var(--border-subtle)',
                        whiteSpace: 'nowrap'
                      }}>
                        {(isDetail || isStandalone) ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <input
                              type="checkbox"
                              checked={Boolean(row.isIncluded)}
                              disabled={isSavingChanges}
                              onChange={(e) => handleToggleIncluded(row.cmpProfInvoiceCode ?? -(row.projectCode || (idx + 1000)), e.target.checked, idx)}
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
                          verticalAlign: 'middle',
                          ...getCellHighlight('P')
                        }}
                      >
                        {row.profileNature ? (
                          <span style={{
                            fontSize: isHeader ? '13px' : '11px',
                            fontWeight: 800,
                            padding: isHeader ? '0.15rem 0.55rem' : '0.1rem 0.35rem',
                            borderRadius: '4px',
                            background: row.profileNature.toLowerCase() === 'executive' ? '#047857' : row.profileNature.toLowerCase() === 'real' ? '#2563eb' : 'transparent',
                            color: (row.profileNature.toLowerCase() === 'executive' || row.profileNature.toLowerCase() === 'real') ? '#ffffff' : 'inherit',
                            display: 'inline-block',
                            lineHeight: 1.2,
                            whiteSpace: 'nowrap'
                          }}>
                            {row.profileNature}
                          </span>
                        ) : ''}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
      </div>

    {/* Unsaved Changes Confirmation Modal */}
    {showUnsavedPrompt && (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        backdropFilter: 'blur(3px)'
      }}>
        <div style={{
          background: 'var(--bg-surface)',
          borderRadius: '10px',
          border: '1px solid var(--border-medium)',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
          padding: '1.5rem',
          maxWidth: '480px',
          width: '90%',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              background: 'rgba(245, 158, 11, 0.15)',
              color: '#d97706',
              borderRadius: '50%',
              padding: '0.6rem',
              display: 'flex',
              flexShrink: 0
            }}>
              <AlertTriangle size={24} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)' }}>
                Unsaved Changes Warning
              </h3>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                You have {unsavedCount} unsaved modification{unsavedCount > 1 ? 's' : ''} in this invoice sheet.
              </p>
            </div>
          </div>

          <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: '1.5', margin: 0 }}>
            Please save your changes before leaving this tab to avoid losing your work. What would you like to do?
          </p>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={() => {
                setShowUnsavedPrompt(false);
                setPendingNavigationTab(null);
              }}
              className="btn-secondary"
              style={{ padding: '0.45rem 0.85rem', fontSize: '0.82rem', fontWeight: 600, borderRadius: '6px' }}
            >
              Stay Here
            </button>

            <button
              type="button"
              onClick={() => {
                const dest = pendingNavigationTab;
                setShowUnsavedPrompt(false);
                setPendingNavigationTab(null);
                setPendingRowUpdates(new Map());
                setPendingProjectUpdates(new Map());
                if (dest) executeTabChange(dest);
              }}
              style={{
                background: 'transparent',
                border: '1px solid #ef4444',
                color: '#ef4444',
                padding: '0.45rem 0.85rem',
                fontSize: '0.82rem',
                fontWeight: 700,
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Leave Without Saving
            </button>

            <button
              type="button"
              disabled={isSavingChanges}
              onClick={async () => {
                await handleManualSave();
                const dest = pendingNavigationTab;
                setShowUnsavedPrompt(false);
                setPendingNavigationTab(null);
                if (dest) executeTabChange(dest);
              }}
              className="btn-primary"
              style={{
                background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                color: '#ffffff',
                padding: '0.45rem 0.95rem',
                fontSize: '0.82rem',
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                borderRadius: '6px'
              }}
            >
              <Save size={14} />
              <span>Save & Continue</span>
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
);
};
