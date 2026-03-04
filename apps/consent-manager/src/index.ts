import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import {
  asyncHandler,
  createJwksFromPrivateKey,
  createLogger,
  createOidcValidator,
  computeUserRefHashFromIdentifier,
  httpLogger,
  issueJwt,
  RedisReplayProtector,
  requireScopes,
  validateBody,
  validateParams,
  validateQuery,
} from '@bharat/common';
import { checkDatabase, prisma } from '@bharat/db';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { evaluateDelegationConstraints, reserveReplayGuards, resolveConsentActionActor, selectiveDisclosure } from './consent-domain.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(httpLogger('consent-manager'));

const logger = createLogger('consent-manager');

function normalizeMultilineSecret(value: string | undefined): string {
  return (value ?? '').replace(/\\n/g, '\n').trim();
}

function requireSecret(name: string, value: string) {
  if (!value || value.trim().length === 0) {
    throw new Error(`[consent-manager] Missing required secret: ${name}`);
  }
}

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const jtiReplay = new RedisReplayProtector(redis, 'consent:assertion:jti');
const nonceReplay = new RedisReplayProtector(redis, 'consent:assertion:nonce');

const keycloakIssuerUrl = process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/bharat-kyc-dev';
const keycloakJwksUrl = process.env.KEYCLOAK_JWKS_URL;
const keycloakJwksCacheTtlMs = Number(process.env.KEYCLOAK_JWKS_CACHE_TTL_MS ?? 600_000);
const registryUrl = process.env.REGISTRY_URL ?? 'http://localhost:3002';
const issuerServiceUrl = process.env.ISSUER_SERVICE_URL ?? 'http://localhost:3001';
const keycloakTokenUrl =
  process.env.KEYCLOAK_TOKEN_URL ?? `${keycloakIssuerUrl.replace(/\/$/, '')}/protocol/openid-connect/token`;
const serviceClientId = process.env.CONSENT_SERVICE_CLIENT_ID ?? 'issuer-admin';
const serviceClientSecret = (process.env.CONSENT_SERVICE_CLIENT_SECRET ?? '').trim();
function envFlagTrue(...values: Array<string | undefined>): boolean {
  for (const value of values) {
    const v = (value ?? '').trim().toLowerCase();
    if (!v) continue;
    if (['1','true','yes','on'].includes(v)) return true;
    if (['0','false','no','off'].includes(v)) return false;
  }
  return false;
}

const consentSigningPrivateKey = normalizeMultilineSecret(process.env.CONSENT_SIGNING_PRIVATE_KEY ?? process.env.JWT_PRIVATE_KEY);
const consentSigningKid = process.env.CONSENT_SIGNING_KID ?? 'consent-key';
const consentIssuerId = process.env.CONSENT_ISSUER_ID ?? 'bharat-consent-manager';
const consentTtlSeconds = Number(process.env.CONSENT_TTL_SECONDS ?? 300);
const consentTtlMaxSeconds = Number(process.env.CONSENT_TTL_MAX_SECONDS ?? 86400);
const usernameEqualsUserIdMode = envFlagTrue(process.env.IDENTITY_USERNAME_EQUALS_USERID, process.env.VITE_IDENTITY_USERNAME_EQUALS_USERID);
const walletOwnerUsername = (process.env.KEYCLOAK_WALLET_OWNER_USER ?? '').trim();
const walletOwnerUserId = (process.env.KEYCLOAK_WALLET_OWNER_USER_ID ?? process.env.VITE_WALLET_OWNER_USER_ID ?? '').trim();
const walletOwnerCanonicalUsername = usernameEqualsUserIdMode && walletOwnerUserId ? walletOwnerUserId : walletOwnerUsername;
const walletOwnerAliases = new Set(
  [
    process.env.KEYCLOAK_WALLET_OWNER_USER,
    walletOwnerCanonicalUsername,
    process.env.VITE_WALLET_OWNER_USERNAME,
    process.env.VITE_WALLET_OWNER_ALIAS,
    process.env.VITE_WALLET_OWNER_DISPLAY,
    walletOwnerUserId,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
);
const walletNomineeUsername = (process.env.KEYCLOAK_NOMINEE_USER ?? process.env.VITE_WALLET_NOMINEE_USERNAME ?? '').trim();
const walletNomineeUserId = (process.env.KEYCLOAK_NOMINEE_USER_ID ?? process.env.VITE_WALLET_NOMINEE_USER_ID ?? '').trim();
const walletNomineeCanonicalUsername = usernameEqualsUserIdMode && walletNomineeUserId ? walletNomineeUserId : walletNomineeUsername;
const walletNomineeAliases = new Set(
  [
    walletNomineeUsername,
    walletNomineeCanonicalUsername,
    process.env.VITE_WALLET_NOMINEE_ALIAS,
    process.env.VITE_WALLET_NOMINEE_DISPLAY,
    walletNomineeUserId,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
);

function canonicalizeKnownWalletUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) return normalized;
  if (walletOwnerUserId && walletOwnerAliases.has(normalized)) {
    return walletOwnerUserId;
  }
  if (walletNomineeUserId && walletNomineeAliases.has(normalized)) {
    return walletNomineeUserId;
  }
  return normalized;
}

const purposeReusePolicy: Record<string, boolean> = {
  ACCOUNT_OPENING: true,
  MUTUAL_FUND_KYC: true,
  INSURANCE_ONBOARDING: true,
  BROKERAGE_ONBOARDING: true,
  PERIODIC_KYC_UPDATE: false,
  LOAN_UNDERWRITING: false,
  HIGH_VALUE_TRANSACTION: false,
  ADDRESS_CHANGE: false,
};

function normalizePurposeKey(purpose: string | null | undefined): string {
  return String(purpose ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function computePurposeBasedReuseDefault(purpose: string | null | undefined): boolean {
  const key = normalizePurposeKey(purpose);
  return key in purposeReusePolicy ? purposeReusePolicy[key]! : false;
}
requireSecret('CONSENT_SIGNING_PRIVATE_KEY', consentSigningPrivateKey);
requireSecret('CONSENT_SERVICE_CLIENT_SECRET', serviceClientSecret);
if (!Number.isFinite(consentTtlSeconds) || consentTtlSeconds <= 0) {
  throw new Error('[consent-manager] CONSENT_TTL_SECONDS must be a positive integer');
}
if (!Number.isFinite(consentTtlMaxSeconds) || consentTtlMaxSeconds <= 0) {
  throw new Error('[consent-manager] CONSENT_TTL_MAX_SECONDS must be a positive integer');
}

const validateAccessToken = createOidcValidator({
  issuerUrl: keycloakIssuerUrl,
  jwksUrl: keycloakJwksUrl,
  jwksCacheTtlMs: keycloakJwksCacheTtlMs,
});

const healthQuery = z.object({
  probe: z.enum(['liveness', 'readiness']).optional(),
});

const consentParamsSchema = z.object({
  consentId: z.string().uuid(),
});

const userParamsSchema = z.object({
  userId: z.string().min(3).max(256),
});

const precheckTokenQuery = z.object({
  userId: z.string().min(3).max(256),
});

const createConsentSchema = z
  .object({
    userId: z.string().min(3).max(256),
    fiId: z.string().min(2).max(128),
    purpose: z.string().min(2).max(128),
    requestedFields: z.array(z.string().min(1)).min(1).max(20),
    ttlSeconds: z.number().int().positive().max(consentTtlMaxSeconds).optional(),
    requiresDelegation: z.boolean().optional(),
    allowReuseAcrossFIs: z.boolean().optional(),
  })
  .strict();

const approveSchema = z
  .object({
    reason: z.string().min(3).max(512).optional(),
    approvedFields: z.array(z.string().min(1).max(128)).min(1).max(20).optional(),
  })
  .strict();

const rejectSchema = z
  .object({
    reason: z.string().min(3).max(512).optional(),
  })
  .strict();

const renewSchema = z
  .object({
    reason: z.string().min(3).max(512).optional(),
  })
  .strict()
  .optional()
  .default({});

const createScopes = ['kyc.request'];
const approveScopes = ['consent.approve'];
const readScopes = ['consent.read'];
const verifyScopes = ['kyc.verify'];
// Reuse consent.approve for revocation & lifecycle management in this prototype.
const revokeScopes = approveScopes;

const periodicUpdatePurpose = 'PERIODIC_KYC_UPDATE';

function computeNextReviewAtFromTier(now: Date, tier: string): Date {
  const next = new Date(now);
  const normalized = String(tier ?? '').toUpperCase();
  const years = normalized === 'HIGH' ? 2 : normalized === 'LOW' ? 10 : 8;
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

function getActor(req: express.Request): string {
  const payload = req.oidc?.payload;
  if (!payload) return 'unknown';
  if (typeof payload.azp === 'string') return payload.azp;
  if (typeof payload.client_id === 'string') return payload.client_id;
  if (typeof payload.sub === 'string') return payload.sub;
  return 'unknown';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function computeConsentExpiry(now: Date = new Date(), ttlSecondsOverride?: number): Date {
  const effectiveTtlSeconds =
    typeof ttlSecondsOverride === 'number' &&
    Number.isFinite(ttlSecondsOverride) &&
    ttlSecondsOverride > 0 &&
    ttlSecondsOverride <= consentTtlMaxSeconds
      ? ttlSecondsOverride
      : consentTtlSeconds;
  return new Date(now.getTime() + effectiveTtlSeconds * 1000);
}

function resolveActorUserId(req: express.Request): string | null {
  const payload = req.oidc?.payload;
  if (!payload) {
    return null;
  }

  const explicitUserId = payload.user_id;
  if (typeof explicitUserId === 'string' && explicitUserId.trim().length > 0) {
    return canonicalizeKnownWalletUserId(explicitUserId);
  }

  const preferredUsername = payload.preferred_username;
  if (typeof preferredUsername === 'string' && preferredUsername.trim().length > 0) {
    if (walletOwnerUsername && walletOwnerUserId && preferredUsername === walletOwnerUsername) {
      return walletOwnerUserId;
    }
    return canonicalizeKnownWalletUserId(preferredUsername);
  }

  const subject = payload.sub;
  if (typeof subject === 'string' && subject.trim().length > 0) {
    return canonicalizeKnownWalletUserId(subject);
  }

  return null;
}

async function resolveConsentActorAccess(input: {
  consentUserRefHash: string;
  actorUserId: string;
  now?: Date;
}) {
  return resolveConsentActionActor({
    ownerRefHash: input.consentUserRefHash,
    actorUserId: input.actorUserId,
    now: input.now,
    hashUserId: computeUserRefHashFromIdentifier,
    findActiveDelegation: async ({ ownerRefHash, delegateRefHash, scope, now }) => {
      return prisma.delegation.findFirst({
        where: {
          ownerRefHash,
          delegateRefHash,
          status: 'ACTIVE',
          scope: {
            in: [scope, '*'],
          },
          expiresAt: {
            gt: now,
          },
        },
        select: {
          id: true,
        },
        orderBy: [{ createdAt: 'desc' }],
      });
    },
  });
}

async function loadActiveDelegationSnapshot(input: {
  delegationId: string;
  consentUserRefHash: string;
  actorUserId: string;
  now: Date;
}) {
  return prisma.delegation.findFirst({
    where: {
      id: input.delegationId,
      ownerRefHash: input.consentUserRefHash,
      delegateRefHash: computeUserRefHashFromIdentifier(input.actorUserId),
      status: 'ACTIVE',
      scope: {
        in: ['consent.approve', '*'],
      },
      expiresAt: {
        gt: input.now,
      },
    },
    select: {
      id: true,
      ownerUserId: true,
      delegateUserId: true,
      allowedPurposes: true,
      allowedFields: true,
      expiresAt: true,
    },
  });
}

async function getServiceToken(scope: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: serviceClientId,
    client_secret: serviceClientSecret,
    scope,
  });

  const response = await fetch(keycloakTokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`service_token_error:${response.status}:${text}`);
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error('service_token_error:missing_access_token');
  }

  return payload.access_token;
}

async function findActiveTokenByUserRefHash(userRefHash: string): Promise<{ tokenId: string; status: string } | null> {
  const accessToken = await getServiceToken('token.issue');
  const response = await fetch(
    `${registryUrl}/v1/internal/registry/active-token?userRefHash=${encodeURIComponent(userRefHash)}`,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`registry_lookup_error:${response.status}:${text}`);
  }

  const data = (await response.json()) as { tokenId: string; status: string };
  return data;
}

async function fetchIssuerPayload(tokenId: string): Promise<{ version: number; userRefHash: string; kyc: Record<string, unknown> }> {
  const accessToken = await getServiceToken('token.issue');
  const response = await fetch(`${issuerServiceUrl}/v1/internal/issuer/token/${tokenId}/payload`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`issuer_payload_error:${response.status}:${text}`);
  }

  return (await response.json()) as { version: number; userRefHash: string; kyc: Record<string, unknown> };
}

async function addConsentAuditEvent(input: {
  consentId: string;
  eventType: string;
  actor: string;
  detail?: Prisma.InputJsonValue;
}) {
  await prisma.consentAuditEvent.create({
    data: {
      consentId: input.consentId,
      eventType: input.eventType,
      actor: input.actor,
      detail: input.detail ?? {},
    },
  });
}

async function addReviewAuditEvent(input: {
  userId: string;
  eventType: string;
  actor: string;
  detail?: Prisma.InputJsonValue;
}) {
  await prisma.reviewAuditEvent.create({
    data: {
      userId: input.userId,
      eventType: input.eventType,
      actor: input.actor,
      detail: input.detail ?? {},
    },
  });
}

app.get(
  '/v1/health',
  validateQuery(healthQuery),
  asyncHandler(async (req, res) => {
    const probe = req.query.probe ?? 'readiness';
    if (probe === 'liveness') {
      return res.json({ status: 'ok', probe, uptime: process.uptime() });
    }

    const [dbReady, redisReady] = await Promise.all([
      checkDatabase(),
      redis.ping().then(() => true).catch(() => false),
    ]);

    const ready = dbReady && redisReady;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'degraded',
      probe,
      dependencies: {
        database: dbReady ? 'ok' : 'down',
        redis: redisReady ? 'ok' : 'down',
      },
    });
  })
);

app.get(
  '/v1/consent/precheck-token',
  validateAccessToken,
  requireScopes(createScopes),
  validateQuery(precheckTokenQuery),
  asyncHandler(async (req, res) => {
    const userId = req.query.userId as string;
    const userRefHash = computeUserRefHashFromIdentifier(userId);
    const activeToken = await findActiveTokenByUserRefHash(userRefHash);
    if (!activeToken || activeToken.status !== 'ACTIVE') {
      return res.status(404).json({
        error: 'no_active_token',
        message: `No ACTIVE token found for user ${userId}`,
      });
    }

    res.json({
      userId,
      tokenId: activeToken.tokenId,
      status: activeToken.status,
    });
  })
);

app.get(
  '/v1/internal/consent/:consentId/binding',
  validateAccessToken,
  requireScopes(verifyScopes),
  validateParams(consentParamsSchema),
  asyncHandler(async (req, res) => {
    const consent = await prisma.consentRecord.findUnique({
      where: { id: req.params.consentId },
      select: {
        id: true,
        fiId: true,
        purpose: true,
        requestedFields: true,
        requiresDelegation: true,
        allowReuseAcrossFIs: true,
        tokenId: true,
        status: true,
        expiresAt: true,
        renewedFromConsentId: true,
      },
    });

    if (!consent) {
      return res.status(404).json({ error: 'consent_not_found' });
    }

    res.json({
      consentId: consent.id,
      fiId: consent.fiId,
      purpose: consent.purpose,
      requestedFields: asStringArray(consent.requestedFields),
      requiresDelegation: consent.requiresDelegation,
      allowReuseAcrossFIs: consent.allowReuseAcrossFIs,
      tokenId: consent.tokenId,
      status: consent.status,
      expiresAt: consent.expiresAt.toISOString(),
      renewedFromConsentId: consent.renewedFromConsentId,
    });
  })
);

app.get(
  '/.well-known/jwks.json',
  asyncHandler(async (_req, res) => {
    if (!consentSigningPrivateKey) {
      return res.status(500).json({ error: 'CONSENT_SIGNING_PRIVATE_KEY not configured' });
    }

    const jwks = await createJwksFromPrivateKey(consentSigningPrivateKey, consentSigningKid);
    res.json(jwks);
  })
);

app.post(
  '/v1/consent/create',
  validateAccessToken,
  requireScopes(createScopes),
  validateBody(createConsentSchema),
  asyncHandler(async (req, res) => {
    const {
      userId,
      fiId,
      purpose,
      requestedFields,
      ttlSeconds,
      requiresDelegation: requiresDelegationRaw,
      allowReuseAcrossFIs: allowReuseAcrossFIsRaw,
    } = req.body;
    const userRefHash = computeUserRefHashFromIdentifier(userId);
    const requiresDelegation = Boolean(requiresDelegationRaw);
    const allowReuseAcrossFIs =
      typeof allowReuseAcrossFIsRaw === 'boolean' ? allowReuseAcrossFIsRaw : computePurposeBasedReuseDefault(purpose);

    const activeToken = await findActiveTokenByUserRefHash(userRefHash);
    if (!activeToken || activeToken.status !== 'ACTIVE') {
      return res.status(404).json({ error: 'No ACTIVE token found for user' });
    }

    const nonce = randomUUID();
    const expiresAt = computeConsentExpiry(new Date(), ttlSeconds);
    const consent = await prisma.consentRecord.create({
      data: {
        userRefHash,
        fiId,
        purpose,
        requestedFields,
        requiresDelegation,
        allowReuseAcrossFIs,
        tokenId: activeToken.tokenId,
        nonce,
        expiresAt,
      },
    });

    await addConsentAuditEvent({
      consentId: consent.id,
      eventType: 'CONSENT_CREATED',
      actor: getActor(req),
      detail: {
        fiId,
        purpose,
        tokenId: activeToken.tokenId,
        ttlSeconds: ttlSeconds ?? consentTtlSeconds,
        requiresDelegation,
        allowReuseAcrossFIs,
        expiresAt: consent.expiresAt.toISOString(),
        renewedFromConsentId: consent.renewedFromConsentId ?? null,
      },
    });

    logger.info({ consentId: consent.id, tokenId: consent.tokenId, fiId }, 'consent created');

    res.status(201).json({
      consentId: consent.id,
      fiId: consent.fiId,
      purpose: consent.purpose,
      tokenId: consent.tokenId,
      status: consent.status,
      nonce: consent.nonce,
      requestedFields: asStringArray(consent.requestedFields),
      requiresDelegation: consent.requiresDelegation,
      allowReuseAcrossFIs: consent.allowReuseAcrossFIs,
      ttlSeconds: ttlSeconds ?? consentTtlSeconds,
      expiresAt: consent.expiresAt.toISOString(),
      renewedFromConsentId: consent.renewedFromConsentId,
    });
  })
);

app.post(
  '/v1/consent/:consentId/renew',
  validateAccessToken,
  requireScopes(createScopes),
  validateParams(consentParamsSchema),
  validateBody(renewSchema),
  asyncHandler(async (req, res) => {
    const previousConsent = await prisma.consentRecord.findUnique({
      where: { id: req.params.consentId },
    });

    if (!previousConsent) {
      return res.status(404).json({ error: 'consent_not_found' });
    }

    const activeToken = await findActiveTokenByUserRefHash(previousConsent.userRefHash);
    if (!activeToken || activeToken.status !== 'ACTIVE' || activeToken.tokenId !== previousConsent.tokenId) {
      return res.status(409).json({
        error: 'token_not_active',
        message: 'Cannot renew consent because associated token is not ACTIVE.',
      });
    }

    const nonce = randomUUID();
    const expiresAt = computeConsentExpiry();
    const renewedConsent = await prisma.consentRecord.create({
      data: {
        userRefHash: previousConsent.userRefHash,
        fiId: previousConsent.fiId,
        purpose: previousConsent.purpose,
        requestedFields: asStringArray(previousConsent.requestedFields),
        requiresDelegation: previousConsent.requiresDelegation,
        allowReuseAcrossFIs: previousConsent.allowReuseAcrossFIs,
        tokenId: previousConsent.tokenId,
        nonce,
        expiresAt,
        renewedFromConsentId: previousConsent.id,
      },
    });

    await addConsentAuditEvent({
      consentId: previousConsent.id,
      eventType: 'CONSENT_RENEWED',
      actor: getActor(req),
      detail: {
        previousConsentId: previousConsent.id,
        newConsentId: renewedConsent.id,
        tokenId: previousConsent.tokenId,
        renewedBy: getActor(req),
        reason: req.body.reason ?? null,
      },
    });

    await addConsentAuditEvent({
      consentId: renewedConsent.id,
      eventType: 'CONSENT_CREATED',
      actor: getActor(req),
      detail: {
        fiId: renewedConsent.fiId,
        purpose: renewedConsent.purpose,
        tokenId: renewedConsent.tokenId,
        renewedFromConsentId: previousConsent.id,
      },
    });

    logger.info(
      {
        previousConsentId: previousConsent.id,
        newConsentId: renewedConsent.id,
        tokenId: renewedConsent.tokenId,
      },
      'consent renewed'
    );

    res.status(201).json({
      consentId: renewedConsent.id,
      tokenId: renewedConsent.tokenId,
      status: renewedConsent.status,
      nonce: renewedConsent.nonce,
      fiId: renewedConsent.fiId,
      purpose: renewedConsent.purpose,
      requestedFields: asStringArray(renewedConsent.requestedFields),
      requiresDelegation: renewedConsent.requiresDelegation,
      allowReuseAcrossFIs: renewedConsent.allowReuseAcrossFIs,
      expiresAt: renewedConsent.expiresAt.toISOString(),
      renewedFromConsentId: renewedConsent.renewedFromConsentId,
      previousConsentId: previousConsent.id,
    });
  })
);

app.post(
  '/v1/consent/:consentId/approve',
  validateAccessToken,
  requireScopes(approveScopes),
  validateParams(consentParamsSchema),
  validateBody(approveSchema),
  asyncHandler(async (req, res) => {
    if (!consentSigningPrivateKey) {
      return res.status(500).json({ error: 'CONSENT_SIGNING_PRIVATE_KEY not configured' });
    }

    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }

    const consent = await prisma.consentRecord.findUnique({
      where: { id: req.params.consentId },
    });

    if (!consent) {
      return res.status(404).json({ error: 'Consent not found' });
    }

    if (new Date().getTime() > consent.expiresAt.getTime()) {
      return res.status(409).json({
        error: 'consent_expired',
        message: 'Consent TTL has elapsed. Renew consent before approval.',
        expiresAt: consent.expiresAt.toISOString(),
      });
    }

    if (consent.status !== 'PENDING') {
      return res.status(409).json({ error: 'Consent is not in PENDING state' });
    }

    const actorAccess = await resolveConsentActorAccess({
      consentUserRefHash: consent.userRefHash,
      actorUserId,
    });
    if (!actorAccess.allowed) {
      return res.status(403).json({ error: 'delegation_required' });
    }

    const actorType = actorAccess.actorType;
    if (consent.requiresDelegation && actorType !== 'DELEGATE') {
      return res.status(403).json({
        error: 'delegation_required',
        message: 'Nominee delegation approval is required for this consent.',
      });
    }
    const approveBody = req.body as z.infer<typeof approveSchema>;
    const requestedFields = asStringArray(consent.requestedFields);
    const approvedFieldsInput: string[] | null = Array.isArray(approveBody.approvedFields)
      ? [...new Set(approveBody.approvedFields.map((field) => field.trim()).filter((field) => field.length > 0))]
      : null;
    const approvalReason = typeof approveBody.reason === 'string' ? approveBody.reason : null;
    if (approvedFieldsInput && approvedFieldsInput.length > 0) {
      const invalidApprovedFields = approvedFieldsInput.filter((field) => !requestedFields.includes(field));
      if (invalidApprovedFields.length > 0) {
        return res.status(400).json({
          error: 'approved_fields_invalid',
          message: 'Approved fields must be a subset of requested fields.',
          invalidApprovedFields,
        });
      }
    }
    const effectiveApprovedFields = approvedFieldsInput && approvedFieldsInput.length > 0 ? approvedFieldsInput : requestedFields;
    let delegationAuditContext: {
      delegationId: string;
      delegatedBy: string;
      delegatee: string;
      constraintsSnapshot: {
        allowedPurposes: string[];
        allowedFields: string[];
        expiresAt: string;
      };
    } | null = null;

    if (actorType === 'DELEGATE') {
      if (!actorAccess.delegationId) {
        return res.status(403).json({
          error: 'delegation_required',
          message: 'Active delegation is required for delegate approval.',
        });
      }

      const now = new Date();
      const delegationSnapshot = await loadActiveDelegationSnapshot({
        delegationId: actorAccess.delegationId,
        consentUserRefHash: consent.userRefHash,
        actorUserId,
        now,
      });

      if (!delegationSnapshot) {
        return res.status(403).json({
          error: 'delegation_required',
          message: 'No active delegation found for this owner/delegate pair.',
        });
      }

      const constraintsCheck = evaluateDelegationConstraints({
        purpose: consent.purpose,
        requestedFields: effectiveApprovedFields,
        allowedPurposes: delegationSnapshot.allowedPurposes,
        allowedFields: delegationSnapshot.allowedFields,
      });

      if (!constraintsCheck.allowed) {
        return res.status(403).json({
          error: constraintsCheck.errorCode,
          message: constraintsCheck.message,
          details: constraintsCheck.details,
        });
      }

      delegationAuditContext = {
        delegationId: delegationSnapshot.id,
        delegatedBy: delegationSnapshot.ownerUserId,
        delegatee: delegationSnapshot.delegateUserId,
        constraintsSnapshot: {
          allowedPurposes: constraintsCheck.normalizedAllowedPurposes,
          allowedFields: constraintsCheck.normalizedAllowedFields,
          expiresAt: delegationSnapshot.expiresAt.toISOString(),
        },
      };
    }

    const activeToken = await findActiveTokenByUserRefHash(consent.userRefHash);
    if (!activeToken || activeToken.status !== 'ACTIVE' || activeToken.tokenId !== consent.tokenId) {
      return res.status(409).json({ error: 'Associated token is no longer ACTIVE' });
    }

    const issuerPayload = await fetchIssuerPayload(consent.tokenId);
    if (issuerPayload.userRefHash !== consent.userRefHash) {
      return res.status(409).json({ error: 'User reference mismatch in issuer payload' });
    }

    const disclosedClaims = selectiveDisclosure(issuerPayload.kyc, effectiveApprovedFields);

    const assertionJti = randomUUID();
    const assertionTtlSeconds = 180;

    await reserveReplayGuards({
      jti: assertionJti,
      nonce: consent.nonce,
      ttlSeconds: assertionTtlSeconds,
      jtiProtector: jtiReplay,
      nonceProtector: nonceReplay,
    });

    const assertionJwt = await issueJwt({
      privateKeyPem: consentSigningPrivateKey,
      issuer: consentIssuerId,
      audience: consent.fiId,
      subject: consent.userRefHash,
      purpose: consent.purpose,
      ttlSeconds: assertionTtlSeconds,
      jti: assertionJti,
      kid: consentSigningKid,
      additionalClaims: {
        nonce: consent.nonce,
        tokenId: consent.tokenId,
        version: issuerPayload.version,
        scope: effectiveApprovedFields,
        claims: disclosedClaims,
      },
    });

    await prisma.consentRecord.update({
      where: { id: consent.id },
      data: {
        status: 'APPROVED',
        actorType,
        approvedBy: actorUserId,
        delegationId: delegationAuditContext?.delegationId ?? null,
        approvedFields: effectiveApprovedFields,
        assertionJti,
        assertionJwt,
      },
    });

    // Periodic KYC update flow: if this consent represents a required re-consent, clear the flag and schedule next review.
    if (String(consent.purpose ?? '').toUpperCase() === periodicUpdatePurpose) {
      const review = await prisma.reviewCustomer.findFirst({ where: { userRefHash: consent.userRefHash } });
      if (review) {
        const processedAt = new Date();
        await prisma.reviewCustomer.update({
          where: { userId: review.userId },
          data: {
            requiresReconsent: false,
            status: 'ACTIVE',
            lastKycUpdateAt: processedAt,
            nextReviewAt: computeNextReviewAtFromTier(processedAt, String(review.riskTier)),
          },
        });
        await addReviewAuditEvent({
          userId: review.userId,
          eventType: 'RECONSENT_COMPLETED',
          actor: getActor(req),
          detail: {
            consentId: consent.id,
            approvedBy: actorUserId,
          },
        });
      }
    }

    await addConsentAuditEvent({
      consentId: consent.id,
      eventType: 'CONSENT_APPROVED',
      actor: getActor(req),
      detail: {
        tokenId: consent.tokenId,
        reason: approvalReason,
        actorType,
        approvalActor: actorUserId,
        approvedBy: actorUserId,
        requiresDelegation: consent.requiresDelegation,
        allowReuseAcrossFIs: consent.allowReuseAcrossFIs,
        approvedFields: effectiveApprovedFields,
        delegationId: delegationAuditContext?.delegationId ?? null,
        delegatedBy: delegationAuditContext?.delegatedBy ?? null,
        delegatee: delegationAuditContext?.delegatee ?? null,
        constraintsSnapshot: delegationAuditContext?.constraintsSnapshot ?? null,
      },
    });

    await addConsentAuditEvent({
      consentId: consent.id,
      eventType: 'ASSERTION_ISSUED',
      actor: getActor(req),
      detail: {
        jti: assertionJti,
        nonce: consent.nonce,
        tokenId: consent.tokenId,
        fiId: consent.fiId,
        scope: effectiveApprovedFields,
        purpose: consent.purpose,
        actorType,
        approvalActor: actorUserId,
        approvedBy: actorUserId,
        requiresDelegation: consent.requiresDelegation,
        allowReuseAcrossFIs: consent.allowReuseAcrossFIs,
        delegationId: delegationAuditContext?.delegationId ?? null,
        delegatedBy: delegationAuditContext?.delegatedBy ?? null,
        delegatee: delegationAuditContext?.delegatee ?? null,
        constraintsSnapshot: delegationAuditContext?.constraintsSnapshot ?? null,
      },
    });

    logger.info({ consentId: consent.id, tokenId: consent.tokenId, fiId: consent.fiId }, 'consent approved and assertion issued');

    res.json({
      consentId: consent.id,
      status: 'APPROVED',
      tokenId: consent.tokenId,
      assertionJwt,
      jti: assertionJti,
      nonce: consent.nonce,
      aud: consent.fiId,
      expInSeconds: assertionTtlSeconds,
      purpose: consent.purpose,
      scope: effectiveApprovedFields,
      requiresDelegation: consent.requiresDelegation,
      allowReuseAcrossFIs: consent.allowReuseAcrossFIs,
      actorType,
      approvedBy: actorUserId,
      approvalActor: actorUserId,
      delegationId: delegationAuditContext?.delegationId ?? null,
      delegatedBy: delegationAuditContext?.delegatedBy ?? null,
      delegatee: delegationAuditContext?.delegatee ?? null,
      constraintsSnapshot: delegationAuditContext?.constraintsSnapshot ?? null,
      expiresAt: consent.expiresAt.toISOString(),
      disclosedClaims,
    });
  })
);

app.post(
  '/v1/consent/:consentId/reject',
  validateAccessToken,
  requireScopes(approveScopes),
  validateParams(consentParamsSchema),
  validateBody(rejectSchema),
  asyncHandler(async (req, res) => {
    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }

    const consent = await prisma.consentRecord.findUnique({
      where: { id: req.params.consentId },
    });

    if (!consent) {
      return res.status(404).json({ error: 'Consent not found' });
    }

    if (new Date().getTime() > consent.expiresAt.getTime()) {
      return res.status(409).json({
        error: 'consent_expired',
        message: 'Consent TTL has elapsed. Renew consent before taking action.',
        expiresAt: consent.expiresAt.toISOString(),
      });
    }

    if (consent.status !== 'PENDING') {
      return res.status(409).json({ error: 'Consent is not in PENDING state' });
    }

    const actorAccess = await resolveConsentActorAccess({
      consentUserRefHash: consent.userRefHash,
      actorUserId,
    });
    if (!actorAccess.allowed) {
      return res.status(403).json({ error: 'delegation_required' });
    }

    const actorType = actorAccess.actorType;
    if (consent.requiresDelegation && actorType !== 'DELEGATE') {
      return res.status(403).json({
        error: 'delegation_required',
        message: 'Nominee delegation approval is required for this consent.',
      });
    }

    const updated = await prisma.consentRecord.update({
      where: { id: consent.id },
      data: {
        status: 'REJECTED',
        actorType,
        approvedBy: actorUserId,
      },
    });

    await addConsentAuditEvent({
      consentId: consent.id,
      eventType: 'CONSENT_REJECTED',
      actor: getActor(req),
      detail: {
        reason: req.body.reason ?? null,
        actorType,
        approvalActor: actorUserId,
        approvedBy: actorUserId,
        requiresDelegation: consent.requiresDelegation,
        allowReuseAcrossFIs: consent.allowReuseAcrossFIs,
        delegationId: actorAccess.allowed && actorAccess.actorType === 'DELEGATE' ? actorAccess.delegationId ?? null : null,
      },
    });

    logger.info({ consentId: updated.id }, 'consent rejected');

    res.json({
      consentId: updated.id,
      status: updated.status,
      actorType,
      approvalActor: actorUserId,
      approvedBy: actorUserId,
      requiresDelegation: updated.requiresDelegation,
      allowReuseAcrossFIs: updated.allowReuseAcrossFIs,
      expiresAt: updated.expiresAt.toISOString(),
    });
  })
);

app.post(
  '/v1/consent/:consentId/revoke',
  validateAccessToken,
  requireScopes(revokeScopes),
  validateParams(consentParamsSchema),
  validateBody(z.object({ reason: z.string().min(3).max(512).optional() }).strict().optional().default({})),
  asyncHandler(async (req, res) => {
    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }

    const consent = await prisma.consentRecord.findUnique({ where: { id: req.params.consentId } });
    if (!consent) {
      return res.status(404).json({ error: 'consent_not_found' });
    }

    // Only the owner (or an active delegate) can revoke.
    const actorAccess = await resolveConsentActorAccess({
      consentUserRefHash: consent.userRefHash,
      actorUserId,
    });
    if (!actorAccess.allowed) {
      return res.status(403).json({ error: 'delegation_required' });
    }

    const now = new Date();
    if (now.getTime() > consent.expiresAt.getTime()) {
      return res.status(409).json({ error: 'consent_expired', expiresAt: consent.expiresAt.toISOString() });
    }

    if (consent.status !== 'APPROVED') {
      return res.status(409).json({ error: 'consent_not_approved', status: consent.status });
    }


    if (actorAccess.actorType === 'DELEGATE') {
      const sameDelegation =
        Boolean(consent.delegationId) && Boolean(actorAccess.delegationId) && consent.delegationId === actorAccess.delegationId;
      const approvedBySameDelegate =
        typeof consent.approvedBy === 'string' && consent.approvedBy.trim().length > 0 && consent.approvedBy === actorUserId;
      if (!sameDelegation && !approvedBySameDelegate) {
        return res.status(403).json({
          error: 'delegate_revoke_not_permitted',
          message: 'Delegate may revoke only consents approved under the same delegation or by the same delegate.',
        });
      }
    }

    const updated = await prisma.consentRecord.update({
      where: { id: consent.id },
      data: {
        status: 'REVOKED',
        actorType: actorAccess.actorType,
        approvedBy: actorUserId,
      },
    });

    await addConsentAuditEvent({
      consentId: updated.id,
      eventType: 'CONSENT_REVOKED',
      actor: getActor(req),
      detail: {
        reason: (req.body as { reason?: string } | undefined)?.reason ?? null,
        actorType: actorAccess.actorType,
        revokedBy: actorUserId,
        delegationId: actorAccess.actorType === 'DELEGATE' ? actorAccess.delegationId ?? null : null,
      },
    });

    // If this consent was a periodic KYC update re-consent, close the review requirement.
    if (String(updated.purpose ?? '').toUpperCase() === periodicUpdatePurpose) {
      const review = await prisma.reviewCustomer.findFirst({ where: { userRefHash: updated.userRefHash } });
      if (review) {
        await prisma.reviewCustomer.update({
          where: { userId: review.userId },
          data: {
            requiresReconsent: true,
          },
        });
      }
    }

    res.json({
      consentId: updated.id,
      status: updated.status,
      revokedBy: actorUserId,
      expiresAt: updated.expiresAt.toISOString(),
    });
  })
);

app.post(
  '/v1/internal/consents/expire-due',
  validateAccessToken,
  requireScopes(revokeScopes),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const due = await prisma.consentRecord.findMany({
      where: {
        expiresAt: { lte: now },
        status: { in: ['PENDING', 'APPROVED'] },
      },
      orderBy: [{ expiresAt: 'asc' }],
      take: 200,
      select: { id: true, status: true },
    });

    let expired = 0;
    for (const row of due) {
      const updated = await prisma.consentRecord.update({
        where: { id: row.id },
        data: { status: 'EXPIRED' },
      });
      expired += 1;
      await addConsentAuditEvent({
        consentId: updated.id,
        eventType: 'CONSENT_EXPIRED',
        actor: getActor(req),
        detail: { previousStatus: row.status },
      });
    }

    res.json({ now: now.toISOString(), checked: due.length, expired });
  })
);

app.get(
  '/v1/consent/user/:userId',
  validateAccessToken,
  requireScopes(readScopes),
  validateParams(userParamsSchema),
  asyncHandler(async (req, res) => {
    const userRefHash = computeUserRefHashFromIdentifier(req.params.userId);

    const consents = await prisma.consentRecord.findMany({
      where: { userRefHash },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fiId: true,
        purpose: true,
        requestedFields: true,
        requiresDelegation: true,
        allowReuseAcrossFIs: true,
        tokenId: true,
        nonce: true,
        expiresAt: true,
        renewedFromConsentId: true,
        status: true,
        actorType: true,
        approvedBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({
      userId: req.params.userId,
      consents,
    });
  })
);

const port = Number(process.env.PORT ?? 3003);
app.listen(port, () => {
  logger.info({ port }, 'consent-manager listening');
});
