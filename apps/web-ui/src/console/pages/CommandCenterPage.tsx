import { CheckCircle2, ChevronRight, Circle, PlayCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useConsole } from '../ConsoleContext';
import { ConsoleButton } from '../components/ConsoleButton';
import { ConsoleCard } from '../components/ConsoleCard';
import { CopyValueField } from '../components/CopyValueField';
import { EvidencePanel } from '../components/EvidencePanel';
import { GuidedWalkthroughPanel } from '../components/GuidedWalkthroughPanel';
import { displayWalletIdentity, WALLET_OWNER_USER_ID } from '../identityConfig';
import { PortalPageHeader } from '../components/PortalPageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { StatusPill } from '../components/StatusPill';
import { DEMO_BYPASS_WALLET_LOGIN } from '../portalFlags';
import type { ActivityEvent, CoverageKey, CkycProfileResponse, ServiceName } from '../types';
import { formatDateTime, truncate } from '../utils';

interface CoverageRow {
  key: CoverageKey;
  label: string;
  goTo: string;
}

const coverageRows: CoverageRow[] = [
  { key: 'issueToken', label: 'Token issuance', goTo: '/command/scenario' },
  { key: 'requestConsent', label: 'Consent request', goTo: '/command/scenario' },
  { key: 'walletApprove', label: 'Wallet approval (requires login)', goTo: '/wallet/ops' },
  { key: 'fiVerifySuccess', label: 'FI verify success', goTo: '/command/scenario' },
  { key: 'revokeToken', label: 'Revoke token', goTo: '/command/scenario' },
  { key: 'postRevokeVerifyFailTokenNotActive', label: 'FI verify after revoke fails (TOKEN_NOT_ACTIVE)', goTo: '/command/scenario' },
  { key: 'ckycSupersede', label: 'CKYCR supersede flow', goTo: '/command/scenario' },
  { key: 'delegationNomineeApproval', label: 'Delegation / nominee approval', goTo: '/wallet/delegations' },
  { key: 'periodicReview', label: 'Periodic review (due list + run once)', goTo: '/command/integrations' },
  { key: 'auditChain', label: 'Audit chain', goTo: '/command/audit' },
  { key: 'consentRejectedFail', label: 'Consent rejection path (CONSENT_REJECTED)', goTo: '/command/scenario' },
  { key: 'consentExpiredThenRenew', label: 'Consent expiry + renewal', goTo: '/command/scenario' },
  { key: 'crossInstitutionReuse', label: 'FI#2 reuse branch', goTo: '/command/scenario' },
  { key: 'requestResponseInspector', label: 'Request/Response inspector', goTo: '/command/audit' },
];

const coverageGroups: Array<{ title: string; keys: CoverageKey[] }> = [
  { title: 'Tokenisation', keys: ['issueToken', 'fiVerifySuccess', 'revokeToken', 'postRevokeVerifyFailTokenNotActive', 'crossInstitutionReuse'] },
  { title: 'Consent', keys: ['requestConsent', 'walletApprove', 'consentRejectedFail', 'consentExpiredThenRenew', 'delegationNomineeApproval'] },
  { title: 'CKYCR + Review', keys: ['ckycSupersede', 'periodicReview'] },
  { title: 'Audit / Inspection', keys: ['auditChain', 'requestResponseInspector'] },
];

const HEALTH_TARGETS = [
  {
    id: 'keycloak',
    label: 'keycloak',
    purpose: 'Auth realm + clients',
    url: 'http://localhost:8080/realms/bharat-kyc-dev/.well-known/openid-configuration',
  },
  { id: 'issuer', label: 'issuer', purpose: 'Issues KYC token (JWT)', url: 'http://localhost:3001/v1/health?probe=readiness' },
  { id: 'registry', label: 'registry', purpose: 'Token lifecycle registry', url: 'http://localhost:3002/v1/health?probe=readiness' },
  { id: 'consent', label: 'consent', purpose: 'Consent issuance + JWKS', url: 'http://localhost:3003/v1/health?probe=readiness' },
  { id: 'wallet', label: 'wallet', purpose: 'Wallet approvals + delegation', url: 'http://localhost:3004/v1/health?probe=readiness' },
  { id: 'fi', label: 'fi', purpose: 'Verifier flow + policy checks', url: 'http://localhost:3005/v1/health?probe=readiness' },
  { id: 'ckyc', label: 'ckyc', purpose: 'CKYCR adapter', url: 'http://localhost:3006/v1/health?probe=readiness' },
  { id: 'review', label: 'review', purpose: 'Periodic review scheduler', url: 'http://localhost:3007/v1/health?probe=readiness' },
] as const;

type HealthServiceId = (typeof HEALTH_TARGETS)[number]['id'];
type HealthTarget = (typeof HEALTH_TARGETS)[number];

interface HealthState {
  status: 'ok' | 'down' | 'unknown';
  checkedAt: string;
  latencyMs?: number;
  error?: string;
}

type TimelineServiceFilter = 'all' | Exclude<ServiceName, 'console'>;
type WorkflowId =
  | 'token_lifecycle'
  | 'consent_approval_verify'
  | 'revocation_expected_fail'
  | 'ckyc_supersede'
  | 'periodic_review'
  | 'delegation';

const TIMELINE_SERVICE_FILTERS: Array<{ id: TimelineServiceFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'issuer', label: 'Issuer' },
  { id: 'registry', label: 'Registry' },
  { id: 'consent', label: 'Consent' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'fi', label: 'FI' },
  { id: 'review', label: 'Review' },
  { id: 'ckyc', label: 'CKYCR' },
];

const healthStatusPill: Record<HealthState['status'], { status: 'ok' | 'error' | 'neutral'; label: string }> = {
  ok: { status: 'ok', label: 'Healthy' },
  down: { status: 'error', label: 'Down' },
  unknown: { status: 'neutral', label: 'Unknown' },
};

const ckycSandboxBaseUrl =
  (import.meta.env.VITE_CKYCR_SANDBOX_BASE_URL as string | undefined) ??
  (import.meta.env.VITE_CKYC_SANDBOX_BASE_URL as string | undefined) ??
  '';

function createHealthState(status: HealthState['status'] = 'unknown') {
  return HEALTH_TARGETS.reduce(
    (acc, target) => {
      acc[target.id] = { status, checkedAt: '' };
      return acc;
    },
    {} as Record<HealthServiceId, HealthState>
  );
}

function createHealthDetailState(initialValue = false) {
  return HEALTH_TARGETS.reduce(
    (acc, target) => {
      acc[target.id] = initialValue;
      return acc;
    },
    {} as Record<HealthServiceId, boolean>
  );
}

function KpiCard({
  title,
  value,
  hint,
  subHint,
  onClick,
}: {
  title: string;
  value: ReactNode;
  hint: string;
  subHint?: string;
  onClick?: () => void;
}) {
  const content = (
    <ConsoleCard className="h-full border-slate-200/85 bg-[linear-gradient(160deg,rgba(255,255,255,0.97),rgba(241,245,249,0.92))] p-4 transition hover:-translate-y-[1px] hover:border-slate-300">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
      {subHint ? <p className="mt-0.5 text-xs text-slate-400">{subHint}</p> : null}
    </ConsoleCard>
  );

  if (!onClick) {
    return content;
  }

  return (
    <button type="button" className="w-full text-left" onClick={onClick}>
      {content}
    </button>
  );
}

interface GuidedStepHint {
  target: string;
  expected: string;
}

interface TraceInfo {
  requestId: string | null;
  correlationId: string | null;
}

interface OnboardingResult {
  walletUserId: string;
  ckycReference: string | null;
  tokenId: string | null;
  tokenStatus: string;
  tokenExpiresAt: string | null;
  requestId: string | null;
  correlationId: string | null;
  issuedAt: string;
}

interface CkycPreviewState {
  source: 'sandbox' | 'local';
  reference: string;
  fetchedAt: string;
  summary: string;
  profile: CkycProfileResponse;
}

const guidedStepHintsByLabel: Record<string, GuidedStepHint> = {
  'Issue Token': { target: '/command/scenario', expected: 'Registry token status becomes ACTIVE with a fresh tokenId.' },
  'FI Request Consent': { target: '/command/scenario', expected: 'New consentId is created with purpose + requested fields.' },
  'Wallet Approve (owner login required)': { target: '/wallet/ops', expected: 'Consent becomes APPROVED and an assertion JWT is issued.' },
  'FI Verify Success': { target: '/command/scenario', expected: 'Assertion verification succeeds with aud/purpose/scope checks.' },
  'Revoke Token': { target: '/command/scenario', expected: 'Registry token lifecycle changes to REVOKED.' },
  'FI Verify expected fail TOKEN_NOT_ACTIVE': { target: '/command/scenario', expected: 'Expected failure: FI verify returns TOKEN_NOT_ACTIVE.' },
  'CKYCR update and supersede': { target: '/command/scenario', expected: 'Old token superseded; new token ACTIVE with version change.' },
  'Periodic review run once': { target: '/command/integrations', expected: 'Due list and scheduler summary appear with actions taken.' },
  'Add nominee delegation + create pending consent (owner)': { target: '/wallet/delegations', expected: 'Delegation becomes ACTIVE and a fresh pending consent is created.' },
  'Login as nominee role': { target: '/wallet/delegations', expected: 'Wallet session switches from owner role to nominee role.' },
  'Approve as nominee role': { target: '/wallet/delegations', expected: 'Nominee approval succeeds and delegate actor appears in audit.' },
};

function formatWorkflowStepLabel(step: string) {
  return step;
}

function detailToText(detail: unknown): string {
  if (detail === undefined || detail === null) {
    return '';
  }
  if (typeof detail === 'string') {
    return detail;
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function parseTraceInfo(body: unknown): TraceInfo {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { requestId: null, correlationId: null };
  }
  const payload = body as Record<string, unknown>;
  const requestIdValue = payload.requestId ?? payload.request_id ?? payload.traceId ?? payload.trace_id;
  const correlationIdValue = payload.correlationId ?? payload.correlation_id;
  return {
    requestId: typeof requestIdValue === 'string' && requestIdValue.trim().length > 0 ? requestIdValue.trim() : null,
    correlationId:
      typeof correlationIdValue === 'string' && correlationIdValue.trim().length > 0 ? correlationIdValue.trim() : null,
  };
}

function readIdentifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractIdentifiersFromDetail(detail: unknown) {
  const identifiers: {
    tokenId?: string;
    consentId?: string;
    requestId?: string;
    correlationId?: string;
  } = {};

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item));
      return;
    }
    Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
      const normalized = key.toLowerCase();
      if (!identifiers.tokenId && normalized.includes('tokenid')) {
        const candidate = readIdentifier(value);
        if (candidate) {
          identifiers.tokenId = candidate;
        }
      }
      if (!identifiers.consentId && normalized.includes('consentid')) {
        const candidate = readIdentifier(value);
        if (candidate) {
          identifiers.consentId = candidate;
        }
      }
      if (!identifiers.requestId && (normalized.includes('requestid') || normalized.includes('traceid'))) {
        const candidate = readIdentifier(value);
        if (candidate) {
          identifiers.requestId = candidate;
        }
      }
      if (!identifiers.correlationId && normalized.includes('correlationid')) {
        const candidate = readIdentifier(value);
        if (candidate) {
          identifiers.correlationId = candidate;
        }
      }
      walk(value);
    });
  };

  walk(detail);

  if (typeof detail === 'string') {
    if (!identifiers.requestId) {
      const requestMatch = detail.match(/requestId[=:\" ]+([A-Za-z0-9\-_:]+)/i);
      if (requestMatch?.[1]) {
        identifiers.requestId = requestMatch[1];
      }
    }
    if (!identifiers.correlationId) {
      const correlationMatch = detail.match(/correlationId[=:\" ]+([A-Za-z0-9\-_:]+)/i);
      if (correlationMatch?.[1]) {
        identifiers.correlationId = correlationMatch[1];
      }
    }
  }

  return identifiers;
}

function inferTimelineTarget(event: ActivityEvent) {
  const detailText = detailToText(event.detail).toLowerCase();
  const combined = `${event.label.toLowerCase()} ${detailText}`;

  if (combined.includes('delegation') || combined.includes('nominee')) {
    return '/wallet/delegations';
  }
  if (event.service === 'wallet') {
    return '/wallet/ops';
  }
  if (event.service === 'fi') {
    return '/fi/queue';
  }
  if (event.service === 'issuer' || event.service === 'registry') {
    return '/command/scenario';
  }
  if (event.service === 'consent') {
    return '/command/scenario';
  }
  if (event.service === 'review') {
    return '/command/integrations';
  }
  if (event.service === 'ckyc') {
    return '/command/scenario';
  }
  return '/command/audit';
}

export default function CommandCenterPage() {
  const navigate = useNavigate();
  const {
    authenticated,
    activeWalletUsername,
    runningAction,
    tokenId,
    consentId,
    registrySnapshot,
    walletConsents,
    verificationResults,
    failures,
    coverage,
    resetCoverage,
    activities,
    lastRequestResponse,
    guided,
    loginWallet,
    issueToken,
    requestConsent,
    revokeToken,
    verifyExpectedFailure,
    runCkycSupersede,
    runReviewOnce,
    addNomineeDelegation,
    loadCkycProfile,
    startGuidedWalkthrough,
    resumeGuidedWalkthrough,
  } = useConsole();

  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [coverageExpanded, setCoverageExpanded] = useState(false);
  const [timelineServiceFilter, setTimelineServiceFilter] = useState<TimelineServiceFilter>('all');
  const [timelineSearch, setTimelineSearch] = useState('');
  const [workflowStatus, setWorkflowStatus] = useState<string | null>(null);
  const [runningWorkflowId, setRunningWorkflowId] = useState<WorkflowId | null>(null);
  const [selectedGuidedStep, setSelectedGuidedStep] = useState<string | null>(null);
  const [healthByService, setHealthByService] = useState<Record<HealthServiceId, HealthState>>(() => createHealthState());
  const [checkingByService, setCheckingByService] = useState<Record<HealthServiceId, boolean>>(() => createHealthDetailState(false));
  const [testingIntegration, setTestingIntegration] = useState<'ckyc' | null>(null);
  const [onboardingWalletUserId, setOnboardingWalletUserId] = useState(WALLET_OWNER_USER_ID);
  const [onboardingCkycReference, setOnboardingCkycReference] = useState('');
  const [onboardingNotes, setOnboardingNotes] = useState('');
  const [fetchingCkycPreview, setFetchingCkycPreview] = useState(false);
  const [issuingAndActivatingToken, setIssuingAndActivatingToken] = useState(false);
  const [onboardingInfo, setOnboardingInfo] = useState<string | null>(null);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [ckycPreview, setCkycPreview] = useState<CkycPreviewState | null>(null);
  const [onboardingResult, setOnboardingResult] = useState<OnboardingResult | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const verifiedToday = verificationResults.filter((entry) => entry.at.startsWith(today)).length;
  const ckycMode = ckycSandboxBaseUrl ? 'sandbox' : 'local';
  const issuerRequestTrace =
    lastRequestResponse && lastRequestResponse.path.includes('/v1/issuer/kyc/issue')
      ? parseTraceInfo(lastRequestResponse.responseBody)
      : { requestId: null, correlationId: null };

  const consentCounts =
    walletConsents.length > 0
      ? {
          pending: walletConsents.filter((item) => String(item.status ?? '').toUpperCase() === 'PENDING').length,
          approved: walletConsents.filter((item) => String(item.status ?? '').toUpperCase() === 'APPROVED').length,
          rejected: walletConsents.filter((item) => String(item.status ?? '').toUpperCase() === 'REJECTED').length,
        }
      : null;

  const totalRequests = activities.length;
  const failuresCount = failures.length;
  const successCount = Math.max(totalRequests - failuresCount, 0);
  const successPct = totalRequests > 0 ? `${Math.round((successCount / totalRequests) * 100)}%` : '-';
  const totalConsents = walletConsents.length;

  const completedCoverage = coverageRows.filter((item) => coverage[item.key]).length;
  const coverageByKey = useMemo(() => new Map(coverageRows.map((row) => [row.key, row])), []);
  const groupedCoverageRows = useMemo(
    () =>
      coverageGroups.map((group) => ({
        title: group.title,
        rows: group.keys
          .map((key) => coverageByKey.get(key))
          .filter((row): row is CoverageRow => Boolean(row)),
      })),
    [coverageByKey]
  );

  const selectedHint =
    (selectedGuidedStep ? guidedStepHintsByLabel[selectedGuidedStep] : null) ??
    guidedStepHintsByLabel[guided.steps[Math.min(guided.stepIndex, guided.steps.length - 1)] ?? ''];

  const navigateToTarget = useCallback(
    (target: string) => {
      if (!target) return;
      navigate(target);
    },
    [navigate]
  );

  const checkServiceHealth = useCallback(async (target: HealthTarget): Promise<HealthState> => {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(target.url, { method: 'GET', cache: 'no-store', signal: controller.signal });
      const latencyMs = Math.max(Math.round(performance.now() - startedAt), 0);

      if (response.ok) {
        return { status: 'ok', checkedAt: new Date().toISOString(), latencyMs };
      }

      return { status: 'down', checkedAt: new Date().toISOString(), latencyMs, error: `HTTP ${response.status}` };
    } catch (error) {
      return {
        status: 'unknown',
        checkedAt: new Date().toISOString(),
        latencyMs: Math.max(Math.round(performance.now() - startedAt), 0),
        error: error instanceof Error ? error.message : 'Request failed',
      };
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  const recheckService = useCallback(
    async (serviceId: HealthServiceId) => {
      const target = HEALTH_TARGETS.find((item) => item.id === serviceId);
      if (!target) return;

      setCheckingByService((previous) => ({ ...previous, [serviceId]: true }));
      const next = await checkServiceHealth(target);
      setHealthByService((previous) => ({ ...previous, [serviceId]: next }));
      setCheckingByService((previous) => ({ ...previous, [serviceId]: false }));
    },
    [checkServiceHealth]
  );

  const recheckAllServices = useCallback(async () => {
    setCheckingByService(createHealthDetailState(true));
    const results = await Promise.all(HEALTH_TARGETS.map(async (target) => [target.id, await checkServiceHealth(target)] as const));

    setHealthByService((previous) => {
      const next = { ...previous };
      results.forEach(([id, result]) => {
        next[id] = result;
      });
      return next;
    });
    setCheckingByService(createHealthDetailState(false));
  }, [checkServiceHealth]);

  useEffect(() => {
    void recheckAllServices();
    const intervalId = window.setInterval(() => void recheckAllServices(), 10_000);
    return () => window.clearInterval(intervalId);
  }, [recheckAllServices]);

  const runIntegrationTest = useCallback(async () => {
    setTestingIntegration('ckyc');
    await recheckService('ckyc');
    setTestingIntegration(null);
  }, [recheckService]);

  const fetchCkycPreview = useCallback(async () => {
    setOnboardingError(null);
    setOnboardingInfo(null);
    setFetchingCkycPreview(true);

    try {
      const targetWalletUserId = onboardingWalletUserId.trim();
      if (!targetWalletUserId) {
        setOnboardingError('Wallet user ID is required before fetching CKYCR.');
        return;
      }
      await recheckService('ckyc');
      const profile = await loadCkycProfile(targetWalletUserId);
      const reference = onboardingCkycReference.trim() || `ckyc-${targetWalletUserId}`;
      const source = ckycMode;
      const payloadAddress = readIdentifier(profile.payload.addressLine1 ?? profile.payload.address ?? profile.payload.streetAddress);
      const payloadPincode = readIdentifier(profile.payload.pincode ?? profile.payload.postalCode);
      setCkycPreview({
        source,
        reference,
        profile,
        fetchedAt: new Date().toISOString(),
        summary:
          payloadAddress || payloadPincode
            ? `CKYCR profile loaded with address data (${payloadAddress ?? 'address unavailable'}).`
            : 'CKYCR profile loaded. Address fields are not available in payload.',
      });
      setOnboardingInfo(
        source === 'sandbox'
          ? `CKYCR fetch completed for ${targetWalletUserId} (profile v${profile.profileVersion}).`
          : `CKYCR fetch completed in local adapter mode for ${targetWalletUserId} (profile v${profile.profileVersion}).`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch CKYCR preview.';
      if (message.includes('(404)') || message.toLowerCase().includes('not_found')) {
        setOnboardingError(
          `No CKYCR profile found for ${onboardingWalletUserId.trim() || 'this wallet user'}. Seed CKYCR data or switch to a user with profile data.`
        );
      } else {
        setOnboardingError(message);
      }
    } finally {
      setFetchingCkycPreview(false);
    }
  }, [ckycMode, loadCkycProfile, onboardingCkycReference, onboardingWalletUserId, recheckService]);

  const issueAndActivateToken = useCallback(async () => {
    setOnboardingError(null);
    setOnboardingInfo(null);
    setIssuingAndActivatingToken(true);

    try {
      const targetWalletUserId = onboardingWalletUserId.trim();
      if (!targetWalletUserId) {
        setOnboardingError('Wallet user ID is required before issuing token.');
        return;
      }

      const previewForTarget = ckycPreview?.profile?.userId === targetWalletUserId ? ckycPreview : null;
      const profilePayload = previewForTarget?.profile.payload ?? {};

      await issueToken({
        userId: targetWalletUserId,
        ckycReference: onboardingCkycReference.trim() || previewForTarget?.reference || undefined,
        kycOverride: {
          fullName: readIdentifier(profilePayload.fullName ?? profilePayload.name) ?? undefined,
          dob: readIdentifier(profilePayload.dob) ?? undefined,
          idNumber: targetWalletUserId,
          email: readIdentifier(profilePayload.email) ?? undefined,
          phone: readIdentifier(profilePayload.phone) ?? undefined,
          addressLine1:
            readIdentifier(profilePayload.addressLine1 ?? profilePayload.address ?? profilePayload.streetAddress) ??
            undefined,
          pincode: readIdentifier(profilePayload.pincode ?? profilePayload.postalCode) ?? undefined,
        },
      });
      await Promise.allSettled([recheckService('issuer'), recheckService('registry')]);
      setOnboardingInfo(
        `Issuer token issuance submitted for ${targetWalletUserId}. Registry should now show ACTIVE token.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Token issuance failed.';
      setOnboardingError(message);
    } finally {
      setIssuingAndActivatingToken(false);
    }
  }, [ckycPreview, issueToken, onboardingCkycReference, onboardingWalletUserId, recheckService]);

  useEffect(() => {
    if (!tokenId) {
      return;
    }
    setOnboardingResult({
      walletUserId: onboardingWalletUserId.trim() || WALLET_OWNER_USER_ID,
      ckycReference: onboardingCkycReference.trim() || ckycPreview?.reference || null,
      tokenId,
      tokenStatus: String(registrySnapshot?.status ?? 'ACTIVE').toUpperCase(),
      tokenExpiresAt: typeof registrySnapshot?.expiresAt === 'string' ? registrySnapshot.expiresAt : null,
      requestId: issuerRequestTrace.requestId,
      correlationId: issuerRequestTrace.correlationId,
      issuedAt: new Date().toISOString(),
    });
  }, [
    onboardingCkycReference,
    ckycPreview?.reference,
    onboardingWalletUserId,
    issuerRequestTrace.correlationId,
    issuerRequestTrace.requestId,
    registrySnapshot?.expiresAt,
    registrySnapshot?.status,
    tokenId,
  ]);

  const demoBypassWalletLogin = DEMO_BYPASS_WALLET_LOGIN;

  const runnerPill = useMemo(() => {
    if (guided.runnerStatus === 'running') return { status: 'warn' as const, label: 'Workflow running' };
    if (guided.runnerStatus === 'paused_waiting_login') {
      return demoBypassWalletLogin
        ? ({ status: 'neutral' as const, label: 'Demo mode: login optional' })
        : ({ status: 'error' as const, label: 'Action needed' });
    }
    if (guided.runnerStatus === 'done') return { status: 'ok' as const, label: 'Workflow complete' };
    if (guided.runnerStatus === 'error') return { status: 'error' as const, label: 'Workflow error' };
    return { status: 'neutral' as const, label: 'Ready' };
  }, [demoBypassWalletLogin, guided.runnerStatus]);

  const healthyCount = useMemo(
    () => Object.values(healthByService).filter((item) => item.status === 'ok').length,
    [healthByService]
  );
  const isAnyServiceCheckRunning = useMemo(
    () => Object.values(checkingByService).some((value) => value),
    [checkingByService]
  );

  const timelineRows = useMemo(() => {
    const sorted = [...activities].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
    const filteredByService = sorted.filter((event) => {
      if (timelineServiceFilter === 'all') {
        return true;
      }
      return event.service === timelineServiceFilter;
    });

    const search = timelineSearch.trim().toLowerCase();
    return filteredByService
      .map((event) => {
        const identifiers = extractIdentifiersFromDetail(event.detail);
        const detailText = detailToText(event.detail);
        return { event, identifiers, detailText };
      })
      .filter((row) => {
        if (!search) {
          return true;
        }
        const haystack = [
          row.event.label,
          row.event.service,
          row.detailText,
          row.identifiers.tokenId,
          row.identifiers.consentId,
          row.identifiers.requestId,
          row.identifiers.correlationId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });
  }, [activities, timelineSearch, timelineServiceFilter]);

  const runWorkflow = useCallback(
    async (workflowId: WorkflowId) => {
      setWorkflowStatus(null);
      setRunningWorkflowId(workflowId);
      try {
        if (workflowId === 'token_lifecycle') {
          await issueToken();
          setWorkflowStatus('Token lifecycle run completed.');
        } else if (workflowId === 'consent_approval_verify') {
          await requestConsent();
          setWorkflowStatus('Consent request submitted. Continue in Wallet Portal to approve, then verify in FI Portal.');
        } else if (workflowId === 'revocation_expected_fail') {
          await revokeToken();
          await verifyExpectedFailure('TOKEN_NOT_ACTIVE');
          setWorkflowStatus('Revocation and expected verification failure completed.');
        } else if (workflowId === 'ckyc_supersede') {
          await runCkycSupersede();
          setWorkflowStatus('CKYCR supersede workflow completed.');
        } else if (workflowId === 'periodic_review') {
          await runReviewOnce(today);
          setWorkflowStatus('Periodic review workflow completed.');
        } else if (workflowId === 'delegation') {
          await addNomineeDelegation();
          setWorkflowStatus('Delegation workflow started. Continue approval from Wallet Portal.');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Workflow action failed.';
        const authRequired =
          message.toLowerCase().includes('authorization_required') ||
          message.toLowerCase().includes('login') ||
          message.toLowerCase().includes('auth');
        setWorkflowStatus(authRequired ? `Authentication required: ${message}` : `Workflow failed: ${message}`);
      } finally {
        setRunningWorkflowId(null);
      }
    },
    [addNomineeDelegation, issueToken, requestConsent, revokeToken, runCkycSupersede, runReviewOnce, today, verifyExpectedFailure]
  );

  const workflowCards: Array<{
    id: WorkflowId;
    title: string;
    summary: string;
    target: string;
  }> = [
    {
      id: 'token_lifecycle',
      title: 'Token lifecycle',
      summary: 'Issue token and validate registry lifecycle status.',
      target: '/command/scenario',
    },
    {
      id: 'consent_approval_verify',
      title: 'Consent request -> approval -> verify',
      summary: 'Create consent request, approve in Wallet, and verify in FI.',
      target: '/fi/queue',
    },
    {
      id: 'revocation_expected_fail',
      title: 'Revocation + expected fail',
      summary: 'Revoke token and run expected verification failure.',
      target: '/command/scenario',
    },
    {
      id: 'ckyc_supersede',
      title: 'CKYCR supersede',
      summary: 'Run CKYCR supersede and validate replacement token evidence.',
      target: '/command/scenario',
    },
    {
      id: 'periodic_review',
      title: 'Periodic review',
      summary: 'Execute review scheduler run and inspect due-user actions.',
      target: '/command/integrations',
    },
    {
      id: 'delegation',
      title: 'Delegation scenario',
      summary: 'Create nominee delegation and continue nominee approval flow.',
      target: '/wallet/delegation',
    },
  ];

  return (
    <div className="space-y-5">
      <PortalPageHeader
        title="Bharat KYC T - Command Centre"
        subtitle="Operational visibility across services, consents, verification, and audit."
        environmentLabel={(import.meta.env.MODE ?? 'local').toLowerCase() === 'production' ? 'Sandbox' : 'Local'}
        lastRefreshAt={activities[0]?.at ?? null}
        badges={
          <>
            <StatusPill status={runnerPill.status} label={runnerPill.label} />
            <StatusPill status="ok" label="Auth: Keycloak" />
            <StatusPill status={authenticated ? 'ok' : 'warn'} label={authenticated ? `Wallet: ${displayWalletIdentity(activeWalletUsername, 'logged in')}` : 'Wallet: signed out'} />
          </>
        }
      />
      <ConsoleCard id="overview" className="border-slate-200/90 bg-[linear-gradient(140deg,rgba(255,255,255,0.98),rgba(248,250,252,0.93))]">
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-sm font-semibold text-slate-900">Current identifiers</p>
          <div className="mt-1 grid gap-1 text-xs text-slate-700 sm:grid-cols-2">
            <CopyValueField label="tokenId" value={tokenId} />
            <CopyValueField label="consentId" value={consentId} />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs text-slate-500">
            Wallet: {authenticated ? displayWalletIdentity(activeWalletUsername, 'logged in') : 'not logged in'}
          </div>
          <div className="text-xs text-slate-500">Registry token status: {registrySnapshot?.status ?? '-'}</div>
        </div>
      </ConsoleCard>

      <ConsoleCard id="issuer-onboarding" className="border-slate-200/90 bg-[linear-gradient(140deg,rgba(255,255,255,0.98),rgba(248,250,252,0.93))]">
        <SectionHeader
          title="Onboard Customer (Issuer)"
          subtitle="Issuer-led onboarding: fetch CKYCR record and issue an ACTIVE token before FI consent requests."
          action={<StatusPill status={ckycMode === 'sandbox' ? 'warn' : 'neutral'} label={ckycMode === 'sandbox' ? 'CKYCR: Sandbox' : 'CKYCR: Local adapter'} />}
        />
        <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="kyc-form-field block">
              Wallet user ID
              <input
                type="text"
                value={onboardingWalletUserId}
                onChange={(event) => setOnboardingWalletUserId(event.target.value)}
                placeholder={WALLET_OWNER_USER_ID}
                className="mt-1 kyc-form-input kyc-form-input-sm"
              />
            </label>
            <label className="kyc-form-field block">
              CKYC reference
              <input
                type="text"
                value={onboardingCkycReference}
                onChange={(event) => setOnboardingCkycReference(event.target.value)}
                placeholder="CKYC reference"
                className="mt-1 kyc-form-input kyc-form-input-sm"
              />
            </label>
            <label className="kyc-form-field block">
              Notes (optional)
              <input
                type="text"
                value={onboardingNotes}
                onChange={(event) => setOnboardingNotes(event.target.value)}
                placeholder="Onboarding context for operations log"
                className="mt-1 kyc-form-input kyc-form-input-sm"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <ConsoleButton
                type="button"
                intent="secondary"
                onClick={() => void fetchCkycPreview()}
                disabled={fetchingCkycPreview || issuingAndActivatingToken}
              >
                {fetchingCkycPreview ? 'Fetching CKYCR...' : 'Fetch CKYCR'}
              </ConsoleButton>
              <ConsoleButton
                type="button"
                intent="primary"
                onClick={() => void issueAndActivateToken()}
                disabled={fetchingCkycPreview || issuingAndActivatingToken}
              >
                <ShieldCheck className="h-4 w-4" />
                {issuingAndActivatingToken ? 'Issuing token...' : 'Issue & Activate Token'}
              </ConsoleButton>
              <Link
                to="/fi/queue"
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Open FI Portal
              </Link>
            </div>
            <p className="text-xs text-slate-500">
              Fetch CKYCR first to prefill onboarding evidence, then issue and activate token for the selected wallet user.
            </p>
            {onboardingInfo ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">{onboardingInfo}</div>
            ) : null}
            {onboardingError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900">{onboardingError}</div>
            ) : null}
          </div>

          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Issuer evidence</p>
            {ckycPreview ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                <p className="font-semibold text-slate-900">CKYCR preview</p>
                <p className="mt-1">source: {ckycPreview.source}</p>
                <p>reference: {ckycPreview.reference}</p>
                <p>fetchedAt: {formatDateTime(ckycPreview.fetchedAt)}</p>
                <p>userId: {ckycPreview.profile.userId}</p>
                <p>profileVersion: {ckycPreview.profile.profileVersion}</p>
                <CopyValueField label="ckycHash" value={ckycPreview.profile.hash} />
                <p>addressLine1: {readIdentifier(ckycPreview.profile.payload.addressLine1) ?? '-'}</p>
                <p>pincode: {readIdentifier(ckycPreview.profile.payload.pincode) ?? '-'}</p>
                <p className="mt-1">{ckycPreview.summary}</p>
              </div>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                Fetch CKYCR to preview onboarding evidence.
              </p>
            )}

            {onboardingResult ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                <p className="font-semibold text-slate-900">Issue and activate result</p>
                <p className="mt-1">walletUserId: {onboardingResult.walletUserId}</p>
                <p>ckycReference: {onboardingResult.ckycReference ?? '-'}</p>
                <p>tokenStatus: {onboardingResult.tokenStatus}</p>
                <p>issuedAt: {formatDateTime(onboardingResult.issuedAt)}</p>
                {onboardingNotes.trim().length > 0 ? <p>notes: {onboardingNotes.trim()}</p> : null}
                <div className="mt-2 space-y-1">
                  <CopyValueField label="tokenId" value={onboardingResult.tokenId} />
                  <CopyValueField label="requestId" value={onboardingResult.requestId} />
                  <CopyValueField label="correlationId" value={onboardingResult.correlationId} />
                </div>
                <p className="mt-1">expiry: {formatDateTime(onboardingResult.tokenExpiresAt)}</p>
                <Link
                  to="/wallet/ops"
                  className="mt-2 inline-flex items-center text-xs font-semibold text-slate-700 hover:underline"
                >
                  Open Wallet Portal <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                Issue token to capture ACTIVE registry evidence for FI pre-check.
              </p>
            )}
          </div>
        </div>
      </ConsoleCard>

      <div className="grid gap-4 xl:grid-cols-[0.92fr_1.16fr_0.92fr]">
        <ConsoleCard className="xl:order-3 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,250,251,0.94))]">
          <SectionHeader
            title="Workflow Runs"
            subtitle="Run operational workflows with clear step status."
            action={<StatusPill status={runnerPill.status} label={runnerPill.label} />}
          />

          <div className="grid gap-2 md:grid-cols-2">
            <ConsoleButton onClick={() => void startGuidedWalkthrough()} disabled={runningAction !== null || guided.running}>
              <PlayCircle className="h-4 w-4" />
              Run full workflow
            </ConsoleButton>

            <ConsoleButton intent={authenticated ? 'secondary' : 'primary'} onClick={() => void loginWallet()} disabled={runningAction !== null || authenticated}>
              {authenticated ? `Wallet: ${displayWalletIdentity(activeWalletUsername)}` : 'Authenticate wallet'}
            </ConsoleButton>

            <ConsoleButton intent="secondary" onClick={() => navigateToTarget('/command/audit')} disabled={runningAction !== null}>
              Open Audit
            </ConsoleButton>
          </div>

          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <ConsoleButton intent="secondary" onClick={() => setWalkthroughOpen(true)} disabled={runningAction !== null}>
              Open workflow progress
            </ConsoleButton>
            <ConsoleButton intent="secondary" onClick={() => void resumeGuidedWalkthrough()} disabled={runningAction !== null || guided.running || !guided.blockedReason}>
              Resume workflow
            </ConsoleButton>
          </div>

          {guided.blockedReason ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">Authentication required</p>
              <p className="mt-1">{guided.blockedReason}</p>
              <Link to="/wallet/ops" className="mt-2 inline-flex items-center text-sm font-semibold hover:underline">
                Go to Wallet Ops <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow run progress</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {guided.steps.map((step, index) => {
                const done = index < guided.stepIndex;
                const active = index === guided.stepIndex && (guided.running || guided.blockedReason !== null);
                const hint = guidedStepHintsByLabel[step];
                return (
                  <button
                    key={step}
                    type="button"
                    onClick={() => {
                      setSelectedGuidedStep(step);
                      if (hint) navigateToTarget(hint.target);
                    }}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${
                      done
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : active
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : 'border-slate-200 bg-slate-100 text-slate-600'
                    }`}
                  >
                    {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                    {formatWorkflowStepLabel(step)}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <p className="font-semibold text-slate-900">Expected outcome</p>
              <p className="mt-1">{selectedHint?.expected ?? 'Select a step to jump and view its expected outcome.'}</p>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {workflowCards.map((workflow) => (
              <div key={workflow.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-900">{workflow.title}</p>
                <p className="mt-1 text-xs text-slate-600">{workflow.summary}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <ConsoleButton
                    intent="secondary"
                    size="sm"
                    onClick={() => void runWorkflow(workflow.id)}
                    disabled={runningAction !== null || runningWorkflowId !== null}
                  >
                    {runningWorkflowId === workflow.id ? 'Running...' : 'Run workflow'}
                  </ConsoleButton>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline"
                    onClick={() => navigateToTarget(workflow.target)}
                  >
                    Open detail <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {workflowStatus ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{workflowStatus}</div>
          ) : null}
        </ConsoleCard>

        <ConsoleCard className="xl:order-2 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
          <SectionHeader title="Audit Trail & Unified Timeline" subtitle="Filter by service and search using key identifiers." />

          <div className="flex flex-wrap items-center gap-2">
            {TIMELINE_SERVICE_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setTimelineServiceFilter(filter.id)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                  timelineServiceFilter === filter.id
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {filter.label}
              </button>
            ))}
            <input
              type="text"
              value={timelineSearch}
              onChange={(event) => setTimelineSearch(event.target.value)}
              className="kyc-form-input kyc-form-input-sm ml-auto w-full md:w-80"
              placeholder="Search tokenId / consentId / requestId / correlationId"
            />
          </div>

          <div className="mt-3 max-h-[64vh] space-y-2 overflow-auto pr-1">
            {timelineRows.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No matching activity events.</div>
            ) : (
              timelineRows.map(({ event, identifiers, detailText }) => (
                <div key={event.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusPill
                        status={event.status === 'success' ? 'ok' : event.status === 'failed' ? 'error' : 'neutral'}
                        label={event.service}
                      />
                      <p className="text-sm font-semibold text-slate-900">{event.label}</p>
                    </div>
                    <p className="text-xs text-slate-500">{formatDateTime(event.at)}</p>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-700">
                    {identifiers.tokenId ? <CopyValueField label="tokenId" value={identifiers.tokenId} /> : null}
                    {identifiers.consentId ? <CopyValueField label="consentId" value={identifiers.consentId} /> : null}
                    {identifiers.requestId ? <CopyValueField label="requestId" value={identifiers.requestId} /> : null}
                    {identifiers.correlationId ? <CopyValueField label="correlationId" value={identifiers.correlationId} /> : null}
                    {detailText ? <p className="text-slate-600">{detailText}</p> : null}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline"
                      onClick={() => navigateToTarget(inferTimelineTarget(event))}
                    >
                      Open related view <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    <CopyValueField label="eventId" value={event.id} />
                  </div>
                </div>
              ))
            )}
          </div>
        </ConsoleCard>

        <ConsoleCard className="xl:order-1 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
          <SectionHeader
            title="Overall Insights & Health"
            subtitle="KPIs, service health, and integration snapshot."
            action={
              <ConsoleButton intent="secondary" size="sm" onClick={() => void recheckAllServices()} disabled={isAnyServiceCheckRunning}>
                <RefreshCw className="h-3.5 w-3.5" />
                {isAnyServiceCheckRunning ? 'Checking...' : 'Refresh'}
              </ConsoleButton>
            }
          />

          <div className="grid gap-2 sm:grid-cols-2">
            <KpiCard title="Total requests" value={totalRequests} hint="session events" onClick={() => navigateToTarget('/command/audit')} />
            <KpiCard title="Success %" value={successPct} hint={`${successCount}/${totalRequests || 0} successful`} onClick={() => navigateToTarget('/command/audit')} />
            <KpiCard title="Failures" value={failuresCount} hint="errors + expected failures" onClick={() => navigateToTarget('/command/audit')} />
            <KpiCard title="Verifications today" value={verifiedToday} hint="all verification attempts" onClick={() => navigateToTarget('/fi/queue')} />
            <KpiCard title="Total consents" value={totalConsents} hint="wallet consent records" onClick={() => navigateToTarget('/wallet/ops')} />
            <KpiCard
              title="P/A/R"
              value={consentCounts ? `${consentCounts.pending}/${consentCounts.approved}/${consentCounts.rejected}` : '-/-/-'}
              hint="pending / approved / rejected"
              onClick={() => navigateToTarget('/wallet/ops')}
            />
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Services health table</p>
            <p className="mt-1 text-xs text-slate-600">
              Healthy: {healthyCount}/{HEALTH_TARGETS.length}
            </p>
            <div className="mt-2 space-y-2">
              {HEALTH_TARGETS.map((target) => {
                const health = healthByService[target.id];
                const pill = healthStatusPill[health.status];
                return (
                  <div key={target.id} className="rounded-lg border border-slate-200 bg-white px-2 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-900">{target.label}</p>
                      <StatusPill status={pill.status} label={pill.label} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{health.checkedAt ? formatDateTime(health.checkedAt) : 'Not checked yet'}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">CKYCR</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <StatusPill status={ckycSandboxBaseUrl ? 'warn' : 'neutral'} label={ckycSandboxBaseUrl ? 'Sandbox' : 'Local adapter'} />
              <ConsoleButton intent="secondary" size="sm" onClick={() => void runIntegrationTest()} disabled={testingIntegration === 'ckyc'}>
                {testingIntegration === 'ckyc' ? 'Testing...' : 'Test'}
              </ConsoleButton>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Last health: {healthStatusPill[healthByService.ckyc.status].label}
              {healthByService.ckyc.error ? ` (${healthByService.ckyc.error})` : ''}
            </p>
          </div>

          <div className="mt-3">
            <EvidencePanel title="Latest API Evidence" />
          </div>
        </ConsoleCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ConsoleCard id="integrations-status" className="xl:col-start-3 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
          <SectionHeader title="Integration Status" subtitle="Configuration + quick tests" />
          <div className="space-y-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid gap-1 text-xs text-slate-500 md:grid-cols-[1fr_auto_auto_auto]">
                <span>Integration</span>
                <span>Mode</span>
                <span>Configured</span>
                <span>Test</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                <div>
                  <p className="text-sm font-semibold text-slate-900">CKYCR</p>
                  <p className="text-xs text-slate-500">
                    {ckycSandboxBaseUrl ? `Sandbox: ${truncate(ckycSandboxBaseUrl, 40)}` : 'Using local CKYCR adapter'}
                  </p>
                </div>
                <StatusPill status={ckycSandboxBaseUrl ? 'warn' : 'neutral'} label={ckycSandboxBaseUrl ? 'Sandbox' : 'Local adapter'} />
                <StatusPill status={ckycSandboxBaseUrl ? 'ok' : 'neutral'} label={ckycSandboxBaseUrl ? 'Yes' : 'No'} />
                <ConsoleButton intent="secondary" size="sm" onClick={() => void runIntegrationTest()} disabled={testingIntegration === 'ckyc'}>
                  {testingIntegration === 'ckyc' ? 'Testing...' : 'Test'}
                </ConsoleButton>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                Last health: {healthStatusPill[healthByService.ckyc.status].label}
                {healthByService.ckyc.error ? ` (${healthByService.ckyc.error})` : ''}
              </p>
              <Link to="/command/integrations" className="mt-2 inline-flex items-center text-xs font-semibold text-slate-700 hover:underline">
                Open Integrations <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Aadhaar</p>
                  <p className="text-xs text-slate-500">Connector is currently configured for local adapter mode.</p>
                </div>
                <StatusPill status="neutral" label="Local adapter" />
                <StatusPill status="ok" label="Yes" />
                <ConsoleButton intent="ghost" size="sm" disabled>
                  N/A
                </ConsoleButton>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                <div>
                  <p className="text-sm font-semibold text-slate-900">DigiLocker</p>
                  <p className="text-xs text-slate-500">Connector is currently configured for local adapter mode.</p>
                </div>
                <StatusPill status="neutral" label="Local adapter" />
                <StatusPill status="ok" label="Yes" />
                <ConsoleButton intent="ghost" size="sm" disabled>
                  N/A
                </ConsoleButton>
              </div>
            </div>
          </div>
        </ConsoleCard>
        <ConsoleCard className="xl:col-span-2 xl:col-start-1 xl:row-start-1 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
        <SectionHeader
          title="Feature Coverage Checklist"
          subtitle={`Completed ${completedCoverage}/${coverageRows.length} in this session.`}
          action={
            <div className="flex items-center gap-2">
              <ConsoleButton intent="secondary" size="sm" onClick={() => setCoverageExpanded((previous) => !previous)}>
                {coverageExpanded ? 'Collapse' : 'Expand'}
              </ConsoleButton>
              <ConsoleButton intent="secondary" size="sm" onClick={resetCoverage}>
                Reset marks
              </ConsoleButton>
            </div>
          }
        />
        {coverageExpanded ? (
          <div className="space-y-4">
            {groupedCoverageRows.map((group) => (
              <div key={group.title}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.title}</p>
                <div className="space-y-2">
                  {group.rows.map((item) => {
                    const done = coverage[item.key];
                    return (
                      <div key={item.key} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="flex items-center gap-2 text-sm">
                          {done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-slate-400" />}
                          <span className={done ? 'text-slate-900' : 'text-slate-700'}>{item.label}</span>
                        </div>
                        <Link to={item.goTo} className="inline-flex items-center text-xs font-semibold text-slate-600 hover:text-slate-900">
                          View <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-600">Coverage checklist collapsed.</p>
        )}
        </ConsoleCard>
      </div>

      <GuidedWalkthroughPanel
        open={walkthroughOpen}
        onClose={() => setWalkthroughOpen(false)}
        busy={runningAction !== null}
        guided={guided}
        onStart={startGuidedWalkthrough}
        onResume={resumeGuidedWalkthrough}
      />
    </div>
  );
}
