import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `jose` does its own real crypto/JWKS-fetch testing upstream — this suite verifies the wrapping
// logic (header parsing, issuer config, failure-to-null mapping) against a mocked `jwtVerify`,
// not real signature verification.
const createRemoteJWKSetMock = vi.fn(() => 'jwks');
const decodeProtectedHeaderMock = vi.fn();
const jwtVerifyMock = vi.fn();
vi.mock('jose', () => ({
  createRemoteJWKSet: (...args: unknown[]) => createRemoteJWKSetMock(...args),
  decodeProtectedHeader: (...args: unknown[]) => decodeProtectedHeaderMock(...args),
  jwtVerify: (...args: unknown[]) => jwtVerifyMock(...args),
}));

const { verifyClerkJwt, verifyClerkJwtDetailed, __resetJwksCache } = await import('./verifyClerkJwt.js');

describe('verifyClerkJwt', () => {
  beforeEach(() => {
    createRemoteJWKSetMock.mockClear();
    decodeProtectedHeaderMock.mockReset();
    jwtVerifyMock.mockReset();
    __resetJwksCache();
    process.env.CLERK_ISSUER = 'https://clerk.example.com';
  });

  afterEach(() => {
    delete process.env.CLERK_ISSUER;
  });

  it('returns null with no Authorization header', async () => {
    expect(await verifyClerkJwt(null)).toBeNull();
    expect(await verifyClerkJwt(undefined)).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('returns null for a non-Bearer header', async () => {
    expect(await verifyClerkJwt('Basic abc123')).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('returns null for an empty bearer token', async () => {
    expect(await verifyClerkJwt('Bearer ')).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('returns the verified userId for a valid token', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'user_123' } });
    const result = await verifyClerkJwt('Bearer a.b.c');
    expect(result).toEqual({ userId: 'user_123' });
  });

  it('uses the configured issuer JWKS for a custom Clerk domain', async () => {
    process.env.CLERK_ISSUER = 'https://clerk.example.com';
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 'user_custom' } });

    await expect(verifyClerkJwt('Bearer a.b.c')).resolves.toEqual({ userId: 'user_custom' });
    expect(createRemoteJWKSetMock).toHaveBeenCalledWith(
      new URL('https://clerk.example.com/.well-known/jwks.json'),
    );
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      'a.b.c',
      'jwks',
      { issuer: 'https://clerk.example.com' },
    );
    expect(jwtVerifyMock).toHaveBeenCalled();
  });

  it('returns null when Clerk token verification rejects', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('signature verification failed'));
    expect(await verifyClerkJwt('Bearer a.b.c')).toBeNull();
  });

  it('classifies algorithm failures and reports only the safe token header fields', async () => {
    const error = Object.assign(new Error('algorithm rejected'), {
      name: 'JOSEAlgNotAllowed',
      code: 'ERR_JOSE_ALG_NOT_ALLOWED',
    });
    jwtVerifyMock.mockRejectedValue(error);
    decodeProtectedHeaderMock.mockReturnValue({ alg: 'HS256', kid: 'kid_123', typ: 'JWT' });

    await expect(verifyClerkJwtDetailed('Bearer a.b.c')).resolves.toMatchObject({
      user: null,
      failure: 'alg_not_allowed',
      detail: expect.stringContaining('tokenHeader:' + JSON.stringify({ alg: 'HS256', kid: 'kid_123' })),
    });
  });

  it('classifies unsupported algorithm errors (e.g. HS256 against JWKS) as alg_not_allowed', async () => {
    const error = Object.assign(new Error('unsupported algorithm'), {
      name: 'JOSENotSupported',
      code: 'ERR_JOSE_NOT_SUPPORTED',
    });
    jwtVerifyMock.mockRejectedValue(error);
    decodeProtectedHeaderMock.mockReturnValue({ alg: 'HS256' });

    await expect(verifyClerkJwtDetailed('Bearer a.b.c')).resolves.toMatchObject({
      user: null,
      failure: 'alg_not_allowed',
      detail: expect.stringContaining('tokenHeader:' + JSON.stringify({ alg: 'HS256' })),
    });
  });

  it('returns null when the payload has no usable sub claim', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: {} });
    expect(await verifyClerkJwt('Bearer a.b.c')).toBeNull();
  });

  it('throws when CLERK_ISSUER is not configured', async () => {
    delete process.env.CLERK_ISSUER;
    await expect(verifyClerkJwt('Bearer a.b.c')).rejects.toThrow('CLERK_ISSUER');
  });
});
