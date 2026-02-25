import type { ServiceName } from './types';

export function formatDateTime(value?: string | null) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function truncate(value: string, max = 18) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

export const serviceLabel: Record<ServiceName, string> = {
  issuer: 'Issuer',
  registry: 'Registry',
  consent: 'Consent',
  wallet: 'Wallet',
  fi: 'FI',
  ckyc: 'CKYCR',
  review: 'Review',
  console: 'Console',
};
