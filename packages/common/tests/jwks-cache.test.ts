import { createServer } from 'http';
import { once } from 'events';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportPKCS8, generateKeyPair } from 'jose';
import { clearRemoteJwksCache } from '../src/jwks-cache.js';
import { createJwksFromPrivateKey, issueJwt, verifyJwt } from '../src/jwt.js';

type JwksServerState = {
  currentBody: string;
  requests: number;
};

async function createTestKey(kid: string) {
  const { privateKey } = await generateKeyPair('ES256');
  const privateKeyPem = await exportPKCS8(privateKey);
  const jwks = await createJwksFromPrivateKey(privateKeyPem, kid);
  return {
    privateKeyPem,
    jwksBody: JSON.stringify(jwks),
  };
}

async function startJwksServer(state: JwksServerState) {
  const server = createServer((req, res) => {
    if (req.url !== '/jwks') {
      res.statusCode = 404;
      res.end();
      return;
    }

    state.requests += 1;
    res.setHeader('content-type', 'application/json');
    res.end(state.currentBody);
  });

  server.listen(0);
  await once(server, 'listening');

  const port = (server.address() as AddressInfo).port;
  return {
    server,
    jwksUrl: `http://127.0.0.1:${port}/jwks`,
  };
}

describe('remote JWKS cache', () => {
  let server: ReturnType<typeof createServer> | null = null;

  beforeEach(() => {
    clearRemoteJwksCache();
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      server = null;
    }
    clearRemoteJwksCache();
  });

  it('caches remote JWKS for repeated verifications within TTL', async () => {
    const issuer = 'https://issuer-cache.example.local';
    const audience = 'fi-client';
    const key = await createTestKey('kid-cache');
    const state: JwksServerState = {
      currentBody: key.jwksBody,
      requests: 0,
    };

    const started = await startJwksServer(state);
    server = started.server;

    const token = await issueJwt({
      privateKeyPem: key.privateKeyPem,
      issuer,
      audience,
      subject: 'wallet-owner-1',
      purpose: 'loan-underwriting',
      ttlSeconds: 120,
      kid: 'kid-cache',
    });

    await verifyJwt({
      token,
      issuer,
      audience,
      jwksUrl: started.jwksUrl,
      jwksCacheTtlMs: 600_000,
    });

    await verifyJwt({
      token,
      issuer,
      audience,
      jwksUrl: started.jwksUrl,
      jwksCacheTtlMs: 600_000,
    });

    expect(state.requests).toBe(1);
  });

  it('refreshes JWKS once when token kid is missing from cache', async () => {
    const issuer = 'https://issuer-rotation.example.local';
    const audience = 'fi-client';
    const oldKey = await createTestKey('kid-old');
    const newKey = await createTestKey('kid-new');

    const state: JwksServerState = {
      currentBody: oldKey.jwksBody,
      requests: 0,
    };

    const started = await startJwksServer(state);
    server = started.server;

    const oldToken = await issueJwt({
      privateKeyPem: oldKey.privateKeyPem,
      issuer,
      audience,
      subject: 'wallet-owner-1',
      purpose: 'loan-underwriting',
      ttlSeconds: 120,
      kid: 'kid-old',
    });

    await verifyJwt({
      token: oldToken,
      issuer,
      audience,
      jwksUrl: started.jwksUrl,
      jwksCacheTtlMs: 600_000,
    });

    state.currentBody = newKey.jwksBody;

    const newToken = await issueJwt({
      privateKeyPem: newKey.privateKeyPem,
      issuer,
      audience,
      subject: 'wallet-owner-1',
      purpose: 'loan-underwriting',
      ttlSeconds: 120,
      kid: 'kid-new',
    });

    const verified = await verifyJwt({
      token: newToken,
      issuer,
      audience,
      jwksUrl: started.jwksUrl,
      jwksCacheTtlMs: 600_000,
    });

    expect(verified.payload.sub).toBe('wallet-owner-1');
    expect(state.requests).toBe(2);
  });
});
