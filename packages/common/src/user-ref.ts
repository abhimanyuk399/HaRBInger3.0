import { createHash } from 'crypto';

export function computeUserRefHashFromIdentifier(identifier: string): string {
  const normalized = identifier.trim().toLowerCase();
  return createHash('sha256').update(normalized).digest('hex');
}
