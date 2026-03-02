import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, routeFor } from '../lib/config';
import {
  clearFiDirectGrantSession,
  clearWalletDirectGrantSession,
  fiKeycloak,
  getFiAccessToken,
  getFiDirectGrantSession,
  getWalletAccessToken,
  getWalletDirectGrantSession,
  initFiKeycloak,
  initWalletKeycloak,
  loginWithPasswordGrant,
  walletKeycloak,
} from '../lib/keycloak';
import { getWalletAuthSnapshot } from './hooks/useWalletAuth';
import {
  FI2_CLIENT_ID,
  FI_ANALYST_1_USERNAME,
  FI_ANALYST_2_USERNAME,
  FI_CLIENT_ID,
  WALLET_NOMINEE_USERNAME,
  WALLET_OWNER_USER_ID,
  WALLET_OWNER_USERNAME,
  WALLET_SECONDARY_USERNAME,
} from './identityConfig';
import { DEMO_BYPASS_WALLET_LOGIN } from './portalFlags';
import type {
  ActivityEvent,
  ApiLogEntry,
  CoverageKey,
  CoverageState,
  CkycProfileResponse,
  CkycSyncResponse,
  DelegationRecord,
  NomineeRecord,
  FailureEntry,
  FlashMessage,
  GuidedWalkthroughState,
  RegistryAuditEvent,
  RegistrySnapshot,
  ReviewDueUser,
  ReviewRunOnceResponse,
  RunnerStatus,
  ServiceHealthRow,
  ServiceName,
  VerifySuccessResponse,
  LastRequestResponse,
  TokenCoverageResponse,
} from './types';

type ScenarioId = 'A' | 'B' | 'C' | 'D';

interface ScenarioPreset {
  id: ScenarioId;
  label: string;
  purpose: string;
  requestedFields: string[];
  description: string;
}

interface VerificationResult {
  id: string;
  at: string;
  mode: 'success' | 'expected_fail';
  fiId: string;
  tokenId?: string;
  consentId?: string;
  purpose?: string;
  errorCode?: string;
  disclosedClaims?: Record<string, unknown>;
}

interface Fi2ReuseResult {
  at: string;
  consentId: string;
  tokenBefore: string;
  tokenAfter: string;
  reused: boolean;
  purpose: string;
  requestedFields: string[];
}

interface WalletTokenView extends Record<string, unknown> {
  tokenId?: string;
  status?: string;
  version?: number;
  issuedAt?: string;
  expiresAt?: string;
}

interface WalletConsentView extends Record<string, unknown> {
  consentId?: string;
  tokenId?: string;
  status?: string;
  purpose?: string;
  requestedFields?: string[];
  assertionId?: string;
  fiId?: string;
  requiresDelegation?: boolean;
  allowReuseAcrossFIs?: boolean;
  createdAt?: string;
  expiresAt?: string;
}

type ApprovedFieldsInput = string[] | Record<string, boolean>;

function normalizeApprovedFields(input?: ApprovedFieldsInput): string[] | undefined {
  if (!input) {
    return undefined;
  }
  const fields = Array.isArray(input)
    ? input
    : Object.entries(input)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([field]) => field);
  const normalized = [...new Set(fields.map((field) => String(field).trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : [];
}

function readOptionalBoolean(input: unknown): boolean | undefined {
  if (typeof input === 'boolean') {
    return input;
  }
  return undefined;
}

function readStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

function collectTokenRoles(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const data = payload as Record<string, unknown>;
  const roles = new Set<string>();

  readStringArray((data.realm_access as Record<string, unknown> | undefined)?.roles).forEach((role) =>
    roles.add(role)
  );

  const resourceAccess = data.resource_access;
  if (resourceAccess && typeof resourceAccess === 'object' && !Array.isArray(resourceAccess)) {
    Object.values(resourceAccess).forEach((entry) => {
      readStringArray((entry as Record<string, unknown> | undefined)?.roles).forEach((role) => roles.add(role));
    });
  }

  if (typeof data.scope === 'string') {
    data.scope
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .forEach((scope) => roles.add(scope));
  }

  return [...roles];
}

function derivePortalRoles(payload: unknown, _username: string | null): {
  claims: string[];
  wallet: boolean;
  fi: boolean;
  admin: boolean;
} {
  const claims = collectTokenRoles(payload);
  const normalizedClaims = claims.map((value) => value.toLowerCase());
  const walletFromRoleClaim = normalizedClaims.some((role) => role === 'wallet_user' || role === 'wallet_nominee');
  const fiFromRoleClaim = normalizedClaims.some((role) => role === 'fi_user');
  const adminFromClaims = normalizedClaims.some((role) =>
    role === 'admin' || role === 'realm-admin' || role === 'command_admin' || role === 'platform_admin'
  );

  return {
    claims,
    wallet: walletFromRoleClaim,
    fi: fiFromRoleClaim,
    admin: adminFromClaims,
  };
}

function normalizeWalletConsentView(input: WalletConsentView): WalletConsentView {
  const rawConsentId = input.consentId ?? input.id;
  const consentId = typeof rawConsentId === 'string' && rawConsentId.trim().length > 0 ? rawConsentId : undefined;

  const rawAssertionId = input.assertionId ?? input.assertionJti ?? input.jti;
  const assertionId =
    typeof rawAssertionId === 'string' && rawAssertionId.trim().length > 0 ? rawAssertionId : undefined;

  const requestedFields = Array.isArray(input.requestedFields)
    ? input.requestedFields.map((field) => String(field))
    : Array.isArray(input.fields)
      ? input.fields.map((field) => String(field))
      : undefined;

  const fiId = typeof input.fiId === 'string' ? input.fiId : typeof input.requestedBy === 'string' ? input.requestedBy : undefined;
  const requiresDelegation = readOptionalBoolean(input.requiresDelegation ?? input.requires_delegation);
  const allowReuseAcrossFIs = readOptionalBoolean(input.allowReuseAcrossFIs ?? input.allow_reuse_across_fis);

  return {
    ...input,
    ...(consentId ? { consentId } : {}),
    ...(assertionId ? { assertionId } : {}),
    ...(requestedFields ? { requestedFields } : {}),
    ...(fiId ? { fiId } : {}),
    ...(typeof requiresDelegation === 'boolean' ? { requiresDelegation } : {}),
    ...(typeof allowReuseAcrossFIs === 'boolean' ? { allowReuseAcrossFIs } : {}),
  };
}

interface RenewConsentResponse {
  previousConsentId: string;
  newConsentId: string;
  tokenId: string;
  status: string;
  expiresAt: string;
  renewedFromConsentId?: string | null;
  purpose?: string;
  requestedFields?: string[];
}

interface GuidedRunnerStepResult {
  status: 'ok' | 'pause_waiting_login';
  detail?: string;
  requiredLoginUser?: string;
  stepId?: string;
}

type PortalRole = 'wallet' | 'fi' | 'admin';

interface IssueKycPayload {
  fullName: string;
  dob: string;
  idNumber: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  pincode?: string;
}

interface IssueTokenOptions {
  userId?: string;
  ttlSeconds?: number;
  ckycReference?: string;
  kycOverride?: Partial<IssueKycPayload>;
}

interface ConsoleContextValue {
  scenarioId: ScenarioId;
  scenario: ScenarioPreset;
  scenarios: ScenarioPreset[];
  setScenarioId: (value: ScenarioId) => void;
  runningAction: string | null;
  statusMessage: string;
  setStatusMessage: (value: string) => void;
  flashMessages: FlashMessage[];
  dismissFlashMessage: (id: string) => void;
  clearFlashMessages: () => void;
  authenticated: boolean;
  activeWalletUsername: string | null;
  fiAuthenticated: boolean;
  activeFiUsername: string | null;
  roleClaims: string[];
  walletRoleGranted: boolean;
  fiRoleGranted: boolean;
  adminRoleGranted: boolean;
  defaultPortalPath: string;
  tokenId: string | null;
  consentId: string | null;
  tokenJwt: string | null;
  assertionJwt: string | null;
  consentStatus: string | null;
  consentExpiresAt: string | null;
  registrySnapshot: RegistrySnapshot | null;
  registryAudit: RegistryAuditEvent[];
  delegations: DelegationRecord[];
  nominees: NomineeRecord[];
  ckycResult: CkycSyncResponse | null;
  dueUsers: ReviewDueUser[];
  reviewRun: ReviewRunOnceResponse | null;
  verificationResults: VerificationResult[];
  fi2ReuseResult: Fi2ReuseResult | null;
  walletTokens: WalletTokenView[];
  walletConsents: WalletConsentView[];
  lastRequestResponse: LastRequestResponse | null;
  activities: ActivityEvent[];
  apiLogs: ApiLogEntry[];
  failures: FailureEntry[];
  coverage: CoverageState;
  guided: GuidedWalkthroughState;
  serviceHealth: ServiceHealthRow[];
  resetCoverage: () => void;
  loginWallet: (usernameHint?: string, redirectPath?: string) => Promise<void>;
  loginWalletWithPassword: (username: string, password: string) => Promise<void>;
  logoutWallet: (redirectPath?: string) => Promise<void>;
  loginFi: (redirectPath?: string, usernameHint?: string) => Promise<void>;
  loginFiWithPassword: (username: string, password: string) => Promise<void>;
  logoutFi: (redirectPath?: string) => Promise<void>;
  issueToken: (options?: IssueTokenOptions) => Promise<void>;
  requestConsent: () => Promise<void>;
  requestConsentWith: (payload: {
    userId?: string;
    purpose: string;
    requestedFields: string[];
    fiId?: string;
    ttlSeconds?: number;
    requiresDelegation?: boolean;
    allowReuseAcrossFIs?: boolean;
  }) => Promise<void>;
  approveConsent: (
    targetConsentId?: string,
    approvedFields?: ApprovedFieldsInput,
    options?: {
      reason?: string;
      nomineeActor?: string;
    }
  ) => Promise<void>;
  rejectConsent: (targetConsentId?: string, reason?: string) => Promise<void>;
  revokeConsent: (targetConsentId?: string, reason?: string) => Promise<void>;
  verifyAssertionSuccess: () => Promise<void>;
  revokeToken: () => Promise<void>;
  verifyExpectedFailure: (expectedErrorCode: string) => Promise<void>;
  renewConsent: () => Promise<void>;
  revokeConsentFromFi: (targetConsentId?: string, reason?: string) => Promise<void>;
  runFi2Reuse: () => Promise<void>;
  addNomineeDelegation: (options?: {
    ownerUserId?: string;
    delegateUserId?: string;
    scope?: string;
    allowedPurposes?: string[];
    allowedFields?: string[];
    expiresAt?: string;
  }) => Promise<DelegationRecord>;
  revokeDelegation: (delegationId: string) => Promise<void>;
  refreshNominees: (targetUserId?: string) => Promise<void>;
  createNominee: (ownerUserId: string, nomineeUserId: string) => Promise<void>;
  setNomineeStatus: (ownerUserId: string, nomineeId: string, status: 'enable' | 'disable') => Promise<void>;
  refreshWalletTokens: (targetUserId?: string) => Promise<void>;
  renewWalletToken: (ttlSeconds?: number) => Promise<void>;
  refreshWalletConsents: (targetUserId?: string) => Promise<void>;
  refreshDelegations: (targetUserId?: string) => Promise<void>;
  checkActiveTokenForUser: (userId: string) => Promise<WalletTokenView | null>;
  onboardUserFromFi: (userId: string) => Promise<WalletTokenView | null>;
  refreshFiConsentBinding: (consentId: string) => Promise<WalletConsentView | null>;
  approveAsNominee: (targetConsentId?: string, approvedFields?: ApprovedFieldsInput) => Promise<void>;
  runCkycSupersede: () => Promise<void>;
  loadCkycProfile: (userId: string) => Promise<CkycProfileResponse>;
  loadDueUsers: (asOf: string) => Promise<void>;
  runReviewOnce: (asOf: string) => Promise<void>;
  walletReviewStatus: Record<string, unknown> | null;
  refreshWalletReviewStatus: () => Promise<void>;
  requestPeriodicReconsent: () => Promise<void>;
  fiTokenCoverage: TokenCoverageResponse | null;
  refreshFiTokenCoverage: () => Promise<void>;
  lifecycleJobs: Array<{ id: string; runAt: string; detail: unknown }>;
  refreshLifecycleJobs: () => Promise<void>;
  runLifecycleNow: () => Promise<void>;
  simulateDemoData: () => Promise<void>;
  refreshRegistryEvidence: (targetTokenId?: string) => Promise<void>;
  refreshServiceHealth: () => Promise<void>;
  startGuidedWalkthrough: () => Promise<void>;
  resumeGuidedWalkthrough: () => Promise<void>;
  stopGuidedWalkthrough: () => void;
}

class ApiCallError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown,
    public readonly errorCode: string
  ) {
    super(message);
    this.name = 'ApiCallError';
  }
}

const DEFAULT_KYC_PROFILE = {
  fullName: 'Ananya Rao',
  dob: '1995-01-12',
  idNumber: WALLET_OWNER_USER_ID,
  email: 'ananya@example.local',
  phone: '+919999999999',
};

function buildKycIdentityForUser(userId: string): IssueKycPayload {
  if (userId === DEFAULT_KYC_PROFILE.idNumber) {
    return { ...DEFAULT_KYC_PROFILE };
  }

  const safeLocalPart = userId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return {
    fullName: `KYC User ${userId}`,
    dob: '1990-01-01',
    idNumber: userId,
    email: `${safeLocalPart || 'wallet-user'}@example.local`,
    phone: '+919000000000',
  };
}

const DEFAULT_WALLET_OWNER = WALLET_OWNER_USERNAME;
const DEFAULT_WALLET_NOMINEE = WALLET_NOMINEE_USERNAME;

function classifyStatusMessageTone(message: string): FlashMessage['tone'] | null {
  const normalized = message.trim();
  if (!normalized || normalized === 'Ready') {
    return null;
  }
  if (normalized.endsWith('...')) {
    return null;
  }

  const lower = normalized.toLowerCase();
  if (
    lower.includes('failed') ||
    lower.includes('error') ||
    lower.includes('denied') ||
    lower.includes('required') ||
    lower.includes('unable') ||
    lower.includes('invalid') ||
    lower.includes('timed out') ||
    lower.includes('forbidden')
  ) {
    return 'error';
  }

  if (lower.includes('warning') || lower.includes('degraded')) {
    return 'info';
  }

  return 'success';
}

const SCENARIOS: ScenarioPreset[] = [
  {
    id: 'A',
    label: 'loan-underwriting',
    purpose: 'loan-underwriting',
    requestedFields: ['fullName', 'dob', 'idNumber', 'email'],
    description: 'Retail lending onboarding and underwriting verification.',
  },
  {
    id: 'B',
    label: 'insurance-claim',
    purpose: 'insurance-claim',
    requestedFields: ['fullName', 'dob', 'idNumber', 'phone'],
    description: 'Insurance claim KYC verification with selective disclosure.',
  },
  {
    id: 'C',
    label: 'investment-onboarding',
    purpose: 'investment-onboarding',
    requestedFields: ['fullName', 'dob', 'idNumber', 'email', 'phone'],
    description: 'Investment account onboarding and suitability checks.',
  },
  {
    id: 'D',
    label: 'sim-activation',
    purpose: 'sim-activation',
    requestedFields: ['fullName', 'dob', 'idNumber'],
    description: 'Telecom SIM activation verification flow.',
  },
];

const COVERAGE_STORAGE_KEY = 'bharat-kyc-t.console.coverage.v1';
const GUIDED_STORAGE_KEY = 'bharat-kyc-t.console.guided-suite.v1';
const DEFAULT_COVERAGE: CoverageState = {
  issueToken: false,
  requestConsent: false,
  walletApprove: false,
  fiVerifySuccess: false,
  revokeToken: false,
  postRevokeVerifyFailTokenNotActive: false,
  ckycSupersede: false,
  delegationNomineeApproval: false,
  periodicReview: false,
  auditChain: false,
  consentRejectedFail: false,
  consentExpiredThenRenew: false,
  crossInstitutionReuse: false,
  requestResponseInspector: false,
};

const SERVICE_HEALTH_ROWS: ServiceHealthRow[] = [
  { id: 'issuer', label: 'issuer-service', status: 'unknown' },
  { id: 'registry', label: 'registry-service', status: 'unknown' },
  { id: 'consent', label: 'consent-manager', status: 'unknown' },
  { id: 'wallet', label: 'wallet-service', status: 'unknown' },
  { id: 'fi', label: 'fi-service', status: 'unknown' },
  { id: 'ckyc', label: 'ckyc-adapter', status: 'unknown' },
  { id: 'review', label: 'review-scheduler', status: 'unknown' },
];

const GUIDED_STEPS = [
  'Issue Token',
  'FI Request Consent',
  'Wallet Approve (owner login required)',
  'FI Verify Success',
  'Revoke Token',
  'FI Verify expected fail TOKEN_NOT_ACTIVE',
  'CKYCR update and supersede',
  'Periodic review run once',
  'Add nominee delegation + create pending consent (owner)',
  'Login as nominee role',
  'Approve as nominee role',
];

const GUIDED_STEP_IDS = [
  'issue_token',
  'fi_request_consent',
  'wallet_approve',
  'fi_verify_success',
  'revoke_token',
  'fi_verify_expected_fail_token_not_active',
  'ckycr_update_supersede',
  'periodic_review_run_once',
  'delegation_add_nominee_create_pending_consent',
  'login_wallet_nominee',
  'nominee_approve',
] as const;

const GUIDED_STEP_LOGIN_USERS: Array<string | null> = [
  null,
  null,
  DEFAULT_WALLET_OWNER,
  null,
  null,
  null,
  null,
  null,
  DEFAULT_WALLET_OWNER,
  DEFAULT_WALLET_NOMINEE,
  DEFAULT_WALLET_NOMINEE,
];

const RUNNER_STATUS_VALUES: RunnerStatus[] = ['idle', 'running', 'paused_waiting_login', 'done', 'error'];

const DEFAULT_GUIDED_STATE: GuidedWalkthroughState = {
  running: false,
  stepIndex: 0,
  steps: GUIDED_STEPS,
  blockedReason: null,
  nextActionHint: null,
  runnerStatus: 'idle',
  requiredLoginUser: null,
  requiredLoginStepId: null,
};

function getGuidedStepId(stepIndex: number) {
  return GUIDED_STEP_IDS[stepIndex] ?? `guided_step_${stepIndex + 1}`;
}

function getGuidedRequiredLoginUser(stepIndex: number) {
  return GUIDED_STEP_LOGIN_USERS[stepIndex] ?? null;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isEnabled(raw: unknown) {
  if (typeof raw !== 'string') {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

const UI_API_DEBUG = isEnabled(import.meta.env.VITE_CONSOLE_DEBUG_LOGS);

function deriveServiceFromPath(path: string): ServiceName {
  const match = path.match(/\/api\/([^/?#]+)/i);
  const service = match?.[1];
  if (service === 'issuer' || service === 'registry' || service === 'consent' || service === 'wallet' || service === 'fi' || service === 'ckyc' || service === 'review') {
    return service;
  }
  return 'console';
}

function parseJsonString(input: string) {
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toFriendlyErrorMessage(input: {
  status: number;
  errorCode: string;
  fallbackMessage: string;
  payload: unknown;
}) {
  const code = input.errorCode.trim().toLowerCase();
  const fallback = input.fallbackMessage;

  if (code === 'network_error') {
    return 'Network error while calling backend service. Check containers and retry.';
  }
  if (code === 'login_required' || code === 'missing_bearer_token' || code === 'actor_user_not_resolved') {
    return 'Authentication required. Sign in and retry.';
  }
  if (code === 'owner_authorization_required') {
    return 'Owner authorization required. Login as wallet owner to continue.';
  }
  if (code === 'delegation_required') {
    return 'Delegation required for this action. Create/activate nominee delegation or use owner approval mode.';
  }
  if (code === 'allowed_purposes_required') {
    return 'Delegation must include at least one allowed purpose.';
  }
  if (code === 'allowed_fields_required') {
    return 'Delegation must include at least one allowed field.';
  }
  if (code === 'invalid_scope') {
    return 'Invalid delegation scope. Use a supported scope value.';
  }
  if (code === 'expires_at_invalid_or_past') {
    return 'Delegation expiry is invalid or already in the past.';
  }
  if (code === 'delegation_not_found') {
    return 'Delegation not found. Refresh and retry.';
  }
  if (code === 'delegation_not_active') {
    return 'Delegation is not active. Create or reactivate delegation first.';
  }
  if (code === 'token_not_active') {
    return 'Token is not ACTIVE. Issue a fresh token before continuing.';
  }
  if (code === 'consent_not_found') {
    return 'Consent not found. Refresh the queue and retry.';
  }
  if (code === 'consent_expired') {
    return 'Consent has expired. Renew or create a new consent request.';
  }
  if (code === 'consent_rejected') {
    return 'Consent was rejected by wallet user/delegate. Verification cannot proceed.';
  }
  if (code === 'consent_not_approved') {
    return 'Consent is not approved yet. Wait for wallet approval before verification.';
  }
  if (code === 'consent_binding_mismatch') {
    return 'Consent binding mismatch detected (FI/purpose/fields). Recreate request with matching values.';
  }
  if (code === 'consent_binding_lookup_failed') {
    return 'Could not load consent binding from consent-manager. Check service health and retry.';
  }
  if (code === 'consent_manager_unreachable') {
    return 'Consent-manager service is unreachable. Check backend containers and retry.';
  }
  if (code === 'consent_create_failed') {
    const payloadRecord =
      input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
        ? (input.payload as Record<string, unknown>)
        : null;
    const detailRaw = payloadRecord?.detail;
    if (typeof detailRaw === 'string') {
      const loweredDetail = detailRaw.toLowerCase();
      if (loweredDetail.includes('no active token found for user')) {
        return 'No ACTIVE token found for this wallet user. Issue token first, then create consent.';
      }
      const parsedDetail = parseJsonString(detailRaw);
      const parsedDetailError = typeof parsedDetail?.error === 'string' ? parsedDetail.error.toLowerCase() : '';
      if (parsedDetailError.includes('no active token found for user')) {
        return 'No ACTIVE token found for this wallet user. Issue token first, then create consent.';
      }
    }
    return 'Consent creation failed in consent-manager. Check wallet token state and request payload.';
  }
  if (code === 'no active token found for user') {
    return 'No ACTIVE token found for this wallet user. Issue token first, then create consent.';
  }
  if (code === 'invalid_client_credentials') {
    return 'Keycloak client credentials are invalid. Verify FI client secret/client-id configuration.';
  }

  if (input.status === 401) {
    return 'Authentication failed. Sign in again and retry.';
  }
  if (input.status === 403) {
    return 'You are not authorized for this action.';
  }
  if (input.status === 404) {
    return 'Requested resource was not found in current state.';
  }
  if (input.status === 409) {
    return 'Request conflicts with current state. Refresh data and retry.';
  }
  if (input.status >= 500) {
    return 'Backend service error. Check service logs and retry.';
  }

  return fallback;
}

function normalizeApiError(status: number, payload: unknown, fallbackMessage: string) {
  let errorCode = status > 0 ? `HTTP_${status}` : 'NETWORK_ERROR';
  let message = fallbackMessage;
  let details: unknown = payload ?? {};

  if (typeof payload === 'string' && payload.trim().length > 0) {
    message = payload;
  } else if (payload && typeof payload === 'object') {
    const objectPayload = payload as Record<string, unknown>;
    const rawCode = [objectPayload.errorCode, objectPayload.error, objectPayload.reason, objectPayload.code].find(
      (value) => typeof value === 'string'
    ) as string | undefined;
    if (rawCode) {
      errorCode = rawCode.trim().toUpperCase();
    }
    const explicitMessage = [objectPayload.message, objectPayload.error_description].find(
      (value) => typeof value === 'string' && value.trim().length > 0
    ) as string | undefined;
    if (explicitMessage) {
      message = explicitMessage;
    } else if (typeof objectPayload.error === 'string' && objectPayload.error.trim().length > 0) {
      message = objectPayload.error;
    }
    details = payload;
  }

  message = toFriendlyErrorMessage({
    status,
    errorCode,
    fallbackMessage: message,
    payload,
  });

  return {
    errorCode,
    message,
    details,
  };
}

function parseJwtPayload(token: string | null): Record<string, unknown> | null {
  if (!token) {
    return null;
  }

  try {
    const payload = token.split('.')[1];
    if (!payload) {
      return null;
    }
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function deriveFi2Fields(fields: string[]) {
  const unique = [...new Set(fields)];
  if (unique.includes('fullName') && unique.includes('idNumber')) {
    return ['fullName', 'idNumber'];
  }
  return unique.slice(0, Math.max(1, unique.length - 1));
}

function safeStorageGet(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota / privacy-mode failures to avoid crashing the UI.
  }
}

function loadCoverageFromStorage() {
  if (typeof window === 'undefined') {
    return DEFAULT_COVERAGE;
  }

  const raw = safeStorageGet(COVERAGE_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_COVERAGE;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CoverageState>;
    return {
      ...DEFAULT_COVERAGE,
      ...parsed,
    };
  } catch {
    return DEFAULT_COVERAGE;
  }
}

function loadGuidedFromStorage() {
  if (typeof window === 'undefined') {
    return DEFAULT_GUIDED_STATE;
  }

  const raw = safeStorageGet(GUIDED_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_GUIDED_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GuidedWalkthroughState>;
    const stepIndex = typeof parsed.stepIndex === 'number' ? parsed.stepIndex : 0;
    const parsedRunnerStatusRaw =
      typeof parsed.runnerStatus === 'string' && RUNNER_STATUS_VALUES.includes(parsed.runnerStatus as RunnerStatus)
        ? (parsed.runnerStatus as RunnerStatus)
        : typeof parsed.blockedReason === 'string' && parsed.blockedReason.length > 0
          ? 'paused_waiting_login'
          : 'idle';
    const parsedRunnerStatus = parsedRunnerStatusRaw === 'running' ? 'idle' : parsedRunnerStatusRaw;
    const normalizedRunnerStatus = parsedRunnerStatus;
    const requiredLoginUser =
      typeof parsed.requiredLoginUser === 'string' && parsed.requiredLoginUser.trim().length > 0
        ? parsed.requiredLoginUser
        : null;
    const requiredLoginStepId =
      typeof parsed.requiredLoginStepId === 'string' && parsed.requiredLoginStepId.trim().length > 0
        ? parsed.requiredLoginStepId
        : null;
    return {
      running: normalizedRunnerStatus === 'running',
      stepIndex: Math.max(0, Math.min(stepIndex, GUIDED_STEPS.length)),
      steps: GUIDED_STEPS,
      blockedReason: typeof parsed.blockedReason === 'string' ? parsed.blockedReason : null,
      nextActionHint: typeof parsed.nextActionHint === 'string' ? parsed.nextActionHint : null,
      runnerStatus: normalizedRunnerStatus,
      requiredLoginUser,
      requiredLoginStepId,
    };
  } catch {
    return DEFAULT_GUIDED_STATE;
  }
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null);

export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const [scenarioId, setScenarioId] = useState<ScenarioId>('A');
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [flashMessages, setFlashMessages] = useState<FlashMessage[]>([]);
  const lastStatusMessageRef = useRef<string>('Ready');

  const [tokenId, setTokenId] = useState<string | null>(null);
  const [consentId, setConsentId] = useState<string | null>(null);
  const [tokenJwt, setTokenJwt] = useState<string | null>(null);
  const [assertionJwt, setAssertionJwt] = useState<string | null>(null);
  const [consentStatus, setConsentStatus] = useState<string | null>(null);
  const [consentExpiresAt, setConsentExpiresAt] = useState<string | null>(null);

  const [registrySnapshot, setRegistrySnapshot] = useState<RegistrySnapshot | null>(null);
  const [registryAudit, setRegistryAudit] = useState<RegistryAuditEvent[]>([]);
  const [delegations, setDelegations] = useState<DelegationRecord[]>([]);
  const [nominees, setNominees] = useState<NomineeRecord[]>([]);
  const [ckycResult, setCkycResult] = useState<CkycSyncResponse | null>(null);
  const [dueUsers, setDueUsers] = useState<ReviewDueUser[]>([]);
  const [reviewRun, setReviewRun] = useState<ReviewRunOnceResponse | null>(null);
  const [walletReviewStatus, setWalletReviewStatus] = useState<Record<string, unknown> | null>(null);
  const [verificationResults, setVerificationResults] = useState<VerificationResult[]>([]);
  const [fi2ReuseResult, setFi2ReuseResult] = useState<Fi2ReuseResult | null>(null);
  const [walletTokens, setWalletTokens] = useState<WalletTokenView[]>([]);
  const [walletConsents, setWalletConsents] = useState<WalletConsentView[]>([]);
  const [lastRequestResponse, setLastRequestResponse] = useState<LastRequestResponse | null>(null);
  const [consentExpiredObserved, setConsentExpiredObserved] = useState(false);

  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [apiLogs, setApiLogs] = useState<ApiLogEntry[]>([]);
  const [failures, setFailures] = useState<FailureEntry[]>([]);
  const [coverage, setCoverage] = useState<CoverageState>(() => loadCoverageFromStorage());
  const [guided, setGuided] = useState<GuidedWalkthroughState>(() => loadGuidedFromStorage());
  const [serviceHealth, setServiceHealth] = useState<ServiceHealthRow[]>(SERVICE_HEALTH_ROWS);
  const [lifecycleJobs, setLifecycleJobs] = useState<Array<{ id: string; runAt: string; detail: unknown }>>([]);
  const [fiTokenCoverage, setFiTokenCoverage] = useState<TokenCoverageResponse | null>(null);

  const scenario = useMemo(() => SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0], [scenarioId]);

  const walletDirectSession = getWalletDirectGrantSession();
  const fiDirectSession = getFiDirectGrantSession();
  const walletDirectPayload = parseJwtPayload(walletDirectSession?.accessToken ?? null);
  const fiDirectPayload = parseJwtPayload(fiDirectSession?.accessToken ?? null);
  const effectiveWalletTokenPayload = walletKeycloak.authenticated ? walletKeycloak.tokenParsed : walletDirectPayload;
  const effectiveFiTokenPayload = fiKeycloak.authenticated ? fiKeycloak.tokenParsed : fiDirectPayload;
  const keycloakWalletUsername =
    typeof effectiveWalletTokenPayload?.preferred_username === 'string'
      ? effectiveWalletTokenPayload.preferred_username
      : walletDirectSession?.username ?? null;
  const keycloakFiUsername =
    typeof effectiveFiTokenPayload?.preferred_username === 'string'
      ? effectiveFiTokenPayload.preferred_username
      : fiDirectSession?.username ?? null;
  const walletTokenRoles = derivePortalRoles(effectiveWalletTokenPayload, keycloakWalletUsername);
  const fiTokenRoles = derivePortalRoles(effectiveFiTokenPayload, keycloakFiUsername);
  const normalizedWalletUsername =
    typeof keycloakWalletUsername === 'string' ? keycloakWalletUsername.trim().toLowerCase() : '';
  const normalizedFiUsername = typeof keycloakFiUsername === 'string' ? keycloakFiUsername.trim().toLowerCase() : '';
  const knownWalletUsers = new Set(
    [WALLET_OWNER_USERNAME, WALLET_SECONDARY_USERNAME, WALLET_NOMINEE_USERNAME].map((value) => value.toLowerCase())
  );
  const knownFiUsers = new Set([FI_ANALYST_1_USERNAME, FI_ANALYST_2_USERNAME].map((value) => value.toLowerCase()));
  const isKnownWalletUser = normalizedWalletUsername.length > 0 && knownWalletUsers.has(normalizedWalletUsername);
  const isKnownFiUser = normalizedFiUsername.length > 0 && knownFiUsers.has(normalizedFiUsername);
  const walletFallbackRoleGranted = Boolean(
    isKnownWalletUser && (walletTokenRoles.claims.length === 0 || !walletTokenRoles.wallet)
  );
  const fiFallbackRoleGranted = Boolean(
    isKnownFiUser && (fiTokenRoles.claims.length === 0 || !fiTokenRoles.fi)
  );
  const adminFallbackRoleGranted = Boolean(
    normalizedWalletUsername === WALLET_OWNER_USERNAME.toLowerCase() &&
      (walletTokenRoles.claims.length === 0 || !walletTokenRoles.admin)
  );
  const syntheticRoleClaims: string[] = [];
  if (walletFallbackRoleGranted) {
    syntheticRoleClaims.push(
      normalizedWalletUsername === WALLET_NOMINEE_USERNAME.toLowerCase() ? 'wallet_nominee' : 'wallet_user'
    );
  }
  if (fiFallbackRoleGranted) {
    syntheticRoleClaims.push('fi_user');
  }
  if (adminFallbackRoleGranted) {
    syntheticRoleClaims.push('admin');
  }
  const roleClaims = [...new Set([...walletTokenRoles.claims, ...fiTokenRoles.claims, ...syntheticRoleClaims])];
  const walletRoleGranted = walletTokenRoles.wallet || walletFallbackRoleGranted;
  const fiRoleGranted = fiTokenRoles.fi || fiFallbackRoleGranted;
  const adminRoleGranted = walletTokenRoles.admin || adminFallbackRoleGranted;
  const walletRoleClaimSet = new Set(roleClaims.map((claim) => claim.toLowerCase()));
  const usernameIsNominee =
    typeof keycloakWalletUsername === 'string' &&
    keycloakWalletUsername.trim().length > 0 &&
    keycloakWalletUsername.trim().toLowerCase() === WALLET_NOMINEE_USERNAME.toLowerCase();
  const hasWalletNomineeRole = walletRoleClaimSet.has('wallet_nominee') || (walletRoleGranted && usernameIsNominee);
  const hasWalletOwnerRole =
    walletRoleClaimSet.has('wallet_user') || adminRoleGranted || (walletRoleGranted && !hasWalletNomineeRole);
  const authenticated = Boolean(walletKeycloak.authenticated || walletDirectSession);
  const activeWalletUsername = keycloakWalletUsername;
  const resolveWalletApiTargetUserId = useCallback(
    (preferredTargetUserId?: string) => {
      if (typeof preferredTargetUserId === 'string' && preferredTargetUserId.trim().length > 0) {
        return preferredTargetUserId.trim();
      }
      const username = (activeWalletUsername ?? '').trim().toLowerCase();
      if (username && username === WALLET_OWNER_USERNAME.toLowerCase()) {
        return WALLET_OWNER_USER_ID;
      }
      if (username && username === WALLET_NOMINEE_USERNAME.toLowerCase()) {
        return WALLET_NOMINEE_USER_ID || WALLET_NOMINEE_USERNAME;
      }
      if (activeWalletUsername && activeWalletUsername.trim().length > 0) {
        return activeWalletUsername.trim();
      }
      return WALLET_OWNER_USER_ID;
    },
    [activeWalletUsername]
  );
  const fiAuthenticated = Boolean(fiKeycloak.authenticated || fiDirectSession);
  const activeFiUsername = fiAuthenticated ? keycloakFiUsername : null;
  const defaultPortalPath = adminRoleGranted ? '/command' : walletRoleGranted ? '/wallet' : fiRoleGranted ? '/fi/queue' : '/command';

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    safeStorageSet(COVERAGE_STORAGE_KEY, JSON.stringify(coverage));
  }, [coverage]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    safeStorageSet(
      GUIDED_STORAGE_KEY,
      JSON.stringify({
        stepIndex: guided.stepIndex,
        blockedReason: guided.blockedReason,
        nextActionHint: guided.nextActionHint,
        runnerStatus: guided.runnerStatus,
        requiredLoginUser: guided.requiredLoginUser,
        requiredLoginStepId: guided.requiredLoginStepId,
      })
    );
  }, [
    guided.blockedReason,
    guided.nextActionHint,
    guided.requiredLoginStepId,
    guided.requiredLoginUser,
    guided.runnerStatus,
    guided.stepIndex,
  ]);

  const pushActivity = useCallback((event: Omit<ActivityEvent, 'id' | 'at'>) => {
    setActivities((previous) => [
      {
        id: createId(),
        at: new Date().toISOString(),
        ...event,
      },
      ...previous,
    ]);
  }, []);

  const pushApiLog = useCallback((entry: Omit<ApiLogEntry, 'id' | 'at'>): ApiLogEntry => {
    const created: ApiLogEntry = {
      id: createId(),
      at: new Date().toISOString(),
      ...entry,
    };
    setApiLogs((previous) => [created, ...previous]);
    setLastRequestResponse({
      id: created.id,
      at: created.at,
      method: created.method,
      path: created.path,
      statusCode: created.statusCode,
      durationMs: created.durationMs,
      ok: created.ok,
      requestBody: created.requestBody,
      responseBody: created.responseBody,
    });
    return created;
  }, []);

  const pushFlashMessage = useCallback((tone: FlashMessage['tone'], message: string, detail?: string) => {
    const normalized = message.trim();
    if (!normalized) {
      return;
    }
    const refCode = `BKY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const normalizedDetail = typeof detail === 'string' && detail.trim().length > 0 ? detail.trim() : '';
    const enrichedDetail =
      tone === 'error'
        ? [normalizedDetail, `Reference: ${refCode}`].filter(Boolean).join(' · ')
        : normalizedDetail;
    const created: FlashMessage = {
      id: createId(),
      tone,
      message: normalized,
      ...(enrichedDetail ? { detail: enrichedDetail } : {}),
    };
    setFlashMessages((previous) => [created, ...previous].slice(0, 5));
  }, []);

  const dismissFlashMessage = useCallback((id: string) => {
    setFlashMessages((previous) => previous.filter((message) => message.id !== id));
  }, []);

  const clearFlashMessages = useCallback(() => {
    setFlashMessages([]);
  }, []);

  const pushFailure = useCallback((entry: Omit<FailureEntry, 'id' | 'at'>) => {
    setFailures((previous) => [
      {
        id: createId(),
        at: new Date().toISOString(),
        ...entry,
      },
      ...previous,
    ]);
  }, []);

  useEffect(() => {
    if (statusMessage === lastStatusMessageRef.current) {
      return;
    }
    lastStatusMessageRef.current = statusMessage;
    const tone = classifyStatusMessageTone(statusMessage);
    if (!tone) {
      return;
    }
    pushFlashMessage(tone, statusMessage);
  }, [pushFlashMessage, statusMessage]);

  const setCoverageFlag = useCallback((key: CoverageKey, value = true) => {
    setCoverage((previous) => ({
      ...previous,
      [key]: value,
    }));
  }, []);

  useEffect(() => {
    if (apiLogs.length > 0) {
      setCoverageFlag('requestResponseInspector', true);
    }
  }, [apiLogs.length, setCoverageFlag]);

  useEffect(() => {
    if (registryAudit.length > 0) {
      setCoverageFlag('auditChain', true);
    }
  }, [registryAudit.length, setCoverageFlag]);

  const apiCall = useCallback(
    async <T,>(input: {
      title: string;
      method: string;
      path: string;
      token?: string;
      body?: unknown;
      service?: ServiceName;
    }): Promise<T> => {
      const startedAt = performance.now();
      const service = input.service ?? deriveServiceFromPath(input.path);
      const traceId = createId();
      const actionTag = input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'console_action';
      let response: Response;
      let payload: unknown = null;

      if (UI_API_DEBUG) {
        // Debug-only browser console trace to map UI action -> backend logs.
        console.debug(`[console-api:start][${traceId}]`, {
          title: input.title,
          method: input.method,
          path: input.path,
          service,
          body: input.body ?? null,
        });
      }

      try {
        response = await fetch(input.path, {
          method: input.method,
          headers: {
            'x-console-trace-id': traceId,
            'x-console-action': actionTag,
            ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
            ...(input.body ? { 'content-type': 'application/json' } : {}),
          },
          body: input.body ? JSON.stringify(input.body) : undefined,
        });
      } catch {
        if (UI_API_DEBUG) {
          console.debug(`[console-api:network_error][${traceId}]`, {
            title: input.title,
            method: input.method,
            path: input.path,
          });
        }
        const networkPayload = {
          error: 'network_error',
          message: `Network error calling ${input.path}`,
        };
        const normalized = normalizeApiError(0, networkPayload, networkPayload.message);
        pushApiLog({
          service,
          title: input.title,
          method: input.method,
          path: input.path,
          statusCode: 0,
          durationMs: Math.round(performance.now() - startedAt),
          ok: false,
          requestBody: input.body,
          responseBody: networkPayload,
        });
        pushFailure({
          service,
          endpoint: `${input.method.toUpperCase()} ${input.path}`,
          statusCode: 0,
          errorCode: normalized.errorCode,
          message: normalized.message,
          details: normalized.details,
        });
        pushActivity({
          service,
          label: input.title,
          status: 'failed',
          detail: normalized.errorCode,
        });
        setStatusMessage(normalized.message);
        throw new ApiCallError(normalized.message, 0, networkPayload, normalized.errorCode);
      }

      const text = await response.text();
      if (text.trim().length > 0) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }

      const durationMs = Math.round(performance.now() - startedAt);
      pushApiLog({
        service,
        title: input.title,
        method: input.method,
        path: input.path,
        statusCode: response.status,
        durationMs,
        ok: response.ok,
        requestBody: input.body,
        responseBody: payload,
      });

      if (!response.ok) {
        if (UI_API_DEBUG) {
          console.debug(`[console-api:failed][${traceId}]`, {
            title: input.title,
            method: input.method,
            path: input.path,
            statusCode: response.status,
            payload,
          });
        }
        const normalized = normalizeApiError(response.status, payload, `Request failed (${response.status})`);
        pushFailure({
          service,
          endpoint: `${input.method.toUpperCase()} ${input.path}`,
          statusCode: response.status,
          errorCode: normalized.errorCode,
          message: normalized.message,
          details: normalized.details,
        });
        pushActivity({
          service,
          label: input.title,
          status: 'failed',
          detail: normalized.errorCode,
        });
        setStatusMessage(normalized.message);
        throw new ApiCallError(normalized.message, response.status, payload, normalized.errorCode);
      }

      if (UI_API_DEBUG) {
        console.debug(`[console-api:ok][${traceId}]`, {
          title: input.title,
          method: input.method,
          path: input.path,
          statusCode: response.status,
          payload,
        });
      }

      return payload as T;
    },
    [pushActivity, pushApiLog, pushFailure, setStatusMessage]
  );

  const requireWalletToken = useCallback(async (): Promise<string | null> => {
    const token = await getWalletAccessToken();
    if (token) {
      return token;
    }

    const message = 'Login required for wallet actions.';
    pushFailure({
      service: 'wallet',
      endpoint: 'LOCAL_AUTH_GUARD wallet-token',
      statusCode: 401,
      errorCode: 'LOGIN_REQUIRED',
      message,
      details: { source: 'requireWalletToken' },
    });
    pushActivity({
      service: 'wallet',
      label: 'WALLET_LOGIN_REQUIRED',
      status: 'failed',
      detail: message,
    });
    setStatusMessage(message);
    throw new Error(message);
  }, [pushActivity, pushFailure, setStatusMessage]);

  const requireFiToken = useCallback(
    async (client: 'fi' | 'fi2' = 'fi') => {
      void client;
      const fiToken = await getFiAccessToken();
      if (fiToken && fiRoleGranted) {
        return fiToken;
      }

      const message = 'Login required for FI actions.';
      pushFailure({
        service: 'fi',
        endpoint: 'LOCAL_AUTH_GUARD fi-token',
        statusCode: 401,
        errorCode: 'LOGIN_REQUIRED',
        message,
        details: { source: 'requireFiToken' },
      });
      pushActivity({
        service: 'fi',
        label: 'FI_LOGIN_REQUIRED',
        status: 'failed',
        detail: message,
      });
      setStatusMessage(message);
      throw new Error(message);
    },
    [fiRoleGranted, pushActivity, pushFailure, setStatusMessage]
  );

  const refreshRegistryEvidence = useCallback(
    async (targetTokenId?: string) => {
      const activeTokenId = targetTokenId ?? tokenId;
      if (!activeTokenId) {
        return;
      }

      const fiToken = await requireWalletToken();
      const token = await apiCall<RegistrySnapshot>({
        service: 'registry',
        title: 'Registry token status',
        method: 'GET',
        path: routeFor(api.registry, `/v1/registry/token/${encodeURIComponent(activeTokenId)}`),
        token: fiToken,
      });
      setRegistrySnapshot(token);

      const audit = await apiCall<{ tokenId: string; events: RegistryAuditEvent[] }>({
        service: 'registry',
        title: 'Registry audit chain',
        method: 'GET',
        path: routeFor(api.registry, `/v1/registry/audit/${encodeURIComponent(activeTokenId)}`),
        token: fiToken,
      });
      setRegistryAudit(audit.events);
    },
    [apiCall, requireWalletToken, tokenId]
  );

  const issueToken = useCallback(async (options?: IssueTokenOptions) => {
    const targetUserId = options?.userId?.trim() || WALLET_OWNER_USER_ID;
    const targetKycBase = buildKycIdentityForUser(targetUserId);
    const kycOverride = options?.kycOverride ?? {};
    const targetKyc: IssueKycPayload = {
      ...targetKycBase,
      ...(typeof kycOverride.fullName === 'string' && kycOverride.fullName.trim().length > 0
        ? { fullName: kycOverride.fullName.trim() }
        : {}),
      ...(typeof kycOverride.dob === 'string' && kycOverride.dob.trim().length > 0 ? { dob: kycOverride.dob.trim() } : {}),
      ...(typeof kycOverride.idNumber === 'string' && kycOverride.idNumber.trim().length > 0
        ? { idNumber: kycOverride.idNumber.trim() }
        : {}),
      ...(typeof kycOverride.email === 'string' && kycOverride.email.trim().length > 0
        ? { email: kycOverride.email.trim() }
        : {}),
      ...(typeof kycOverride.phone === 'string' && kycOverride.phone.trim().length > 0
        ? { phone: kycOverride.phone.trim() }
        : {}),
      ...(typeof kycOverride.addressLine1 === 'string' && kycOverride.addressLine1.trim().length > 0
        ? { addressLine1: kycOverride.addressLine1.trim() }
        : {}),
      ...(typeof kycOverride.pincode === 'string' && kycOverride.pincode.trim().length > 0
        ? { pincode: kycOverride.pincode.trim() }
        : {}),
    };
    const ckycReference = options?.ckycReference?.trim() || null;

    setRunningAction('issue-token');
    setStatusMessage('Issuing token...');
    try {
      const issuerToken = await requireWalletToken();
      const issued = await apiCall<{ tokenId: string; tokenJwt: string }>({
        service: 'issuer',
        title: 'Issue Token',
        method: 'POST',
        path: routeFor(api.issuer, '/v1/issuer/kyc/issue'),
        token: issuerToken,
        body: {
          kyc: targetKyc,
          ...(typeof options?.ttlSeconds === 'number' ? { ttlSeconds: options.ttlSeconds } : {}),
        },
      });

      setTokenId(issued.tokenId);
      setTokenJwt(issued.tokenJwt);
      setWalletTokens((previous) => [
        {
          tokenId: issued.tokenId,
          status: 'ACTIVE',
          issuedAt: new Date().toISOString(),
        },
        ...previous.filter((item) => item.tokenId !== issued.tokenId),
      ]);
      await refreshRegistryEvidence(issued.tokenId);
      setCoverageFlag('issueToken', true);
      pushActivity({
        service: 'issuer',
        label: 'TOKEN_ISSUED',
        status: 'success',
        detail: {
          userId: targetUserId,
          tokenId: issued.tokenId,
          ckycReference,
          kycAddress: targetKyc.addressLine1 ?? null,
          kycPincode: targetKyc.pincode ?? null,
        },
      });
      setStatusMessage(
        ckycReference
          ? `Token issued for ${targetUserId} (${ckycReference}): ${issued.tokenId}`
          : `Token issued for ${targetUserId}: ${issued.tokenId}`
      );
    } finally {
      setRunningAction(null);
    }
  }, [apiCall, pushActivity, refreshRegistryEvidence, requireWalletToken, setCoverageFlag]);

  const requestConsentWith = useCallback(async (payload: {
    userId?: string;
    purpose: string;
    requestedFields: string[];
    fiId?: string;
    ttlSeconds?: number;
    requiresDelegation?: boolean;
    allowReuseAcrossFIs?: boolean;
  }) => {
    setRunningAction('request-consent');
    setStatusMessage('Requesting consent...');
    try {
      const fiToken = await requireFiToken();
      const targetUserId = payload.userId?.trim() || WALLET_OWNER_USER_ID;
      const created = await apiCall<{
        consentId: string;
        tokenId: string;
        status: string;
        ttlSeconds?: number;
        requiresDelegation?: boolean;
        allowReuseAcrossFIs?: boolean;
        expiresAt?: string;
      }>({
        service: 'fi',
        title: 'FI Request Consent',
        method: 'POST',
        path: routeFor(api.fi, '/v1/fi/request-kyc'),
        token: fiToken,
        body: {
          userId: targetUserId,
          fiId: payload.fiId ?? FI_CLIENT_ID,
          purpose: payload.purpose,
          requestedFields: payload.requestedFields,
          ...(typeof payload.ttlSeconds === 'number' ? { ttlSeconds: payload.ttlSeconds } : {}),
          ...(typeof payload.requiresDelegation === 'boolean' ? { requiresDelegation: payload.requiresDelegation } : {}),
          ...(typeof payload.allowReuseAcrossFIs === 'boolean'
            ? { allowReuseAcrossFIs: payload.allowReuseAcrossFIs }
            : {}),
        },
      });

      setConsentId(created.consentId);
      setConsentStatus(created.status);
      setConsentExpiresAt(created.expiresAt ?? null);
      if (!tokenId) {
        setTokenId(created.tokenId);
      }
      setWalletConsents((previous) => [
        {
          consentId: created.consentId,
          tokenId: created.tokenId,
          status: created.status,
          purpose: payload.purpose,
          requestedFields: payload.requestedFields,
          fiId: payload.fiId ?? FI_CLIENT_ID,
          requiresDelegation: created.requiresDelegation ?? payload.requiresDelegation ?? false,
          allowReuseAcrossFIs: created.allowReuseAcrossFIs ?? payload.allowReuseAcrossFIs ?? false,
          createdAt: new Date().toISOString(),
          expiresAt: created.expiresAt,
        },
        ...previous.filter((item) => item.consentId !== created.consentId),
      ]);
      setCoverageFlag('requestConsent', true);

      pushActivity({
        service: 'fi',
        label: 'CONSENT_REQUESTED',
        status: 'success',
        detail: created.consentId,
      });
      setStatusMessage(`Consent requested: ${created.consentId}`);
    } finally {
      setRunningAction(null);
    }
  }, [apiCall, pushActivity, requireFiToken, setCoverageFlag, tokenId]);

  const requestConsent = useCallback(async () => {
    await requestConsentWith({
      purpose: scenario.purpose,
      requestedFields: scenario.requestedFields,
      fiId: FI_CLIENT_ID,
      userId: WALLET_OWNER_USER_ID,
    });
  }, [requestConsentWith, scenario.purpose, scenario.requestedFields]);

  const fetchWalletTokensWithToken = useCallback(
    async (walletToken: string | null, targetUserId?: string) => {
      const userId = resolveWalletApiTargetUserId(targetUserId);
      const listed = await apiCall<{ userId?: string; tokens?: WalletTokenView[]; items?: WalletTokenView[] }>({
        service: 'wallet',
        title: 'List Wallet Tokens',
        method: 'GET',
        path: routeFor(api.wallet, `/v1/wallet/${encodeURIComponent(userId)}/tokens`),
        token: walletToken ?? undefined,
      });
      const tokens = Array.isArray(listed.tokens) ? listed.tokens : Array.isArray(listed.items) ? listed.items : [];
      setWalletTokens(tokens);
      return tokens;
    },
    [apiCall, resolveWalletApiTargetUserId]
  );

  const fetchWalletConsentsWithToken = useCallback(
    async (walletToken: string | null, targetUserId?: string) => {
      const userId = resolveWalletApiTargetUserId(targetUserId);
      const listed = await apiCall<{ userId?: string; consents?: WalletConsentView[]; items?: WalletConsentView[] }>({
        service: 'wallet',
        title: 'List Wallet Consents',
        method: 'GET',
        path: routeFor(api.wallet, `/v1/wallet/${encodeURIComponent(userId)}/consents?view=all`),
        token: walletToken ?? undefined,
      });
      const rawConsents = Array.isArray(listed.consents) ? listed.consents : Array.isArray(listed.items) ? listed.items : [];
      const consents = rawConsents.map((consent) => normalizeWalletConsentView(consent));
      setWalletConsents(consents);
      return consents;
    },
    [apiCall, resolveWalletApiTargetUserId]
  );

  const fetchDelegationsWithToken = useCallback(
    async (walletToken: string | null, targetUserId?: string) => {
      const userId = resolveWalletApiTargetUserId(targetUserId);
      const listed = await apiCall<{ userId: string; delegations: DelegationRecord[] }>({
        service: 'wallet',
        title: 'List Delegations',
        method: 'GET',
        path: routeFor(api.wallet, `/v1/wallet/${encodeURIComponent(userId)}/delegations`),
        token: walletToken ?? undefined,
      });
      setDelegations(listed.delegations);
      return listed.delegations;
    },
    [apiCall, resolveWalletApiTargetUserId]
  );

  const fetchNomineesWithToken = useCallback(
    async (walletToken: string | null, targetUserId?: string) => {
      const userId = resolveWalletApiTargetUserId(targetUserId);
      const listed = await apiCall<{ userId: string; nominees: NomineeRecord[] }>({
        service: 'wallet',
        title: 'List Nominees',
        method: 'GET',
        path: routeFor(api.wallet, `/v1/wallet/${encodeURIComponent(userId)}/nominees`),
        token: walletToken ?? undefined,
      });
      setNominees(Array.isArray(listed.nominees) ? listed.nominees : []);
      return listed.nominees;
    },
    [apiCall, resolveWalletApiTargetUserId]
  );

  const approveConsent = useCallback(
    async (
      targetConsentId?: string,
      approvedFields?: ApprovedFieldsInput,
      options?: {
        reason?: string;
        nomineeActor?: string;
      }
    ) => {
      const resolvedConsentId = targetConsentId ?? consentId;
      if (!resolvedConsentId) {
        throw new Error('Create consent first.');
      }
      const selectedFieldSet = normalizeApprovedFields(approvedFields);

      setRunningAction('approve-consent');
      setStatusMessage('Approving consent...');
      try {
        const walletToken = await requireWalletToken();
        const approved = await apiCall<{
          consentId: string;
          status: string;
          assertionJwt: string;
          expiresAt?: string;
          assertionId?: string;
        }>({
          service: 'wallet',
          title: 'Wallet Approve Consent',
          method: 'POST',
          path: routeFor(api.wallet, `/v1/wallet/consents/${encodeURIComponent(resolvedConsentId)}/approve`),
          token: walletToken ?? undefined,
          body: {
            reason:
              options?.reason ??
              (options?.nomineeActor
                ? `Approved by nominee actor ${options.nomineeActor} in wallet portal`
                : 'Approved in wallet portal'),
            ...(selectedFieldSet && selectedFieldSet.length > 0 ? { approvedFields: selectedFieldSet } : {}),
          },
        });

        setConsentId(approved.consentId);
        setConsentStatus(approved.status);
        setAssertionJwt(approved.assertionJwt);
        if (approved.expiresAt) {
          setConsentExpiresAt(approved.expiresAt);
        }
        setWalletConsents((previous) =>
          previous.map((item) =>
            item.consentId === approved.consentId
              ? {
                  ...item,
                  status: approved.status,
                  expiresAt: approved.expiresAt ?? item.expiresAt,
                  assertionId: approved.assertionId ?? item.assertionId,
                  requestedFields: selectedFieldSet ?? item.requestedFields,
                }
              : item
          )
        );

        await Promise.allSettled([
          fetchWalletConsentsWithToken(walletToken),
          fetchWalletTokensWithToken(walletToken),
          fetchDelegationsWithToken(walletToken),
          refreshRegistryEvidence(tokenId ?? undefined),
        ]);

        pushActivity({
          service: 'wallet',
          label: 'CONSENT_APPROVED',
          status: 'success',
          detail: {
            consentId: approved.consentId,
            selectedFields: selectedFieldSet ?? 'all-requested',
            nomineeActor: options?.nomineeActor ?? null,
          },
        });
        setCoverageFlag('walletApprove', true);
        setStatusMessage(`Consent approved: ${approved.consentId}`);
      } finally {
        setRunningAction(null);
      }
    },
    [
      apiCall,
      consentId,
      fetchDelegationsWithToken,
      fetchWalletConsentsWithToken,
      fetchWalletTokensWithToken,
      pushActivity,
      refreshRegistryEvidence,
      requireWalletToken,
      setCoverageFlag,
      tokenId,
    ]
  );

  const rejectConsent = useCallback(
    async (targetConsentId?: string, reason?: string) => {
      const resolvedConsentId = targetConsentId ?? consentId;
      if (!resolvedConsentId) {
        throw new Error('Create consent first.');
      }
      setRunningAction('reject-consent');
      setStatusMessage('Rejecting consent...');
      try {
        const walletToken = await requireWalletToken();
        const rejected = await apiCall<{
          consentId: string;
          status: string;
          expiresAt?: string;
        }>({
          service: 'wallet',
          title: 'Wallet Reject Consent',
          method: 'POST',
          path: routeFor(api.wallet, `/v1/wallet/consents/${encodeURIComponent(resolvedConsentId)}/reject`),
          token: walletToken ?? undefined,
          body: {
            reason: reason ?? 'Rejected in /console',
          },
        });

        setConsentId(rejected.consentId);
        setConsentStatus(rejected.status);
        if (rejected.expiresAt) {
          setConsentExpiresAt(rejected.expiresAt);
        }
        setAssertionJwt(null);
        setWalletConsents((previous) =>
          previous.map((item) =>
            item.consentId === rejected.consentId
              ? {
                  ...item,
                  status: rejected.status,
                  expiresAt: rejected.expiresAt ?? item.expiresAt,
                }
              : item
          )
        );
        await Promise.allSettled([
          fetchWalletConsentsWithToken(walletToken),
          fetchWalletTokensWithToken(walletToken),
          fetchDelegationsWithToken(walletToken),
          refreshRegistryEvidence(tokenId ?? undefined),
        ]);

        pushActivity({
          service: 'wallet',
          label: 'CONSENT_REJECTED',
          status: 'info',
          detail: {
            consentId: rejected.consentId,
            reason: reason ?? 'Rejected in /console',
          },
        });
        setStatusMessage(`Consent rejected: ${rejected.consentId}`);
      } finally {
        setRunningAction(null);
      }
    },
    [
      apiCall,
      consentId,
      fetchDelegationsWithToken,
      fetchWalletConsentsWithToken,
      fetchWalletTokensWithToken,
      pushActivity,
      refreshRegistryEvidence,
      requireWalletToken,
      tokenId,
    ]
  );

  const revokeConsent = useCallback(
    async (targetConsentId?: string, reason?: string) => {
      const resolvedConsentId = targetConsentId ?? consentId;
      if (!resolvedConsentId) {
        throw new Error('Select a consent first.');
      }
      setRunningAction('revoke-consent');
      setStatusMessage('Revoking consent...');
      try {
        const walletToken = await requireWalletToken();
        const revoked = await apiCall<{ consentId: string; status: string; expiresAt?: string }>({
          service: 'wallet',
          title: 'Wallet Revoke Consent',
          method: 'POST',
          path: routeFor(api.wallet, `/v1/wallet/consents/${encodeURIComponent(resolvedConsentId)}/revoke`),
          token: walletToken ?? undefined,
          body: {
            reason: reason ?? 'Revoked by wallet user',
          },
        });

        setConsentId(revoked.consentId);
        setConsentStatus(revoked.status);
        if (revoked.expiresAt) {
          setConsentExpiresAt(revoked.expiresAt);
        }
        setAssertionJwt(null);

        await Promise.allSettled([
          fetchWalletConsentsWithToken(walletToken),
          fetchWalletTokensWithToken(walletToken),
          fetchDelegationsWithToken(walletToken),
          refreshRegistryEvidence(tokenId ?? undefined),
        ]);

        pushActivity({
          service: 'wallet',
          label: 'CONSENT_REVOKED',
          status: 'warn',
          detail: { consentId: revoked.consentId, reason: reason ?? 'Revoked by wallet user' },
        });

        setStatusMessage(`Consent revoked: ${revoked.consentId}`);
      } finally {
        setRunningAction(null);
      }
    },
    [
      apiCall,
      consentId,
      fetchDelegationsWithToken,
      fetchWalletConsentsWithToken,
      fetchWalletTokensWithToken,
      pushActivity,
      refreshRegistryEvidence,
      requireWalletToken,
      tokenId,
    ]
  );

  const verifyAssertionSuccess = useCallback(async () => {
    if (!consentId || !assertionJwt) {
      throw new Error('Approve consent first.');
    }
    setRunningAction('verify-success');
    setStatusMessage('Verifying assertion...');
    try {
      const fiToken = await requireFiToken();
      const verified = await apiCall<VerifySuccessResponse>({
        service: 'fi',
        title: 'FI Verify Assertion (Expected Success)',
        method: 'POST',
        path: routeFor(api.fi, '/v1/fi/verify-assertion'),
        token: fiToken,
        body: {
          consentId,
          assertionJwt,
        },
      });

      setVerificationResults((previous) => [
        {
          id: createId(),
          at: new Date().toISOString(),
          mode: 'success',
          fiId: verified.fiId,
          tokenId: verified.tokenId,
          consentId: verified.consentId,
          purpose: verified.purpose,
          disclosedClaims: verified.disclosedClaims,
        },
        ...previous,
      ]);
      await refreshRegistryEvidence(verified.tokenId);

      setCoverageFlag('fiVerifySuccess', true);
      pushActivity({
        service: 'fi',
        label: 'ASSERTION_VERIFIED_SUCCESS',
        status: 'success',
        detail: verified.tokenId,
      });
      setStatusMessage('Assertion verification succeeded.');
    } finally {
      setRunningAction(null);
    }
  }, [apiCall, assertionJwt, consentId, pushActivity, refreshRegistryEvidence, requireFiToken, setCoverageFlag]);

  const verifyExpectedFailure = useCallback(
    async (expectedErrorCode: string) => {
      if (!consentId || !assertionJwt) {
        throw new Error('Approve consent first.');
      }
      setRunningAction('verify-failure');
      setStatusMessage(`Expecting failure: ${expectedErrorCode}...`);
      try {
        const fiToken = await requireFiToken();
        try {
          await apiCall<VerifySuccessResponse>({
            service: 'fi',
            title: 'FI Verify Assertion (Expected Failure)',
            method: 'POST',
            path: routeFor(api.fi, '/v1/fi/verify-assertion'),
            token: fiToken,
            body: {
              consentId,
              assertionJwt,
            },
          });
          throw new Error(`Expected ${expectedErrorCode} but verification succeeded.`);
        } catch (error) {
          if (!(error instanceof ApiCallError)) {
            throw error;
          }
          const normalized = normalizeApiError(error.status, error.payload, error.message);
          if (normalized.errorCode !== expectedErrorCode) {
            throw new Error(`Expected ${expectedErrorCode} but received ${normalized.errorCode}.`);
          }

          setVerificationResults((previous) => [
            {
              id: createId(),
              at: new Date().toISOString(),
              mode: 'expected_fail',
              fiId: FI_CLIENT_ID,
              consentId,
              errorCode: normalized.errorCode,
            },
            ...previous,
          ]);
          pushActivity({
            service: 'fi',
            label: 'ASSERTION_VERIFIED_EXPECTED_FAIL',
            status: 'success',
            detail: normalized.errorCode,
          });
          if (expectedErrorCode === 'TOKEN_NOT_ACTIVE') {
            setCoverageFlag('postRevokeVerifyFailTokenNotActive', true);
          }
          if (expectedErrorCode === 'CONSENT_REJECTED') {
            setCoverageFlag('consentRejectedFail', true);
          }
          if (expectedErrorCode === 'CONSENT_EXPIRED') {
            setConsentExpiredObserved(true);
          }
          setStatusMessage(`Expected failure observed: ${expectedErrorCode}`);
        }
      } finally {
        setRunningAction(null);
      }
    },
    [apiCall, assertionJwt, consentId, pushActivity, requireFiToken, setCoverageFlag]
  );

  const revokeToken = useCallback(async () => {
    if (!tokenId) {
      throw new Error('Issue token first.');
    }
    setRunningAction('revoke-token');
    setStatusMessage('Revoking token...');
    try {
      const issuerToken = await requireWalletToken();
      const revoked = await apiCall<{ tokenId: string; status: string }>({
        service: 'issuer',
        title: 'Revoke Token',
        method: 'POST',
        path: routeFor(api.issuer, `/v1/issuer/token/${encodeURIComponent(tokenId)}/revoke`),
        token: issuerToken,
        body: {
          reason: 'Revoked from /console',
        },
      });

      await refreshRegistryEvidence(revoked.tokenId);
      setWalletTokens((previous) =>
        previous.map((item) => (item.tokenId === revoked.tokenId ? { ...item, status: revoked.status } : item))
      );
      setCoverageFlag('revokeToken', true);
      pushActivity({
        service: 'issuer',
        label: 'TOKEN_REVOKED',
        status: 'success',
        detail: revoked.tokenId,
      });
      setStatusMessage(`Token revoked: ${revoked.tokenId}`);
    } finally {
      setRunningAction(null);
    }
  }, [apiCall, pushActivity, refreshRegistryEvidence, requireWalletToken, setCoverageFlag, tokenId]);

  const renewConsent = useCallback(async () => {
    if (!consentId) {
      throw new Error('Create consent first.');
    }
    setRunningAction('renew-consent');
    setStatusMessage('Renewing consent...');
    try {
      const fiToken = await requireFiToken();
      const renewed = await apiCall<RenewConsentResponse>({
        service: 'fi',
        title: 'Renew Consent',
        method: 'POST',
        path: routeFor(api.fi, '/v1/fi/renew-consent'),
        token: fiToken,
        body: {
          consentId,
        },
      });

      setConsentId(renewed.newConsentId);
      setConsentStatus(renewed.status);
      setConsentExpiresAt(renewed.expiresAt);
      setWalletConsents((previous) => [
        {
          consentId: renewed.newConsentId,
          tokenId: renewed.tokenId,
          status: renewed.status,
          purpose: renewed.purpose,
          requestedFields: renewed.requestedFields,
          fiId: FI_CLIENT_ID,
          createdAt: new Date().toISOString(),
          expiresAt: renewed.expiresAt,
        },
        ...previous.map((item) =>
          item.consentId === renewed.previousConsentId
            ? {
                ...item,
                status: 'RENEWED',
              }
            : item
        ),
      ]);
      if (consentExpiredObserved || verificationResults.some((entry) => entry.errorCode === 'CONSENT_EXPIRED')) {
        setCoverageFlag('consentExpiredThenRenew', true);
      }
      pushActivity({
        service: 'consent',
        label: 'CONSENT_RENEWED',
        status: 'success',
        detail: `${renewed.previousConsentId} -> ${renewed.newConsentId}`,
      });
      setStatusMessage(`Consent renewed: ${renewed.previousConsentId} -> ${renewed.newConsentId}`);
    } finally {
      setRunningAction(null);
    }
  }, [apiCall, consentExpiredObserved, consentId, pushActivity, requireFiToken, setCoverageFlag, verificationResults]);


  const revokeConsentFromFi = useCallback(
    async (targetConsentId?: string, reason?: string) => {
      const resolvedConsentId = targetConsentId ?? consentId;
      if (!resolvedConsentId) {
        throw new Error('Select a consent first.');
      }
      setRunningAction('fi-revoke-consent');
      setStatusMessage('Revoking FI consent...');
      try {
        const fiToken = await requireFiToken();
        const revoked = await apiCall<{ consentId: string; status: string; expiresAt?: string }>({
          service: 'fi',
          title: 'FI Revoke Consent',
          method: 'POST',
          path: routeFor(api.fi, '/v1/fi/revoke-consent'),
          token: fiToken ?? undefined,
          body: {
            consentId: resolvedConsentId,
            reason: reason ?? 'Revoked by FI',
          },
        });

        if (resolvedConsentId === consentId) {
          setConsentStatus(revoked.status);
          setAssertionJwt(null);
          if (revoked.expiresAt) {
            setConsentExpiresAt(revoked.expiresAt);
          }
        }

        setWalletConsents((previous) =>
          previous.map((item) =>
            item.consentId === revoked.consentId
              ? { ...item, status: revoked.status, expiresAt: revoked.expiresAt ?? item.expiresAt }
              : item
          )
        );

        pushActivity({
          service: 'fi',
          label: 'CONSENT_REVOKED_BY_FI',
          status: 'warn',
          detail: { consentId: revoked.consentId, reason: reason ?? 'Revoked by FI' },
        });
        setStatusMessage(`FI consent revoked: ${revoked.consentId}`);
      } finally {
        setRunningAction(null);
      }
    },
    [apiCall, consentId, pushActivity, requireFiToken]
  );

  const runFi2Reuse = useCallback(async () => {
    if (!tokenId) {
      throw new Error('Issue token first.');
    }
    setRunningAction('fi2-reuse');
    setStatusMessage('Running FI2 reuse flow...');
    try {
      const fi2Purpose = `${scenario.purpose}-reuse-check`;
      const fi2Fields = deriveFi2Fields(scenario.requestedFields);

      const fi2Token = await requireFiToken('fi2');
      const created = await apiCall<{
        consentId: string;
        tokenId: string;
        status: string;
      }>({
        service: 'fi',
        title: 'FI2 Request Consent',
        method: 'POST',
        path: routeFor(api.fi, '/v1/fi/request-kyc'),
        token: fi2Token,
        body: {
          userId: WALLET_OWNER_USER_ID,
          fiId: FI2_CLIENT_ID,
          purpose: fi2Purpose,
          requestedFields: fi2Fields,
        },
      });

      const walletToken = await requireWalletToken();
      const approved = await apiCall<{
        consentId: string;
        status: string;
        assertionJwt: string;
        assertionId?: string;
      }>({
        service: 'wallet',
        title: 'Wallet Approve FI2 Consent',
        method: 'POST',
        path: routeFor(api.wallet, `/v1/wallet/consents/${encodeURIComponent(created.consentId)}/approve`),
        token: walletToken ?? undefined,
        body: {
          reason: 'Approved for FI2 reuse check',
        },
      });

      const verified = await apiCall<VerifySuccessResponse>({
        service: 'fi',
        title: 'FI2 Verify Assertion',
        method: 'POST',
        path: routeFor(api.fi, '/v1/fi/verify-assertion'),
        token: fi2Token,
        body: {
          consentId: approved.consentId,
          assertionJwt: approved.assertionJwt,
        },
      });

      const reused = verified.tokenId === tokenId;
      setFi2ReuseResult({
        at: new Date().toISOString(),
        consentId: created.consentId,
        tokenBefore: tokenId,
        tokenAfter: verified.tokenId,
        reused,
        purpose: fi2Purpose,
        requestedFields: fi2Fields,
      });
      setWalletConsents((previous) => [
        {
          consentId: created.consentId,
          tokenId: created.tokenId,
          status: approved.status,
          purpose: fi2Purpose,
          requestedFields: fi2Fields,
          assertionId: approved.assertionId,
          fiId: FI2_CLIENT_ID,
          createdAt: new Date().toISOString(),
        },
        ...previous.filter((item) => item.consentId !== created.consentId),
      ]);
      setCoverageFlag('crossInstitutionReuse', true);
      pushActivity({
        service: 'fi',
        label: 'FI2_REUSE_CHECK',
        status: reused ? 'success' : 'info',
        detail: `${tokenId} -> ${verified.tokenId}`,
      });
      setStatusMessage(reused ? `FI2 reuse confirmed with token ${verified.tokenId}` : `FI2 used active token ${verified.tokenId}`);
    } finally {
      setRunningAction(null);
    }
  }, [apiCall, pushActivity, requireFiToken, requireWalletToken, scenario.purpose, scenario.requestedFields, setCoverageFlag, tokenId]);

  const refreshWalletTokens = useCallback(async (targetUserId?: string) => {
    setRunningAction('refresh-wallet-tokens');
    setStatusMessage('Loading wallet tokens...');
    try {
      const authToken = await requireWalletToken();
      const tokens = await fetchWalletTokensWithToken(authToken, targetUserId);
      setStatusMessage(`Wallet tokens loaded: ${tokens.length}`);
    } finally {
      setRunningAction(null);
    }
  }, [fetchWalletTokensWithToken, requireWalletToken]);

  const renewWalletToken = useCallback(
    async (ttlSeconds?: number) => {
      const userId = activeWalletUsername?.trim();
      if (!userId) {
        throw new Error('Sign in to wallet first.');
      }
      setRunningAction('wallet-renew-token');
      setStatusMessage('Renewing wallet token...');
      try {
        const walletToken = await requireWalletToken();
        const response = await apiCall<{ mode: string; tokenId: string; supersedes?: string }>({
          service: 'wallet',
          title: 'Wallet Token Renewal',
          method: 'POST',
          path: routeFor(api.wallet, `/v1/wallet/${encodeURIComponent(userId)}/tokens/renew`),
          token: walletToken ?? undefined,
          body: {
            ...(typeof ttlSeconds === 'number' ? { ttlSeconds } : {}),
            reason: 'wallet_ui_renewal',
          },
        });
        pushActivity({
          service: 'wallet',
          label: 'TOKEN_RENEW',
          status: 'success',
          detail: response.supersedes ? `${response.supersedes} -> ${response.tokenId}` : response.tokenId,
        });
        await refreshWalletTokens(userId);
        setStatusMessage(`Token renewed: ${response.tokenId}`);
      } finally {
        setRunningAction(null);
      }
    },
    [activeWalletUsername, apiCall, api, pushActivity, refreshWalletTokens, requireWalletToken]
  );

  const refreshWalletConsents = useCallback(async (targetUserId?: string) => {
    setRunningAction('refresh-wallet-consents');
    setStatusMessage('Loading wallet consents...');
    try {
      const authToken = await requireWalletToken();
      const consents = await fetchWalletConsentsWithToken(authToken, targetUserId);
      setStatusMessage(`Wallet consents loaded: ${consents.length}`);
    } finally {
      setRunningAction(null);
    }
  }, [fetchWalletConsentsWithToken, requireWalletToken]);

  const refreshWalletReviewStatus = useCallback(async () => {
    const userId = activeWalletUsername?.trim();
    if (!userId) {
      setWalletReviewStatus(null);
      return;
    }
    setRunningAction('refresh-wallet-review');
    setStatusMessage('Loading periodic review status...');
    try {
      const walletToken = await requireWalletToken();
      const response = await apiCall<{ review: Record<string, unknown> | null }>({
        service: 'wallet',
        title: 'Wallet Review Status',
        method: 'GET',
        path: routeFor(api.wallet, `/v1/wallet/${encodeURIComponent(userId)}/review-status`),
        token: walletToken ?? undefined,
      });
      setWalletReviewStatus(response.review);
      setStatusMessage(response.review ? 'Review status loaded.' : 'No periodic review profile yet.');
    } finally {
      setRunningAction(null);
    }
  }, [activeWalletUsername, apiCall, requireWalletToken]);

  const requestPeriodicReconsent = useCallback(async () => {
    const userId = activeWalletUsername?.trim();
    if (!userId) {
      throw new Error('Sign in to wallet first.');
    }
    setRunningAction('request-periodic-reconsent');
    setStatusMessage('Requesting periodic re-consent...');
    try {
      const walletToken = await requireWalletToken();
      await apiCall<{ consentId: string; status: string }>({
        service: 'wallet',
        title: 'Request Periodic Re-consent',
        method: 'POST',
        path: routeFor(api.wallet, `/v1/wallet/${encodeURIComponent(userId)}/review/request-reconsent`),
        token: walletToken ?? undefined,
      });
      await Promise.allSettled([refreshWalletConsents(userId), refreshWalletReviewStatus()]);
      pushActivity({ service: 'wallet', label: 'PERIODIC_RECONSENT_REQUESTED', status: 'info', detail: { userId } });
      setStatusMessage('Periodic re-consent request created. Check Consent Inbox.');
    } finally {
      setRunningAction(null);
    }
  }, [activeWalletUsername, apiCall, pushActivity, refreshWalletConsents, refreshWalletReviewStatus, requireWalletToken]);

  const refreshLifecycleJobs = useCallback(async () => {
    setRunningAction('refresh-lifecycle-jobs');
    setStatusMessage('Loading lifecycle job history...');
    try {
      const jobsResponse = await apiCall<{ total: number; jobs: Array<{ id: string; runAt: string; detail: unknown }> }>({
        service: 'review',
        title: 'Lifecycle Job History',
        method: 'GET',
        path: routeFor(api.review, '/v1/lifecycle/jobs'),
      });
      setLifecycleJobs(Array.isArray(jobsResponse.jobs) ? jobsResponse.jobs : []);
      setStatusMessage(`Lifecycle jobs loaded: ${jobsResponse.total ?? jobsResponse.jobs.length}`);
    } finally {
      setRunningAction(null);
    }
  }, [apiCall]);

  const runLifecycleNow = useCallback(async () => {
    setRunningAction('run-lifecycle');
    setStatusMessage('Running lifecycle jobs (expiry + housekeeping)...');
    try {
      const result = await apiCall<{ actor: string; runAt: string; registry: unknown; consents: unknown }>({
        service: 'review',
        title: 'Run Lifecycle Jobs',
        method: 'POST',
        path: routeFor(api.review, '/v1/lifecycle/run'),
        body: { actor: activeWalletUsername ? `command-${activeWalletUsername}` : 'command-ui' },
      });
      pushActivity({ service: 'review', label: 'LIFECYCLE_RUN', status: 'success', detail: result });
      await refreshLifecycleJobs();
      setStatusMessage(`Lifecycle run completed at ${result.runAt}`);
    } finally {
      setRunningAction(null);
    }
  }, [activeWalletUsername, apiCall, pushActivity, refreshLifecycleJobs]);


  const refreshDelegations = useCallback(async (targetUserId?: string) => {
    setRunningAction('refresh-delegations');
    setStatusMessage('Refreshing delegations...');
    try {
      const delegationOwnerUserId = targetUserId?.trim() || WALLET_OWNER_USER_ID;
      const walletToken = await requireWalletToken();
      const listed = await fetchDelegationsWithToken(walletToken, delegationOwnerUserId);
      setStatusMessage(`Delegations loaded: ${listed.length}`);
    } finally {
      setRunningAction(null);
    }
  }, [fetchDelegationsWithToken, requireWalletToken]);

  const refreshNominees = useCallback(async (targetUserId?: string) => {
    setRunningAction('refresh-nominees');
    setStatusMessage('Refreshing nominees...');
    try {
      const walletToken = await requireWalletToken();
      const listed = await fetchNomineesWithToken(walletToken, targetUserId);
      setStatusMessage(`Nominees loaded: ${listed.length}`);
    } finally {
      setRunningAction(null);
    }
  }, [fetchNomineesWithToken, requireWalletToken]);

  const checkActiveTokenForUser = useCallback(
    async (userId: string): Promise<WalletTokenView | null> => {
      const normalizedUserId = userId.trim();
      if (!normalizedUserId) {
        return null;
      }
      const fiToken = await requireFiToken();
      try {
        const active = await apiCall<{ tokenId: string; status: string; expiresAt?: string | null }>({
          service: 'consent',
          title: 'Precheck Active Token',
          method: 'GET',
          path: routeFor(api.consent, `/v1/consent/precheck-token?userId=${encodeURIComponent(normalizedUserId)}`),
          token: fiToken ?? undefined,
        });
        const mappedToken: WalletTokenView = {
          tokenId: active.tokenId,
          status: active.status,
          expiresAt: active.expiresAt ?? undefined,
        };
        setWalletTokens((previous) => [mappedToken, ...previous.filter((item) => item.tokenId !== active.tokenId)]);
        return mappedToken;
      } catch (error) {
        if (error instanceof ApiCallError && error.status === 404) {
          setWalletTokens((previous) => previous.filter((item) => String(item.status ?? '').toUpperCase() !== 'ACTIVE'));
          return null;
        }
        throw error;
      }
    },
    [apiCall, requireFiToken]
  );

  const onboardUserFromFi = useCallback(
    async (userId: string): Promise<WalletTokenView | null> => {
      const normalizedUserId = userId.trim();
      if (!normalizedUserId) {
        return null;
      }
      setRunningAction('fi-onboard-user');
      setStatusMessage('Onboarding user from FI portal...');
      try {
        const fiToken = await requireFiToken();
        const result = await apiCall<{ tokenId: string; status: string; alreadyActive?: boolean }>({
          service: 'fi',
          title: 'FI Onboard User',
          method: 'POST',
          path: routeFor(api.fi, '/v1/fi/onboard-user'),
          token: fiToken ?? undefined,
          body: {
            userId: normalizedUserId,
          },
        });

        const mappedToken: WalletTokenView = {
          tokenId: result.tokenId,
          status: result.status,
          issuedAt: new Date().toISOString(),
        };
        setWalletTokens((previous) => [mappedToken, ...previous.filter((item) => item.tokenId !== mappedToken.tokenId)]);
        pushActivity({
          service: 'fi',
          label: 'FI_ONBOARD_USER',
          status: 'success',
          detail: { userId: normalizedUserId, tokenId: result.tokenId, alreadyActive: Boolean(result.alreadyActive) },
        });
        setStatusMessage(`Token ACTIVE for ${normalizedUserId}: ${result.tokenId}`);
        return mappedToken;
      } finally {
        setRunningAction(null);
      }
    },
    [apiCall, pushActivity, requireFiToken]
  );

  const refreshFiConsentBinding = useCallback(
    async (targetConsentId: string): Promise<WalletConsentView | null> => {
      const normalizedConsentId = targetConsentId.trim();
      if (!normalizedConsentId) {
        return null;
      }
      const fiToken = await requireFiToken();
      try {
        const binding = await apiCall<{
          consentId: string;
          tokenId: string;
          status: string;
          fiId: string;
          purpose: string;
          requestedFields: string[];
          requiresDelegation?: boolean;
          allowReuseAcrossFIs?: boolean;
          expiresAt?: string;
        }>({
          service: 'consent',
          title: 'Fetch Consent Binding',
          method: 'GET',
          path: routeFor(api.consent, `/v1/internal/consent/${encodeURIComponent(normalizedConsentId)}/binding`),
          token: fiToken ?? undefined,
        });
        const normalized = normalizeWalletConsentView({
          consentId: binding.consentId,
          tokenId: binding.tokenId,
          status: binding.status,
          fiId: binding.fiId,
          purpose: binding.purpose,
          requestedFields: binding.requestedFields,
          requiresDelegation: binding.requiresDelegation ?? false,
          allowReuseAcrossFIs: binding.allowReuseAcrossFIs ?? false,
          expiresAt: binding.expiresAt,
        });
        setWalletConsents((previous) => [normalized, ...previous.filter((item) => item.consentId !== normalizedConsentId)]);
        setConsentStatus(binding.status);
        if (binding.expiresAt) {
          setConsentExpiresAt(binding.expiresAt);
        }
        return normalized;
      } catch (error) {
        if (error instanceof ApiCallError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    [apiCall, requireFiToken]
  );

  const addNomineeDelegation = useCallback(
    async (options?: {
      ownerUserId?: string;
      delegateUserId?: string;
      scope?: string;
      allowedPurposes?: string[];
      allowedFields?: string[];
      expiresAt?: string;
    }) => {
      setRunningAction('add-delegation');
      setStatusMessage('Adding nominee delegation...');
      try {
        if (!hasWalletOwnerRole) {
          throw new Error('Wallet owner role is required to add delegation.');
        }
        const walletToken = await requireWalletToken();
        const delegateUserId = options?.delegateUserId?.trim() || WALLET_NOMINEE_USERNAME;
        const scope = options?.scope?.trim() || 'consent.approve';
        const allowedPurposes =
          options?.allowedPurposes && options.allowedPurposes.length > 0 ? options.allowedPurposes : [scenario.purpose, 'insurance-claim'];
        const allowedFields =
          options?.allowedFields && options.allowedFields.length > 0 ? options.allowedFields : scenario.requestedFields;
        const expiresAt = options?.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const ownerUserId = resolveWalletApiTargetUserId(options?.ownerUserId);
        const createdDelegation = await apiCall<DelegationRecord>({
          service: 'wallet',
          title: 'Create Delegation',
          method: 'POST',
          path: routeFor(api.wallet, '/v1/wallet/delegations'),
          token: walletToken ?? undefined,
          body: {
            ownerUserId,
            delegateUserId,
            scope,
            allowedPurposes,
            allowedFields,
            expiresAt,
          },
        });
        pushActivity({
          service: 'wallet',
          label: 'DELEGATION_CREATED',
          status: 'success',
          detail: {
            delegateUserId,
            scope,
            allowedPurposes,
            allowedFields,
          },
        });
        const delegationsList = await fetchDelegationsWithToken(walletToken, ownerUserId);
        setStatusMessage(`Delegation added. Active records: ${delegationsList.length}`);
        return createdDelegation;
      } finally {
        setRunningAction(null);
      }
    },
    [apiCall, fetchDelegationsWithToken, hasWalletOwnerRole, pushActivity, requireWalletToken, resolveWalletApiTargetUserId, scenario.purpose, scenario.requestedFields]
  );

  const revokeDelegation = useCallback(
    async (delegationId: string) => {
      if (!delegationId) {
        return;
      }
      setRunningAction('revoke-delegation');
      setStatusMessage('Revoking delegation...');
      try {
        if (!hasWalletOwnerRole) {
          throw new Error('Wallet owner role is required to revoke delegation.');
        }
        const walletToken = await requireWalletToken();
        await apiCall<{ id: string; status: string; updatedAt: string }>({
          service: 'wallet',
          title: 'Revoke Delegation',
          method: 'POST',
          path: routeFor(api.wallet, `/v1/wallet/delegations/${encodeURIComponent(delegationId)}/revoke`),
          token: walletToken ?? undefined,
        });
        await fetchDelegationsWithToken(walletToken);
        pushActivity({
          service: 'wallet',
          label: 'DELEGATION_REVOKED',
          status: 'info',
          detail: delegationId,
        });
        setStatusMessage('Delegation revoked.');
      } finally {
        setRunningAction(null);
      }
    },
    [apiCall, fetchDelegationsWithToken, hasWalletOwnerRole, pushActivity, requireWalletToken]
  );

  const createNominee = useCallback(
    async (ownerUserId: string, nomineeUserId: string) => {
      const safeOwner = ownerUserId.trim() || WALLET_OWNER_USER_ID;
      const safeNominee = nomineeUserId.trim();
      if (!safeNominee) {
        throw new Error('Nominee userId is required.');
      }
      setRunningAction('create-nominee');
      setStatusMessage('Creating nominee...');
      try {
        const walletToken = await requireWalletToken();
        await apiCall<NomineeRecord>({
          service: 'wallet',
          title: 'Create Nominee',
          method: 'POST',
          path: routeFor(api.wallet, `/v1/wallet/${encodeURIComponent(safeOwner)}/nominees`),
          token: walletToken ?? undefined,
          body: { nomineeUserId: safeNominee },
        });
        await fetchNomineesWithToken(walletToken, safeOwner);
        pushActivity({ service: 'wallet', label: 'NOMINEE_CREATED', status: 'success', detail: { ownerUserId: safeOwner, nomineeUserId: safeNominee } });
        setStatusMessage('Nominee saved.');
      } finally {
        setRunningAction(null);
      }
    },
    [apiCall, fetchNomineesWithToken, pushActivity, requireWalletToken]
  );

  const setNomineeStatus = useCallback(
    async (ownerUserId: string, nomineeId: string, status: 'enable' | 'disable') => {
      const safeOwner = ownerUserId.trim() || WALLET_OWNER_USER_ID;
      const safeId = nomineeId.trim();
      if (!safeId) {
        return;
      }
      setRunningAction('nominee-status');
      setStatusMessage(status === 'disable' ? 'Disabling nominee...' : 'Enabling nominee...');
      try {
        const walletToken = await requireWalletToken();
        await apiCall<{ id: string; status: string }>({
          service: 'wallet',
          title: status === 'disable' ? 'Disable Nominee' : 'Enable Nominee',
          method: 'POST',
          path: routeFor(api.wallet, `/v1/wallet/${encodeURIComponent(safeOwner)}/nominees/${encodeURIComponent(safeId)}/${status}`),
          token: walletToken ?? undefined,
        });
        await fetchNomineesWithToken(walletToken, safeOwner);
        await fetchDelegationsWithToken(walletToken, safeOwner);
        pushActivity({ service: 'wallet', label: 'NOMINEE_STATUS', status: 'info', detail: { nomineeId: safeId, status } });
        setStatusMessage('Nominee updated.');
      } finally {
        setRunningAction(null);
      }
    },
    [apiCall, fetchDelegationsWithToken, fetchNomineesWithToken, pushActivity, requireWalletToken]
  );

  const approveAsNominee = useCallback(async (targetConsentId?: string, approvedFields?: ApprovedFieldsInput) => {
    const resolvedConsentId = targetConsentId ?? consentId;
    if (!resolvedConsentId) {
      throw new Error('Create consent first, then approve as nominee.');
    }
    if (!hasWalletNomineeRole) {
      throw new Error('Wallet nominee role is required to approve as nominee.');
    }
    await approveConsent(resolvedConsentId, approvedFields, {
      nomineeActor: activeWalletUsername ?? DEFAULT_WALLET_NOMINEE,
      reason: 'Approved by nominee in wallet portal',
    });
    setCoverageFlag('delegationNomineeApproval', true);
    pushActivity({
      service: 'wallet',
      label: 'CONSENT_APPROVED_BY_DELEGATE',
      status: 'success',
      detail: resolvedConsentId,
    });
  }, [activeWalletUsername, approveConsent, consentId, hasWalletNomineeRole, pushActivity, setCoverageFlag]);

  const runCkycSupersede = useCallback(async () => {
    if (!tokenId) {
      throw new Error('Issue token first.');
    }
    setRunningAction('ckyc-supersede');
    setStatusMessage('Running CKYCR supersede flow...');
    try {
      await apiCall<{ profileVersion: number }>({
        service: 'ckyc',
        title: 'Simulate CKYCR Update',
        method: 'POST',
        path: routeFor(api.ckyc, `/v1/ckyc/simulate-update/${encodeURIComponent(WALLET_OWNER_USER_ID)}`),
      });
      const issuerToken = await requireWalletToken();
      const sync = await apiCall<CkycSyncResponse>({
        service: 'ckyc',
        title: 'CKYCR Sync',
        method: 'POST',
        path: routeFor(api.ckyc, `/v1/ckyc/sync/${encodeURIComponent(WALLET_OWNER_USER_ID)}`),
        token: issuerToken,
      });
      setCkycResult(sync);
      if (sync.newTokenId) {
        setTokenId(sync.newTokenId);
        setWalletTokens((previous) => {
          const next = previous.map((item) =>
            item.tokenId === sync.oldTokenId && sync.oldStatus
              ? {
                  ...item,
                  status: sync.oldStatus,
                }
              : item
          );
          return [
            {
              tokenId: sync.newTokenId,
              status: sync.newStatus ?? 'ACTIVE',
              issuedAt: sync.issuedAt,
              expiresAt: sync.expiresAt,
            },
            ...next.filter((item) => item.tokenId !== sync.newTokenId),
          ];
        });
        await refreshRegistryEvidence(sync.newTokenId);
      }
      if (sync.changed && sync.oldStatus === 'SUPERSEDED' && sync.newStatus === 'ACTIVE') {
        setCoverageFlag('ckycSupersede', true);
      }
      pushActivity({
        service: 'ckyc',
        label: 'CKYCR_SUPERSEDE',
        status: sync.changed ? 'success' : 'info',
        detail: `${sync.oldTokenId ?? 'n/a'} -> ${sync.newTokenId ?? 'n/a'}`,
      });
      setStatusMessage(sync.changed ? `CKYCR supersede: ${sync.oldTokenId} -> ${sync.newTokenId}` : `CKYCR sync: ${sync.reason ?? 'NO_CHANGE'}`);
    } finally {
      setRunningAction(null);
    }
  }, [apiCall, pushActivity, refreshRegistryEvidence, requireWalletToken, setCoverageFlag, tokenId]);

  const loadCkycProfile = useCallback(async (userId: string): Promise<CkycProfileResponse> => {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      throw new Error('wallet user ID is required to load CKYCR profile.');
    }
    return apiCall<CkycProfileResponse>({
      service: 'ckyc',
      title: 'Fetch CKYCR Profile',
      method: 'GET',
      path: routeFor(api.ckyc, `/v1/ckyc/profile/${encodeURIComponent(normalizedUserId)}`),
    });
  }, [apiCall]);

  const loadDueUsers = useCallback(async (asOf: string) => {
    setRunningAction('review-due');
    setStatusMessage(`Loading due users for ${asOf}...`);
    try {
      const due = await apiCall<{
        asOf: string;
        periodicityYears: Record<'HIGH' | 'MEDIUM' | 'LOW', number>;
        totalDue: number;
        dueUsers: ReviewDueUser[];
      }>({
        service: 'review',
        title: 'Load Due Users',
        method: 'GET',
        path: routeFor(api.review, `/v1/review/due?asOf=${encodeURIComponent(asOf)}`),
      });
      setDueUsers(due.dueUsers);
      pushActivity({
        service: 'review',
        label: 'REVIEW_DUE_LIST',
        status: 'info',
        detail: `due=${due.totalDue}`,
      });
      setStatusMessage(`Due users loaded: ${due.totalDue}`);
    } finally {
      setRunningAction(null);
    }
  }, [apiCall, pushActivity]);

  const runReviewOnce = useCallback(async (asOf: string) => {
    setRunningAction('review-run-once');
    setStatusMessage('Running periodic review scheduler...');
    try {
      const result = await apiCall<ReviewRunOnceResponse>({
        service: 'review',
        title: 'Run Review Once',
        method: 'POST',
        path: routeFor(api.review, '/v1/review/run-once'),
        body: {
          actor: 'console-orchestrator',
          asOf,
        },
      });
      setReviewRun(result);
      setDueUsers(result.dueUsers);
      setCoverageFlag('periodicReview', true);
      pushActivity({
        service: 'review',
        label: 'REVIEW_RUN_ONCE',
        status: result.failed > 0 ? 'failed' : 'success',
        detail: `due=${result.totalDue} synced=${result.synced} failed=${result.failed}`,
      });
      setStatusMessage(`Review run completed: due=${result.totalDue}, synced=${result.synced}, failed=${result.failed}`);
    } finally {
      setRunningAction(null);
    }
  }, [apiCall, pushActivity, setCoverageFlag]);

  const refreshFiTokenCoverage = useCallback(async () => {
    setRunningAction('fi-token-coverage');
    setStatusMessage('Loading FI token coverage...');
    try {
      const fiToken = await requireFiToken();
      const response = await apiCall<TokenCoverageResponse>({
        service: 'fi',
        title: 'FI Token Coverage',
        method: 'GET',
        path: routeFor(api.fi, '/v1/fi/token-coverage?users=wallet-owner-1,wallet-user-2'),
        token: fiToken ?? undefined,
      });
      setFiTokenCoverage(response);
      setStatusMessage(`Token coverage loaded: active=${response.summary.active}, none=${response.summary.none}`);
    } finally {
      setRunningAction(null);
    }
  }, [apiCall, requireFiToken]);

  const refreshServiceHealth = useCallback(async () => {
    setRunningAction('service-health');
    setStatusMessage('Refreshing service health...');
    try {
      const rows = await Promise.all(
        SERVICE_HEALTH_ROWS.map(async (row): Promise<ServiceHealthRow> => {
          const path = routeFor(api[row.id], '/v1/health?probe=readiness');
          try {
            const response = await fetch(path);
            const text = await response.text();
            let payload: unknown = {};
            if (text.trim().length > 0) {
              try {
                payload = JSON.parse(text);
              } catch {
                payload = text;
              }
            }
            const status = response.ok
              ? (typeof payload === 'object' &&
                payload !== null &&
                (payload as Record<string, unknown>).status === 'ok'
                  ? 'ok'
                  : 'degraded')
              : 'down';

            pushApiLog({
              service: row.id,
              title: 'Health Readiness',
              method: 'GET',
              path,
              statusCode: response.status,
              durationMs: 0,
              ok: response.ok,
              responseBody: payload,
            });
            return {
              ...row,
              status,
              statusCode: response.status,
              detail: typeof payload === 'object' ? JSON.stringify(payload) : String(payload),
              updatedAt: new Date().toISOString(),
            };
          } catch (error) {
            return {
              ...row,
              status: 'down',
              statusCode: 0,
              detail: error instanceof Error ? error.message : 'network_error',
              updatedAt: new Date().toISOString(),
            };
          }
        })
      );
      setServiceHealth(rows);
      pushActivity({
        service: 'console',
        label: 'SERVICE_HEALTH_REFRESH',
        status: 'info',
        detail: rows.map((row) => `${row.id}:${row.status}`).join(','),
      });
      setStatusMessage('Service health refreshed.');
    } finally {
      setRunningAction(null);
    }
  }, [pushActivity, pushApiLog]);

  const simulateDemoData = useCallback(async () => {
    setRunningAction('simulate-demo');
    setStatusMessage('Seeding demo data (tokens, consents, delegations, periodic review)...');
    try {
      const result = await apiCall<{ ok: boolean; summary?: Record<string, unknown> }>({
        service: 'review',
        title: 'Simulate Demo Dataset',
        method: 'POST',
        path: routeFor(api.review, '/v1/demo/simulate'),
        body: { actor: activeWalletUsername ? `command-${activeWalletUsername}` : 'command-ui' },
      });
      pushActivity({ service: 'review', label: 'DEMO_SIMULATE', status: 'success', detail: result });

      // Refresh the key dashboard datasets.
      await Promise.allSettled([
        refreshServiceHealth(),
        refreshLifecycleJobs(),
        refreshWalletTokens(),
        refreshWalletConsents(),
        refreshDelegations(),
        refreshNominees(),
        refreshFiTokenCoverage(),
      ]);

      setStatusMessage('Demo dataset created. Dashboards refreshed.');
    } finally {
      setRunningAction(null);
    }
  }, [
    activeWalletUsername,
    apiCall,
    pushActivity,
    refreshDelegations,
    refreshFiTokenCoverage,
    refreshLifecycleJobs,
    refreshNominees,
    refreshServiceHealth,
    refreshWalletConsents,
    refreshWalletTokens,
  ]);

  const loginWallet = useCallback(
    async (usernameHint?: string, redirectPath?: string) => {
      const safeRedirect = typeof redirectPath === 'string' && redirectPath.trim().length > 0 ? redirectPath : '/wallet';
      await initWalletKeycloak();
      await walletKeycloak.login({
        redirectUri: `${window.location.origin}${safeRedirect.startsWith('/') ? safeRedirect : `/${safeRedirect}`}`,
        prompt: 'login',
        ...(usernameHint ? { loginHint: usernameHint } : {}),
      });
    },
    []
  );

  const loginWalletWithPassword = useCallback(
    async (username: string, password: string) => {
      await loginWithPasswordGrant('wallet', username, password);
      pushActivity({
        service: 'wallet',
        label: 'WALLET_LOGIN_PASSWORD',
        status: 'success',
        detail: `Signed in as ${username}`,
      });
      setStatusMessage(`Wallet session active for ${username}.`);
    },
    [pushActivity]
  );

  const logoutWallet = useCallback(
    async (redirectPath?: string) => {
      const safeRedirect = typeof redirectPath === 'string' && redirectPath.trim().length > 0 ? redirectPath : '/wallet/login';
      if (walletDirectSession && !walletKeycloak.authenticated) {
        clearWalletDirectGrantSession();
        clearFiDirectGrantSession();
        pushActivity({
          service: 'wallet',
          label: 'WALLET_LOGOUT',
          status: 'success',
          detail: 'Signed out local credential session',
        });
        setStatusMessage('Wallet session signed out.');
        if (typeof window !== 'undefined') {
          window.location.assign(safeRedirect.startsWith('/') ? safeRedirect : `/${safeRedirect}`);
        }
        return;
      }
      await initWalletKeycloak();
      // Clear both clients locally to avoid stale portal session state between routes.
      walletKeycloak.clearToken();
      fiKeycloak.clearToken();
      clearWalletDirectGrantSession();
      clearFiDirectGrantSession();
      await walletKeycloak.logout({
        redirectUri: `${window.location.origin}${safeRedirect.startsWith('/') ? safeRedirect : `/${safeRedirect}`}`,
      });
    },
    [pushActivity, walletDirectSession]
  );

  const loginFi = useCallback(
    async (redirectPath?: string, usernameHint?: string) => {
      const safeRedirect = typeof redirectPath === 'string' && redirectPath.trim().length > 0 ? redirectPath : '/fi/queue';
      await initFiKeycloak();
      await fiKeycloak.login({
        redirectUri: `${window.location.origin}${safeRedirect.startsWith('/') ? safeRedirect : `/${safeRedirect}`}`,
        prompt: 'login',
        ...(usernameHint ? { loginHint: usernameHint } : {}),
      });
    },
    []
  );

  const loginFiWithPassword = useCallback(
    async (username: string, password: string) => {
      await loginWithPasswordGrant('fi', username, password);
      pushActivity({
        service: 'fi',
        label: 'FI_LOGIN_PASSWORD',
        status: 'success',
        detail: `Signed in as ${username}`,
      });
      setStatusMessage(`FI session active for ${username}.`);
    },
    [pushActivity]
  );

  const logoutFi = useCallback(
    async (redirectPath?: string) => {
      const safeRedirect = typeof redirectPath === 'string' && redirectPath.trim().length > 0 ? redirectPath : '/fi/login';
      if (fiDirectSession && !fiKeycloak.authenticated) {
        clearFiDirectGrantSession();
        clearWalletDirectGrantSession();
        pushActivity({
          service: 'fi',
          label: 'FI_LOGOUT',
          status: 'success',
          detail: 'Signed out local credential session',
        });
        setStatusMessage('FI session signed out.');
        if (typeof window !== 'undefined') {
          window.location.assign(safeRedirect.startsWith('/') ? safeRedirect : `/${safeRedirect}`);
        }
        return;
      }
      await initFiKeycloak();
      // Clear both clients locally to avoid stale portal session state between routes.
      fiKeycloak.clearToken();
      walletKeycloak.clearToken();
      clearFiDirectGrantSession();
      clearWalletDirectGrantSession();
      await fiKeycloak.logout({
        redirectUri: `${window.location.origin}${safeRedirect.startsWith('/') ? safeRedirect : `/${safeRedirect}`}`,
      });
    },
    [fiDirectSession, pushActivity]
  );

  const runGuidedStep = useCallback(
    async (index: number): Promise<GuidedRunnerStepResult> => {
      const stepId = getGuidedStepId(index);
      const requiredLoginUser = getGuidedRequiredLoginUser(index);
      const skipLoginPauseForDemo = DEMO_BYPASS_WALLET_LOGIN;

      switch (index) {
        case 0:
          await issueToken();
          return { status: 'ok' };
        case 1:
          await requestConsent();
          return { status: 'ok' };
        case 2:
          if (!authenticated || !hasWalletOwnerRole) {
            if (skipLoginPauseForDemo) {
              pushActivity({
                service: 'console',
                label: 'WALLET_LOGIN_SKIPPED_DEMO_MODE',
                status: 'info',
                detail: {
                  stepId,
                  requiredLoginUser,
                },
              });
              return { status: 'ok' };
            }
            return {
              status: 'pause_waiting_login',
              detail: 'Login with wallet owner role to continue.',
              requiredLoginUser,
              stepId,
            };
          }
          await approveConsent();
          return { status: 'ok' };
        case 3:
          await verifyAssertionSuccess();
          return { status: 'ok' };
        case 4:
          await revokeToken();
          return { status: 'ok' };
        case 5:
          await verifyExpectedFailure('TOKEN_NOT_ACTIVE');
          return { status: 'ok' };
        case 6:
          await runCkycSupersede();
          return { status: 'ok' };
        case 7:
          await runReviewOnce(new Date().toISOString().slice(0, 10));
          return { status: 'ok' };
        case 8:
          if (!authenticated || !hasWalletOwnerRole) {
            if (skipLoginPauseForDemo) {
              pushActivity({
                service: 'console',
                label: 'WALLET_LOGIN_SKIPPED_DEMO_MODE',
                status: 'info',
                detail: {
                  stepId,
                  requiredLoginUser,
                },
              });
              return { status: 'ok' };
            }
            return {
              status: 'pause_waiting_login',
              detail: 'Login with wallet owner role to add delegation.',
              requiredLoginUser,
              stepId,
            };
          }
          await addNomineeDelegation();
          await requestConsent();
          return { status: 'ok' };
        case 9:
          if (!authenticated || !hasWalletNomineeRole) {
            if (skipLoginPauseForDemo) {
              pushActivity({
                service: 'console',
                label: 'WALLET_LOGIN_SKIPPED_DEMO_MODE',
                status: 'info',
                detail: {
                  stepId,
                  requiredLoginUser,
                },
              });
              return { status: 'ok' };
            }
            return {
              status: 'pause_waiting_login',
              detail: 'Logout and login with wallet nominee role, then click Resume.',
              requiredLoginUser,
              stepId,
            };
          }
          return { status: 'ok' };
        case 10:
          if (skipLoginPauseForDemo && (!authenticated || !hasWalletNomineeRole)) {
            pushActivity({
              service: 'console',
              label: 'WALLET_LOGIN_SKIPPED_DEMO_MODE',
              status: 'info',
              detail: {
                stepId,
                requiredLoginUser,
              },
            });
            return { status: 'ok' };
          }
          await approveAsNominee();
          return { status: 'ok' };
        default:
          return { status: 'ok' };
      }
    },
    [
      addNomineeDelegation,
      approveConsent,
      authenticated,
      hasWalletNomineeRole,
      hasWalletOwnerRole,
      issueToken,
      requestConsent,
      revokeToken,
      runCkycSupersede,
      runReviewOnce,
      approveAsNominee,
      pushActivity,
      verifyAssertionSuccess,
      verifyExpectedFailure,
    ]
  );

  const runGuidedWalkthroughInternal = useCallback(async (startingIndex?: number) => {
    const initialIndex = typeof startingIndex === 'number' ? startingIndex : guided.stepIndex;
    setGuided((previous) => ({
      ...previous,
      running: true,
      stepIndex: initialIndex,
      blockedReason: null,
      nextActionHint: null,
      runnerStatus: 'running',
      requiredLoginUser: null,
      requiredLoginStepId: null,
    }));
    pushActivity({
      service: 'console',
      label: 'FULL_WORKFLOW_STARTED',
      status: 'info',
      detail: `step=${initialIndex + 1}/${GUIDED_STEPS.length}`,
    });
    let index = initialIndex;

    while (index < GUIDED_STEPS.length) {
      pushActivity({
        service: 'console',
        label: 'FULL_WORKFLOW_STEP_START',
        status: 'info',
        detail: `${index + 1}. ${GUIDED_STEPS[index]}`,
      });
      let result: GuidedRunnerStepResult;
      try {
        result = await runGuidedStep(index);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Guided walkthrough failed.';
        const failedStepId = getGuidedStepId(index);
        setGuided((previous) => ({
          ...previous,
          running: false,
          stepIndex: index,
          blockedReason: message,
          nextActionHint: 'Fix the issue and restart the suite.',
          runnerStatus: 'error',
          requiredLoginUser: null,
          requiredLoginStepId: failedStepId,
        }));
        pushActivity({
          service: 'console',
          label: 'FULL_WORKFLOW_ERROR',
          status: 'failed',
          detail: { stepId: failedStepId, message },
        });
        setStatusMessage(message);
        return;
      }

      if (result.status === 'pause_waiting_login') {
        if (DEMO_BYPASS_WALLET_LOGIN) {
          const stepId = result.stepId ?? getGuidedStepId(index);
          const requiredLoginUser = result.requiredLoginUser ?? getGuidedRequiredLoginUser(index) ?? '';
          pushActivity({
            service: 'console',
            label: 'WALLET_LOGIN_SKIPPED_DEMO_MODE',
            status: 'info',
            detail: {
              stepId,
              requiredLoginUser,
            },
          });
          index += 1;
          setGuided((previous) => ({
            ...previous,
            stepIndex: index,
            blockedReason: null,
            nextActionHint: null,
            runnerStatus: 'running',
            requiredLoginUser: null,
            requiredLoginStepId: null,
          }));
          continue;
        }
        const reason = result.detail ?? 'Waiting for wallet login.';
        const requiredLoginUser = result.requiredLoginUser ?? getGuidedRequiredLoginUser(index) ?? '';
        const stepId = result.stepId ?? getGuidedStepId(index);
        pushActivity({
          service: 'console',
          label: 'PAUSED_WAITING_FOR_LOGIN',
          status: 'info',
          detail: {
            requiredLoginUser,
            stepId,
          },
        });
        setGuided((previous) => ({
          ...previous,
          running: false,
          stepIndex: index,
          blockedReason: reason,
          nextActionHint: reason,
          runnerStatus: 'paused_waiting_login',
          requiredLoginUser,
          requiredLoginStepId: stepId,
        }));
        setStatusMessage(reason);
        return;
      }
      index += 1;
      pushActivity({
        service: 'console',
        label: 'FULL_WORKFLOW_SUITE_STEP_DONE',
        status: 'success',
        detail: `${index}. ${GUIDED_STEPS[index - 1]}`,
      });
      setGuided((previous) => ({
        ...previous,
        stepIndex: index,
        blockedReason: null,
        nextActionHint: null,
        runnerStatus: 'running',
        requiredLoginUser: null,
        requiredLoginStepId: null,
      }));
      await sleep(350);
    }

    setGuided((previous) => ({
      ...previous,
      running: false,
      blockedReason: null,
      nextActionHint: null,
      runnerStatus: 'done',
      requiredLoginUser: null,
      requiredLoginStepId: null,
    }));
    pushActivity({
      service: 'console',
      label: 'FULL_WORKFLOW_SUITE_COMPLETED',
      status: 'success',
      detail: `steps=${GUIDED_STEPS.length}`,
    });
    setStatusMessage('Guided walkthrough completed.');
  }, [guided.stepIndex, pushActivity, runGuidedStep]);

  useEffect(() => {
    if (guided.runnerStatus !== 'paused_waiting_login' || !guided.requiredLoginUser) {
      return;
    }

    const stepId = guided.requiredLoginStepId ?? getGuidedStepId(guided.stepIndex);
    const requiredLoginUser = guided.requiredLoginUser;
    let resumed = false;

    const interval = window.setInterval(() => {
      if (resumed) {
        return;
      }

      const snapshot = getWalletAuthSnapshot();
      if (!snapshot.isAuthed || snapshot.username !== requiredLoginUser) {
        return;
      }

      resumed = true;
      window.clearInterval(interval);
      pushActivity({
        service: 'console',
        label: 'RESUMED_AFTER_LOGIN',
        status: 'success',
        detail: {
          username: snapshot.username,
          stepId,
        },
      });
      setGuided((previous) => ({
        ...previous,
        running: true,
        blockedReason: null,
        nextActionHint: null,
        runnerStatus: 'running',
        requiredLoginUser: null,
        requiredLoginStepId: null,
      }));
      setStatusMessage(`Login detected for ${snapshot.username}. Resuming workflow suite...`);
      void runGuidedWalkthroughInternal(guided.stepIndex);
    }, 800);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    guided.requiredLoginStepId,
    guided.requiredLoginUser,
    guided.runnerStatus,
    guided.stepIndex,
    pushActivity,
    runGuidedWalkthroughInternal,
  ]);

  const startGuidedWalkthrough = useCallback(async () => {
    setGuided(DEFAULT_GUIDED_STATE);
    await runGuidedWalkthroughInternal(0);
  }, [runGuidedWalkthroughInternal]);

  const resumeGuidedWalkthrough = useCallback(async () => {
    await runGuidedWalkthroughInternal();
  }, [runGuidedWalkthroughInternal]);

  const stopGuidedWalkthrough = useCallback(() => {
    setGuided((previous) => ({
      ...previous,
      running: false,
      blockedReason: 'Stopped by user.',
      nextActionHint: 'Start again from Command Center when ready.',
      runnerStatus: 'idle',
      requiredLoginUser: null,
      requiredLoginStepId: null,
    }));
    setStatusMessage('Guided walkthrough stopped.');
  }, []);

  const resetCoverage = useCallback(() => {
    setCoverage(DEFAULT_COVERAGE);
    setConsentExpiredObserved(false);
    setStatusMessage('Coverage checklist reset.');
  }, []);

  const contextValue = useMemo<ConsoleContextValue>(
    () => ({
      scenarioId,
      scenario,
      scenarios: SCENARIOS,
      setScenarioId,
      runningAction,
      statusMessage,
      setStatusMessage,
      flashMessages,
      dismissFlashMessage,
      clearFlashMessages,
      authenticated,
      activeWalletUsername,
      fiAuthenticated,
      activeFiUsername,
      roleClaims,
      walletRoleGranted,
      fiRoleGranted,
      adminRoleGranted,
      defaultPortalPath,
      tokenId,
      consentId,
      tokenJwt,
      assertionJwt,
      consentStatus,
      consentExpiresAt,
      registrySnapshot,
      registryAudit,
      delegations,
      nominees,
      ckycResult,
      dueUsers,
      reviewRun,
      verificationResults,
      fi2ReuseResult,
      walletTokens,
      walletConsents,
      lastRequestResponse,
      activities,
      apiLogs,
      failures,
      coverage,
      guided,
      serviceHealth,
      resetCoverage,
      loginWallet,
      loginWalletWithPassword,
      logoutWallet,
      loginFi,
      loginFiWithPassword,
      logoutFi,
      issueToken,
      requestConsent,
      requestConsentWith,
      approveConsent,
      rejectConsent,
      revokeConsent,
      verifyAssertionSuccess,
      revokeToken,
      verifyExpectedFailure,
      renewConsent,
      revokeConsentFromFi,
      runFi2Reuse,
      addNomineeDelegation,
      revokeDelegation,
      refreshNominees,
      createNominee,
      setNomineeStatus,
      refreshWalletTokens,
      renewWalletToken,
      refreshWalletConsents,
      refreshDelegations,
      checkActiveTokenForUser,
      onboardUserFromFi,
      refreshFiConsentBinding,
      approveAsNominee,
      runCkycSupersede,
      loadCkycProfile,
      loadDueUsers,
      runReviewOnce,
      walletReviewStatus,
      refreshWalletReviewStatus,
      requestPeriodicReconsent,
      fiTokenCoverage,
      refreshFiTokenCoverage,
      lifecycleJobs,
      refreshLifecycleJobs,
      runLifecycleNow,
      simulateDemoData,
      refreshRegistryEvidence,
      refreshServiceHealth,
      startGuidedWalkthrough,
      resumeGuidedWalkthrough,
      stopGuidedWalkthrough,
    }),
    [
      activities,
      activeWalletUsername,
      activeFiUsername,
      adminRoleGranted,
      addNomineeDelegation,
      revokeDelegation,
      approveAsNominee,
      approveConsent,
      assertionJwt,
      authenticated,
      clearFlashMessages,
      defaultPortalPath,
      dismissFlashMessage,
      fiAuthenticated,
      fiRoleGranted,
      flashMessages,
      ckycResult,
      consentExpiresAt,
      consentId,
      consentStatus,
      coverage,
      delegations,
      nominees,
      dueUsers,
      failures,
      fi2ReuseResult,
      walletTokens,
      walletConsents,
      lastRequestResponse,
      guided,
      issueToken,
      loadCkycProfile,
      loadDueUsers,
      loginWallet,
      loginWalletWithPassword,
      logoutWallet,
      loginFi,
      loginFiWithPassword,
      logoutFi,
      requestConsentWith,
      refreshWalletTokens,
      refreshWalletConsents,
      refreshDelegations,
      checkActiveTokenForUser,
      onboardUserFromFi,
      refreshFiConsentBinding,
      refreshRegistryEvidence,
      refreshServiceHealth,
      registryAudit,
      registrySnapshot,
      renewConsent,
      revokeConsentFromFi,
      requestConsent,
      resetCoverage,
      reviewRun,
      walletReviewStatus,
      fiTokenCoverage,
      revokeToken,
      runCkycSupersede,
      runFi2Reuse,
      runReviewOnce,
      refreshWalletReviewStatus,
      requestPeriodicReconsent,
      refreshFiTokenCoverage,
      lifecycleJobs,
      refreshLifecycleJobs,
      runLifecycleNow,
      simulateDemoData,
      roleClaims,
      runningAction,
      scenario,
      scenarioId,
      serviceHealth,
      setScenarioId,
      startGuidedWalkthrough,
      statusMessage,
      stopGuidedWalkthrough,
      tokenId,
      tokenJwt,
      verifyAssertionSuccess,
      verifyExpectedFailure,
      verificationResults,
      apiLogs,
      rejectConsent,
      resumeGuidedWalkthrough,
      setStatusMessage,
      walletRoleGranted,
    ]
  );

  return <ConsoleContext.Provider value={contextValue}>{children}</ConsoleContext.Provider>;
}

export function useConsole() {
  const context = useContext(ConsoleContext);
  if (!context) {
    throw new Error('useConsole must be used within ConsoleProvider');
  }
  return context;
}

export function decodeJwtPayload(token: string | null) {
  return parseJwtPayload(token);
}
