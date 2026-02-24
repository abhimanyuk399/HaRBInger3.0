import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { computeUserRefHashFromIdentifier, createJwksFromPrivateKey } from '@bharat/common';

export interface KycPayload {
  fullName: string;
  dob: string;
  idNumber: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  pincode?: string;
}

export interface EncryptResult {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function computeUserRefHash(payload: KycPayload): string {
  return computeUserRefHashFromIdentifier(payload.idNumber);
}

export function loadVaultKeyFromEnv(encodedKey: string | undefined): Buffer {
  if (!encodedKey) {
    throw new Error('VAULT_ENCRYPTION_KEY_BASE64 is required');
  }
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) {
    throw new Error('VAULT_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes for AES-256-GCM');
  }
  return key;
}

export function encryptPayload(payload: KycPayload, key: Buffer): EncryptResult {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptPayload(input: EncryptResult, key: Buffer): KycPayload {
  const iv = Buffer.from(input.iv, 'base64');
  const ciphertext = Buffer.from(input.ciphertext, 'base64');
  const authTag = Buffer.from(input.authTag, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext) as KycPayload;
}

export interface SignKycJwtInput {
  privateKeyPem: string;
  kid: string;
  issuerId: string;
  tokenId: string;
  version: number;
  vaultRef: string;
  userRefHash: string;
  ttlSeconds: number;
}

export interface SignedKycJwt {
  tokenJwt: string;
  issuedAt: Date;
  expiresAt: Date;
}

export async function signKycTokenJwt(input: SignKycJwtInput): Promise<SignedKycJwt> {
  const privateKey = await importPKCS8(input.privateKeyPem, 'ES256');
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAtSeconds + input.ttlSeconds;

  const tokenJwt = await new SignJWT({
    issuerId: input.issuerId,
    tokenId: input.tokenId,
    version: input.version,
    vaultRef: input.vaultRef,
  })
    .setProtectedHeader({ alg: 'ES256', kid: input.kid })
    .setIssuer(input.issuerId)
    .setSubject(input.userRefHash)
    .setJti(input.tokenId)
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime(expiresAtSeconds)
    .sign(privateKey);

  return {
    tokenJwt,
    issuedAt: new Date(issuedAtSeconds * 1000),
    expiresAt: new Date(expiresAtSeconds * 1000),
  };
}

export async function buildIssuerJwks(privateKeyPem: string, kid: string) {
  return createJwksFromPrivateKey(privateKeyPem, kid);
}
