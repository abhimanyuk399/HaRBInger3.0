import Keycloak from 'keycloak-js';

const keycloakUrl = import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8080';
const keycloakRealm = import.meta.env.VITE_KEYCLOAK_REALM ?? 'bharat-kyc-dev';
const walletClientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'wallet-client';
const fiClientId = import.meta.env.VITE_FI_KEYCLOAK_CLIENT_ID ?? 'fi-browser-client';
const tokenEndpoint = `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/token`;
const directGrantStorageKey = {
  wallet: 'bharat_kyc_t_wallet_direct_session',
  fi: 'bharat_kyc_t_fi_direct_session',
} as const;

type DirectGrantPortal = 'wallet' | 'fi';

interface DirectGrantSession {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: number;
  refreshExpiresAt: number | null;
  scope: string | null;
  username: string;
}

const walletKeycloak = new Keycloak({
  url: keycloakUrl,
  realm: keycloakRealm,
  clientId: walletClientId,
});

const fiKeycloak = new Keycloak({
  url: keycloakUrl,
  realm: keycloakRealm,
  clientId: fiClientId,
});

let walletInitPromise: Promise<boolean> | null = null;
let fiInitPromise: Promise<boolean> | null = null;
let walletDirectSession = loadDirectGrantSession('wallet');
let fiDirectSession = loadDirectGrantSession('fi');

function storageAvailable() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function loadDirectGrantSession(portal: DirectGrantPortal): DirectGrantSession | null {
  if (!storageAvailable()) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(directGrantStorageKey[portal]);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DirectGrantSession>;
    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      typeof parsed.username !== 'string'
    ) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
      idToken: typeof parsed.idToken === 'string' ? parsed.idToken : null,
      expiresAt: parsed.expiresAt,
      refreshExpiresAt: typeof parsed.refreshExpiresAt === 'number' ? parsed.refreshExpiresAt : null,
      scope: typeof parsed.scope === 'string' ? parsed.scope : null,
      username: parsed.username,
    };
  } catch {
    return null;
  }
}

function persistDirectGrantSession(portal: DirectGrantPortal, session: DirectGrantSession | null) {
  if (!storageAvailable()) {
    return;
  }
  if (!session) {
    window.localStorage.removeItem(directGrantStorageKey[portal]);
    return;
  }
  window.localStorage.setItem(directGrantStorageKey[portal], JSON.stringify(session));
}

function setDirectGrantSession(portal: DirectGrantPortal, session: DirectGrantSession | null) {
  if (portal === 'wallet') {
    walletDirectSession = session;
  } else {
    fiDirectSession = session;
  }
  persistDirectGrantSession(portal, session);
}

function getDirectGrantSession(portal: DirectGrantPortal) {
  return portal === 'wallet' ? walletDirectSession : fiDirectSession;
}

function clientIdFor(portal: DirectGrantPortal) {
  return portal === 'wallet' ? walletClientId : fiClientId;
}

async function readTokenResponse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const errorMessage =
      typeof payload === 'object' &&
      payload &&
      typeof (payload as Record<string, unknown>).error_description === 'string'
        ? (payload as Record<string, string>).error_description
        : typeof payload === 'object' &&
            payload &&
            typeof (payload as Record<string, unknown>).error === 'string'
          ? (payload as Record<string, string>).error
          : `Authentication failed (${response.status})`;
    throw new Error(errorMessage);
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid auth response');
  }
  return payload as Record<string, unknown>;
}

async function postTokenForm(data: URLSearchParams) {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: data,
  });
  return readTokenResponse(response);
}

function isInvalidScopeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes('invalid_scope') || message.includes('invalid scopes') || message.includes('scope');
}

function normalizeDirectGrantSession(
  payload: Record<string, unknown>,
  username: string
): DirectGrantSession {
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : null;
  if (!accessToken) {
    throw new Error('Missing access token in auth response');
  }
  const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : null;
  const idToken = typeof payload.id_token === 'string' ? payload.id_token : null;
  const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 60;
  const refreshExpiresIn = typeof payload.refresh_expires_in === 'number' ? payload.refresh_expires_in : null;
  return {
    accessToken,
    refreshToken,
    idToken,
    expiresAt: Date.now() + Math.max(10, expiresIn - 8) * 1000,
    refreshExpiresAt: refreshExpiresIn ? Date.now() + Math.max(10, refreshExpiresIn - 8) * 1000 : null,
    scope: typeof payload.scope === 'string' ? payload.scope : null,
    username,
  };
}

async function refreshDirectGrantSession(portal: DirectGrantPortal): Promise<DirectGrantSession | null> {
  const session = getDirectGrantSession(portal);
  if (!session || !session.refreshToken) {
    return null;
  }
  if (session.refreshExpiresAt && Date.now() >= session.refreshExpiresAt) {
    setDirectGrantSession(portal, null);
    return null;
  }

  const data = new URLSearchParams();
  data.set('grant_type', 'refresh_token');
  data.set('client_id', clientIdFor(portal));
  data.set('refresh_token', session.refreshToken);

  try {
    const payload = await postTokenForm(data);
    const nextSession = normalizeDirectGrantSession(payload, session.username);
    setDirectGrantSession(portal, nextSession);
    return nextSession;
  } catch {
    setDirectGrantSession(portal, null);
    return null;
  }
}

async function directGrantAccessToken(portal: DirectGrantPortal): Promise<string | null> {
  const session = getDirectGrantSession(portal);
  if (!session) {
    return null;
  }
  if (Date.now() < session.expiresAt) {
    return session.accessToken;
  }
  const refreshed = await refreshDirectGrantSession(portal);
  return refreshed?.accessToken ?? null;
}

function silentCheckSsoRedirectUri() {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return `${window.location.origin}/silent-check-sso.html`;
}

function hasAuthCallbackParams() {
  if (typeof window === 'undefined') {
    return false;
  }

  const matcher = /(?:^|[?&#])(code|state|session_state|error)=/;
  return matcher.test(window.location.search) || matcher.test(window.location.hash);
}

function currentPathname() {
  if (typeof window === 'undefined') {
    return '/';
  }
  return window.location.pathname || '/';
}

function isFiPath(pathname: string) {
  return pathname.startsWith('/fi');
}

function keycloakInitOptions(): Parameters<Keycloak['init']>[0] {
  return {
    onLoad: 'check-sso',
    pkceMethod: 'S256',
    checkLoginIframe: false,
    silentCheckSsoRedirectUri: silentCheckSsoRedirectUri(),
    silentCheckSsoFallback: false,
  };
}

export function initWalletKeycloak() {
  if (!walletInitPromise) {
    walletInitPromise = walletKeycloak.init(keycloakInitOptions()).catch((error) => {
      walletInitPromise = null;
      throw error;
    });
  }
  return walletInitPromise;
}

export function initFiKeycloak() {
  if (!fiInitPromise) {
    fiInitPromise = fiKeycloak.init(keycloakInitOptions()).catch((error) => {
      fiInitPromise = null;
      throw error;
    });
  }
  return fiInitPromise;
}

export function initKeycloak() {
  return initWalletKeycloak();
}

export async function initAuthClients() {
  await Promise.allSettled([initWalletKeycloak(), initFiKeycloak()]);
}

export async function initAuthClientsForCurrentRoute() {
  const pathname = currentPathname();
  const hasCallbackParams = hasAuthCallbackParams();

  // OIDC callback must be handled by the client that initiated login.
  if (hasCallbackParams) {
    if (isFiPath(pathname)) {
      await initFiKeycloak();
      return;
    }
    await initWalletKeycloak();
    return;
  }

  // Normal navigation path: warm both clients for SSO status.
  await initAuthClients();
}

async function accessTokenFor(client: Keycloak): Promise<string | null> {
  if (!client.authenticated) {
    return null;
  }

  try {
    await client.updateToken(30);
  } catch {
    return null;
  }

  return client.token ?? null;
}

export async function getWalletAccessToken(): Promise<string | null> {
  const directToken = await directGrantAccessToken('wallet');
  if (directToken) {
    return directToken;
  }
  return accessTokenFor(walletKeycloak);
}

export async function getFiAccessToken(): Promise<string | null> {
  const directToken = await directGrantAccessToken('fi');
  if (directToken) {
    return directToken;
  }
  return accessTokenFor(fiKeycloak);
}

export async function getAccessToken(): Promise<string | null> {
  return getWalletAccessToken();
}

export async function loginWithPasswordGrant(
  portal: DirectGrantPortal,
  username: string,
  password: string
): Promise<DirectGrantSession> {
  const safeUsername = username.trim();
  if (!safeUsername || !password) {
    throw new Error('Username and password are required.');
  }

  const buildTokenForm = (scope?: string) => {
    const data = new URLSearchParams();
    data.set('grant_type', 'password');
    data.set('client_id', clientIdFor(portal));
    data.set('username', safeUsername);
    data.set('password', password);
    if (scope) {
      data.set('scope', scope);
    }
    return data;
  };

  let payload: Record<string, unknown>;
  try {
    payload = await postTokenForm(buildTokenForm());
  } catch (error) {
    if (!isInvalidScopeError(error)) {
      throw error;
    }
    try {
      payload = await postTokenForm(buildTokenForm('openid'));
    } catch (openidError) {
      if (!isInvalidScopeError(openidError)) {
        throw openidError;
      }
      payload = await postTokenForm(buildTokenForm('openid profile email'));
    }
  }

  const session = normalizeDirectGrantSession(payload, safeUsername);
  setDirectGrantSession(portal, session);
  return session;
}

export function getWalletDirectGrantSession() {
  return walletDirectSession;
}

export function getFiDirectGrantSession() {
  return fiDirectSession;
}

export function clearWalletDirectGrantSession() {
  setDirectGrantSession('wallet', null);
}

export function clearFiDirectGrantSession() {
  setDirectGrantSession('fi', null);
}

export const keycloak = walletKeycloak;
export { walletKeycloak, fiKeycloak };
