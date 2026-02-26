import { AlertTriangle, BadgeCheck, ChevronRight, ClipboardCopy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useConsole } from '../ConsoleContext';
import { ConsoleButton } from '../components/ConsoleButton';
import { ConsoleCard } from '../components/ConsoleCard';
import { SectionHeader } from '../components/SectionHeader';
import { StatusPill } from '../components/StatusPill';
import { WalletAuthOptionalBanner } from '../components/WalletAuthOptionalBanner';
import { DEMO_BYPASS_WALLET_LOGIN } from '../portalFlags';
import { formatDateTime, truncate } from '../utils';

function isWalletAuthErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes('login required') || normalized.includes('wallet');
}

export default function VerifierPage() {
  const { runningAction, tokenId, consentId, registrySnapshot, verificationResults, verifyTokenSuccess, verifyTokenFailNotActive, failures } = useConsole();
  const [dismissWalletAuthBanner, setDismissWalletAuthBanner] = useState(false);
  const demoBypassWalletLogin = DEMO_BYPASS_WALLET_LOGIN;

  const latest = verificationResults[0] ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const verifiedToday = verificationResults.filter((entry) => entry.mode === 'success' && entry.at.startsWith(today)).length;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // no-op
    }
  };

  const latestAuthFailure = useMemo(() => {
    return failures.find((failure) => isWalletAuthErrorMessage(`${failure.errorCode} ${failure.message}`)) ?? null;
  }, [failures]);

  return (
    <div className="space-y-4">
      <WalletAuthOptionalBanner open={demoBypassWalletLogin && !dismissWalletAuthBanner} onDismiss={() => setDismissWalletAuthBanner(true)} />

      <ConsoleCard className="border-slate-200 bg-white">
        <SectionHeader title="Bharat KYC T - Verifier" subtitle="Token verification only." action={<StatusPill status="neutral" label="Verifier" />} />
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">IDs</p>
            <p className="mt-2 text-xs text-slate-700">
              token <span className="font-mono">{truncate(tokenId ?? '-', 20)}</span>{' '}
              {tokenId ? (
                <button type="button" className="ml-2 inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline" onClick={() => void copy(tokenId)}>
                  <ClipboardCopy className="h-3.5 w-3.5" /> copy
                </button>
              ) : null}
            </p>
            <p className="mt-1 text-xs text-slate-700">consent <span className="font-mono">{truncate(consentId ?? '-', 20)}</span></p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Registry</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{registrySnapshot?.status ?? '-'}</p>
            <p className="mt-1 text-xs text-slate-600">Token lifecycle status from registry snapshot</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Verifications (today)</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{verifiedToday}</p>
            <p className="mt-1 text-xs text-slate-600">successful outcomes</p>
          </div>
        </div>
      </ConsoleCard>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <ConsoleCard>
          <SectionHeader title="Token verification" subtitle="Validate token lifecycle and policy checks" />
          <div className="mt-3 space-y-2">
            <ConsoleButton intent="primary" onClick={() => void verifyTokenSuccess()} disabled={runningAction !== null}>
              <BadgeCheck className="h-4 w-4" />
              Verify token (success)
            </ConsoleButton>
            <ConsoleButton intent="secondary" onClick={() => void verifyTokenFailNotActive()} disabled={runningAction !== null}>
              <AlertTriangle className="h-4 w-4" />
              Expected fail: NOT_ACTIVE
            </ConsoleButton>
            
          </div>

          {latestAuthFailure ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">This action needs wallet login in non-demo mode.</p>
              <p className="mt-1 text-xs">{latestAuthFailure.errorCode}: {latestAuthFailure.message}</p>
              <Link to="/wallet/ops" className="mt-2 inline-flex items-center text-xs font-semibold hover:underline">
                Open Wallet Ops <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : null}
        </ConsoleCard>

        <ConsoleCard>
          <SectionHeader title="Recent outcomes" subtitle="Most recent verification results." />
          {!latest ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No verification results yet.</div>
          ) : (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">{latest.mode === 'success' ? 'Success' : 'Failure'}</p>
                <p className="text-xs text-slate-500">{formatDateTime(latest.at)}</p>
              </div>
              {latest.reason ? <p className="mt-1 text-xs text-slate-700">Reason: {latest.reason}</p> : null}
              {latest.detail ? (
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700">
                  {typeof latest.detail === 'string' ? latest.detail : JSON.stringify(latest.detail, null, 2)}
                </pre>
              ) : null}
              <Link to="/command/audit" className="mt-2 inline-flex items-center text-xs font-semibold text-slate-700 hover:underline">
                Open audit timeline <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </ConsoleCard>
      </div>
    </div>
  );
}
