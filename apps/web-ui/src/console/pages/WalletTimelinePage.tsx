import { useEffect } from "react";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { PortalPageHeader } from "../components/PortalPageHeader";
import { useConsole } from "../ConsoleContext";
import { WALLET_NOMINEE_USERNAME } from "../identityConfig";

export default function WalletTimelinePage() {
  const { authenticated, activeWalletUsername, activities, refreshWalletConsents, refreshWalletTokens, refreshDelegations, refreshWalletReviewStatus } = useConsole();

  useEffect(() => {
    if (!authenticated) return;
    const isNomineeSession = typeof activeWalletUsername === 'string' && activeWalletUsername.trim().toLowerCase() === WALLET_NOMINEE_USERNAME.toLowerCase();
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

  return (
    <div className="space-y-4">
      <PortalPageHeader
        title="Wallet Activity Timeline"
        subtitle="Wallet-side consent, delegation, token, and audit events for the current session and demo flows."
        environmentLabel="Demo"
      />
      <ActivityTimeline
        events={activities}
        title="Activity Timeline"
        subtitle="Filter wallet, consent, registry and FI-linked events with quick deep links."
        maxItems={50}
        links={{ consent: '/wallet/inbox', delegation: '/wallet/delegations', token: '/wallet', verify: '/fi/timeline', other: '/command/audit' }}
        quickFilters={[
          { id: 'all', label: 'All events', type: 'all' },
          { id: 'consents', label: 'Consents', type: 'consent' },
          { id: 'delegations', label: 'Delegations', type: 'delegation' },
          { id: 'tokens', label: 'Token events', type: 'token' },
          { id: 'failures', label: 'Failures', status: 'failed' },
        ]}
      />
    </div>
  );
}
