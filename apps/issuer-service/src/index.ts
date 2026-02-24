import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
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
import { checkDatabase, prisma, PrismaRevocationStore } from '@bharat/db';
import { z } from 'zod';
import {
  buildIssuerJwks,
  computeUserRefHash,
  decryptPayload,
  encryptPayload,
  loadVaultKeyFromEnv,
  signKycTokenJwt,
  type KycPayload,
} from './issuer-crypto.js';
import { RegistryClient } from './registry-client.js';
import { issuerServiceScopes } from './scopes.js';

export interface IssuerServiceConfig {
  port: number;
  redisUrl: string;
  registryUrl: string;
  keycloakIssuerUrl: string;
  keycloakJwksUrl?: string;
  keycloakJwksCacheTtlMs: number;
  keycloakTokenUrl?: string;
  issuerAdminClientId: string;
  issuerAdminClientSecret: string;
  privateKeyPem: string;
  jwtKid: string;
  issuerId: string;
  defaultTtlSeconds: number;
  vaultEncryptionKeyBase64?: string;
}

function normalizeMultilineSecret(value: string | undefined): string {
  return (value ?? '').replace(/\\n/g, '\n').trim();
}

function requireSecret(name: string, value: string | undefined) {
  if (!value || value.trim().length === 0) {
    throw new Error(`[issuer-service] Missing required secret: ${name}`);
  }
}

function resolveConfig(overrides: Partial<IssuerServiceConfig> = {}): IssuerServiceConfig {
  return {
    port: Number(process.env.PORT ?? 3001),
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    registryUrl: process.env.REGISTRY_URL ?? 'http://localhost:3002',
    keycloakIssuerUrl: process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/bharat-kyc-dev',
    keycloakJwksUrl: process.env.KEYCLOAK_JWKS_URL,
    keycloakJwksCacheTtlMs: Number(process.env.KEYCLOAK_JWKS_CACHE_TTL_MS ?? 600_000),
    keycloakTokenUrl: process.env.KEYCLOAK_TOKEN_URL,
    issuerAdminClientId: process.env.ISSUER_ADMIN_CLIENT_ID ?? 'issuer-admin',
    issuerAdminClientSecret: (process.env.ISSUER_ADMIN_CLIENT_SECRET ?? '').trim(),
    privateKeyPem: normalizeMultilineSecret(process.env.JWT_PRIVATE_KEY),
    jwtKid: process.env.JWT_KID ?? 'issuer-key',
    issuerId: process.env.ISSUER_ID ?? process.env.JWT_ISSUER ?? 'bharat-issuer',
    defaultTtlSeconds: Number(process.env.TOKEN_TTL_SECONDS ?? 900),
    vaultEncryptionKeyBase64: process.env.VAULT_ENCRYPTION_KEY_BASE64?.trim(),
    ...overrides,
  };
}

const healthQuery = z.object({
  probe: z.enum(['liveness', 'readiness']).optional(),
});

const tokenParamsSchema = z.object({
  tokenId: z.string().min(3).max(128),
});

const kycSchema = z
  .object({
    fullName: z.string().min(2).max(120),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    idNumber: z.string().min(4).max(64),
    email: z.string().email().optional(),
    phone: z.string().min(8).max(20).optional(),
    addressLine1: z.string().min(3).max(200).optional(),
    pincode: z.string().min(3).max(12).optional(),
  })
  .strict();

const issueSchema = z
  .object({
    kyc: kycSchema,
    ttlSeconds: z.number().int().min(300).max(86_400).optional(),
  })
  .strict();

const revokeSchema = z
  .object({
    reason: z.string().min(3).max(512).optional(),
  })
  .strict();

const supersedeSchema = z
  .object({
    kyc: kycSchema,
    ttlSeconds: z.number().int().min(300).max(86_400).optional(),
    reason: z.string().min(3).max(512).optional(),
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

export function createIssuerApp(overrides: Partial<IssuerServiceConfig> = {}) {
  const config = resolveConfig(overrides);
  const logger = createLogger('issuer-service');
  requireSecret('JWT_PRIVATE_KEY', config.privateKeyPem);
  requireSecret('VAULT_ENCRYPTION_KEY_BASE64', config.vaultEncryptionKeyBase64);
  requireSecret('ISSUER_ADMIN_CLIENT_SECRET', config.issuerAdminClientSecret);

  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

  const validateAccessToken = createOidcValidator({
    issuerUrl: config.keycloakIssuerUrl,
    jwksUrl: config.keycloakJwksUrl,
    jwksCacheTtlMs: config.keycloakJwksCacheTtlMs,
  });

  const revocationStore = new PrismaRevocationStore();
  const registryClient = new RegistryClient({
    registryUrl: config.registryUrl,
    keycloakIssuerUrl: config.keycloakIssuerUrl,
    keycloakTokenUrl: config.keycloakTokenUrl,
    clientId: config.issuerAdminClientId,
    clientSecret: config.issuerAdminClientSecret,
  });

  let cachedVaultKey: Buffer | null = null;
  const getVaultKey = () => {
    if (!cachedVaultKey) {
      cachedVaultKey = loadVaultKeyFromEnv(config.vaultEncryptionKeyBase64);
    }
    return cachedVaultKey;
  };

  async function createVaultAndRegistryToken(input: { kyc: KycPayload; ttlSeconds: number }) {
    if (!config.privateKeyPem) {
      throw new Error('JWT_PRIVATE_KEY not configured');
    }

    const tokenId = randomUUID();
    const version = 1;
    const vaultRef = randomUUID();
    const userRefHash = computeUserRefHash(input.kyc);
    const encrypted = encryptPayload(input.kyc, getVaultKey());

    const signed = await signKycTokenJwt({
      privateKeyPem: config.privateKeyPem,
      kid: config.jwtKid,
      issuerId: config.issuerId,
      tokenId,
      version,
      vaultRef,
      userRefHash,
      ttlSeconds: input.ttlSeconds,
    });

    await prisma.issuerVault.create({
      data: {
        id: vaultRef,
        tokenId,
        version,
        encryptedPayload: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        encryptionTag: encrypted.authTag,
        tokenJwt: signed.tokenJwt,
        userRefHash,
      },
    });

    try {
      await registryClient.createToken({
        tokenId,
        issuerId: config.issuerId,
        userRefHash,
        issuedAt: signed.issuedAt,
        expiresAt: signed.expiresAt,
      });
    } catch (error) {
      await prisma.issuerVault.delete({ where: { id: vaultRef } }).catch(() => undefined);
      throw error;
    }

    logger.info({ tokenId, version, issuerId: config.issuerId }, 'kyc token issued');

    return {
      tokenId,
      version,
      tokenJwt: signed.tokenJwt,
      vaultRef,
      userRefHash,
      issuedAt: signed.issuedAt,
      expiresAt: signed.expiresAt,
    };
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(httpLogger('issuer-service'));

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
    '/.well-known/jwks.json',
    asyncHandler(async (_req, res) => {
      if (!config.privateKeyPem) {
        return res.status(500).json({ error: 'JWT_PRIVATE_KEY not configured' });
      }
      const jwks = await buildIssuerJwks(config.privateKeyPem, config.jwtKid);
      res.json(jwks);
    })
  );

  app.get(
    '/v1/internal/issuer/token/:tokenId/payload',
    validateAccessToken,
    requireScopes([...issuerServiceScopes.issue]),
    validateParams(tokenParamsSchema),
    asyncHandler(async (req, res) => {
      const row = await prisma.issuerVault.findFirst({
        where: { tokenId: req.params.tokenId },
        orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
      });
      if (!row) {
        return res.status(404).json({ error: 'Token not found' });
      }

      const decrypted = decryptPayload(
        {
          ciphertext: row.encryptedPayload,
          iv: row.encryptionIv,
          authTag: row.encryptionTag,
        },
        getVaultKey()
      );

      res.json({
        tokenId: row.tokenId,
        version: row.version,
        userRefHash: row.userRefHash,
        kyc: decrypted,
      });
    })
  );

  app.post(
    '/v1/issuer/kyc/issue',
    validateAccessToken,
    requireScopes([...issuerServiceScopes.issue]),
    validateBody(issueSchema),
    asyncHandler(async (req, res) => {
      const issued = await createVaultAndRegistryToken({
        kyc: req.body.kyc,
        ttlSeconds: req.body.ttlSeconds ?? config.defaultTtlSeconds,
      });

      res.status(201).json({
        tokenId: issued.tokenId,
        version: issued.version,
        tokenJwt: issued.tokenJwt,
        vaultRef: issued.vaultRef,
        issuerId: config.issuerId,
        issuedAt: issued.issuedAt,
        expiresAt: issued.expiresAt,
      });
    })
  );

  app.post(
    '/v1/issuer/token/:tokenId/revoke',
    validateAccessToken,
    requireScopes([...issuerServiceScopes.revoke]),
    validateParams(tokenParamsSchema),
    validateBody(revokeSchema),
    asyncHandler(async (req, res) => {
      const tokenId = req.params.tokenId;
      const reason = req.body.reason;

      const existingVaultRow = await prisma.issuerVault.findFirst({ where: { tokenId } });
      if (!existingVaultRow) {
        return res.status(404).json({ error: 'Token not found' });
      }

      await registryClient.updateTokenStatus(tokenId, {
        status: 'REVOKED',
        reason,
      });
      await revocationStore.revoke(tokenId, reason);

      logger.info({ tokenId, actor: getActor(req) }, 'kyc token revoked');

      res.json({ tokenId, status: 'REVOKED' });
    })
  );

  app.post(
    '/v1/issuer/token/:tokenId/supersede',
    validateAccessToken,
    requireScopes([...issuerServiceScopes.issue]),
    validateParams(tokenParamsSchema),
    validateBody(supersedeSchema),
    asyncHandler(async (req, res) => {
      const oldTokenId = req.params.tokenId;
      const reason = req.body.reason;

      const existingVaultRow = await prisma.issuerVault.findFirst({ where: { tokenId: oldTokenId } });
      if (!existingVaultRow) {
        return res.status(404).json({ error: 'Token not found' });
      }

      const nextToken = await createVaultAndRegistryToken({
        kyc: req.body.kyc,
        ttlSeconds: req.body.ttlSeconds ?? config.defaultTtlSeconds,
      });

      try {
        await registryClient.updateTokenStatus(oldTokenId, {
          status: 'SUPERSEDED',
          supersededBy: nextToken.tokenId,
          reason,
        });
      } catch (error) {
        await registryClient
          .updateTokenStatus(nextToken.tokenId, {
            status: 'REVOKED',
            reason: 'supersede_rollback',
          })
          .catch(() => undefined);
        throw error;
      }

      logger.info(
        { oldTokenId, newTokenId: nextToken.tokenId, actor: getActor(req) },
        'kyc token superseded'
      );

      res.status(201).json({
        oldTokenId,
        oldStatus: 'SUPERSEDED',
        newTokenId: nextToken.tokenId,
        newStatus: 'ACTIVE',
        version: nextToken.version,
        tokenJwt: nextToken.tokenJwt,
        vaultRef: nextToken.vaultRef,
        issuedAt: nextToken.issuedAt,
        expiresAt: nextToken.expiresAt,
      });
    })
  );

  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const app = createIssuerApp();
  const config = resolveConfig();
  const logger = createLogger('issuer-service');
  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'issuer-service listening');
  });
}
