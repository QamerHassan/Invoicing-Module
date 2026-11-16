import React from 'react';
import { 
  LayoutDashboard, 
  Receipt, 
  Wallet, 
  FileCheck2, 
  Database, 
  LogOut, 
  ShieldCheck,
  Building2,
  Sun,
  Moon,
  Users
} from 'lucide-react';
import type { UserInfo } from '../types';
import { useTheme } from '../context/ThemeContext';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  user: UserInfo | null;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  user,
  onLogout
}) => {
  const { theme, toggleTheme } = useTheme();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'company-invoices', label: 'Company Invoices', icon: Receipt },
    { id: 'advance-funds', label: 'Advance Funds', icon: Wallet },
    { id: 'final-invoices', label: 'Final Invoice & PDF', icon: FileCheck2 },
    { id: 'profile-invoicing', label: 'Profile Invoicing', icon: Users },
    { id: 'lookups', label: 'Lookups & Master Data', icon: Database },
  ];

  const isLight = theme === 'light';

  return (
    <header style={{
      flexShrink: 0,
      background: isLight
        ? 'rgba(240, 242, 248, 0.90)'
        : 'rgba(15, 21, 35, 0.85)',
      backdropFilter: 'blur(16px)',
      borderBottom: '1px solid var(--border-subtle)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      padding: '0 1rem'
    }}>
      <div style={{
        maxWidth: '100%',
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '44px'
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '7px',
            background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 10px rgba(99, 102, 241, 0.35)'
          }}>
            <Building2 size={16} color="#ffffff" />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
            <span style={{ fontWeight: 800, fontSize: '0.95rem', letterSpacing: '-0.02em', color: 'var(--text-main)' }}>
              RIZVIZ <span style={{ color: '#818cf8', fontWeight: 600 }}>INVOICING</span>
            </span>
            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Financial Suite
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentTab === item.id;
            return (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                onClick={() => setCurrentTab(item.id)}
                style={{
                  height: '32px',
                  background: active 
                    ? 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)' 
                    : isLight ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.06)',
                  color: active 
                    ? '#ffffff' 
                    : isLight ? '#0f172a' : '#f8fafc',
                  border: active 
                    ? '1.5px solid #3730a3' 
                    : isLight ? '1.5px solid rgba(100, 116, 139, 0.4)' : '1.5px solid rgba(255, 255, 255, 0.18)',
                  borderRadius: '6px',
                  padding: '0.2rem 0.75rem',
                  fontSize: '0.86rem',
                  fontWeight: active ? 800 : 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  boxShadow: active 
                    ? '0 2px 8px rgba(79, 70, 229, 0.4)' 
                    : '0 1px 2px rgba(0, 0, 0, 0.05)',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Theme Toggle */}
          <button
            id="btn-toggle-theme"
            onClick={toggleTheme}
            title={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            style={{
              height: '28px',
              background: isLight
                ? 'rgba(99, 102, 241, 0.10)'
                : 'rgba(255, 255, 255, 0.07)',
              color: isLight ? '#6366f1' : '#c7d2fe',
              border: isLight
                ? '1px solid rgba(99, 102, 241, 0.25)'
                : '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.15rem 0.55rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px rgba(99,102,241,0.25)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.transform = '';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '';
            }}
          >
            {isLight ? <Moon size={13} /> : <Sun size={13} />}
            <span>{isLight ? 'Dark' : 'Light'}</span>
          </button>

          {user && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              padding: '0.15rem 0.55rem',
              borderRadius: 'var(--radius-full)',
              height: '28px'
            }}>
              <div style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: 'rgba(99, 102, 241, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#818cf8'
              }}>
                <ShieldCheck size={13} />
              </div>
              <div style={{ textAlign: 'left', lineHeight: 1.1 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-main)' }}>
                  {user.fullName || user.username}
                </span>
                <span style={{ fontSize: '0.62rem', color: 'var(--text-subtle)', marginLeft: '0.3rem' }}>
                  ({user.role})
                </span>
              </div>
            </div>
          )}

          <button
            id="btn-logout"
            onClick={onLogout}
            title="Log out"
            style={{
              height: '28px',
              background: 'rgba(244, 63, 94, 0.1)',
              color: '#fb7185',
              border: '1px solid rgba(244, 63, 94, 0.2)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.15rem 0.55rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}
          >
            <LogOut size={13} />
            <span style={{ fontSize: '0.75rem' }}>Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};
