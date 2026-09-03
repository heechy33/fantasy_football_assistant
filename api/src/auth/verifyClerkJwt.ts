import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Verifies the Bearer token on an authenticated `/api/*` request. SWA's role system stays
 * `["anonymous","authenticated"]` for every route (CLAUDE.md) — the JWT check here, not SWA, is
 * the actual enforcement point, since auth moved to Clerk (DECISIONS.md, 2026-08-25/26) and SWA's
 * built-in `/.auth/*` is no longer wired.
 *
 * `createRemoteJWKSet` caches Clerk's public keys itself (refetching on a `kid` miss, rate-limited
 * internally) — no separate cache needed here.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }
  return jwks;
}

function requireIssuer(): string {
  const issuer = process.env.CLERK_ISSUER?.trim().replace(/\/+$/, '');
  if (!issuer) throw new Error('CLERK_ISSUER app setting is not configured.');
  return issuer;
}

export interface VerifiedUser {
  /** Clerk's `sub` claim — the stable subject id stored as `UserRecord.userId` (shared/types.d.ts). */
  userId: string;
}

/**
 * Returns the verified user, or `null` when the *token itself* fails verification (missing
 * header, expired/invalid/wrong-issuer, malformed). Callers translate `null` into
 * `ApiError.code: 'unauthenticated'` — a bad token is never thrown past this boundary, since a
 * Function handler's job there is a clean 401, not a 500.
 *
 * A missing `CLERK_ISSUER` app setting is different: that's a deploy misconfiguration, not
 * something about the caller's token, so `requireIssuer()` runs OUTSIDE the try/catch below and
 * throws a real error (surfacing as a 500 in the Functions logs) instead of silently degrading
 * into "every request looks unauthenticated," which would be much harder to diagnose.
 */
export async function verifyClerkJwt(authorizationHeader: string | null | undefined): Promise<VerifiedUser | null> {
  if (!authorizationHeader?.startsWith('Bearer ')) return null;
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  const issuer = requireIssuer();
  try {
    const { payload } = await jwtVerify(token, getJwks(issuer), { issuer });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    return { userId: payload.sub };
  } catch (error) {
    // Keep the client-facing response deliberately generic, but leave a safe diagnostic for
    // Application Insights. This distinguishes an issuer mismatch, a missing JWKS key, and a
    // network/signature failure without ever logging the bearer token itself.
    console.error('Clerk JWT verification failed.', {
      issuer,
      reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return null;
  }
}

/** Test-only: forces the next call to re-resolve the JWKS (e.g. after stubbing CLERK_ISSUER). */
export function __resetJwksCache(): void {
  jwks = null;
}
