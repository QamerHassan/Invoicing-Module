import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, X, Check, Users } from 'lucide-react';

export interface OwnerOption {
  prfOwnCode: number;
  profileName?: string | null;
  profileType?: string | null;
  isProfgrpOwner?: string | null;
}

export interface OwnerSearchSelectProps {
  owners: OwnerOption[];
  value: number | '';
  onChange: (value: number | '') => void;
  placeholder?: string;
  allowAll?: boolean;
  allLabel?: string;
  emptyMessage?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
  width?: string | number;
  compact?: boolean;
}

export const OwnerSearchSelect: React.FC<OwnerSearchSelectProps> = ({
  owners,
  value,
  onChange,
  placeholder = 'Select Owner...',
  allowAll = true,
  allLabel = 'All Owners',
  emptyMessage,
  disabled = false,
  style,
  className,
  width = '100%',
  compact = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Find currently selected owner
  const selectedOwner = useMemo(() => {
    if (value === '' || value === 0 || value == null) return null;
    return owners.find(o => o.prfOwnCode === Number(value)) || null;
  }, [owners, value]);

  // Filter owners live based on searchQuery
  const filteredOwners = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return owners;

    // Check if user is searching by ID like "#5" or "5"
    const cleanId = q.startsWith('#') ? q.slice(1).trim() : q;

    return owners.filter(o => {
      const nameMatch = (o.profileName || '').toLowerCase().includes(q);
      const idExactMatch = cleanId !== '' && o.prfOwnCode.toString() === cleanId;
      const idContainsMatch = cleanId !== '' && o.prfOwnCode.toString().includes(cleanId);
      return nameMatch || idExactMatch || idContainsMatch;
    });
  }, [owners, searchQuery]);

  // Combined options: optionally include "All Owners" at the top
  const showAllOption = allowAll && owners.length > 0 && (!searchQuery.trim() || 'all owners'.includes(searchQuery.trim().toLowerCase()));

  // Total selectable items count for keyboard nav
  const totalItems = (showAllOption ? 1 : 0) + filteredOwners.length;

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
        setHighlightedIndex(-1);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setHighlightedIndex(0);
    } else {
      setSearchQuery('');
      setHighlightedIndex(-1);
    }
  }, [isOpen]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current && highlightedIndex >= 0) {
      const items = listRef.current.querySelectorAll('[data-combobox-item]');
      if (items[highlightedIndex]) {
        (items[highlightedIndex] as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleSelectOwner = (code: number | '') => {
    onChange(code);
    setIsOpen(false);
    setSearchQuery('');
    setHighlightedIndex(-1);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onChange('');
    setSearchQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev + 1 < totalItems ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev - 1 >= 0 ? prev - 1 : totalItems - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < totalItems) {
        if (showAllOption && highlightedIndex === 0) {
          handleSelectOwner('');
        } else {
          const ownerIdx = showAllOption ? highlightedIndex - 1 : highlightedIndex;
          if (filteredOwners[ownerIdx]) {
            handleSelectOwner(filteredOwners[ownerIdx].prfOwnCode);
          }
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setSearchQuery('');
      setHighlightedIndex(-1);
    }
  };

  // Determine display text for the trigger button
  const displayLabel = useMemo(() => {
    if (selectedOwner) {
      return `${selectedOwner.profileName} (#${selectedOwner.prfOwnCode})`;
    }
    if (owners.length === 0) {
      return placeholder;
    }
    if (allowAll && (value === '' || value == null)) {
      return allLabel;
    }
    return placeholder;
  }, [selectedOwner, owners.length, allowAll, value, allLabel, placeholder]);

  const hasSelection = selectedOwner != null || (allowAll && value !== '' && value != null);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width,
        userSelect: 'none',
        ...style
      }}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger Control */}
      <div
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          background: 'var(--bg-surface)',
          color: selectedOwner ? 'var(--text-main)' : (allowAll && (value === '' || value == null) ? 'var(--text-main)' : 'var(--text-muted)'),
          border: isOpen ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
          boxShadow: isOpen ? '0 0 0 2px var(--accent-glow)' : 'none',
          borderRadius: 'var(--radius-sm)',
          padding: compact ? '0.2rem 0.5rem' : '0.5rem 0.75rem',
          fontSize: compact ? '0.8rem' : '0.875rem',
          height: compact ? '32px' : undefined,
          boxSizing: 'border-box',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          transition: 'all 0.15s ease'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <Users size={15} color="var(--text-subtle)" style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: selectedOwner ? 600 : 400 }}>
            {displayLabel}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
          {/* Clear button (x) */}
          {hasSelection && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              title="Clear selection"
              style={{
                background: 'transparent',
                border: 'none',
                padding: '0.15rem',
                cursor: 'pointer',
                color: 'var(--text-subtle)',
                display: 'flex',
                alignItems: 'center',
                borderRadius: '3px'
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-main)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-subtle)')}
            >
              <X size={14} />
            </button>
          )}
          <ChevronDown
            size={15}
            color="var(--text-subtle)"
            style={{
              transition: 'transform 0.15s ease',
              transform: isOpen ? 'rotate(180deg)' : 'none'
            }}
          />
        </div>
      </div>

      {/* Floating Dropdown Popover */}
      {isOpen && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            minWidth: '260px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 1000,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* Search Input Filter */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 0.75rem',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-secondary)'
            }}
          >
            <Search size={14} color="var(--text-subtle)" style={{ flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              placeholder="Search by name or #ID..."
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-main)',
                fontSize: '0.825rem',
                width: '100%'
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  inputRef.current?.focus();
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-subtle)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex'
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Options List */}
          <div
            ref={listRef}
            style={{
              maxHeight: '240px',
              overflowY: 'auto',
              padding: '0.25rem 0'
            }}
          >
            {/* "All Owners" option if allowed */}
            {showAllOption && (
              <div
                data-combobox-item
                role="option"
                aria-selected={value === '' || value == null}
                onClick={() => handleSelectOwner('')}
                onMouseEnter={() => setHighlightedIndex(0)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.825rem',
                  cursor: 'pointer',
                  color: value === '' || value == null ? 'var(--accent-primary)' : 'var(--text-main)',
                  fontWeight: value === '' || value == null ? 600 : 400,
                  background: highlightedIndex === 0 ? 'var(--bg-surface-hover)' : 'transparent',
                  borderBottom: '1px dashed var(--border-subtle)'
                }}
              >
                <span>{allLabel}</span>
                {(value === '' || value == null) && <Check size={14} color="var(--accent-primary)" />}
              </div>
            )}

            {/* Filtered Owners */}
            {filteredOwners.length === 0 ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                {emptyMessage || 'No owners found'}
              </div>
            ) : (
              filteredOwners.map((owner, idx) => {
                const itemIndex = (showAllOption ? 1 : 0) + idx;
                const isSelected = value === owner.prfOwnCode;
                const isHighlighted = highlightedIndex === itemIndex;

                return (
                  <div
                    key={owner.prfOwnCode}
                    data-combobox-item
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelectOwner(owner.prfOwnCode)}
                    onMouseEnter={() => setHighlightedIndex(itemIndex)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.45rem 0.75rem',
                      fontSize: '0.825rem',
                      cursor: 'pointer',
                      color: isSelected ? 'var(--accent-primary)' : 'var(--text-main)',
                      fontWeight: isSelected ? 600 : 400,
                      background: isHighlighted ? 'var(--bg-surface-hover)' : 'transparent',
                      transition: 'background 0.1s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {owner.profileName}
                      </span>
                      <span
                        style={{
                          fontSize: '0.725rem',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--text-subtle)',
                          background: 'rgba(255, 255, 255, 0.05)',
                          padding: '0.1rem 0.35rem',
                          borderRadius: '3px'
                        }}
                      >
                        #{owner.prfOwnCode}
                      </span>
                    </div>

                    {isSelected && <Check size={14} color="var(--accent-primary)" style={{ flexShrink: 0, marginLeft: '0.5rem' }} />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

