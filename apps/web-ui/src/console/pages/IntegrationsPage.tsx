import { CalendarClock, Layers, Link2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useConsole } from '../ConsoleContext';
import { ConsoleButton } from '../components/ConsoleButton';
import { ConsoleCard } from '../components/ConsoleCard';
import { SectionHeader } from '../components/SectionHeader';
import { StatusPill } from '../components/StatusPill';
import { formatDateTime, truncate } from '../utils';

const ckycSandboxBaseUrl =
  (import.meta.env.VITE_CKYCR_SANDBOX_BASE_URL as string | undefined) ??
  (import.meta.env.VITE_CKYC_SANDBOX_BASE_URL as string | undefined) ??
  '';

export default function IntegrationsPage() {
  const { runningAction, dueUsers, reviewRun, loadDueUsers, runReviewOnce, pingCkycHealth } = useConsole();
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <div className="space-y-4">
      <ConsoleCard className="border-slate-200 bg-white">
        <SectionHeader
          title="Bharat KYC T - Integrations"
          subtitle="CKYCR adapter + periodic review scheduler. Designed for pluggable real integrations."
          action={<StatusPill status={ckycSandboxBaseUrl ? 'warn' : 'neutral'} label={ckycSandboxBaseUrl ? 'CKYCR sandbox' : 'CKYCR local adapter'} />}
        />
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">CKYCR mode</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{ckycSandboxBaseUrl ? 'Sandbox' : 'Local adapter'}</p>
            <p className="mt-1 text-xs text-slate-600">{ckycSandboxBaseUrl ? truncate(ckycSandboxBaseUrl, 48) : 'Local adapter endpoints'}</p>
            <ConsoleButton
              intent="secondary"
              size="sm"
              className="mt-2"
              onClick={() => void pingCkycHealth()}
              disabled={runningAction !== null}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Test health
            </ConsoleButton>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Periodic review</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{reviewRun ? 'Last run recorded' : 'No run yet'}</p>
            <p className="mt-1 text-xs text-slate-600">
              Default tiers: HIGH=2y - MEDIUM=8y - LOW=10y (config-driven)
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Due users loaded</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{dueUsers.length}</p>
            <p className="mt-1 text-xs text-slate-600">for the selected "as of" date</p>
          </div>
        </div>
      </ConsoleCard>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <ConsoleCard id="periodic-review">
          <SectionHeader
            title="Periodic KYC review"
            subtitle="Load due list or run scheduler once (writes audit evidence)."
            action={<StatusPill status={reviewRun ? 'ok' : 'neutral'} label={reviewRun ? 'Run recorded' : 'Not run'} />}
          />

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="kyc-form-field text-sm text-slate-700">
              <span className="kyc-form-label">As of</span>
              <input
                type="date"
                value={asOf}
                onChange={(event) => setAsOf(event.target.value)}
                className="mt-1 block kyc-form-input kyc-form-input-sm"
              />
            </label>
            <ConsoleButton intent="secondary" onClick={() => void loadDueUsers(asOf)} disabled={runningAction !== null}>
              <Layers className="h-4 w-4" />
              Load due list
            </ConsoleButton>
            <ConsoleButton onClick={() => void runReviewOnce(asOf)} disabled={runningAction !== null}>
              <CalendarClock className="h-4 w-4" />
              Run once
            </ConsoleButton>
          </div>

          <div className="mt-4 max-h-60 space-y-2 overflow-auto pr-1">
            {dueUsers.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600">No due users loaded.</p>
            ) : (
              dueUsers.map((user) => (
                <div key={`${user.userId}-${user.nextReviewAt}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-700">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-900">{user.userId}</p>
                    <StatusPill status="neutral" label={user.riskTier} />
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    nextReviewAt: {formatDateTime(user.nextReviewAt)} - plannedAction: {user.plannedAction}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">reason: {user.reason}</p>
                </div>
              ))
            )}
          </div>
        </ConsoleCard>

        <ConsoleCard>
          <SectionHeader title="Scheduler summary" subtitle="What the last run did across due users." />
          {reviewRun ? (
            <div className="mt-3 space-y-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div className="grid gap-1 text-xs text-slate-600">
                  <p>
                    <span className="font-semibold text-slate-800">jobId:</span> {reviewRun.jobId}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">asOf:</span> {reviewRun.asOf}
                  </p>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <StatusPill status="neutral" label={`totalDue ${reviewRun.totalDue}`} />
                  <StatusPill status="ok" label={`synced ${reviewRun.synced}`} />
                  <StatusPill status="neutral" label={`unchanged ${reviewRun.unchanged}`} />
                  <StatusPill status="warn" label={`reconsent ${reviewRun.reconsent}`} />
                  <StatusPill status="error" label={`failed ${reviewRun.failed}`} />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">Actions taken</p>
                <div className="mt-2 max-h-44 space-y-1 overflow-auto pr-1">
                  {reviewRun.actionsTaken.map((action, index) => (
                    <p key={`${action.userId}-${index}`}>
                      <span className="font-semibold text-slate-800">{action.userId}</span>: {action.plannedAction} {'->'} {action.outcome}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600">Run once to populate summary.</p>
          )}
        </ConsoleCard>
      </div>

      <ConsoleCard>
        <SectionHeader title="Integration design notes" subtitle="How these hooks fit an enterprise rollout." action={<Link2 className="h-4 w-4 text-slate-500" />} />
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4 text-sm text-slate-700">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="font-semibold text-slate-900">Privacy + consent</p>
            <p>Data sharing is purpose/scope-bound via consent assertions.</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="font-semibold text-slate-900">Lifecycle control</p>
            <p>CKYCR updates supersede tokens without sharing raw PII.</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="font-semibold text-slate-900">Operational review</p>
            <p>Periodic review supports risk-tier schedules and re-consent.</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="font-semibold text-slate-900">Auditability</p>
            <p>Every integration action emits evidence for audit/inspection.</p>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">Suggested enhancement (optional)</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Support multiple CKYCR connectors (sandbox, production) with per-environment config and circuit-breakers.</li>
            <li>Attach run reports (CSV/PDF) to audit evidence, with reviewer approvals.</li>
            <li>Expose webhook retries / DLQ dashboard for integration failures.</li>
          </ul>
        </div>
      </ConsoleCard>
    </div>
  );
}
