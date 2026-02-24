import { BadgeCheck, ClipboardCopy, ExternalLink, Search, ShieldCheck, UserCheck2, XCircle } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useConsole } from '../ConsoleContext';
import { CopyValueField } from '../components/CopyValueField';
import { ConsoleButton } from '../components/ConsoleButton';
import { ConsoleCard } from '../components/ConsoleCard';
import { FI_CLIENT_ID, KNOWN_WALLET_TARGETS, WALLET_OWNER_USER_ID, displayWalletIdentity, WALLET_NOMINEE_USERNAME, WALLET_OWNER_ALIAS } from '../identityConfig';
import { InfoTooltip } from '../components/InfoTooltip';
import { PortalPageHeader } from '../components/PortalPageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { StatusPill } from '../components/StatusPill';
import { WalletAuthOptionalBanner } from '../components/WalletAuthOptionalBanner';
import { DEMO_BYPASS_WALLET_LOGIN } from '../portalFlags';
import { formatDateTime, truncate } from '../utils';

type ConsentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'UNKNOWN';
type ConsentFilter = 'all' | 'pending' | 'approved' | 'rejected';

function normalizeStatus(value: unknown): ConsentStatus {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized === 'PENDING') return 'PENDING';
  if (normalized === 'APPROVED') return 'APPROVED';
  if (normalized === 'REJECTED') return 'REJECTED';
  return 'UNKNOWN';
}

function statusMeta(status: ConsentStatus): { pill: 'ok' | 'warn' | 'error' | 'neutral'; label: string } {
  if (status === 'APPROVED') return { pill: 'ok', label: 'Approved' };
  if (status === 'PENDING') return { pill: 'warn', label: 'Pending' };
  if (status === 'REJECTED') return { pill: 'error', label: 'Rejected' };
  return { pill: 'neutral', label: 'Unknown' };
}

function extractRequestedFields(consent: Record<string, unknown> | null) {
  if (!consent) {
    return [] as string[];
  }
  if (Array.isArray(consent.requestedFields)) {
    return consent.requestedFields.map((field) => String(field));
  }
  if (Array.isArray(consent.fields)) {
    return consent.fields.map((field) => String(field));
  }
  return [] as string[];
}

function readOptionalValue(consent: Record<string, unknown> | null, key: string): string | null {
  if (!consent) {
    return null;
  }
  const raw = consent[key];
  if (raw === undefined || raw === null) {
    return null;
  }
  const value = String(raw).trim();
  return value.length > 0 ? value : null;
}

function resolveConsentId(consent: Record<string, unknown> | null): string | null {
  if (!consent) {
    return null;
  }
  const raw = consent.consentId ?? consent.id;
  if (raw === undefined || raw === null) {
    return null;
  }
  const value = String(raw).trim();
  return value.length > 0 ? value : null;
}

function readConsentRequiresDelegation(consent: Record<string, unknown> | null): boolean | null {
  if (!consent) {
    return null;
  }
  const raw = consent.requiresDelegation ?? consent.requires_delegation;
  if (typeof raw === 'boolean') {
    return raw;
  }
  return null;
}

const MANUAL_SUPPORTED_FIELDS = [
  'name',
  'dob',
  'address',
  'pan',
  'aadhaar_masked',
  'photo',
  'phone',
  'email',
  'ckyc_number',
  'kyc_level',
] as const;

function toLowerList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => String(value).trim().toLowerCase()).filter((value) => value.length > 0);
}

function hasMatchingDelegation(
  consent: Record<string, unknown> | null,
  delegations: Array<Record<string, unknown>>,
  targetNominee?: string
) {
  if (!consent) {
    return false;
  }
  const activeDelegations = delegations.filter((delegation) => String(delegation.status ?? '').toUpperCase() === 'ACTIVE');
  if (activeDelegations.length === 0) {
    return false;
  }
  const nomineeFilter = targetNominee?.trim().toLowerCase();
  const fiPurpose = String(consent.purpose ?? '').trim().toLowerCase();
  const consentFields = extractRequestedFields(consent).map((field) => field.trim().toLowerCase());

  return activeDelegations.some((delegation) => {
    const delegateUserId = String(delegation.delegateUserId ?? '').trim().toLowerCase();
    if (nomineeFilter && delegateUserId !== nomineeFilter) {
      return false;
    }
    const allowedPurposes = toLowerList(delegation.allowedPurposes);
    const allowedFields = toLowerList(delegation.allowedFields);
    const purposeAllowed = !fiPurpose || allowedPurposes.length === 0 || allowedPurposes.includes(fiPurpose);
    const fieldsAllowed =
      consentFields.length === 0 || allowedFields.length === 0 || consentFields.every((field) => allowedFields.includes(field));
    return purposeAllowed && fieldsAllowed;
  });
}
function extractActivityIds(activity: { detail?: unknown }): Array<{ label: string; value: string }> {
  const detail = activity.detail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
    if (typeof detail === 'string' && detail.trim().length > 0 && detail.trim().length <= 120) {
      return [{ label: 'detail', value: detail.trim() }];
    }
    return [];
  }
  const payload = detail as Record<string, unknown>;
  const idPairs: Array<{ key: string; label: string }> = [
    { key: 'consentId', label: 'consentId' },
    { key: 'tokenId', label: 'tokenId' },
    { key: 'delegationId', label: 'delegationId' },
    { key: 'requestId', label: 'requestId' },
    { key: 'correlationId', label: 'correlationId' },
    { key: 'assertionId', label: 'assertionId' },
    { key: 'id', label: 'id' },
  ];
  const entries = idPairs
    .map((pair) => {
      const value = payload[pair.key];
      if (value === undefined || value === null) {
        return null;
      }
      const normalized = String(value).trim();
      if (!normalized) {
        return null;
      }
      return { label: pair.label, value: normalized };
    })
    .filter((entry): entry is { label: string; value: string } => entry !== null);
  const unique = new Map<string, { label: string; value: string }>();
  entries.forEach((entry) => unique.set(`${entry.label}:${entry.value}`, entry));
  return Array.from(unique.values());
}

function activityStatusMeta(status: 'success' | 'failed' | 'info'): { status: 'ok' | 'warn' | 'error' | 'neutral'; label: string } {
  if (status === 'success') {
    return { status: 'ok', label: 'Success' };
  }
  if (status === 'failed') {
    return { status: 'error', label: 'Failed' };
  }
  return { status: 'neutral', label: 'Info' };
}

interface WalletOpsPageProps {
  mode?: 'all' | 'consents' | 'delegation';
}

export default function WalletOpsPage({ mode = 'all' }: WalletOpsPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    authenticated,
    roleClaims,
    activeWalletUsername,
    tokenId,
    consentId,
    assertionJwt,
    registrySnapshot,
    walletTokens,
    walletConsents,
    delegations,
    activities,
    failures,
    approveConsent,
    rejectConsent,
    approveAsNominee,
    addNomineeDelegation,
    revokeDelegation,
    requestConsentWith,
    refreshWalletTokens,
    refreshWalletConsents,
    refreshDelegations,
    refreshRegistryEvidence,
    verifyAssertionSuccess,
    verificationResults,
  } = useConsole();

  const isWalletPortalRoute = location.pathname.startsWith('/wallet');
  const isDelegationRoute = mode === 'delegation' || location.pathname.endsWith('/delegation');
  const showConsentSections = mode !== 'delegation';
  const showDelegationSections = mode !== 'consents';
  const fiPortalPath = isWalletPortalRoute ? '/fi/queue' : '/fi/queue';
  const auditPath = '/command/audit';
  const demoBypassWalletLogin = DEMO_BYPASS_WALLET_LOGIN;

  const [selectedConsentId, setSelectedConsentId] = useState<string | null>(resolveConsentId(walletConsents[0] ?? null));
  const [consentFilter, setConsentFilter] = useState<ConsentFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedApprovedFields, setSelectedApprovedFields] = useState<string[]>([]);
  const [rejectReasonCode, setRejectReasonCode] = useState('user_declined');
  const [rejectReason, setRejectReason] = useState('');
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
  const [actionSummary, setActionSummary] = useState<string | null>(null);
  const [actionEvidenceAt, setActionEvidenceAt] = useState<string | null>(null);
  const [inlineWarning, setInlineWarning] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<'all' | 'wallet' | 'consent' | 'registry'>('all');
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [nomineeApproving, setNomineeApproving] = useState(false);
  const [creatingDelegation, setCreatingDelegation] = useState(false);
  const [mutatingDelegation, setMutatingDelegation] = useState(false);
  const [walletVerifyMessage, setWalletVerifyMessage] = useState<string | null>(null);
  const [dismissWalletAuthBanner, setDismissWalletAuthBanner] = useState(false);

  const [nomineeName, setNomineeName] = useState(WALLET_NOMINEE_USERNAME);
  const [delegationScope, setDelegationScope] = useState('consent.approve');
  const [delegationPurposeInput, setDelegationPurposeInput] = useState('loan-underwriting,insurance-claim');
  const [delegationExpiryInput, setDelegationExpiryInput] = useState('');
  const [createConsentForNominee, setCreateConsentForNominee] = useState(true);
  const [policyByConsentId, setPolicyByConsentId] = useState<Record<string, 'owner' | 'delegation_required'>>({});
  const selectedWalletHint = (searchParams.get('walletUserId') ?? searchParams.get('wallet') ?? '').trim().toLowerCase();
  const resolvedWalletUserId = useMemo(() => {
    if (selectedWalletHint.length > 0) {
      const fromHint = KNOWN_WALLET_TARGETS.find(
        (identity) =>
          identity.userId.toLowerCase() === selectedWalletHint || identity.username.toLowerCase() === selectedWalletHint
      );
      if (fromHint) {
        return fromHint.userId;
      }
      return selectedWalletHint;
    }

    const fromActiveUser = KNOWN_WALLET_TARGETS.find((identity) => identity.username === activeWalletUsername);
    if (fromActiveUser) {
      return fromActiveUser.userId;
    }

    return WALLET_OWNER_USER_ID;
  }, [activeWalletUsername, selectedWalletHint]);

  useEffect(() => {
    if (!selectedConsentId && walletConsents.length > 0) {
      setSelectedConsentId(resolveConsentId(walletConsents[0] ?? null));
      return;
    }
    if (selectedConsentId && !walletConsents.some((item) => resolveConsentId(item) === selectedConsentId)) {
      setSelectedConsentId(resolveConsentId(walletConsents[0] ?? null));
    }
  }, [selectedConsentId, walletConsents]);

  useEffect(() => {
    const consentFromQuery = searchParams.get('consentId');
    if (consentFromQuery && consentFromQuery.trim().length > 0) {
      setSelectedConsentId(consentFromQuery.trim());
    }
    const policyFromQuery = searchParams.get('policy');
    if (consentFromQuery && policyFromQuery && (policyFromQuery === 'owner' || policyFromQuery === 'delegation_required')) {
      setPolicyByConsentId((previous) => ({
        ...previous,
        [consentFromQuery.trim()]: policyFromQuery,
      }));
    }
  }, [searchParams]);

  useEffect(() => {
    if (!location.pathname.endsWith('/delegation')) {
      return;
    }
    const element = document.getElementById('delegation');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [location.pathname]);

  useEffect(() => {
    void Promise.allSettled([
      refreshWalletConsents(resolvedWalletUserId),
      refreshDelegations(resolvedWalletUserId),
      refreshWalletTokens(resolvedWalletUserId),
    ]);
  }, [refreshDelegations, refreshWalletConsents, refreshWalletTokens, resolvedWalletUserId]);

  const consentCounts = useMemo(() => {
    const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, UNKNOWN: 0 };
    walletConsents.forEach((consent) => {
      counts[normalizeStatus(consent.status)] += 1;
    });
    return counts;
  }, [walletConsents]);

  const filteredConsents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return walletConsents
      .filter((consent) => (consentFilter === 'all' ? true : normalizeStatus(consent.status).toLowerCase() === consentFilter))
      .filter((consent) => {
        if (!query) return true;
        const haystack = [
          consent.consentId,
          consent.tokenId,
          consent.fiId,
          consent.purpose,
          consent.requestedBy,
          consent.status,
        ]
          .map((value) => String(value ?? ''))
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      });
  }, [consentFilter, searchQuery, walletConsents]);

  const selectedConsent = useMemo(
    () => walletConsents.find((consent) => resolveConsentId(consent) === selectedConsentId) ?? null,
    [selectedConsentId, walletConsents]
  );
  const selectedStatus = normalizeStatus(selectedConsent?.status);
  const selectedStatusMeta = statusMeta(selectedStatus);
  const selectedConsentResolvedId = resolveConsentId(selectedConsent);
  const requestedFields = useMemo(
    () => extractRequestedFields(selectedConsent),
    [selectedConsentResolvedId, selectedConsent?.fields, selectedConsent?.requestedFields]
  );
  const selectableFields = useMemo(
    () => (requestedFields.length > 0 ? requestedFields : [...MANUAL_SUPPORTED_FIELDS]),
    [requestedFields]
  );
  const selectedFiLabel = String(selectedConsent?.fiId ?? selectedConsent?.requestedBy ?? 'FI');
  const selectedRequestId = readOptionalValue(selectedConsent, 'requestId');
  const selectedCorrelationId = readOptionalValue(selectedConsent, 'correlationId');
  const selectedAssertionJwt = selectedConsentResolvedId && consentId === selectedConsentResolvedId ? assertionJwt : null;
  const latestVerificationForSelectedConsent = useMemo(() => {
    if (!selectedConsentResolvedId) {
      return null;
    }
    return verificationResults.find((entry) => entry.consentId === selectedConsentResolvedId) ?? null;
  }, [selectedConsentResolvedId, verificationResults]);

  useEffect(() => {
    if (!selectedConsentResolvedId) {
      setSelectedApprovedFields([]);
      setApproveConfirmOpen(false);
      setRejectConfirmOpen(false);
      return;
    }
    if (requestedFields.length > 0) {
      setSelectedApprovedFields(requestedFields);
      setApproveConfirmOpen(false);
      setRejectConfirmOpen(false);
      return;
    }
    setSelectedApprovedFields([]);
    setApproveConfirmOpen(false);
    setRejectConfirmOpen(false);
  }, [requestedFields, selectedConsentResolvedId]);

  const authFailure = useMemo(
    () =>
      failures.find((failure) => {
        if (failure.statusCode === 401) return true;
        if (
          failure.errorCode === 'LOGIN_REQUIRED' ||
          failure.errorCode === 'missing_bearer_token' ||
          failure.errorCode === 'actor_user_not_resolved'
        ) {
          return true;
        }
        const errorText = `${failure.errorCode} ${failure.message}`.toLowerCase();
        return errorText.includes('login') || errorText.includes('bearer') || errorText.includes('token');
      }) ?? null,
    [failures]
  );

  const ownerAuthorizationFailure = useMemo(
    () => failures.find((failure) => String(failure.errorCode ?? '').toLowerCase() === 'owner_authorization_required') ?? null,
    [failures]
  );

  const delegationsList = delegations ?? [];
  const roleClaimSet = useMemo(() => new Set(roleClaims.map((claim) => String(claim).toLowerCase())), [roleClaims]);
  const hasWalletScopes = roleClaimSet.has('consent.read') || roleClaimSet.has('consent.approve') || roleClaimSet.has('token.read');
  const isNomineeIdentity =
    typeof activeWalletUsername === 'string' &&
    activeWalletUsername.trim().length > 0 &&
    activeWalletUsername.trim().toLowerCase() === WALLET_NOMINEE_USERNAME.toLowerCase();
  const hasWalletOwnerRole =
    roleClaimSet.has('wallet_user') ||
    roleClaimSet.has('admin') ||
    roleClaimSet.has('realm-admin') ||
    roleClaimSet.has('platform_admin') ||
    (hasWalletScopes && !isNomineeIdentity);
  const hasWalletNomineeRole = roleClaimSet.has('wallet_nominee') || (hasWalletScopes && isNomineeIdentity);
  const nomineeMode = hasWalletNomineeRole && !hasWalletOwnerRole;
  const delegationCounts = useMemo(
    () => ({
      active: delegationsList.filter((delegation) => String(delegation.status ?? '').toUpperCase() === 'ACTIVE').length,
      pending: delegationsList.filter((delegation) => String(delegation.status ?? '').toUpperCase() === 'PENDING').length,
      revoked: delegationsList.filter((delegation) => String(delegation.status ?? '').toUpperCase() === 'REVOKED').length,
    }),
    [delegationsList]
  );

  const latestShareActivity = activities.find((activity) =>
    ['CONSENT_APPROVED', 'CONSENT_APPROVED_BY_DELEGATE', 'ASSERTION_VERIFIED_SUCCESS'].includes(activity.label)
  );
  const lastWalletActivity = activities.find((activity) => activity.service === 'wallet') ?? null;
  const approvedFiIdentifiers = useMemo(() => {
    const ids = new Set<string>();
    walletConsents.forEach((consent) => {
      if (normalizeStatus(consent.status) !== 'APPROVED') {
        return;
      }
      const fi = String(consent.fiId ?? consent.requestedBy ?? '').trim();
      if (fi) {
        ids.add(fi);
      }
    });
    return Array.from(ids);
  }, [walletConsents]);
  const activeWalletToken = useMemo(
    () => walletTokens.find((token) => String(token.status ?? '').toUpperCase() === 'ACTIVE') ?? null,
    [walletTokens]
  );
  const fallbackWalletToken = walletTokens[0] ?? null;
  const displayWalletToken = activeWalletToken ?? fallbackWalletToken;
  const tokenLifecycleStatus = activeWalletToken
    ? 'ACTIVE'
    : fallbackWalletToken?.status
      ? String(fallbackWalletToken.status).toUpperCase()
      : 'NONE';
  const tokenNotOnboarded = !activeWalletToken;
  const recentPendingConsents = useMemo(
    () => walletConsents.filter((consent) => normalizeStatus(consent.status) === 'PENDING').slice(0, 5),
    [walletConsents]
  );
  const filteredActivity = useMemo(() => {
    return activities
      .filter((activity) => {
        if (activityFilter === 'all') {
          return true;
        }
        if (activityFilter === 'wallet') {
          return activity.service === 'wallet';
        }
        if (activityFilter === 'consent') {
          return activity.service === 'consent' || activity.label.toLowerCase().includes('consent');
        }
        return activity.service === 'registry';
      })
      .slice(0, 24);
  }, [activities, activityFilter]);

  const actionDisabledByAuth = !authenticated && !demoBypassWalletLogin;
  const ownerActionDisabled = actionDisabledByAuth || (authenticated && !hasWalletOwnerRole);
  const nomineeActionDisabled = actionDisabledByAuth || (authenticated && !hasWalletNomineeRole);
  const walletActionBusy = approving || rejecting || nomineeApproving || creatingDelegation || mutatingDelegation;
  const pendingConsentSelected = selectedStatus === 'PENDING';
  const fieldsToShare = selectedApprovedFields;
  const validFieldSelection = fieldsToShare.length > 0;
  const selectedConsentDelegationReady = hasMatchingDelegation(
    selectedConsent,
    delegationsList as Array<Record<string, unknown>>,
    nomineeName
  );
  const selectedConsentRequiresDelegation = readConsentRequiresDelegation(selectedConsent);
  const selectedConsentPolicy: 'owner' | 'delegation_required' =
    selectedConsentRequiresDelegation === true
      ? 'delegation_required'
      : selectedConsentRequiresDelegation === false
        ? 'owner'
        : (selectedConsentResolvedId ? policyByConsentId[selectedConsentResolvedId] : undefined) ?? 'owner';
  const consentRequiresNomineeApproval = selectedConsentPolicy === 'delegation_required';
  const ownerActionBlockMessage = useMemo(() => {
    if (consentRequiresNomineeApproval) {
      return 'This consent is marked "Nominee delegation required". Approve as nominee after delegation is active.';
    }
    if (ownerActionDisabled && actionDisabledByAuth) {
      return 'Owner actions require wallet login.';
    }
    if (ownerActionDisabled) {
      return 'Owner actions require `wallet_user` role.';
    }
    return null;
  }, [actionDisabledByAuth, consentRequiresNomineeApproval, ownerActionDisabled]);
  const nomineeActionBlockMessage = useMemo(() => {
    if (nomineeActionDisabled && actionDisabledByAuth) {
      return 'Nominee actions require wallet login.';
    }
    if (nomineeActionDisabled) {
      return 'Nominee actions require `wallet_nominee` role.';
    }
    if (!selectedConsentDelegationReady) {
      return 'Nominee approval is enabled when an active delegation matches this consent.';
    }
    return null;
  }, [actionDisabledByAuth, nomineeActionDisabled, selectedConsentDelegationReady]);

  const copy = async (value: string | null | undefined) => {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // no-op
    }
  };

  const toActionErrorMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : 'Action failed';
    const normalized = message.toLowerCase();
    if (
      demoBypassWalletLogin &&
      (normalized.includes('401') || normalized.includes('403') || normalized.includes('authorization') || normalized.includes('login'))
    ) {
      return 'This action needs wallet login in non-demo mode.';
    }
    return message;
  };

  const refreshAllWalletData = async (targetTokenId?: string) => {
    await Promise.allSettled([
      refreshWalletConsents(resolvedWalletUserId),
      refreshWalletTokens(resolvedWalletUserId),
      refreshDelegations(resolvedWalletUserId),
      refreshRegistryEvidence(targetTokenId ?? readOptionalValue(displayWalletToken as Record<string, unknown> | null, 'tokenId') ?? tokenId ?? undefined),
    ]);
  };

  const onToggleField = (field: string, checked: boolean) => {
    if (!selectedConsent) return;
    setSelectedApprovedFields((previous) => {
      const next = checked ? [...previous, field] : previous.filter((item) => item !== field);
      return [...new Set(next)];
    });
  };

  const onSelectAllFields = () => {
    setSelectedApprovedFields(selectableFields);
  };

  const onClearFields = () => {
    setSelectedApprovedFields([]);
  };

  const openApproveConfirmation = () => {
    if (!selectedConsentResolvedId) {
      return;
    }
    if (walletActionBusy) {
      return;
    }
    if (!validFieldSelection) {
      setInlineWarning('Select at least one field to approve.');
      return;
    }
    setInlineWarning(null);
    setApproveConfirmOpen(true);
  };

  const runApprove = async () => {
    if (!selectedConsentResolvedId) return;
    if (walletActionBusy) return;
    if (!validFieldSelection) {
      setInlineWarning('Select at least one field to approve.');
      return;
    }
    setApproveConfirmOpen(false);
    setInlineWarning(null);
    setApproving(true);
    const targetTokenId = selectedConsent.tokenId ? String(selectedConsent.tokenId) : undefined;

    try {
      await approveConsent(selectedConsentResolvedId, fieldsToShare);
      setActionSummary(
        `Approved consent ${selectedConsentResolvedId}. Shared fields: ${
          fieldsToShare.length > 0 ? fieldsToShare.join(', ') : 'none'
        }`
      );
      setActionEvidenceAt(new Date().toISOString());
      try {
        await verifyAssertionSuccess();
        setWalletVerifyMessage(`FI verification completed for consent ${selectedConsentResolvedId}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to auto verify.';
        setWalletVerifyMessage(`Consent approved. FI verify not completed: ${message}`);
      }
    } catch (error) {
      setInlineWarning(toActionErrorMessage(error));
    } finally {
      await refreshAllWalletData(targetTokenId);
      setApproving(false);
    }
  };

  const runApproveAsNominee = async () => {
    if (!selectedConsentResolvedId) return;
    if (walletActionBusy) return;
    if (!validFieldSelection) {
      setInlineWarning('Select at least one field to approve.');
      return;
    }
    setInlineWarning(null);
    setNomineeApproving(true);
    const targetTokenId = selectedConsent.tokenId ? String(selectedConsent.tokenId) : undefined;

    try {
      await approveAsNominee(selectedConsentResolvedId, fieldsToShare);
      setActionSummary(
        `Nominee approved consent ${selectedConsentResolvedId}. Shared fields: ${
          fieldsToShare.length > 0 ? fieldsToShare.join(', ') : 'none'
        }`
      );
      setActionEvidenceAt(new Date().toISOString());
      try {
        await verifyAssertionSuccess();
        setWalletVerifyMessage(`FI verification completed for consent ${selectedConsentResolvedId}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to auto verify.';
        setWalletVerifyMessage(`Consent approved by nominee. FI verify not completed: ${message}`);
      }
    } catch (error) {
      setInlineWarning(toActionErrorMessage(error));
    } finally {
      await refreshAllWalletData(targetTokenId);
      setNomineeApproving(false);
    }
  };

  const runReject = async () => {
    if (!selectedConsentResolvedId) return;
    if (walletActionBusy) return;
    setRejectConfirmOpen(false);
    setInlineWarning(null);
    setRejecting(true);
    const targetTokenId = selectedConsent.tokenId ? String(selectedConsent.tokenId) : undefined;
    const resolvedRejectReason = rejectReason.trim().length > 0 ? `${rejectReasonCode}: ${rejectReason.trim()}` : rejectReasonCode;
    try {
      await rejectConsent(selectedConsentResolvedId, resolvedRejectReason);
      setActionSummary(`Rejected consent ${selectedConsentResolvedId}. Reason: ${resolvedRejectReason}`);
      setActionEvidenceAt(new Date().toISOString());
    } catch (error) {
      setInlineWarning(toActionErrorMessage(error));
    } finally {
      await refreshAllWalletData(targetTokenId);
      setRejecting(false);
    }
  };

  const onCreateDelegation = async (event: FormEvent) => {
    event.preventDefault();
    if (walletActionBusy) return;
    setInlineWarning(null);
    setCreatingDelegation(true);
    const allowedPurposes = delegationPurposeInput
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const delegationFields = selectableFields.length > 0 ? selectableFields : ['name', 'dob', 'address'];
    const expiry = delegationExpiryInput ? new Date(delegationExpiryInput).toISOString() : undefined;

    try {
      const createdDelegation = await addNomineeDelegation({
        ownerUserId: resolvedWalletUserId,
        delegateUserId: nomineeName.trim() || WALLET_NOMINEE_USERNAME,
        scope: delegationScope.trim() || 'consent.approve',
        allowedPurposes: allowedPurposes.length > 0 ? allowedPurposes : ['loan-underwriting', 'insurance-claim'],
        allowedFields: delegationFields,
        expiresAt: expiry,
      });
      if (createConsentForNominee) {
        await requestConsentWith({
          userId: resolvedWalletUserId,
          fiId: String(selectedConsent?.fiId ?? selectedConsent?.requestedBy ?? FI_CLIENT_ID),
          purpose: String(selectedConsent?.purpose ?? 'loan-underwriting'),
          requestedFields: delegationFields,
          requiresDelegation: true,
        });
      }
      await refreshAllWalletData(selectedConsent?.tokenId ? String(selectedConsent.tokenId) : undefined);
      setActionSummary(
        createConsentForNominee
          ? `Delegation ${createdDelegation.id} created and pending consent requested.`
          : `Delegation ${createdDelegation.id} created successfully.`
      );
    } catch (error) {
      const message = toActionErrorMessage(error);
      if (message.toLowerCase().includes('404') || message.toLowerCase().includes('not found')) {
        setActionSummary('Delegation API is not available in this environment yet.');
      } else {
        setInlineWarning(message);
      }
    } finally {
      setCreatingDelegation(false);
    }
  };

  const onActivateDelegation = async (delegation: (typeof delegationsList)[number]) => {
    if (walletActionBusy) return;
    setMutatingDelegation(true);
    try {
      await addNomineeDelegation({
        ownerUserId: delegation.ownerUserId,
        delegateUserId: delegation.delegateUserId,
        scope: delegation.scope,
        allowedPurposes: delegation.allowedPurposes,
        allowedFields: delegation.allowedFields,
        expiresAt: delegation.expiresAt,
      });
      await refreshDelegations(delegation.ownerUserId);
      setActionSummary(`Delegation activated for ${delegation.delegateUserId}.`);
    } catch (error) {
      setInlineWarning(toActionErrorMessage(error));
    } finally {
      setMutatingDelegation(false);
    }
  };

  const onRevokeDelegation = async (delegationId: string, ownerUserId?: string) => {
    if (walletActionBusy) return;
    setMutatingDelegation(true);
    try {
      await revokeDelegation(delegationId);
      await refreshDelegations(ownerUserId);
      setActionSummary(`Delegation ${delegationId} revoked.`);
    } catch (error) {
      setInlineWarning(toActionErrorMessage(error));
    } finally {
      setMutatingDelegation(false);
    }
  };

  const environmentLabel = (import.meta.env.MODE ?? 'local').toLowerCase() === 'production' ? 'Sandbox' : 'Local';
  const lastRefreshAt = activities[0]?.at ?? null;

  return (
    <div className="space-y-5">
      <WalletAuthOptionalBanner
        open={demoBypassWalletLogin && !dismissWalletAuthBanner}
        onDismiss={() => setDismissWalletAuthBanner(true)}
      />
      <PortalPageHeader
        title="Bharat KYC T - Wallet"
        subtitle="Manage consents, sharing scope, and nominee delegation."
        environmentLabel={environmentLabel}
        lastRefreshAt={lastRefreshAt}
        badges={
          <StatusPill
            status={authenticated ? 'ok' : demoBypassWalletLogin ? 'neutral' : 'warn'}
            label={
              authenticated
                ? `Wallet: ${displayWalletIdentity(activeWalletUsername)}`
                : demoBypassWalletLogin
                  ? 'Wallet: demo mode (login optional)'
                  : 'Wallet: signed out'
            }
          />
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={fiPortalPath}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Open FI Portal
            </Link>
            <Link
              to={auditPath}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Open Audit
            </Link>
          </div>
        }
      />
      {authFailure ? (
        <div className="rounded-xl border border-amber-200/90 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(254,243,199,0.75))] px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">Wallet authentication is required by the endpoint.</p>
          <p className="mt-1 text-xs">
            {authFailure.errorCode} - {authFailure.message}
          </p>
        </div>
      ) : null}
      {ownerAuthorizationFailure ? (
        <div className="rounded-xl border border-blue-200/90 bg-[linear-gradient(135deg,rgba(239,246,255,0.96),rgba(219,234,254,0.75))] px-3 py-2 text-sm text-blue-900">
          <p className="font-semibold">Owner-only action</p>
          <p className="mt-1 text-xs">Delegation management requires the owner session ({WALLET_OWNER_ALIAS}).</p>
        </div>
      ) : null}
      {inlineWarning ? (
        <div className="rounded-xl border border-rose-200/90 bg-[linear-gradient(135deg,rgba(255,241,242,0.96),rgba(254,205,211,0.75))] px-3 py-2 text-sm text-rose-900">
          <p className="font-semibold">Action failed</p>
          <p className="mt-1 text-xs">{inlineWarning}</p>
        </div>
      ) : null}
      {actionSummary ? (
        <div className="rounded-xl border border-emerald-200/90 bg-[linear-gradient(135deg,rgba(236,253,245,0.96),rgba(209,250,229,0.75))] px-3 py-2 text-sm text-emerald-900">
          <p className="font-semibold">Success</p>
          <p className="mt-1 text-xs">{actionSummary}</p>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.08fr_1.18fr]">
        <ConsoleCard id="wallet-dashboard" className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
          <SectionHeader title="Wallet Dashboard" subtitle="Read-only insights for consent and token status." />
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{consentCounts.PENDING}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approved</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{consentCounts.APPROVED}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rejected</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{consentCounts.REJECTED}</p>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <p className="font-semibold uppercase tracking-wide text-slate-500">Token Status</p>
            <p className="mt-1 flex items-center gap-1">
              <span className="font-semibold text-slate-800">tokenId:</span>
              <span className="font-mono">
                {truncate(readOptionalValue(displayWalletToken as Record<string, unknown> | null, 'tokenId') ?? tokenId ?? '-', 26)}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline"
                onClick={() => void copy(readOptionalValue(displayWalletToken as Record<string, unknown> | null, 'tokenId') ?? tokenId)}
              >
                <ClipboardCopy className="h-3.5 w-3.5" />
                Copy
              </button>
            </p>
            <p className="mt-1">
              <span className="font-semibold text-slate-800">status:</span> {tokenLifecycleStatus}
            </p>
            <p className="mt-1">
              <span className="font-semibold text-slate-800">expiry:</span>{' '}
              {formatDateTime(
                readOptionalValue(displayWalletToken as Record<string, unknown> | null, 'expiresAt') ??
                  registrySnapshot?.expiresAt ??
                  null
              )}
            </p>
            <p className="mt-1">
              <span className="font-semibold text-slate-800">Shared With:</span>{' '}
              {approvedFiIdentifiers.length > 0 ? approvedFiIdentifiers.join(', ') : 'No approved FI sharing yet'}
            </p>
            <p className="mt-1">
              <span className="font-semibold text-slate-800">Last Activity:</span>{' '}
              {lastWalletActivity ? `${lastWalletActivity.label} (${formatDateTime(lastWalletActivity.at)})` : 'No wallet activity'}
            </p>
            {tokenNotOnboarded ? (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                <p className="font-semibold">Active token required</p>
                <p className="mt-1">
                  No ACTIVE token is available for this wallet user. Contact Issuer/Home Bank to onboard or refresh token.
                </p>
                <Link to="/command/operations#issuer-onboarding" className="mt-2 inline-flex items-center gap-1 font-semibold underline">
                  Open Issuer onboarding <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : null}
          </div>

          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent Requests</p>
            </div>
            <div className="space-y-1.5">
              {recentPendingConsents.length === 0 ? (
                <p className="text-sm text-slate-600">No pending consents.</p>
              ) : (
                recentPendingConsents.map((consent) => {
                  const consentRowId = resolveConsentId(consent);
                  return (
                    <div key={consentRowId ?? `${String(consent.fiId ?? '')}-${String(consent.createdAt ?? '')}`} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5">
                      <button
                        type="button"
                        className="text-left text-xs font-semibold text-slate-800 hover:underline"
                        onClick={() => {
                          if (consentRowId) {
                            setSelectedConsentId(consentRowId);
                          }
                        }}
                      >
                        {truncate(consentRowId ?? '-', 20)}
                      </button>
                      {consentRowId ? (
                        <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline" onClick={() => void copy(consentRowId)}>
                          <ClipboardCopy className="h-3.5 w-3.5" />
                          Copy
                        </button>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </ConsoleCard>

        {showConsentSections ? (
          <>
        <ConsoleCard id="consent-inbox" className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,250,251,0.94))]">
          <SectionHeader
            title="Consent Inbox"
            subtitle="Select a consent request and approve/reject sharing."
            action={
              <div className="flex flex-wrap items-center gap-2">
                {(['all', 'pending', 'approved', 'rejected'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setConsentFilter(status)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                      consentFilter === status
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {status === 'all' ? 'All' : status[0]?.toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            }
          />

          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <Search className="h-3.5 w-3.5" />
              Search consentId / purpose / requestedBy
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="mt-1 kyc-form-input kyc-form-input-sm"
              placeholder="Search consentId / purpose / FI"
            />
          </div>

          <div className="mt-3 max-h-[58vh] space-y-2 overflow-auto pr-1">
            {filteredConsents.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No matching consents.</div>
            ) : (
              filteredConsents.map((consent) => {
                const consentStatus = normalizeStatus(consent.status);
                const statusBadge = statusMeta(consentStatus);
                const consentRowId = resolveConsentId(consent);
                const active = consentRowId === selectedConsentId;
                const consentFields = extractRequestedFields(consent);
                const createdAt = readOptionalValue(consent, 'createdAt');
                const delegationReady = hasMatchingDelegation(
                  consent,
                  delegationsList as Array<Record<string, unknown>>,
                  nomineeName
                );
                const consentRequiresDelegation = readConsentRequiresDelegation(consent);
                const routePolicy: 'owner' | 'delegation_required' =
                  consentRequiresDelegation === true
                    ? 'delegation_required'
                    : consentRequiresDelegation === false
                      ? 'owner'
                      : consentRowId
                        ? policyByConsentId[consentRowId] ?? 'owner'
                        : 'owner';
                return (
                  <button
                    type="button"
                    key={consentRowId ?? `${String(consent.fiId ?? 'fi')}-${String(consent.purpose ?? 'purpose')}-${String(consent.createdAt ?? '')}`}
                    onClick={() => {
                      if (consentRowId) {
                        setSelectedConsentId(consentRowId);
                      }
                    }}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      active ? 'border-slate-900 bg-white' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Consent {truncate(consentRowId ?? '-', 20)}</p>
                        {consentRowId ? (
                          <span
                            role="button"
                            tabIndex={0}
                            className="mt-1 inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={(event) => {
                              event.stopPropagation();
                              void copy(consentRowId);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                void copy(consentRowId);
                              }
                            }}
                          >
                            <ClipboardCopy className="h-3 w-3" />
                            Copy consentId
                          </span>
                        ) : null}
                        <p className="mt-0.5 text-xs text-slate-600">
                          FI: <span className="font-medium text-slate-800">{String(consent.fiId ?? consent.requestedBy ?? '-')}</span> | purpose:{' '}
                          <span className="font-medium text-slate-800">{String(consent.purpose ?? '-')}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">Token {truncate(String(consent.tokenId ?? tokenId ?? '-'), 22)}</p>
                        {createdAt ? <p className="mt-0.5 text-xs text-slate-500">Created: {formatDateTime(createdAt)}</p> : null}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <StatusPill status={statusBadge.pill} label={statusBadge.label} />
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                            routePolicy === 'delegation_required'
                              ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                              : 'border-slate-200 bg-white text-slate-600'
                          }`}
                        >
                          {routePolicy === 'delegation_required' ? 'Nominee required' : 'Owner or nominee'}
                        </span>
                        {consentStatus === 'PENDING' ? (
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              delegationReady
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-amber-200 bg-amber-50 text-amber-700'
                            }`}
                          >
                            {delegationReady ? 'Nominee eligible' : 'Owner review'}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-600">
                      Requested fields: {consentFields.length > 0 ? consentFields.join(', ') : '-'}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </ConsoleCard>

        <ConsoleCard id="consent-actions" className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
          <SectionHeader
            title="Consent Review & Actions"
            subtitle="Inspect consent details, choose fields, and approve or reject."
            action={
              <div className="flex items-center gap-2">
                {nomineeMode ? <StatusPill status="warn" label="Approving as nominee" /> : null}
                <StatusPill status={selectedStatusMeta.pill} label={selectedStatusMeta.label} />
              </div>
            }
          />

          {!selectedConsent ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Select a consent first.</div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Consent Summary <InfoTooltip text="Consent is the user authorization request generated by the FI for specific purpose and fields." />
                </p>
                <div className="mt-2 space-y-1 text-xs text-slate-700">
                  <p className="flex items-center gap-1">
                    <span className="font-semibold text-slate-800">consentId:</span>
                    <span className="font-mono">{selectedConsentResolvedId ?? '-'}</span>
                    <button type="button" className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline" onClick={() => void copy(String(selectedConsentResolvedId ?? ''))}>
                      <ClipboardCopy className="h-3.5 w-3.5" />
                      Copy
                    </button>
                  </p>
                  <p className="flex items-center gap-1">
                    <span className="font-semibold text-slate-800">tokenId:</span>
                    <span className="font-mono">{truncate(String(selectedConsent.tokenId ?? tokenId ?? '-'), 30)}</span>
                    <button type="button" className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline" onClick={() => void copy(String(selectedConsent.tokenId ?? tokenId ?? ''))}>
                      <ClipboardCopy className="h-3.5 w-3.5" />
                      Copy
                    </button>
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">FI:</span> {String(selectedConsent.fiId ?? selectedConsent.requestedBy ?? '-')}
                    <button
                      type="button"
                      className="ml-2 inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline"
                      onClick={() => void copy(String(selectedConsent.fiId ?? selectedConsent.requestedBy ?? ''))}
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" />
                      Copy
                    </button>
                  </p>
                  <p>
                    <span className="font-semibold text-slate-800">purpose:</span> {String(selectedConsent.purpose ?? '-')}{' '}
                    <InfoTooltip text="Purpose describes what the FI intends to do with the shared fields." />
                  </p>
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Requested fields (read-only)</p>
                    <p className="mt-1 text-xs text-slate-700">
                      {requestedFields.length > 0 ? requestedFields.join(', ') : 'No fields listed.'}
                    </p>
                  </div>
                  <p>
                    <span className="font-semibold text-slate-800">approval route:</span>{' '}
                    {consentRequiresNomineeApproval ? 'Nominee delegation required' : 'Owner can approve directly'}
                  </p>
                  {selectedStatus === 'PENDING' ? (
                    <p>
                      <span className="font-semibold text-slate-800">delegation:</span>{' '}
                      {selectedConsentDelegationReady ? 'Nominee can approve (delegation active)' : 'Owner approval path active'}
                    </p>
                  ) : null}
                  <CopyValueField label="requestId" value={selectedRequestId} />
                  <CopyValueField label="correlationId" value={selectedCorrelationId} />
                  <CopyValueField label="assertionId" value={selectedConsent.assertionId ? String(selectedConsent.assertionId) : null} />
                  <CopyValueField label="assertionJwt" value={selectedAssertionJwt} />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Select what to share</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={onSelectAllFields}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={onClearFields}
                  >
                    Clear
                  </button>
                </div>
                <div className="mt-2 space-y-1 text-sm text-slate-800">
                  {requestedFields.length === 0 ? <p className="text-sm text-slate-600">No fields in consent request. Select from supported fields below.</p> : null}
                  {selectableFields.map((field) => (
                    <label key={field} className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1">
                      <input
                        type="checkbox"
                        checked={selectedApprovedFields.includes(field)}
                        onChange={(event) => onToggleField(field, event.target.checked)}
                      />
                      <span>{field}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  If backend selective fields are not enabled, selected fields are stored in UI evidence only.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                Reject reason and comment are captured in the confirmation modal.
              </div>

              <div className="grid gap-2">
                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
                  Auto verify in FI runs automatically after approval.
                </p>
                <ConsoleButton
                  type="button"
                  intent="primary"
                  className="w-full sm:w-auto"
                  onClick={openApproveConfirmation}
                  disabled={
                    !pendingConsentSelected ||
                    ownerActionDisabled ||
                    !validFieldSelection ||
                    consentRequiresNomineeApproval ||
                    walletActionBusy
                  }
                >
                  <BadgeCheck className="h-4 w-4" />
                  Approve selected consent
                </ConsoleButton>
                <ConsoleButton
                  type="button"
                  intent="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => setRejectConfirmOpen(true)}
                  disabled={!pendingConsentSelected || ownerActionDisabled || consentRequiresNomineeApproval || walletActionBusy}
                >
                  <XCircle className="h-4 w-4" />
                  Reject selected consent
                </ConsoleButton>
              </div>
              {ownerActionBlockMessage ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{ownerActionBlockMessage}</div>
              ) : null}
              {selectedStatus !== 'PENDING' ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Selected consent is {selectedStatus.toLowerCase()}. Approve/Reject are available only for PENDING consent.
                </div>
              ) : null}
              {nomineeActionBlockMessage && pendingConsentSelected ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  {nomineeActionBlockMessage}
                </div>
              ) : null}
              {actionSummary ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                  <p className="font-semibold">Evidence</p>
                  <p className="mt-1">timestamp: {formatDateTime(actionEvidenceAt)}</p>
                  <CopyValueField label="assertionJwt" value={selectedAssertionJwt} />
                  <CopyValueField label="requestId" value={selectedRequestId} />
                  <CopyValueField label="correlationId" value={selectedCorrelationId} />
                </div>
              ) : null}
              {walletVerifyMessage ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <p className="font-semibold text-slate-900">FI verify outcome</p>
                  <p className="mt-1">{walletVerifyMessage}</p>
                  {latestVerificationForSelectedConsent ? (
                    <div className="mt-1 text-xs">
                      <p>
                        status:{' '}
                        <span className={latestVerificationForSelectedConsent.mode === 'success' ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                          {latestVerificationForSelectedConsent.mode === 'success' ? 'success' : 'failure'}
                        </span>
                      </p>
                      <p>at: {formatDateTime(latestVerificationForSelectedConsent.at)}</p>
                      <p>errorCode: {latestVerificationForSelectedConsent.errorCode ?? '-'}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </ConsoleCard>
          </>
        ) : (
          <ConsoleCard className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,250,251,0.94))]">
            <SectionHeader title="Delegation-focused view" subtitle="Open /wallet/ops to review consent inbox and consent actions." />
            <p className="text-sm text-slate-600">
              This page is scoped for nominee delegation lifecycle and simulation flows.
            </p>
          </ConsoleCard>
        )}
      </div>

      {showDelegationSections ? (
        <ConsoleCard id="delegation" className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
        <SectionHeader
          title="Delegation (Nominee)"
          subtitle="Create and manage nominee delegation records."
          action={
            <div className="flex flex-wrap gap-2">
              <StatusPill status="ok" label={`Active ${delegationCounts.active}`} />
              <StatusPill status="warn" label={`Pending ${delegationCounts.pending}`} />
              <StatusPill status="neutral" label={`Revoked ${delegationCounts.revoked}`} />
            </div>
          }
        />

        <div className="mt-3 grid gap-4 xl:grid-cols-[1fr_1.1fr]">
          <form onSubmit={(event) => void onCreateDelegation(event)} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Create delegation <InfoTooltip text="Delegation lets owner grant nominee scope, allowed purpose, and allowed field constraints until expiry." />
            </p>
            <label className="block text-xs font-semibold text-slate-700">
              Nominee username
              <input
                type="text"
                value={nomineeName}
                onChange={(event) => setNomineeName(event.target.value)}
                className="mt-1 kyc-form-input kyc-form-input-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Scope
              <input
                type="text"
                value={delegationScope}
                onChange={(event) => setDelegationScope(event.target.value)}
                className="mt-1 kyc-form-input kyc-form-input-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Allowed purposes (comma separated)
              <input
                type="text"
                value={delegationPurposeInput}
                onChange={(event) => setDelegationPurposeInput(event.target.value)}
                className="mt-1 kyc-form-input kyc-form-input-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Expiry (optional)
              <input
                type="datetime-local"
                value={delegationExpiryInput}
                onChange={(event) => setDelegationExpiryInput(event.target.value)}
                className="mt-1 kyc-form-input kyc-form-input-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={createConsentForNominee} onChange={(event) => setCreateConsentForNominee(event.target.checked)} />
              Also create pending consent
            </label>
            <ConsoleButton type="submit" intent="secondary" className="w-full sm:w-auto" disabled={ownerActionDisabled || walletActionBusy}>
              <ShieldCheck className="h-4 w-4" />
              Create delegation
            </ConsoleButton>
            <ConsoleButton
              type="button"
              intent="primary"
              className="w-full sm:w-auto"
              onClick={() => void runApproveAsNominee()}
              disabled={
                !selectedConsentResolvedId ||
                !pendingConsentSelected ||
                !validFieldSelection ||
                nomineeActionDisabled ||
                !selectedConsentDelegationReady ||
                walletActionBusy
              }
            >
              <UserCheck2 className="h-4 w-4" />
              Approve as nominee
            </ConsoleButton>
            <p className="text-xs text-slate-500">
              Select a consent in the inbox, then use nominee approval after delegation is active.
            </p>
            <p className="text-xs text-slate-500">Owner can create or revoke delegation. Nominee can approve only when delegation is active.</p>
          </form>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Delegation list <InfoTooltip text="Shows nominee delegation records and their current status for the selected wallet owner." />
            </p>
            <div className="max-h-64 space-y-2 overflow-auto pr-1">
              {delegationsList.length === 0 ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No delegation records.</p>
              ) : (
                delegationsList.map((delegation) => {
                  const status = String(delegation.status ?? 'UNKNOWN').toUpperCase();
                  const isActive = status === 'ACTIVE';
                  const statusPill = isActive ? 'ok' : status === 'REVOKED' ? 'error' : 'warn';
                  return (
                    <div key={delegation.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{delegation.delegateUserId}</p>
                          <p className="text-xs text-slate-600">scope: {delegation.scope}</p>
                          <p className="text-xs text-slate-600">expires: {formatDateTime(delegation.expiresAt)}</p>
                        </div>
                        <StatusPill status={statusPill} label={status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        purposes: {delegation.allowedPurposes.join(', ')} | fields: {delegation.allowedFields.join(', ')}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <ConsoleButton
                          size="sm"
                          intent="secondary"
                          type="button"
                          onClick={() => void onActivateDelegation(delegation)}
                          disabled={isActive || ownerActionDisabled || walletActionBusy}
                        >
                          Activate
                        </ConsoleButton>
                        <ConsoleButton
                          size="sm"
                          intent="secondary"
                          type="button"
                          onClick={() => void onRevokeDelegation(delegation.id, delegation.ownerUserId)}
                          disabled={!isActive || ownerActionDisabled || walletActionBusy}
                        >
                          Revoke
                        </ConsoleButton>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          onClick={() => void copy(delegation.id)}
                        >
                          <ClipboardCopy className="h-3.5 w-3.5" />
                          Copy delegationId
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {latestShareActivity ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <p className="font-semibold text-slate-900">Last shared to FI</p>
            <p className="mt-1">
              {latestShareActivity.label} at {formatDateTime(latestShareActivity.at)}
            </p>
          </div>
        ) : null}
        </ConsoleCard>
      ) : null}

      <ConsoleCard id="wallet-activity" className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.94))]">
        <SectionHeader title="Wallet Activity Timeline" subtitle="Unified activity stream with filters and deep links." />
        <div className="mb-3 flex flex-wrap gap-2">
          {(['all', 'wallet', 'consent', 'registry'] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setActivityFilter(filter)}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                activityFilter === filter
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {filter === 'all' ? 'All' : filter[0]?.toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {filteredActivity.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No activity for this filter.</p>
          ) : (
            filteredActivity.map((activity) => {
              const status = activityStatusMeta(activity.status);
              const activityIds = extractActivityIds(activity);
              const target =
                activity.service === 'registry'
                  ? '/command/audit'
                  : activity.label.toLowerCase().includes('delegation')
                    ? `${isWalletPortalRoute ? '/wallet/delegations' : '/wallet/delegations'}`
                    : activity.service === 'consent' || activity.label.toLowerCase().includes('consent')
                      ? `${isWalletPortalRoute ? '/wallet/ops' : '/wallet/ops'}`
                      : '/command/audit';
              return (
                <div key={activity.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusPill status={status.status} label={status.label} />
                      <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-600">
                        {activity.service}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">{formatDateTime(activity.at)}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{activity.label}</p>
                  {activityIds.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {activityIds.map((entry) => (
                        <p key={`${activity.id}-${entry.label}-${entry.value}`} className="flex flex-wrap items-center gap-1 text-xs text-slate-700">
                          <span className="font-semibold text-slate-800">{entry.label}:</span>
                          <span className="font-mono">{truncate(entry.value, 38)}</span>
                          <button type="button" className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline" onClick={() => void copy(entry.value)}>
                            <ClipboardCopy className="h-3.5 w-3.5" />
                            Copy
                          </button>
                        </p>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      onClick={() => navigate(target)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open detail
                    </button>
                    <Link
                      to="/command/audit"
                      className="inline-flex items-center rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Audit
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ConsoleCard>

      {approveConfirmOpen && selectedConsent ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <p className="text-base font-semibold text-slate-900">Confirm approval</p>
            <p className="mt-2 text-sm text-slate-700">
              You are sharing {fieldsToShare.length} field(s) with {selectedFiLabel} for purpose {String(selectedConsent.purpose ?? '-')}.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <ConsoleButton type="button" intent="secondary" onClick={() => setApproveConfirmOpen(false)}>
                Cancel
              </ConsoleButton>
              <ConsoleButton type="button" intent="primary" onClick={() => void runApprove()} disabled={!validFieldSelection || walletActionBusy}>
                Confirm approve
              </ConsoleButton>
            </div>
          </div>
        </div>
      ) : null}

      {rejectConfirmOpen && selectedConsent ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <p className="text-base font-semibold text-slate-900">Reject consent</p>
            <p className="mt-1 text-sm text-slate-700">Provide reason details before rejecting this consent request.</p>
            <label className="mt-3 block text-xs font-semibold text-slate-700">
              Reason
              <select
                value={rejectReasonCode}
                onChange={(event) => setRejectReasonCode(event.target.value)}
                className="mt-1 kyc-form-select kyc-form-input-sm"
              >
                <option value="user_declined">User declined</option>
                <option value="purpose_not_acceptable">Purpose not acceptable</option>
                <option value="insufficient_trust">Insufficient trust</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="mt-2 block text-xs font-semibold text-slate-700">
              Comment (optional)
              <input
                type="text"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                className="mt-1 kyc-form-input kyc-form-input-sm"
                placeholder="Add context for audit trail"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <ConsoleButton type="button" intent="secondary" onClick={() => setRejectConfirmOpen(false)}>
                Cancel
              </ConsoleButton>
              <ConsoleButton type="button" intent="danger" onClick={() => void runReject()} disabled={walletActionBusy}>
                Confirm reject
              </ConsoleButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
