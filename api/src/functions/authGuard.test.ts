import { describe, expect, it, vi } from 'vitest';
import type { HttpRequest } from '@azure/functions';

const verifyClerkJwtDetailedMock = vi.fn();
vi.mock('../auth/verifyClerkJwt.js', () => ({
  verifyClerkJwtDetailed: (...args: unknown[]) => verifyClerkJwtDetailedMock(...args),
}));

const { requireUser } = await import('./authGuard.js');

function requestWithAuth(headersOrAuthorization: string | null | Record<string, string | null | undefined>): HttpRequest {
  if (typeof headersOrAuthorization === 'string' || headersOrAuthorization === null) {
    return {
      headers: {
        get: (name: string) => (name.toLowerCase() === 'authorization' ? headersOrAuthorization : null),
      },
    } as unknown as HttpRequest;
  }
  const lowerMap = new Map<string, string | null>();
  for (const [key, value] of Object.entries(headersOrAuthorization)) {
    lowerMap.set(key.toLowerCase(), value ?? null);
  }
  return {
    headers: {
      get: (name: string) => lowerMap.get(name.toLowerCase()) ?? null,
    },
  } as unknown as HttpRequest;
}

describe('requireUser', () => {
  it('returns ok:true with the verified user on a valid token', async () => {
    verifyClerkJwtDetailedMock.mockResolvedValue({ user: { userId: 'user_1' } });
    const result = await requireUser(requestWithAuth('Bearer abc'));
    expect(result).toEqual({ ok: true, user: { userId: 'user_1' } });
  });

  it('accepts token from x-clerk-authorization header', async () => {
    verifyClerkJwtDetailedMock.mockResolvedValue({ user: { userId: 'user_clerk' } });
    const result = await requireUser(requestWithAuth({ 'x-clerk-authorization': 'Bearer token-clerk' }));
    expect(result).toEqual({ ok: true, user: { userId: 'user_clerk' } });
    expect(verifyClerkJwtDetailedMock).toHaveBeenCalledWith('Bearer token-clerk');
  });

  it('accepts token from x-authorization header', async () => {
    verifyClerkJwtDetailedMock.mockResolvedValue({ user: { userId: 'user_alt' } });
    const result = await requireUser(requestWithAuth({ 'x-authorization': 'Bearer token-alt' }));
    expect(result).toEqual({ ok: true, user: { userId: 'user_alt' } });
    expect(verifyClerkJwtDetailedMock).toHaveBeenCalledWith('Bearer token-alt');
  });

  it('prioritizes x-clerk-authorization over standard authorization header', async () => {
    verifyClerkJwtDetailedMock.mockResolvedValue({ user: { userId: 'user_real' } });
    const result = await requireUser(requestWithAuth({
      authorization: 'Bearer swa-platform-hs256',
      'x-clerk-authorization': 'Bearer clerk-user-rs256',
    }));
    expect(result).toEqual({ ok: true, user: { userId: 'user_real' } });
    expect(verifyClerkJwtDetailedMock).toHaveBeenCalledWith('Bearer clerk-user-rs256');
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

  it('computes token_rejected authStage and preserves authReason when custom header rejects', async () => {
    verifyClerkJwtDetailedMock.mockResolvedValue({
      user: null,
      failure: 'alg_not_allowed',
      detail: 'JOSENotSupported:ERR_JOSE_NOT_SUPPORTED',
    });
    const result = await requireUser(requestWithAuth({ 'x-clerk-authorization': 'Bearer bad-alg' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(result.response.jsonBody).toMatchObject({
        code: 'unauthenticated',
        authStage: 'token_rejected',
        authReason: 'alg_not_allowed',
        authDetail: 'JOSENotSupported:ERR_JOSE_NOT_SUPPORTED',
      });
    }
  });
});
