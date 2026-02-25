import { ArrowRight, BadgeCheck, CalendarClock, CheckCircle2, Clock, RefreshCcw, ShieldCheck, Users2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { useConsole } from '../ConsoleContext';
import { displayWalletIdentity } from '../identityConfig';
import { NotificationList } from '../components/NotificationList';

export default function WalletHomePage() {
  const {
    authenticated,
    activeWalletUsername,
    walletConsents,
    delegations,
    registrySnapshot,
    activities,
    refreshWalletConsents,
    refreshDelegations,
    refreshWalletTokens,
    walletReviewStatus,
    refreshWalletReviewStatus,
    requestPeriodicReconsent,
    renewWalletToken,
  } = useConsole();

  useEffect(() => {
    // Ensure dashboard counts are loaded without requiring a manual browser refresh.
    void Promise.allSettled([refreshWalletConsents(), refreshDelegations(), refreshWalletTokens(), refreshWalletReviewStatus()]);
  }, [refreshDelegations, refreshWalletConsents, refreshWalletReviewStatus, refreshWalletTokens]);

  const { pending, approved, rejected, activeDelegations } = useMemo(() => {
    const counts = { pending: 0, approved: 0, rejected: 0, activeDelegations: 0 };

    walletConsents.forEach((consent) => {
      const status = String((consent as Record<string, unknown>).status ?? '').toUpperCase();
      if (status === 'PENDING') counts.pending += 1;
      else if (status === 'APPROVED') counts.approved += 1;
      else if (status === 'REJECTED') counts.rejected += 1;
    });

    delegations.forEach((delegation) => {
      if (String(delegation.status ?? '').toUpperCase() === 'ACTIVE') {
        counts.activeDelegations += 1;
      }
    });

    return counts;
  }, [walletConsents, delegations]);

  const lastEvent = activities[0];

  const tokenExpiresAt = registrySnapshot?.expiresAt ? new Date(String(registrySnapshot.expiresAt)) : null;
  const tokenExpiryDays = tokenExpiresAt ? Math.ceil((tokenExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const tokenExpiryLabel = tokenExpiryDays === null ? 'Unknown' : tokenExpiryDays < 0 ? 'Expired' : `${tokenExpiryDays}d`;

  const pendingInbox = walletConsents
    .filter((c) => String((c as Record<string, unknown>).status ?? '').toUpperCase() === 'PENDING')
    .slice(0, 6);

  const nextActions = useMemo(() => {
    const items: Array<{
      title: string;
      subtitle: string;
      due?: string;
      intent: 'primary' | 'warn' | 'ok' | 'neutral';
      ctaLabel?: string;
      ctaPath?: string;
      onClick?: () => void;
    }> = [];

    if (walletReviewStatus?.requiresReconsent === true) {
      items.push({
        title: 'Periodic KYC update required',
        subtitle: `Risk tier: ${String(walletReviewStatus.riskTier ?? 'MEDIUM')}. Create a re-consent request for CKYCR sync.`,
        due: String(walletReviewStatus.nextReviewAt ?? ''),
        intent: 'warn',
        ctaLabel: 'Create re-consent',
        onClick: () => void requestPeriodicReconsent(),
      });
    }

    if (tokenExpiryDays !== null && tokenExpiryDays <= 7) {
      items.push({
        title: 'KYC token expiring soon',
        subtitle: tokenExpiryDays < 0 ? 'Your active token has expired. Renew to keep onboarding frictionless.' : `Expires in ${tokenExpiryDays} day(s). Renew now.`,
        due: tokenExpiresAt?.toISOString(),
        intent: tokenExpiryDays < 0 ? 'warn' : 'primary',
        ctaLabel: 'Renew token',
        onClick: () => void renewWalletToken(7 * 24 * 60 * 60),
      });
    }

    if (pending > 0) {
      items.push({
        title: 'Pending consent approvals',
        subtitle: `${pending} request(s) waiting in your inbox (including delegated).`,
        intent: 'primary',
        ctaLabel: 'Open inbox',
        ctaPath: '/wallet/inbox',
      });
    }

    if (activeDelegations === 0) {
      items.push({
        title: 'Set up nominee delegation (optional)',
        subtitle: 'Add nominees and enable delegation for legal heirs/guardians.',
        intent: 'neutral',
        ctaLabel: 'Manage nominees',
        ctaPath: '/wallet/nominees',
      });
    }

    return items.slice(0, 6);
  }, [activeDelegations, pending, renewWalletToken, requestPeriodicReconsent, tokenExpiresAt, tokenExpiryDays, walletReviewStatus]);

  const notifications = useMemo(() => {
    const items: Array<{ id: string; title: string; subtitle?: string; tone: 'info' | 'warn' | 'ok' }> = [];
    if (walletReviewStatus?.requiresReconsent === true) {
      items.push({
        id: 'reconsent',
        title: 'Periodic KYC update pending',
        subtitle: 'Re-consent required for CKYCR sync and periodic updation.',
        tone: 'warn',
      });
    }
    if (tokenExpiryDays !== null && tokenExpiryDays <= 7) {
      items.push({
        id: 'token-expiry',
        title: tokenExpiryDays < 0 ? 'Token expired' : 'Token expiring soon',
        subtitle: tokenExpiryDays < 0 ? 'Renew to keep onboarding frictionless.' : `Expires in ${tokenExpiryDays} day(s).`,
        tone: 'warn',
      });
    }
    if (pending > 0) {
      items.push({ id: 'pending', title: `${pending} consent(s) pending`, subtitle: 'Includes delegated requests.', tone: 'info' });
    }
    if (activeDelegations > 0) {
      items.push({ id: 'delegation', title: 'Delegation enabled', subtitle: 'Nominee/guardian flow is ready.', tone: 'ok' });
    }
    return items.slice(0, 6);
  }, [activeDelegations, pending, tokenExpiryDays, walletReviewStatus]);

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-700/70 bg-[linear-gradient(140deg,rgba(15,23,42,0.96),rgba(14,22,56,0.92),rgba(17,29,67,0.95))] p-6 text-white shadow-[0_24px_60px_rgba(2,6,23,0.42)]">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Wallet Overview</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Hello, {displayWalletIdentity(activeWalletUsername, 'operator')} 👋</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              {authenticated
                ? 'Manage reusable KYC tokens, approve consent (self + delegated), and keep a full audit trail.'
                : 'Sign in to view your token, consents, and delegation controls.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Token</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-cyan-200">{registrySnapshot?.status ?? 'UNKNOWN'}</p>
                  <p className="mt-1 text-xs text-slate-400">Expiry: {tokenExpiryLabel}</p>
                </div>
                <button
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                  onClick={() => void refreshWalletTokens()}
                  type="button"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Refresh
                </button>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Audit signal</p>
              <div className="mt-2">
                <p className="text-lg font-semibold text-emerald-200">{lastEvent?.label ?? 'No activity yet'}</p>
                <p className="mt-1 text-xs text-slate-400">Latest event from {lastEvent?.service ?? '—'}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <p className="text-xs text-slate-300">Pending approvals</p>
            <p className="mt-2 text-3xl font-semibold text-amber-200">{pending}</p>
            <p className="mt-1 text-xs text-slate-400">Inbox + delegated</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <p className="text-xs text-slate-300">Approved consents</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-200">{approved}</p>
            <p className="mt-1 text-xs text-slate-400">Reusable access trail</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <p className="text-xs text-slate-300">Rejected / revoked</p>
            <p className="mt-2 text-3xl font-semibold text-rose-200">{rejected}</p>
            <p className="mt-1 text-xs text-slate-400">User-controlled sharing</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
            <p className="text-xs text-slate-300">Active delegations</p>
            <p className="mt-2 text-3xl font-semibold text-indigo-200">{activeDelegations}</p>
            <p className="mt-1 text-xs text-slate-400">Nominee & guardian</p>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-5">
          <div className="rounded-3xl border border-slate-700/70 bg-[linear-gradient(145deg,#0f172a,#101a45)] p-5 text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">General overview</p>
                <p className="mt-1 text-sm text-slate-300">Shortcuts to the key workflows you’ll demo.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/wallet/inbox"
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-300/20"
                >
                  <Clock className="h-4 w-4" />
                  Inbox
                </Link>
                <Link
                  to="/wallet/history"
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/20"
                >
                  <BadgeCheck className="h-4 w-4" />
                  History
                </Link>
                <Link
                  to="/wallet/ops"
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
                >
                  <ArrowRight className="h-4 w-4" />
                  Operate
                </Link>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <Link to="/wallet/nominees" className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:bg-white/[0.07]">
                <p className="text-sm font-semibold">Nominees</p>
                <p className="mt-1 text-xs text-slate-300">Create/disable nominees and keep them auditable.</p>
              </Link>
              <Link to="/wallet/delegations" className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:bg-white/[0.07]">
                <p className="text-sm font-semibold">Delegations</p>
                <p className="mt-1 text-xs text-slate-300">Enable delegated approvals only from active nominees.</p>
              </Link>
              <Link to="/command/registry" className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:bg-white/[0.07]">
                <p className="text-sm font-semibold">Registry visibility</p>
                <p className="mt-1 text-xs text-slate-300">See token lifecycle, expiry, and supersession chain.</p>
              </Link>
              <Link to="/command/audit" className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 hover:bg-white/[0.07]">
                <p className="text-sm font-semibold">Audit trail</p>
                <p className="mt-1 text-xs text-slate-300">Evidence chain across FI → wallet → registry.</p>
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-700/70 bg-[linear-gradient(145deg,#0f172a,#0b122b)] p-5 text-slate-100">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Consent inbox preview</p>
                <p className="mt-1 text-sm text-slate-300">Latest requests requiring action.</p>
              </div>
              <Link to="/wallet/inbox" className="text-xs font-semibold text-slate-200 hover:text-white hover:underline">
                View all
              </Link>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-slate-300">
                  <tr>
                    <th className="px-4 py-3">FI</th>
                    <th className="px-4 py-3">Purpose</th>
                    <th className="px-4 py-3">For</th>
                    <th className="px-4 py-3">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {pendingInbox.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-4 text-sm text-slate-300">
                        No pending requests right now.
                      </td>
                    </tr>
                  ) : (
                    pendingInbox.map((consent) => {
                      const record = consent as unknown as Record<string, unknown>;
                      const fi = String(record.fiId ?? record.requestedByFiId ?? 'FI');
                      const purpose = String(record.purpose ?? 'KYC');
                      const subjectUser = String(record.subjectUserId ?? record.userId ?? activeWalletUsername ?? 'user');
                      const actedBy = String(record.actedByUserId ?? '');
                      const isDelegated = Boolean(record.isDelegated) || (actedBy && actedBy !== subjectUser);
                      return (
                        <tr key={String(record.consentId ?? record.id)} className="bg-white/[0.02] hover:bg-white/[0.05]">
                          <td className="px-4 py-3 text-slate-100">{fi}</td>
                          <td className="px-4 py-3 text-slate-200">{purpose}</td>
                          <td className="px-4 py-3 text-slate-300">{subjectUser}</td>
                          <td className="px-4 py-3">
                            <span
                              className={
                                isDelegated
                                  ? 'inline-flex rounded-full border border-indigo-300/30 bg-indigo-300/10 px-2 py-1 text-xs font-semibold text-indigo-100'
                                  : 'inline-flex rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-xs font-semibold text-amber-100'
                              }
                            >
                              {isDelegated ? 'Delegated' : 'Self'}
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
            <div className="mt-4 space-y-3">
              {nextActions.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
                  You’re all set — no urgent actions.
                </div>
              ) : (
                nextActions.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{item.title}</p>
                        <p className="mt-1 text-xs text-slate-300">{item.subtitle}</p>
                        {item.due ? (
                          <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-400">
                            <CalendarClock className="h-3.5 w-3.5" /> {item.due}
                          </p>
                        ) : null}
                      </div>
                      {item.ctaLabel ? (
                        item.ctaPath ? (
                          <Link
                            to={item.ctaPath}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-white/[0.1]"
                          >
                            {item.ctaLabel} <ArrowRight className="h-4 w-4" />
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={item.onClick}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-white/[0.1]"
                          >
                            {item.ctaLabel} <ArrowRight className="h-4 w-4" />
                          </button>
                        )
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <NotificationList title="Notifications" items={notifications} />

          <div className="rounded-3xl border border-slate-700/70 bg-[linear-gradient(145deg,#0f172a,#0b122b)] p-5 text-slate-100">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">KYC tips (AI-assisted)</p>
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="font-semibold text-white">Selective disclosure</p>
                <p className="mt-1 text-xs text-slate-300">Approve only required fields (e.g., address without DOB) to reduce data exposure.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="font-semibold text-white">Delegation controls</p>
                <p className="mt-1 text-xs text-slate-300">Use nominee delegation for legal heirs/guardians with expiry + purpose restrictions.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="font-semibold text-white">Lifecycle hygiene</p>
                <p className="mt-1 text-xs text-slate-300">Renew tokens before expiry to keep onboarding frictionless across institutions.</p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-700/70 bg-[linear-gradient(145deg,#0f172a,#101a45)] p-5 text-slate-100">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Health snapshot</p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-cyan-300" /> Registry</span>
                <span className="font-semibold">{registrySnapshot?.status ?? 'UNKNOWN'}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="inline-flex items-center gap-2"><Users2 className="h-4 w-4 text-indigo-300" /> Delegations</span>
                <span className="font-semibold">{activeDelegations > 0 ? 'Configured' : 'Not configured'}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300" /> Last event</span>
                <span className="font-semibold">{lastEvent?.label ?? 'No activity yet'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
