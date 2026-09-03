import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { ApiError } from '../../../shared/types.js';
import { verifyClerkJwtDetailed, type VerifiedUser } from '../auth/verifyClerkJwt.js';

/** A boolean discriminant rather than structural narrowing (e.g. `'status' in auth`) —
 * `HttpResponseInit`'s fields are all optional, which this TypeScript version correctly refuses
 * to narrow on in the negative branch (an absent optional property doesn't prove the other union
 * member). `ok` is required on both arms, so callers narrow cleanly either way. */
export type AuthResult =
  | { ok: true; user: VerifiedUser }
  | { ok: false; response: HttpResponseInit };

/**
 * Shared by every `leagues.ts`/`drafts.ts` handler: verify the Bearer token, or return the 401
 * `ApiError` envelope. SWA's route roles stay `["anonymous","authenticated"]` (CLAUDE.md) — this
 * check is the actual enforcement point now that auth is Clerk, not SWA's built-in `/.auth/*`.
 *
 * ```ts
 * const auth = await requireUser(request);
 * if (!auth.ok) return auth.response;
 * // auth.user.userId is verified from here on
 * ```
 */
export async function requireUser(request: HttpRequest): Promise<AuthResult> {
  const authorization = request.headers.get('authorization');
  const verification = await verifyClerkJwtDetailed(authorization);
  if (!verification.user) {
    const body: ApiError = {
      error: 'Missing or invalid bearer token.',
      code: 'unauthenticated',
      authStage: authorization?.startsWith('Bearer ') ? 'token_rejected' : 'header_missing',
      authReason: authorization?.startsWith('Bearer ')
        ? verification.failure ?? 'verification_failed'
        : undefined,
      authDetail: authorization?.startsWith('Bearer ') ? verification.detail : undefined,
    };
    return { ok: false, response: { status: 401, jsonBody: body } };
  }
  return { ok: true, user: verification.user };
}
