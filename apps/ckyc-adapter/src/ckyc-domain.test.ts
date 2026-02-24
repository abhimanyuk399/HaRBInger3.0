import { describe, expect, it } from 'vitest';
import {
  applySimulatedProfileUpdate,
  buildDefaultCkycProfile,
  buildSupersededKycPayload,
  hasUnsyncedCkycChange,
  hasUnsyncedVersionChange,
} from './ckyc-domain.js';

describe('ckyc profile domain', () => {
  it('increments version and mutates address on simulated update', () => {
    const initial = buildDefaultCkycProfile('user-1234');
    const updated = applySimulatedProfileUpdate(initial);

    expect(updated.profileVersion).toBe(initial.profileVersion + 1);
    expect(updated.payload.addressLine1).not.toBe(initial.payload.addressLine1);
    expect(updated.hash).not.toBe(initial.hash);
  });

  it('detects unsynced changes from hash mismatch', () => {
    expect(hasUnsyncedCkycChange(null, 'abc')).toBe(true);
    expect(hasUnsyncedCkycChange('abc', 'abc')).toBe(false);
    expect(hasUnsyncedCkycChange('abc', 'def')).toBe(true);
  });

  it('detects unsynced changes from profile version progression', () => {
    expect(hasUnsyncedVersionChange(null, 1)).toBe(true);
    expect(hasUnsyncedVersionChange(1, 1)).toBe(false);
    expect(hasUnsyncedVersionChange(1, 2)).toBe(true);
    expect(hasUnsyncedVersionChange(2, 1)).toBe(false);
  });

  it('merges CKYC address fields into issuer payload', () => {
    const merged = buildSupersededKycPayload(
      {
        fullName: 'Ananya Rao',
        idNumber: 'KYC-1',
        dob: '1995-01-12',
      },
      {
        addressLine1: 'House 99, Sector 9',
        pincode: '560099',
      }
    );

    expect(merged).toMatchObject({
      fullName: 'Ananya Rao',
      idNumber: 'KYC-1',
      dob: '1995-01-12',
      addressLine1: 'House 99, Sector 9',
      pincode: '560099',
    });
  });
});
