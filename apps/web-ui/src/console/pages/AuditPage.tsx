import { Copy, Download, RefreshCw, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useConsole } from '../ConsoleContext';
import { ConsoleButton } from '../components/ConsoleButton';
import { CardHint, CardTitle, ConsoleCard } from '../components/ConsoleCard';
import { JsonBlock } from '../components/JsonBlock';
import { SectionHeader } from '../components/SectionHeader';
import { StatusPill } from '../components/StatusPill';
import type { ServiceName } from '../types';
import { formatDateTime, serviceLabel, truncate } from '../utils';

const filters: Array<'all' | ServiceName> = ['all', 'issuer', 'registry', 'consent', 'wallet', 'fi', 'ckyc', 'review', 'console'];

export default function AuditPage() {
  const {
    runningAction,
    tokenId,
    activities,
    apiLogs,
    failures,
    serviceHealth,
    registryAudit,
    refreshRegistryEvidence,
    refreshServiceHealth,
  } = useConsole();

  const [activityFilter, setActivityFilter] = useState<'all' | ServiceName>('all');
  const [logFilter, setLogFilter] = useState<'all' | ServiceName>('all');
  const [copied, setCopied] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const focusLogId = searchParams.get('focusLog');

  const timeline = useMemo(() => {
    if (activityFilter === 'all') {
      return activities.slice(0, 20);
    }
    return activities.filter((event) => event.service === activityFilter).slice(0, 20);
  }, [activities, activityFilter]);

  const logs = useMemo(() => {
    if (logFilter === 'all') {
      return apiLogs.slice(0, 20);
    }
    return apiLogs.filter((entry) => entry.service === logFilter).slice(0, 20);
  }, [apiLogs, logFilter]);

  useEffect(() => {
    if (!focusLogId) {
      return;
    }
    const timer = window.setTimeout(() => {
      const node = document.getElementById(`api-log-${focusLogId}`);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [focusLogId, logs]);

  const groupedTimeline = useMemo(() => {
    return timeline.reduce<Record<string, typeof timeline>>((accumulator, event) => {
      const key = event.service;
      accumulator[key] = accumulator[key] ? [...accumulator[key], event] : [event];
      return accumulator;
    }, {});
  }, [timeline]);

  const exportPayload = useMemo(
    () => ({
      exportedAt: new Date().toISOString(),
      timeline,
      apiLogs: logs,
      failures: failures.slice(0, 20),
      serviceHealth,
    }),
    [failures, logs, serviceHealth, timeline]
  );

  const copyRaw = async (label: string, value: unknown) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setCopied(label);
      window.setTimeout(() => setCopied((previous) => (previous === label ? null : previous)), 1200);
    } catch {
      setCopied(null);
    }
  };

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied((previous) => (previous === label ? null : previous)), 1200);
    } catch {
      setCopied(null);
    }
  };

  const downloadExport = () => {
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'bharat-kyc-audit-export.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };


const downloadExportCsv = () => {
  const esc = (value: unknown) => {
    const raw = value === null || typeof value === 'undefined' ? '' : String(value);
    const safe = raw.replace(/"/g, '""');
    return `"${safe}"`;
  };

  const header = ['at', 'service', 'label', 'id', 'detail'];
  const rows = exportPayload.timeline.map((event) => [
    esc(event.at),
    esc(event.service),
    esc(event.label),
    esc(event.id),
    esc(typeof event.detail === 'string' ? event.detail : event.detail ? JSON.stringify(event.detail) : ''),
  ]);

  const csv = [header.map(esc).join(','), ...rows.map((row) => row.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bharat-kyc-t_audit_export_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

  return (
    <div className="space-y-4">
      {/* helper removed */}

      <ConsoleCard>
        <SectionHeader
          title="Audit Timeline"
          subtitle="Unified event trail across issuer, registry, consent, wallet, FI, CKYCR and review services."
          action={
            <div className="flex items-center gap-2">
              <ConsoleButton intent="secondary" size="sm" onClick={downloadExport}>
                <Download className="h-3.5 w-3.5" />
                Export JSON
              </ConsoleButton>

<ConsoleButton intent="secondary" size="sm" onClick={downloadExportCsv}>
  <Download className="h-3.5 w-3.5" />
  Export CSV
</ConsoleButton>

              <ConsoleButton intent="secondary" size="sm" onClick={() => void copyRaw('export', exportPayload)}>
                <Copy className="h-3.5 w-3.5" />
                {copied === 'export' ? 'Copied' : 'Copy'}
              </ConsoleButton>
            </div>
          }
        />

        <div className="mb-3 flex flex-wrap gap-2">
          {filters.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setActivityFilter(filter)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                activityFilter === filter
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {filter === 'all' ? 'All' : serviceLabel[filter]}
            </button>
          ))}
        </div>

        <div id="timeline" className="max-h-[320px] space-y-2 overflow-auto pr-1">
          {timeline.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600">No timeline events yet.</p>
          ) : (
            Object.entries(groupedTimeline).map(([service, events]) => (
              <div key={service} className="rounded-lg border border-slate-200 bg-white p-2.5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{serviceLabel[service as ServiceName]}</p>
                {events.map((event) => (
                  <div key={event.id} className="mb-1 rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>{formatDateTime(event.at)}</span>
                    </div>
                    

<div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
  <span className="font-mono">{truncate(event.id, 18)}</span>
  <button
    type="button"
    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:border-slate-300"
    onClick={() => void copyText(`event-${event.id}`, event.id)}
  >
    <Copy className="h-3.5 w-3.5" />
    {copied === `event-${event.id}` ? 'Copied' : 'Copy'}
  </button>
</div>
<p className="mt-1 text-sm font-medium text-slate-900">{event.label}</p>
                    {event.detail ? (
                      <p className="mt-1 text-xs text-slate-600">{typeof event.detail === 'string' ? event.detail : JSON.stringify(event.detail)}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </ConsoleCard>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <ConsoleCard id="request-response-inspector">
          <SectionHeader
            title="Request/Response Inspector"
            subtitle="Last API calls with method, endpoint, status, and payload snippets."
          />

          <div className="mb-3 flex flex-wrap gap-2">
            {filters.map((filter) => (
              <button
                key={`logs-${filter}`}
                type="button"
                onClick={() => setLogFilter(filter)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  logFilter === filter
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {filter === 'all' ? 'All' : serviceLabel[filter]}
              </button>
            ))}
          </div>

          <div className="max-h-[500px] space-y-2 overflow-auto pr-1">
            {logs.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600">No API calls logged yet.</p>
            ) : (
              logs.map((entry) => (
                <details
                  key={entry.id}
                  id={`api-log-${entry.id}`}
                  open={focusLogId === entry.id}
                  className={`rounded-lg border p-2.5 ${
                    focusLogId === entry.id
                      ? 'border-orange-300 bg-orange-50 shadow-[0_0_0_1px_rgba(251,146,60,0.35)]'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs text-slate-500">{formatDateTime(entry.at)} | {serviceLabel[entry.service]}</p>
                        <p className="text-sm font-semibold text-slate-900">{entry.title}</p>
                        <p className="text-xs text-slate-600">
                          {entry.method} {truncate(entry.path, 80)} | status {entry.statusCode ?? '-'} | {entry.durationMs}ms
                        </p>
                      </div>
                      <StatusPill status={entry.ok ? 'ok' : 'error'} label={entry.ok ? 'ok' : 'fail'} />
                    </div>
                  </summary>
                  <div className="mt-2 grid gap-2">
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Request</p>
                      <JsonBlock value={entry.requestBody ?? {}} compact />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Response</p>
                      <JsonBlock value={entry.responseBody ?? {}} compact />
                    </div>
                  </div>
                </details>
              ))
            )}
          </div>
        </ConsoleCard>

        <div className="space-y-4">
          <ConsoleCard id="registry-chain">
            <SectionHeader
              title="Registry Audit Chain"
              subtitle="Hash-linked chain from registry audit endpoint."
              action={
                <ConsoleButton
                  intent="secondary"
                  size="sm"
                  onClick={() => void refreshRegistryEvidence(tokenId ?? undefined)}
                  disabled={runningAction !== null || !tokenId}
                >
                  Refresh Chain
                </ConsoleButton>
              }
            />
            <p className="text-xs text-slate-600">tokenId: {tokenId ?? '-'}</p>
            <div className="mt-2 max-h-40 space-y-2 overflow-auto pr-1">
              {registryAudit.length === 0 ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600">No registry chain loaded yet.</p>
              ) : (
                registryAudit.map((event, index) => (
                  <div key={`${event.hashCurr}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">{event.eventType}</p>
                    <p>{formatDateTime(event.createdAt)}</p>
                    <p>hash_prev: {truncate(event.hashPrev ?? '-', 20)}</p>
                    <p>hash_curr: {truncate(event.hashCurr, 20)}</p>
                  </div>
                ))
              )}
            </div>
          </ConsoleCard>

          <ConsoleCard>
            <SectionHeader
              title="Service Health"
              subtitle="Readiness probes from each service."
              action={
                <ConsoleButton intent="secondary" size="sm" onClick={() => void refreshServiceHealth()} disabled={runningAction !== null}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </ConsoleButton>
              }
            />
            <div className="space-y-2">
              {serviceHealth.map((row) => (
                <div key={row.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{row.label}</p>
                    <StatusPill
                      status={row.status === 'ok' ? 'ok' : row.status === 'degraded' ? 'warn' : row.status === 'down' ? 'error' : 'neutral'}
                      label={row.status.toUpperCase()}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-600">statusCode: {row.statusCode ?? '-'}</p>
                  <p className="text-xs text-slate-600">updatedAt: {formatDateTime(row.updatedAt)}</p>
                </div>
              ))}
            </div>
          </ConsoleCard>

          <ConsoleCard>
            <CardTitle>Failure Reason Cards</CardTitle>
            <CardHint>Unified non-2xx errors from all services.</CardHint>
            <div className="mt-3 max-h-[260px] space-y-2 overflow-auto pr-1">
              {failures.slice(0, 5).map((failure) => (
                <div key={failure.id} className="rounded-lg border border-rose-200 bg-rose-50 p-2.5">
                  <div className="flex items-center gap-2 text-xs text-rose-700">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {formatDateTime(failure.at)}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-rose-900">
                    {serviceLabel[failure.service]} | {failure.errorCode}
                  </p>
                  <p className="text-xs text-rose-800">{failure.message}</p>
                  <p className="mt-1 text-[11px] text-rose-700">{truncate(failure.endpoint, 80)}</p>
                </div>
              ))}
              {failures.length === 0 ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600">No failures recorded.</p>
              ) : null}
            </div>
          </ConsoleCard>
        </div>
      </div>
    </div>
  );
}
