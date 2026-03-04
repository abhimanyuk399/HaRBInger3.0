import { describe, expect, it } from 'vitest';
import { InMemoryReplayProtector } from '@bharat/common';
import { evaluateDelegationConstraints, reserveReplayGuards, resolveConsentActionActor, selectiveDisclosure } from './consent-domain.js';

describe('selective disclosure', () => {
  it('returns only requested fields', () => {
    const fullPayload = {
      fullName: 'Ananya Rao',
      dob: '1995-01-12',
      idNumber: 'KYC-1234',
      email: 'ananya@example.com',
      phone: '+9100000000',
    };

    const disclosed = selectiveDisclosure(fullPayload, ['dob', 'email']);

    expect(disclosed).toEqual({
      dob: '1995-01-12',
      email: 'ananya@example.com',
    });
  });
});

describe('replay protection', () => {
  it('rejects second use of same jti/nonce', async () => {
    const jtiProtector = new InMemoryReplayProtector();
    const nonceProtector = new InMemoryReplayProtector();

    await reserveReplayGuards({
      jti: 'assertion-jti-1',
      nonce: 'nonce-1',
      ttlSeconds: 180,
      jtiProtector,
      nonceProtector,
    });

    await expect(
      reserveReplayGuards({
        jti: 'assertion-jti-1',
        nonce: 'nonce-1',
        ttlSeconds: 180,
        jtiProtector,
        nonceProtector,
      })
    ).rejects.toThrow('replay_detected');
  });
});

describe('delegation authorization', () => {
  it('allows owner without delegation lookup', async () => {
    const result = await resolveConsentActionActor({
      ownerRefHash: 'wallet-owner-hash',
      actorUserId: 'wallet-owner',
      hashUserId: (userId) => `${userId}-hash`,
      findActiveDelegation: async () => ({ id: 'should-not-be-used' }),
    });

    expect(result).toEqual({
      allowed: true,
      actorType: 'OWNER',
    });
  });

  it('rejects delegate without active delegation', async () => {
    const result = await resolveConsentActionActor({
      ownerRefHash: 'owner-hash',
      actorUserId: 'wallet-user',
      hashUserId: (userId) => `${userId}-hash`,
      findActiveDelegation: async () => null,
    });

    expect(result).toEqual({ allowed: false });
  });

  it('allows delegate with active delegation', async () => {
    const result = await resolveConsentActionActor({
      ownerRefHash: 'owner-hash',
      actorUserId: 'wallet-user',
      hashUserId: (userId) => `${userId}-hash`,
      findActiveDelegation: async () => ({ id: 'delegation-1' }),
    });

    expect(result).toEqual({
      allowed: true,
      actorType: 'DELEGATE',
      delegationId: 'delegation-1',
    });
  });
});

describe('delegation constraint enforcement', () => {
  it('allows approval when purpose and fields are inside constraints', () => {
    const result = evaluateDelegationConstraints({
      purpose: 'loan-underwriting',
      requestedFields: ['fullName', 'idNumber'],
      allowedPurposes: ['loan-underwriting', 'insurance-claim'],
      allowedFields: ['fullName', 'idNumber', 'dob'],
    });

    expect(result).toEqual({
      allowed: true,
      normalizedAllowedPurposes: ['loan-underwriting', 'insurance-claim'],
      normalizedAllowedFields: ['fullName', 'idNumber', 'dob'],
    });
  });

  it('rejects approval when purpose is outside delegation constraints', () => {
    const result = evaluateDelegationConstraints({
      purpose: 'investment-onboarding',
      requestedFields: ['fullName'],
      allowedPurposes: ['loan-underwriting'],
      allowedFields: ['fullName', 'idNumber'],
    });

    expect(result).toEqual({
      allowed: false,
      errorCode: 'delegation_constraint_violation',
      message: 'Delegation constraints do not allow this purpose.',
      details: {
        purpose: 'investment-onboarding',
        requestedFields: ['fullName'],
        allowedPurposes: ['loan-underwriting'],
        allowedFields: ['fullName', 'idNumber'],
        violations: ['purpose_not_allowed'],
        disallowedFields: [],
      },
    });
  });

  it('rejects approval when requested fields exceed delegation constraints', () => {
    const result = evaluateDelegationConstraints({
      purpose: 'loan-underwriting',
      requestedFields: ['fullName', 'phone', 'email'],
      allowedPurposes: ['loan-underwriting'],
      allowedFields: ['fullName', 'idNumber'],
    });

    expect(result).toEqual({
      allowed: false,
      errorCode: 'delegation_constraint_violation',
      message: 'Delegation constraints do not allow one or more requested fields.',
      details: {
        purpose: 'loan-underwriting',
        requestedFields: ['fullName', 'phone', 'email'],
        allowedPurposes: ['loan-underwriting'],
        allowedFields: ['fullName', 'idNumber'],
        violations: ['fields_not_allowed'],
        disallowedFields: ['phone', 'email'],
      },
    });
  });
});
