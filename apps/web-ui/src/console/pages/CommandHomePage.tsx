import { Activity, ArrowRight, RefreshCcw, ServerCog, ShieldCheck, ShieldAlert, Waypoints } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { useConsole } from '../ConsoleContext';
import { displayWalletIdentity } from '../identityConfig';
import { NotificationList } from '../components/NotificationList';
import { HomePlannerPanel } from '../components/HomePlannerPanel';
import { DashboardKpiCard } from '../components/DashboardKpiCard';

export default function CommandHomePage() {
  const {
    authenticated,
    activeWalletUsername,
    activities,
    failures,
    verificationResults,
    serviceHealth,
    lifecycleJobs,
    refreshLifecycleJobs,
    runLifecycleNow,
    simulateDemoData,
    runningAction,
  } = useConsole();

  useEffect(() => {
    void refreshLifecycleJobs();
  }, [refreshLifecycleJobs]);

  const { totalRequests, failureCount, verifySuccessCount, healthyCount, unhealthyCount } = useMemo(() => {
    const requests = activities.length;
    const failuresTotal = failures.length;
    const verificationSuccess = verificationResults.filter((entry) => entry.mode === 'success').length;
    const healthy = serviceHealth.filter((entry) => entry.status === 'ok').length;
    return {
      totalRequests: requests,
      failureCount: failuresTotal,
      verifySuccessCount: verificationSuccess,
      healthyCount: healthy,
      unhealthyCount: Math.max(0, serviceHealth.length - healthy),
    };
  }, [activities, failures, verificationResults, serviceHealth]);

  const recentFailures = useMemo(() => failures.slice(0, 6), [failures]);
  const healthPreview = useMemo(() => serviceHealth.slice(0, 8), [serviceHealth]);

  const nextActions = useMemo(() => {
    const items: Array<{ title: string; subtitle: string; tone: 'primary' | 'warn' | 'neutral'; cta: string; to: string }> = [];

    if (unhealthyCount > 0) {
      items.push({
        title: 'Service health degraded',
        subtitle: `${unhealthyCount} component(s) are reporting down. Check operations and logs.`,
        tone: 'warn',
        cta: 'Open operations',
        to: '/command/operations',
      });
    }

    if (failureCount > 0) {
      items.push({
        title: 'Audit failures observed',
        subtitle: `${failureCount} failure event(s). Review error codes and retry scenarios.`,
        tone: 'primary',
        cta: 'Open audit',
        to: '/command/audit',
      });
    }

    items.push({
      title: 'Review token lifecycle registry',
      subtitle: 'Monitor ACTIVE / EXPIRED / REVOKED tokens and supersession chain.',
      tone: 'neutral',
      cta: 'Open registry',
      to: '/command/registry',
    });

    items.push({
      title: 'Run scenario orchestration',
      subtitle: 'Execute CKYCR + periodic review + delegation flows end-to-end.',
      tone: 'neutral',
      cta: 'Open scenarios',
      to: '/command/scenario',
    });

    return items.slice(0, 6);
  }, [failureCount, unhealthyCount]);

  const notifications = useMemo(() => {
    const items: Array<{ id: string; title: string; subtitle?: string; tone: 'info' | 'warn' | 'ok' }> = [];
    if (unhealthyCount > 0) {
      items.push({ id: 'svc', title: 'Service health degraded', subtitle: `${unhealthyCount} service(s) down/degraded.`, tone: 'warn' });
    }
    if (failureCount > 0) {
      items.push({ id: 'fail', title: 'Failures recorded', subtitle: 'Check audit for error codes and remediation.', tone: 'warn' });
    }
    const lastRun = lifecycleJobs?.[0]?.runAt;
    if (lastRun) {
      items.push({ id: 'lifecycle', title: 'Lifecycle jobs available', subtitle: `Last run: ${lastRun}`, tone: 'info' });
    } else {
      items.push({ id: 'lifecycle-none', title: 'No lifecycle job run yet', subtitle: 'Run once to show expiry automation.', tone: 'info' });
    }
    if (unhealthyCount === 0 && failureCount === 0) {
      items.push({ id: 'ok', title: 'Platform healthy', subtitle: 'All systems operational.', tone: 'ok' });
    }
    return items.slice(0, 6);
  }, [failureCount, lifecycleJobs, unhealthyCount]);

  return (
    <div className="space-y-5 text-slate-800">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 text-slate-800 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">Command Centre</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Hello, {displayWalletIdentity(activeWalletUsername, 'admin')} 👋</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              {authenticated
                ? 'Operate the control plane: monitor services, registry lifecycle, audit trails, and end-to-end scenarios.'
                : 'Read-only mode: sign in as admin to run operations and scenario tooling.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-[#f8faff] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Service health</p>
              <div className="mt-2">
                <p className="text-lg font-semibold text-blue-700">{healthyCount}/{serviceHealth.length || 8} healthy</p>
                <p className="mt-1 text-xs text-slate-500">Degraded: {unhealthyCount}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-[#f8faff] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Evidence</p>
              <div className="mt-2">
                <p className="text-lg font-semibold text-emerald-700">{verifySuccessCount} verified</p>
                <p className="mt-1 text-xs text-slate-500">Signed assertions validated</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <DashboardKpiCard label="Total requests" value={totalRequests} hint="Across all services" tone="blue" Icon={Activity} />
          <DashboardKpiCard label="Failures" value={failureCount} hint="Errors + denied operations" tone="rose" Icon={ShieldAlert} />
          <DashboardKpiCard label="Healthy services" value={healthyCount} hint="Up status" tone="emerald" Icon={ShieldCheck} />
          <DashboardKpiCard label="Scenario tooling" value={activities.length > 0 ? 'Ready' : 'Idle'} hint="Orchestrator & verifier" tone="indigo" Icon={Waypoints} />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">General overview</p>
                <p className="mt-1 text-sm text-slate-600">Admin shortcuts for demo and operations.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void simulateDemoData()}
                  disabled={!authenticated || runningAction === 'simulate-demo'}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200/10 bg-[#fafbff] px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-white/[0.10] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Activity className="h-4 w-4" />
                  {runningAction === 'simulate-demo' ? 'Simulating…' : 'Simulate demo data'}
                </button>


                <Link
                  to="/command/operations"
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  <ServerCog className="h-4 w-4" />
                  Operations
                </Link>
                <Link
                  to="/command/registry"
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Registry
                </Link>
                <Link
                  to="/command/scenario"
                  className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                >
                  <Waypoints className="h-4 w-4" />
                  Scenarios
                </Link>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <Link to="/command/registry" className="rounded-2xl border border-slate-200 bg-[#fafbff] p-4 hover:bg-[#f6f8fc]">
                <p className="text-sm font-semibold">Registry visibility</p>
                <p className="mt-1 text-xs text-slate-600">Token lifecycle: ACTIVE, EXPIRED, REVOKED, SUPERSEDED.</p>
              </Link>
              <Link to="/command/audit" className="rounded-2xl border border-slate-200 bg-[#fafbff] p-4 hover:bg-[#f6f8fc]">
                <p className="text-sm font-semibold">Audit trail</p>
                <p className="mt-1 text-xs text-slate-600">Evidence chain across issuer → registry → FI → wallet.</p>
              </Link>
              <Link to="/command/verifier" className="rounded-2xl border border-slate-200 bg-[#fafbff] p-4 hover:bg-[#f6f8fc]">
                <p className="text-sm font-semibold">Verifier tools</p>
                <p className="mt-1 text-xs text-slate-600">Validate signed assertions and CKYCR checks.</p>
              </Link>
              <Link to="/command/integrations" className="rounded-2xl border border-slate-200 bg-[#fafbff] p-4 hover:bg-[#f6f8fc]">
                <p className="text-sm font-semibold">Integrations</p>
                <p className="mt-1 text-xs text-slate-600">Adapters: CKYCR, DigiLocker stubs, and identity providers.</p>
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-slate-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent failures</p>
                <p className="mt-1 text-sm text-slate-600">Latest error codes and signals.</p>
              </div>
              <Link to="/command/audit" className="text-xs font-semibold text-slate-700 hover:text-slate-700 hover:underline">
                View audit
              </Link>
            </div>

            <div className="mt-4 space-y-2">
              {recentFailures.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-[#fafbff] px-4 py-3 text-sm text-slate-600">No failures recorded.</div>
              ) : (
                recentFailures.map((failure, idx) => (
                  <div key={`${failure.errorCode ?? 'failure'}-${idx}`} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-[#fafbff] px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{failure.errorCode ?? 'ERROR'}</p>
                      <p className="mt-1 text-xs text-slate-600">{failure.message ?? 'Failure event'} </p>
                    </div>
                    <span className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700">
                      <ShieldAlert className="h-4 w-4" />
                      Alert
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <HomePlannerPanel
            title="Upcoming actions"
            items={[
              { title: 'Service health review', time: 'Today · Ops', badge: String(unhealthyCount) },
              { title: 'Audit failures triage', time: 'Today · Audit', badge: String(failureCount) },
              { title: 'Lifecycle run', time: 'Today · Registry', badge: 'Admin' },
            ]}
          />

          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-slate-800">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Next actions</p>
            <div className="mt-4 space-y-2">
              {nextActions.map((action) => (
                <div key={action.title} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-[#fafbff] p-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{action.title}</p>
                    <p className="mt-1 text-xs text-slate-600">{action.subtitle}</p>
                  </div>
                  <Link
                    to={action.to}
                    className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                      action.tone === 'warn'
                        ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-300/20'
                        : action.tone === 'primary'
                          ? 'border-amber-300/30 bg-amber-300/10 text-amber-700 hover:bg-amber-300/20'
                          : 'border-slate-300/20 bg-white/5 text-slate-800 hover:bg-white/10'
                    }`}
                  >
                    {action.cta}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ))}
            </div>
          </div>

          <NotificationList title="Notifications" items={notifications} />

          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-slate-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Lifecycle jobs</p>
                <p className="mt-1 text-sm text-slate-600">Expiry + housekeeping runs (consents + tokens).</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refreshLifecycleJobs()}
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => void runLifecycleNow()}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-300/20"
                >
                  Run now
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {(lifecycleJobs ?? []).slice(0, 4).map((job) => (
                <div key={job.id} className="rounded-2xl border border-slate-200 bg-[#fafbff] px-4 py-3">
                  <p className="text-sm font-semibold text-slate-800">Run: {job.runAt}</p>
                  <p className="mt-1 text-xs text-slate-600">Actor: {String((job.detail as any)?.actor ?? '—')}</p>
                </div>
              ))}
              {(lifecycleJobs ?? []).length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-[#fafbff] px-4 py-3 text-sm text-slate-600">
                  No lifecycle jobs recorded yet.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-slate-800">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Service health snapshot</p>
            <div className="mt-4 space-y-2">
              {healthPreview.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-[#fafbff] px-4 py-3 text-sm text-slate-600">No health checks recorded.</div>
              ) : (
                healthPreview.map((svc, idx) => (
                  <div key={`${svc.service ?? 'svc'}-${idx}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-[#fafbff] px-4 py-3">
                    <span className="inline-flex items-center gap-2 text-sm text-slate-800"><Activity className="h-4 w-4 text-cyan-300" /> {svc.service ?? 'Service'}</span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${
                        svc.status === 'ok'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : svc.status === 'degraded'
                            ? 'border-amber-300/30 bg-amber-300/10 text-amber-700'
                            : 'border-rose-200 bg-rose-50 text-rose-700'
                      }`}
                    >
                      {String(svc.status ?? 'unknown').toUpperCase()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-slate-800">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Platform tips</p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="rounded-2xl border border-slate-200 bg-[#fafbff] px-4 py-3">
                <p className="font-semibold text-slate-800">Lifecycle management</p>
                <p className="mt-1 text-xs text-slate-600">Demo token expiry + renewal and consent revocation for user control.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-[#fafbff] px-4 py-3">
                <p className="font-semibold text-slate-800">Interoperability</p>
                <p className="mt-1 text-xs text-slate-600">Use the CKYCR adapter + signed assertions to show cross-institution portability.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-[#fafbff] px-4 py-3">
                <p className="font-semibold text-slate-800">Delegation</p>
                <p className="mt-1 text-xs text-slate-600">Nominee delegation enables approvals for legal heirs/guardians with audit visibility.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
