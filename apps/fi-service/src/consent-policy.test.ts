import { describe, expect, it } from 'vitest';
import { evaluateConsentStatusForVerification } from './consent-policy.js';

describe('evaluateConsentStatusForVerification', () => {
  it('allows verification when consent is APPROVED', () => {
    expect(
      evaluateConsentStatusForVerification({
        status: 'APPROVED',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    ).toBeNull();
  });

  it('blocks verification with consent_rejected when consent is REJECTED', () => {
    expect(
      evaluateConsentStatusForVerification({
        status: 'REJECTED',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    ).toEqual({
      error: 'consent_rejected',
      httpStatus: 409,
      message: 'Consent was rejected by wallet user/delegate. Assertion verification is blocked.',
    });
  });

  it('blocks verification with consent_not_approved for non-approved states', () => {
    expect(
      evaluateConsentStatusForVerification({
        status: 'PENDING',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    ).toEqual({
      error: 'consent_not_approved',
      httpStatus: 409,
      message: 'Consent status must be APPROVED before verification. Current status: PENDING.',
    });
  });

  it('blocks verification with consent_expired when ttl elapsed', () => {
    expect(
      evaluateConsentStatusForVerification({
        status: 'APPROVED',
        expiresAt: '2020-01-01T00:00:00.000Z',
        now: new Date('2020-01-01T00:00:01.000Z'),
      })
    ).toEqual({
      error: 'consent_expired',
      httpStatus: 409,
      message: 'Consent TTL has elapsed. Renew consent before FI verification.',
    });
  });
});
