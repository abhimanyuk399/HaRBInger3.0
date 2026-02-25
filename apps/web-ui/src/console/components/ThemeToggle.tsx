import { Moon, Sun } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTheme } from '../../theme/ThemeProvider';

interface ThemeToggleProps {
  compact?: boolean;
  className?: string;
}

export function ThemeToggle({ compact = false, className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border transition',
        compact ? 'px-2.5 py-1.5 text-xs font-semibold' : 'px-3 py-2 text-sm font-medium',
        isDark
          ? 'border-slate-600 bg-slate-900/70 text-slate-100 hover:bg-slate-800'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
        className
      )}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}
