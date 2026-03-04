import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Redis from 'ioredis';
import {
  asyncHandler,
  computeUserRefHashFromIdentifier,
  createLogger,
  createOidcValidator,
  createRemoteJwksResolver,
  httpLogger,
  RedisReplayProtector,
  requireScopes,
  validateBody,
  validateQuery,
} from '@bharat/common';
import { checkDatabase, prisma } from '@bharat/db';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { verifyAssertion, AssertionVerificationError } from './assertion-verifier.js';
import { evaluateConsentStatusForVerification } from './consent-policy.js';
import { fiServiceScopes } from './scopes.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(httpLogger('fi-service'));

const logger = createLogger('fi-service');
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

const keycloakIssuerUrl = process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/bharat-kyc-dev';
const keycloakJwksUrl = process.env.KEYCLOAK_JWKS_URL;
const registryUrl = process.env.REGISTRY_URL ?? 'http://localhost:3002';
const consentManagerUrl = process.env.CONSENT_MANAGER_URL ?? 'http://localhost:3003';
const issuerServiceUrl = process.env.ISSUER_SERVICE_URL ?? 'http://localhost:3001';
const keycloakTokenUrl =
  process.env.KEYCLOAK_TOKEN_URL ?? `${keycloakIssuerUrl.replace(/\/$/, '')}/protocol/openid-connect/token`;
const fiIssuerClientId = process.env.FI_ISSUER_CLIENT_ID ?? 'issuer-admin';
const fiIssuerClientSecret = (process.env.FI_ISSUER_CLIENT_SECRET ?? '').trim();
const consentJwksUrl = process.env.CONSENT_JWKS_URL ?? `${consentManagerUrl.replace(/\/$/, '')}/.well-known/jwks.json`;
const consentIssuerId = process.env.CONSENT_ISSUER_ID ?? 'bharat-consent-manager';
const consentJwksCacheTtlMs = Number(process.env.CONSENT_JWKS_CACHE_TTL_MS ?? 600_000);
const keycloakJwksCacheTtlMs = Number(process.env.KEYCLOAK_JWKS_CACHE_TTL_MS ?? 600_000);

const jtiReplayProtector = new RedisReplayProtector(redis, 'fi:assertion:jti');
const nonceReplayProtector = new RedisReplayProtector(redis, 'fi:assertion:nonce');
const consentJwks = createRemoteJwksResolver({
  issuerUrl: consentManagerUrl,
  jwksUrl: consentJwksUrl,
  ttlMs: consentJwksCacheTtlMs,
});

const validateAccessToken = createOidcValidator({
  issuerUrl: keycloakIssuerUrl,
  jwksUrl: keycloakJwksUrl,
  jwksCacheTtlMs: keycloakJwksCacheTtlMs,
});

const healthQuery = z.object({
  probe: z.enum(['liveness', 'readiness']).optional(),
});

const requestKycSchema = z
  .object({
    userId: z.string().min(3).max(256),
    fiId: z.string().min(2).max(128),
    purpose: z.string().min(2).max(128),
    requestedFields: z.array(z.string().min(1)).min(1).max(20),
    ttlSeconds: z.number().int().positive().max(86400).optional(),
    requiresDelegation: z.boolean().optional(),
    allowReuseAcrossFIs: z.boolean().optional(),
  })
  .strict();

const verifyAssertionSchema = z
  .object({
    consentId: z.string().uuid(),
    assertionJwt: z.string().min(32),
  })
  .strict();

const renewConsentSchema = z
  .object({
    consentId: z.string().uuid(),
  })
  .strict();

const revokeConsentSchema = z
  .object({
    consentId: z.string().uuid(),
    reason: z.string().min(1).max(512).optional(),
  })
  .strict();

const onboardUserSchema = z
  .object({
    userId: z.string().min(3).max(256),
    ttlSeconds: z.number().int().positive().max(86400).optional(),
  })
  .strict();

function getActor(req: express.Request): string {
  const payload = req.oidc?.payload;
  if (!payload) return 'unknown';
  if (typeof payload.azp === 'string') return payload.azp;
  if (typeof payload.client_id === 'string') return payload.client_id;
  if (typeof payload.sub === 'string') return payload.sub;
  return 'unknown';
}

function asStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function sameStringSet(expected: string[], actual: string[]): boolean {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  if (expectedSet.size !== actualSet.size) {
    return false;
  }
  for (const value of expectedSet) {
    if (!actualSet.has(value)) {
      return false;
    }
  }
  return true;
}

async function getServiceToken(scope: string): Promise<string> {
  if (!fiIssuerClientSecret) {
    throw new Error('FI_ISSUER_CLIENT_SECRET not configured');
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: fiIssuerClientId,
    client_secret: fiIssuerClientSecret,
    scope,
  });
  const response = await fetch(keycloakTokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
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

async function issueTokenForUser(userId: string, ttlSeconds?: number) {
  const serviceToken = await getServiceToken('token.issue');
  const kycPayload = {
    fullName: `Demo ${userId}`,
    dob: '1992-03-21',
    idNumber: `ID-${userId}`,
    email: `${userId}@example.com`,
    phone: '+91-9000000000',
    addressLine1: 'Demo Address',
    pincode: '700001',
    userId,
  };

  const response = await fetch(`${issuerServiceUrl.replace(/\/$/, '')}/v1/issuer/kyc/issue`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${serviceToken}`,
    },
    body: JSON.stringify({
      kyc: kycPayload,
      ...(typeof ttlSeconds === 'number' ? { ttlSeconds } : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`issuer_issue_failed:${response.status}:${text}`);
  }

  return (await response.json()) as { tokenId: string; tokenJwt: string };
}

async function fetchConsentBinding(consentId: string, authorizationHeader: string) {
  let response: Response;
  try {
    response = await fetch(`${consentManagerUrl.replace(/\/$/, '')}/v1/internal/consent/${encodeURIComponent(consentId)}/binding`, {
      method: 'GET',
      headers: {
        authorization: authorizationHeader,
      },
    });
  } catch {
    throw new Error('consent_binding_unreachable');
  }

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`consent_binding_failed:${response.status}`);
  }

  return (await response.json()) as {
    consentId: string;
    fiId: string;
    purpose: string;
    requestedFields: string[];
    tokenId: string;
    status: string;
    expiresAt: string;
    renewedFromConsentId?: string | null;
  };
}

async function addAuditEvent(input: {
  fiRequestId?: string;
  eventType: string;
  success?: boolean;
  reason?: string;
  detail?: Prisma.InputJsonValue;
}) {
  await prisma.fiAuditEvent.create({
    data: {
      fiRequestId: input.fiRequestId ?? null,
      eventType: input.eventType,
      success: input.success ?? null,
      reason: input.reason ?? null,
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

app.post(
  '/v1/fi/request-kyc',
  validateAccessToken,
  requireScopes([...fiServiceScopes.kycRequest]),
  validateBody(requestKycSchema),
  asyncHandler(async (req, res) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
      return res.status(401).json({ error: 'missing_bearer_token' });
    }

    let consentResponse: Response;
    try {
      consentResponse = await fetch(`${consentManagerUrl.replace(/\/$/, '')}/v1/consent/create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization,
        },
        body: JSON.stringify(req.body),
      });
    } catch {
      await addAuditEvent({
        eventType: 'KYC_REQUEST_FAILED',
        success: false,
        reason: 'consent_manager_unreachable',
        detail: {
          fiId: req.body.fiId,
          purpose: req.body.purpose,
        },
      });
      return res.status(502).json({ error: 'consent_manager_unreachable' });
    }

    if (!consentResponse.ok) {
      const errorPayload = await consentResponse.text();
      await addAuditEvent({
        eventType: 'KYC_REQUEST_FAILED',
        success: false,
        reason: `consent_manager_${consentResponse.status}`,
        detail: {
          fiId: req.body.fiId,
          purpose: req.body.purpose,
        },
      });

      logger.warn({ fiId: req.body.fiId, status: consentResponse.status }, 'consent creation failed');

      return res.status(consentResponse.status).json({
        error: 'consent_create_failed',
        detail: errorPayload,
      });
    }

    const consentPayload = (await consentResponse.json()) as {
      consentId: string;
      tokenId: string;
      status: string;
      nonce: string;
      ttlSeconds?: number;
      requiresDelegation?: boolean;
      allowReuseAcrossFIs?: boolean;
      expiresAt?: string;
      renewedFromConsentId?: string | null;
      fiId?: string;
      purpose?: string;
      requestedFields?: string[];
    };

    const consentFiId = consentPayload.fiId ?? req.body.fiId;
    const consentPurpose = consentPayload.purpose ?? req.body.purpose;
    const consentRequestedFields = Array.isArray(consentPayload.requestedFields) ? consentPayload.requestedFields : req.body.requestedFields;

    const userRefHash = computeUserRefHashFromIdentifier(req.body.userId);
    const fiRequest = await prisma.fiKycRequest.upsert({
      where: { consentId: consentPayload.consentId },
      create: {
        consentId: consentPayload.consentId,
        userRefHash,
        fiId: consentFiId,
        purpose: consentPurpose,
        requestedFields: consentRequestedFields,
        tokenId: consentPayload.tokenId,
        nonce: consentPayload.nonce,
        status: 'PENDING',
      },
      update: {
        userRefHash,
        fiId: consentFiId,
        purpose: consentPurpose,
        requestedFields: consentRequestedFields,
        tokenId: consentPayload.tokenId,
        nonce: consentPayload.nonce,
        status: 'PENDING',
      },
    await addAuditEvent({
      fiRequestId: fiRequest.id,
      eventType: 'KYC_REQUEST_CREATED',
      success: true,
      reason: 'success',
      detail: {
        tokenId: consentPayload.tokenId,
      },
    });

    logger.info({ fiRequestId: fiRequest.id, consentId: fiRequest.consentId, fiId: fiRequest.fiId }, 'fi request created');

    res.status(201).json({
      consentId: fiRequest.consentId,
      tokenId: fiRequest.tokenId,
      status: fiRequest.status,
      fiId: fiRequest.fiId,
      purpose: fiRequest.purpose,
      requestedFields: asStringArray(fiRequest.requestedFields),
      ttlSeconds: consentPayload.ttlSeconds ?? null,
      requiresDelegation: consentPayload.requiresDelegation ?? false,
      allowReuseAcrossFIs: consentPayload.allowReuseAcrossFIs ?? false,
      expiresAt: consentPayload.expiresAt ?? null,
      renewedFromConsentId: consentPayload.renewedFromConsentId ?? null,
    });
  })
);

app.post(
  '/v1/fi/onboard-user',
  validateAccessToken,
  requireScopes([...fiServiceScopes.kycRequest]),
  validateBody(onboardUserSchema),
  asyncHandler(async (req, res) => {
    const { userId, ttlSeconds } = req.body;
    const normalizedUserId = userId.trim();
    const userRefHash = computeUserRefHashFromIdentifier(normalizedUserId);

    // If active token already exists, surface it.
    const existing = await prisma.registryRecord.findFirst({
      where: { userRefHash, status: 'ACTIVE' },
      orderBy: [{ updatedAt: 'desc' }],
    });
    if (existing) {
      return res.json({ tokenId: existing.tokenId, status: 'ACTIVE', alreadyActive: true });
    }

    const issued = await issueTokenForUser(normalizedUserId, ttlSeconds);
    await addAuditEvent({
      eventType: 'FI_ONBOARD_USER',
      success: true,
      detail: {
        userId: normalizedUserId,
        tokenId: issued.tokenId,
      },
    });

    res.status(201).json({ tokenId: issued.tokenId, status: 'ACTIVE', alreadyActive: false });
  })
);

app.get(
  '/v1/fi/token-coverage',
  validateAccessToken,
  requireScopes([...fiServiceScopes.kycRequest]),
  asyncHandler(async (req, res) => {
    const usersParam = typeof req.query.users === 'string' ? req.query.users : '';
    const userIds = usersParam
      ? usersParam
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : ['wallet-owner-1', 'wallet-user-2'];

    const rows = await Promise.all(
      userIds.map(async (userId) => {
        const userRefHash = computeUserRefHashFromIdentifier(userId);
        const latest = await prisma.registryRecord.findFirst({
          where: { userRefHash },
          orderBy: [{ updatedAt: 'desc' }],
        });

        return {
          userId,
          status: latest?.status ?? 'NONE',
          tokenId: latest?.tokenId ?? null,
          expiresAt: latest?.expiresAt ? latest.expiresAt.toISOString() : null,
          version: latest?.version ?? null,
        };
      })
    );

    const summary = rows.reduce(
      (acc, row) => {
        const status = String(row.status ?? 'NONE').toUpperCase();
        if (status === 'ACTIVE') acc.active += 1;
        else if (status === 'EXPIRED') acc.expired += 1;
        else if (status === 'REVOKED') acc.revoked += 1;
        else acc.none += 1;
        return acc;
      },
      { active: 0, expired: 0, revoked: 0, none: 0 }
    );

    res.json({ users: rows, summary });
  })
);

app.post(
  '/v1/fi/renew-consent',
  validateAccessToken,
  requireScopes([...fiServiceScopes.kycRequest]),
  validateBody(renewConsentSchema),
  asyncHandler(async (req, res) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
      return res.status(401).json({ error: 'missing_bearer_token' });
    }

    const previousFiRequest = await prisma.fiKycRequest.findUnique({
      where: { consentId: req.body.consentId },
    });
    if (!previousFiRequest) {
      return res.status(404).json({ error: 'consent_not_found' });
    }

    let renewResponse: Response;
    try {
      renewResponse = await fetch(
        `${consentManagerUrl.replace(/\/$/, '')}/v1/consent/${encodeURIComponent(req.body.consentId)}/renew`,
        {
          method: 'POST',
          headers: {
            authorization,
          },
        }
      );
    } catch {
      await addAuditEvent({
        fiRequestId: previousFiRequest.id,
        eventType: 'KYC_CONSENT_RENEWED',
        success: false,
        reason: 'consent_manager_unreachable',
        detail: {
          previousConsentId: req.body.consentId,
          actor: getActor(req),
        },
      });
      return res.status(502).json({ error: 'consent_manager_unreachable' });
    }

    if (!renewResponse.ok) {
      const payloadText = await renewResponse.text();
      await addAuditEvent({
        fiRequestId: previousFiRequest.id,
        eventType: 'KYC_CONSENT_RENEWED',
        success: false,
        reason: `consent_renew_failed_${renewResponse.status}`,
        detail: {
          previousConsentId: req.body.consentId,
          actor: getActor(req),
        },
      });
      return res.status(renewResponse.status).json({
        error: 'consent_renew_failed',
        detail: payloadText,
      });
    }

    const renewedConsent = (await renewResponse.json()) as {
      consentId: string;
      tokenId: string;
      status: string;
      nonce: string;
      fiId: string;
      purpose: string;
      requestedFields: string[];
      expiresAt: string;
      renewedFromConsentId?: string | null;
    };

    const renewedRequest = await prisma.fiKycRequest.upsert({
      where: { consentId: renewedConsent.consentId },
      create: {
        consentId: renewedConsent.consentId,
        userRefHash: previousFiRequest.userRefHash,
        fiId: renewedConsent.fiId,
        purpose: renewedConsent.purpose,
        requestedFields: renewedConsent.requestedFields,
        tokenId: renewedConsent.tokenId,
        nonce: renewedConsent.nonce,
        status: renewedConsent.status,
      },
      update: {
        fiId: renewedConsent.fiId,
        purpose: renewedConsent.purpose,
        requestedFields: renewedConsent.requestedFields,
        tokenId: renewedConsent.tokenId,
        nonce: renewedConsent.nonce,
        status: renewedConsent.status,
      },
    });

    await addAuditEvent({
      fiRequestId: renewedRequest.id,
      eventType: 'KYC_CONSENT_RENEWED',
      success: true,
      reason: 'success',
      detail: {
        previousConsentId: req.body.consentId,
        newConsentId: renewedRequest.consentId,
        tokenId: renewedRequest.tokenId,
      },
    });

    logger.info(
      {
        previousConsentId: req.body.consentId,
        newConsentId: renewedRequest.consentId,
        tokenId: renewedRequest.tokenId,
      },
      'fi consent renewed'
    );

    res.status(201).json({
      previousConsentId: req.body.consentId,
      newConsentId: renewedRequest.consentId,
      tokenId: renewedRequest.tokenId,
      status: renewedRequest.status,
      fiId: renewedRequest.fiId,
      purpose: renewedRequest.purpose,
      requestedFields: asStringArray(renewedRequest.requestedFields),
      nonce: renewedRequest.nonce,
      expiresAt: renewedConsent.expiresAt,
      renewedFromConsentId: renewedConsent.renewedFromConsentId ?? req.body.consentId,
    });
  })
);

app.post(
  '/v1/fi/revoke-consent',
  validateAccessToken,
  requireScopes([...fiServiceScopes.kycRequest]),
  validateBody(revokeConsentSchema),
  asyncHandler(async (req, res) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
      return res.status(401).json({ error: 'missing_bearer_token' });
    }

    const fiRequest = await prisma.fiKycRequest.findUnique({ where: { consentId: req.body.consentId } });
    if (!fiRequest) {
      return res.status(404).json({ error: 'consent_not_found' });
    }

    let revokeResponse: Response;
    try {
      revokeResponse = await fetch(`${consentManagerUrl.replace(/\/$/, '')}/v1/consent/${encodeURIComponent(req.body.consentId)}/revoke`, {
        method: 'POST',
        headers: {
          authorization,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: req.body.reason ?? 'fi_revoked_consent' }),
      });
    } catch {
      await addAuditEvent({
        fiRequestId: fiRequest.id,
        eventType: 'KYC_CONSENT_REVOKED',
        success: false,
        reason: 'consent_manager_unreachable',
        detail: { consentId: req.body.consentId, actor: getActor(req) },
      });
      return res.status(502).json({ error: 'consent_manager_unreachable' });
    }

    if (!revokeResponse.ok) {
      const payloadText = await revokeResponse.text();
      await addAuditEvent({
        fiRequestId: fiRequest.id,
        eventType: 'KYC_CONSENT_REVOKED',
        success: false,
        reason: `consent_revoke_failed_${revokeResponse.status}`,
        detail: { consentId: req.body.consentId, actor: getActor(req) },
      });
      return res.status(revokeResponse.status).json({ error: 'consent_revoke_failed', detail: payloadText });
    }

    const revokedConsent = (await revokeResponse.json()) as { consentId?: string; status?: string; tokenId?: string; fiId?: string; };
    await prisma.fiKycRequest.update({ where: { id: fiRequest.id }, data: { status: 'REVOKED' } });
    await addAuditEvent({
      fiRequestId: fiRequest.id,
      eventType: 'KYC_CONSENT_REVOKED',
      success: true,
      reason: 'success',
      detail: { consentId: req.body.consentId, actor: getActor(req), status: revokedConsent.status ?? 'REVOKED' },
    });

    return res.json({
      consentId: revokedConsent.consentId ?? req.body.consentId,
      status: String(revokedConsent.status ?? 'REVOKED').toUpperCase(),
      tokenId: revokedConsent.tokenId ?? fiRequest.tokenId,
      fiId: revokedConsent.fiId ?? fiRequest.fiId,
    });
  })
);

app.post(
  '/v1/fi/verify-assertion',
  validateAccessToken,
  requireScopes([...fiServiceScopes.kycVerify]),
  validateBody(verifyAssertionSchema),
  asyncHandler(async (req, res) => {
    const fiRequest = await prisma.fiKycRequest.findUnique({
      where: { consentId: req.body.consentId },
    });

    if (!fiRequest) {
      await addAuditEvent({
        eventType: 'ASSERTION_VERIFIED',
        success: false,
        reason: 'consent_not_found',
        detail: {
          consentId: req.body.consentId,
        },
      });
      return res.status(404).json({ error: 'consent_not_found' });
    }

    const authHeader = req.headers.authorization ?? '';
    const actor = getActor(req);

    let consentBinding: Awaited<ReturnType<typeof fetchConsentBinding>>;
    try {
      consentBinding = await fetchConsentBinding(fiRequest.consentId, authHeader);
    } catch (error) {
      await addAuditEvent({
        fiRequestId: fiRequest.id,
        eventType: 'ASSERTION_VERIFIED',
        success: false,
        reason: error instanceof Error ? error.message : 'consent_binding_failed',
        detail: {
          consentId: fiRequest.consentId,
          actor,
        },
      });
      return res.status(502).json({ error: 'consent_binding_lookup_failed' });
    }

    if (!consentBinding) {
      await addAuditEvent({
        fiRequestId: fiRequest.id,
        eventType: 'ASSERTION_VERIFIED',
        success: false,
        reason: 'consent_not_found',
        detail: {
          consentId: fiRequest.consentId,
          actor,
        },
      });
      return res.status(404).json({ error: 'consent_not_found' });
    }

    if (
      fiRequest.fiId !== consentBinding.fiId ||
      fiRequest.purpose !== consentBinding.purpose ||
      !sameStringSet(asStringArray(fiRequest.requestedFields), consentBinding.requestedFields)
    ) {
      await addAuditEvent({
        fiRequestId: fiRequest.id,
        eventType: 'ASSERTION_VERIFIED',
        success: false,
        reason: 'consent_binding_mismatch',
        detail: {
          consentId: fiRequest.consentId,
          actor,
        },
      });
      return res.status(409).json({ error: 'consent_binding_mismatch' });
    }

    const consentStatusFailure = evaluateConsentStatusForVerification({
      status: consentBinding.status,
      expiresAt: consentBinding.expiresAt,
    });
    if (consentStatusFailure) {
      await prisma.fiKycRequest.update({
        where: { id: fiRequest.id },
        data: {
          status: 'FAILED',
        },
      });

      await addAuditEvent({
        fiRequestId: fiRequest.id,
        eventType: 'ASSERTION_VERIFIED',
        success: false,
        reason: consentStatusFailure.error,
        detail: {
          consentId: fiRequest.consentId,
          consentStatus: consentBinding.status,
          consentExpiresAt: consentBinding.expiresAt,
          actor,
        },
      });

      logger.warn(
        {
          fiRequestId: fiRequest.id,
          consentId: fiRequest.consentId,
          consentStatus: consentBinding.status,
          reason: consentStatusFailure.error,
          actor,
        },
        'assertion verification blocked by consent status'
      );

      return res.status(consentStatusFailure.httpStatus).json({
        verified: false,
        error: consentStatusFailure.error,
        message: consentStatusFailure.message,
        consentStatus: consentBinding.status,
        consentExpiresAt: consentBinding.expiresAt,
      });
    }

    const expectedScope = consentBinding.requestedFields;

    try {
      const verified = await verifyAssertion({
        assertionJwt: req.body.assertionJwt,
        jwkResolver: consentJwks,
        expectedIssuer: consentIssuerId,
        expectedAudience: consentBinding.fiId,
        expectedPurpose: consentBinding.purpose,
        expectedScope,
        jtiReplayProtector,
        nonceReplayProtector,
        lookupRegistryStatus: async (tokenId: string) => {
          const response = await fetch(`${registryUrl.replace(/\/$/, '')}/v1/registry/token/${encodeURIComponent(tokenId)}`, {
            method: 'GET',
            headers: {
              authorization: authHeader,
            },
          });

          if (response.status === 404) {
            return null;
          }

          if (!response.ok) {
            throw new Error(`registry_lookup_failed:${response.status}`);
          }

          const payload = (await response.json()) as { status?: string };
          return typeof payload.status === 'string' ? payload.status : null;
        },
      });

      await prisma.fiKycRequest.update({
        where: { id: fiRequest.id },
        data: {
          status: 'VERIFIED',
        },
      });

      await addAuditEvent({
        fiRequestId: fiRequest.id,
        eventType: 'ASSERTION_VERIFIED',
        success: true,
        reason: 'success',
        detail: {
          tokenId: verified.tokenId,
          actor,
        },
      });

      logger.info({ fiRequestId: fiRequest.id, tokenId: verified.tokenId, actor }, 'assertion verified');

      res.json({
        verified: true,
        consentId: fiRequest.consentId,
        fiId: consentBinding.fiId,
        purpose: consentBinding.purpose,
        tokenId: verified.tokenId,
        disclosedClaims: verified.disclosedClaims,
      });
    } catch (error) {
      const verificationError =
        error instanceof AssertionVerificationError
          ? error
          : new AssertionVerificationError('assertion verification failed', 'invalid_signature', 401);

      await prisma.fiKycRequest.update({
        where: { id: fiRequest.id },
        data: {
          status: 'FAILED',
        },
      });

      await addAuditEvent({
        fiRequestId: fiRequest.id,
        eventType: 'ASSERTION_VERIFIED',
        success: false,
        reason: verificationError.reason,
        detail: {
          tokenId: fiRequest.tokenId,
          actor,
        },
      });

      logger.warn(
        { fiRequestId: fiRequest.id, reason: verificationError.reason, tokenId: fiRequest.tokenId, actor },
        'assertion verification failed'
      );

      res.status(verificationError.httpStatus).json({
        verified: false,
        error: verificationError.reason,
      });
    }
  })
);

const port = Number(process.env.PORT ?? 3005);
app.listen(port, () => {
  logger.info({ port }, 'fi-service listening');
});
