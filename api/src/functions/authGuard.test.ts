import { describe, expect, it, vi } from 'vitest';
import type { HttpRequest } from '@azure/functions';

const verifyClerkJwtDetailedMock = vi.fn();
vi.mock('../auth/verifyClerkJwt.js', () => ({
  verifyClerkJwtDetailed: (...args: unknown[]) => verifyClerkJwtDetailedMock(...args),
}));

const { requireUser } = await import('./authGuard.js');

function requestWithAuth(header: string | null): HttpRequest {
  return { headers: { get: () => header } } as unknown as HttpRequest;
}

describe('requireUser', () => {
  it('returns ok:true with the verified user on a valid token', async () => {
    verifyClerkJwtDetailedMock.mockResolvedValue({ user: { userId: 'user_1' } });
    const result = await requireUser(requestWithAuth('Bearer abc'));
    expect(result).toEqual({ ok: true, user: { userId: 'user_1' } });
  });

  it('returns a 401 ApiError envelope when verification fails', async () => {
    verifyClerkJwtDetailedMock.mockResolvedValue({ user: null, failure: 'header_missing' });
    const result = await requireUser(requestWithAuth(null));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(result.response.jsonBody).toMatchObject({ code: 'unauthenticated' });
      expect(result.response.jsonBody).toMatchObject({ authStage: 'header_missing' });
    }
  });

  it('identifies a bearer header whose JWT was rejected', async () => {
    verifyClerkJwtDetailedMock.mockResolvedValue({ user: null, failure: 'signature_invalid' });
    const result = await requireUser(requestWithAuth('Bearer rejected'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.jsonBody).toMatchObject({
        code: 'unauthenticated',
        authStage: 'token_rejected',
        authReason: 'signature_invalid',
      });
    }
  });
});
