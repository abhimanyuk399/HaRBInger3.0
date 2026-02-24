export interface RegistryTokenRecordInput {
  tokenId: string;
  issuerId: string;
  userRefHash: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface RegistryStatusInput {
  status: 'REVOKED' | 'SUPERSEDED' | 'EXPIRED';
  supersededBy?: string;
  reason?: string;
}

export interface RegistryClientOptions {
  registryUrl: string;
  keycloakIssuerUrl: string;
  keycloakTokenUrl?: string;
  clientId: string;
  clientSecret: string;
}

export class RegistryClient {
  constructor(private readonly options: RegistryClientOptions) {}

  private get tokenUrl() {
    if (this.options.keycloakTokenUrl) {
      return this.options.keycloakTokenUrl;
    }
    return `${this.options.keycloakIssuerUrl.replace(/\/$/, '')}/protocol/openid-connect/token`;
  }

  private async getServiceToken(scope: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      scope,
    });

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`keycloak_token_error:${response.status}:${text}`);
    }

    const payload = (await response.json()) as { access_token?: string };
    if (!payload.access_token) {
      throw new Error('keycloak_token_error:missing_access_token');
    }

    return payload.access_token;
  }

  async createToken(record: RegistryTokenRecordInput): Promise<void> {
    const token = await this.getServiceToken('token.issue');
    const response = await fetch(`${this.options.registryUrl}/v1/internal/registry/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tokenId: record.tokenId,
        issuerId: record.issuerId,
        userRefHash: record.userRefHash,
        issuedAt: record.issuedAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`registry_create_error:${response.status}:${text}`);
    }
  }

  async updateTokenStatus(tokenId: string, payload: RegistryStatusInput): Promise<void> {
    const token = await this.getServiceToken('token.revoke');
    const response = await fetch(`${this.options.registryUrl}/v1/internal/registry/token/${tokenId}/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`registry_status_error:${response.status}:${text}`);
    }
  }
}
