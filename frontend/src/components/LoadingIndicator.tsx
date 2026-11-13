import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingIndicatorProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  fullHeight?: boolean;
  inline?: boolean;
  className?: string;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  message = 'Loading...',
  size = 'md',
  fullHeight = false,
  inline = false,
  className = ''
}) => {
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 24 : 18;
  const fontSize = size === 'sm' ? '0.72rem' : size === 'lg' ? '0.88rem' : '0.78rem';

  if (inline) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 ${className}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          fontSize,
          color: 'var(--text-muted)'
        }}
      >
        <Loader2 size={iconSize} className="spin" style={{ color: 'var(--accent-primary, #6366f1)' }} />
        {message && <span>{message}</span>}
      </span>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center p-4 ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        padding: size === 'sm' ? '0.75rem' : '1.5rem',
        minHeight: fullHeight ? '240px' : size === 'sm' ? '60px' : '120px',
        color: 'var(--text-muted)',
        width: '100%',
        boxSizing: 'border-box'
      }}
    >
      <Loader2
        size={iconSize}
        className="spin"
        style={{
          color: 'var(--accent-primary, #6366f1)',
          animation: 'spin 0.8s linear infinite'
        }}
      />
      {message && (
        <span
          style={{
            fontSize,
            fontWeight: 500,
            color: 'var(--text-muted)',
            letterSpacing: '0.01em'
          }}
        >
          {message}
        </span>
      )}
    </div>
  );
};

