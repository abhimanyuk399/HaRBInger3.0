import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Redis from 'ioredis';
import {
  asyncHandler,
  computeUserRefHashFromIdentifier,
  createLogger,
  createOidcValidator,
  httpLogger,
  requireScopes,
  validateParams,
  validateQuery,
} from '@bharat/common';
import { checkDatabase, prisma } from '@bharat/db';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  applySimulatedProfileUpdate,
  buildDefaultCkycProfile,
  buildSupersededKycPayload,
  hasUnsyncedCkycChange,
  hasUnsyncedVersionChange,
  type CkycProfilePayload,
  type CkycProfileState,
} from './ckyc-domain.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(httpLogger('ckyc-adapter'));

const logger = createLogger('ckyc-adapter');
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const registryUrl = process.env.REGISTRY_URL ?? 'http://localhost:3002';
const issuerServiceUrl = process.env.ISSUER_SERVICE_URL ?? 'http://localhost:3001';
const keycloakIssuerUrl = process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/bharat-kyc-dev';
const keycloakJwksUrl = process.env.KEYCLOAK_JWKS_URL;
const keycloakJwksCacheTtlMs = Number(process.env.KEYCLOAK_JWKS_CACHE_TTL_MS ?? 600_000);

const validateAccessToken = createOidcValidator({
  issuerUrl: keycloakIssuerUrl,
  jwksUrl: keycloakJwksUrl,
  jwksCacheTtlMs: keycloakJwksCacheTtlMs,
});

const syncScopes = ['token.issue'];

const healthQuery = z.object({
  probe: z.enum(['liveness', 'readiness']).optional(),
});

const userParamsSchema = z.object({
  userId: z.string().min(3).max(256),
});

const ckycPayloadSchema = z
  .object({
    addressLine1: z.string().min(3).max(256),
    pincode: z.string().min(3).max(12),
  })
  .strict();

function getActor(req: express.Request): string {
  const payload = req.oidc?.payload;
  if (!payload) return 'system';
  if (typeof payload.azp === 'string') return payload.azp;
  if (typeof payload.client_id === 'string') return payload.client_id;
  if (typeof payload.sub === 'string') return payload.sub;
  return 'system';
}

function parseCkycPayload(value: unknown): CkycProfilePayload {
  return ckycPayloadSchema.parse(value);
}

async function ensureProfile(userId: string): Promise<
  CkycProfileState & { lastSyncedHash?: string | null; lastSyncedVersion?: number | null; lastSyncedTokenId?: string | null }
> {
  const existing = await prisma.ckycProfile.findUnique({ where: { userId } });
  if (existing) {
    return {
      userId: existing.userId,
      profileVersion: existing.profileVersion,
      lastUpdated: existing.lastUpdated,
      hash: existing.hash,
      payload: parseCkycPayload(existing.payload),
      lastSyncedHash: existing.lastSyncedHash,
      lastSyncedVersion: existing.lastSyncedVersion,
      lastSyncedTokenId: existing.lastSyncedTokenId,
    };
  }

  const created = buildDefaultCkycProfile(userId);
  const row = await prisma.ckycProfile.create({
    data: {
      userId,
      profileVersion: created.profileVersion,
      lastUpdated: created.lastUpdated,
      hash: created.hash,
      payload: created.payload as unknown as Prisma.InputJsonValue,
    },
  });

  await prisma.ckycAuditEvent.create({
    data: {
      userId,
      eventType: 'CKYC_PROFILE_CREATED',
      actor: 'system',
      detail: {
        profileVersion: row.profileVersion,
      },
    },
  });

  return {
    userId: row.userId,
    profileVersion: row.profileVersion,
    lastUpdated: row.lastUpdated,
    hash: row.hash,
    payload: parseCkycPayload(row.payload),
    lastSyncedHash: row.lastSyncedHash,
    lastSyncedVersion: row.lastSyncedVersion,
    lastSyncedTokenId: row.lastSyncedTokenId,
  };
}

async function addCkycAuditEvent(input: {
  userId: string;
  eventType: string;
  actor: string;
  detail?: Prisma.InputJsonValue;
}) {
  await prisma.ckycAuditEvent.create({
    data: {
      userId: input.userId,
      eventType: input.eventType,
      actor: input.actor,
      detail: input.detail ?? {},
    },
  });
}

async function fetchJsonOrThrow<T>(input: { url: string; method: 'GET' | 'POST'; authorization: string; body?: unknown }): Promise<T> {
  const response = await fetch(input.url, {
    method: input.method,
    headers: {
      authorization: input.authorization,
      ...(input.body ? { 'content-type': 'application/json' } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });

  const text = await response.text();
  const payload = text.trim().length > 0 ? (JSON.parse(text) as T) : ({} as T);

  if (!response.ok) {
    throw new Error(`downstream_error:${response.status}:${input.url}`);
  }
  return payload;
}

async function fetchJsonWithStatus<T>(input: {
  url: string;
  method: 'GET' | 'POST';
  authorization: string;
  body?: unknown;
}): Promise<{ status: number; ok: boolean; payload: T | Record<string, unknown> }> {
  const response = await fetch(input.url, {
    method: input.method,
    headers: {
      authorization: input.authorization,
      ...(input.body ? { 'content-type': 'application/json' } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });

  const text = await response.text();
  let payload: T | Record<string, unknown> = {};
  if (text.trim().length > 0) {
    try {
      payload = JSON.parse(text) as T;
    } catch {
      payload = { raw: text };
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    payload,
  };
}

interface RegistryTokenSnapshot {
  tokenId: string;
  status: string;
  supersededBy?: string | null;
}

async function fetchRegistryTokenSnapshot(tokenId: string, authorization: string) {
  return fetchJsonWithStatus<RegistryTokenSnapshot>({
    url: `${registryUrl.replace(/\/$/, '')}/v1/internal/registry/token/${encodeURIComponent(tokenId)}`,
    method: 'GET',
    authorization,
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
  '/v1/ckyc/profile/:userId',
  validateParams(userParamsSchema),
  asyncHandler(async (req, res) => {
    const profile = await ensureProfile(req.params.userId);
    res.json({
      userId: profile.userId,
      profileVersion: profile.profileVersion,
      lastUpdated: profile.lastUpdated,
      hash: profile.hash,
      payload: profile.payload,
    });
  })
);

app.post(
  '/v1/ckyc/simulate-update/:userId',
  validateParams(userParamsSchema),
  asyncHandler(async (req, res) => {
    const current = await ensureProfile(req.params.userId);
    const updated = applySimulatedProfileUpdate(current);

    await prisma.ckycProfile.update({
      where: { userId: req.params.userId },
      data: {
        profileVersion: updated.profileVersion,
        lastUpdated: updated.lastUpdated,
        hash: updated.hash,
        payload: updated.payload as unknown as Prisma.InputJsonValue,
      },
    });

    await addCkycAuditEvent({
      userId: req.params.userId,
      eventType: 'CKYC_PROFILE_UPDATED',
      actor: 'simulator',
      detail: {
        profileVersion: updated.profileVersion,
        hash: updated.hash,
      },
    });

    logger.info({ userId: req.params.userId, profileVersion: updated.profileVersion }, 'ckyc profile simulated update');

    res.json({
      userId: req.params.userId,
      profileVersion: updated.profileVersion,
      lastUpdated: updated.lastUpdated,
      hash: updated.hash,
      payload: updated.payload,
    });
  })
);

app.post(
  '/v1/ckyc/sync/:userId',
  validateAccessToken,
  requireScopes(syncScopes),
  validateParams(userParamsSchema),
  asyncHandler(async (req, res) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
      return res.status(401).json({ error: 'missing_bearer_token' });
    }

    const userId = req.params.userId;
    const actor = getActor(req);
    const profile = await ensureProfile(userId);
    const unsyncedHashChange = hasUnsyncedCkycChange(profile.lastSyncedHash, profile.hash);
    const unsyncedVersionChange = hasUnsyncedVersionChange(profile.lastSyncedVersion, profile.profileVersion);

    if (!unsyncedHashChange && !unsyncedVersionChange) {
      await addCkycAuditEvent({
        userId,
        eventType: 'CKYC_SYNC_SKIPPED',
        actor,
        detail: {
          reason: 'NO_CHANGE',
          profileVersion: profile.profileVersion,
          lastSyncedVersion: profile.lastSyncedVersion ?? null,
        },
      });
      return res.json({
        userId,
        changed: false,
        reason: 'NO_CHANGE',
        profileVersion: profile.profileVersion,
        hash: profile.hash,
      });
    }

    const userRefHash = computeUserRefHashFromIdentifier(userId);
    const activeTokenResponse = await fetchJsonWithStatus<{
      tokenId: string;
      status: string;
      version: number;
    }>({
      url: `${registryUrl.replace(/\/$/, '')}/v1/internal/registry/active-token?userRefHash=${encodeURIComponent(userRefHash)}`,
      method: 'GET',
      authorization,
    }).catch(async (error) => {
      await addCkycAuditEvent({
        userId,
        eventType: 'CKYC_SYNC_FAILED',
        actor,
        detail: {
          reason: 'ACTIVE_TOKEN_NOT_FOUND',
        },
      });
      throw error;
    });

    if (!activeTokenResponse.ok) {
      if (activeTokenResponse.status === 404) {
        await addCkycAuditEvent({
          userId,
          eventType: 'CKYC_SYNC_FAILED',
          actor,
          detail: {
            reason: 'ACTIVE_TOKEN_NOT_FOUND',
          },
        });
        return res.status(404).json({ error: 'active_token_not_found' });
      }

      await addCkycAuditEvent({
        userId,
        eventType: 'CKYC_SYNC_FAILED',
        actor,
        detail: {
          reason: 'REGISTRY_LOOKUP_FAILED',
          status: activeTokenResponse.status,
        },
      });
      return res.status(502).json({ error: 'registry_lookup_failed' });
    }

    const activeToken = activeTokenResponse.payload as {
      tokenId: string;
      status: string;
      version: number;
    };

    let payload: {
      tokenId: string;
      userRefHash: string;
      version: number;
      kyc: Record<string, unknown>;
    };
    try {
      payload = await fetchJsonOrThrow<{
        tokenId: string;
        userRefHash: string;
        version: number;
        kyc: Record<string, unknown>;
      }>({
        url: `${issuerServiceUrl.replace(/\/$/, '')}/v1/internal/issuer/token/${encodeURIComponent(activeToken.tokenId)}/payload`,
        method: 'GET',
        authorization,
      });
    } catch {
      await addCkycAuditEvent({
        userId,
        eventType: 'CKYC_SYNC_FAILED',
        actor,
        detail: {
          reason: 'ISSUER_PAYLOAD_FETCH_FAILED',
          tokenId: activeToken.tokenId,
        },
      });
      return res.status(502).json({ error: 'issuer_payload_fetch_failed' });
    }

    if (payload.userRefHash !== userRefHash) {
      return res.status(409).json({ error: 'issuer_payload_user_ref_mismatch' });
    }

    const supersededKyc = buildSupersededKycPayload(payload.kyc, profile.payload);
    let supersedeResponse: {
      oldTokenId: string;
      newTokenId: string;
      newStatus: string;
      issuedAt: string;
      expiresAt: string;
    };
    try {
      supersedeResponse = await fetchJsonOrThrow<{
        oldTokenId: string;
        oldStatus?: string;
        newTokenId: string;
        newStatus: string;
        issuedAt: string;
        expiresAt: string;
      }>({
        url: `${issuerServiceUrl.replace(/\/$/, '')}/v1/issuer/token/${encodeURIComponent(activeToken.tokenId)}/supersede`,
        method: 'POST',
        authorization,
        body: {
          kyc: supersededKyc,
          reason: `CKYC_PROFILE_VERSION_${profile.profileVersion}`,
        },
      });
    } catch {
      await addCkycAuditEvent({
        userId,
        eventType: 'CKYC_SYNC_FAILED',
        actor,
        detail: {
          reason: 'ISSUER_SUPERSEDE_FAILED',
          tokenId: activeToken.tokenId,
        },
      });
      return res.status(502).json({ error: 'issuer_supersede_failed' });
    }

    const [oldTokenRegistryState, newTokenRegistryState] = await Promise.all([
      fetchRegistryTokenSnapshot(supersedeResponse.oldTokenId, authorization),
      fetchRegistryTokenSnapshot(supersedeResponse.newTokenId, authorization),
    ]);

    if (!oldTokenRegistryState.ok || !newTokenRegistryState.ok) {
      await addCkycAuditEvent({
        userId,
        eventType: 'CKYC_SYNC_FAILED',
        actor,
        detail: {
          reason: 'REGISTRY_STATE_VERIFY_FAILED',
          oldTokenLookupStatus: oldTokenRegistryState.status,
          newTokenLookupStatus: newTokenRegistryState.status,
          oldTokenId: supersedeResponse.oldTokenId,
          newTokenId: supersedeResponse.newTokenId,
        },
      });
      return res.status(502).json({ error: 'registry_state_verify_failed' });
    }

    const oldTokenSnapshot = oldTokenRegistryState.payload as RegistryTokenSnapshot;
    const newTokenSnapshot = newTokenRegistryState.payload as RegistryTokenSnapshot;
    const isOldTokenSuperseded =
      oldTokenSnapshot.status === 'SUPERSEDED' && oldTokenSnapshot.supersededBy === supersedeResponse.newTokenId;
    const isNewTokenActive = newTokenSnapshot.status === 'ACTIVE';

    if (!isOldTokenSuperseded || !isNewTokenActive) {
      await addCkycAuditEvent({
        userId,
        eventType: 'CKYC_SYNC_FAILED',
        actor,
        detail: {
          reason: 'REGISTRY_STATUS_MISMATCH',
          expected: {
            oldTokenStatus: 'SUPERSEDED',
            newTokenStatus: 'ACTIVE',
            oldTokenSupersededBy: supersedeResponse.newTokenId,
          },
          observed: {
            oldTokenId: oldTokenSnapshot.tokenId,
            oldTokenStatus: oldTokenSnapshot.status,
            oldTokenSupersededBy: oldTokenSnapshot.supersededBy ?? null,
            newTokenId: newTokenSnapshot.tokenId,
            newTokenStatus: newTokenSnapshot.status,
          },
        } as Prisma.InputJsonValue,
      });
      return res.status(502).json({ error: 'registry_status_mismatch' });
    }

    await prisma.ckycProfile.update({
      where: { userId },
      data: {
        lastSyncedHash: profile.hash,
        lastSyncedVersion: profile.profileVersion,
        lastSyncedTokenId: supersedeResponse.newTokenId,
      },
    });

    await addCkycAuditEvent({
      userId,
      eventType: 'CKYC_SYNC_APPLIED',
      actor,
      detail: {
        oldTokenId: supersedeResponse.oldTokenId,
        newTokenId: supersedeResponse.newTokenId,
        oldTokenStatus: oldTokenSnapshot.status,
        newTokenStatus: newTokenSnapshot.status,
        profileVersion: profile.profileVersion,
      },
    });

    logger.info(
      { userId, oldTokenId: supersedeResponse.oldTokenId, newTokenId: supersedeResponse.newTokenId },
      'ckyc sync applied and token superseded'
    );

    res.json({
      userId,
      changed: true,
      profileVersion: profile.profileVersion,
      hash: profile.hash,
      oldTokenId: supersedeResponse.oldTokenId,
      oldStatus: oldTokenSnapshot.status,
      newTokenId: supersedeResponse.newTokenId,
      newStatus: newTokenSnapshot.status,
      issuedAt: supersedeResponse.issuedAt,
      expiresAt: supersedeResponse.expiresAt,
    });
  })
);

const port = Number(process.env.PORT ?? 3006);
app.listen(port, () => {
  logger.info({ port }, 'ckyc-adapter listening');
});
