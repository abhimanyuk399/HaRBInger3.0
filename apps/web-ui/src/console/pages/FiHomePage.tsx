import { ArrowRight, BadgeCheck, Clock, FileCheck2, Filter, RefreshCcw, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { useConsole } from '../ConsoleContext';
import { displayWalletIdentity } from '../identityConfig';
import { NotificationList } from '../components/NotificationList';

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
    const failCount = verificationResults.filter((item) => item.mode !== 'success').length;

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
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-700/70 bg-[linear-gradient(140deg,rgba(15,23,42,0.96),rgba(17,24,61,0.92),rgba(25,25,78,0.95))] p-6 text-white shadow-[0_24px_60px_rgba(2,6,23,0.42)]">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">FI Overview</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Hello, {displayWalletIdentity(activeFiUsername, 'fi analyst')} 👋</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              {fiAuthenticated
                ? 'Create consent requests, monitor the queue, and verify assertions with a complete audit trail.'
                : 'Sign in to manage FI consent requests and verifications.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Verification</p>
              <div className="mt-2">
                <p className="text-lg font-semibold text-cyan-200">
                  {verifySuccess} success / {verifyFail} fail
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Ratio: {verifySuccess + verifyFail > 0 ? `${Math.round((verifySuccess / (verifySuccess + verifyFail)) * 100)}%` : 'n/a'}
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Signal</p>
                  <p className="mt-2 text-lg font-semibold text-rose-200">{latestFailure?.errorCode ?? 'No failures'}</p>
                  <p className="mt-1 text-xs text-slate-400">Latest failure in this session</p>
                </div>
                <button
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
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
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <p className="text-xs text-slate-300">Pending consents</p>
            <p className="mt-2 text-3xl font-semibold text-amber-200">{pending}</p>
            <p className="mt-1 text-xs text-slate-400">Awaiting wallet decision</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <p className="text-xs text-slate-300">Approved</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-200">{approved}</p>
            <p className="mt-1 text-xs text-slate-400">Reusable KYC access</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <p className="text-xs text-slate-300">Rejected</p>
            <p className="mt-2 text-3xl font-semibold text-rose-200">{rejected}</p>
            <p className="mt-1 text-xs text-slate-400">Explicit denial</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <p className="text-xs text-slate-300">Verified assertions</p>
            <p className="mt-2 text-3xl font-semibold text-indigo-200">{verifySuccess}</p>
            <p className="mt-1 text-xs text-slate-400">Evidence-backed</p>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-5">
          <div className="rounded-3xl border border-slate-700/70 bg-[linear-gradient(145deg,#0f172a,#101a45)] p-5 text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">General overview</p>
                <p className="mt-1 text-sm text-slate-300">Shortcuts for core FI workflows.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/fi/create"
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                >
                  <ArrowRight className="h-4 w-4" />
                  Create
                </Link>
                <Link
                  to="/fi/queue"
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-300/20"
                >
                  <Clock className="h-4 w-4" />
                  Queue
                </Link>
                <Link
                  to="/fi/timeline"
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/20"
                >
                  <BadgeCheck className="h-4 w-4" />
                  Timeline
                </Link>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <Link to="/fi/create" className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:bg-white/[0.07]">
                <p className="text-sm font-semibold">Create consent</p>
                <p className="mt-1 text-xs text-slate-300">Raise requests with explicit purpose + field scope.</p>
              </Link>
              <Link to="/fi/queue" className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:bg-white/[0.07]">
                <p className="text-sm font-semibold">Consent queue</p>
                <p className="mt-1 text-xs text-slate-300">Track approvals, rejections, and expiries.</p>
              </Link>
              <Link to="/fi/timeline" className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:bg-white/[0.07]">
                <p className="text-sm font-semibold">Verification evidence</p>
                <p className="mt-1 text-xs text-slate-300">Inspect signed assertions and registry anchors.</p>
              </Link>
              <Link to="/command/audit" className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:bg-white/[0.07]">
                <p className="text-sm font-semibold">Audit trail</p>
                <p className="mt-1 text-xs text-slate-300">End-to-end evidence across services.</p>
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-700/70 bg-[linear-gradient(145deg,#0f172a,#0b122b)] p-5 text-slate-100">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Token coverage</p>
              <button
                type="button"
                onClick={() => void refreshFiTokenCoverage()}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-xs text-slate-300">Active</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-200">{fiTokenCoverage?.summary.active ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-xs text-slate-300">Missing</p>
                <p className="mt-2 text-2xl font-semibold text-rose-200">{fiTokenCoverage?.summary.none ?? 0}</p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
              <table className="min-w-full text-left text-xs">
                <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Expiry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(fiTokenCoverage?.users ?? []).map((row) => (
                    <tr key={row.userId} className="hover:bg-white/[0.03]">
                      <td className="px-4 py-3 text-slate-100">{row.userId}</td>
                      <td className="px-4 py-3 text-slate-200">{row.status}</td>
                      <td className="px-4 py-3 text-slate-400">{row.expiresAt ? row.expiresAt.slice(0, 10) : '—'}</td>
                    </tr>
                  ))}
                  {(fiTokenCoverage?.users ?? []).length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-slate-400">
                        No coverage data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-700/70 bg-[linear-gradient(145deg,#0f172a,#0b122b)] p-5 text-slate-100">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Consent queue preview</p>
                <p className="mt-1 text-sm text-slate-300">Latest items across pending/approved/rejected.</p>
              </div>
              <Link to="/fi/queue" className="text-xs font-semibold text-slate-200 hover:text-white hover:underline">
                View all
              </Link>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-slate-300">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Purpose</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {queuePreview.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-4 text-sm text-slate-300">
                        No requests yet.
                      </td>
                    </tr>
                  ) : (
                    queuePreview.map((consent) => {
                      const status = String((consent as any).status ?? '').toUpperCase();
                      const subject = String((consent as any).subjectUserId ?? (consent as any).userId ?? (consent as any).walletUserId ?? '—');
                      const purpose = String((consent as any).purpose ?? '—');
                      const rowKey = String((consent as any).id ?? (consent as any).consentId ?? `${subject}-${purpose}-${status}`);
                      return (
                        <tr key={rowKey} className="hover:bg-white/[0.03]">
                          <td className="px-4 py-3 text-slate-100">{subject}</td>
                          <td className="px-4 py-3 text-slate-200">{purpose}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${
                                status === 'APPROVED'
                                  ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200'
                                  : status === 'REJECTED'
                                    ? 'border-rose-300/30 bg-rose-300/10 text-rose-200'
                                    : 'border-amber-300/30 bg-amber-300/10 text-amber-200'
                              }`}
                            >
                              {status || 'UNKNOWN'}
                            </span>
                          </td>
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
          <div className="rounded-3xl border border-slate-700/70 bg-[linear-gradient(145deg,#0f172a,#101a3f)] p-5 text-slate-100">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Next actions</p>
            <div className="mt-4 space-y-2">
              {nextActions.map((action) => (
                <div key={action.title} className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{action.title}</p>
                    <p className="mt-1 text-xs text-slate-300">{action.subtitle}</p>
                  </div>
                  <Link
                    to={action.to}
                    className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                      action.tone === 'warn'
                        ? 'border-rose-300/30 bg-rose-300/10 text-rose-100 hover:bg-rose-300/20'
                        : action.tone === 'primary'
                          ? 'border-amber-300/30 bg-amber-300/10 text-amber-100 hover:bg-amber-300/20'
                          : 'border-slate-300/20 bg-white/5 text-slate-100 hover:bg-white/10'
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

          <div className="rounded-3xl border border-slate-700/70 bg-[linear-gradient(145deg,#0f172a,#0b122b)] p-5 text-slate-100">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Integrity signals</p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="inline-flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-cyan-300" /> Queue pressure</span>
                <span className="font-semibold">{pending > 0 ? 'Pending items' : 'Clear'}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="inline-flex items-center gap-2"><Filter className="h-4 w-4 text-indigo-300" /> Verification ratio</span>
                <span className="font-semibold">{verifySuccess + verifyFail > 0 ? `${Math.round((verifySuccess / (verifySuccess + verifyFail)) * 100)}%` : 'n/a'}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
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
