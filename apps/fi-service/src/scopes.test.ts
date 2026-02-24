import { describe, expect, it, vi } from 'vitest';
import { requireScopes } from '@bharat/common';
import { fiServiceScopes } from './scopes.js';

function createResponseMock() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('fi-service scope enforcement', () => {
  it('rejects request without kyc.verify scope', () => {
    const middleware = requireScopes([...fiServiceScopes.kycVerify]);
    const req = {
      oidc: {
        token: 't',
        payload: {},
        scopes: ['kyc.request'],
      },
    };
    const res = createResponseMock();
    const next = vi.fn();

    middleware(req as never, res as never, next);

    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
