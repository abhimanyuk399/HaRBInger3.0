function readEnv(...values: Array<unknown>): string | null {
  for (const candidate of values) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}
function readBoolEnv(...values: Array<unknown>): boolean {
  for (const candidate of values) {
    if (typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'string') {
      const v = candidate.trim().toLowerCase();
      if (['1','true','yes','on'].includes(v)) return true;
      if (['0','false','no','off'].includes(v)) return false;
    }
  }
  return false;
}

export const IDENTITY_USERNAME_EQUALS_USERID = readBoolEnv(
  import.meta.env.VITE_IDENTITY_USERNAME_EQUALS_USERID,
  import.meta.env.VITE_USERNAME_EQUALS_USERID
);

export const WALLET_OWNER_USER_ID =
  readEnv(import.meta.env.VITE_WALLET_OWNER_USER_ID, 'wallet-owner-1') ?? 'wallet-owner-1';
const _WALLET_OWNER_USERNAME = readEnv(import.meta.env.VITE_WALLET_OWNER_USERNAME, 'wallet-owner-1') ?? 'wallet-owner-1';
export const WALLET_OWNER_USERNAME = IDENTITY_USERNAME_EQUALS_USERID ? WALLET_OWNER_USER_ID : _WALLET_OWNER_USERNAME;
export const WALLET_OWNER_ALIAS = IDENTITY_USERNAME_EQUALS_USERID
  ? WALLET_OWNER_USER_ID
  : (readEnv(import.meta.env.VITE_WALLET_OWNER_ALIAS, import.meta.env.VITE_WALLET_OWNER_DISPLAY, 'wallet-owner-1') ?? 'wallet-owner-1');

export const WALLET_SECONDARY_USER_ID =
  readEnv(import.meta.env.VITE_WALLET_SECONDARY_USER_ID, 'wallet-user-2') ?? 'wallet-user-2';
const _WALLET_SECONDARY_USERNAME = readEnv(import.meta.env.VITE_WALLET_SECONDARY_USERNAME, 'wallet-user-2') ?? 'wallet-user-2';
export const WALLET_SECONDARY_USERNAME = IDENTITY_USERNAME_EQUALS_USERID ? WALLET_SECONDARY_USER_ID : _WALLET_SECONDARY_USERNAME;
export const WALLET_SECONDARY_ALIAS = IDENTITY_USERNAME_EQUALS_USERID
  ? WALLET_SECONDARY_USER_ID
  : (readEnv(import.meta.env.VITE_WALLET_SECONDARY_ALIAS, 'wallet-user-2') ?? 'wallet-user-2');

export const WALLET_NOMINEE_USER_ID =
  readEnv(import.meta.env.VITE_WALLET_NOMINEE_USER_ID, 'wallet-nominee-1') ?? 'wallet-nominee-1';
const _WALLET_NOMINEE_USERNAME =
  readEnv(import.meta.env.VITE_WALLET_NOMINEE_USERNAME, 'wallet-nominee-1') ??
  'wallet-nominee-1';
export const WALLET_NOMINEE_USERNAME = IDENTITY_USERNAME_EQUALS_USERID ? WALLET_NOMINEE_USER_ID : _WALLET_NOMINEE_USERNAME;
export const WALLET_NOMINEE_ALIAS = IDENTITY_USERNAME_EQUALS_USERID
  ? WALLET_NOMINEE_USER_ID
  : (readEnv(import.meta.env.VITE_WALLET_NOMINEE_ALIAS, import.meta.env.VITE_WALLET_NOMINEE_DISPLAY, 'wallet-nominee-1') ??
  'wallet-nominee-1');

export const FI_CLIENT_ID = readEnv(import.meta.env.VITE_FI_CLIENT_ID, 'fi-client') ?? 'fi-client';
export const FI2_CLIENT_ID = readEnv(import.meta.env.VITE_FI2_CLIENT_ID, 'fi-client-2') ?? 'fi-client-2';

export const FI_ANALYST_1_USERNAME = readEnv(import.meta.env.VITE_FI_USER_1, 'fi-analyst-1') ?? 'fi-analyst-1';
export const FI_ANALYST_2_USERNAME = readEnv(import.meta.env.VITE_FI_USER_2, 'fi-analyst-2') ?? 'fi-analyst-2';

export const FI_OPTIONS = [
  { id: FI_CLIENT_ID, label: 'FI #1' },
  { id: FI2_CLIENT_ID, label: 'FI #2' },
] as const;

export const KNOWN_WALLET_TARGETS = [
  { username: WALLET_OWNER_USERNAME, userId: WALLET_OWNER_USER_ID, label: `${WALLET_OWNER_ALIAS} (${WALLET_OWNER_USER_ID})` },
  { username: WALLET_SECONDARY_USERNAME, userId: WALLET_SECONDARY_USER_ID, label: `${WALLET_SECONDARY_ALIAS} (${WALLET_SECONDARY_USER_ID})` },
  { username: WALLET_NOMINEE_USERNAME, userId: WALLET_NOMINEE_USER_ID, label: `${WALLET_NOMINEE_ALIAS} (${WALLET_NOMINEE_USER_ID})` },
] as const;

export function displayWalletIdentity(username: string | null | undefined, fallback = 'authenticated') {
  if (!username) {
    return fallback;
  }
  if (username === WALLET_OWNER_USERNAME) {
    return WALLET_OWNER_ALIAS;
  }
  if (username === WALLET_SECONDARY_USERNAME) {
    return WALLET_SECONDARY_ALIAS;
  }
  if (username === WALLET_NOMINEE_USERNAME) {
    return WALLET_NOMINEE_ALIAS;
  }
  return username;
}

export function fiUsernameToClientId(username: string) {
  return username === FI_ANALYST_2_USERNAME ? FI2_CLIENT_ID : FI_CLIENT_ID;
}
