import { SignJWT, createLocalJWKSet, exportJWK, importPKCS8, jwtVerify } from 'jose';
import type { JWTPayload, JWSHeaderParameters, KeyLike, JWTVerifyOptions, JSONWebKeySet } from 'jose';
import { randomUUID } from 'crypto';
import type { ReplayProtector } from './replay.js';
import { createRemoteJwksResolver, DEFAULT_JWKS_CACHE_TTL_MS } from './jwks-cache.js';

export interface RevocationStore {
  isRevoked(jti: string): Promise<boolean>;
}

export interface IssueJwtParams {
  privateKeyPem: string;
  issuer: string;
  audience: string | string[];
  subject: string;
  purpose: string;
  ttlSeconds: number;
  jti?: string;
  additionalClaims?: Record<string, unknown>;
  kid?: string;
}

export async function issueJwt(params: IssueJwtParams): Promise<string> {
  const {
    privateKeyPem,
    issuer,
    audience,
    subject,
    purpose,
    ttlSeconds,
    jti = randomUUID(),
    additionalClaims = {},
    kid,
  } = params;

  const privateKey: KeyLike = await importPKCS8(privateKeyPem, 'ES256');

  return new SignJWT({
    purpose,
    ...additionalClaims,
  })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setJti(jti)
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(privateKey);
}

export async function createJwksFromPrivateKey(privateKeyPem: string, kid?: string): Promise<JSONWebKeySet> {
  const privateKey: KeyLike = await importPKCS8(privateKeyPem, 'ES256');
  const jwk = await exportJWK(privateKey);
  delete (jwk as { d?: string }).d;
  jwk.use = 'sig';
  jwk.alg = 'ES256';
  if (kid) jwk.kid = kid;
  return { keys: [jwk] };
}

export interface VerifyJwtParams {
  token: string;
  audience: string | string[];
  issuer: string;
  purpose?: string;
  jwks?: JSONWebKeySet;
  jwksUrl?: string;
  revocationStore?: RevocationStore;
  replayProtector?: ReplayProtector;
  verifyOptions?: JWTVerifyOptions;
  jwksCacheTtlMs?: number;
}

export async function verifyJwt(params: VerifyJwtParams): Promise<{ payload: JWTPayload; protectedHeader: JWSHeaderParameters }> {
  const {
    token,
    audience,
    issuer,
    purpose,
    jwks,
    jwksUrl,
    revocationStore,
    replayProtector,
    verifyOptions,
    jwksCacheTtlMs,
  } = params;

  const jwkProvider = jwksUrl
    ? createRemoteJwksResolver({
        issuerUrl: issuer,
        jwksUrl,
        ttlMs: jwksCacheTtlMs ?? DEFAULT_JWKS_CACHE_TTL_MS,
      })
    : createLocalJWKSet(jwks ?? { keys: [] });

  const { payload, protectedHeader } = await jwtVerify(token, jwkProvider, {
    issuer,
    audience,
    ...verifyOptions,
  });

  if (purpose && payload.purpose !== purpose) {
    throw new Error('purpose_mismatch');
  }

  const jti = payload.jti;
  if (!jti) {
    throw new Error('missing_jti');
  }

  if (revocationStore && (await revocationStore.isRevoked(jti))) {
    throw new Error('token_revoked');
  }

  if (replayProtector) {
    const exp = payload.exp ?? Math.floor(Date.now() / 1000) + 300;
    const ttlSeconds = Math.max(exp - Math.floor(Date.now() / 1000), 60);
    const accepted = await replayProtector.consume(jti, ttlSeconds);
    if (!accepted) {
      throw new Error('replay_detected');
    }
  }

  return { payload, protectedHeader };
}
