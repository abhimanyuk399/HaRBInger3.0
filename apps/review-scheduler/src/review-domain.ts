export type ReviewRiskTier = 'LOW' | 'MEDIUM' | 'HIGH';
export type ReviewAction = 'SYNC_CKYC' | 'REQUEST_RECONSENT';

export interface ReviewIntervalYearsConfig {
  LOW: number;
  MEDIUM: number;
  HIGH: number;
}

export const DEFAULT_REVIEW_INTERVAL_YEARS: ReviewIntervalYearsConfig = {
  HIGH: 2,
  MEDIUM: 8,
  LOW: 10,
};

export function getReviewIntervalYears(
  riskTier: ReviewRiskTier,
  config: ReviewIntervalYearsConfig = DEFAULT_REVIEW_INTERVAL_YEARS
): number {
  return config[riskTier];
}

export function computeNextReviewAt(
  lastKycUpdateAt: Date,
  riskTier: ReviewRiskTier,
  config: ReviewIntervalYearsConfig = DEFAULT_REVIEW_INTERVAL_YEARS
): Date {
  const next = new Date(lastKycUpdateAt);
  next.setUTCFullYear(next.getUTCFullYear() + getReviewIntervalYears(riskTier, config));
  return next;
}

export function decideReviewAction(riskTier: ReviewRiskTier): ReviewAction {
  return riskTier === 'HIGH' ? 'REQUEST_RECONSENT' : 'SYNC_CKYC';
}

export function isReviewDue(now: Date, nextReviewAt: Date): boolean {
  return nextReviewAt.getTime() <= now.getTime();
}
