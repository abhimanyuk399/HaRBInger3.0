import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { InMemoryReplayProtector } from '@bharat/common';
import { AssertionVerificationError, verifyAssertion } from './assertion-verifier.js';

let signingKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let jwkResolver: JWTVerifyGetKey;

async function mintAssertionJwt(input: {
  aud: string;
  jti: string;
  nonce: string;
  expEpoch: number;
  tokenId?: string;
  purpose?: string;
  scope?: string[];
}) {
  if (!signingKey) {
    throw new Error('signing key not initialized');
  }

  return new SignJWT({
    purpose: input.purpose ?? 'loan-underwriting',
    nonce: input.nonce,
    tokenId: input.tokenId ?? 'token-123',
    scope: input.scope ?? ['fullName'],
    claims: {
      fullName: 'Ananya Rao',
    },
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'consent-key' })
    .setIssuer('bharat-consent-manager')
    .setAudience(input.aud)
    .setJti(input.jti)
    .setIssuedAt(input.expEpoch - 120)
    .setExpirationTime(input.expEpoch)
    .sign(signingKey);
}

describe('fi assertion verification rules', () => {
  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    signingKey = privateKey;

    const publicJwk = await exportJWK(publicKey);
    publicJwk.use = 'sig';
    publicJwk.alg = 'ES256';
    publicJwk.kid = 'consent-key';
    jwkResolver = createLocalJWKSet({ keys: [publicJwk] });
  });

  it('fails when registry marks token as revoked, even with valid signature', async () => {
    const exp = Math.floor(Date.now() / 1000) + 180;
    const assertionJwt = await mintAssertionJwt({
      aud: 'fi-acme',
      jti: 'jti-revoked-1',
      nonce: 'nonce-revoked-1',
      expEpoch: exp,
    });

    await expect(
      verifyAssertion({
        assertionJwt,
        jwkResolver,
        expectedIssuer: 'bharat-consent-manager',
        expectedAudience: 'fi-acme',
        expectedPurpose: 'loan-underwriting',
        expectedScope: ['fullName'],
        jtiReplayProtector: new InMemoryReplayProtector(),
        nonceReplayProtector: new InMemoryReplayProtector(),
        lookupRegistryStatus: async () => 'REVOKED',
      })
    ).rejects.toMatchObject({
      reason: 'token_not_active',
    } satisfies Partial<AssertionVerificationError>);
  });

  it('fails when assertion audience does not match fiId', async () => {
    const exp = Math.floor(Date.now() / 1000) + 180;
    const assertionJwt = await mintAssertionJwt({
      aud: 'fi-other',
      jti: 'jti-aud-1',
      nonce: 'nonce-aud-1',
      expEpoch: exp,
    });

    await expect(
      verifyAssertion({
        assertionJwt,
        jwkResolver,
        expectedIssuer: 'bharat-consent-manager',
        expectedAudience: 'fi-acme',
        expectedPurpose: 'loan-underwriting',
        expectedScope: ['fullName'],
        jtiReplayProtector: new InMemoryReplayProtector(),
        nonceReplayProtector: new InMemoryReplayProtector(),
        lookupRegistryStatus: async () => 'ACTIVE',
      })
    ).rejects.toMatchObject({
      reason: 'aud_mismatch',
    } satisfies Partial<AssertionVerificationError>);
  });

  it('fails when assertion is expired', async () => {
    const exp = Math.floor(Date.now() / 1000) - 30;
    const assertionJwt = await mintAssertionJwt({
      aud: 'fi-acme',
      jti: 'jti-expired-1',
      nonce: 'nonce-expired-1',
      expEpoch: exp,
    });

    await expect(
      verifyAssertion({
        assertionJwt,
        jwkResolver,
        expectedIssuer: 'bharat-consent-manager',
        expectedAudience: 'fi-acme',
        expectedPurpose: 'loan-underwriting',
        expectedScope: ['fullName'],
        jtiReplayProtector: new InMemoryReplayProtector(),
        nonceReplayProtector: new InMemoryReplayProtector(),
        lookupRegistryStatus: async () => 'ACTIVE',
      })
    ).rejects.toMatchObject({
      reason: 'assertion_expired',
    } satisfies Partial<AssertionVerificationError>);
  });

  it('fails when assertion purpose does not match consent purpose', async () => {
    const exp = Math.floor(Date.now() / 1000) + 180;
    const assertionJwt = await mintAssertionJwt({
      aud: 'fi-acme',
      jti: 'jti-purpose-1',
      nonce: 'nonce-purpose-1',
      expEpoch: exp,
      purpose: 'account-opening',
    });

    await expect(
      verifyAssertion({
        assertionJwt,
        jwkResolver,
        expectedIssuer: 'bharat-consent-manager',
        expectedAudience: 'fi-acme',
        expectedPurpose: 'loan-underwriting',
        expectedScope: ['fullName'],
        jtiReplayProtector: new InMemoryReplayProtector(),
        nonceReplayProtector: new InMemoryReplayProtector(),
        lookupRegistryStatus: async () => 'ACTIVE',
      })
    ).rejects.toMatchObject({
      reason: 'purpose_mismatch',
    } satisfies Partial<AssertionVerificationError>);
  });

  it('fails when assertion scope does not match consent requestedFields', async () => {
    const exp = Math.floor(Date.now() / 1000) + 180;
    const assertionJwt = await mintAssertionJwt({
      aud: 'fi-acme',
      jti: 'jti-scope-1',
      nonce: 'nonce-scope-1',
      expEpoch: exp,
      scope: ['fullName', 'dob'],
    });

    await expect(
      verifyAssertion({
        assertionJwt,
        jwkResolver,
        expectedIssuer: 'bharat-consent-manager',
        expectedAudience: 'fi-acme',
        expectedPurpose: 'loan-underwriting',
        expectedScope: ['fullName'],
        jtiReplayProtector: new InMemoryReplayProtector(),
        nonceReplayProtector: new InMemoryReplayProtector(),
        lookupRegistryStatus: async () => 'ACTIVE',
      })
    ).rejects.toMatchObject({
      reason: 'scope_mismatch',
    } satisfies Partial<AssertionVerificationError>);
  });
});
