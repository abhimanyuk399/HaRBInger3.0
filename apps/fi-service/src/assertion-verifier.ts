import { errors, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { ReplayProtector } from '@bharat/common';

export type VerificationFailureReason =
  | 'invalid_signature'
  | 'aud_mismatch'
  | 'assertion_expired'
  | 'issuer_mismatch'
  | 'missing_claim'
  | 'purpose_mismatch'
  | 'scope_mismatch'
  | 'replay_detected'
  | 'token_not_active'
  | 'registry_lookup_failed';

export class AssertionVerificationError extends Error {
  constructor(
    message: string,
    public readonly reason: VerificationFailureReason,
    public readonly httpStatus: number
  ) {
    super(message);
    this.name = 'AssertionVerificationError';
  }
}

export interface VerifyAssertionInput {
  assertionJwt: string;
  jwkResolver: JWTVerifyGetKey;
  expectedIssuer: string;
  expectedAudience: string;
  expectedPurpose: string;
  expectedScope: string[];
  now?: Date;
  jtiReplayProtector: ReplayProtector;
  nonceReplayProtector: ReplayProtector;
  lookupRegistryStatus: (tokenId: string) => Promise<string | null>;
}

export interface VerifiedAssertion {
  tokenId: string;
  jti: string;
  nonce: string;
  purpose: string;
  scope: string[];
  disclosedClaims: Record<string, unknown>;
  exp: number;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function normalizeScope(scopeClaim: unknown): string[] {
  if (typeof scopeClaim === 'string') {
    return scopeClaim
      .split(' ')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (isStringArray(scopeClaim)) {
    return scopeClaim;
  }
  return [];
}

function sameScope(expectedScope: string[], actualScope: string[]): boolean {
  const expected = new Set(expectedScope);
  const actual = new Set(actualScope);
  if (expected.size !== actual.size) {
    return false;
  }
  for (const scope of expected) {
    if (!actual.has(scope)) {
      return false;
    }
  }
  return true;
}

function mapJoseError(error: unknown): AssertionVerificationError {
  if (error instanceof errors.JWTExpired) {
    return new AssertionVerificationError('assertion expired', 'assertion_expired', 401);
  }

  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === 'aud') {
      return new AssertionVerificationError('assertion audience mismatch', 'aud_mismatch', 403);
    }
    if (error.claim === 'iss') {
      return new AssertionVerificationError('assertion issuer mismatch', 'issuer_mismatch', 403);
    }
    return new AssertionVerificationError('assertion claim validation failed', 'invalid_signature', 401);
  }

  if (error instanceof errors.JWSSignatureVerificationFailed) {
    return new AssertionVerificationError('assertion signature verification failed', 'invalid_signature', 401);
  }

  return new AssertionVerificationError('assertion verification failed', 'invalid_signature', 401);
}

export async function verifyAssertion(input: VerifyAssertionInput): Promise<VerifiedAssertion> {
  let payload;
  try {
    const verification = await jwtVerify(input.assertionJwt, input.jwkResolver, {
      issuer: input.expectedIssuer,
      audience: input.expectedAudience,
      currentDate: input.now,
    });
    payload = verification.payload;
  } catch (error) {
    throw mapJoseError(error);
  }

  if (payload.purpose !== input.expectedPurpose) {
    throw new AssertionVerificationError('assertion purpose mismatch', 'purpose_mismatch', 403);
  }

  const scope = normalizeScope(payload.scope);
  if (!sameScope(input.expectedScope, scope)) {
    throw new AssertionVerificationError('assertion scope mismatch', 'scope_mismatch', 403);
  }

  const jti = payload.jti;
  const nonce = payload.nonce;
  const tokenId = payload.tokenId;
  const claims = payload.claims;
  const exp = payload.exp;

  if (typeof jti !== 'string' || typeof nonce !== 'string' || typeof tokenId !== 'string' || typeof exp !== 'number') {
    throw new AssertionVerificationError('assertion missing required claims', 'missing_claim', 400);
  }

  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new AssertionVerificationError('assertion claims payload is invalid', 'missing_claim', 400);
  }

  const nowEpoch = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const ttlSeconds = Math.max(exp - nowEpoch, 1);

  let registryStatus: string | null;
  try {
    registryStatus = await input.lookupRegistryStatus(tokenId);
  } catch {
    throw new AssertionVerificationError('registry lookup failed', 'registry_lookup_failed', 502);
  }

  if (registryStatus !== 'ACTIVE') {
    throw new AssertionVerificationError(
      `registry token is not ACTIVE: ${registryStatus ?? 'NOT_FOUND'}`,
      'token_not_active',
      403
    );
  }

  const acceptedJti = await input.jtiReplayProtector.consume(jti, ttlSeconds);
  if (!acceptedJti) {
    throw new AssertionVerificationError('assertion replay detected on jti', 'replay_detected', 409);
  }

  const acceptedNonce = await input.nonceReplayProtector.consume(nonce, ttlSeconds);
  if (!acceptedNonce) {
    throw new AssertionVerificationError('assertion replay detected on nonce', 'replay_detected', 409);
  }

  return {
    tokenId,
    jti,
    nonce,
    purpose: payload.purpose,
    scope,
    disclosedClaims: claims as Record<string, unknown>,
    exp,
  };
}
