import { describe, expect, it } from 'vitest';
import { createJwksFromPrivateKey, issueJwt, verifyJwt } from '../src/jwt.js';
import { InMemoryReplayProtector } from '../src/replay.js';
import { exportPKCS8, generateKeyPair } from 'jose';

async function makeKeyPair() {
  const { privateKey } = await generateKeyPair('ES256');
  const privateKeyPem = await exportPKCS8(privateKey);
  return { privateKeyPem };
}

class InMemoryRevocationStore {
  constructor(private readonly revoked = new Set<string>()) {}
  async isRevoked(jti: string) {
    return this.revoked.has(jti);
  }
}

describe('JWT verification', () => {
  it('verifies against JWKS', async () => {
    const { privateKeyPem } = await makeKeyPair();
    const token = await issueJwt({
      privateKeyPem,
      issuer: 'issuer',
      audience: 'audience',
      subject: 'subject',
      purpose: 'KYC',
      ttlSeconds: 60,
    });
    const jwks = await createJwksFromPrivateKey(privateKeyPem);

    const { payload } = await verifyJwt({
      token,
      jwks,
      issuer: 'issuer',
      audience: 'audience',
    });

    expect(payload.sub).toBe('subject');
  });

  it('rejects revoked tokens', async () => {
    const { privateKeyPem } = await makeKeyPair();
    const token = await issueJwt({
      privateKeyPem,
      issuer: 'issuer',
      audience: 'audience',
      subject: 'subject',
      purpose: 'KYC',
      ttlSeconds: 60,
      jti: 'revoked-token',
    });
    const jwks = await createJwksFromPrivateKey(privateKeyPem);
    const revocationStore = new InMemoryRevocationStore(new Set(['revoked-token']));

    await expect(
      verifyJwt({
        token,
        jwks,
        issuer: 'issuer',
        audience: 'audience',
        revocationStore,
      })
    ).rejects.toThrow('token_revoked');
  });

  it('enforces audience and purpose binding', async () => {
    const { privateKeyPem } = await makeKeyPair();
    const token = await issueJwt({
      privateKeyPem,
      issuer: 'issuer',
      audience: 'audience',
      subject: 'subject',
      purpose: 'KYC',
      ttlSeconds: 60,
    });
    const jwks = await createJwksFromPrivateKey(privateKeyPem);

    await expect(
      verifyJwt({
        token,
        jwks,
        issuer: 'issuer',
        audience: 'wrong-aud',
      })
    ).rejects.toThrow();

    await expect(
      verifyJwt({
        token,
        jwks,
        issuer: 'issuer',
        audience: 'audience',
        purpose: 'ACCOUNT_OPEN',
      })
    ).rejects.toThrow('purpose_mismatch');
  });

  it('blocks replayed tokens', async () => {
    const { privateKeyPem } = await makeKeyPair();
    const token = await issueJwt({
      privateKeyPem,
      issuer: 'issuer',
      audience: 'audience',
      subject: 'subject',
      purpose: 'KYC',
      ttlSeconds: 60,
      jti: 'replay-jti',
    });
    const jwks = await createJwksFromPrivateKey(privateKeyPem);
    const replay = new InMemoryReplayProtector();

    await verifyJwt({
      token,
      jwks,
      issuer: 'issuer',
      audience: 'audience',
      replayProtector: replay,
    });

    await expect(
      verifyJwt({
        token,
        jwks,
        issuer: 'issuer',
        audience: 'audience',
        replayProtector: replay,
      })
    ).rejects.toThrow('replay_detected');
  });
});
