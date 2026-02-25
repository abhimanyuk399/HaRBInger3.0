import { createHash } from 'crypto';

export const REGISTRY_STATUSES = ['ACTIVE', 'REVOKED', 'SUPERSEDED', 'EXPIRED'] as const;

export type RegistryStatus = (typeof REGISTRY_STATUSES)[number];

const ALLOWED_STATUS_TRANSITIONS: Record<RegistryStatus, RegistryStatus[]> = {
  ACTIVE: ['REVOKED', 'SUPERSEDED', 'EXPIRED'],
  REVOKED: [],
  SUPERSEDED: [],
  EXPIRED: [],
};

export function canTransitionStatus(currentStatus: RegistryStatus, nextStatus: RegistryStatus): boolean {
  return ALLOWED_STATUS_TRANSITIONS[currentStatus].includes(nextStatus);
}

export function assertValidStatusTransition(currentStatus: RegistryStatus, nextStatus: RegistryStatus): void {
  if (!canTransitionStatus(currentStatus, nextStatus)) {
    throw new Error(`invalid_status_transition:${currentStatus}->${nextStatus}`);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export interface AuditHashInput {
  tokenId: string;
  eventType: string;
  status: RegistryStatus;
  version: number;
  issuedAt: Date;
  expiresAt: Date;
  supersededBy?: string | null;
  actor?: string | null;
  detail?: unknown;
  occurredAt: Date;
  hashPrev?: string | null;
}

export function computeAuditHash(input: AuditHashInput): string {
  const payload = [
    input.tokenId,
    input.eventType,
    input.status,
    String(input.version),
    input.issuedAt.toISOString(),
    input.expiresAt.toISOString(),
    input.supersededBy ?? '',
    input.actor ?? '',
    stableStringify(input.detail ?? null),
    input.occurredAt.toISOString(),
    input.hashPrev ?? '',
  ].join('|');

  return createHash('sha256').update(payload).digest('hex');
}

export interface AuditChainEntry extends Omit<AuditHashInput, 'hashPrev'> {
  hashPrev?: string | null;
  hashCurr: string;
}

export function verifyAuditHashChain(events: AuditChainEntry[]): boolean {
  let expectedPrev: string | null = null;

  for (const event of events) {
    const eventPrev = event.hashPrev ?? null;
    if (eventPrev !== expectedPrev) {
      return false;
    }

    const expectedCurr = computeAuditHash({
      tokenId: event.tokenId,
      eventType: event.eventType,
      status: event.status,
      version: event.version,
      issuedAt: event.issuedAt,
      expiresAt: event.expiresAt,
      supersededBy: event.supersededBy,
      actor: event.actor,
      detail: event.detail,
      occurredAt: event.occurredAt,
      hashPrev: eventPrev,
    });

    if (expectedCurr !== event.hashCurr) {
      return false;
    }

    expectedPrev = event.hashCurr;
  }

  return true;
}
