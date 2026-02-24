import { describe, expect, it, vi } from 'vitest';
import { requireScopes } from '@bharat/common';
import { walletServiceScopes } from './scopes.js';

function createResponseMock() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('wallet-service scope enforcement', () => {
  it('rejects request without consent.read scope', () => {
    const middleware = requireScopes([...walletServiceScopes.consentRead]);
    const req = {
      oidc: {
        token: 't',
        payload: {},
        scopes: ['token.read'],
      },
    };
    const res = createResponseMock();
    const next = vi.fn();

    middleware(req as never, res as never, next);

    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
