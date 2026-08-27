import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `jose` does its own real crypto/JWKS-fetch testing upstream — this suite verifies the wrapping
// logic (header parsing, issuer config, failure-to-null mapping) against a mocked `jwtVerify`,
// not real signature verification.
const jwtVerifyMock = vi.fn();
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'mock-jwks'),
  jwtVerify: (...args: unknown[]) => jwtVerifyMock(...args),
}));

const { verifyClerkJwt, __resetJwksCache } = await import('./verifyClerkJwt.js');

describe('verifyClerkJwt', () => {
  beforeEach(() => {
    jwtVerifyMock.mockReset();
    __resetJwksCache();
    process.env.CLERK_ISSUER = 'https://test.clerk.accounts.dev';
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

  it('returns null when jwtVerify rejects (expired/invalid/wrong issuer)', async () => {
    jwtVerifyMock.mockRejectedValue(new Error('signature verification failed'));
    expect(await verifyClerkJwt('Bearer a.b.c')).toBeNull();
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
