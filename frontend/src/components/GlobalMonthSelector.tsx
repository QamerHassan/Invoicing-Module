import React from 'react';
import { Calendar } from 'lucide-react';
import { useMonth } from '../context/MonthContext';

interface GlobalMonthSelectorProps {
  className?: string;
  style?: React.CSSProperties;
}

export const GlobalMonthSelector: React.FC<GlobalMonthSelectorProps> = ({ style }) => {
  const { selectedMonth, setSelectedMonth, availableMonths, loadingMonths } = useMonth();

  // Ensure selectedMonth is always in the options list so it displays properly
  const cleanSelected = (selectedMonth || '').trim().replace('-', '').toUpperCase();
  const options = React.useMemo(() => {
    const list = [...availableMonths];
    if (cleanSelected && !list.includes(cleanSelected)) {
      list.unshift(cleanSelected);
    }
    return list.length > 0 ? list : ['OCT26', 'SEP26', 'AUG26', 'JUL26'];
  }, [availableMonths, cleanSelected]);

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.45rem',
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.10) 0%, rgba(6, 182, 212, 0.10) 100%)',
        border: '1.5px solid #6366f1',
        borderRadius: '7px',
        padding: '0.15rem 0.55rem',
        height: '32px',
        boxShadow: '0 0 10px rgba(99, 102, 241, 0.20)',
        boxSizing: 'border-box',
        ...style
      }}
      title="Global Billing Month Selection (active across all pages)"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#6366f1' }}>
        <Calendar size={15} style={{ flexShrink: 0 }} />
        <span style={{
          fontSize: '0.78rem',
          fontWeight: 800,
          color: 'var(--text-main)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          userSelect: 'none'
        }}>
          Month:
        </span>
      </div>

      <select
        id="global-month-selector"
        value={cleanSelected}
        onChange={(e) => setSelectedMonth(e.target.value)}
        disabled={loadingMonths}
        style={{
          background: 'var(--bg-surface)',
          color: 'var(--text-main)',
          border: '1px solid rgba(99, 102, 241, 0.4)',
          borderRadius: '5px',
          padding: '0.15rem 0.6rem',
          fontSize: '0.85rem',
          fontWeight: 800,
          fontFamily: 'var(--font-mono)',
          height: '26px',
          minWidth: '100px',
          cursor: 'pointer',
          outline: 'none',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
          transition: 'all 0.15s ease'
        }}
      >
        {options.map((m) => (
          <option
            key={m}
            value={m}
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-main)',
              fontWeight: 700
            }}
          >
            {m}
          </option>
        ))}
      </select>
    </div>
  );
};
