import { ClipboardCopy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ActivityEvent, ActivityStatus, ServiceName } from '../types';
import { formatDateTime, serviceLabel } from '../utils';
import { ConsoleCard } from './ConsoleCard';
import { SectionHeader } from './SectionHeader';
import { StatusPill } from './StatusPill';

type ActivityType = 'consent' | 'token' | 'verify' | 'delegation' | 'other';

const STATUS_FILTERS: Array<{ id: 'all' | ActivityStatus; label: string }> = [
  { id: 'all', label: 'All status' },
  { id: 'success', label: 'Success' },
  { id: 'failed', label: 'Failed' },
  { id: 'info', label: 'Info' },
];

const SERVICE_FILTERS: Array<{ id: 'all' | ServiceName; label: string }> = [
  { id: 'all', label: 'All services' },
  { id: 'issuer', label: 'Issuer' },
  { id: 'registry', label: 'Registry' },
  { id: 'consent', label: 'Consent' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'fi', label: 'FI' },
  { id: 'ckyc', label: 'CKYCR' },
  { id: 'review', label: 'Review' },
  { id: 'console', label: 'Console' },
];

const TYPE_FILTERS: Array<{ id: 'all' | ActivityType; label: string }> = [
  { id: 'all', label: 'All types' },
  { id: 'consent', label: 'Consent' },
  { id: 'token', label: 'Token' },
  { id: 'verify', label: 'Verify' },
  { id: 'delegation', label: 'Delegation' },
];

function inferActivityType(event: ActivityEvent): ActivityType {
  const haystack = `${event.label} ${typeof event.detail === 'string' ? event.detail : ''}`.toLowerCase();
  if (haystack.includes('delegation') || haystack.includes('nominee')) {
    return 'delegation';
  }
  if (haystack.includes('verify') || haystack.includes('assertion')) {
    return 'verify';
  }
  if (haystack.includes('consent')) {
    return 'consent';
  }
  if (haystack.includes('token') || haystack.includes('supersede') || haystack.includes('revoke')) {
    return 'token';
  }
  return 'other';
}

function statusPill(status: ActivityStatus): { status: 'ok' | 'warn' | 'error' | 'neutral'; label: string } {
  if (status === 'success') {
    return { status: 'ok', label: 'Success' };
  }
  if (status === 'failed') {
    return { status: 'error', label: 'Failed' };
  }
  return { status: 'neutral', label: 'Info' };
}

function detailAsText(detail: unknown): string {
  if (detail === undefined || detail === null) {
    return '';
  }
  if (typeof detail === 'string') {
    return detail;
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}


interface ActivityTimelineQuickFilter {
  id: string;
  label: string;
  type?: 'all' | ActivityType;
  service?: 'all' | ServiceName;
  status?: 'all' | ActivityStatus;
}

interface ActivityTimelineProps {
  events: ActivityEvent[];
  title?: string;
  subtitle?: string;
  maxItems?: number;
  links?: Partial<Record<ActivityType, string>>;
  className?: string;
  quickFilters?: ActivityTimelineQuickFilter[];
}

export function ActivityTimeline({
  events,
  title = 'Recent Activity',
  subtitle = 'Latest events with service, status, and deep links.',
  maxItems = 20,
  links,
  className,
  quickFilters,
}: ActivityTimelineProps) {
  const [serviceFilter, setServiceFilter] = useState<'all' | ServiceName>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ActivityStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | ActivityType>('all');
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);


  const applyQuickFilter = (filter: ActivityTimelineQuickFilter) => {
    setTypeFilter(filter.type ?? 'all');
    setServiceFilter(filter.service ?? 'all');
    setStatusFilter(filter.status ?? 'all');
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedEventId(value);
      window.setTimeout(() => {
        setCopiedEventId((previous) => (previous === value ? null : previous));
      }, 1200);
    } catch {
      // ignore clipboard errors in restricted environments
    }
  };

  const isQuickFilterActive = (filter: ActivityTimelineQuickFilter) =>
    (filter.type ?? 'all') === typeFilter &&
    (filter.service ?? 'all') === serviceFilter &&
    (filter.status ?? 'all') === statusFilter;

  const filtered = useMemo(() => {
    return events
      .filter((event) => (serviceFilter === 'all' ? true : event.service === serviceFilter))
      .filter((event) => (statusFilter === 'all' ? true : event.status === statusFilter))
      .filter((event) => (typeFilter === 'all' ? true : inferActivityType(event) === typeFilter))
      .slice(0, maxItems);
  }, [events, maxItems, serviceFilter, statusFilter, typeFilter]);

  return (
    <ConsoleCard className={className}>
      <SectionHeader title={title} subtitle={subtitle} />


      {quickFilters && quickFilters.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {quickFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => applyQuickFilter(filter)}
              className={
                isQuickFilterActive(filter)
                  ? 'rounded-full border border-blue-300/70 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 shadow-sm ring-1 ring-blue-200/70'
                  : 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50'
              }
            >
              {filter.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mb-3 grid gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-2 md:grid-cols-3">
        <select
          value={serviceFilter}
          onChange={(event) => setServiceFilter(event.target.value as 'all' | ServiceName)}
          className="kyc-form-select kyc-form-input-sm w-full text-xs text-slate-700"
        >
          {SERVICE_FILTERS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as 'all' | ActivityStatus)}
          className="kyc-form-select kyc-form-input-sm w-full text-xs text-slate-700"
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as 'all' | ActivityType)}
          className="kyc-form-select kyc-form-input-sm w-full text-xs text-slate-700"
        >
          {TYPE_FILTERS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
        {filtered.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No matching activity.</p>
        ) : (
          filtered.map((event) => {
            const eventType = inferActivityType(event);
            const deepLink = links?.[eventType];
            const detail = detailAsText(event.detail);
            const pill = statusPill(event.status);
            return (
              <div key={event.id} className="rounded-xl border border-slate-200/90 bg-slate-50/90 p-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StatusPill status={pill.status} label={pill.label} />
                    <span className="text-xs font-semibold text-slate-700">{serviceLabel[event.service]}</span>
                    <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] uppercase text-slate-500">
                      {eventType}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">{formatDateTime(event.at)}</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-900">{event.label}</p>
                {detail ? <p className="mt-1 text-xs text-slate-600">{detail}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  {deepLink ? (
                    <Link to={deepLink} className="font-semibold text-slate-700 hover:underline">
                      Open detail
                    </Link>
                  ) : null}
                  <span className="font-mono text-slate-500">{event.id}</span>
                  <button
                    type="button"
                    onClick={() => void copy(event.id)}
                    className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline"
                  >
                    <ClipboardCopy className="h-3.5 w-3.5" />
                    {copiedEventId === event.id ? 'Copied' : 'Copy id'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </ConsoleCard>
  );
}
