import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REVIEW_INTERVAL_YEARS,
  computeNextReviewAt,
  decideReviewAction,
  getReviewIntervalYears,
  isReviewDue,
} from './review-domain.js';

describe('review scheduler domain', () => {
  it('maps risk tiers to default year intervals', () => {
    expect(getReviewIntervalYears('HIGH')).toBe(2);
    expect(getReviewIntervalYears('MEDIUM')).toBe(8);
    expect(getReviewIntervalYears('LOW')).toBe(10);
  });

  it('selects sync for LOW/MEDIUM and re-consent for HIGH', () => {
    expect(decideReviewAction('LOW')).toBe('SYNC_CKYC');
    expect(decideReviewAction('MEDIUM')).toBe('SYNC_CKYC');
    expect(decideReviewAction('HIGH')).toBe('REQUEST_RECONSENT');
  });

  it('computes due dates across tiers with default periodicity', () => {
    const lastKycUpdateAt = new Date('2020-01-15T00:00:00.000Z');
    const asOf = new Date('2028-01-15T00:00:00.000Z');

    const highNext = computeNextReviewAt(lastKycUpdateAt, 'HIGH');
    const mediumNext = computeNextReviewAt(lastKycUpdateAt, 'MEDIUM');
    const lowNext = computeNextReviewAt(lastKycUpdateAt, 'LOW');

    expect(highNext.toISOString()).toBe('2022-01-15T00:00:00.000Z');
    expect(mediumNext.toISOString()).toBe('2028-01-15T00:00:00.000Z');
    expect(lowNext.toISOString()).toBe('2030-01-15T00:00:00.000Z');

    expect(isReviewDue(asOf, highNext)).toBe(true);
    expect(isReviewDue(asOf, mediumNext)).toBe(true);
    expect(isReviewDue(asOf, lowNext)).toBe(false);
  });

  it('allows config overrides for periodicity', () => {
    const overridden = {
      ...DEFAULT_REVIEW_INTERVAL_YEARS,
      HIGH: 1,
      MEDIUM: 6,
      LOW: 9,
    } as const;

    expect(getReviewIntervalYears('HIGH', overridden)).toBe(1);
    expect(getReviewIntervalYears('MEDIUM', overridden)).toBe(6);
    expect(getReviewIntervalYears('LOW', overridden)).toBe(9);

    const lastKycUpdateAt = new Date('2024-01-01T00:00:00.000Z');
    expect(computeNextReviewAt(lastKycUpdateAt, 'HIGH', overridden).toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });
});
