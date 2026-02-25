import { CheckCircle2, AlertTriangle, CircleSlash, Clock3 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTheme } from '../../theme/ThemeProvider';

interface StatusPillProps {
  status: 'ok' | 'warn' | 'error' | 'neutral';
  label: string;
  className?: string;
}

const statusStyles: Record<StatusPillProps['status'], string> = {
  ok: 'border-emerald-200/80 bg-emerald-50/90 text-emerald-800',
  warn: 'border-amber-200/80 bg-amber-50/90 text-amber-800',
  error: 'border-rose-200/80 bg-rose-50/90 text-rose-800',
  neutral: 'border-slate-200/90 bg-slate-100/90 text-slate-700',
};

export function StatusPill({ status, label, className }: StatusPillProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const Icon = status === 'ok' ? CheckCircle2 : status === 'warn' ? AlertTriangle : status === 'error' ? CircleSlash : Clock3;
  const darkStatusStyles: Record<StatusPillProps['status'], string> = {
    ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    warn: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    error: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
    neutral: 'border-slate-500/40 bg-slate-700/30 text-slate-200',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-[0_1px_0_rgba(255,255,255,0.6)]',
        isDark ? darkStatusStyles[status] : statusStyles[status],
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
