import { describe, expect, it, vi } from 'vitest';
import { requireScopes } from '@bharat/common';
import { issuerServiceScopes } from './scopes.js';

function createResponseMock() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('issuer-service scope enforcement', () => {
  it('rejects request without token.issue scope', () => {
    const middleware = requireScopes([...issuerServiceScopes.issue]);
    const req = {
      oidc: {
        token: 't',
        payload: {},
        scopes: ['token.revoke'],
      },
    };
    const res = createResponseMock();
    const next = vi.fn();

    middleware(req as never, res as never, next);

    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
