import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { decodeJwtPayload, useConsole } from '../ConsoleContext';
import AuthGateModal from '../components/AuthGateModal';
import { ConsoleButton } from '../components/ConsoleButton';
import { CardHint, CardTitle, ConsoleCard } from '../components/ConsoleCard';
import { EvidencePanel } from '../components/EvidencePanel';
import { JsonBlock } from '../components/JsonBlock';
import { WalletAuthOptionalBanner } from '../components/WalletAuthOptionalBanner';
import { SectionHeader } from '../components/SectionHeader';
import { StatusPill } from '../components/StatusPill';
import { FI_CLIENT_ID, WALLET_NOMINEE_USERNAME, WALLET_OWNER_USERNAME } from '../identityConfig';
import { DEMO_BYPASS_WALLET_LOGIN } from '../portalFlags';
import { formatDateTime, serviceLabel, truncate } from '../utils';

type StepBadge = 'idle' | 'running' | 'success' | 'error';
type JwtTab = 'token' | 'assertion';

interface ScenarioStep {
  id: string;
  title: string;
  requiresLogin?: boolean;
  expected: string;
  explain: string;
  proof: string;
  run: () => Promise<void>;
}

const scenarioDescriptions: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'Loan underwriting with wider disclosure scope.',
  B: 'Insurance claim with claim-specific purpose and scope.',
  C: 'Investment onboarding with expanded identity fields.',
  D: 'SIM activation with minimal field disclosure.',
};

const stepBadgeClass: Record<StepBadge, string> = {
  idle: 'border-slate-200 bg-slate-100 text-slate-700',
  running: 'border-amber-200 bg-amber-50 text-amber-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
};

const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8080';
const KEYCLOAK_REALM = import.meta.env.VITE_KEYCLOAK_REALM ?? 'bharat-kyc-dev';
const WALLET_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'wallet-client';

function mapGuidedStepToScenarioStep(guidedStepId: string | null) {
  switch (guidedStepId) {
    case 'wallet_approve':
      return 'consent-approve';
    case 'delegation_add_nominee_create_pending_consent':
      return 'delegation-owner';
    case 'login_wallet_nominee':
    case 'nominee_approve':
      return 'delegation-nominee';
    default:
      return null;
  }
}

function isWalletAuthErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('login required') ||
    normalized.includes(WALLET_OWNER_USERNAME.toLowerCase()) ||
    normalized.includes(WALLET_NOMINEE_USERNAME.toLowerCase()) ||
    normalized.includes('wallet actions')
  );
}

export default function ScenarioOrchestrationPage() {
  const {
    guided,
    scenarioId,
    scenario,
    scenarios,
    setScenarioId,
    runningAction,
    authenticated,
    activeWalletUsername,
    tokenId,
    consentId,
    consentStatus,
    consentExpiresAt,
    tokenJwt,
    assertionJwt,
    registrySnapshot,
    registryAudit,
    dueUsers,
    reviewRun,
    activities,
    failures,
    issueToken,
    requestConsent,
    requestConsentWith,
    approveConsent,
    rejectConsent,
    verifyAssertionSuccess,
    revokeToken,
    verifyExpectedFailure,
    renewConsent,
    runFi2Reuse,
    runCkycSupersede,
    addNomineeDelegation,
    approveAsNominee,
    loadDueUsers,
    runReviewOnce,
    loginWallet,
  } = useConsole();

  const [jwtTab, setJwtTab] = useState<JwtTab>('token');
  const [stepStatus, setStepStatus] = useState<Record<string, StepBadge>>({});
  const [stepDetail, setStepDetail] = useState<Record<string, string>>({});
  const [resumingStepId, setResumingStepId] = useState<string | null>(null);
  const [hasAutoOpenedLoginForThisPause, setHasAutoOpenedLoginForThisPause] = useState(false);
  const [popupBlockedWarning, setPopupBlockedWarning] = useState(false);
  const [inlineAuthWarning, setInlineAuthWarning] = useState<string | null>(null);
  const [dismissWalletAuthBanner, setDismissWalletAuthBanner] = useState(false);
  const lastPausedStepRef = useRef<string | null>(null);
  const pauseRequiredUserRef = useRef<string | null>(null);
  const previousRunnerStatusRef = useRef(guided.runnerStatus);
  const resumeTimerRef = useRef<number | null>(null);

  const decodedToken = decodeJwtPayload(tokenJwt);
  const decodedAssertion = decodeJwtPayload(assertionJwt);

  const runStep = async (step: ScenarioStep) => {
    setStepStatus((previous) => ({ ...previous, [step.id]: 'running' }));
    setStepDetail((previous) => ({ ...previous, [step.id]: 'Running...' }));
    try {
      await step.run();
      setStepStatus((previous) => ({ ...previous, [step.id]: 'success' }));
      setStepDetail((previous) => ({ ...previous, [step.id]: 'Completed' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Step failed.';
      if (isWalletAuthErrorMessage(message)) {
        setInlineAuthWarning('This action needs wallet login in real-auth mode.');
      }
      setStepStatus((previous) => ({ ...previous, [step.id]: 'error' }));
      setStepDetail((previous) => ({ ...previous, [step.id]: message }));
    }
  };

  const runScenarioAEndToEnd = async () => {
    if (!authenticated && !demoBypassWalletLogin) {
      throw new Error('Owner role login required before running Scenario A.');
    }
    await issueToken();
    await requestConsent();
    if (authenticated) {
      await approveConsent();
      await verifyAssertionSuccess();
    } else {
      setInlineAuthWarning('This action needs wallet login in non-demo mode.');
    }
    await revokeToken();
    await verifyExpectedFailure('TOKEN_NOT_ACTIVE');
  };

  const runScenarioBInsurance = async () => {
    if (!authenticated && !demoBypassWalletLogin) {
      throw new Error('Owner role login required before running Scenario B.');
    }
    setScenarioId('B');
    await requestConsentWith({
      purpose: 'insurance-claim',
      requestedFields: ['fullName', 'dob', 'idNumber', 'phone'],
      fiId: FI_CLIENT_ID,
    });
    if (authenticated) {
      await approveConsent();
      await verifyAssertionSuccess();
    } else {
      setInlineAuthWarning('This action needs wallet login in non-demo mode.');
    }
  };

  const runConsentRejectFlow = async () => {
    if (!authenticated && !demoBypassWalletLogin) {
      throw new Error('Owner role login required before running reject flow.');
    }
    await requestConsent();
    if (authenticated) {
      await rejectConsent();
      await verifyExpectedFailure('CONSENT_REJECTED');
    } else {
      setInlineAuthWarning('This action needs wallet login in non-demo mode.');
    }
  };

  const runRevokeVerifyFailFlow = async () => {
    await revokeToken();
    await verifyExpectedFailure('TOKEN_NOT_ACTIVE');
  };

  const runConsentExpiryRenewFlow = async () => {
    await verifyExpectedFailure('CONSENT_EXPIRED');
    await renewConsent();
  };

  const today = new Date().toISOString().slice(0, 10);

  const stepDefinitions: ScenarioStep[] = [
    {
      id: 'token-lifecycle',
      title: '1) Issue Token',
      expected: 'Token moves to ACTIVE in registry with version and timestamps.',
      explain: 'Issuer signs KYC token and stores only references and metadata in registry.',
      proof: 'Registry status panel shows ACTIVE with token version and timestamps.',
      run: issueToken,
    },
    {
      id: 'consent-create',
      title: '2) FI Request Consent',
      expected: 'A new consentId is created with purpose + requested fields.',
      explain: 'FI initiates consent using purpose/scope binding against the active token.',
      proof: 'Consent status panel shows new consentId in PENDING or REQUESTED state.',
      run: requestConsent,
    },
    {
      id: 'consent-approve',
      title: '3) Wallet Approve',
      requiresLogin: true,
      expected: 'Consent becomes APPROVED and assertion JWT is issued.',
      explain: 'Wallet owner approval is required to authorize selective disclosure.',
      proof: 'Assertion JWT panel is populated and consent status becomes APPROVED.',
      run: approveConsent,
    },
    {
      id: 'verify-outcomes',
      title: '4) FI Verify Assertion',
      expected: 'Verification succeeds with aud/purpose/scope and registry checks.',
      explain: 'FI validates signature, expiry, audience, purpose, scope, and token status.',
      proof: 'No error card for this step and verification event appears in audit feed.',
      run: verifyAssertionSuccess,
    },
    {
      id: 'revocation',
      title: '5) Revoke Token',
      expected: 'Token lifecycle becomes REVOKED.',
      explain: 'Revocation proves lifecycle control after token issuance.',
      proof: 'Registry status panel changes to REVOKED.',
      run: revokeToken,
    },
    {
      id: 'post-revoke-fail',
      title: '6) Verify (Expect Fail)',
      expected: 'Verification fails with TOKEN_NOT_ACTIVE.',
      explain: 'This is an intentional failure proving revoke enforcement.',
      proof: 'Failure panel contains TOKEN_NOT_ACTIVE.',
      run: () => verifyExpectedFailure('TOKEN_NOT_ACTIVE'),
    },
    {
      id: 'consent-reject-path',
      title: '7) Consent Reject Path',
      requiresLogin: true,
      expected: 'Rejected consent verification fails with CONSENT_REJECTED.',
      explain: 'Wallet explicitly rejects consent to validate denied-request handling.',
      proof: 'Failure panel shows CONSENT_REJECTED error code.',
      run: runConsentRejectFlow,
    },
    {
      id: 'consent-expiry-renew',
      title: '8) Consent Expiry + Renewal',
      expected: 'Expired consent fails with CONSENT_EXPIRED, then renewal creates fresh consent.',
      explain: 'Use after TTL expires, then renew without reissuing token.',
      proof: 'Failure panel shows CONSENT_EXPIRED and renewed consentId appears.',
      run: runConsentExpiryRenewFlow,
    },
    {
      id: 'fi2-reuse',
      title: '9) FI#2 Reuse Branch',
      requiresLogin: true,
      expected: 'FI#2 verifies using same active token unless superseded.',
      explain: 'Second FI checks cross-institution reuse with different purpose/scope.',
      proof: 'FI2 result card shows token reuse outcome.',
      run: runFi2Reuse,
    },
    {
      id: 'ckyc-supersede',
      title: '10) Simulate CKYCR Update',
      expected: 'Old token is SUPERSEDED and new token is ACTIVE.',
      explain: 'CKYCR profile version update triggers issuer supersede.',
      proof: 'Registry shows superseded/active transition and version bump.',
      run: runCkycSupersede,
    },
    {
      id: 'review-run',
      title: '11) Periodic Review Run',
      expected: 'Due list loads and scheduler run returns actions taken.',
      explain: 'Review scheduler enforces risk-tier periodicity and writes audit events.',
      proof: 'Due users and scheduler summary appear with counts.',
      run: async () => {
        await loadDueUsers(today);
        await runReviewOnce(today);
      },
    },
    {
      id: 'delegation-owner',
      title: '12) Add Nominee Delegation',
      requiresLogin: true,
      expected: 'Delegation becomes ACTIVE for nominee approval path.',
      explain: 'Owner grants constrained delegation for consent approval.',
      proof: 'Delegation records show ACTIVE mapping owner -> nominee.',
      run: addNomineeDelegation,
    },
    {
      id: 'delegation-nominee',
      title: '13) Approve as Nominee',
      requiresLogin: true,
      expected: 'Nominee approves consent only if delegation constraints allow it.',
      explain: `Logout owner and login as ${WALLET_NOMINEE_USERNAME} before running this step.`,
      proof: 'Audit event shows delegate actor approval.',
      run: approveAsNominee,
    },
  ];
  const visibleStepDefinitions = stepDefinitions;
  const demoBypassWalletLogin = DEMO_BYPASS_WALLET_LOGIN;
  const authGateOpen = !demoBypassWalletLogin && guided.runnerStatus === 'paused_waiting_login';
  const requiredLoginUserRaw = guided.requiredLoginUser ?? WALLET_OWNER_USERNAME;
  const requiredLoginUser = requiredLoginUserRaw === WALLET_OWNER_USERNAME ? 'wallet owner role user' : requiredLoginUserRaw;
  const gatedScenarioStepId = mapGuidedStepToScenarioStep(guided.requiredLoginStepId);
  const authGateMessageBase =
    requiredLoginUser === WALLET_NOMINEE_USERNAME
      ? `Logout current user and login as ${WALLET_NOMINEE_USERNAME}. This step performs a wallet approval/rejection and requires an authenticated Keycloak session. The flow will resume automatically after login.`
      : `Please login as ${requiredLoginUser}. This step performs a wallet approval/rejection and requires an authenticated Keycloak session. The flow will resume automatically after login.`;

  useEffect(() => {
    if (guided.runnerStatus === 'paused_waiting_login') {
      const currentRequiredUser = guided.requiredLoginUser ?? WALLET_OWNER_USERNAME;
      if (pauseRequiredUserRef.current !== currentRequiredUser) {
        setHasAutoOpenedLoginForThisPause(false);
        setPopupBlockedWarning(false);
      }
      pauseRequiredUserRef.current = currentRequiredUser;
      lastPausedStepRef.current = mapGuidedStepToScenarioStep(guided.requiredLoginStepId);
    }

    if (previousRunnerStatusRef.current === 'paused_waiting_login' && guided.runnerStatus === 'running') {
      setHasAutoOpenedLoginForThisPause(false);
      setPopupBlockedWarning(false);
      pauseRequiredUserRef.current = null;
      const pausedStepId = lastPausedStepRef.current;
      if (pausedStepId) {
        setResumingStepId(pausedStepId);
        if (resumeTimerRef.current) {
          window.clearTimeout(resumeTimerRef.current);
        }
        resumeTimerRef.current = window.setTimeout(() => {
          setResumingStepId(null);
        }, 1800);
      }
    }

    if (guided.runnerStatus !== 'running' && guided.runnerStatus !== 'paused_waiting_login') {
      setResumingStepId(null);
      setHasAutoOpenedLoginForThisPause(false);
      setPopupBlockedWarning(false);
      pauseRequiredUserRef.current = null;
      if (resumeTimerRef.current) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    }

    previousRunnerStatusRef.current = guided.runnerStatus;
  }, [guided.requiredLoginStepId, guided.runnerStatus]);

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) {
        window.clearTimeout(resumeTimerRef.current);
      }
    };
  }, []);

  const copyAuthValue = async (_label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Ignore clipboard errors in read-only environments.
    }
  };

  const openKeycloakLogin = useCallback(() => {
    if (demoBypassWalletLogin) {
      return;
    }
    setPopupBlockedWarning(false);
    void loginWallet(requiredLoginUserRaw);
  }, [demoBypassWalletLogin, loginWallet, requiredLoginUserRaw]);

  useEffect(() => {
    if (demoBypassWalletLogin) {
      return;
    }
    if (guided.runnerStatus !== 'paused_waiting_login' || hasAutoOpenedLoginForThisPause) {
      return;
    }

    const timer = window.setTimeout(() => {
      setHasAutoOpenedLoginForThisPause(true);
      openKeycloakLogin();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [demoBypassWalletLogin, guided.runnerStatus, hasAutoOpenedLoginForThisPause, openKeycloakLogin]);

  return (
    <>
      {!demoBypassWalletLogin ? (
        <AuthGateModal
          open={authGateOpen}
          title="Wallet login required"
          message={`${authGateMessageBase}${popupBlockedWarning ? ' Popup blocked. Click Open Keycloak Login.' : ''}`}
          realm={KEYCLOAK_REALM}
          keycloakUrl={KEYCLOAK_URL}
          loginHint={requiredLoginUser}
          onOpenLogin={openKeycloakLogin}
          onCopy={copyAuthValue}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <ConsoleCard>
          <div className="mb-4">
            <WalletAuthOptionalBanner
              open={demoBypassWalletLogin && !dismissWalletAuthBanner}
              onDismiss={() => setDismissWalletAuthBanner(true)}
            />
          </div>
          <SectionHeader
            title="Bharat KYC T - Scenario Orchestration"
            subtitle="Primary workflow flow. Keep this page open while running steps and watching evidence panels."
          action={
            <StatusPill
              status={authenticated ? 'ok' : demoBypassWalletLogin ? 'neutral' : 'warn'}
              label={
                authenticated
                  ? `Wallet ${activeWalletUsername ?? 'active'}`
                  : demoBypassWalletLogin
                    ? 'Demo mode: wallet login optional'
                    : 'Wallet login required for approval steps'
              }
            />
          }
        />

        <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {scenarios.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setScenarioId(item.id)}
              className={`rounded-lg border px-3 py-2 text-left ${
                scenarioId === item.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-wide">Scenario {item.id}</p>
              <p className="text-sm font-semibold">{item.label}</p>
              <p className={`mt-1 text-xs ${scenarioId === item.id ? 'text-slate-300' : 'text-slate-500'}`}>
                {scenarioDescriptions[item.id]}
              </p>
            </button>
          ))}
        </div>

        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p>
            <span className="font-semibold">Current purpose:</span> {scenario.purpose}
          </p>
          <p className="mt-1">
            <span className="font-semibold">Requested fields:</span> {scenario.requestedFields.join(', ')}
          </p>
        </div>

        <div className="mb-4 grid gap-2 md:grid-cols-2">
          <section id="scenario-a-run" className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-semibold text-slate-900">Run Scenario A (loan-underwriting)</p>
            <p className="mt-1 text-xs text-slate-600">
              Runs issue {'->'} request {'->'} approve {'->'} verify {'->'} revoke {'->'} TOKEN_NOT_ACTIVE.
            </p>
            <ConsoleButton className="mt-2 w-full" onClick={() => void runScenarioAEndToEnd()} disabled={runningAction !== null}>
              Run Scenario A End-to-End
            </ConsoleButton>
          </section>

          <section id="scenario-b-run" className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-semibold text-slate-900">Run Scenario B (insurance-claim)</p>
            <p className="mt-1 text-xs text-slate-600">Reuses same orchestration with insurance purpose/scope defaults.</p>
            <ConsoleButton className="mt-2 w-full" onClick={() => void runScenarioBInsurance()} disabled={runningAction !== null}>
              Run Scenario B Reuse
            </ConsoleButton>
          </section>

          <section id="consent-reject-quick" className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-semibold text-slate-900">Consent Reject Flow</p>
            <p className="mt-1 text-xs text-slate-600">Forces reject branch and verifies CONSENT_REJECTED.</p>
            <ConsoleButton className="mt-2 w-full" intent="secondary" onClick={() => void runConsentRejectFlow()} disabled={runningAction !== null}>
              Run Reject Path
            </ConsoleButton>
          </section>

          <section id="consent-expiry-renew-quick" className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-semibold text-slate-900">Consent Expiry + Renew</p>
            <p className="mt-1 text-xs text-slate-600">Wait until consent TTL passes, then run verify fail and renew.</p>
            <div className="mt-2 grid gap-2">
              <ConsoleButton intent="secondary" onClick={() => void verifyExpectedFailure('CONSENT_EXPIRED')} disabled={runningAction !== null}>
                Verify Expect CONSENT_EXPIRED
              </ConsoleButton>
              <ConsoleButton intent="secondary" onClick={() => void renewConsent()} disabled={runningAction !== null}>
                Renew Consent
              </ConsoleButton>
            </div>
          </section>

          <section id="ckyc-supersede-quick" className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-semibold text-slate-900">CKYCR Supersede Flow</p>
            <p className="mt-1 text-xs text-slate-600">Simulate CKYCR update and sync supersede chain.</p>
            <ConsoleButton className="mt-2 w-full" intent="secondary" onClick={() => void runCkycSupersede()} disabled={runningAction !== null}>
              Run CKYCR Supersede
            </ConsoleButton>
          </section>

          <section id="revoke-verify-fail-quick" className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-semibold text-slate-900">Revoke + Verify Fail</p>
            <p className="mt-1 text-xs text-slate-600">Runs revoke and immediate verify failure check.</p>
            <ConsoleButton className="mt-2 w-full" intent="secondary" onClick={() => void runRevokeVerifyFailFlow()} disabled={runningAction !== null}>
              Run Revoke + Fail
            </ConsoleButton>
          </section>
        </div>

        <div className="max-h-[64vh] space-y-3 overflow-auto pr-1">
          {inlineAuthWarning ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-semibold">{inlineAuthWarning}</p>
              <p className="mt-1">
                <Link to="/wallet/ops" className="font-semibold underline-offset-2 hover:underline">
                  Open Wallet Ops
                </Link>
              </p>
            </div>
          ) : null}
          {guided.runnerStatus === 'paused_waiting_login' && !demoBypassWalletLogin ? (
            <div className="sticky top-0 z-20 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-sm">
              Paused: Waiting for Keycloak login as <span className="font-semibold">{requiredLoginUser}</span>. Open login in the
              modal. Auto-resume enabled.
            </div>
          ) : null}
          {visibleStepDefinitions.map((step) => {
            const status = stepStatus[step.id] ?? 'idle';
            const isGatedStep = guided.runnerStatus === 'paused_waiting_login' && step.id === gatedScenarioStepId;
            const isResumingStep = guided.runnerStatus === 'running' && step.id === resumingStepId;
            return (
              <section key={step.id} id={step.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">{step.title}</h4>
                    <p className="mt-1 text-xs text-slate-500">Expected outcome: {step.expected}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isGatedStep ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                        LOGIN REQUIRED
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-700" />
                      </span>
                    ) : null}
                    {isResumingStep ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">
                        resuming...
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-700" />
                      </span>
                    ) : null}
                    {step.requiresLogin ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                        <KeyRound className="h-3.5 w-3.5" />
                        Login required
                      </span>
                    ) : null}
                    {step.requiresLogin && !authenticated && !demoBypassWalletLogin ? (
                      <ConsoleButton size="sm" intent="secondary" onClick={() => void loginWallet()} disabled={runningAction !== null}>
                        Login now
                      </ConsoleButton>
                    ) : null}
                    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${stepBadgeClass[status]}`}>
                      {status.toUpperCase()}
                    </span>
                    <ConsoleButton
                      size="sm"
                      onClick={() => void runStep(step)}
                      disabled={runningAction !== null || (step.requiresLogin && !authenticated && !demoBypassWalletLogin)}
                    >
                      Run
                    </ConsoleButton>
                  </div>
                </div>

                <details className="mt-2 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold text-slate-700">Explain this step</summary>
                  <p className="mt-2 leading-relaxed">{step.explain}</p>
                  <p className="mt-2 leading-relaxed">
                    <span className="font-semibold text-slate-700">Proof appears:</span> {step.proof}
                  </p>
                </details>

                <p className="mt-2 text-xs text-slate-600">{stepDetail[step.id] ?? 'Not executed yet.'}</p>
              </section>
            );
          })}
        </div>
        </ConsoleCard>

        <div className="space-y-4">
          <ConsoleCard>
            <SectionHeader title="Live Evidence" subtitle="Token, consent, and lifecycle proof while orchestration runs." />
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">Token ID</p>
              <p className="mt-1 font-medium text-slate-900">{tokenId ?? '-'}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">Consent ID</p>
              <p className="mt-1 font-medium text-slate-900">{consentId ?? '-'}</p>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p>
              <span className="font-semibold text-slate-900">Registry status:</span> {registrySnapshot?.status ?? '-'}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Version:</span> {registrySnapshot?.version ?? '-'}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Issued:</span> {formatDateTime(registrySnapshot?.issuedAt)}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Expiry:</span> {formatDateTime(registrySnapshot?.expiresAt)}
            </p>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p>
              <span className="font-semibold text-slate-900">Consent status:</span> {consentStatus ?? '-'}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Purpose:</span> {scenario.purpose}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Scope:</span> {scenario.requestedFields.join(', ')}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Consent expiry:</span> {formatDateTime(consentExpiresAt)}
            </p>
          </div>
        </ConsoleCard>

        <ConsoleCard>
          <div className="mb-2 flex items-center justify-between">
            <CardTitle>JWT Viewer</CardTitle>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setJwtTab('token')}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  jwtTab === 'token' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                Token JWT
              </button>
              <button
                type="button"
                onClick={() => setJwtTab('assertion')}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  jwtTab === 'assertion' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                Assertion JWT
              </button>
            </div>
          </div>
          <CardHint>{jwtTab === 'token' ? 'Issued token payload' : 'Consent assertion payload'}</CardHint>
          <div className="mt-3">
            <JsonBlock value={jwtTab === 'token' ? decodedToken ?? { message: 'Issue token first' } : decodedAssertion ?? { message: 'Approve consent first' }} compact />
          </div>
        </ConsoleCard>

        <ConsoleCard>
          <SectionHeader
            title="Audit Timeline"
            subtitle="Latest lifecycle events."
            action={
              <Link className="text-xs font-semibold text-slate-600 underline-offset-2 hover:underline" to="/command/audit">
                Open full audit
              </Link>
            }
          />
          <div className="max-h-44 space-y-2 overflow-auto pr-1">
            {activities.slice(0, 6).map((event) => (
              <div key={event.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                <p className="font-semibold text-slate-900">{event.label}</p>
                <p>{formatDateTime(event.at)} | {serviceLabel[event.service]}</p>
              </div>
            ))}
            {activities.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600">No activity yet.</p>
            ) : null}
          </div>
        </ConsoleCard>

        <ConsoleCard>
          <SectionHeader title="Failure Reason" subtitle="Most recent error cards." />
          <div className="max-h-40 space-y-2 overflow-auto pr-1">
            {failures.slice(0, 5).map((failure) => (
              <div key={failure.id} className="rounded-lg border border-rose-200 bg-rose-50 p-2">
                <div className="flex items-center gap-2 text-xs text-rose-700">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  {formatDateTime(failure.at)}
                </div>
                <p className="mt-1 text-sm font-semibold text-rose-900">{failure.errorCode}</p>
                <p className="text-xs text-rose-800">{failure.message}</p>
              </div>
            ))}
            {failures.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm text-slate-600">No failures yet.</p>
            ) : null}
          </div>
        </ConsoleCard>

        <EvidencePanel title="Request/Response Inspector" />

        {reviewRun || dueUsers.length > 0 ? (
          <ConsoleCard>
            <SectionHeader title="Periodic Review Evidence" subtitle="Loaded due users and latest run summary." />
            <p className="text-sm text-slate-700">dueUsers: {dueUsers.length}</p>
            {reviewRun ? (
              <p className="text-sm text-slate-700">
                run summary: due={reviewRun.totalDue}, synced={reviewRun.synced}, failed={reviewRun.failed}
              </p>
            ) : null}
          </ConsoleCard>
        ) : null}

        {registryAudit.length > 0 ? (
          <ConsoleCard>
            <SectionHeader title="Registry Audit Chain" subtitle="Hash-linked entries for current token." />
            <div className="max-h-36 space-y-2 overflow-auto pr-1">
              {registryAudit.slice(0, 4).map((event, index) => (
                <div key={`${event.hashCurr}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">{event.eventType}</p>
                  <p>{formatDateTime(event.createdAt)}</p>
                  <p>hash_curr: {truncate(event.hashCurr, 26)}</p>
                </div>
              ))}
            </div>
          </ConsoleCard>
        ) : null}
        </div>
      </div>
    </>
  );
}
