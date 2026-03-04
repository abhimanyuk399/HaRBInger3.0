import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

function generateEscapedEcPrivateKey() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim().replace(/\n/g, '\\n');
}

const env = {
  KEYCLOAK_ADMIN: 'admin',
  KEYCLOAK_ADMIN_PASSWORD: 'admin',
  KEYCLOAK_WALLET_OWNER_USER: 'wallet-owner-1',
  KEYCLOAK_WALLET_OWNER_PASSWORD: 'wallet-owner-1-pass',
  KEYCLOAK_WALLET_OWNER_USER_ID: 'KYC-1234',
  KEYCLOAK_NOMINEE_USER: 'wallet-nominee',
  KEYCLOAK_NOMINEE_PASSWORD: 'wallet-nominee-pass',
  KEYCLOAK_FI_CLIENT_ID: 'fi-client',
  KEYCLOAK_FI_BROWSER_CLIENT_ID: 'fi-browser-client',
  KEYCLOAK_FI2_CLIENT_ID: 'fi-client-2',
  KEYCLOAK_FI_CLIENT_SECRET: 'fi-client-secret',
  KEYCLOAK_FI2_CLIENT_SECRET: 'fi-client-2-secret',
  KEYCLOAK_FI_USER_1: 'fi-analyst-1',
  KEYCLOAK_FI_PASSWORD_1: 'fi-analyst-1-pass',
  KEYCLOAK_FI_USER_2: 'fi-analyst-2',
  KEYCLOAK_FI_PASSWORD_2: 'fi-analyst-2-pass',
  JWT_PRIVATE_KEY: generateEscapedEcPrivateKey(),
  CONSENT_SIGNING_PRIVATE_KEY: generateEscapedEcPrivateKey(),
  VAULT_ENCRYPTION_KEY_BASE64: randomBytes(32).toString('base64'),
  ISSUER_ADMIN_CLIENT_SECRET: 'issuer-admin-secret',
  CONSENT_SERVICE_CLIENT_SECRET: 'issuer-admin-secret',
  REVIEW_SERVICE_CLIENT_SECRET: 'issuer-admin-secret',
  VITE_FI_KEYCLOAK_CLIENT_ID: 'fi-browser-client',
  VITE_FI_CLIENT_ID: 'fi-client',
  VITE_FI2_CLIENT_ID: 'fi-client-2',
  VITE_WALLET_OWNER_USER_ID: 'KYC-1234',
  VITE_WALLET_SECONDARY_USER_ID: 'KYC-5678',
};

const content = `${Object.entries(env)
  .map(([key, value]) => `${key}=${value}`)
  .join('\n')}\n`;

writeFileSync('.env', content, 'utf8');
