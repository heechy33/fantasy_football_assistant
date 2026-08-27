import { describe, expect, it, vi } from 'vitest';
import type { HttpRequest } from '@azure/functions';

const verifyClerkJwtMock = vi.fn();
vi.mock('../auth/verifyClerkJwt.js', () => ({ verifyClerkJwt: (...args: unknown[]) => verifyClerkJwtMock(...args) }));

const { requireUser } = await import('./authGuard.js');

function requestWithAuth(header: string | null): HttpRequest {
  return { headers: { get: () => header } } as unknown as HttpRequest;
}

describe('requireUser', () => {
  it('returns ok:true with the verified user on a valid token', async () => {
    verifyClerkJwtMock.mockResolvedValue({ userId: 'user_1' });
    const result = await requireUser(requestWithAuth('Bearer abc'));
    expect(result).toEqual({ ok: true, user: { userId: 'user_1' } });
  });

  it('returns a 401 ApiError envelope when verification fails', async () => {
    verifyClerkJwtMock.mockResolvedValue(null);
    const result = await requireUser(requestWithAuth(null));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(result.response.jsonBody).toMatchObject({ code: 'unauthenticated' });
    }
  });
});
