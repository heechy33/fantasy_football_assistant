import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import type { SavedDraft } from '../../../shared/types.js';
import { draftsContainer } from '../data/cosmos.js';
import { isCosmosNotFound, normalizeMode, normalizeProvider, normalizeStatus } from './normalize.js';
import { requireUser } from './authGuard.js';

/** GET /api/drafts[?leagueId=...] — every synced draft for the signed-in user, optionally scoped
 * to one league. The retention policy (never sync a mock, delete on completion) is a client
 * decision — see frontend/src/state/draftSync.ts — this endpoint is a plain scoped CRUD layer. */
export async function listDrafts(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const leagueId = request.query.get('leagueId');
  const query = leagueId
    ? { query: 'SELECT * FROM c WHERE c.userId = @userId AND c.leagueId = @leagueId', parameters: [{ name: '@userId', value: auth.user.userId }, { name: '@leagueId', value: leagueId }] }
    : { query: 'SELECT * FROM c WHERE c.userId = @userId', parameters: [{ name: '@userId', value: auth.user.userId }] };

  const { resources } = await draftsContainer().items.query<SavedDraft>(query).fetchAll();
  return { status: 200, jsonBody: resources };
}

/** POST /api/drafts — create or update a draft transcript. `userId` always comes from the
 * verified token, matching leagues.ts's upsertLeague — see its doc for why. */
export async function upsertDraft(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const body = await request.json() as Partial<SavedDraft>;
  if (!body.leagueId) {
    return { status: 400, jsonBody: { error: 'leagueId is required.', code: 'not_found' } };
  }
  const now = new Date().toISOString();
  const draft: SavedDraft = {
    id: body.id ?? randomUUID(),
    userId: auth.user.userId,
    leagueId: body.leagueId,
    provider: normalizeProvider(body.provider),
    providerDraftId: body.providerDraftId ?? null,
    mode: normalizeMode(body.mode),
    frozenInit: body.frozenInit ?? null,
    overrides: body.overrides ?? [],
    // Written only for providers with no upstream record to re-read (espn/manual) — the client
    // (draftSync) decides; Sleeper drafts rely on Sleeper's own API as the permanent record.
    picks: Array.isArray(body.picks) ? body.picks : [],
    status: normalizeStatus(body.status),
    createdAt: body.createdAt ?? now,
    updatedAt: now,
  };
  const { resource } = await draftsContainer().items.upsert<SavedDraft>(draft);
  return { status: 200, jsonBody: resource };
}

/** DELETE /api/drafts/{id} — same point-delete-by-partition-key shape as leagues.ts's
 * deleteLeague. Called by draftSync.ts once a real Sleeper league draft completes — the
 * transcript is disposable at that point; the SavedLeague pointer is what persists. */
export async function deleteDraft(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const id = request.params.id;
  if (!id) return { status: 400, jsonBody: { error: 'Missing draft id.', code: 'not_found' } };

  try {
    await draftsContainer().item(id, auth.user.userId).delete();
    return { status: 204 };
  } catch (error) {
    // Only a genuine missing-item 404 maps to 404 — throttles/transients rethrow so they
    // surface as failures instead of lying "not found" (see isCosmosNotFound).
    if (!isCosmosNotFound(error)) throw error;
    return { status: 404, jsonBody: { error: 'Draft not found.', code: 'not_found' } };
  }
}

app.http('drafts-list', { methods: ['GET'], authLevel: 'anonymous', route: 'drafts', handler: listDrafts });
app.http('drafts-upsert', { methods: ['POST'], authLevel: 'anonymous', route: 'drafts', handler: upsertDraft });
app.http('drafts-delete', { methods: ['DELETE'], authLevel: 'anonymous', route: 'drafts/{id}', handler: deleteDraft });
