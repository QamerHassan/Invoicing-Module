import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

const STORAGE_KEY = 'rizviz_selected_month';

interface MonthContextType {
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  availableMonths: string[];
  loadingMonths: boolean;
  refreshAvailableMonths: () => Promise<void>;
}

const MonthContext = createContext<MonthContextType | undefined>(undefined);

export const MonthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Initialize from localStorage if present
  const [selectedMonth, setSelectedMonthState] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? saved.trim().replace('-', '').toUpperCase() : '';
  });

  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [loadingMonths, setLoadingMonths] = useState<boolean>(true);

  const setSelectedMonth = useCallback((month: string) => {
    if (!month) return;
    const clean = month.trim().replace('-', '').toUpperCase();
    setSelectedMonthState(clean);
    try {
      localStorage.setItem(STORAGE_KEY, clean);
    } catch (e) {
      console.warn('Failed to save selected month to localStorage', e);
    }
  }, []);

  const refreshAvailableMonths = useCallback(async () => {
    try {
      setLoadingMonths(true);
      const months = await api.getBillingMonths();
      const cleanList = (months || []).map(m => m.trim().replace('-', '').toUpperCase());
      setAvailableMonths(cleanList);

      if (cleanList.length > 0) {
        setSelectedMonthState(prev => {
          // If we already have a selected month that exists in the list, keep it
          if (prev && cleanList.includes(prev)) {
            return prev;
          }
          // Check saved in localStorage
          const saved = localStorage.getItem(STORAGE_KEY)?.trim().replace('-', '').toUpperCase();
          if (saved && cleanList.includes(saved)) {
            return saved;
          }
          // Default to latest available billing month (first item)
          const latest = cleanList[0];
          try {
            localStorage.setItem(STORAGE_KEY, latest);
          } catch {}
          return latest;
        });
      }
    } catch (err) {
      console.error('Failed to load billing months', err);
      // Fallback sensible defaults if network/db error
      setAvailableMonths(['OCT26', 'SEP26', 'MAY26', 'APR26']);
      setSelectedMonthState(prev => prev || 'OCT26');
    } finally {
      setLoadingMonths(false);
    }
  }, []);

  useEffect(() => {
    refreshAvailableMonths();
  }, [refreshAvailableMonths]);

  return (
    <MonthContext.Provider
      value={{
        selectedMonth,
        setSelectedMonth,
        availableMonths,
        loadingMonths,
        refreshAvailableMonths
      }}
    >
      {children}
    </MonthContext.Provider>
  );
};

export const useMonth = (): MonthContextType => {
  const context = useContext(MonthContext);
  if (!context) {
    throw new Error('useMonth must be used within a MonthProvider');
  }
  return context;
};

