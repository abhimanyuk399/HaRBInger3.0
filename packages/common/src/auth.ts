import { jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyOptions } from 'jose';
import type { RequestHandler } from 'express';
import { createRemoteJwksResolver, DEFAULT_JWKS_CACHE_TTL_MS } from './jwks-cache.js';

export interface OidcClaims {
  token: string;
  payload: JWTPayload;
  scopes: string[];
}

declare global {
  namespace Express {
    interface Request {
      oidc?: OidcClaims;
    }
  }
}

export interface OidcValidatorOptions {
  issuerUrl: string;
  jwksUrl?: string;
  audience?: string | string[];
  jwksCacheTtlMs?: number;
}

const ROLE_TO_SCOPE_FALLBACK: Record<string, string[]> = {
  wallet_user: ['consent.read', 'consent.approve', 'token.read'],
  wallet_nominee: ['consent.read', 'consent.approve', 'token.read'],
  fi_user: ['kyc.request', 'kyc.verify'],
  admin: ['token.issue', 'token.revoke'],
};

function extractRealmAndClientRoles(payload: JWTPayload): string[] {
  const roles = new Set<string>();

  const realmAccess = payload.realm_access;
  if (realmAccess && typeof realmAccess === 'object' && !Array.isArray(realmAccess)) {
    const realmRoles = (realmAccess as Record<string, unknown>).roles;
    if (Array.isArray(realmRoles)) {
      for (const role of realmRoles) {
        if (typeof role === 'string' && role.trim().length > 0) {
          roles.add(role.trim());
        }
      }
    }
  }

  const resourceAccess = payload.resource_access;
  if (resourceAccess && typeof resourceAccess === 'object' && !Array.isArray(resourceAccess)) {
    for (const entry of Object.values(resourceAccess as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const clientRoles = (entry as Record<string, unknown>).roles;
      if (!Array.isArray(clientRoles)) {
        continue;
      }
      for (const role of clientRoles) {
        if (typeof role === 'string' && role.trim().length > 0) {
          roles.add(role.trim());
        }
      }
    }
  }

  return [...roles];
}

export function extractScopes(payload: JWTPayload): string[] {
  const scopes = new Set<string>();

  if (typeof payload.scope === 'string') {
    for (const scope of payload.scope.split(' ')) {
      const normalized = scope.trim();
      if (normalized.length > 0) {
        scopes.add(normalized);
      }
    }
  }

  if (Array.isArray(payload.scp)) {
    for (const scope of payload.scp) {
      if (typeof scope === 'string' && scope.trim().length > 0) {
        scopes.add(scope.trim());
      }
    }
  }

  const roles = extractRealmAndClientRoles(payload);
  for (const role of roles) {
    scopes.add(role);
    const mapped = ROLE_TO_SCOPE_FALLBACK[role.toLowerCase()];
    if (!mapped) {
      continue;
    }
    for (const scope of mapped) {
      scopes.add(scope);
    }
  }

  return [...scopes];
}

function unauthorized(resBody = 'missing_bearer_token') {
  return {
    status: 401,
    body: {
      error: 'unauthorized',
      detail: resBody,
    },
  };
}

export function createOidcValidator(options: OidcValidatorOptions): RequestHandler {
  const issuerUrl = options.issuerUrl.replace(/\/$/, '');
  const jwksUrl = options.jwksUrl ?? `${issuerUrl}/protocol/openid-connect/certs`;
  const jwks = createRemoteJwksResolver({
    issuerUrl,
    jwksUrl,
    ttlMs: options.jwksCacheTtlMs ?? DEFAULT_JWKS_CACHE_TTL_MS,
  });

  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header) {
      const fail = unauthorized();
      return res.status(fail.status).json(fail.body);
    }

    const [scheme, token] = header.split(' ');
    if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
      const fail = unauthorized('invalid_authorization_header');
      return res.status(fail.status).json(fail.body);
    }

    try {
      const verifyOptions: JWTVerifyOptions = {
        issuer: issuerUrl,
      };
      if (options.audience) {
        verifyOptions.audience = options.audience;
      }

      const { payload } = await jwtVerify(token, jwks, verifyOptions);
      req.oidc = {
        token,
        payload,
        scopes: extractScopes(payload),
      };
      next();
    } catch {
      return res.status(401).json({
        error: 'unauthorized',
        detail: 'invalid_access_token',
      });
    }
  };
}

export function requireScopes(requiredScopes: string[]): RequestHandler {
  return (req, res, next) => {
    const claims = req.oidc;
    if (!claims) {
      return res.status(401).json({
        error: 'unauthorized',
        detail: 'missing_token_claims',
      });
    }

    const tokenScopes = new Set(claims.scopes);
    const missingScopes = requiredScopes.filter((scope) => !tokenScopes.has(scope));
    if (missingScopes.length > 0) {
      return res.status(403).json({
        error: 'forbidden',
        detail: 'missing_scope',
        missingScopes,
      });
    }

    next();
  };
}
