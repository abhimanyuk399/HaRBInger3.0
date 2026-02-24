import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Redis from 'ioredis';
import { z } from 'zod';
import {
  asyncHandler,
  createLogger,
  createOidcValidator,
  httpLogger,
  requireScopes,
  validateBody,
  validateParams,
  validateQuery,
} from '@bharat/common';
import { checkDatabase, prisma } from '@bharat/db';
import {
  assertValidStatusTransition,
  computeAuditHash,
  type RegistryStatus,
} from './registry-domain.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(httpLogger('registry-service'));

const logger = createLogger('registry-service');
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const keycloakIssuerUrl = process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/bharat-kyc-dev';
const keycloakJwksUrl = process.env.KEYCLOAK_JWKS_URL;
const keycloakJwksCacheTtlMs = Number(process.env.KEYCLOAK_JWKS_CACHE_TTL_MS ?? 600_000);

const validateAccessToken = createOidcValidator({
  issuerUrl: keycloakIssuerUrl,
  jwksUrl: keycloakJwksUrl,
  jwksCacheTtlMs: keycloakJwksCacheTtlMs,
});

const fiReadScopes = ['kyc.verify'];
const issuerWriteScopes = ['token.issue'];
const issuerStatusScopes = ['token.revoke'];

const healthQuery = z.object({
  probe: z.enum(['liveness', 'readiness']).optional(),
});

const tokenParams = z.object({
  tokenId: z.string().min(3).max(128),
});
const activeTokenQuery = z.object({
  userRefHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
});

const listTokensQuery = z.object({
  status: z.enum(['ACTIVE', 'REVOKED', 'SUPERSEDED', 'EXPIRED']).optional(),
  userRefHash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const createTokenSchema = z
  .object({
    tokenId: z.string().min(3).max(128),
    issuerId: z.string().min(2).max(128),
    userRefHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

const statusSchema = z
  .object({
    status: z.enum(['REVOKED', 'SUPERSEDED', 'EXPIRED']),
    supersededBy: z.string().min(3).max(128).optional(),
    reason: z.string().min(3).max(512).optional(),
  })
  .strict();

type RegistryDbClient = Pick<typeof prisma, 'auditEvent'>;

function getActor(req: express.Request): string {
  const payload = req.oidc?.payload;
  if (!payload) return 'unknown';
  if (typeof payload.azp === 'string') return payload.azp;
  if (typeof payload.client_id === 'string') return payload.client_id;
  if (typeof payload.sub === 'string') return payload.sub;
  return 'unknown';
}

async function appendAuditEvent(db: RegistryDbClient, input: {
  tokenId: string;
  eventType: string;
  status: RegistryStatus;
  version: number;
  issuedAt: Date;
  expiresAt: Date;
  supersededBy?: string | null;
  actor: string;
  detail?: Record<string, unknown>;
}) {
  const previousEvent = await db.auditEvent.findFirst({
    where: { tokenId: input.tokenId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const createdAt = new Date();
  const hashPrev = previousEvent?.hashCurr ?? null;
  const hashCurr = computeAuditHash({
    tokenId: input.tokenId,
    eventType: input.eventType,
    status: input.status,
    version: input.version,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    supersededBy: input.supersededBy,
    actor: input.actor,
    occurredAt: createdAt,
    hashPrev,
    detail: input.detail,
  });

  await db.auditEvent.create({
    data: {
      tokenId: input.tokenId,
      eventType: input.eventType,
      actor: input.actor,
      detail: {
        status: input.status,
        version: input.version,
        issuedAt: input.issuedAt.toISOString(),
        expiresAt: input.expiresAt.toISOString(),
        supersededBy: input.supersededBy ?? null,
        ...input.detail,
      },
      hashPrev,
      hashCurr,
      createdAt,
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
  '/v1/registry/token/:tokenId',
  validateAccessToken,
  requireScopes(fiReadScopes),
  validateParams(tokenParams),
  asyncHandler(async (req, res) => {
    const token = await prisma.registryRecord.findUnique({
      where: { tokenId: req.params.tokenId },
    });

    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    res.json({
      tokenId: token.tokenId,
      issuerId: token.issuerId,
      userRefHash: token.userRefHash,
      status: token.status,
      version: token.version,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
      supersededBy: token.supersededBy,
      updatedAt: token.updatedAt,
    });
  })
);

app.get(
  '/v1/registry/tokens',
  validateAccessToken,
  requireScopes(issuerWriteScopes),
  validateQuery(listTokensQuery),
  asyncHandler(async (req, res) => {
    const limit = typeof req.query.limit === 'number' ? req.query.limit : 200;
    const tokens = await prisma.registryRecord.findMany({
      where: {
        ...(req.query.status ? { status: req.query.status as string } : {}),
        ...(req.query.userRefHash ? { userRefHash: req.query.userRefHash as string } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: limit,
      select: {
        tokenId: true,
        issuerId: true,
        userRefHash: true,
        status: true,
        version: true,
        issuedAt: true,
        expiresAt: true,
        supersededBy: true,
        updatedAt: true,
      },
    });

    res.json({
      count: tokens.length,
      tokens,
    });
  })
);

app.get(
  '/v1/internal/registry/active-token',
  validateAccessToken,
  requireScopes(issuerWriteScopes),
  validateQuery(activeTokenQuery),
  asyncHandler(async (req, res) => {
    const userRefHash = req.query.userRefHash as string;
    const token = await prisma.registryRecord.findFirst({
      where: {
        userRefHash,
        status: 'ACTIVE',
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    if (!token) {
      return res.status(404).json({ error: 'Active token not found' });
    }

    res.json({
      tokenId: token.tokenId,
      issuerId: token.issuerId,
      status: token.status,
      version: token.version,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
      updatedAt: token.updatedAt,
    });
  })
);

app.get(
  '/v1/internal/registry/token/:tokenId',
  validateAccessToken,
  requireScopes(issuerWriteScopes),
  validateParams(tokenParams),
  asyncHandler(async (req, res) => {
    const token = await prisma.registryRecord.findUnique({
      where: { tokenId: req.params.tokenId },
      select: {
        tokenId: true,
        issuerId: true,
        userRefHash: true,
        status: true,
        version: true,
        issuedAt: true,
        expiresAt: true,
        supersededBy: true,
        updatedAt: true,
      },
    });

    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    res.json(token);
  })
);

app.get(
  '/v1/registry/audit/:tokenId',
  validateAccessToken,
  requireScopes(fiReadScopes),
  validateParams(tokenParams),
  asyncHandler(async (req, res) => {
    const events = await prisma.auditEvent.findMany({
      where: { tokenId: req.params.tokenId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        tokenId: true,
        eventType: true,
        actor: true,
        detail: true,
        hashPrev: true,
        hashCurr: true,
        createdAt: true,
      },
    });

    res.json({ tokenId: req.params.tokenId, events });
  })
);

app.post(
  '/v1/internal/registry/token',
  validateAccessToken,
  requireScopes(issuerWriteScopes),
  validateBody(createTokenSchema),
  asyncHandler(async (req, res) => {
    const issuedAt = new Date(req.body.issuedAt);
    const expiresAt = new Date(req.body.expiresAt);

    if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime())) {
      return res.status(400).json({ error: 'issuedAt and expiresAt must be valid datetime values' });
    }

    if (expiresAt <= issuedAt) {
      return res.status(400).json({ error: 'expiresAt must be greater than issuedAt' });
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const record = await tx.registryRecord.create({
          data: {
            tokenId: req.body.tokenId,
            issuerId: req.body.issuerId,
            userRefHash: req.body.userRefHash,
            status: 'ACTIVE',
            version: 1,
            issuedAt,
            expiresAt,
          },
        });

        await appendAuditEvent(tx, {
          tokenId: record.tokenId,
          eventType: 'TOKEN_CREATED',
          status: record.status as RegistryStatus,
          version: record.version,
          issuedAt: record.issuedAt,
          expiresAt: record.expiresAt,
          supersededBy: record.supersededBy,
          actor: getActor(req),
        });
        return record;
      });

      logger.info({ tokenId: created.tokenId, issuerId: created.issuerId }, 'registry token created');

      res.status(201).json({
        tokenId: created.tokenId,
        status: created.status,
        version: created.version,
        issuedAt: created.issuedAt,
        expiresAt: created.expiresAt,
      });
    } catch {
      return res.status(409).json({ error: 'tokenId already exists' });
    }
  })
);

app.post(
  '/v1/internal/registry/token/:tokenId/status',
  validateAccessToken,
  requireScopes(issuerStatusScopes),
  validateParams(tokenParams),
  validateBody(statusSchema),
  asyncHandler(async (req, res) => {
    const { tokenId } = req.params;
    const nextStatus = req.body.status as RegistryStatus;

    if (nextStatus === 'SUPERSEDED' && !req.body.supersededBy) {
      return res.status(400).json({ error: 'supersededBy is required for SUPERSEDED status' });
    }

    const token = await prisma.registryRecord.findUnique({ where: { tokenId } });
    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    try {
      assertValidStatusTransition(token.status as RegistryStatus, nextStatus);
    } catch {
      return res.status(409).json({
        error: 'invalid_status_transition',
        currentStatus: token.status,
        nextStatus,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.registryRecord.update({
        where: { tokenId },
        data: {
          status: nextStatus,
          supersededBy: nextStatus === 'SUPERSEDED' ? req.body.supersededBy ?? null : null,
          version: {
            increment: 1,
          },
        },
      });

      await appendAuditEvent(tx, {
        tokenId: record.tokenId,
        eventType: 'TOKEN_STATUS_CHANGED',
        status: record.status as RegistryStatus,
        version: record.version,
        issuedAt: record.issuedAt,
        expiresAt: record.expiresAt,
        supersededBy: record.supersededBy,
        actor: getActor(req),
        detail: {
          fromStatus: token.status,
          toStatus: record.status,
          reason: req.body.reason ?? null,
        },
      });
      return record;
    });

    logger.info({ tokenId: updated.tokenId, status: updated.status, version: updated.version }, 'registry token status updated');

    res.json({
      tokenId: updated.tokenId,
      status: updated.status,
      version: updated.version,
      supersededBy: updated.supersededBy,
      updatedAt: updated.updatedAt,
    });
  })
);

app.post(
  '/v1/internal/registry/expire-due',
  validateAccessToken,
  requireScopes(issuerStatusScopes),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const due = await prisma.registryRecord.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lte: now },
      },
      orderBy: [{ expiresAt: 'asc' }],
      take: 200,
    });

    let expired = 0;
    for (const token of due) {
      const updated = await prisma.$transaction(async (tx) => {
        const record = await tx.registryRecord.update({
          where: { tokenId: token.tokenId },
          data: {
            status: 'EXPIRED',
            supersededBy: null,
            version: { increment: 1 },
          },
        });

        await appendAuditEvent(tx, {
          tokenId: record.tokenId,
          eventType: 'TOKEN_STATUS_CHANGED',
          status: record.status as RegistryStatus,
          version: record.version,
          issuedAt: record.issuedAt,
          expiresAt: record.expiresAt,
          supersededBy: record.supersededBy,
          actor: getActor(req),
          detail: {
            fromStatus: token.status,
            toStatus: 'EXPIRED',
            reason: 'auto_expired',
          },
        });
        return record;
      });

      expired += 1;
      logger.info({ tokenId: updated.tokenId }, 'registry token auto-expired');
    }

    res.json({ now: now.toISOString(), checked: due.length, expired });
  })
);

const port = Number(process.env.PORT ?? 3002);
app.listen(port, () => {
  logger.info({ port }, 'registry-service listening');
});
