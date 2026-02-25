import { CheckCircle2, AlertTriangle, CircleSlash, Clock3 } from 'lucide-react';
import { cn } from '../../lib/utils';

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
  const Icon = status === 'ok' ? CheckCircle2 : status === 'warn' ? AlertTriangle : status === 'error' ? CircleSlash : Clock3;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold shadow-[0_1px_0_rgba(255,255,255,0.6)]',
        statusStyles[status],
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
