export interface ConsentStatusFailure {
  error: 'consent_rejected' | 'consent_not_approved' | 'consent_expired';
  httpStatus: number;
  message: string;
}

export function evaluateConsentStatusForVerification(input: {
  status: string;
  expiresAt: string;
  now?: Date;
}): ConsentStatusFailure | null {
  const normalizedStatus = input.status.trim().toUpperCase();
  const now = input.now ?? new Date();
  const expiresAt = new Date(input.expiresAt);

  if (!Number.isNaN(expiresAt.getTime()) && now.getTime() > expiresAt.getTime()) {
    return {
      error: 'consent_expired',
      httpStatus: 409,
      message: 'Consent TTL has elapsed. Renew consent before FI verification.',
    };
  }

  if (normalizedStatus === 'APPROVED') {
    return null;
  }

  if (normalizedStatus === 'REJECTED') {
    return {
      error: 'consent_rejected',
      httpStatus: 409,
      message: 'Consent was rejected by wallet user/delegate. Assertion verification is blocked.',
    };
  }

  return {
    error: 'consent_not_approved',
    httpStatus: 409,
    message: `Consent status must be APPROVED before verification. Current status: ${normalizedStatus || 'UNKNOWN'}.`,
  };
}
