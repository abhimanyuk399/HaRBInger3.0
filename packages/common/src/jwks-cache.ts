import { createLocalJWKSet, errors } from 'jose';
import type { JSONWebKeySet, JWTVerifyGetKey } from 'jose';

export const DEFAULT_JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

interface CachedResolverEntry {
  jwksUrl: string;
  expiresAt: number;
  resolver?: JWTVerifyGetKey;
  pending?: Promise<JWTVerifyGetKey>;
}

const jwksResolverCache = new Map<string, CachedResolverEntry>();

function normalizeIssuerUrl(issuerUrl: string): string {
  return issuerUrl.replace(/\/$/, '');
}

function resolveTtlMs(ttlMs: number | undefined): number {
  if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    return DEFAULT_JWKS_CACHE_TTL_MS;
  }
  return Math.floor(ttlMs);
}

function assertJwksPayload(payload: unknown): JSONWebKeySet {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { keys?: unknown }).keys)) {
    throw new Error('jwks_invalid_response');
  }
  return payload as JSONWebKeySet;
}

async function fetchJwks(jwksUrl: string): Promise<JSONWebKeySet> {
  const response = await fetch(jwksUrl, {
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`jwks_fetch_failed:${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  return assertJwksPayload(payload);
}

async function loadResolver(options: {
  cacheKey: string;
  jwksUrl: string;
  ttlMs: number;
  forceRefresh: boolean;
}): Promise<JWTVerifyGetKey> {
  const now = Date.now();
  const existing = jwksResolverCache.get(options.cacheKey);

  if (existing && existing.jwksUrl !== options.jwksUrl) {
    jwksResolverCache.delete(options.cacheKey);
  }

  const current = jwksResolverCache.get(options.cacheKey);

  if (!options.forceRefresh && current?.resolver && current.expiresAt > now) {
    return current.resolver;
  }

  if (current?.pending) {
    return current.pending;
  }

  const pending = (async () => {
    const jwks = await fetchJwks(options.jwksUrl);
    return createLocalJWKSet(jwks);
  })();

  jwksResolverCache.set(options.cacheKey, {
    jwksUrl: options.jwksUrl,
    expiresAt: current?.expiresAt ?? 0,
    resolver: current?.resolver,
    pending,
  });

  try {
    const resolver = await pending;
    jwksResolverCache.set(options.cacheKey, {
      jwksUrl: options.jwksUrl,
      expiresAt: Date.now() + options.ttlMs,
      resolver,
    });
    return resolver;
  } catch (error) {
    if (!options.forceRefresh && current?.resolver && current.expiresAt > now) {
      jwksResolverCache.set(options.cacheKey, current);
      return current.resolver;
    }
    jwksResolverCache.delete(options.cacheKey);
    throw error;
  }
}

export interface RemoteJwksResolverOptions {
  issuerUrl: string;
  jwksUrl?: string;
  ttlMs?: number;
}

export function createRemoteJwksResolver(options: RemoteJwksResolverOptions): JWTVerifyGetKey {
  const issuerUrl = normalizeIssuerUrl(options.issuerUrl);
  const jwksUrl = options.jwksUrl ?? `${issuerUrl}/protocol/openid-connect/certs`;
  const ttlMs = resolveTtlMs(options.ttlMs);

  return async (protectedHeader, token) => {
    const resolver = await loadResolver({
      cacheKey: issuerUrl,
      jwksUrl,
      ttlMs,
      forceRefresh: false,
    });

    try {
      return await resolver(protectedHeader, token);
    } catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey)) {
        throw error;
      }

      const refreshedResolver = await loadResolver({
        cacheKey: issuerUrl,
        jwksUrl,
        ttlMs,
        forceRefresh: true,
      });

      return refreshedResolver(protectedHeader, token);
    }
  };
}

export function clearRemoteJwksCache() {
  jwksResolverCache.clear();
}
