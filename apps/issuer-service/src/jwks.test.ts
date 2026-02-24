import { once } from 'events';
import type { AddressInfo } from 'net';
import { describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportPKCS8, generateKeyPair, jwtVerify, type JSONWebKeySet } from 'jose';
import { createIssuerApp } from './index.js';
import { signKycTokenJwt } from './issuer-crypto.js';

async function startServer(privateKeyPem: string, kid: string) {
  const app = createIssuerApp({
    privateKeyPem,
    jwtKid: kid,
    issuerId: 'issuer-test',
    issuerAdminClientSecret: 'not-used-in-jwks-tests',
    vaultEncryptionKeyBase64: Buffer.alloc(32, 7).toString('base64'),
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

describe('issuer JWKS and signature verification', () => {
  it('serves JWKS with expected kid', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const privateKeyPem = await exportPKCS8(privateKey);
    const kid = 'issuer-kid-test';

    const { server, baseUrl } = await startServer(privateKeyPem, kid);
    try {
      const response = await fetch(`${baseUrl}/.well-known/jwks.json`);
      expect(response.status).toBe(200);

      const jwks = (await response.json()) as JSONWebKeySet;
      expect(jwks.keys).toHaveLength(1);
      expect(jwks.keys[0]?.kid).toBe(kid);
      expect(jwks.keys[0]?.alg).toBe('ES256');
    } finally {
      server.close();
    }
  });

  it('verifies signed token using JWKS endpoint key', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const privateKeyPem = await exportPKCS8(privateKey);
    const kid = 'issuer-kid-verify';

    const { server, baseUrl } = await startServer(privateKeyPem, kid);
    try {
      const signed = await signKycTokenJwt({
        privateKeyPem,
        kid,
        issuerId: 'issuer-test',
        tokenId: 'token-123',
        version: 2,
        vaultRef: 'vault-abc',
        userRefHash: '2f5bcaf07d34b6a16f30573f48f8bd3f74803f5c145076002f8220f66fba9135',
        ttlSeconds: 600,
      });

      const jwksResponse = await fetch(`${baseUrl}/.well-known/jwks.json`);
      const jwks = (await jwksResponse.json()) as JSONWebKeySet;
      const keySet = createLocalJWKSet(jwks);

      const verified = await jwtVerify(signed.tokenJwt, keySet, {
        issuer: 'issuer-test',
      });

      expect(verified.protectedHeader.kid).toBe(kid);
      expect(verified.payload.tokenId).toBe('token-123');
      expect(verified.payload.version).toBe(2);
      expect(verified.payload.vaultRef).toBe('vault-abc');
      expect(typeof verified.payload.iat).toBe('number');
      expect(typeof verified.payload.exp).toBe('number');
    } finally {
      server.close();
    }
  });
});
