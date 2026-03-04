import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/80 pb-3">
      <div>
        <h3 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-slate-600/95">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
