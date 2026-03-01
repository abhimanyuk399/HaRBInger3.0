import type { ReactNode } from 'react';
import { ConsoleCard } from './ConsoleCard';
import { StatusPill } from './StatusPill';
import { formatDateTime } from '../utils';

interface PortalPageHeaderProps {
  title: string;
  subtitle: string;
  environmentLabel?: string;
  lastRefreshAt?: string | null;
  badges?: ReactNode;
  actions?: ReactNode;
}

export function PortalPageHeader({
  title,
  subtitle,
  environmentLabel = 'Local',
  lastRefreshAt,
  badges,
  actions,
}: PortalPageHeaderProps) {
  return (
    <ConsoleCard className="relative overflow-hidden border-slate-200/80 bg-[linear-gradient(120deg,rgba(255,255,255,0.96),rgba(248,250,252,0.94))]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-blue-100/60 blur-2xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-16 left-6 h-40 w-40 rounded-full bg-emerald-100/50 blur-2xl"
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Secure Banking Console</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
          <p className="mt-1 text-sm text-slate-600/95">{subtitle}</p>
        </div>
        {actions}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="kyc-theme-chip is-info">HaRBInger 2025</span>
        <span className="kyc-theme-chip is-ok">Identity • Integrity • Inclusivity</span>
        <StatusPill status="neutral" label={`Env: ${environmentLabel}`} />
        <StatusPill status="neutral" label={`Last refresh: ${formatDateTime(lastRefreshAt ?? new Date().toISOString())}`} />
        {badges}
      </div>
    </ConsoleCard>
  );
}
