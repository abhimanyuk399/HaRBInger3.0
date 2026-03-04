import { ArrowRight, BadgeCheck, CheckCircle2, Clock, RefreshCcw, ShieldCheck, Users2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { useConsole } from '../ConsoleContext';
import { displayWalletIdentity, WALLET_NOMINEE_USERNAME } from '../identityConfig';
import { NotificationList } from '../components/NotificationList';
import { PortalPageHeader } from '../components/PortalPageHeader';

export default function WalletHomePage() {
  const {
    authenticated,
    activeWalletUsername,
    walletConsents,
    delegations,
    registrySnapshot,
    walletTokens,
    activities,
    refreshWalletConsents,
    refreshDelegations,
    refreshWalletTokens,
    walletReviewStatus,
    refreshWalletReviewStatus,
  } = useConsole();

  useEffect(() => {
    if (!authenticated) return;
    const isNomineeSession =
      typeof activeWalletUsername === 'string' &&
      activeWalletUsername.trim().toLowerCase() === WALLET_NOMINEE_USERNAME.toLowerCase();

    // Avoid owner-only delegation endpoints for nominee sessions to prevent noisy OWNER_AUTHORIZATION_REQUIRED banners.
    const tasks: Array<Promise<unknown>> = [
      refreshWalletConsents(activeWalletUsername ?? undefined),
      refreshWalletTokens(activeWalletUsername ?? undefined),
      refreshWalletReviewStatus(),
    ];
    if (!isNomineeSession) {
      tasks.push(refreshDelegations(activeWalletUsername ?? undefined));
    }
    void Promise.allSettled(tasks);
  }, [activeWalletUsername, authenticated, refreshDelegations, refreshWalletConsents, refreshWalletReviewStatus, refreshWalletTokens]);

  const { pending, approved, rejected, activeDelegations } = useMemo(() => {
    const counts = { pending: 0, approved: 0, rejected: 0, activeDelegations: 0 };

    walletConsents.forEach((consent) => {
      const status = String((consent as Record<string, unknown>).lifecycleStatus ?? (consent as Record<string, unknown>).status ?? '').toUpperCase();
      if (status === 'PENDING') counts.pending += 1;
      else if (status === 'APPROVED') counts.approved += 1;
      else if (status === 'REJECTED' || status === 'REVOKED' || status === 'EXPIRED') counts.rejected += 1;
    });

    delegations.forEach((delegation) => {
      if (String(delegation.status ?? '').toUpperCase() === 'ACTIVE') {
        counts.activeDelegations += 1;
      }
    });

    return counts;
  }, [walletConsents, delegations]);

  const lastEvent = activities[0];

  const activeWalletToken = useMemo(() => {
    const active = walletTokens.find((token) => String(token.status ?? '').toUpperCase() === 'ACTIVE');
    return active ?? walletTokens[0] ?? null;
  }, [walletTokens]);

  const currentTokenStatus = activeWalletToken
    ? String(activeWalletToken.status ?? '').toUpperCase()
    : registrySnapshot?.status
      ? String(registrySnapshot.status).toUpperCase()
      : 'NO ACTIVE TOKEN';

  const tokenExpiryIso =
    (activeWalletToken as unknown as Record<string, unknown> | null)?.expiresAt as string | undefined ??
    (registrySnapshot?.expiresAt ? String(registrySnapshot.expiresAt) : undefined);
  const tokenExpiresAt = tokenExpiryIso ? new Date(tokenExpiryIso) : null;
  const tokenExpiryDays = tokenExpiresAt ? Math.ceil((tokenExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const tokenExpiryLabel = tokenExpiryDays === null ? 'No active token' : tokenExpiryDays < 0 ? 'Expired' : `${tokenExpiryDays}d`;

  const pendingInbox = walletConsents
    .filter((c) => String((c as Record<string, unknown>).lifecycleStatus ?? (c as Record<string, unknown>).status ?? '').toUpperCase() === 'PENDING')
    .slice(0, 6);

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
    <div className="space-y-4">
      <PortalPageHeader title="Wallet Home" subtitle="Customer wallet dashboard for token status, consent requests, periodic KYC updates, and delegation controls." environmentLabel="Demo" />
      <section className="kyc-hero-theme rounded-3xl border border-slate-700/70 bg-[linear-gradient(140deg,rgba(15,23,42,0.96),rgba(14,22,56,0.92),rgba(17,29,67,0.95))] p-4 md:p-5 text-white shadow-[0_24px_60px_rgba(2,6,23,0.42)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Wallet Overview</p>
            <h2 className="mt-1.5 text-2xl md:text-3xl font-semibold tracking-tight">Hello, {displayWalletIdentity(activeWalletUsername, 'operator')} 👋</h2>
            <p className="mt-1.5 max-w-2xl text-sm text-slate-300">
              {authenticated
                ? 'Manage reusable KYC tokens, approve consent (self + delegated), and keep a full audit trail.'
                : 'Sign in to view your token, consents, and delegation controls.'}
            </p>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3.5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Token</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold text-cyan-200">{currentTokenStatus}</p>
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
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3.5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Audit signal</p>
              <div className="mt-2">
                <p className="text-lg font-semibold text-emerald-200">{lastEvent?.label ?? 'No activity yet'}</p>
                <p className="mt-1 text-xs text-slate-400">Latest event from {lastEvent?.service ?? '—'}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2.5 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3.5">
            <p className="text-xs text-slate-300">Pending approvals</p>
            <p className="mt-2 text-3xl font-semibold text-amber-200">{pending}</p>
            <p className="mt-1 text-xs text-slate-400">Inbox + delegated</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3.5">
            <p className="text-xs text-slate-300">Approved consents</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-200">{approved}</p>
            <p className="mt-1 text-xs text-slate-400">Reusable access trail</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3.5">
            <p className="text-xs text-slate-300">Rejected / revoked</p>
            <p className="mt-2 text-3xl font-semibold text-rose-200">{rejected}</p>
            <p className="mt-1 text-xs text-slate-400">User-controlled sharing</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3.5">
            <p className="text-xs text-slate-300">Active delegations</p>
            <p className="mt-2 text-3xl font-semibold text-indigo-200">{activeDelegations}</p>
            <p className="mt-1 text-xs text-slate-400">Nominee & guardian</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-700/70 bg-[linear-gradient(145deg,#0f172a,#0b122b)] p-4 text-slate-100">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Token history (all)</p>
                <p className="mt-1 text-sm text-slate-300">Current status of all issued tokens for this wallet user.</p>
              </div>
              <button type="button" onClick={() => void refreshWalletTokens(activeWalletUsername ?? undefined)} className="text-xs font-semibold text-slate-200 hover:text-white hover:underline">Refresh</button>
            </div>
            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-slate-300">
                  <tr>
                    <th className="px-3 py-2.5">Token ID</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Version</th>
                    <th className="px-3 py-2.5">Expiry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {walletTokens.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-3 text-sm text-slate-300">No token history found for this user.</td></tr>
                  ) : (
                    walletTokens.map((token) => {
                      const status = String(token.status ?? '').toUpperCase() || 'UNKNOWN';
                      const version = String((token as unknown as Record<string, unknown>).version ?? '—');
                      const expiresAt = (token as unknown as Record<string, unknown>).expiresAt as string | undefined;
                      return (
                        <tr key={String(token.tokenId)} className="bg-white/[0.02] hover:bg-white/[0.05]">
                          <td className="px-3 py-2.5 text-slate-100 font-mono">{String(token.tokenId).slice(0, 16)}…</td>
                          <td className="px-3 py-2.5 text-slate-200">{status}</td>
                          <td className="px-3 py-2.5 text-slate-300">{version}</td>
                          <td className="px-3 py-2.5 text-slate-300">{expiresAt ? new Date(expiresAt).toLocaleDateString() : '—'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-700/70 bg-[linear-gradient(145deg,#0f172a,#0b122b)] p-4 text-slate-100">
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
                    <th className="px-3 py-2.5">FI</th>
                    <th className="px-3 py-2.5">Purpose</th>
                    <th className="px-3 py-2.5">For</th>
                    <th className="px-3 py-2.5">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {pendingInbox.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-3 text-sm text-slate-300">
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
                          <td className="px-3 py-2.5 text-slate-100">{fi}</td>
                          <td className="px-3 py-2.5 text-slate-200">{purpose}</td>
                          <td className="px-3 py-2.5 text-slate-300">{subjectUser}</td>
                          <td className="px-3 py-2.5">
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

        <div className="space-y-4">
          <NotificationList title="Notifications" items={notifications} />

        </div>
      </section>
    </div>
  );
}
