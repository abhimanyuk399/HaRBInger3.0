import { describe, expect, it } from 'vitest';
import {
  assertValidStatusTransition,
  computeAuditHash,
  verifyAuditHashChain,
  type AuditChainEntry,
} from './registry-domain.js';

describe('registry status transitions', () => {
  it('allows ACTIVE to REVOKED transition', () => {
    expect(() => assertValidStatusTransition('ACTIVE', 'REVOKED')).not.toThrow();
  });

  it('rejects REVOKED to ACTIVE transition', () => {
    expect(() => assertValidStatusTransition('REVOKED', 'ACTIVE')).toThrow('invalid_status_transition');
  });
});

describe('audit hash chain', () => {
  it('verifies a valid append-only chain', () => {
    const baseIssuedAt = new Date('2026-01-01T00:00:00.000Z');
    const baseExpiresAt = new Date('2026-12-31T00:00:00.000Z');

    const firstOccurredAt = new Date('2026-01-01T00:00:10.000Z');
    const firstHash = computeAuditHash({
      tokenId: 'tok-1',
      eventType: 'TOKEN_CREATED',
      status: 'ACTIVE',
      version: 1,
      issuedAt: baseIssuedAt,
      expiresAt: baseExpiresAt,
      supersededBy: null,
      actor: 'issuer-admin',
      detail: { op: 'create' },
      occurredAt: firstOccurredAt,
      hashPrev: null,
    });

    const secondOccurredAt = new Date('2026-01-01T00:05:00.000Z');
    const secondHash = computeAuditHash({
      tokenId: 'tok-1',
      eventType: 'TOKEN_STATUS_CHANGED',
      status: 'REVOKED',
      version: 2,
      issuedAt: baseIssuedAt,
      expiresAt: baseExpiresAt,
      supersededBy: null,
      actor: 'issuer-admin',
      detail: { fromStatus: 'ACTIVE', toStatus: 'REVOKED' },
      occurredAt: secondOccurredAt,
      hashPrev: firstHash,
    });

    const chain: AuditChainEntry[] = [
      {
        tokenId: 'tok-1',
        eventType: 'TOKEN_CREATED',
        status: 'ACTIVE',
        version: 1,
        issuedAt: baseIssuedAt,
        expiresAt: baseExpiresAt,
        supersededBy: null,
        actor: 'issuer-admin',
        detail: { op: 'create' },
        occurredAt: firstOccurredAt,
        hashPrev: null,
        hashCurr: firstHash,
      },
      {
        tokenId: 'tok-1',
        eventType: 'TOKEN_STATUS_CHANGED',
        status: 'REVOKED',
        version: 2,
        issuedAt: baseIssuedAt,
        expiresAt: baseExpiresAt,
        supersededBy: null,
        actor: 'issuer-admin',
        detail: { fromStatus: 'ACTIVE', toStatus: 'REVOKED' },
        occurredAt: secondOccurredAt,
        hashPrev: firstHash,
        hashCurr: secondHash,
      },
    ];

    expect(verifyAuditHashChain(chain)).toBe(true);
  });

  it('detects tampered chain events', () => {
    const event: AuditChainEntry = {
      tokenId: 'tok-2',
      eventType: 'TOKEN_CREATED',
      status: 'ACTIVE',
      version: 1,
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
      supersededBy: null,
      actor: 'issuer-admin',
      detail: { op: 'create' },
      occurredAt: new Date('2026-01-01T00:00:01.000Z'),
      hashPrev: null,
      hashCurr: '0000',
    };

    expect(verifyAuditHashChain([event])).toBe(false);
  });
});
