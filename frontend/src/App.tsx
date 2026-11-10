import React, { useState, useEffect } from 'react';
import { api } from './api/client';
import { Navbar } from './components/Navbar';
import { Login } from './components/Login';
import { DashboardView } from './components/DashboardView';
import { CompanyInvoicingView } from './components/CompanyInvoicingView';
import { AdvanceFundsView } from './components/AdvanceFundsView';
import { FinalInvoiceView } from './components/FinalInvoiceView';
import { LookupsView } from './components/LookupsView';
import { ProfileInvoicingView } from './components/ProfileInvoicingView';
import type { UserInfo } from './types';
import { ThemeProvider } from './context/ThemeContext';
import { MonthProvider, useMonth } from './context/MonthContext';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2.5rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '12px', margin: '2rem auto', maxWidth: '800px', color: '#fca5a5' }}>
          <h2 style={{ color: '#ef4444', marginBottom: '0.75rem' }}>An error occurred in this view</h2>
          <p style={{ color: '#fca5a5', fontSize: '0.9rem', marginBottom: '1.25rem', fontFamily: 'monospace' }}>
            {this.state.error?.message || 'Unknown runtime error'}
          </p>
          <button
            className="btn-primary"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const AppContent: React.FC = () => {
  const [user, setUser] = useState<UserInfo | null>(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

  const { selectedMonth, setSelectedMonth } = useMonth();
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [dbInfo, setDbInfo] = useState<{ connected: boolean; database?: string; server?: string }>({
    connected: true,
    database: 'Invoicing_System'
  });

  // Navigation state: used to deep-link into ProfileInvoicing → Excel → Unprocessed
  const [profileInvoicingNavigateTo, setProfileInvoicingNavigateTo] = useState<{
    subTab: 'excel';
    excelTab: 'unprocessed';
    month?: string;
  } | null>(null);

  useEffect(() => {
    let isMounted = true;
    api.getSystemDbInfo().then((info: { connected: boolean; database?: string; server?: string }) => {
      if (isMounted && info) {
        setDbInfo(info);
      }
    });

    const handleUnauthorized = () => {
      setUser(null);
    };
    window.addEventListener('auth-unauthorized', handleUnauthorized);

    return () => {
      isMounted = false;
      window.removeEventListener('auth-unauthorized', handleUnauthorized);
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const handleSelectMonthFromDashboard = (month: string) => {
    setSelectedMonth(month);
    setCurrentTab('company-invoices');
  };

  if (!user) {
    return <Login onLoginSuccess={(u) => setUser(u)} />;
  }

  const isProfileInvoicing = currentTab === 'profile-invoicing';

  return (
    <div style={{ height: '100dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        user={user}
        onLogout={handleLogout}
      />

      <ErrorBoundary>
        <main style={{
          flex: 1,
          minHeight: 0,
          maxWidth: '100%',
          width: '100%',
          margin: '0 auto',
          padding: isProfileInvoicing ? '4px 8px' : '1.5rem',
          boxSizing: 'border-box',
          ...(isProfileInvoicing
            ? { display: 'flex', flexDirection: 'column', overflow: 'hidden' }
            : { overflowY: 'auto' })
        }}>
          {currentTab === 'dashboard' && (
            <DashboardView onSelectMonth={handleSelectMonthFromDashboard} />
          )}

          {currentTab === 'company-invoices' && (
            <CompanyInvoicingView
              initialMonth={selectedMonth}
              onMonthChange={(m) => setSelectedMonth(m)}
              onNavigateToUnprocessed={(month: string) => {
                setSelectedMonth(month);
                setCurrentTab('profile-invoicing');
                setProfileInvoicingNavigateTo({ subTab: 'excel', excelTab: 'unprocessed', month });
              }}
            />
          )}

          {currentTab === 'profile-invoicing' && (
            <ProfileInvoicingView
              user={user}
              initialMonth={selectedMonth}
              onMonthChange={(m) => setSelectedMonth(m)}
              navigateTo={profileInvoicingNavigateTo}
              onNavigateDone={() => setProfileInvoicingNavigateTo(null)}
            />
          )}

          {currentTab === 'advance-funds' && (
            <AdvanceFundsView
              initialMonth={selectedMonth}
              onMonthChange={(m) => setSelectedMonth(m)}
            />
          )}

          {currentTab === 'final-invoices' && (
            <FinalInvoiceView
              initialMonth={selectedMonth}
              onMonthChange={(m) => setSelectedMonth(m)}
            />
          )}

          {currentTab === 'lookups' && (
            <LookupsView />
          )}
        </main>
      </ErrorBoundary>

      <footer style={{
        flexShrink: 0,
        borderTop: '1px solid var(--border-subtle)',
        padding: isProfileInvoicing ? '0.25rem 1rem' : '1rem 2rem',
        background: 'var(--bg-secondary)',
        fontSize: '0.72rem',
        color: 'var(--text-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.5rem'
      }}>
        <div>
          <span>&copy; {new Date().getFullYear()} Rizvi'z LLC Invoicing Modernization.</span>
          <span style={{
            marginLeft: '0.75rem',
            color: dbInfo.connected ? 'var(--accent-emerald)' : 'var(--accent-rose)'
          }}>
            ● Database {dbInfo.connected ? `Connected (${dbInfo.database || 'Invoicing_System'})` : 'Disconnected'}
          </span>
        </div>
        <div>
          <span>PowerBuilder Migration: .NET 8 Web API + React Vite + QuestPDF</span>
        </div>
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <MonthProvider>
        <AppContent />
      </MonthProvider>
    </ThemeProvider>
  );
};

export default App;
