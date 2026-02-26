import { ArrowRight, BadgeCheck, Clock, FileCheck2, Filter, RefreshCcw, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { useConsole } from '../ConsoleContext';
import { displayWalletIdentity } from '../identityConfig';
import { NotificationList } from '../components/NotificationList';
import { TableSearchPager, usePagedFilter } from '../components/TableSearchPager';
import { HomePlannerPanel } from '../components/HomePlannerPanel';
import { DashboardKpiCard } from '../components/DashboardKpiCard';

export default function FiHomePage() {
  const {
    fiAuthenticated,
    activeFiUsername,
    walletConsents,
    verificationResults,
    failures,
    refreshWalletConsents,
    fiTokenCoverage,
    refreshFiTokenCoverage,
  } = useConsole();

  useEffect(() => {
    // Refresh key dashboard data without requiring manual reload.
    void Promise.allSettled([refreshWalletConsents(), refreshFiTokenCoverage()]);
  }, [refreshFiTokenCoverage, refreshWalletConsents]);

  const { pending, approved, rejected, verifySuccess, verifyFail } = useMemo(() => {
    let pendingCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;

    walletConsents.forEach((consent) => {
      const status = String((consent as Record<string, unknown>).status ?? '').toUpperCase();
      if (status === 'PENDING') pendingCount += 1;
      else if (status === 'APPROVED') approvedCount += 1;
      else if (status === 'REJECTED') rejectedCount += 1;
    });

    const successCount = verificationResults.filter((item) => item.mode === 'success').length;
    const failCount = verificationResults.length > 0 ? verificationResults.filter((item) => item.mode !== 'success').length : failures.length;

    return { pending: pendingCount, approved: approvedCount, rejected: rejectedCount, verifySuccess: successCount, verifyFail: failCount };
  }, [walletConsents, verificationResults]);

  const latestFailure = failures[0];

  const queuePreview = useMemo(() => {
    const sorted = [...walletConsents].sort((a, b) => {
      const sa = String((a as any).status ?? '').toUpperCase();
      const sb = String((b as any).status ?? '').toUpperCase();
      const order = (s: string) => (s === 'PENDING' ? 0 : s === 'APPROVED' ? 1 : s === 'REJECTED' ? 2 : 3);
      return order(sa) - order(sb);
    });
    return sorted.slice(0, 6);
  }, [walletConsents]);

  const tokenCoverageRows = useMemo(() => fiTokenCoverage?.users ?? [], [fiTokenCoverage]);
  const tokenCoverageTable = usePagedFilter(tokenCoverageRows, { pageSize: 5, match: (row, q) => [row.userId, row.status, (row as any).tokenId ?? '', row.expiresAt ?? ''].join(' ').toLowerCase().includes(q) });
  const queuePreviewTable = usePagedFilter(queuePreview, { pageSize: 5, match: (consent, q) => [String((consent as any).subjectUserId ?? (consent as any).userId ?? (consent as any).walletUserId ?? ''), String((consent as any).purpose ?? ''), String((consent as any).status ?? ''), String((consent as any).fiId ?? (consent as any).requestedBy ?? '')].join(' ').toLowerCase().includes(q) });

  const nextActions = useMemo(() => {
    const actions: Array<{ title: string; subtitle: string; tone: 'primary' | 'warn' | 'neutral'; cta: string; to: string }> = [];

    if (pending > 0) {
      actions.push({
        title: 'Consent queue needs attention',
        subtitle: `${pending} request(s) are pending wallet approval. Track status and follow-up.`,
        tone: 'primary',
        cta: 'Open queue',
        to: '/fi/queue',
      });
    }

    if (verifyFail > 0) {
      actions.push({
        title: 'Verification failures detected',
        subtitle: `${verifyFail} failed verification(s). Review evidence and retry checks.`,
        tone: 'warn',
        cta: 'Open timeline',
        to: '/fi/timeline',
      });
    }

    actions.push({
      title: 'Raise a new consent request',
      subtitle: 'Create a consent with explicit purpose, fields, and validity window.',
      tone: 'neutral',
      cta: 'Create consent',
      to: '/fi/create',
    });

    return actions.slice(0, 5);
  }, [pending, verifyFail]);

  const notifications = useMemo(() => {
    const items: Array<{ id: string; title: string; subtitle?: string; tone: 'info' | 'warn' | 'ok' }> = [];
    if ((fiTokenCoverage?.summary.none ?? 0) > 0) {
      items.push({
        id: 'missing-tokens',
        title: 'Some users missing ACTIVE token',
        subtitle: 'Use onboard flow from FI when user has no ACTIVE token.',
        tone: 'warn',
      });
    }
    if (pending > 0) {
      items.push({ id: 'pending', title: `${pending} pending consent(s)`, subtitle: 'Awaiting wallet approval.', tone: 'info' });
    }
    if (verifyFail > 0) {
      items.push({ id: 'verify-fail', title: 'Verification failures detected', subtitle: 'Review audit + retry verification.', tone: 'warn' });
    }
    if (verifySuccess > 0 && verifyFail === 0) {
      items.push({ id: 'verify-ok', title: 'Verification healthy', subtitle: 'Signed assertions verified successfully.', tone: 'ok' });
    }
    return items.slice(0, 6);
  }, [fiTokenCoverage, pending, verifyFail, verifySuccess]);

  return (
    <div className="space-y-5 text-slate-800">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 text-slate-800 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">FI Overview</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Hello, {displayWalletIdentity(activeFiUsername, 'fi analyst')} 👋</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              {fiAuthenticated
                ? 'Create consent requests, monitor the queue, and verify assertions with a complete audit trail.'
                : 'Sign in to manage FI consent requests and verifications.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-[#f8faff] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Verification</p>
              <div className="mt-2">
                <p className="text-lg font-semibold text-blue-700">
                  {verifySuccess} success / {verifyFail} fail
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Ratio: {verifySuccess + verifyFail > 0 ? `${Math.round((verifySuccess / (verifySuccess + verifyFail)) * 100)}%` : 'n/a'}
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-[#f8faff] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Signal</p>
                  <p className="mt-2 text-lg font-semibold text-rose-700">{latestFailure?.errorCode ?? 'No failures'}</p>
                  <p className="mt-1 text-xs text-slate-500">Latest failure in this session</p>
                </div>
                <button
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                  onClick={() => void refreshWalletConsents()}
                  type="button"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <DashboardKpiCard label="Pending consents" value={pending} hint="Awaiting wallet decision" tone="amber" Icon={Clock} />
          <DashboardKpiCard label="Approved" value={approved} hint="Reusable KYC access" tone="emerald" Icon={BadgeCheck} />
          <DashboardKpiCard label="Rejected" value={rejected} hint="Explicit denial" tone="rose" Icon={ShieldAlert} />
          <DashboardKpiCard label="Verified assertions" value={verifySuccess} hint="Evidence-backed" tone="indigo" Icon={FileCheck2} />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">General overview</p>
                <p className="mt-1 text-sm text-slate-600">Shortcuts for core FI workflows.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/fi/create"
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  <ArrowRight className="h-4 w-4" />
                  Create
                </Link>
                <Link
                  to="/fi/queue"
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-300/20"
                >
                  <Clock className="h-4 w-4" />
                  Queue
                </Link>
                <Link
                  to="/fi/timeline"
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  <BadgeCheck className="h-4 w-4" />
                  Timeline
                </Link>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <Link to="/fi/create" className="rounded-2xl border border-slate-200 bg-[#fafbff] p-4 hover:bg-[#f6f8fc]">
                <p className="text-sm font-semibold">Create consent</p>
                <p className="mt-1 text-xs text-slate-600">Raise requests with explicit purpose + field scope.</p>
              </Link>
              <Link to="/fi/queue" className="rounded-2xl border border-slate-200 bg-[#fafbff] p-4 hover:bg-[#f6f8fc]">
                <p className="text-sm font-semibold">Consent queue</p>
                <p className="mt-1 text-xs text-slate-600">Track approvals, rejections, and expiries.</p>
              </Link>
              <Link to="/fi/timeline" className="rounded-2xl border border-slate-200 bg-[#fafbff] p-4 hover:bg-[#f6f8fc]">
                <p className="text-sm font-semibold">Verification evidence</p>
                <p className="mt-1 text-xs text-slate-600">Inspect signed assertions and registry anchors.</p>
              </Link>
              <Link to="/command/audit" className="rounded-2xl border border-slate-200 bg-[#fafbff] p-4 hover:bg-[#f6f8fc]">
                <p className="text-sm font-semibold">Audit trail</p>
                <p className="mt-1 text-xs text-slate-600">End-to-end evidence across services.</p>
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-slate-800">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Token coverage</p>
              <button
                type="button"
                onClick={() => void refreshFiTokenCoverage()}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-[#fafbff] p-4">
                <p className="text-xs text-slate-600">Active</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-700">{fiTokenCoverage?.summary.active ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-[#fafbff] p-4">
                <p className="text-xs text-slate-600">Missing</p>
                <p className="mt-2 text-2xl font-semibold text-rose-700">{fiTokenCoverage?.summary.none ?? 0}</p>
              </div>
            </div>

            <div className="mt-4">
              <TableSearchPager {...tokenCoverageTable} placeholder="Search user / token / status" />
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full text-left text-xs">
                <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Purpose</th>
                    <th className="px-4 py-3">FI</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3">Token</th>
                    <th className="px-4 py-3">Expiry</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tokenCoverageTable.paged.map((row) => (
                    <tr key={row.userId} className="odd:bg-white even:bg-[#fbfcff] hover:bg-[#f3f7ff]">
                      <td className="px-4 py-3 text-slate-800">{row.userId}</td>
                      <td className="px-4 py-3 text-slate-700">{row.status}</td>
                      <td className="px-4 py-3 text-slate-600">{String((row as any).purpose ?? (row as any).lastPurpose ?? '—')}</td>
                      <td className="px-4 py-3 text-slate-600">{activeFiUsername ?? 'FI'}</td>
                      <td className="px-4 py-3 text-slate-500">{String((row as any).updatedAt ?? '—').slice(0, 10) || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{(row as any).tokenId ? String((row as any).tokenId).slice(0, 12) + '…' : '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{row.expiresAt ? row.expiresAt.slice(0, 10) : '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {(String(row.status ?? '').toUpperCase() !== 'ACTIVE') ? (
                            <Link
                              to={`/fi/consent?user=${encodeURIComponent(String(row.userId ?? ''))}`}
                              className="text-xs font-semibold text-emerald-700 hover:underline"
                            >
                              Onboard from FI
                            </Link>
                          ) : null}
                          <Link to="/command/scenario" className="text-xs font-semibold text-blue-700 hover:underline">Fetch from CKYCR</Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {tokenCoverageTable.paged.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-3 text-slate-500">
                        No coverage data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 text-slate-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Consent queue preview</p>
                <p className="mt-1 text-sm text-slate-600">Latest items across pending/approved/rejected.</p>
              </div>
              <Link to="/fi/queue" className="text-xs font-semibold text-slate-700 hover:text-slate-700 hover:underline">
                View all
              </Link>
            </div>

            <div className="mt-4">
              <TableSearchPager {...queuePreviewTable} placeholder="Search user / purpose / status / FI" />
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#fafbff] text-xs uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Purpose</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">FI</th>
                    <th className="px-4 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {queuePreviewTable.paged.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-sm text-slate-600">
                        No requests yet.
                      </td>
                    </tr>
                  ) : (
                    queuePreviewTable.paged.map((consent) => {
                      const status = String((consent as any).status ?? '').toUpperCase();
                      const subject = String((consent as any).subjectUserId ?? (consent as any).userId ?? (consent as any).walletUserId ?? '—');
                      const purpose = String((consent as any).purpose ?? '—');
                      const rowKey = String((consent as any).id ?? (consent as any).consentId ?? `${subject}-${purpose}-${status}`);
                      return (
                        <tr key={rowKey} className="odd:bg-white even:bg-[#fbfcff] hover:bg-[#f3f7ff]">
                          <td className="px-4 py-3 text-slate-800">{subject}</td>
                          <td className="px-4 py-3 text-slate-700">{purpose}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${
                                status === 'APPROVED'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : status === 'REJECTED'
                                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                                    : 'border-amber-300/30 bg-amber-300/10 text-amber-700'
                              }`}
                            >
                              {status || 'UNKNOWN'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{String((consent as any).fiId ?? (consent as any).requestedBy ?? 'FI')}</td>
                          <td className="px-4 py-3 text-slate-500">{String((consent as any).updatedAt ?? (consent as any).createdAt ?? '—').slice(0, 19).replace('T', ' ')}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <HomePlannerPanel
            title="Upcoming actions"
            items={[
              { title: 'Review pending consents', time: 'Today · Queue', badge: String(pending) },
              { title: 'Verification follow-up', time: 'Today · Timeline', badge: String(verifyFail) },
              { title: 'Create new consent', time: 'Any time', badge: 'FI' },
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
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Integrity signals</p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-[#fafbff] px-4 py-3">
                <span className="inline-flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-cyan-300" /> Queue pressure</span>
                <span className="font-semibold">{pending > 0 ? 'Pending items' : 'Clear'}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-[#fafbff] px-4 py-3">
                <span className="inline-flex items-center gap-2"><Filter className="h-4 w-4 text-indigo-300" /> Verification ratio</span>
                <span className="font-semibold">{verifySuccess + verifyFail > 0 ? `${Math.round((verifySuccess / (verifySuccess + verifyFail)) * 100)}%` : 'n/a'}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-[#fafbff] px-4 py-3">
                <span className="inline-flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-rose-300" /> Latest failure</span>
                <span className="font-semibold">{latestFailure?.errorCode ?? 'None'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
