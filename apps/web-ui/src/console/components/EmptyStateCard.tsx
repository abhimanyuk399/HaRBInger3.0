import type { ReactNode } from 'react';

interface EmptyStateCardProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyStateCard({ title, description, action }: EmptyStateCardProps) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-5 text-center">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-xs text-slate-600">{description}</p>
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}
