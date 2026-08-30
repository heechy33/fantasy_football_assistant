import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import type { ApiError, SavedLeague } from '../../../shared/types.js';
import { leaguesContainer } from '../data/cosmos.js';
import { normalizeProvider, isCosmosNotFound } from './normalize.js';
import { requireUser } from './authGuard.js';

/** GET /api/leagues — every league the signed-in user has connected. Scoped to `userId` at the
 * query level, not filtered client-side, so this is a single-partition read. */
export async function listLeagues(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { resources } = await leaguesContainer().items
    .query<SavedLeague>({
      query: 'SELECT * FROM c WHERE c.userId = @userId',
      parameters: [{ name: '@userId', value: auth.user.userId }],
    })
    .fetchAll();
  return { status: 200, jsonBody: resources };
}

/**
 * POST /api/leagues — create or update a league. `userId` is ALWAYS taken from the verified
 * token, never from the request body — accepting a client-supplied `userId` here would let one
 * signed-in user write into another user's partition, since Cosmos itself enforces nothing beyond
 * the partition key matching the write. This check is the actual authorization boundary.
 *
 * MERGE RULE (2026-08-28): the endpoint no longer rebuilds the whole document from the body.
 * For every optional identity/metadata field, `undefined` means "keep what is stored" and an
 * explicit `null` means "clear it" — JSON serialization drops `undefined`, so a partial writer
 * (e.g. the draft-sync tick, which sends only its own fields) cannot silently erase the stored
 * Sleeper identity, season, or team metadata it did not send. An existing document is located
 * either by the dedupe point query on (userId, provider, providerLeagueId) or, when the client
 * supplies `id`, by a direct point read. `settings` remains required on the wire.
 */
export async function upsertLeague(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const body = await request.json() as Partial<SavedLeague>;
  if (typeof body.settings !== 'object' || body.settings === null) {
    // `settings` is required on the wire type; storing a doc without it (undefined keys are
    // dropped by JSON serialization) would hand every future reader a contract violation.
    const errorBody: ApiError = { error: 'settings is required.', code: 'bad_request' };
    return { status: 400, jsonBody: errorBody };
  }
  const now = new Date().toISOString();
  // Idempotency boundary: a client that doesn't know the existing document's id (a second
  // device/browser, or a league saved from the connect surface before any draft ran) would
  // otherwise upsert with no id and create a duplicate doc per browser — the exact hazard the
  // frontend's reconcile can only partially paper over. One point query on
  // (userId, provider, providerLeagueId) makes the endpoint safe against any writer; a client
  // that DOES know the id gets the same existing-doc-in-hand treatment via a point read.
  const provider = normalizeProvider(body.provider);
  let id = body.id ?? randomUUID();
  let existing: SavedLeague | null = null;
  if (body.id) {
    try {
      const { resource } = await leaguesContainer().item(id, auth.user.userId).read<SavedLeague>();
      existing = resource ?? null;
    } catch (error) {
      // A supplied id that doesn't exist (yet) under this partition is just a first write.
      if (!isCosmosNotFound(error)) throw error;
    }
  } else if (body.providerLeagueId && body.providerLeagueId.startsWith('mock:') === false) {
    const { resources } = await leaguesContainer().items.query<SavedLeague>({
      query: 'SELECT * FROM c WHERE c.userId = @userId AND c.provider = @provider AND c.providerLeagueId = @providerLeagueId OFFSET 0 LIMIT 1',
      parameters: [
        { name: '@userId', value: auth.user.userId },
        { name: '@provider', value: provider },
        { name: '@providerLeagueId', value: body.providerLeagueId },
      ],
    }).fetchAll();
    existing = resources[0] ?? null;
    if (existing) id = existing.id;
  }
  /** `undefined` on the wire keeps the stored value; an explicit `null` clears it. */
  const keep = <T>(stored: T | undefined, incoming: T | undefined): T | undefined =>
    incoming === undefined ? stored : incoming;
  const league: SavedLeague = {
    id,
    userId: auth.user.userId,
    // Provider is IMMUTABLE once stored. It is the dedupe key's second component, so letting a
    // writer change it (including an explicit null, which normalizeProvider would silently coerce
    // to 'manual') would desynchronize the document from the (userId, provider, providerLeagueId)
    // lookup — the next save would miss the existing doc and duplicate it. Changing provider
    // means deleting the league and reconnecting.
    provider: existing ? existing.provider : provider,
    providerLeagueId: keep(existing?.providerLeagueId, body.providerLeagueId) ?? null,
    name: keep(existing?.name, body.name) ?? 'Untitled league', // the default applies only when nothing is stored
    season: keep(existing?.season, body.season) ?? '', // '' only when nothing is stored (DraftInit carries no season — DECISIONS.md, 2026-08-26)
    teams: keep(existing?.teams, body.teams) ?? 0,
    rounds: keep(existing?.rounds, body.rounds) ?? 0,
    mySlot: keep(existing?.mySlot, body.mySlot) ?? null,
    settings: body.settings,
    providerUserId: keep(existing?.providerUserId, body.providerUserId) ?? null,
    providerUsername: keep(existing?.providerUsername, body.providerUsername) ?? null,
    providerTeamId: keep(existing?.providerTeamId, body.providerTeamId) ?? null,
    providerTeamName: keep(existing?.providerTeamName, body.providerTeamName) ?? null,
    latestDraftId: keep(existing?.latestDraftId, body.latestDraftId) ?? null,
    createdAt: keep(existing?.createdAt, body.createdAt) ?? now,
    updatedAt: now,
  };
  const { resource } = await leaguesContainer().items.upsert<SavedLeague>(league);
  return { status: 200, jsonBody: resource };
}

/** DELETE /api/leagues/{id} — a point delete keyed on (id, userId-as-partition-key). Deleting an
 * id that belongs to a different partition (another user's league) throws a Cosmos 404, which
 * this maps to a 404 response rather than leaking whether the id exists under someone else. */
export async function deleteLeague(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const id = request.params.id;
  if (!id) return { status: 400, jsonBody: { error: 'Missing league id.', code: 'not_found' } };

  try {
    await leaguesContainer().item(id, auth.user.userId).delete();
    return { status: 204 };
  } catch (error) {
    // Only a genuine missing-item 404 maps to 404 — throttles/transients rethrow so they
    // surface as failures instead of lying "not found" (see isCosmosNotFound).
    if (!isCosmosNotFound(error)) throw error;
    return { status: 404, jsonBody: { error: 'League not found.', code: 'not_found' } };
  }
}

app.http('leagues-list', { methods: ['GET'], authLevel: 'anonymous', route: 'leagues', handler: listLeagues });
app.http('leagues-upsert', { methods: ['POST'], authLevel: 'anonymous', route: 'leagues', handler: upsertLeague });
app.http('leagues-delete', { methods: ['DELETE'], authLevel: 'anonymous', route: 'leagues/{id}', handler: deleteLeague });
