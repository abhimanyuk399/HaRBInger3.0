import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function hashUser(userId) {
  return crypto.createHash('sha256').update(String(userId)).digest('hex');
}

function nowPlusDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function upsertRegistry(userId, status, daysToExpire = 30, version = 1) {
  const userRefHash = hashUser(userId);
  const tokenId = `tok_${userId}_${status.toLowerCase()}_${Date.now()}`;
  const issuedAt = new Date();
  const expiresAt = nowPlusDays(daysToExpire);

  if (status === 'NONE') {
    return { userId, status: 'NONE' };
  }

  const record = await prisma.registryRecord.create({
    data: {
      userRefHash,
      tokenId,
      status,
      version,
      issuedAt,
      expiresAt,
      payload: {
        fullName: userId === 'KYC-1234' ? 'Ananya Rao' : `KYC User ${userId}`,
        dob: '1990-01-01',
        idNumber: userId,
        email: `${userId.toLowerCase()}@example.local`,
        phone: '+919000000000',
        addressLine1: 'Demo Street 1',
        pincode: '700001',
      },
    },
  });

  await prisma.registryAuditEvent.create({
    data: {
      tokenId: record.tokenId,
      eventType: 'TOKEN_STATUS_CHANGED',
      actor: 'demo-simulator',
      detail: { status },
      createdAt: new Date(),
    },
  });

  return record;
}

async function createNomineeAndDelegation(ownerUserId, nomineeUserId) {
  const ownerRefHash = hashUser(ownerUserId);
  const nomineeRefHash = hashUser(nomineeUserId);

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
      delegatorUserId: ownerUserId,
      delegatorRefHash: ownerRefHash,
      delegateUserId: nomineeUserId,
      delegateRefHash: nomineeRefHash,
      status: 'ACTIVE',
      scope: ['CONSENT_APPROVAL'],
      allowedPurposes: ['ACCOUNT_OPENING', 'PERIODIC_KYC_UPDATE'],
      allowedFields: ['fullName', 'dob', 'idNumber', 'phone', 'addressLine1', 'pincode'],
      expiresAt: nowPlusDays(120),
    },
  });

  return { nominee, delegation };
}

async function createConsent({
  userId,
  fiId,
  purpose,
  status,
  tokenId,
  expiresInDays,
  requiresDelegation,
  approvedBy,
  actorType,
  delegationId,
  requestedFields,
  approvedFields,
}) {
  const userRefHash = hashUser(userId);

  const consent = await prisma.consentRecord.create({
    data: {
      userRefHash,
      fiId,
      purpose,
      requestedFields,
      approvedFields: approvedFields ?? null,
      requiresDelegation: Boolean(requiresDelegation),
      allowReuseAcrossFIs: false,
      tokenId,
      nonce: crypto.randomBytes(10).toString('hex'),
      expiresAt: nowPlusDays(expiresInDays),
      status,
      approvedBy: approvedBy ?? null,
      actorType: actorType ?? null,
      delegationId: delegationId ?? null,
      assertionJti: status === 'APPROVED' ? crypto.randomUUID() : null,
      assertionJwt: status === 'APPROVED' ? 'demo.jwt.payload' : null,
    },
  });

  await prisma.consentAuditEvent.create({
    data: {
      consentId: consent.id,
      eventType: `CONSENT_${status}`,
      actor: 'demo-simulator',
      detail: { userId, fiId, purpose, status, requestedFields, approvedFields },
    },
  });

  return consent;
}

async function ensurePeriodicReview(userId) {
  await prisma.reviewCustomer.upsert({
    where: { userId },
    create: {
      userId,
      userRefHash: hashUser(userId),
      riskTier: 'MEDIUM',
      lastKycUpdateAt: nowPlusDays(-800),
      nextReviewAt: nowPlusDays(-1),
      requiresReconsent: true,
      status: 'ACTIVE',
    },
    update: {
      nextReviewAt: nowPlusDays(-1),
      requiresReconsent: true,
    },
  });
}

async function createLifecycleJob() {
  await prisma.reviewJob.create({
    data: {
      status: 'lifecycle',
      runAt: new Date(),
      detail: JSON.stringify({ actor: 'demo-simulator', registry: { changed: 1 }, consents: { expired: 1 } }),
    },
  });
}

async function main() {
  // Clean only demo-linked tables (safe reset for repeated demos)
  await prisma.consentAuditEvent.deleteMany({});
  await prisma.consentRecord.deleteMany({});
  await prisma.delegation.deleteMany({});
  await prisma.nominee.deleteMany({});
  await prisma.reviewJob.deleteMany({});
  await prisma.reviewCustomer.deleteMany({});
  await prisma.registryAuditEvent.deleteMany({});
  await prisma.registryRecord.deleteMany({});

  const owner = 'KYC-1234';
  const secondary = 'KYC-5678';
  const nomineeUser = 'wallet-nominee-1';

  const ownerToken = await upsertRegistry(owner, 'ACTIVE', 5, 2);
  await upsertRegistry(secondary, 'EXPIRED', -1, 1);

  const { delegation } = await createNomineeAndDelegation(owner, nomineeUser);

  await ensurePeriodicReview(owner);
  await createLifecycleJob();

  await createConsent({
    userId: owner,
    fiId: 'fi-client',
    purpose: 'ACCOUNT_OPENING',
    status: 'PENDING',
    tokenId: ownerToken.tokenId,
    expiresInDays: 3,
    requiresDelegation: false,
    requestedFields: ['fullName', 'dob', 'idNumber', 'phone', 'addressLine1', 'pincode'],
  });

  await createConsent({
    userId: owner,
    fiId: 'fi-client',
    purpose: 'PERIODIC_KYC_UPDATE',
    status: 'PENDING',
    tokenId: ownerToken.tokenId,
    expiresInDays: 7,
    requiresDelegation: true,
    requestedFields: ['fullName', 'dob', 'idNumber', 'addressLine1', 'pincode'],
  });

  await createConsent({
    userId: owner,
    fiId: 'fi-client',
    purpose: 'ACCOUNT_OPENING',
    status: 'APPROVED',
    tokenId: ownerToken.tokenId,
    expiresInDays: 30,
    requiresDelegation: true,
    approvedBy: nomineeUser,
    actorType: 'DELEGATE',
    delegationId: delegation.id,
    requestedFields: ['fullName', 'dob', 'idNumber', 'phone', 'addressLine1', 'pincode'],
    approvedFields: ['fullName', 'dob', 'idNumber'],
  });

  await createConsent({
    userId: owner,
    fiId: 'fi-client',
    purpose: 'ACCOUNT_OPENING',
    status: 'REVOKED',
    tokenId: ownerToken.tokenId,
    expiresInDays: 30,
    requiresDelegation: false,
    approvedBy: owner,
    actorType: 'OWNER',
    requestedFields: ['fullName', 'dob', 'idNumber'],
  });

  await createConsent({
    userId: owner,
    fiId: 'fi-client',
    purpose: 'ACCOUNT_OPENING',
    status: 'EXPIRED',
    tokenId: ownerToken.tokenId,
    expiresInDays: -2,
    requiresDelegation: false,
    requestedFields: ['fullName', 'dob', 'idNumber'],
  });

  console.log('✅ Demo simulation seeded. Open Wallet/FI/Command homes to see populated dashboards.');
}

main()
  .catch((err) => {
    console.error('Simulation failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
