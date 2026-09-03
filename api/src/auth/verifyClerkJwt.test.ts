import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `jose` does its own real crypto/JWKS-fetch testing upstream — this suite verifies the wrapping
// logic (header parsing, issuer config, failure-to-null mapping) against a mocked `jwtVerify`,
// not real signature verification.
const verifyTokenMock = vi.fn();
vi.mock('@clerk/backend', () => ({
  verifyToken: (...args: unknown[]) => verifyTokenMock(...args),
}));

const { verifyClerkJwt, __resetJwksCache } = await import('./verifyClerkJwt.js');

describe('verifyClerkJwt', () => {
  beforeEach(() => {
    verifyTokenMock.mockReset();
    __resetJwksCache();
    process.env.CLERK_SECRET_KEY = 'sk_test_fake';
  });

  afterEach(() => {
    delete process.env.CLERK_SECRET_KEY;
  });

  it('returns null with no Authorization header', async () => {
    expect(await verifyClerkJwt(null)).toBeNull();
    expect(await verifyClerkJwt(undefined)).toBeNull();
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  it('returns null for a non-Bearer header', async () => {
    expect(await verifyClerkJwt('Basic abc123')).toBeNull();
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  it('returns null for an empty bearer token', async () => {
    expect(await verifyClerkJwt('Bearer ')).toBeNull();
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  it('returns the verified userId for a valid token', async () => {
    verifyTokenMock.mockResolvedValue({ sub: 'user_123' });
    const result = await verifyClerkJwt('Bearer a.b.c');
    expect(result).toEqual({ userId: 'user_123' });
  });

  it('returns null when Clerk token verification rejects', async () => {
    verifyTokenMock.mockRejectedValue(new Error('signature verification failed'));
    expect(await verifyClerkJwt('Bearer a.b.c')).toBeNull();
  });

  it('returns null when the payload has no usable sub claim', async () => {
    verifyTokenMock.mockResolvedValue({});
    expect(await verifyClerkJwt('Bearer a.b.c')).toBeNull();
  });

  it('throws when CLERK_SECRET_KEY is not configured', async () => {
    delete process.env.CLERK_SECRET_KEY;
    await expect(verifyClerkJwt('Bearer a.b.c')).rejects.toThrow('CLERK_SECRET_KEY');
  });
});
