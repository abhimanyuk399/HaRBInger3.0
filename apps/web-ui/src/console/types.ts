export type ServiceName = 'issuer' | 'registry' | 'consent' | 'wallet' | 'fi' | 'ckyc' | 'review' | 'console';

export type ActivityStatus = 'success' | 'failed' | 'info';

export interface ActivityEvent {
  id: string;
  at: string;
  service: ServiceName;
  label: string;
  status: ActivityStatus;
  detail?: unknown;
}

export interface ApiLogEntry {
  id: string;
  at: string;
  service: ServiceName;
  title: string;
  method: string;
  path: string;
  statusCode?: number;
  durationMs: number;
  ok: boolean;
  requestBody?: unknown;
  responseBody?: unknown;
}

export interface LastRequestResponse {
  id: string;
  at: string;
  method: string;
  path: string;
  statusCode?: number;
  durationMs: number;
  ok: boolean;
  requestBody?: unknown;
  responseBody?: unknown;
}

export interface FailureEntry {
  id: string;
  at: string;
  service: ServiceName;
  endpoint: string;
  statusCode?: number;
  errorCode: string;
  message: string;
  details: unknown;
}

export interface RegistrySnapshot {
  tokenId: string;
  status: string;
  version: number;
  issuedAt: string;
  expiresAt: string;
  supersededBy?: string | null;
  updatedAt: string;
}

export interface RegistryAuditEvent {
  eventType: string;
  actor?: string | null;
  detail?: Record<string, unknown>;
  hashPrev?: string | null;
  hashCurr: string;
  createdAt: string;
}

export interface DelegationRecord {
  id: string;
  ownerUserId: string;
  delegateUserId: string;
  scope: string;
  allowedPurposes: string[];
  allowedFields: string[];
  status: string;
  createdAt: string;
  expiresAt: string;
  updatedAt?: string;
}

export interface NomineeRecord {
  id: string;
  ownerUserId: string;
  nomineeUserId: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ReviewDueUser {
  userId: string;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH';
  nextReviewAt: string;
  plannedAction: 'SYNC_CKYC' | 'REQUEST_RECONSENT';
  reason: string;
  intervalYears: number;
}

export interface ReviewPeriodicity {
  HIGH: number;
  MEDIUM: number;
  LOW: number;
}

export interface ReviewActionTaken {
  userId: string;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH';
  plannedAction: 'SYNC_CKYC' | 'REQUEST_RECONSENT';
  outcome: 'SYNCED' | 'NO_CHANGE' | 'RECONSENT_REQUIRED' | 'FAILED';
  reason: string;
}

export interface ReviewRunOnceResponse {
  jobId: string;
  asOf: string;
  periodicityYears: ReviewPeriodicity;
  totalDue: number;
  synced: number;
  unchanged: number;
  reconsent: number;
  failed: number;
  dueUsers: ReviewDueUser[];
  actionsTaken: ReviewActionTaken[];
}

export interface CkycSyncResponse {
  userId: string;
  changed: boolean;
  reason?: string;
  profileVersion: number;
  hash: string;
  oldTokenId?: string;
  oldStatus?: string;
  newTokenId?: string;
  newStatus?: string;
}

export interface CkycProfileResponse {
  userId: string;
  profileVersion: number;
  lastUpdated: string;
  hash: string;
  payload: {
    addressLine1?: string;
    pincode?: string;
    [key: string]: unknown;
  };
}

export interface VerifySuccessResponse {
  verified: boolean;
  consentId: string;
  fiId: string;
  purpose: string;
  tokenId: string;
  disclosedClaims: Record<string, unknown>;
}

export type RunnerStatus = 'idle' | 'running' | 'paused_waiting_login' | 'done' | 'error';

export interface GuidedWalkthroughState {
  running: boolean;
  stepIndex: number;
  steps: string[];
  blockedReason: string | null;
  nextActionHint: string | null;
  runnerStatus: RunnerStatus;
  requiredLoginUser: string | null;
  requiredLoginStepId: string | null;
}

export type CoverageKey =
  | 'issueToken'
  | 'requestConsent'
  | 'walletApprove'
  | 'fiVerifySuccess'
  | 'revokeToken'
  | 'postRevokeVerifyFailTokenNotActive'
  | 'ckycSupersede'
  | 'delegationNomineeApproval'
  | 'periodicReview'
  | 'auditChain'
  | 'consentRejectedFail'
  | 'consentExpiredThenRenew'
  | 'crossInstitutionReuse'
  | 'requestResponseInspector';

export type CoverageState = Record<CoverageKey, boolean>;

export interface ServiceHealthRow {
  id: ServiceName;
  label: string;
  status: 'unknown' | 'ok' | 'degraded' | 'down';
  statusCode?: number;
  detail?: string;
  updatedAt?: string;
}

export type FlashMessageTone = 'success' | 'error' | 'info';

export interface FlashMessage {
  id: string;
  tone: FlashMessageTone;
  message: string;
  detail?: string;
}

export interface LifecycleJobEntry {
  id: string;
  runAt: string;
  detail: unknown;
}

export interface TokenCoverageRow {
  userId: string;
  status: string;
  tokenId: string | null;
  expiresAt: string | null;
  version: number | null;
}

export interface TokenCoverageResponse {
  users: TokenCoverageRow[];
  summary: {
    active: number;
    expired: number;
    revoked: number;
    none: number;
  };
}
