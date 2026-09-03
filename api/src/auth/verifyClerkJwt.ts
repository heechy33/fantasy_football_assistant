import { verifyToken } from '@clerk/backend';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/**
 * Verifies the Bearer token on an authenticated `/api/*` request. SWA's role system stays
 * `["anonymous","authenticated"]` for every route (CLAUDE.md) — the JWT check here, not SWA, is
 * the actual enforcement point, since auth moved to Clerk (DECISIONS.md, 2026-08-25/26) and SWA's
 * built-in `/.auth/*` is no longer wired.
 *
 * `createRemoteJWKSet` caches Clerk's public keys itself (refetching on a `kid` miss, rate-limited
 * internally) — no separate cache needed here.
 */
function requireSecretKey(): string {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) throw new Error('CLERK_SECRET_KEY app setting is not configured.');
  return secretKey;
}

function requireIssuer(): string {
  const issuer = process.env.CLERK_ISSUER?.trim();
  if (!issuer) throw new Error('CLERK_ISSUER app setting is not configured.');
  try {
    const parsed = new URL(issuer);
    if (parsed.protocol !== 'https:') throw new Error('issuer must use HTTPS');
    return parsed.toString().endsWith('/') ? parsed.toString().slice(0, -1) : parsed.toString();
  } catch {
    throw new Error('CLERK_ISSUER app setting is not a valid HTTPS URL.');
  }
}

let cachedIssuer = '';
let cachedJwks: JWTVerifyGetKey | null = null;

function remoteJwksFor(issuer: string): JWTVerifyGetKey {
  if (cachedJwks && cachedIssuer === issuer) return cachedJwks;
  cachedIssuer = issuer;
  cachedJwks = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks.json'));
  return cachedJwks;
}

export interface VerifiedUser {
  /** Clerk's `sub` claim — the stable subject id stored as `UserRecord.userId` (shared/types.d.ts). */
  userId: string;
}

export type JwtVerificationFailure =
  | 'header_missing'
  | 'token_expired'
  | 'claims_invalid'
  | 'jwks_key_not_found'
  | 'signature_invalid'
  | 'jwks_unavailable'
  | 'verification_failed';

export interface JwtVerificationResult {
  user: VerifiedUser | null;
  failure?: JwtVerificationFailure;
  /** Safe JOSE class/code only; intentionally excludes the error message and token. */
  detail?: string;
}

function describeVerificationError(error: unknown): string | undefined {
  const record = typeof error === 'object' && error !== null
    ? error as { code?: unknown; name?: unknown }
    : {};
  const code = typeof record.code === 'string' ? record.code : '';
  const name = typeof record.name === 'string' ? record.name : '';
  const detail = [name, code].filter(Boolean).join(':');
  return detail || undefined;
}

function classifyVerificationFailure(error: unknown): JwtVerificationFailure {
  const record = typeof error === 'object' && error !== null
    ? error as { code?: unknown; name?: unknown }
    : {};
  const code = typeof record.code === 'string' ? record.code : '';
  const name = typeof record.name === 'string' ? record.name : '';
  if (code === 'ERR_JWT_EXPIRED' || name === 'JWTExpired') return 'token_expired';
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' || name === 'JWTClaimValidationFailed') return 'claims_invalid';
  if (code === 'ERR_JWKS_NO_MATCHING_KEY' || name === 'JWKSNoMatchingKey') return 'jwks_key_not_found';
  if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' || name === 'JWSSignatureVerificationFailed') return 'signature_invalid';
  if (name === 'JWKSTimeout' || name === 'JWKSMultipleMatchingKeys' || name === 'TypeError') return 'jwks_unavailable';
  return 'verification_failed';
}

/**
 * Returns the verified user, or `null` when the *token itself* fails verification (missing
 * header, expired/invalid/wrong-issuer, malformed). Callers translate `null` into
 * `ApiError.code: 'unauthenticated'` — a bad token is never thrown past this boundary, since a
 * Function handler's job there is a clean 401, not a 500.
 *
 * A missing `CLERK_SECRET_KEY` app setting is different: that's a deploy misconfiguration, not
 * something about the caller's token, so `requireIssuer()` runs OUTSIDE the try/catch below and
 * throws a real error (surfacing as a 500 in the Functions logs) instead of silently degrading
 * into "every request looks unauthenticated," which would be much harder to diagnose.
 */
export async function verifyClerkJwtDetailed(
  authorizationHeader: string | null | undefined,
): Promise<JwtVerificationResult> {
  if (!authorizationHeader?.startsWith('Bearer ')) return { user: null, failure: 'header_missing' };
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) return { user: null, failure: 'header_missing' };

  const configuredIssuer = process.env.CLERK_ISSUER?.trim() ? requireIssuer() : null;
  const secretKey = configuredIssuer ? undefined : requireSecretKey();
  try {
    const payload = configuredIssuer
      ? (await jwtVerify(token, remoteJwksFor(configuredIssuer), { issuer: configuredIssuer, algorithms: ['RS256', 'ES256', 'EdDSA'] })).payload
      : await verifyToken(token, { secretKey });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return { user: null, failure: 'claims_invalid' };
    }
    return { user: { userId: payload.sub } };
  } catch (error) {
    // Keep the client-facing response deliberately generic, but leave a safe diagnostic for
    // Application Insights. This distinguishes an issuer mismatch, a missing JWKS key, and a
    // network/signature failure without ever logging the bearer token itself.
    const failure = classifyVerificationFailure(error);
    const detail = describeVerificationError(error);
    console.error('Clerk JWT verification failed.', {
      failure,
      detail,
      reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return { user: null, failure, detail };
  }
}

export async function verifyClerkJwt(
  authorizationHeader: string | null | undefined,
): Promise<VerifiedUser | null> {
  return (await verifyClerkJwtDetailed(authorizationHeader)).user;
}

/** Test-only compatibility hook; Clerk's backend SDK owns its JWKS cache. */
export function __resetJwksCache(): void {
  cachedIssuer = '';
  cachedJwks = null;
}
