'use client';

import { useEffect, useState } from 'react';
import Icon from './icon';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    try {
      const current = document.documentElement.dataset.theme;
      if (current === 'dark' || current === 'light') {
        setTheme(current);
      } else {
        const stored = localStorage.getItem('hms-theme');
        if (stored === 'dark' || stored === 'light') {
          setTheme(stored);
        } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          setTheme('dark');
        }
      }
    } catch {
      // Fallback to light
    }
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('hms-theme', next);
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}

export default ThemeToggle;
