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
  const league: SavedLeague = {
    id: body.id ?? randomUUID(),
    userId: auth.user.userId,
    provider: normalizeProvider(body.provider),
    providerLeagueId: body.providerLeagueId ?? null,
    name: body.name ?? 'Untitled league',
    season: body.season ?? '', // intentional placeholder — no adapter passthrough yet (DECISIONS.md, 2026-08-26)
    teams: body.teams ?? 0,
    rounds: body.rounds ?? 0,
    mySlot: body.mySlot ?? null,
    settings: body.settings,
    createdAt: body.createdAt ?? now,
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
