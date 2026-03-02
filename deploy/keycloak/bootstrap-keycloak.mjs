const baseUrl = process.env.KEYCLOAK_BASE_URL ?? 'http://keycloak:8080';
const realm = process.env.KEYCLOAK_REALM ?? 'bharat-kyc-dev';
const adminUser = process.env.KEYCLOAK_ADMIN ?? 'admin';
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';
const walletOwnerUser = process.env.KEYCLOAK_WALLET_OWNER_USER ?? 'wallet-owner-1';
const walletOwnerPassword = process.env.KEYCLOAK_WALLET_OWNER_PASSWORD ?? 'wallet-owner-1-pass';
const nomineeUser = process.env.KEYCLOAK_NOMINEE_USER ?? 'wallet-nominee-1';
const nomineePassword = process.env.KEYCLOAK_NOMINEE_PASSWORD ?? 'wallet-nominee-1-pass';
const fiUser1 = process.env.KEYCLOAK_FI_USER_1 ?? 'fi-analyst-1';
const fiPassword1 = process.env.KEYCLOAK_FI_PASSWORD_1 ?? 'fi-analyst-1-pass';
const fiUser2 = process.env.KEYCLOAK_FI_USER_2 ?? 'fi-analyst-2';
const fiPassword2 = process.env.KEYCLOAK_FI_PASSWORD_2 ?? 'fi-analyst-2-pass';
const walletOwnerUserId = process.env.KEYCLOAK_WALLET_OWNER_USER_ID ?? process.env.VITE_WALLET_OWNER_USER_ID ?? 'wallet-owner-1';
const walletNomineeUserId = process.env.KEYCLOAK_WALLET_NOMINEE_USER_ID ?? nomineeUser;
const fiServiceClientId = process.env.KEYCLOAK_FI_CLIENT_ID ?? 'fi-client';
const fiServiceClientSecret = process.env.KEYCLOAK_FI_CLIENT_SECRET ?? 'fi-client-secret';
const fiBrowserClientId = process.env.KEYCLOAK_FI_BROWSER_CLIENT_ID ?? 'fi-browser-client';
const fi2ClientId = process.env.KEYCLOAK_FI2_CLIENT_ID ?? 'fi-client-2';
const fi2ClientSecret = process.env.KEYCLOAK_FI2_CLIENT_SECRET ?? 'fi-client-2-secret';

const requiredRedirectUris = [
  'http://localhost:5173/*',
  'http://localhost:5173/',
  'http://localhost:5173/console',
  'http://localhost:5173/fi/*',
  'http://localhost:5173/wallet/*',
  'http://bharat-kyc.local:8081/*',
  'http://bharat-kyc.local:8081/',
  'http://bharat-kyc.local:8081/console',
  'http://bharat-kyc.local:8081/fi/*',
  'http://bharat-kyc.local:8081/wallet/*',
];
const requiredWebOrigins = ['http://localhost:5173', 'http://bharat-kyc.local:8081'];

const defaultWalletClientScopes = [
  'profile',
  'email',
  'roles',
  'web-origins',
  'consent.read',
  'consent.approve',
  'token.read',
  'kyc.request',
  'kyc.verify',
  'token.issue',
  'token.revoke',
];

const defaultFiClientScopes = ['profile', 'email', 'roles', 'web-origins', 'kyc.request', 'kyc.verify'];
const optionalClientScopes = ['offline_access', 'microprofile-jwt'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sameStringSet(left, right) {
  const a = [...left].sort();
  const b = [...right].sort();
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function asStringSet(values) {
  return Array.isArray(values) ? values.map((item) => String(item)) : [];
}

function asProtocolMapperSignatureSet(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const mapper = item;
      const name = String(mapper.name ?? '').trim();
      const protocol = String(mapper.protocol ?? '').trim();
      const protocolMapper = String(mapper.protocolMapper ?? '').trim();
      const claimName = String(mapper.config?.['claim.name'] ?? '').trim();
      const userAttribute = String(mapper.config?.['user.attribute'] ?? '').trim();
      return `${name}|${protocol}|${protocolMapper}|${claimName}|${userAttribute}`;
    })
    .filter(Boolean);
}

function preferredUsernameMapper() {
  return {
    name: 'preferred_username',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-property-mapper',
    consentRequired: false,
    config: {
      'user.attribute': 'username',
      'claim.name': 'preferred_username',
      'jsonType.label': 'String',
      'access.token.claim': 'true',
      'id.token.claim': 'true',
      'userinfo.token.claim': 'true',
    },
  };
}

function userIdMapper() {
  return {
    name: 'user_id',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-attribute-mapper',
    consentRequired: false,
    config: {
      'user.attribute': 'user_id',
      'claim.name': 'user_id',
      'jsonType.label': 'String',
      'access.token.claim': 'true',
      'id.token.claim': 'true',
      'userinfo.token.claim': 'true',
    },
  };
}

async function waitForRealm(maxAttempts = 90) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/realms/${encodeURIComponent(realm)}`);
      if (response.ok) {
        console.log(`[keycloak-bootstrap] realm ${realm} is ready`);
        return;
      }
    } catch {
      // keep waiting
    }
    console.log(`[keycloak-bootstrap] waiting for realm ${realm} (${attempt}/${maxAttempts})`);
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for Keycloak realm ${realm}`);
}

async function getAdminToken() {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: adminUser,
    password: adminPassword,
  });

  const response = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = {};
  }

  if (!response.ok || !payload.access_token) {
    throw new Error(`Failed to obtain admin token (${response.status}): ${text}`);
  }

  return payload.access_token;
}

async function waitForAdminToken(maxAttempts = 60) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await getAdminToken();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[keycloak-bootstrap] waiting for master admin login (${attempt}/${maxAttempts}): ${message}`);
      await sleep(2000);
    }
  }
  throw new Error('Timed out waiting for Keycloak admin user availability');
}

async function kcRequest(token, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const expectedStatuses = options.expectedStatuses ?? [200];
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`Keycloak API ${path} failed (${response.status}): ${text}`);
  }

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function findClient(token, clientId) {
  const clients = await kcRequest(
    token,
    `/admin/realms/${encodeURIComponent(realm)}/clients?clientId=${encodeURIComponent(clientId)}`
  );

  if (!Array.isArray(clients) || clients.length === 0) {
    return null;
  }

  return clients[0];
}

function clientConfigDiffers(current, target) {
  if (Boolean(current.publicClient) !== Boolean(target.publicClient)) return true;
  if (Boolean(current.standardFlowEnabled) !== Boolean(target.standardFlowEnabled)) return true;
  if (Boolean(current.implicitFlowEnabled) !== Boolean(target.implicitFlowEnabled)) return true;
  if (Boolean(current.directAccessGrantsEnabled) !== Boolean(target.directAccessGrantsEnabled)) return true;
  if (Boolean(current.serviceAccountsEnabled) !== Boolean(target.serviceAccountsEnabled)) return true;
  if (!sameStringSet(asStringSet(current.redirectUris), asStringSet(target.redirectUris))) return true;
  if (!sameStringSet(asStringSet(current.webOrigins), asStringSet(target.webOrigins))) return true;
  if (!sameStringSet(asStringSet(current.defaultClientScopes), asStringSet(target.defaultClientScopes))) return true;
  if (!sameStringSet(asStringSet(current.optionalClientScopes), asStringSet(target.optionalClientScopes))) return true;
  if (
    !sameStringSet(
      asProtocolMapperSignatureSet(current.protocolMappers),
      asProtocolMapperSignatureSet(target.protocolMappers)
    )
  ) {
    return true;
  }

  const currentPkce = current.attributes?.['pkce.code.challenge.method'] ?? null;
  const targetPkce = target.attributes?.['pkce.code.challenge.method'] ?? null;
  if (currentPkce !== targetPkce) return true;

  if (!target.publicClient && typeof target.secret === 'string' && target.secret.length > 0) {
    if ((current.secret ?? '') !== target.secret) return true;
  }

  return false;
}

async function ensureClient(token, clientId, targetConfig, logName) {
  const existing = await findClient(token, clientId);
  if (!existing) {
    await kcRequest(token, `/admin/realms/${encodeURIComponent(realm)}/clients`, {
      method: 'POST',
      expectedStatuses: [201],
      body: targetConfig,
    });
    console.log(`[keycloak-bootstrap] ${logName} created`);
    return;
  }

  if (!clientConfigDiffers(existing, targetConfig)) {
    console.log(`[keycloak-bootstrap] ${logName} already configured`);
    return;
  }

  await kcRequest(
    token,
    `/admin/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(existing.id)}`,
    {
      method: 'PUT',
      expectedStatuses: [204],
      body: targetConfig,
    }
  );

  console.log(`[keycloak-bootstrap] ${logName} updated`);
}

function walletClientConfig() {
  return {
    clientId: 'wallet-client',
    name: 'Wallet Web Client',
    description: 'Public client for wallet web-ui auth-code flow',
    enabled: true,
    protocol: 'openid-connect',
    publicClient: true,
    secret: '',
    redirectUris: unique(requiredRedirectUris),
    webOrigins: unique(requiredWebOrigins),
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: true,
    serviceAccountsEnabled: false,
    attributes: {
      'pkce.code.challenge.method': 'S256',
    },
    defaultClientScopes: unique(defaultWalletClientScopes),
    optionalClientScopes: unique(optionalClientScopes),
    protocolMappers: [preferredUsernameMapper(), userIdMapper()],
  };
}

function fiBrowserClientConfig() {
  return {
    clientId: fiBrowserClientId,
    name: 'FI Web Client',
    description: 'Public FI browser client for auth-code flow with PKCE',
    enabled: true,
    protocol: 'openid-connect',
    publicClient: true,
    secret: '',
    redirectUris: unique(requiredRedirectUris),
    webOrigins: unique(requiredWebOrigins),
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: true,
    serviceAccountsEnabled: false,
    attributes: {
      'pkce.code.challenge.method': 'S256',
    },
    defaultClientScopes: unique(defaultFiClientScopes),
    optionalClientScopes: unique(optionalClientScopes),
    protocolMappers: [preferredUsernameMapper(), userIdMapper()],
  };
}

function fiServiceClientConfig() {
  return {
    clientId: fiServiceClientId,
    name: 'FI Service Client',
    description: 'Confidential FI client for service client-credentials flow',
    enabled: true,
    protocol: 'openid-connect',
    publicClient: false,
    secret: fiServiceClientSecret,
    redirectUris: [],
    webOrigins: [],
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
    defaultClientScopes: unique(defaultFiClientScopes),
    optionalClientScopes: unique(optionalClientScopes),
  };
}

function fi2ServiceClientConfig() {
  return {
    clientId: fi2ClientId,
    name: 'FI Service Client #2',
    description: 'Second confidential FI client for token reuse branch',
    enabled: true,
    protocol: 'openid-connect',
    publicClient: false,
    secret: fi2ClientSecret,
    redirectUris: [],
    webOrigins: [],
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
    defaultClientScopes: unique(defaultFiClientScopes),
    optionalClientScopes: unique(optionalClientScopes),
  };
}

async function ensureUser(token, input) {
  const userName = input.username;
  const password = input.password;
  const firstName = input.firstName;
  const lastName = input.lastName;
  const email = input.email;
  const userId =
    typeof input.userId === 'string' && input.userId.trim().length > 0
      ? input.userId.trim()
      : null;
  const attributes = userId ? { user_id: [userId] } : undefined;
  const query =
    `/admin/realms/${encodeURIComponent(realm)}/users?username=` + `${encodeURIComponent(userName)}&exact=true`;

  let users = await kcRequest(token, query);

  if (!Array.isArray(users) || users.length === 0) {
    await kcRequest(token, `/admin/realms/${encodeURIComponent(realm)}/users`, {
      method: 'POST',
      expectedStatuses: [201],
      body: {
        username: userName,
        enabled: true,
        emailVerified: true,
        firstName,
        lastName,
        email,
        ...(attributes ? { attributes } : {}),
      },
    });

    users = await kcRequest(token, query);
    if (!Array.isArray(users) || users.length === 0) {
      throw new Error(`Failed to create user ${userName}`);
    }
    console.log(`[keycloak-bootstrap] created user ${userName}`);
  } else {
    console.log(`[keycloak-bootstrap] user ${userName} already exists`);
  }

  const user = users[0];
  await kcRequest(
    token,
    `/admin/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(user.id)}/reset-password`,
    {
      method: 'PUT',
      expectedStatuses: [204],
      body: {
        type: 'password',
        temporary: false,
        value: password,
      },
    }
  );

  await kcRequest(token, `/admin/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(user.id)}`, {
    method: 'PUT',
    expectedStatuses: [204],
    body: {
      requiredActions: [],
      enabled: true,
      firstName,
      lastName,
      email,
      ...(attributes ? { attributes } : {}),
    },
  });

  console.log(`[keycloak-bootstrap] user ${userName} password reset`);
  return user;
}

async function ensureRealmRole(token, roleName, description) {
  const existing = await kcRequest(
    token,
    `/admin/realms/${encodeURIComponent(realm)}/roles/${encodeURIComponent(roleName)}`,
    {
      expectedStatuses: [200, 404],
    }
  );

  if (existing && typeof existing === 'object' && !Array.isArray(existing) && existing.name === roleName) {
    console.log(`[keycloak-bootstrap] realm role ${roleName} already exists`);
    return existing;
  }

  await kcRequest(token, `/admin/realms/${encodeURIComponent(realm)}/roles`, {
    method: 'POST',
    expectedStatuses: [201, 409],
    body: {
      name: roleName,
      description,
    },
  });

  const created = await kcRequest(
    token,
    `/admin/realms/${encodeURIComponent(realm)}/roles/${encodeURIComponent(roleName)}`
  );
  console.log(`[keycloak-bootstrap] realm role ${roleName} ensured`);
  return created;
}

async function assignRealmRoles(token, userId, roleRepresentations) {
  const current = await kcRequest(
    token,
    `/admin/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/role-mappings/realm`
  );
  const currentNames = new Set(
    Array.isArray(current) ? current.map((role) => (role && typeof role === 'object' ? role.name : null)).filter(Boolean) : []
  );
  const missing = roleRepresentations.filter((role) => role?.name && !currentNames.has(role.name));
  if (missing.length === 0) {
    return;
  }
  await kcRequest(
    token,
    `/admin/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/role-mappings/realm`,
    {
      method: 'POST',
      expectedStatuses: [204],
      body: missing,
    }
  );
  console.log(
    `[keycloak-bootstrap] assigned realm roles [${missing.map((role) => role.name).join(', ')}] to user ${userId}`
  );
}

async function main() {
  await waitForRealm();
  const adminToken = await waitForAdminToken();

  await ensureClient(adminToken, 'wallet-client', walletClientConfig(), 'wallet-client');
  await ensureClient(adminToken, fiBrowserClientId, fiBrowserClientConfig(), `${fiBrowserClientId} browser-client`);
  await ensureClient(adminToken, fiServiceClientId, fiServiceClientConfig(), `${fiServiceClientId} service-client`);
  await ensureClient(adminToken, fi2ClientId, fi2ServiceClientConfig(), `${fi2ClientId} service-client`);

  const walletOwner = await ensureUser(adminToken, {
    username: walletOwnerUser,
    password: walletOwnerPassword,
    firstName: 'Wallet',
    lastName: 'Owner',
    email: `${walletOwnerUser}@example.local`,
    userId: walletOwnerUserId,
  });
  const walletNominee = await ensureUser(adminToken, {
    username: nomineeUser,
    password: nomineePassword,
    firstName: 'Wallet',
    lastName: 'Nominee',
    email: `${nomineeUser}@example.local`,
    userId: walletNomineeUserId,
  });
  const fiAnalyst1 = await ensureUser(adminToken, {
    username: fiUser1,
    password: fiPassword1,
    firstName: 'FI',
    lastName: 'Analyst One',
    email: `${fiUser1}@example.local`,
  });
  const fiAnalyst2 = await ensureUser(adminToken, {
    username: fiUser2,
    password: fiPassword2,
    firstName: 'FI',
    lastName: 'Analyst Two',
    email: `${fiUser2}@example.local`,
  });

  const walletUserRole = await ensureRealmRole(adminToken, 'wallet_user', 'Wallet owner access');
  const walletNomineeRole = await ensureRealmRole(adminToken, 'wallet_nominee', 'Wallet nominee delegation access');
  const fiUserRole = await ensureRealmRole(adminToken, 'fi_user', 'FI portal access');
  const adminRole = await ensureRealmRole(adminToken, 'admin', 'Command Centre admin access');

  await assignRealmRoles(adminToken, walletOwner.id, [walletUserRole, adminRole]);
  await assignRealmRoles(adminToken, walletNominee.id, [walletNomineeRole]);
  await assignRealmRoles(adminToken, fiAnalyst1.id, [fiUserRole]);
  await assignRealmRoles(adminToken, fiAnalyst2.id, [fiUserRole]);

  console.log('[keycloak-bootstrap] complete');
}

main().catch((error) => {
  console.error('[keycloak-bootstrap] failed:', error);
  process.exitCode = 1;
});
