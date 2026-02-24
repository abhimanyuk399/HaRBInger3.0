import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Redis from 'ioredis';
import {
  asyncHandler,
  computeUserRefHashFromIdentifier,
  createLogger,
  httpLogger,
  validateBody,
  validateQuery,
} from '@bharat/common';
import { checkDatabase, prisma } from '@bharat/db';
import type { ReviewCustomer } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  DEFAULT_REVIEW_INTERVAL_YEARS,
  computeNextReviewAt,
  decideReviewAction,
  getReviewIntervalYears,
  type ReviewAction,
  type ReviewRiskTier,
  type ReviewIntervalYearsConfig,
} from './review-domain.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(httpLogger('review-scheduler'));

const logger = createLogger('review-scheduler');
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const ckycAdapterUrl = process.env.CKYC_ADAPTER_URL ?? 'http://localhost:3006';
const registryServiceUrl = process.env.REGISTRY_SERVICE_URL ?? 'http://localhost:3002';
const consentManagerUrl = process.env.CONSENT_MANAGER_URL ?? 'http://localhost:3003';
const keycloakIssuerUrl = process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/bharat-kyc-dev';
const keycloakTokenUrl =
  process.env.KEYCLOAK_TOKEN_URL ?? `${keycloakIssuerUrl.replace(/\/$/, '')}/protocol/openid-connect/token`;
const reviewServiceClientId = process.env.REVIEW_SERVICE_CLIENT_ID ?? 'issuer-admin';
const reviewServiceClientSecret = (process.env.REVIEW_SERVICE_CLIENT_SECRET ?? '').trim();

if (!reviewServiceClientSecret) {
  throw new Error('[review-scheduler] Missing required secret: REVIEW_SERVICE_CLIENT_SECRET');
}

const healthQuery = z.object({
  probe: z.enum(['liveness', 'readiness']).optional(),
});

const upsertCustomerSchema = z
  .object({
    userId: z.string().min(3).max(256),
    riskTier: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    lastKycUpdateAt: z.string().datetime(),
  })
  .strict();

const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(value: string): boolean {
  if (!dateOnlyRegex.test(value)) {
    return false;
  }

  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const asOfDateSchema = z.string().regex(dateOnlyRegex).refine(isValidDateOnly, {
  message: 'asOf must be a valid calendar date in YYYY-MM-DD format',
});

const dueQuerySchema = z.object({
  asOf: asOfDateSchema.optional(),
});

const runOnceSchema = z
  .object({
    actor: z.string().min(2).max(128).optional(),
    asOf: asOfDateSchema.optional(),
  })
  .strict()
  .default({});

const simulateDemoSchema = z
  .object({
    actor: z.string().min(2).max(128).optional(),
  })
  .strict()
  .optional()
  .default({});

function parseTierYearsEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`[review-scheduler] Invalid ${name}: expected positive integer years`);
  }
  return parsed;
}

const reviewIntervalYearsConfig: ReviewIntervalYearsConfig = {
  HIGH: parseTierYearsEnv('REVIEW_PERIOD_HIGH_YEARS', DEFAULT_REVIEW_INTERVAL_YEARS.HIGH),
  MEDIUM: parseTierYearsEnv('REVIEW_PERIOD_MEDIUM_YEARS', DEFAULT_REVIEW_INTERVAL_YEARS.MEDIUM),
  LOW: parseTierYearsEnv('REVIEW_PERIOD_LOW_YEARS', DEFAULT_REVIEW_INTERVAL_YEARS.LOW),
};

function resolveAsOfInstant(asOfDate?: string): Date {
  if (!asOfDate) {
    return new Date();
  }
  const [yearRaw, monthRaw, dayRaw] = asOfDate.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const resolved = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  return resolved;
}

function asRiskTier(value: string): ReviewRiskTier {
  if (value === 'LOW' || value === 'MEDIUM' || value === 'HIGH') {
    return value;
  }
  return 'MEDIUM';
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
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

async function resetDemoData() {
  const ownerUserId = 'KYC-1234';
  const otherUserId = 'KYC-5678';
  const nomineeUserId = 'wallet-nominee-1';
  const fiDemoId = 'FI-DEMO-01';

  await prisma.$transaction([
    prisma.consentAuditEvent.deleteMany({ where: { consent: { fiId: fiDemoId } } }),
    prisma.consentRecord.deleteMany({ where: { fiId: fiDemoId } }),
    prisma.fiAuditEvent.deleteMany({ where: { fiRequest: { fiId: fiDemoId } } }),
    prisma.fiKycRequest.deleteMany({ where: { fiId: fiDemoId } }),
    prisma.delegation.deleteMany({ where: { OR: [{ ownerUserId }, { delegateUserId: nomineeUserId }] } }),
    prisma.nominee.deleteMany({ where: { OR: [{ ownerUserId }, { nomineeUserId }] } }),
    prisma.auditEvent.deleteMany({ where: { tokenId: { startsWith: 'demo-' } } }),
    prisma.registryRecord.deleteMany({ where: { tokenId: { startsWith: 'demo-' } } }),
    prisma.reviewAuditEvent.deleteMany({ where: { userId: { in: [ownerUserId, otherUserId] } } }),
    prisma.reviewCustomer.deleteMany({ where: { userId: { in: [ownerUserId, otherUserId] } } }),
    prisma.reviewJob.deleteMany({ where: { detail: { contains: 'DEMO_SIMULATE' } } }),
    prisma.reviewJob.deleteMany({ where: { detail: { contains: 'DEMO_RESET' } } }),
    prisma.reviewJob.deleteMany({ where: { detail: { contains: 'DEMO_SIMULATE_AND_RUN' } } }),
  ]);
}


async function seedDemoData(actor: string) {
  const ownerUserId = 'KYC-1234';
  const otherUserId = 'KYC-5678';
  const nomineeUserId = 'wallet-nominee-1';
  const fiDemoId = 'FI-DEMO-01';
  const issuerId = 'issuer-demo';

  const ownerRefHash = computeUserRefHashFromIdentifier(ownerUserId);
  const otherRefHash = computeUserRefHashFromIdentifier(otherUserId);
  const nomineeRefHash = computeUserRefHashFromIdentifier(nomineeUserId);

  const now = new Date();
  const issuedAt = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 5);
  const ownerExpirySoon = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 5);
  const otherExpiredAt = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 2);

  const ownerTokenId = `demo-${ownerUserId.toLowerCase()}-v1`;
  const otherTokenId = `demo-${otherUserId.toLowerCase()}-v1`;

  // Keep resets scoped to demo ids only.
  await resetDemoData();

  const nominee = await prisma.nominee.create({
    data: {
      ownerUserId,
      ownerRefHash,
      nomineeUserId,
      nomineeRefHash,
      status: 'ACTIVE',
    },
  });

  const delegation = await prisma.delegation.create({
    data: {
      ownerUserId,
      ownerRefHash,
      delegateUserId: nomineeUserId,
      delegateRefHash: nomineeRefHash,
      scope: 'CONSENT_APPROVAL',
      allowedPurposes: ['PERIODIC_KYC_UPDATE', 'ACCOUNT_OPENING'],
      allowedFields: ['fullName', 'dob', 'address', 'idNumber'],
      status: 'ACTIVE',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 365),
    },
  });

  await prisma.registryRecord.createMany({
    data: [
      {
        tokenId: ownerTokenId,
        issuerId,
        userRefHash: ownerRefHash,
        status: 'ACTIVE',
        version: 1,
        issuedAt,
        expiresAt: ownerExpirySoon,
      },
      {
        tokenId: otherTokenId,
        issuerId,
        userRefHash: otherRefHash,
        status: 'EXPIRED',
        version: 1,
        issuedAt,
        expiresAt: otherExpiredAt,
      },
    ],
  });

  await prisma.reviewCustomer.create({
    data: {
      userId: ownerUserId,
      userRefHash: ownerRefHash,
      riskTier: 'HIGH',
      lastKycUpdateAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 365 * 3),
      nextReviewAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 3),
      requiresReconsent: true,
      status: 'DUE',
    },
  });

  await addReviewAuditEvent({
    userId: ownerUserId,
    eventType: 'DEMO_SIMULATE',
    actor,
    detail: { delegationId: delegation.id, nomineeId: nominee.id },
  });

  const requestedFields = ['fullName', 'dob', 'address', 'idNumber'];
  const approvedFields: Prisma.InputJsonValue = { selected: ['fullName', 'dob'], notes: 'Selective disclosure (demo)' };

  const pendingSelf = await prisma.consentRecord.create({
    data: {
      userRefHash: ownerRefHash,
      fiId: fiDemoId,
      purpose: 'ACCOUNT_OPENING',
      requestedFields,
      tokenId: ownerTokenId,
      nonce: `nonce-${Math.random().toString(16).slice(2)}`,
      expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24),
      status: 'PENDING',
      requiresDelegation: false,
      allowReuseAcrossFIs: true,
    },
  });

  const pendingPeriodic = await prisma.consentRecord.create({
    data: {
      userRefHash: ownerRefHash,
      fiId: fiDemoId,
      purpose: 'PERIODIC_KYC_UPDATE',
      requestedFields,
      tokenId: ownerTokenId,
      nonce: `nonce-${Math.random().toString(16).slice(2)}`,
      expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7),
      status: 'PENDING',
      requiresDelegation: true,
      allowReuseAcrossFIs: false,
    },
  });

  const approvedDelegated = await prisma.consentRecord.create({
    data: {
      userRefHash: ownerRefHash,
      fiId: fiDemoId,
      purpose: 'ACCOUNT_OPENING',
      requestedFields,
      approvedFields,
      tokenId: ownerTokenId,
      nonce: `nonce-${Math.random().toString(16).slice(2)}`,
      expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30),
      status: 'APPROVED',
      actorType: 'DELEGATE',
      approvedBy: nomineeUserId,
      delegationId: delegation.id,
      requiresDelegation: true,
      allowReuseAcrossFIs: true,
    },
  });

  const revoked = await prisma.consentRecord.create({
    data: {
      userRefHash: ownerRefHash,
      fiId: fiDemoId,
      purpose: 'ACCOUNT_OPENING',
      requestedFields,
      tokenId: ownerTokenId,
      nonce: `nonce-${Math.random().toString(16).slice(2)}`,
      expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 10),
      status: 'REVOKED',
      actorType: 'OWNER',
      approvedBy: ownerUserId,
      requiresDelegation: false,
      allowReuseAcrossFIs: false,
    },
  });

  const expired = await prisma.consentRecord.create({
    data: {
      userRefHash: otherRefHash,
      fiId: fiDemoId,
      purpose: 'ACCOUNT_OPENING',
      requestedFields,
      tokenId: otherTokenId,
      nonce: `nonce-${Math.random().toString(16).slice(2)}`,
      expiresAt: new Date(now.getTime() - 1000 * 60 * 60 * 2),
      status: 'EXPIRED',
      requiresDelegation: false,
      allowReuseAcrossFIs: false,
    },
  });

  await prisma.consentAuditEvent.createMany({
    data: [
      { consentId: pendingSelf.id, eventType: 'CONSENT_CREATED', actor, detail: { mode: 'self' } },
      { consentId: pendingPeriodic.id, eventType: 'CONSENT_CREATED', actor, detail: { mode: 'delegated', delegationId: delegation.id } },
      { consentId: approvedDelegated.id, eventType: 'CONSENT_CREATED', actor, detail: { mode: 'delegated' } },
      { consentId: approvedDelegated.id, eventType: 'CONSENT_APPROVED', actor: nomineeUserId, detail: { approvedFields } },
      { consentId: revoked.id, eventType: 'CONSENT_REVOKED', actor: ownerUserId, detail: { reason: 'demo-revoke' } },
      { consentId: expired.id, eventType: 'CONSENT_EXPIRED', actor: 'system', detail: { reason: 'seeded_expired' } },
    ],
  });

  const runAt = new Date();
  await prisma.reviewJob.create({
    data: {
      status: 'lifecycle',
      detail: JSON.stringify({ marker: 'DEMO_SIMULATE', actor, runAt: runAt.toISOString() }),
      runAt,
    },
  });

  return {
    users: [ownerUserId, otherUserId, nomineeUserId],
    tokens: [ownerTokenId, otherTokenId],
    delegationId: delegation.id,
    nomineeId: nominee.id,
    consents: {
      pendingSelf: pendingSelf.id,
      pendingPeriodic: pendingPeriodic.id,
      approvedDelegated: approvedDelegated.id,
      revoked: revoked.id,
      expired: expired.id,
    },
  };
}

async function getServiceToken(scope = 'token.issue'): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: reviewServiceClientId,
    client_secret: reviewServiceClientSecret,
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
    throw new Error('service_token_missing_access_token');
  }
  return payload.access_token;
}

async function callCkycSync(userId: string, accessToken: string): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetch(`${ckycAdapterUrl.replace(/\/$/, '')}/v1/ckyc/sync/${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text.trim().length > 0) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = { raw: text };
    }
  }

  return {
    status: response.status,
    payload,
  };
}

async function callJsonPost(url: string, accessToken: string): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text.trim().length > 0) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = { raw: text };
    }
  }
  return { status: response.status, payload };
}

type ReviewOutcome = 'SYNCED' | 'NO_CHANGE' | 'RECONSENT_REQUIRED' | 'FAILED';

interface DueCustomerView {
  userId: string;
  riskTier: ReviewRiskTier;
  nextReviewAt: string;
  plannedAction: ReviewAction;
  reason: string;
  intervalYears: number;
}

interface ReviewActionTaken {
  userId: string;
  riskTier: ReviewRiskTier;
  plannedAction: ReviewAction;
  outcome: ReviewOutcome;
  reason: string;
}

function toDueCustomerView(customer: ReviewCustomer, asOfInstant: Date): DueCustomerView {
  const tier = asRiskTier(customer.riskTier);
  const intervalYears = getReviewIntervalYears(tier, reviewIntervalYearsConfig);
  const plannedAction = decideReviewAction(tier);
  return {
    userId: customer.userId,
    riskTier: tier,
    nextReviewAt: customer.nextReviewAt.toISOString(),
    plannedAction,
    reason: `nextReviewAt <= asOf (${asOfInstant.toISOString()}) under ${tier} periodicity ${intervalYears}y`,
    intervalYears,
  };
}

async function findDueCustomers(asOfInstant: Date): Promise<Array<{ customer: ReviewCustomer; due: DueCustomerView }>> {
  const dueCustomers = await prisma.reviewCustomer.findMany({
    where: {
      nextReviewAt: {
        lte: asOfInstant,
      },
    },
    orderBy: [{ nextReviewAt: 'asc' }],
    take: 200,
  });

  return dueCustomers.map((customer) => ({
    customer,
    due: toDueCustomerView(customer, asOfInstant),
  }));
}

async function processCustomer(
  customer: ReviewCustomer,
  actor: string,
  accessToken: string,
  processedAt: Date
): Promise<ReviewOutcome> {
  const tier = asRiskTier(customer.riskTier);
  const action = decideReviewAction(tier);
  const nextReviewAt = computeNextReviewAt(processedAt, tier, reviewIntervalYearsConfig);

  if (action === 'REQUEST_RECONSENT') {
    await prisma.reviewCustomer.update({
      where: { userId: customer.userId },
      data: {
        requiresReconsent: true,
        status: 'RECONSENT_REQUIRED',
        nextReviewAt,
      },
    });

    await addReviewAuditEvent({
      userId: customer.userId,
      eventType: 'RECONSENT_REQUESTED',
      actor,
      detail: {
        riskTier: tier,
      },
    });
    return 'RECONSENT_REQUIRED';
  }

  const syncResponse = await callCkycSync(customer.userId, accessToken);
  if (syncResponse.status >= 200 && syncResponse.status < 300) {
    const changed = syncResponse.payload.changed === true;
    const outcome: ReviewOutcome = changed ? 'SYNCED' : 'NO_CHANGE';
    await prisma.reviewCustomer.update({
      where: { userId: customer.userId },
      data: {
        requiresReconsent: false,
        status: outcome,
        lastKycUpdateAt: changed ? processedAt : customer.lastKycUpdateAt,
        nextReviewAt,
      },
    });

    await addReviewAuditEvent({
      userId: customer.userId,
      eventType: 'CKYC_SYNC_TRIGGERED',
      actor,
      detail: {
        changed,
        reason: syncResponse.payload.reason ?? null,
      },
    });

    return outcome;
  }

  await prisma.reviewCustomer.update({
    where: { userId: customer.userId },
    data: {
      requiresReconsent: true,
      status: 'RECONSENT_REQUIRED',
      nextReviewAt,
    },
  });

  await addReviewAuditEvent({
    userId: customer.userId,
    eventType: 'CKYC_SYNC_FAILED',
    actor,
    detail: {
      status: syncResponse.status,
      payload: syncResponse.payload as unknown as Prisma.InputJsonValue,
    } as Prisma.InputJsonValue,
  });

  return 'RECONSENT_REQUIRED';
}

async function runReviewCycle(actor: string, asOfDate?: string) {
  const runAt = new Date();
  const asOfInstant = resolveAsOfInstant(asOfDate);
  const dueEntries = await findDueCustomers(asOfInstant);
  const dueUsers = dueEntries.map((entry) => entry.due);

  if (dueEntries.length === 0) {
    const job = await prisma.reviewJob.create({
      data: {
        status: 'noop',
        detail: JSON.stringify({
          asOf: asOfInstant.toISOString(),
          totalDue: 0,
          message: 'No due customers',
        }),
        runAt,
      },
    });
    return {
      jobId: job.id,
      asOf: asOfInstant.toISOString(),
      periodicityYears: reviewIntervalYearsConfig,
      totalDue: 0,
      synced: 0,
      unchanged: 0,
      reconsent: 0,
      failed: 0,
      dueUsers,
      actionsTaken: [] as ReviewActionTaken[],
    };
  }

  let accessToken = '';
  try {
    accessToken = await getServiceToken('token.issue');
  } catch (error) {
    const job = await prisma.reviewJob.create({
      data: {
        status: 'failed',
        detail: `service_token_error:${error instanceof Error ? error.message : 'unknown'}`,
        runAt,
      },
    });
    return {
      jobId: job.id,
      asOf: asOfInstant.toISOString(),
      periodicityYears: reviewIntervalYearsConfig,
      totalDue: dueEntries.length,
      synced: 0,
      unchanged: 0,
      reconsent: 0,
      failed: dueEntries.length,
      dueUsers,
      actionsTaken: dueUsers.map((due) => ({
        userId: due.userId,
        riskTier: due.riskTier,
        plannedAction: due.plannedAction,
        outcome: 'FAILED' as ReviewOutcome,
        reason: 'Unable to fetch service token for CKYC sync workflow',
      })),
    };
  }

  const actionsTaken: ReviewActionTaken[] = [];
  let synced = 0;
  let unchanged = 0;
  let reconsent = 0;
  let failed = 0;

  for (const entry of dueEntries) {
    const customer = entry.customer;
    const due = entry.due;
    await addReviewAuditEvent({
      userId: customer.userId,
      eventType: 'REVIEW_DUE_DETECTED',
      actor,
      detail: {
        asOf: asOfInstant.toISOString(),
        nextReviewAt: customer.nextReviewAt.toISOString(),
        plannedAction: due.plannedAction,
        reason: due.reason,
      },
    });

    try {
      const outcome = await processCustomer(customer, actor, accessToken, runAt);
      actionsTaken.push({
        userId: customer.userId,
        riskTier: due.riskTier,
        plannedAction: due.plannedAction,
        outcome,
        reason: due.reason,
      });
      if (outcome === 'SYNCED') synced += 1;
      else if (outcome === 'NO_CHANGE') unchanged += 1;
      else if (outcome === 'RECONSENT_REQUIRED') reconsent += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      actionsTaken.push({
        userId: customer.userId,
        riskTier: due.riskTier,
        plannedAction: due.plannedAction,
        outcome: 'FAILED',
        reason: error instanceof Error ? error.message : 'unknown',
      });
      await addReviewAuditEvent({
        userId: customer.userId,
        eventType: 'REVIEW_PROCESS_FAILED',
        actor,
        detail: {
          error: error instanceof Error ? error.message : 'unknown',
        },
      });
    }
  }

  const finalStatus = failed > 0 ? 'partial' : 'completed';
  const job = await prisma.reviewJob.create({
    data: {
      status: finalStatus,
      detail: JSON.stringify({
        asOf: asOfInstant.toISOString(),
        totalDue: dueEntries.length,
        synced,
        unchanged,
        reconsent,
        failed,
      }),
      runAt,
    },
  });

  return {
    jobId: job.id,
    asOf: asOfInstant.toISOString(),
    periodicityYears: reviewIntervalYearsConfig,
    totalDue: dueEntries.length,
    synced,
    unchanged,
    reconsent,
    failed,
    dueUsers,
    actionsTaken,
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

app.post(
  '/v1/review/upsert-customer',
  validateBody(upsertCustomerSchema),
  asyncHandler(async (req, res) => {
    const lastKycUpdateAt = new Date(req.body.lastKycUpdateAt);
    if (Number.isNaN(lastKycUpdateAt.getTime())) {
      return res.status(400).json({ error: 'lastKycUpdateAt must be a valid datetime' });
    }

    const riskTier = req.body.riskTier;
    const nextReviewAt = computeNextReviewAt(lastKycUpdateAt, riskTier, reviewIntervalYearsConfig);
    const userRefHash = computeUserRefHashFromIdentifier(req.body.userId);

    const customer = await prisma.reviewCustomer.upsert({
      where: { userId: req.body.userId },
      create: {
        userId: req.body.userId,
        userRefHash,
        riskTier,
        lastKycUpdateAt,
        nextReviewAt,
        requiresReconsent: false,
        status: 'ACTIVE',
      },
      update: {
        userRefHash,
        riskTier,
        lastKycUpdateAt,
        nextReviewAt,
        status: 'ACTIVE',
      },
    });

    await addReviewAuditEvent({
      userId: customer.userId,
      eventType: 'CUSTOMER_UPSERTED',
      actor: 'api',
      detail: {
        riskTier: customer.riskTier,
        lastKycUpdateAt: customer.lastKycUpdateAt.toISOString(),
        nextReviewAt: customer.nextReviewAt.toISOString(),
      },
    });

    logger.info({ userId: customer.userId, riskTier: customer.riskTier }, 'review customer upserted');

    res.status(201).json({
      userId: customer.userId,
      riskTier: customer.riskTier,
      lastKycUpdateAt: customer.lastKycUpdateAt,
      nextReviewAt: customer.nextReviewAt,
      requiresReconsent: customer.requiresReconsent,
      status: customer.status,
    });
  })
);

app.get(
  '/v1/review/due',
  validateQuery(dueQuerySchema),
  asyncHandler(async (req, res) => {
    const asOfInstant = resolveAsOfInstant(asOptionalString(req.query.asOf));
    const dueEntries = await findDueCustomers(asOfInstant);
    res.json({
      asOf: asOfInstant.toISOString(),
      periodicityYears: reviewIntervalYearsConfig,
      totalDue: dueEntries.length,
      dueUsers: dueEntries.map((entry) => entry.due),
    });
  })
);

app.post(
  '/v1/review/run-once',
  validateBody(runOnceSchema),
  asyncHandler(async (req, res) => {
    const actor = req.body.actor ?? 'manual-run-once';
    const result = await runReviewCycle(actor, asOptionalString(req.body.asOf));
    res.json(result);
  })
);


async function runLifecycle(actor: string) {
  const runAt = new Date();

  let accessToken = '';
  try {
    accessToken = await getClientCredentialsAccessToken(actor);
  } catch (e) {
    logger.warn({ err: e }, 'failed to get access token for lifecycle run; continuing without auth header');
  }

  // 1) Expire due tokens in registry
  let registryResult: unknown = null;
  try {
    const resp = await fetch(`${registryServiceUrl}/v1/internal/registry/expire-due`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ actor }),
    });
    registryResult = await resp.json().catch(() => ({}));
  } catch (e) {
    registryResult = { error: 'registry expire-due failed', detail: String(e) };
  }

  // 2) Expire due consents in consent-manager
  let consentResult: unknown = null;
  try {
    const resp = await fetch(`${consentManagerUrl}/v1/internal/consents/expire-due`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ actor }),
    });
    consentResult = await resp.json().catch(() => ({}));
  } catch (e) {
    consentResult = { error: 'consent expire-due failed', detail: String(e) };
  }

  // Persist a small job record for Command dashboard
  const detail = JSON.stringify({ type: 'LIFECYCLE_RUN', actor, registryResult, consentResult, runAt: runAt.toISOString() });
  const job = await prisma.reviewJob.create({
    data: {
      runAt,
      detail,
    },
  });

  return { ok: true, id: job.id, runAt: runAt.toISOString(), registryResult, consentResult };
}

app.post(
  '/v1/lifecycle/run',
  validateBody(z.object({ actor: z.string().min(2).max(128).optional() }).strict().optional().default({})),
  asyncHandler(async (req, res) => {
    const actor = req.body.actor ?? 'lifecycle-run';
    const runAt = new Date();

    let accessToken = '';
    try {
      accessToken = await getServiceToken('token.revoke consent.approve');
    } catch (error) {
      return res.status(500).json({
        error: 'service_token_error',
        message: error instanceof Error ? error.message : 'unknown',
      });
    }

    const registry = await callJsonPost(`${registryServiceUrl.replace(/\/$/, '')}/v1/internal/registry/expire-due`, accessToken);
    const consents = await callJsonPost(`${consentManagerUrl.replace(/\/$/, '')}/v1/internal/consents/expire-due`, accessToken);

    await prisma.reviewJob.create({
      data: {
        status: 'lifecycle',
        detail: JSON.stringify({ actor, runAt: runAt.toISOString(), registry, consents }),
        runAt,
      },
    });

    res.json({ actor, runAt: runAt.toISOString(), registry, consents });
  })
);

app.get(
  '/v1/lifecycle/jobs',
  asyncHandler(async (_req, res) => {
    const jobs = await prisma.reviewJob.findMany({
      where: { status: 'lifecycle' },
      orderBy: { runAt: 'desc' },
      take: 10,
    });

    const parsed = jobs.map((job) => {
      let detail: unknown = job.detail;
      try {
        detail = job.detail ? JSON.parse(job.detail) : null;
      } catch {
        // ignore
      }
      return {
        id: job.id,
        runAt: job.runAt.toISOString(),
        detail,
      };
    });

    res.json({ total: parsed.length, jobs: parsed });
  })
);

app.post(
  '/v1/demo/simulate',
  validateBody(simulateDemoSchema),
  asyncHandler(async (req, res) => {
    const actor = (req.body && typeof req.body.actor === 'string' && req.body.actor.trim().length > 0
      ? req.body.actor
      : 'command-ui') as string;

    await checkDatabase(logger);
    const summary = await seedDemoData(actor);
    res.json({ ok: true, summary });
  })

app.post(
  '/v1/demo/reset',
  validateBody(resetDemoSchema),
  asyncHandler(async (req, res) => {
    const actor = (req.body && typeof req.body.actor === 'string' && req.body.actor.trim().length > 0
      ? req.body.actor
      : 'command-ui') as string;

    await checkDatabase(logger);
    await resetDemoData();

    const runAt = new Date();
    await prisma.reviewJob.create({
      data: {
        runAt,
        detail: JSON.stringify({ type: 'DEMO_RESET', actor, runAt: runAt.toISOString() }),
      },
    });

    res.json({ ok: true, message: 'demo data reset' });
  })
);

app.post(
  '/v1/demo/simulate-and-run',
  validateBody(simulateDemoAndRunSchema),
  asyncHandler(async (req, res) => {
    const actor = (req.body && typeof req.body.actor === 'string' && req.body.actor.trim().length > 0
      ? req.body.actor
      : 'command-ui') as string;

    await checkDatabase(logger);

    const summary = await seedDemoData(actor);
    const lifecycle = await runLifecycle(`${actor}-demo-sim-run`);

    const runAt = new Date();
    await prisma.reviewJob.create({
      data: {
        runAt,
        detail: JSON.stringify({
          type: 'DEMO_SIMULATE_AND_RUN',
          actor,
          runAt: runAt.toISOString(),
          summary,
          lifecycle,
        }),
      },
    });

    res.json({ ok: true, summary, lifecycle });
  })
);


);

const port = Number(process.env.PORT ?? 3007);

async function start() {
  if (process.env.RUN_ONCE === 'true') {
    const result = await runReviewCycle('cron-run-once');
    logger.info(result, 'review run-once finished');
    process.exit(0);
  }

  app.listen(port, () => {
    logger.info({ port }, 'review-scheduler listening');
  });
}

start();
