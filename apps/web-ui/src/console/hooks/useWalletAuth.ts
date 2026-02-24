import { useEffect, useState } from 'react';
import { keycloak } from '../../lib/keycloak';

export interface WalletAuthSnapshot {
  isAuthed: boolean;
  username?: string;
  rawToken?: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2 || !parts[1]) {
      return null;
    }

    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json = atob(padded);

    // Safety check: avoid throwing on malformed payloads.
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickUsername(payload: Record<string, unknown> | null): string | undefined {
  if (!payload) {
    return undefined;
  }

  const preferred = payload.preferred_username;
  if (typeof preferred === 'string' && preferred.trim().length > 0) {
    return preferred;
  }

  const username = payload.username;
  if (typeof username === 'string' && username.trim().length > 0) {
    return username;
  }

  const subject = payload.sub;
  if (typeof subject === 'string' && subject.trim().length > 0) {
    return subject;
  }

  return undefined;
}

export function getWalletAuthSnapshot(): WalletAuthSnapshot {
  const rawToken =
    typeof keycloak.token === 'string' && keycloak.token.trim().length > 0
      ? keycloak.token
      : undefined;

  const parsedToken =
    keycloak.tokenParsed && typeof keycloak.tokenParsed === 'object'
      ? (keycloak.tokenParsed as Record<string, unknown>)
      : null;

  const username = pickUsername(parsedToken) ?? (rawToken ? pickUsername(decodeJwtPayload(rawToken)) : undefined);
  const isAuthed = Boolean(keycloak.authenticated && rawToken);

  return {
    isAuthed,
    ...(username ? { username } : {}),
    ...(rawToken ? { rawToken } : {}),
  };
}

function snapshotsEqual(a: WalletAuthSnapshot, b: WalletAuthSnapshot) {
  return a.isAuthed === b.isAuthed && a.username === b.username && a.rawToken === b.rawToken;
}

export function useWalletAuth(): WalletAuthSnapshot {
  const [snapshot, setSnapshot] = useState<WalletAuthSnapshot>(() => getWalletAuthSnapshot());

  useEffect(() => {
    const sync = () => {
      const next = getWalletAuthSnapshot();
      setSnapshot((previous) => (snapshotsEqual(previous, next) ? previous : next));
    };

    sync();
    const timer = window.setInterval(sync, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return snapshot;
}
