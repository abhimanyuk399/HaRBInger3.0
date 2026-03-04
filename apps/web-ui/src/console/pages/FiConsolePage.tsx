import { BadgeCheck, ChevronRight, ClipboardCopy, ShieldCheck } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useConsole } from '../ConsoleContext';
import { ActivityTimeline } from '../components/ActivityTimeline';
import { CopyValueField } from '../components/CopyValueField';
import { ConsoleButton } from '../components/ConsoleButton';
import { ConsoleCard } from '../components/ConsoleCard';
import { FI_ANALYST_2_USERNAME, FI_OPTIONS, KNOWN_WALLET_TARGETS, displayWalletIdentity, fiUsernameToClientId } from '../identityConfig';
import { InfoTooltip } from '../components/InfoTooltip';
import { PortalPageHeader } from '../components/PortalPageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { StatusPill } from '../components/StatusPill';
import { formatDateTime, truncate } from '../utils';

type ConsentLifecycle = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED' | 'EXPIRED' | 'UNKNOWN';
type ConsentFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired';
type ApprovalPolicy = 'owner' | 'delegation_required' | 'either';
type PurposeOption = 'Account Opening' | 'KYC Refresh' | 'Loan Processing' | 'Credit Card' | 'Periodic Review' | '__custom__';

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  const headers = Array.from(rows.reduce((set, row) => { Object.keys(row).forEach((k) => set.add(k)); return set; }, new Set<string>()));
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((row) => headers.map((h) => esc(row[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface SessionConsentMeta {
  walletUsername: string;
  walletUserId: string;
  ckycId: string;
  fiDisplayName: string;
  fiId: string;
  purpose: string;
  purposeDescription: string;
  requestedFields: string[];
  notes: string;
  ttlSeconds?: number;
  approvalPolicy: ApprovalPolicy;
  allowReuseAcrossFIs: boolean;
  createdAt: string;
}
interface PendingSubmission {
  baselineConsentId: string | null;
  meta: SessionConsentMeta;
}

interface InboxRow {
  consentId: string;
  status: ConsentLifecycle;
  fiId: string;
  fiDisplayName: string;
  walletUsername: string;
  purpose: string;
  requestedFields: string[];
  delegationRequired: boolean;
  approvalPolicy: ApprovalPolicy;
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  tokenId: string | null;
  requestId: string | null;
  correlationId: string | null;
}

interface ResolvedWalletTarget {
  walletUsername: string;
  walletUserId: string;
}

interface FiConsolePageProps {
  mode?: 'all' | 'consents' | 'verify' | 'create' | 'queue' | 'timeline';
}

const PURPOSE_OPTIONS: Array<{ value: PurposeOption; label: string }> = [
  { value: 'Account Opening', label: 'Account Opening' },
  { value: 'KYC Refresh', label: 'KYC Refresh' },
  { value: 'Loan Processing', label: 'Loan Processing' },
  { value: 'Credit Card', label: 'Credit Card' },
  { value: 'Periodic Review', label: 'Periodic Review' },
  { value: '__custom__', label: 'Other (custom)' },
];

const FIELD_OPTIONS = [
  { id: 'name', apiField: 'fullName' },
  { id: 'dob', apiField: 'dob' },
  { id: 'address', apiField: 'address' },
  { id: 'pan', apiField: 'pan' },
  { id: 'aadhaar_masked', apiField: 'idNumber' },
  { id: 'photo', apiField: 'photo' },
  { id: 'phone', apiField: 'phone' },
  { id: 'email', apiField: 'email' },
  { id: 'ckyc_number', apiField: 'ckycNumber' },
  { id: 'kyc_level', apiField: 'kycLevel' },
] as const;
const SUPPORTED_FIELDS = FIELD_OPTIONS.map((field) => field.id);
const UI_TO_API_FIELD = FIELD_OPTIONS.reduce<Record<string, string>>((map, field) => {
  map[field.id] = field.apiField;
  return map;
}, {});
const API_TO_UI_FIELD = FIELD_OPTIONS.reduce<Record<string, string>>((map, field) => {
  map[field.apiField.toLowerCase()] = field.id;
  map[field.id.toLowerCase()] = field.id;
  return map;
}, {});

function readText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
}

function parseTraceInfo(body: unknown): { requestId: string | null; correlationId: string | null } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { requestId: null, correlationId: null };
  }
  const payload = body as Record<string, unknown>;
  return {
    requestId: readText(payload.requestId ?? payload.request_id ?? payload.traceId),
    correlationId: readText(payload.correlationId ?? payload.correlation_id),
  };
}

function toConsentCreateErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Failed to create consent.';
  }

  const fallbackMessage = error.message || 'Failed to create consent.';
  const fallbackLower = fallbackMessage.toLowerCase();
  if (fallbackLower.includes('token_not_found') || fallbackLower.includes('no_active_token') || fallbackLower.includes('token required')) {
    return "Token required before requesting consent. Use 'Onboard user from FI' below  to create an ACTIVE token.";
  }
  if (fallbackLower.includes('consent_expired')) {
    return 'Consent has expired. Create a renewal request with updated expiry.';
  }
  if (fallbackLower.includes('consent_rejected')) {
    return 'Consent was rejected by wallet user/delegate. Create a new request if needed.';
  }
  if (fallbackLower.includes('service_unreachable') || fallbackLower.includes('network error') || fallbackLower.includes('fetch')) {
    return 'A backend service is unreachable. Check service health and retry.';
  }
  const payload = (error as { payload?: unknown }).payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fallbackMessage;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const detailRaw = payloadRecord.detail;
  if (typeof detailRaw === 'string' && detailRaw.trim().length > 0) {
    const detailText = detailRaw.trim();
    if (detailText.toLowerCase().includes('no active token found for user')) {
      return 'No ACTIVE token found for this wallet user. Issue a token first, then create consent.';
    }
    try {
      const parsed = JSON.parse(detailText) as Record<string, unknown>;
      const parsedError = readText(parsed.error);
      if (parsedError && parsedError.toLowerCase().includes('no active token found for user')) {
        return 'No ACTIVE token found for this wallet user. Issue a token first, then create consent.';
      }
    } catch {
      // Keep fallback message when detail is not JSON.
    }
  }

  return fallbackMessage;
}

function resolveConsentId(consent: Record<string, unknown>): string | null {
  const raw = consent.consentId ?? consent.id;
  return readText(raw);
}

function extractConsentIdFromResponse(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  return readText((body as Record<string, unknown>).consentId);
}

function getRequestedFields(consent: Record<string, unknown>): string[] {
  if (Array.isArray(consent.requestedFields)) {
    return consent.requestedFields.map((field) => {
      const raw = String(field).trim();
      return API_TO_UI_FIELD[raw.toLowerCase()] ?? raw;
    });
  }
  if (Array.isArray(consent.fields)) {
    return consent.fields.map((field) => {
      const raw = String(field).trim();
      return API_TO_UI_FIELD[raw.toLowerCase()] ?? raw;
    });
  }
  return [];
}

function deriveExpiryFromMeta(meta?: SessionConsentMeta): string | null {
  if (!meta || typeof meta.ttlSeconds !== 'number') {
    return null;
  }
  const createdAtMs = Date.parse(meta.createdAt);
  if (!Number.isFinite(createdAtMs) || meta.ttlSeconds <= 0) {
    return null;
  }
  return new Date(createdAtMs + meta.ttlSeconds * 1000).toISOString();
}

function deriveStatus(statusValue: unknown, expiresAt: string | null): ConsentLifecycle {
  const normalized = String(statusValue ?? '').toUpperCase();
  const expired =
    typeof expiresAt === 'string' &&
    expiresAt.length > 0 &&
    Number.isFinite(Date.parse(expiresAt)) &&
    Date.parse(expiresAt) <= Date.now();

  if (normalized === 'REJECTED') {
    return 'REJECTED';
  }
  if (normalized === 'REVOKED') {
    return 'REVOKED';
  }
  if (normalized === 'EXPIRED' || expired) {
    return 'EXPIRED';
  }
  if (normalized === 'APPROVED') {
    return 'APPROVED';
  }
  if (normalized === 'PENDING') {
    return 'PENDING';
  }
  return 'UNKNOWN';
}

function statusBadge(status: ConsentLifecycle): { status: 'ok' | 'warn' | 'error' | 'neutral'; label: string } {
  if (status === 'APPROVED') {
    return { status: 'ok', label: 'Approved' };
  }
  if (status === 'PENDING') {
    return { status: 'warn', label: 'Pending' };
  }
  if (status === 'REJECTED') {
    return { status: 'error', label: 'Rejected' };
  }
  if (status === 'REVOKED') {
    return { status: 'warn', label: 'Revoked' };
  }
  if (status === 'EXPIRED') {
    return { status: 'warn', label: 'Expired' };
  }
  return { status: 'neutral', label: 'Unknown' };
}

function resolveWalletTarget(input: string): ResolvedWalletTarget | null {
  const value = input.trim();
  if (!value) {
    return null;
  }
  const lowered = value.toLowerCase();
  const known = KNOWN_WALLET_TARGETS.find(
    (target) => target.username.toLowerCase() === lowered || target.userId.toLowerCase() === lowered
  );
  if (known) {
    return {
      walletUsername: known.username,
      walletUserId: known.userId,
    };
  }
  return {
    walletUsername: value,
    walletUserId: value,
  };
}

export default function FiConsolePage({ mode = 'all' }: FiConsolePageProps) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const verifyRoute = mode === 'verify' || location.pathname.endsWith('/verify');
  const showConsentCreationSection = mode === 'all' || mode === 'create';
  const showConsentQueueSection = mode === 'all' || mode === 'queue' || mode === 'consents' || verifyRoute;
  const showActivityTimelineSection = mode === 'all' || mode === 'timeline' || verifyRoute;
  const showVerificationEvidenceSection = mode === 'all' || mode === 'timeline' || verifyRoute;
  const showConsentWorkspaceColumn = showConsentCreationSection || showConsentQueueSection;
  const fiWorkspaceGridClass = showConsentQueueSection ? 'grid gap-4 xl:grid-cols-[1.25fr_1fr]' : 'grid gap-4';
  const {
    runningAction,
    fiAuthenticated,
    activeFiUsername,
    consentId,
    assertionJwt,
    walletConsents,
    walletTokens,
    delegations,
    activities,
    verificationResults,
    lastRequestResponse,
    serviceHealth,
    requestConsentWith,
    checkActiveTokenForUser,
    onboardUserFromFi,
    refreshFiConsentBinding,
    verifyAssertionSuccess,
    revokeFiConsent,
  } = useConsole();

  const [fiOnboarding, setFiOnboarding] = useState(false);

  useEffect(() => {
    if (!activeFiUsername) return;
    setActingFiId(fiUsernameToClientId(activeFiUsername) as (typeof FI_OPTIONS)[number]['id']);
  }, [activeFiUsername]);

  const [walletTargetInput, setWalletTargetInput] = useState(KNOWN_WALLET_TARGETS[0]?.userId ?? '');
  const [customerCkycId, setCustomerCkycId] = useState('');
  const [actingFiId, setActingFiId] = useState<(typeof FI_OPTIONS)[number]['id']>(() => (activeFiUsername ? fiUsernameToClientId(activeFiUsername) : (FI_OPTIONS[0]?.id ?? '')) as (typeof FI_OPTIONS)[number]['id']);
  const [purposeOption, setPurposeOption] = useState<PurposeOption>('Account Opening');
  const [customPurpose, setCustomPurpose] = useState('');
  const [purposeDescription, setPurposeDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [fieldSelection, setFieldSelection] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SUPPORTED_FIELDS.map((field) => [field, field === 'name' || field === 'dob']))
  );
  const [expiresInMinutesInput, setExpiresInMinutesInput] = useState('30');
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>('owner');
  const [allowReuseAcrossFIs, setAllowReuseAcrossFIs] = useState(false);
  const [autoVerifyRunsByKey, setAutoVerifyRunsByKey] = useState<Record<string, true>>({});
  const [autoVerifyMessage, setAutoVerifyMessage] = useState<string | null>(null);

  const [consentFilter, setConsentFilter] = useState<ConsentFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedConsentId, setSelectedConsentId] = useState<string | null>(null);
  const [queuePage, setQueuePage] = useState(1);
  const [queueSort, setQueueSort] = useState<'newest' | 'oldest'>('newest');
  const queuePageSize = 8;

  const [submitInfo, setSubmitInfo] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
  const [sessionMetaByConsentId, setSessionMetaByConsentId] = useState<Record<string, SessionConsentMeta>>({});
  const [sessionOrder, setSessionOrder] = useState<string[]>([]);
  const [createTraceByConsentId, setCreateTraceByConsentId] = useState<
    Record<string, { requestId: string | null; correlationId: string | null }>
  >({});

  const resolvedWalletTarget = useMemo(() => resolveWalletTarget(walletTargetInput), [walletTargetInput]);
  const resolvedPurpose = purposeOption === '__custom__' ? customPurpose.trim() : purposeOption;
  const selectedFieldList = useMemo(
    () => SUPPORTED_FIELDS.filter((field) => fieldSelection[field]).map((field) => String(field)),
    [fieldSelection]
  );
  const selectedApiFieldList = useMemo(() => selectedFieldList.map((field) => UI_TO_API_FIELD[field] ?? field), [selectedFieldList]);
  const expiresInMinutes = expiresInMinutesInput.trim().length > 0 ? Number.parseInt(expiresInMinutesInput, 10) : null;
  const ttlValid =
    expiresInMinutes === null || (Number.isInteger(expiresInMinutes) && typeof expiresInMinutes === 'number' && expiresInMinutes > 0);
  const ttlSeconds =
    expiresInMinutes !== null && Number.isInteger(expiresInMinutes) && typeof expiresInMinutes === 'number' && expiresInMinutes > 0
      ? expiresInMinutes * 60
      : undefined;
  const walletOpsBasePath = '/wallet/ops';
  const auditBasePath = '/command/audit';
    const activeWalletToken = useMemo(
    () => walletTokens.find((token) => String(token.status ?? '').toUpperCase() === 'ACTIVE') ?? null,
    [walletTokens]
  );
  const hasActiveToken = Boolean(activeWalletToken?.tokenId);
  const formValid =
    Boolean(resolvedWalletTarget) &&
    resolvedPurpose.length > 0 &&
    selectedFieldList.length > 0 &&
    ttlValid;
  const createConsentBlockedByToken = Boolean(resolvedWalletTarget) && !hasActiveToken;

  useEffect(() => {
    const fiParam = searchParams.get('fi');
    if (FI_OPTIONS.some((option) => option.id === fiParam)) {
      setActingFiId(fiParam);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!activeFiUsername) {
      return;
    }
    setActingFiId(activeFiUsername === FI_ANALYST_2_USERNAME ? FI_OPTIONS[1]?.id ?? FI_OPTIONS[0]?.id ?? '' : FI_OPTIONS[0]?.id ?? '');
  }, [activeFiUsername]);

  useEffect(() => {
    const targetUserId = resolvedWalletTarget?.walletUserId?.trim();
    if (!targetUserId) {
      return;
    }
    void checkActiveTokenForUser(targetUserId).catch(() => {
      // Non-blocking precheck: surfaced through API failure timeline.
    });
  }, [checkActiveTokenForUser, resolvedWalletTarget?.walletUserId]);

  useEffect(() => {
    if (!pendingSubmission) {
      return;
    }
    const responseConsentId =
      lastRequestResponse && lastRequestResponse.path.includes('/v1/fi/request-kyc')
        ? extractConsentIdFromResponse(lastRequestResponse.responseBody)
        : null;
    const detectedConsentId =
      responseConsentId ?? (consentId && consentId !== pendingSubmission.baselineConsentId ? consentId : null);
    if (!detectedConsentId) {
      return;
    }

    setSessionMetaByConsentId((previous) => ({
      ...previous,
      [detectedConsentId]: pendingSubmission.meta,
    }));
    setSessionOrder((previous) => [detectedConsentId, ...previous.filter((item) => item !== detectedConsentId)]);
    if (lastRequestResponse && lastRequestResponse.path.includes('/v1/fi/request-kyc')) {
      const trace = parseTraceInfo(lastRequestResponse.responseBody);
      setCreateTraceByConsentId((previous) => ({
        ...previous,
        [detectedConsentId]: trace,
      }));
    }
    setSelectedConsentId(detectedConsentId);
    setPendingSubmission(null);
  }, [consentId, lastRequestResponse, pendingSubmission]);

  useEffect(() => {
    if (!selectedConsentId) {
      return;
    }
    void refreshFiConsentBinding(selectedConsentId).catch(() => {
      // Non-blocking refresh: status remains from last known state.
    });
  }, [refreshFiConsentBinding, selectedConsentId]);

  const trackerRows = useMemo(() => {
    const byId = new Map<string, InboxRow>();

    walletConsents.forEach((consent) => {
      const consentRecord = consent as Record<string, unknown>;
      const key = resolveConsentId(consentRecord);
      if (!key) {
        return;
      }

      const meta = sessionMetaByConsentId[key];
      const createdAt = readText(consentRecord.createdAt) ?? meta?.createdAt ?? null;
      const updatedAt = readText(consentRecord.updatedAt) ?? createdAt;
      const expiresAt = readText(consentRecord.expiresAt) ?? deriveExpiryFromMeta(meta);
      const consentRequiresDelegation =
        readBoolean(consentRecord.requiresDelegation ?? consentRecord.requires_delegation) ??
        (meta?.approvalPolicy === 'delegation_required');
      const resolvedApprovalPolicy: ApprovalPolicy =
        consentRequiresDelegation ? 'delegation_required' : meta?.approvalPolicy === 'either' ? 'either' : 'owner';
      const fiId = readText(consentRecord.fiId) ?? readText(consentRecord.requestedBy) ?? meta?.fiId ?? actingFiId;
      const fiDisplayName = FI_OPTIONS.find((item) => item.id === fiId)?.label ?? fiId;

      byId.set(key, {
        consentId: key,
        status: deriveStatus(consentRecord.status, expiresAt),
        fiId,
        fiDisplayName,
        walletUsername: meta?.walletUsername ?? (resolvedWalletTarget?.walletUsername ?? KNOWN_WALLET_TARGETS[0].username),
        purpose: readText(consentRecord.purpose) ?? meta?.purpose ?? '-',
        requestedFields: getRequestedFields(consentRecord).length > 0 ? getRequestedFields(consentRecord) : meta?.requestedFields ?? [],
        delegationRequired: consentRequiresDelegation,
        approvalPolicy: resolvedApprovalPolicy,
        createdAt,
        updatedAt,
        expiresAt,
        tokenId: readText(consentRecord.tokenId),
        requestId: readText(consentRecord.requestId),
        correlationId: readText(consentRecord.correlationId),
      });
    });

    Object.entries(sessionMetaByConsentId).forEach(([key, meta]) => {
      if (byId.has(key)) {
        return;
      }
      const expiresAt = deriveExpiryFromMeta(meta);
      byId.set(key, {
        consentId: key,
        status: deriveStatus('PENDING', expiresAt),
        fiId: meta.fiId,
        fiDisplayName: meta.fiDisplayName,
        walletUsername: meta.walletUsername,
        purpose: meta.purpose,
        requestedFields: meta.requestedFields,
        delegationRequired: meta.approvalPolicy === 'delegation_required',
        approvalPolicy: meta.approvalPolicy,
        createdAt: meta.createdAt,
        updatedAt: meta.createdAt,
        expiresAt,
        tokenId: null,
        requestId: null,
        correlationId: null,
      });
    });

    return Array.from(byId.values()).sort((left, right) => {
      const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : left.createdAt ? Date.parse(left.createdAt) : 0;
      const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : right.createdAt ? Date.parse(right.createdAt) : 0;
      return rightTime - leftTime;
    });
  }, [actingFiId, resolvedWalletTarget?.walletUsername, sessionMetaByConsentId, walletConsents]);

  const fiScopedRows = useMemo(() => trackerRows.filter((row) => row.fiId === actingFiId), [actingFiId, trackerRows]);

  useEffect(() => {
    if (fiScopedRows.length === 0) {
      setSelectedConsentId(null);
      return;
    }
    if (!selectedConsentId || !fiScopedRows.some((row) => row.consentId === selectedConsentId)) {
      setSelectedConsentId(fiScopedRows[0].consentId);
    }
  }, [fiScopedRows, selectedConsentId]);

  useEffect(() => {
    if (!verifyRoute || fiScopedRows.length === 0) {
      return;
    }
    const preferred = fiScopedRows.find((row) => row.status === 'APPROVED') ?? fiScopedRows[0];
    if (preferred && preferred.consentId !== selectedConsentId) {
      setSelectedConsentId(preferred.consentId);
    }
  }, [fiScopedRows, selectedConsentId, verifyRoute]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const rows = fiScopedRows
      .filter((row) => {
        if (consentFilter === 'all') {
          return true;
        }
        return row.status.toLowerCase() === consentFilter;
      })
      .filter((row) => {
        if (!query) {
          return true;
        }
        const haystack = [row.consentId, row.walletUsername, row.purpose, row.fiId, row.fiDisplayName].join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        const av = Date.parse(a.updatedAt ?? a.createdAt ?? '') || 0;
        const bv = Date.parse(b.updatedAt ?? b.createdAt ?? '') || 0;
        return queueSort === 'oldest' ? av - bv : bv - av;
      });
    return rows;
  }, [consentFilter, fiScopedRows, queueSort, searchQuery]);

  const queueTotalPages = Math.max(1, Math.ceil(filteredRows.length / queuePageSize));
  const pagedFilteredRows = useMemo(
    () => filteredRows.slice((queuePage - 1) * queuePageSize, queuePage * queuePageSize),
    [filteredRows, queuePage, queuePageSize]
  );

  useEffect(() => {
    if (queuePage > queueTotalPages) {
      setQueuePage(queueTotalPages);
    }
  }, [queuePage, queueTotalPages]);

  const selectedConsent = useMemo(
    () => fiScopedRows.find((row) => row.consentId === selectedConsentId) ?? null,
    [fiScopedRows, selectedConsentId]
  );

  const totalCount = fiScopedRows.length;
  const pendingCount = fiScopedRows.filter((row) => row.status === 'PENDING').length;
  const approvedCount = fiScopedRows.filter((row) => row.status === 'APPROVED').length;
  const rejectedCount = fiScopedRows.filter((row) => row.status === 'REJECTED').length;
  const expiredCount = fiScopedRows.filter((row) => row.status === 'EXPIRED').length;

  const fiVerificationResults = verificationResults.filter((entry) => entry.fiId === actingFiId);
  const verificationSuccessCount = fiVerificationResults.filter((entry) => entry.mode === 'success').length;
  const verificationFailCount = fiVerificationResults.length - verificationSuccessCount;
  const verificationRate =
    fiVerificationResults.length > 0 ? Math.round((verificationSuccessCount / fiVerificationResults.length) * 100) : 0;

  const lastApprovedConsent = fiScopedRows.find((row) => row.status === 'APPROVED') ?? null;
  const lastCreatedConsentId = sessionOrder[0] ?? consentId ?? null;
  const lastCreatedRow = lastCreatedConsentId ? fiScopedRows.find((row) => row.consentId === lastCreatedConsentId) ?? null : null;
  const createTrace = lastCreatedConsentId
    ? createTraceByConsentId[lastCreatedConsentId] ?? { requestId: null, correlationId: null }
    : lastRequestResponse && lastRequestResponse.path.includes('/v1/fi/request-kyc')
      ? parseTraceInfo(lastRequestResponse.responseBody)
      : { requestId: null, correlationId: null };
  const verifyTrace =
    lastRequestResponse && lastRequestResponse.path.includes('/v1/fi/verify-assertion')
      ? parseTraceInfo(lastRequestResponse.responseBody)
      : { requestId: null, correlationId: null };

  const fiHealth = serviceHealth.find((row) => row.id === 'fi');
  const fiHealthStatus = String(fiHealth?.status ?? 'unknown').toLowerCase();
  const fiHealthBadge =
    fiHealthStatus === 'ok'
      ? { status: 'ok', label: 'FI health: ok' }
      : fiHealthStatus === 'degraded'
        ? { status: 'warn', label: 'FI health: degraded' }
        : fiHealthStatus === 'down'
          ? { status: 'error', label: 'FI health: down' }
          : { status: 'neutral', label: 'FI health: unknown' };

  const selectedVerifyResult = useMemo(() => {
    if (!selectedConsent) {
      return fiVerificationResults[0] ?? null;
    }
    return (
      fiVerificationResults.find((entry) => entry.consentId === selectedConsent.consentId) ??
      fiVerificationResults[0] ??
      null
    );
  }, [fiVerificationResults, selectedConsent]);

  const customerSnapshot = useMemo(() => {
    const customer = resolvedWalletTarget?.walletUsername ?? '';
    const latestCustomerConsent =
      trackerRows.find((row) => row.walletUsername.toLowerCase() === customer.toLowerCase()) ?? null;
    const activeDelegation = delegations.some((delegation) => {
      if (String(delegation.status ?? '').toUpperCase() !== 'ACTIVE') {
        return false;
      }
      const ownerUserId = String(delegation.ownerUserId ?? '').toLowerCase();
      const mappedUserId = resolvedWalletTarget?.walletUserId?.toLowerCase() ?? '';
      const mappedUsername = resolvedWalletTarget?.walletUsername?.toLowerCase() ?? '';
      return ownerUserId === mappedUserId || ownerUserId === mappedUsername;
    });
    const latestToken = walletTokens[0] ?? null;
    const effectiveToken = activeWalletToken ?? latestToken;
    return {
      tokenStatus: effectiveToken?.status ? String(effectiveToken.status).toUpperCase() : 'NONE',
      tokenId: readText((effectiveToken as Record<string, unknown> | null)?.tokenId ?? null),
      latestConsentStatus: latestCustomerConsent ? statusBadge(latestCustomerConsent.status).label : 'None',
      delegationActive: activeDelegation,
    };
  }, [activeWalletToken, delegations, resolvedWalletTarget?.walletUserId, resolvedWalletTarget?.walletUsername, trackerRows, walletTokens]);

  const verifyEnabled =
    selectedConsent !== null &&
    selectedConsent.status === 'APPROVED' &&
    selectedConsent.consentId === consentId &&
    Boolean(assertionJwt);
  const selectedConsentVersionKey =
    selectedConsent !== null
      ? `${selectedConsent.consentId}:${selectedConsent.status}:${selectedConsent.updatedAt ?? selectedConsent.createdAt ?? ''}`
      : null;

  useEffect(() => {
    if (!selectedConsent || selectedConsent.status !== 'PENDING') {
      return;
    }
    const pollHandle = window.setInterval(() => {
      void refreshFiConsentBinding(selectedConsent.consentId).catch(() => {
        // Keep polling without surfacing repetitive transient errors in UI loop.
      });
    }, 3000);
    return () => {
      window.clearInterval(pollHandle);
    };
  }, [refreshFiConsentBinding, selectedConsent]);

  useEffect(() => {
    if (!selectedConsent || !selectedConsentVersionKey) {
      return;
    }
    if (autoVerifyRunsByKey[selectedConsentVersionKey]) {
      return;
    }
    if (selectedConsent.status === 'REJECTED') {
      setAutoVerifyRunsByKey((previous) => ({
        ...previous,
        [selectedConsentVersionKey]: true,
      }));
      setAutoVerifyMessage(`Consent ${selectedConsent.consentId} was rejected. Auto verify skipped.`);
      return;
    }
    if (selectedConsent.status !== 'APPROVED') {
      if (autoVerifyMessage !== null) {
        setAutoVerifyMessage(null);
      }
      return;
    }
    if (!verifyEnabled) {
      setAutoVerifyMessage('Consent approved. Ready to verify when assertion context is available.');
      return;
    }
    setAutoVerifyRunsByKey((previous) => ({
      ...previous,
      [selectedConsentVersionKey]: true,
    }));
    setAutoVerifyMessage(`Auto verifying ${selectedConsent.consentId}...`);
    void (async () => {
      try {
        await verifyAssertionSuccess();
        setAutoVerifyMessage(`Auto verify passed for ${selectedConsent.consentId}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'verify failed';
        setAutoVerifyMessage(`Auto verify failed for ${selectedConsent.consentId}: ${message}`);
      }
    })();
  }, [
    autoVerifyMessage,
    autoVerifyRunsByKey,
    selectedConsent,
    selectedConsentVersionKey,
    verifyAssertionSuccess,
    verifyEnabled,
  ]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // no-op
    }
  };

  const onCreateConsent = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError(null);
    setSubmitInfo(null);

    if (!formValid || !resolvedWalletTarget) {
      setSubmitError('Fill all required fields before creating consent.');
      return;
    }
    if (!hasActiveToken) {
      setSubmitError(
        `Token required before requesting consent. No ACTIVE token found for wallet user ${resolvedWalletTarget.walletUserId}. Use FI onboarding  to create the token.`
      );
      return;
    }

    const meta: SessionConsentMeta = {
      walletUsername: resolvedWalletTarget.walletUsername,
      walletUserId: resolvedWalletTarget.walletUserId,
      ckycId: customerCkycId.trim(),
      fiDisplayName: FI_OPTIONS.find((option) => option.id === actingFiId)?.label ?? actingFiId,
      fiId: actingFiId,
      purpose: resolvedPurpose,
      purposeDescription: purposeDescription.trim(),
      requestedFields: selectedFieldList,
      notes: notes.trim(),
      ttlSeconds,
      approvalPolicy,
      allowReuseAcrossFIs,
      createdAt: new Date().toISOString(),
    };

    setPendingSubmission({ baselineConsentId: consentId, meta });

    try {
      await requestConsentWith({
        userId: resolvedWalletTarget.walletUserId,
        purpose: resolvedPurpose,
        requestedFields: selectedApiFieldList,
        fiId: actingFiId,
        ...(typeof ttlSeconds === 'number' ? { ttlSeconds } : {}),
        requiresDelegation: approvalPolicy === 'delegation_required',
        allowReuseAcrossFIs,
      });
      await checkActiveTokenForUser(resolvedWalletTarget.walletUserId);
      setSubmitInfo(
        approvalPolicy === 'delegation_required'
          ? 'Consent created (PENDING) with nominee delegation required policy and added to queue.'
          : approvalPolicy === 'either'
            ? 'Consent created (PENDING) with owner-or-nominee approval policy and added to queue.'
            : 'Consent created (PENDING) with owner approval policy and added to queue.'
      );
    } catch (error) {
      setPendingSubmission(null);
      setSubmitError(toConsentCreateErrorMessage(error));
    }
  };

  const selectedFiLabel = FI_OPTIONS.find((option) => option.id === actingFiId)?.label ?? actingFiId;
  const environmentLabel = (import.meta.env.MODE ?? 'local').toLowerCase() === 'production' ? 'Sandbox' : 'Local';

  return (
    <div className="space-y-5">
      {!fiAuthenticated ? (
        <ConsoleCard className="border-amber-200/90 bg-[linear-gradient(135deg,rgba(255,251,235,0.95),rgba(254,243,199,0.72))]">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-amber-900">
              <span className="font-semibold">FI login required.</span> Use `/fi/login` to authenticate with Keycloak before FI actions.
            </p>
            <StatusPill status="warn" label="Login required" />
          </div>
        </ConsoleCard>
      ) : null}

      <PortalPageHeader
        title="Bharat KYC T - FI Portal"
        subtitle="Request consent, monitor status, and verify assertions."
        environmentLabel={environmentLabel}
        lastRefreshAt={lastRequestResponse?.at ?? null}
        badges={
          <>
            <StatusPill status="neutral" label={`Acting: ${selectedFiLabel}`} />
            <StatusPill status={fiAuthenticated ? 'ok' : 'warn'} label={fiAuthenticated ? `FI user: ${activeFiUsername ?? 'authenticated'}` : 'FI user: signed out'} />
            <StatusPill status={fiHealthBadge.status as 'ok' | 'warn' | 'error' | 'neutral'} label={fiHealthBadge.label} />
          </>
        }
        actions={
          <Link
            to={`${auditBasePath}?fiId=${encodeURIComponent(actingFiId)}`}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Audit by FI <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <ConsoleCard className="p-4 border-blue-200/80 bg-[linear-gradient(150deg,rgba(239,246,255,0.96),rgba(219,234,254,0.7))]">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total consents</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{totalCount}</p>
        </ConsoleCard>
        <ConsoleCard className="p-4 border-amber-200/80 bg-[linear-gradient(150deg,rgba(255,251,235,0.96),rgba(254,243,199,0.7))]">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{pendingCount}</p>
        </ConsoleCard>
        <ConsoleCard className="p-4 border-emerald-200/80 bg-[linear-gradient(150deg,rgba(236,253,245,0.96),rgba(209,250,229,0.7))]">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approved</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{approvedCount}</p>
        </ConsoleCard>
        <ConsoleCard className="p-4 border-rose-200/80 bg-[linear-gradient(150deg,rgba(255,241,242,0.96),rgba(254,205,211,0.7))]">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rejected</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{rejectedCount}</p>
        </ConsoleCard>
        <ConsoleCard className="p-4 border-violet-200/80 bg-[linear-gradient(150deg,rgba(245,243,255,0.96),rgba(233,213,255,0.7))]">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expired</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{trackerRows.some((row) => row.expiresAt) ? expiredCount : '-'}</p>
        </ConsoleCard>
        <ConsoleCard className="p-4 border-slate-300/90 bg-[linear-gradient(150deg,rgba(248,250,252,0.98),rgba(226,232,240,0.8))]">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Verification success</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{verificationRate}%</p>
          <p className="text-xs text-slate-500">
            {verificationSuccessCount} success / {verificationFailCount} fail
          </p>
        </ConsoleCard>
      </div>

      {lastApprovedConsent ? (
        <ConsoleCard className="border-slate-200/90 bg-[linear-gradient(140deg,rgba(248,250,252,0.95),rgba(241,245,249,0.85))]">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
            <span className="font-semibold text-slate-900">Last approved:</span>
            <span className="font-mono">{truncate(lastApprovedConsent.consentId, 24)}</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline"
              onClick={() => void copy(lastApprovedConsent.consentId)}
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              Copy
            </button>
            <span className="text-slate-500">wallet: {displayWalletIdentity(lastApprovedConsent.walletUsername)}</span>
            <span className="text-slate-500">purpose: {lastApprovedConsent.purpose}</span>
          </div>
        </ConsoleCard>
      ) : null}

      {showConsentWorkspaceColumn ? (
      <div className={fiWorkspaceGridClass}>
        {showConsentWorkspaceColumn ? (
        <div className="space-y-4">
          {showConsentCreationSection ? (
            <ConsoleCard id="fi-create-consent" className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,250,251,0.94))]">
            <SectionHeader title="Create Consent Request" subtitle="Use explicit form fields. No hidden defaults." />
            <form className="mt-3 space-y-3" onSubmit={(event) => void onCreateConsent(event)}>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">1) FI identity and wallet target</p>
                <label className="mt-2 block text-xs font-semibold text-slate-700">
                  Wallet username
                  <input
                    list="wallet-targets"
                    type="text"
                    value={walletTargetInput}
                    onChange={(event) => setWalletTargetInput(event.target.value)}
                    className="mt-1 kyc-form-input kyc-form-input-sm"
                    placeholder={KNOWN_WALLET_TARGETS[0]?.username ?? 'wallet-user'}
                  />
                </label>
                <datalist id="wallet-targets">
                  {KNOWN_WALLET_TARGETS.map((target) => (
                    <option key={target.username} value={target.userId}>
                      {target.label}
                    </option>
                  ))}
                </datalist>

                <label className="mt-3 block text-xs font-semibold text-slate-700">
                  Customer CKYC ID (optional)
                  <input
                    type="text"
                    value={customerCkycId}
                    onChange={(event) => setCustomerCkycId(event.target.value)}
                    className="mt-1 kyc-form-input kyc-form-input-sm"
                    placeholder="Optional CKYC identifier"
                  />
                </label>

                <label className="mt-3 block text-xs font-semibold text-slate-700">
                  Acting FI
                  <div className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
                    {selectedFiLabel} ({actingFiId})
                  </div>
                </label>

                <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                  <span>clientId: {actingFiId}</span>
                  <span>| display: {selectedFiLabel}</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => void copy(actingFiId)}
                  >
                    <ClipboardCopy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                </div>
                <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">Customer snapshot</p>
                  <p className="mt-1">token status: {customerSnapshot.tokenStatus}</p>
                  <p>tokenId: {customerSnapshot.tokenId ? truncate(customerSnapshot.tokenId, 28) : '-'}</p>
                  <p>last consent: {customerSnapshot.latestConsentStatus}</p>
                  <p>delegation active: {customerSnapshot.delegationActive ? 'yes' : 'no'}</p>
                </div>
                {createConsentBlockedByToken ? (
                  <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900">
                    <p className="font-semibold">Token required before requesting consent</p>
                    <p className="mt-1">
                      No ACTIVE token found for wallet user {resolvedWalletTarget?.walletUserId}. Use 'Onboard user from FI' below to create an ACTIVE token.
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={fiOnboarding}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-900 hover:bg-rose-50 disabled:opacity-60"
                        onClick={async () => {
                          if (!resolvedWalletTarget?.walletUserId) return;
                          try {
                            setFiOnboarding(true);
                            await onboardUserFromFi(resolvedWalletTarget.walletUserId);
                            await checkActiveTokenForUser(resolvedWalletTarget.walletUserId);
                          } finally {
                            setFiOnboarding(false);
                          }
                        }}
                      >
                        {fiOnboarding ? 'Onboarding...' : 'Onboard user from FI'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">2) Purpose and duration</p>
                <label className="mt-2 block text-xs font-semibold text-slate-700">
                  <span className="inline-flex items-center gap-1">
                    Purpose
                    <InfoTooltip text="Purpose describes why the FI is requesting customer data." />
                  </span>
                  <select
                    value={purposeOption}
                    onChange={(event) => setPurposeOption(event.target.value as PurposeOption)}
                    className="mt-1 kyc-form-select kyc-form-input-sm"
                  >
                    {PURPOSE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {purposeOption === '__custom__' ? (
                  <label className="mt-2 block text-xs font-semibold text-slate-700">
                    Custom purpose
                    <input
                      type="text"
                      value={customPurpose}
                      onChange={(event) => setCustomPurpose(event.target.value)}
                      className="mt-1 kyc-form-input kyc-form-input-sm"
                      placeholder="Enter custom purpose"
                    />
                  </label>
                ) : null}
                <label className="mt-2 block text-xs font-semibold text-slate-700">
                  Purpose description (optional)
                  <input
                    type="text"
                    value={purposeDescription}
                    onChange={(event) => setPurposeDescription(event.target.value)}
                    className="mt-1 kyc-form-input kyc-form-input-sm"
                    placeholder="Business context for this request"
                  />
                </label>
                <label className="mt-2 block text-xs font-semibold text-slate-700">
                  Expires in minutes (optional)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={expiresInMinutesInput}
                    onChange={(event) => setExpiresInMinutesInput(event.target.value)}
                    className="mt-1 kyc-form-input kyc-form-input-sm"
                  />
                </label>
                <label className="mt-2 block text-xs font-semibold text-slate-700">
                  Notes (optional)
                  <input
                    type="text"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="mt-1 kyc-form-input kyc-form-input-sm"
                    placeholder="Internal request notes"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">3) Requested fields</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => setFieldSelection(Object.fromEntries(SUPPORTED_FIELDS.map((field) => [field, true])))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => setFieldSelection(Object.fromEntries(SUPPORTED_FIELDS.map((field) => [field, false])))}
                  >
                    Clear
                  </button>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {SUPPORTED_FIELDS.map((field) => (
                    <label key={field} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        checked={Boolean(fieldSelection[field])}
                        onChange={(event) =>
                          setFieldSelection((previous) => ({
                            ...previous,
                            [field]: event.target.checked,
                          }))
                        }
                      />
                      <span>{field}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">4) Policy and options</p>
                <p className="mt-2 text-xs font-semibold text-slate-700">Approval route request (wallet policy enforced)</p>
                <label className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                  <input type="radio" name="approval-policy" checked={approvalPolicy === 'owner'} onChange={() => setApprovalPolicy('owner')} />
                  Owner can approve
                </label>
                <label className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="radio"
                    name="approval-policy"
                    checked={approvalPolicy === 'delegation_required'}
                    onChange={() => setApprovalPolicy('delegation_required')}
                  />
                  Nominee approval required
                  <InfoTooltip text="Delegation required means only an active nominee delegation can approve this consent." />
                </label>
                <label className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                  <input type="radio" name="approval-policy" checked={approvalPolicy === 'either'} onChange={() => setApprovalPolicy('either')} />
                  Either owner or nominee
                </label>
                <p className="mt-1 text-xs text-slate-600">
                  {approvalPolicy === 'delegation_required'
                    ? 'FI is requesting delegate/guardian approval. Wallet/delegation controls still enforce eligibility and audit.'
                    : approvalPolicy === 'either'
                      ? 'FI requests owner-or-nominee approval. Final enforcement depends on wallet delegation policy and user context.'
                      : 'FI requests owner approval; wallet may still require guardian/delegate for protected user cases.'}
                </p>
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={allowReuseAcrossFIs}
                    onChange={(event) => setAllowReuseAcrossFIs(event.target.checked)}
                  />
                  Allow reuse across FIs
                </label>
                <p className="mt-2 text-xs text-slate-600">
                  Sent in the consent payload as `allowReuseAcrossFIs`.
                </p>
                <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
                  Auto verify is always enabled and runs once per consent status/update version.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">5) Review and submit</p>
                <div className="mt-2 space-y-1 text-xs text-slate-700">
                  <p>
                    <span className="font-semibold text-slate-900">wallet:</span> {displayWalletIdentity(resolvedWalletTarget?.walletUsername ?? null)}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">fi:</span> {actingFiId}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">fiDisplayName:</span> {selectedFiLabel}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">purpose:</span> {resolvedPurpose}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">fields:</span> {selectedFieldList.join(', ')}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">policy:</span>{' '}
                    {approvalPolicy === 'delegation_required'
                      ? 'Nominee delegation required'
                      : approvalPolicy === 'either'
                        ? 'Owner or nominee can approve'
                        : 'Owner can approve'}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">ttl:</span> {typeof ttlSeconds === 'number' ? `${ttlSeconds}s` : 'default'}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">expires:</span>{' '}
                    {typeof expiresInMinutes === 'number' ? `${expiresInMinutes} minute(s)` : 'default'}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">notes:</span> {notes.trim() || '-'}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">expected status:</span> PENDING
                  </p>
                </div>
              </div>

              <div className="grid gap-2">
                <ConsoleButton
                  type="submit"
                  intent="primary"
                  className="w-full sm:w-auto"
                  disabled={!formValid || createConsentBlockedByToken || runningAction !== null}
                >
                  <ShieldCheck className="h-4 w-4" />
                  Create Consent
                </ConsoleButton>
                {!ttlValid ? <p className="text-xs text-rose-700">Expiry minutes must be a positive integer when provided.</p> : null}
                {selectedFieldList.length === 0 ? <p className="text-xs text-rose-700">Select at least one field.</p> : null}
                {createConsentBlockedByToken ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                    <p className="font-semibold">Create Consent disabled</p>
                    <p className="mt-1">
                      No ACTIVE token found for wallet user {resolvedWalletTarget?.walletUserId}. Complete FI onboarding here first.
                    </p>
                  </div>
                ) : null}
                {submitError ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">{submitError}</div> : null}
                {submitInfo ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">{submitInfo}</div> : null}
                {autoVerifyMessage ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{autoVerifyMessage}</div>
                ) : null}
              </div>
            </form>

            {lastCreatedRow ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</p>
                <p className="mt-2 flex items-center gap-1">
                  <span className="font-semibold text-slate-800">consentId:</span>
                  <span className="font-mono">{truncate(lastCreatedRow.consentId, 28)}</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline"
                    onClick={() => void copy(lastCreatedRow.consentId)}
                  >
                    <ClipboardCopy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                </p>
                <p className="mt-1 text-xs text-slate-700">
                  <span className="font-semibold text-slate-800">requestId:</span>{' '}
                  {createTrace.requestId ? truncate(createTrace.requestId, 28) : '-'}
                  {createTrace.requestId ? (
                    <button
                      type="button"
                      className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline"
                      onClick={() => void copy(createTrace.requestId)}
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" />
                      Copy
                    </button>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-slate-700">
                  <span className="font-semibold text-slate-800">correlationId:</span>{' '}
                  {createTrace.correlationId ? truncate(createTrace.correlationId, 28) : '-'}
                  {createTrace.correlationId ? (
                    <button
                      type="button"
                      className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline"
                      onClick={() => void copy(createTrace.correlationId)}
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" />
                      Copy
                    </button>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-slate-700">
                  <span className="font-semibold text-slate-800">status:</span>
                </p>
                <div className="mt-1">
                  <StatusPill status={statusBadge(lastCreatedRow.status).status} label={statusBadge(lastCreatedRow.status).label} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    to={`${auditBasePath}?consentId=${encodeURIComponent(lastCreatedRow.consentId)}&fiId=${encodeURIComponent(lastCreatedRow.fiId)}`}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                  >
                    Open Audit <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ) : null}
            </ConsoleCard>
          ) : null}

          {showConsentQueueSection ? (
          <ConsoleCard id="fi-consent-inbox" className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
            <SectionHeader title="Consent Queue" subtitle="Filter and open consents by status, wallet, or purpose." />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(['all', 'pending', 'approved', 'rejected', 'revoked', 'expired'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => { setConsentFilter(status); setQueuePage(1); }}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                    consentFilter === status
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {status === 'all' ? 'All' : status[0].toUpperCase() + status.slice(1)}
                </button>
              ))}
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => { setSearchQuery(event.target.value); setQueuePage(1); }}
                className="kyc-form-input kyc-form-input-sm ml-auto w-full md:w-72"
                placeholder="Search consentId / wallet / purpose"
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => { setQueueSort('newest'); setQueuePage(1); }} className={`rounded-full border px-2.5 py-1 font-semibold ${queueSort === 'newest' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>Newest first</button>
                <button type="button" onClick={() => { setQueueSort('oldest'); setQueuePage(1); }} className={`rounded-full border px-2.5 py-1 font-semibold ${queueSort === 'oldest' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>Oldest first</button>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 font-semibold text-amber-700">Pending {filteredRows.filter((r) => r.status === 'PENDING').length}</span>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">Approved {filteredRows.filter((r) => r.status === 'APPROVED').length}</span>
                <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 font-semibold text-rose-700">SLA breach {filteredRows.filter((r) => {
                  if (r.status !== 'PENDING') return false;
                  const t = Date.parse(r.createdAt ?? r.updatedAt ?? '');
                  return Number.isFinite(t) && Date.now() - t > 2 * 60 * 60 * 1000;
                }).length}</span>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-600">Showing {pagedFilteredRows.length}/{filteredRows.length}</span>
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      `fi-consent-queue-${actingFiId}.csv`,
                      filteredRows.map((r) => ({
                        consentId: r.consentId,
                        status: r.status,
                        walletUsername: r.walletUsername,
                        fiId: r.fiId,
                        fiDisplayName: r.fiDisplayName,
                        purpose: r.purpose,
                        requestedFieldsCount: r.requestedFields.length,
                        createdAt: r.createdAt ?? '',
                        updatedAt: r.updatedAt ?? '',
                        approvalPolicy: r.approvalPolicy,
                      }))
                    )
                  }
                  className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => downloadJson(`fi-consent-queue-${actingFiId}.json`, {
                    exportedAt: new Date().toISOString(),
                    actingFiId,
                    filter: consentFilter,
                    query: searchQuery,
                    sort: queueSort,
                    rows: filteredRows,
                  })}
                  className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Export JSON
                </button>
              </div>
            </div>

            <div className="mt-3 max-h-[56vh] space-y-2 overflow-auto pr-1">
              {filteredRows.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No matching consents.</div>
              ) : (
                pagedFilteredRows.map((row) => {
                  const badge = statusBadge(row.status);
                  const selected = selectedConsentId === row.consentId;
                  return (
                    <div
                      key={row.consentId}
                      className={`rounded-xl border p-3 ${
                        (() => {
                          const createdTs = Date.parse(row.createdAt ?? row.updatedAt ?? '');
                          const slaBreached = row.status === 'PENDING' && Number.isFinite(createdTs) && Date.now() - createdTs > 2 * 60 * 60 * 1000;
                          if (selected) return slaBreached ? 'border-rose-300 bg-rose-50/70' : 'border-slate-900 bg-slate-100';
                          return slaBreached ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200 bg-slate-50';
                        })()
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {truncate(row.consentId, 22)}
                            <button
                              type="button"
                              className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline"
                              onClick={() => void copy(row.consentId)}
                            >
                              <ClipboardCopy className="h-3.5 w-3.5" />
                              Copy
                            </button>
                          </p>
                          <p className="mt-0.5 text-xs text-slate-600">wallet: {displayWalletIdentity(row.walletUsername)}</p>
                          <p className="mt-0.5 text-xs text-slate-600">fi: {row.fiDisplayName}</p>
                          <p className="mt-0.5 text-xs text-slate-600">purpose: {row.purpose}</p>
                          <p className="mt-0.5 text-xs text-slate-600">requested fields: {row.requestedFields.length}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            created: {row.createdAt ? formatDateTime(row.createdAt) : '-'}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            updated: {row.updatedAt ? formatDateTime(row.updatedAt) : '-'}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            age: {(() => { const t = Date.parse(row.createdAt ?? row.updatedAt ?? ''); if (!Number.isFinite(t)) return '-'; const mins = Math.max(0, Math.floor((Date.now() - t) / 60000)); return mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${mins%60}m`; })()}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <StatusPill status={badge.status} label={badge.label} />
                          <StatusPill
                            status={row.approvalPolicy === 'delegation_required' ? 'warn' : row.approvalPolicy === 'either' ? 'neutral' : 'neutral'}
                            label={
                              row.approvalPolicy === 'delegation_required'
                                ? 'Nominee required'
                                : row.approvalPolicy === 'either'
                                  ? 'Owner or nominee'
                                  : 'Owner approval'
                            }
                          />
                          {(() => {
                            const t = Date.parse(row.createdAt ?? row.updatedAt ?? '');
                            const mins = Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 60000)) : 0;
                            const breached = row.status === 'PENDING' && mins > 120;
                            return breached ? <StatusPill status="error" label={`SLA >2h (${Math.floor(mins/60)}h ${mins%60}m)`} /> : null;
                          })()}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          onClick={() => setSelectedConsentId(row.consentId)}
                        >
                          Open
                        </button>
                        <Link
                          to={`${auditBasePath}?consentId=${encodeURIComponent(row.consentId)}`}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Open Audit
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-500">Page {queuePage} of {queueTotalPages}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setQueuePage((p) => Math.max(1, p - 1))} disabled={queuePage <= 1} className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Prev</button>
                <button type="button" onClick={() => setQueuePage((p) => Math.min(queueTotalPages, p + 1))} disabled={queuePage >= queueTotalPages} className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Next</button>
              </div>
            </div>
          </ConsoleCard>
          ) : null}
        </div>
        ) : null}

        {showConsentQueueSection ? (
        <div className="space-y-4">
          <ConsoleCard id="fi-selected-consent" className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
            <SectionHeader title="Selected Consent Details" subtitle="Inspect details, watch status changes, and verify." />
            {!selectedConsent ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Select a consent from the inbox.
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <div className="space-y-1">
                    <p className="flex items-center gap-1">
                      <span className="font-semibold text-slate-800">consentId:</span>
                      <span className="font-mono">{truncate(selectedConsent.consentId, 30)}</span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline"
                        onClick={() => void copy(selectedConsent.consentId)}
                      >
                        <ClipboardCopy className="h-3.5 w-3.5" />
                        Copy
                      </button>
                    </p>
                    <p className="flex items-center gap-1">
                      <span className="font-semibold text-slate-800">wallet:</span>
                      <span>{displayWalletIdentity(selectedConsent.walletUsername)}</span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline"
                        onClick={() => void copy(selectedConsent.walletUsername)}
                      >
                        <ClipboardCopy className="h-3.5 w-3.5" />
                        Copy
                      </button>
                    </p>
                    <p className="flex items-center gap-1">
                      <span className="font-semibold text-slate-800">FI:</span>
                      <span>{selectedConsent.fiDisplayName} ({selectedConsent.fiId})</span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline"
                        onClick={() => void copy(selectedConsent.fiId)}
                      >
                        <ClipboardCopy className="h-3.5 w-3.5" />
                        Copy
                      </button>
                    </p>
                    <p>
                      <span className="font-semibold text-slate-800">purpose:</span> {selectedConsent.purpose}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-800">requested fields:</span>{' '}
                      {selectedConsent.requestedFields.length > 0 ? selectedConsent.requestedFields.join(', ') : 'No fields'}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-800">status:</span> {statusBadge(selectedConsent.status).label}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-800">approval policy:</span>{' '}
                      {selectedConsent.approvalPolicy === 'delegation_required'
                        ? 'Nominee required'
                        : selectedConsent.approvalPolicy === 'either'
                          ? 'Owner or nominee'
                          : 'Owner approval'}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-800">createdAt:</span>{' '}
                      {selectedConsent.createdAt ? formatDateTime(selectedConsent.createdAt) : '-'}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-800">lastUpdatedAt:</span>{' '}
                      {selectedConsent.updatedAt ? formatDateTime(selectedConsent.updatedAt) : '-'}
                    </p>
                    <CopyValueField label="requestId" value={selectedConsent.requestId} />
                    <CopyValueField label="correlationId" value={selectedConsent.correlationId} />
                  </div>
                </div>

                {selectedConsent.status === 'APPROVED' && assertionJwt && selectedConsent.consentId === consentId ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                    <p className="font-semibold">Assertion preview</p>
                    <p className="mt-1 font-mono">{truncate(assertionJwt, 84)}</p>
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold hover:underline"
                      onClick={() => void copy(assertionJwt)}
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" />
                      Copy assertion
                    </button>
                  </div>
                ) : null}

                <div className="grid gap-2">
                  <p className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
                    Auto verify runs automatically when selected consent transitions to APPROVED.
                  </p>
                  <ConsoleButton intent="primary" onClick={() => void verifyAssertionSuccess()} disabled={!verifyEnabled || runningAction !== null}>
                    <BadgeCheck className="h-4 w-4" />
                    Verify Assertion
                  </ConsoleButton>
                  <ConsoleButton
                    intent="secondary"
                    onClick={() => void revokeFiConsent(selectedConsent.consentId, 'Revoked by FI from FI Portal')}
                    disabled={runningAction !== null || !['PENDING','APPROVED'].includes(selectedConsent.status)}
                  >
                    Revoke Consent (FI)
                  </ConsoleButton>
                  {!verifyEnabled ? (
                    <p className="text-xs text-slate-500">
                      Verify is enabled when selected consent is approved and currently active in this FI session.
                    </p>
                  ) : null}
                  {selectedConsent.status === 'REJECTED' ? (
                    <p className="text-xs text-amber-700">Consent is rejected. Verification is skipped.</p>
                  ) : null}
                  {autoVerifyMessage ? <p className="text-xs text-slate-600">{autoVerifyMessage}</p> : null}
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">Latest verification result</p>
                  {selectedVerifyResult ? (
                    <div className="mt-1 space-y-1">
                      <p>
                        status:{' '}
                        <span className={selectedVerifyResult.mode === 'success' ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                          {selectedVerifyResult.mode === 'success' ? 'success' : 'failure'}
                        </span>
                      </p>
                      <p>at: {formatDateTime(selectedVerifyResult.at)}</p>
                      <p>errorCode: {selectedVerifyResult.errorCode ?? '-'}</p>
                      <p>policy checks: token active, consent status, FI audience match</p>
                      <p>
                        requestId: {verifyTrace.requestId ? truncate(verifyTrace.requestId, 30) : '-'}
                        {verifyTrace.requestId ? (
                          <button
                            type="button"
                            className="ml-2 inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline"
                            onClick={() => void copy(verifyTrace.requestId)}
                          >
                            <ClipboardCopy className="h-3.5 w-3.5" />
                            Copy
                          </button>
                        ) : null}
                      </p>
                      <p>
                        correlationId: {verifyTrace.correlationId ? truncate(verifyTrace.correlationId, 30) : '-'}
                        {verifyTrace.correlationId ? (
                          <button
                            type="button"
                            className="ml-2 inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline"
                            onClick={() => void copy(verifyTrace.correlationId)}
                          >
                            <ClipboardCopy className="h-3.5 w-3.5" />
                            Copy
                          </button>
                        ) : null}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1">No verification run yet.</p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`${auditBasePath}?consentId=${encodeURIComponent(selectedConsent.consentId)}`}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Open Audit <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            )}
          </ConsoleCard>
        </div>
        ) : null}
      </div>
      ) : null}
      {showActivityTimelineSection || showVerificationEvidenceSection ? (
      <div className={`grid gap-4 ${showActivityTimelineSection && showVerificationEvidenceSection ? 'xl:grid-cols-[1.36fr_0.64fr]' : ''}`}>
        {showActivityTimelineSection ? (
        <div>
          <ActivityTimeline
            events={activities}
            title="FI Activity Timeline"
            subtitle="Recent FI actions, consent transitions, and verification outcomes."
            links={{
              verify: '/fi/queue',
              consent: '/fi/queue',
              token: '/command/scenario',
              delegation: '/wallet/delegations',
              other: '/command/audit',
            }}
          />
        </div>
        ) : null}
        {showVerificationEvidenceSection ? (
        <ConsoleCard id="fi-verification-evidence" className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.92))]">
          <SectionHeader title="Verification Evidence" subtitle="Latest verification output and trace identifiers." />
          {selectedVerifyResult ? (
            <div className="space-y-1 text-xs text-slate-700">
              <p>
                status:{' '}
                <span className={selectedVerifyResult.mode === 'success' ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                  {selectedVerifyResult.mode === 'success' ? 'success' : 'failure'}
                </span>
              </p>
              <p>at: {formatDateTime(selectedVerifyResult.at)}</p>
              <p>errorCode: {selectedVerifyResult.errorCode ?? '-'}</p>
              <CopyValueField label="consentId" value={selectedVerifyResult.consentId ?? null} />
              <CopyValueField label="tokenId" value={selectedVerifyResult.tokenId ?? null} />
              <CopyValueField label="requestId" value={verifyTrace.requestId} />
              <CopyValueField label="correlationId" value={verifyTrace.correlationId} />
            </div>
          ) : (
            <p className="text-sm text-slate-600">No verification run yet.</p>
          )}
          {selectedConsent?.status === 'APPROVED' && assertionJwt && selectedConsent.consentId === consentId ? (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
              <p className="font-semibold">Assertion preview</p>
              <p className="mt-1 font-mono">{truncate(assertionJwt, 90)}</p>
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 font-semibold hover:underline"
                onClick={() => void copy(assertionJwt)}
              >
                <ClipboardCopy className="h-3.5 w-3.5" />
                Copy assertion
              </button>
            </div>
          ) : null}
          {autoVerifyMessage ? <p className="mt-3 text-xs text-slate-600">{autoVerifyMessage}</p> : null}
        </ConsoleCard>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}
