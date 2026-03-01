import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Redis from 'ioredis';
import crypto from 'crypto';
import {
  asyncHandler,
  computeUserRefHashFromIdentifier,
  createLogger,
  createOidcValidator,
  httpLogger,
  requireScopes,
  validateBody,
  validateParams,
  validateQuery,
} from '@bharat/common';
import { checkDatabase, prisma } from '@bharat/db';
import { z } from 'zod';
import { walletServiceScopes } from './scopes.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(httpLogger('wallet-service'));

const logger = createLogger('wallet-service');
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const keycloakIssuerUrl = process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/bharat-kyc-dev';
const keycloakTokenUrl =
  process.env.KEYCLOAK_TOKEN_URL ?? `${keycloakIssuerUrl.replace(/\/$/, '')}/protocol/openid-connect/token`;
const keycloakJwksUrl = process.env.KEYCLOAK_JWKS_URL;
const keycloakJwksCacheTtlMs = Number(process.env.KEYCLOAK_JWKS_CACHE_TTL_MS ?? 600_000);
const consentManagerUrl = process.env.CONSENT_MANAGER_URL ?? 'http://localhost:3003';
const issuerServiceUrl = process.env.ISSUER_SERVICE_URL ?? 'http://localhost:3001';
const issuerAdminClientId = process.env.ISSUER_ADMIN_CLIENT_ID ?? 'issuer-admin';
const issuerAdminClientSecret = (process.env.ISSUER_ADMIN_CLIENT_SECRET ?? '').trim();
const walletOwnerUsername = (process.env.KEYCLOAK_WALLET_OWNER_USER ?? '').trim();
const walletOwnerUserId = (process.env.KEYCLOAK_WALLET_OWNER_USER_ID ?? process.env.VITE_WALLET_OWNER_USER_ID ?? '').trim();
const walletOwnerAliases = new Set(
  [
    process.env.KEYCLOAK_WALLET_OWNER_USER,
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
const walletNomineeAliases = new Set(
  [
    walletNomineeUsername,
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

function sameWalletIdentity(left: string, right: string): boolean {
  return canonicalizeKnownWalletUserId(left) === canonicalizeKnownWalletUserId(right);
}

const validateAccessToken = createOidcValidator({
  issuerUrl: keycloakIssuerUrl,
  jwksUrl: keycloakJwksUrl,
  jwksCacheTtlMs: keycloakJwksCacheTtlMs,
});

const healthQuery = z.object({
  probe: z.enum(['liveness', 'readiness']).optional(),
});

const userIdParams = z.object({
  userId: z.string().min(3).max(256),
});

const consentIdParams = z.object({
  consentId: z.string().uuid(),
});

const delegationIdParams = z.object({
  id: z.string().uuid(),
});

const nomineeIdParams = z.object({
  id: z.string().uuid(),
});

const consentListQuery = z.object({
  view: z.enum(['all', 'inbox', 'history']).optional(),
});

const tokenRenewSchema = z
  .object({
    ttlSeconds: z.number().int().min(300).max(86_400).optional(),
    reason: z.string().min(3).max(512).optional(),
  })
  .strict();

const nomineeCreateSchema = z
  .object({
    nomineeUserId: z.string().min(3).max(256),
  })
  .strict();

const consentActionSchema = z
  .object({
    reason: z.string().min(3).max(512).optional(),
    approvedFields: z.array(z.string().min(1).max(128)).min(1).max(20).optional(),
  })
  .strict()
  .optional()
  .default({});

const delegationCreateSchema = z
  .object({
    ownerUserId: z.string().min(3).max(256),
    delegateUserId: z.string().min(3).max(256),
    scope: z.string().min(1).max(128).default('consent.approve'),
    allowedPurposes: z.array(z.string().min(1).max(128)).min(1).max(20),
    allowedFields: z.array(z.string().min(1).max(128)).min(1).max(20),
    expiresAt: z.string().datetime(),
  })
  .strict();

const delegationScopes = new Set(['consent.approve', '*']);

const periodicUpdatePurpose = 'PERIODIC_KYC_UPDATE';

async function getServiceToken(scope: string) {
  if (!issuerAdminClientSecret) {
    throw new Error('missing_issuer_admin_secret');
  }

  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  body.set('client_id', issuerAdminClientId);
  body.set('client_secret', issuerAdminClientSecret);
  body.set('scope', scope);

  const response = await fetch(keycloakTokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
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

function buildDemoKycPayload(userId: string) {
  return {
    fullName: `Demo ${userId}`,
    dob: '1992-03-21',
    idNumber: `ID-${userId}`,
    email: `${userId}@example.com`,
    phone: '+91-9000000000',
    addressLine1: 'Demo Address',
    pincode: '700001',
    userId,
  };
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

function normalizeStringList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function proxyConsentAction(input: {
  authorizationHeader: string;
  consentId: string;
  action: 'approve' | 'reject' | 'revoke';
  reason?: string;
  approvedFields?: string[];
}) {
  const response = await fetch(
    `${consentManagerUrl.replace(/\/$/, '')}/v1/consent/${encodeURIComponent(input.consentId)}/${input.action}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: input.authorizationHeader,
      },
      body: JSON.stringify({
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.action === 'approve' && Array.isArray(input.approvedFields) && input.approvedFields.length > 0
          ? { approvedFields: input.approvedFields }
          : {}),
      }),
    }
  );

  const text = await response.text();
  let payload: unknown = {};
  if (text.trim().length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
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
  '/v1/wallet/:userId/tokens',
  validateAccessToken,
  requireScopes([...walletServiceScopes.tokenRead]),
  validateParams(userIdParams),
  asyncHandler(async (req, res) => {
    const userRefHash = computeUserRefHashFromIdentifier(req.params.userId);
    const tokens = await prisma.registryRecord.findMany({
      where: { userRefHash },
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        tokenId: true,
        issuerId: true,
        status: true,
        version: true,
        issuedAt: true,
        expiresAt: true,
        supersededBy: true,
        updatedAt: true,
      },
    });

    res.json({
      userId: req.params.userId,
      lifecycleStatus: tokens[0]?.status ?? 'NONE',
      tokens,
    });
  })
);

app.post(
  '/v1/wallet/:userId/tokens/renew',
  validateAccessToken,
  requireScopes([...walletServiceScopes.tokenRead]),
  validateParams(userIdParams),
  validateBody(tokenRenewSchema),
  asyncHandler(async (req, res) => {
    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }
    if (!sameWalletIdentity(actorUserId, req.params.userId)) {
      return res.status(403).json({ error: 'wallet_user_mismatch' });
    }

    const userId = req.params.userId;
    const userRefHash = computeUserRefHashFromIdentifier(userId);

    const latest = await prisma.registryRecord.findFirst({
      where: { userRefHash },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const serviceToken = await getServiceToken('token.issue');
    const kyc = buildDemoKycPayload(userId);

    if (!latest || latest.status !== 'ACTIVE') {
      // No active token exists (or last token is not active) → issue new token.
      const response = await fetch(`${issuerServiceUrl.replace(/\/$/, '')}/v1/issuer/kyc/issue`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify({
          kyc,
          ...(typeof req.body.ttlSeconds === 'number' ? { ttlSeconds: req.body.ttlSeconds } : {}),
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        return res.status(502).json({ error: 'issuer_issue_failed', detail: text });
      }
      const issued = (await response.json()) as { tokenId: string; tokenJwt?: string };
      return res.status(201).json({ mode: 'issue', tokenId: issued.tokenId });
    }

    // Active token exists → supersede (renew) it.
    const response = await fetch(
      `${issuerServiceUrl.replace(/\/$/, '')}/v1/issuer/token/${encodeURIComponent(latest.tokenId)}/supersede`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify({
          kyc,
          ...(typeof req.body.ttlSeconds === 'number' ? { ttlSeconds: req.body.ttlSeconds } : {}),
          reason: req.body.reason ?? 'wallet_token_renewal',
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: 'issuer_supersede_failed', detail: text });
    }

    const renewed = (await response.json()) as { tokenId: string; tokenJwt?: string; supersedes?: string };
    return res.status(201).json({ mode: 'supersede', tokenId: renewed.tokenId, supersedes: latest.tokenId });
  })
);

app.get(
  '/v1/wallet/:userId/review-status',
  validateAccessToken,
  requireScopes([...walletServiceScopes.consentRead]),
  validateParams(userIdParams),
  asyncHandler(async (req, res) => {
    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }
    if (!sameWalletIdentity(actorUserId, req.params.userId)) {
      return res.status(403).json({ error: 'wallet_user_mismatch' });
    }

    const review = await prisma.reviewCustomer.findUnique({ where: { userId: req.params.userId } });
    if (!review) {
      return res.json({ userId: req.params.userId, review: null });
    }

    res.json({
      userId: req.params.userId,
      review: {
        userId: review.userId,
        riskTier: review.riskTier,
        lastKycUpdateAt: review.lastKycUpdateAt.toISOString(),
        nextReviewAt: review.nextReviewAt.toISOString(),
        requiresReconsent: review.requiresReconsent,
        status: review.status,
      },
    });
  })
);

app.post(
  '/v1/wallet/:userId/review/request-reconsent',
  validateAccessToken,
  requireScopes([...walletServiceScopes.consentApprove]),
  validateParams(userIdParams),
  asyncHandler(async (req, res) => {
    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }
    if (!sameWalletIdentity(actorUserId, req.params.userId)) {
      return res.status(403).json({ error: 'wallet_user_mismatch' });
    }

    const review = await prisma.reviewCustomer.findUnique({ where: { userId: req.params.userId } });
    if (!review || review.requiresReconsent !== true) {
      return res.status(409).json({ error: 'reconsent_not_required' });
    }

    const now = new Date();
    const userRefHash = computeUserRefHashFromIdentifier(req.params.userId);
    const existing = await prisma.consentRecord.findFirst({
      where: {
        userRefHash,
        purpose: periodicUpdatePurpose,
        status: 'PENDING',
        expiresAt: { gt: now },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    if (existing) {
      return res.status(200).json({
        consentId: existing.id,
        status: existing.status,
        expiresAt: existing.expiresAt.toISOString(),
        message: 'Existing periodic update consent already pending.',
      });
    }

    const activeToken = await prisma.registryRecord.findFirst({
      where: { userRefHash, status: 'ACTIVE', expiresAt: { gt: now } },
      orderBy: [{ updatedAt: 'desc' }],
    });
    if (!activeToken) {
      return res.status(404).json({ error: 'token_not_active', message: 'No ACTIVE token available for periodic update.' });
    }

    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const created = await prisma.consentRecord.create({
      data: {
        userRefHash,
        fiId: 'CKYCR',
        purpose: periodicUpdatePurpose,
        requestedFields: ['name', 'dob', 'address', 'pan', 'aadhaarMasked', 'phone', 'email'],
        requiresDelegation: false,
        allowReuseAcrossFIs: true,
        tokenId: activeToken.tokenId,
        nonce: crypto.randomUUID(),
        expiresAt,
      },
    });

    await prisma.consentAuditEvent.create({
      data: {
        consentId: created.id,
        eventType: 'PERIODIC_RECONSENT_REQUESTED',
        actor: actorUserId,
        detail: {
          riskTier: review.riskTier,
          nextReviewAt: review.nextReviewAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      },
    });

    res.status(201).json({ consentId: created.id, status: created.status, expiresAt: created.expiresAt.toISOString() });
  })
);

app.get(
  '/v1/wallet/:userId/consents',
  validateAccessToken,
  requireScopes([...walletServiceScopes.consentRead]),
  validateParams(userIdParams),
  validateQuery(consentListQuery),
  asyncHandler(async (req, res) => {
    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }
    if (!sameWalletIdentity(actorUserId, req.params.userId)) {
      return res.status(403).json({ error: 'wallet_user_mismatch' });
    }

    const view = (req.query.view ?? 'all') as 'all' | 'inbox' | 'history';
    const now = new Date();
    const actorRefHash = computeUserRefHashFromIdentifier(actorUserId);

    // Lifecycle hygiene: mark expired consents in storage so all portals stay consistent.
    const dueExpirations = await prisma.consentRecord.findMany({
      where: {
        expiresAt: { lte: now },
        status: { in: ['PENDING', 'APPROVED'] },
      },
      take: 200,
      select: { id: true, status: true },
    });
    for (const row of dueExpirations) {
      await prisma.consentRecord.update({
        where: { id: row.id },
        data: { status: 'EXPIRED' },
      });
      await prisma.consentAuditEvent.create({
        data: {
          consentId: row.id,
          eventType: 'CONSENT_EXPIRED',
          actor: 'system',
          detail: { previousStatus: row.status },
        },
      });
    }

    // Delegated access: list active delegations where the current wallet user is the delegate.
    const activeDelegations = await prisma.delegation.findMany({
      where: {
        delegateRefHash: actorRefHash,
        status: 'ACTIVE',
        expiresAt: { gt: now },
        scope: { in: ['consent.approve', '*'] },
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        ownerUserId: true,
        ownerRefHash: true,
        delegateUserId: true,
        delegateRefHash: true,
        scope: true,
        allowedPurposes: true,
        allowedFields: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    const ownerRefHashes = [...new Set(activeDelegations.map((d) => d.ownerRefHash))];

    const whereClause =
      view === 'inbox'
        ? {
            status: 'PENDING' as const,
            OR: [{ userRefHash: actorRefHash }, ...(ownerRefHashes.length > 0 ? [{ userRefHash: { in: ownerRefHashes } }] : [])],
          }
        : view === 'history'
          ? {
              AND: [
                { status: { not: 'PENDING' as const } },
                {
                  OR: [
                    { userRefHash: actorRefHash },
                    { approvedBy: actorUserId },
                  ],
                },
              ],
            }
          : {
              OR: [
                { userRefHash: actorRefHash },
                ...(ownerRefHashes.length > 0 ? [{ userRefHash: { in: ownerRefHashes } }] : []),
                { approvedBy: actorUserId },
              ],
            };

    const rawConsents = await prisma.consentRecord.findMany({
      where: whereClause,
      orderBy: [{ createdAt: 'desc' }],
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
        delegationId: true,
        assertionJti: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const delegationByOwnerHash = new Map<string, (typeof activeDelegations)[number]>();
    for (const delegation of activeDelegations) {
      if (!delegationByOwnerHash.has(delegation.ownerRefHash)) {
        delegationByOwnerHash.set(delegation.ownerRefHash, delegation);
      }
    }

    const consents = rawConsents.map((consent) => {
      const ownerRefHash = consent.userRefHash;
      const delegation = delegationByOwnerHash.get(ownerRefHash);
      const delegatedInbox = Boolean(delegation && ownerRefHash !== actorRefHash && consent.status === 'PENDING');
      const effectiveStatus =
        consent.status === 'APPROVED' && consent.expiresAt && new Date(consent.expiresAt).getTime() <= now.getTime()
          ? 'EXPIRED'
          : consent.status;

      return {
        ...consent,
        lifecycleStatus: effectiveStatus,
        subjectUserId: ownerRefHash === actorRefHash ? actorUserId : delegation?.ownerUserId ?? null,
        actedByUserId: consent.approvedBy ?? null,
        actedByType: consent.actorType ?? null,
        delegatedContext: delegatedInbox
          ? {
              mode: 'DELEGATED' as const,
              delegationId: delegation?.id ?? null,
              delegatedBy: delegation?.ownerUserId ?? null,
              delegatee: actorUserId,
              delegationExpiresAt: delegation?.expiresAt ?? null,
            }
          : {
              mode: 'SELF' as const,
              delegationId: consent.delegationId ?? null,
              delegatedBy: null,
              delegatee: null,
              delegationExpiresAt: null,
            },
      };
    });

    res.json({
      userId: req.params.userId,
      view,
      consentStatus: consents[0]?.lifecycleStatus ?? 'NONE',
      consents,
    });
  })
);

app.get(
  '/v1/wallet/:userId/nominees',
  validateAccessToken,
  requireScopes([...walletServiceScopes.consentRead]),
  validateParams(userIdParams),
  asyncHandler(async (req, res) => {
    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }
    if (!sameWalletIdentity(actorUserId, req.params.userId)) {
      return res.status(403).json({ error: 'owner_authorization_required' });
    }

    const ownerRefHash = computeUserRefHashFromIdentifier(req.params.userId);
    const nominees = await prisma.nominee.findMany({
      where: { ownerRefHash },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        ownerUserId: true,
        nomineeUserId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ userId: req.params.userId, nominees });
  })
);

app.post(
  '/v1/wallet/:userId/nominees',
  validateAccessToken,
  requireScopes([...walletServiceScopes.consentApprove]),
  validateParams(userIdParams),
  validateBody(nomineeCreateSchema),
  asyncHandler(async (req, res) => {
    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }
    if (!sameWalletIdentity(actorUserId, req.params.userId)) {
      return res.status(403).json({ error: 'owner_authorization_required' });
    }

    const nomineeUserId = String(req.body.nomineeUserId).trim();
    if (!nomineeUserId) {
      return res.status(400).json({ error: 'nominee_user_required' });
    }

    const ownerUserId = req.params.userId;
    const ownerRefHash = computeUserRefHashFromIdentifier(ownerUserId);
    const nomineeRefHash = computeUserRefHashFromIdentifier(nomineeUserId);

    const nominee = await prisma.nominee.upsert({
      where: {
        ownerRefHash_nomineeRefHash: {
          ownerRefHash,
          nomineeRefHash,
        },
      },
      create: {
        ownerUserId,
        ownerRefHash,
        nomineeUserId,
        nomineeRefHash,
        status: 'ACTIVE',
      },
      update: {
        nomineeUserId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        ownerUserId: true,
        nomineeUserId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(201).json(nominee);
  })
);

app.post(
  '/v1/wallet/:userId/nominees/:id/disable',
  validateAccessToken,
  requireScopes([...walletServiceScopes.consentApprove]),
  validateParams(userIdParams.merge(nomineeIdParams)),
  asyncHandler(async (req, res) => {
    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }
    if (!sameWalletIdentity(actorUserId, req.params.userId)) {
      return res.status(403).json({ error: 'owner_authorization_required' });
    }

    const ownerRefHash = computeUserRefHashFromIdentifier(req.params.userId);
    const nominee = await prisma.nominee.findFirst({ where: { id: req.params.id, ownerRefHash } });
    if (!nominee) {
      return res.status(404).json({ error: 'nominee_not_found' });
    }

    const updated = await prisma.nominee.update({
      where: { id: nominee.id },
      data: { status: 'DISABLED' },
      select: { id: true, status: true, updatedAt: true },
    });

    // Also revoke active delegations to this nominee for safety.
    await prisma.delegation.updateMany({
      where: {
        ownerRefHash,
        delegateRefHash: nominee.nomineeRefHash,
        status: 'ACTIVE',
      },
      data: { status: 'REVOKED' },
    });

    res.json(updated);
  })
);

app.post(
  '/v1/wallet/:userId/nominees/:id/enable',
  validateAccessToken,
  requireScopes([...walletServiceScopes.consentApprove]),
  validateParams(userIdParams.merge(nomineeIdParams)),
  asyncHandler(async (req, res) => {
    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }
    if (!sameWalletIdentity(actorUserId, req.params.userId)) {
      return res.status(403).json({ error: 'owner_authorization_required' });
    }

    const ownerRefHash = computeUserRefHashFromIdentifier(req.params.userId);
    const nominee = await prisma.nominee.findFirst({ where: { id: req.params.id, ownerRefHash } });
    if (!nominee) {
      return res.status(404).json({ error: 'nominee_not_found' });
    }

    const updated = await prisma.nominee.update({
      where: { id: nominee.id },
      data: { status: 'ACTIVE' },
      select: { id: true, status: true, updatedAt: true },
    });

    res.json(updated);
  })
);

app.post(
  '/v1/wallet/delegations',
  validateAccessToken,
  requireScopes([...walletServiceScopes.consentApprove]),
  validateBody(delegationCreateSchema),
  asyncHandler(async (req, res) => {
    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }

    const { ownerUserId, delegateUserId, scope } = req.body;
    if (!delegationScopes.has(scope)) {
      return res.status(400).json({ error: 'invalid_scope' });
    }

    if (actorUserId !== ownerUserId) {
      return res.status(403).json({ error: 'owner_authorization_required' });
    }

    // Delegation must be created only from an ACTIVE nominee.
    const ownerRefHash = computeUserRefHashFromIdentifier(ownerUserId);
    const delegateRefHash = computeUserRefHashFromIdentifier(delegateUserId);
    const nominee = await prisma.nominee.findFirst({
      where: {
        ownerRefHash,
        nomineeRefHash: delegateRefHash,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (!nominee) {
      return res.status(409).json({
        error: 'nominee_required',
        message: 'Delegation can only be created for an ACTIVE nominee. Create/enable nominee first.',
      });
    }

    const expiresAt = new Date(req.body.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'expires_at_invalid_or_past' });
    }

    const allowedPurposes = normalizeStringList(req.body.allowedPurposes);
    if (allowedPurposes.length === 0) {
      return res.status(400).json({
        error: 'allowed_purposes_required',
        message: 'Delegation must include at least one allowed purpose.',
      });
    }

    const allowedFields = normalizeStringList(req.body.allowedFields);
    if (allowedFields.length === 0) {
      return res.status(400).json({
        error: 'allowed_fields_required',
        message: 'Delegation must include at least one allowed field.',
      });
    }

    await prisma.delegation.updateMany({
      where: {
        status: 'ACTIVE',
        ownerRefHash,
        delegateRefHash,
        scope,
      },
      data: {
        status: 'REVOKED',
      },
    });

    const delegation = await prisma.delegation.create({
      data: {
        ownerUserId,
        ownerRefHash,
        delegateUserId,
        delegateRefHash,
        scope,
        allowedPurposes,
        allowedFields,
        status: 'ACTIVE',
        expiresAt,
      },
    });

    logger.info(
      {
        delegationId: delegation.id,
        ownerUserId,
        delegateUserId,
        scope,
        allowedPurposesCount: allowedPurposes.length,
        allowedFieldsCount: allowedFields.length,
      },
      'wallet delegation created'
    );

    res.status(201).json({
      id: delegation.id,
      ownerUserId: delegation.ownerUserId,
      delegateUserId: delegation.delegateUserId,
      scope: delegation.scope,
      allowedPurposes: delegation.allowedPurposes,
      allowedFields: delegation.allowedFields,
      status: delegation.status,
      createdAt: delegation.createdAt,
      expiresAt: delegation.expiresAt,
    });
  })
);

app.get(
  '/v1/wallet/:userId/delegations',
  validateAccessToken,
  requireScopes([...walletServiceScopes.consentRead]),
  validateParams(userIdParams),
  asyncHandler(async (req, res) => {
    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }
    if (!sameWalletIdentity(actorUserId, req.params.userId)) {
      return res.status(403).json({ error: 'owner_authorization_required' });
    }

    const ownerRefHash = computeUserRefHashFromIdentifier(req.params.userId);
    await prisma.delegation.updateMany({
      where: {
        ownerRefHash,
        status: 'ACTIVE',
        expiresAt: {
          lte: new Date(),
        },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    const delegations = await prisma.delegation.findMany({
      where: { ownerRefHash },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        ownerUserId: true,
        delegateUserId: true,
        scope: true,
        allowedPurposes: true,
        allowedFields: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        updatedAt: true,
      },
    });

    res.json({
      userId: req.params.userId,
      delegations,
    });
  })
);

app.post(
  '/v1/wallet/delegations/:id/revoke',
  validateAccessToken,
  requireScopes([...walletServiceScopes.consentApprove]),
  validateParams(delegationIdParams),
  asyncHandler(async (req, res) => {
    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({ error: 'actor_user_not_resolved' });
    }

    const delegation = await prisma.delegation.findUnique({
      where: { id: req.params.id },
    });
    if (!delegation) {
      return res.status(404).json({ error: 'delegation_not_found' });
    }

    const actorRefHash = computeUserRefHashFromIdentifier(canonicalizeKnownWalletUserId(actorUserId));
    const delegationOwnerRefHash = computeUserRefHashFromIdentifier(canonicalizeKnownWalletUserId(delegation.ownerUserId));
    if (actorRefHash !== delegationOwnerRefHash) {
      return res.status(403).json({ error: 'owner_authorization_required' });
    }

    if (delegation.status !== 'ACTIVE') {
      return res.status(409).json({ error: 'delegation_not_active' });
    }

    const updated = await prisma.delegation.update({
      where: { id: delegation.id },
      data: {
        status: 'REVOKED',
      },
    });

    logger.info({ delegationId: updated.id }, 'wallet delegation revoked');

    res.json({
      id: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt,
    });
  })
);

app.post(
  '/v1/wallet/consents/:consentId/approve',
  validateAccessToken,
  requireScopes([...walletServiceScopes.consentApprove]),
  validateParams(consentIdParams),
  validateBody(consentActionSchema),
  asyncHandler(async (req, res) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
      return res.status(401).json({ error: 'missing_bearer_token' });
    }

    const actionBody = req.body as z.infer<typeof consentActionSchema>;
    const reason = typeof actionBody.reason === 'string' ? actionBody.reason : undefined;
    const approvedFields =
      Array.isArray(actionBody.approvedFields)
        ? actionBody.approvedFields.map((field) => field.trim()).filter((field) => field.length > 0)
        : undefined;
    const proxied = await proxyConsentAction({
      authorizationHeader: authorization,
      consentId: req.params.consentId,
      action: 'approve',
      reason,
      approvedFields,
    });

    if (!proxied.ok) {
      logger.warn({ consentId: req.params.consentId, status: proxied.status }, 'wallet consent approve failed');
      return res.status(proxied.status).json(proxied.payload);
    }

    logger.info({ consentId: req.params.consentId }, 'wallet consent approved');
    res.status(200).json(proxied.payload);
  })
);

app.post(
  '/v1/wallet/consents/:consentId/reject',
  validateAccessToken,
  requireScopes([...walletServiceScopes.consentApprove]),
  validateParams(consentIdParams),
  validateBody(consentActionSchema),
  asyncHandler(async (req, res) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
      return res.status(401).json({ error: 'missing_bearer_token' });
    }

    const reason = 'reason' in req.body && typeof req.body.reason === 'string' ? req.body.reason : undefined;
    const proxied = await proxyConsentAction({
      authorizationHeader: authorization,
      consentId: req.params.consentId,
      action: 'reject',
      reason,
    });

    if (!proxied.ok) {
      logger.warn({ consentId: req.params.consentId, status: proxied.status }, 'wallet consent reject failed');
      return res.status(proxied.status).json(proxied.payload);
    }

    logger.info({ consentId: req.params.consentId }, 'wallet consent rejected');
    res.status(200).json(proxied.payload);
  })
);

app.post(
  '/v1/wallet/consents/:consentId/revoke',
  validateAccessToken,
  requireScopes([...walletServiceScopes.consentApprove]),
  validateParams(consentIdParams),
  validateBody(consentActionSchema),
  asyncHandler(async (req, res) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
      return res.status(401).json({ error: 'missing_bearer_token' });
    }

    const reason = 'reason' in req.body && typeof req.body.reason === 'string' ? req.body.reason : undefined;
    const proxied = await proxyConsentAction({
      authorizationHeader: authorization,
      consentId: req.params.consentId,
      action: 'revoke',
      reason,
    });

    if (!proxied.ok) {
      logger.warn({ consentId: req.params.consentId, status: proxied.status }, 'wallet consent revoke failed');
      return res.status(proxied.status).json(proxied.payload);
    }

    logger.info({ consentId: req.params.consentId }, 'wallet consent revoked');
    res.status(200).json(proxied.payload);
  })
);

const port = Number(process.env.PORT ?? 3004);
app.listen(port, () => {
  logger.info({ port }, 'wallet-service listening');
});
