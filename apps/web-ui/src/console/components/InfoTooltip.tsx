import { Info } from 'lucide-react';

interface InfoTooltipProps {
  text: string;
  className?: string;
}

export function InfoTooltip({ text, className }: InfoTooltipProps) {
  return (
    <span
      title={text}
      aria-label={text}
      className={`inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 ${className ?? ''}`}
    >
      <Info className="h-3 w-3" />
    </span>
  );
}
