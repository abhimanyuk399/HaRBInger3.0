import { hashPii } from '@bharat/common';

export interface CkycProfilePayload {
  addressLine1: string;
  pincode: string;
}

export interface CkycProfileState {
  userId: string;
  profileVersion: number;
  lastUpdated: Date;
  hash: string;
  payload: CkycProfilePayload;
}

export function buildDefaultCkycPayload(userId: string): CkycProfilePayload {
  const normalized = userId.trim().toUpperCase();
  const suffix = normalized.slice(-4).padStart(4, '0');
  return {
    addressLine1: `House ${suffix}, Sector 1, Mock City`,
    pincode: `560${suffix.slice(0, 1)}${suffix.slice(1, 2)}`,
  };
}

export function computeCkycProfileHash(input: { profileVersion: number; payload: CkycProfilePayload }): string {
  return hashPii({
    profileVersion: input.profileVersion,
    payload: input.payload,
  });
}

export function buildDefaultCkycProfile(userId: string): CkycProfileState {
  const payload = buildDefaultCkycPayload(userId);
  const profileVersion = 1;
  return {
    userId,
    profileVersion,
    payload,
    hash: computeCkycProfileHash({ profileVersion, payload }),
    lastUpdated: new Date(),
  };
}

export function applySimulatedProfileUpdate(state: CkycProfileState): CkycProfileState {
  const nextVersion = state.profileVersion + 1;
  const payload: CkycProfilePayload = {
    ...state.payload,
    addressLine1: `House ${String(nextVersion).padStart(2, '0')}, Sector ${nextVersion}, Mock City`,
  };

  return {
    ...state,
    profileVersion: nextVersion,
    payload,
    hash: computeCkycProfileHash({ profileVersion: nextVersion, payload }),
    lastUpdated: new Date(),
  };
}

export function hasUnsyncedCkycChange(lastSyncedHash: string | null | undefined, currentHash: string): boolean {
  if (!lastSyncedHash) {
    return true;
  }
  return lastSyncedHash !== currentHash;
}

export function hasUnsyncedVersionChange(
  lastSyncedVersion: number | null | undefined,
  currentVersion: number
): boolean {
  if (lastSyncedVersion == null) {
    return true;
  }
  return currentVersion > lastSyncedVersion;
}

export function buildSupersededKycPayload(
  issuerKyc: Record<string, unknown>,
  ckycPayload: CkycProfilePayload
): Record<string, unknown> {
  return {
    ...issuerKyc,
    addressLine1: ckycPayload.addressLine1,
    pincode: ckycPayload.pincode,
  };
}
