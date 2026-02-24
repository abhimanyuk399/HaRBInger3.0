import type { ReplayProtector } from '@bharat/common';

export const ALLOWED_DISCLOSABLE_FIELDS = [
  'fullName',
  'dob',
  'idNumber',
  'email',
  'phone',
  'addressLine1',
  'pincode',
] as const;

export type DisclosableField = (typeof ALLOWED_DISCLOSABLE_FIELDS)[number];

export function selectiveDisclosure(
  source: Record<string, unknown>,
  requestedFields: string[]
): Record<string, unknown> {
  const allowed = new Set<string>(ALLOWED_DISCLOSABLE_FIELDS);
  const output: Record<string, unknown> = {};

  for (const field of requestedFields) {
    if (!allowed.has(field)) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      output[field] = source[field];
    }
  }

  return output;
}

export async function reserveReplayGuards(input: {
  jti: string;
  nonce: string;
  ttlSeconds: number;
  jtiProtector: ReplayProtector;
  nonceProtector: ReplayProtector;
}): Promise<void> {
  const jtiReserved = await input.jtiProtector.consume(input.jti, input.ttlSeconds);
  if (!jtiReserved) {
    throw new Error('replay_detected:jti');
  }

  const nonceReserved = await input.nonceProtector.consume(input.nonce, input.ttlSeconds);
  if (!nonceReserved) {
    throw new Error('replay_detected:nonce');
  }
}

export interface DelegationAccessMatch {
  id: string;
}

function normalizeConstraintList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function evaluateDelegationConstraints(input: {
  purpose: string;
  requestedFields: string[];
  allowedPurposes: string[];
  allowedFields: string[];
}):
  | {
      allowed: true;
      normalizedAllowedPurposes: string[];
      normalizedAllowedFields: string[];
    }
  | {
      allowed: false;
      errorCode: 'delegation_constraint_violation';
      message: string;
      details: {
        purpose: string;
        requestedFields: string[];
        allowedPurposes: string[];
        allowedFields: string[];
        violations: Array<'purpose_not_allowed' | 'fields_not_allowed'>;
        disallowedFields: string[];
      };
    } {
  const purpose = input.purpose.trim();
  const requestedFields = normalizeConstraintList(input.requestedFields);
  const allowedPurposes = normalizeConstraintList(input.allowedPurposes);
  const allowedFields = normalizeConstraintList(input.allowedFields);

  const allowedPurposeSet = new Set(allowedPurposes.map((entry) => entry.toLowerCase()));
  const allowedFieldSet = new Set(allowedFields.map((entry) => entry.toLowerCase()));

  const purposeAllowed = allowedPurposeSet.has('*') || (purpose.length > 0 && allowedPurposeSet.has(purpose.toLowerCase()));
  const disallowedFields = requestedFields.filter((field) => !(allowedFieldSet.has('*') || allowedFieldSet.has(field.toLowerCase())));
  const fieldsAllowed = disallowedFields.length === 0;

  if (purposeAllowed && fieldsAllowed) {
    return {
      allowed: true,
      normalizedAllowedPurposes: allowedPurposes,
      normalizedAllowedFields: allowedFields,
    };
  }

  const violations: Array<'purpose_not_allowed' | 'fields_not_allowed'> = [];
  if (!purposeAllowed) {
    violations.push('purpose_not_allowed');
  }
  if (!fieldsAllowed) {
    violations.push('fields_not_allowed');
  }

  const message =
    violations.length === 2
      ? 'Delegation constraints do not allow this purpose and requested fields.'
      : !purposeAllowed
        ? 'Delegation constraints do not allow this purpose.'
        : 'Delegation constraints do not allow one or more requested fields.';

  return {
    allowed: false,
    errorCode: 'delegation_constraint_violation',
    message,
    details: {
      purpose,
      requestedFields,
      allowedPurposes,
      allowedFields,
      violations,
      disallowedFields,
    },
  };
}

export type ConsentActionActorType = 'OWNER' | 'DELEGATE';

export async function resolveConsentActionActor(input: {
  ownerRefHash: string;
  actorUserId: string;
  now?: Date;
  hashUserId: (userId: string) => string;
  findActiveDelegation: (query: {
    ownerRefHash: string;
    delegateRefHash: string;
    scope: string;
    now: Date;
  }) => Promise<DelegationAccessMatch | null>;
}): Promise<{ allowed: true; actorType: ConsentActionActorType; delegationId?: string } | { allowed: false }> {
  const now = input.now ?? new Date();
  const actorRefHash = input.hashUserId(input.actorUserId);
  if (actorRefHash === input.ownerRefHash) {
    return { allowed: true, actorType: 'OWNER' };
  }

  const delegation = await input.findActiveDelegation({
    ownerRefHash: input.ownerRefHash,
    delegateRefHash: actorRefHash,
    scope: 'consent.approve',
    now,
  });
  if (!delegation) {
    return { allowed: false };
  }

  return {
    allowed: true,
    actorType: 'DELEGATE',
    delegationId: delegation.id,
  };
}
