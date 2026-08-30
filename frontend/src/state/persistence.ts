import type { DraftInit } from '../../../shared/types';
import type { PickOverride } from './draftBoardState';


// Bumped from v1: the persisted shape changed (mode gained 'espn', and ESPN bridge picks are no
// longer written as manual-entry overrides — see the ESPN sync-restoration plan, 2026-08-15). A v1
// record under the old key is not readable as a v2 one — replaying its `mode: 'manual'` value (the
// only value that build could write for a bridge session) restores a disarmed manual session while
// `activeProvider` still paints the ESPN pill, and its overrides can mask a live stream that no
// longer produces them. Bumping the key drops the old record wholesale instead of half-restoring it.
//
// Bumped again v2 -> v3 (2026-08-28): mode gained 'complete', plus completedAt/from/savedLeagueId.
// This bump is doing double duty as the fix for the "stuck on local storage" bug — every v2 record
// on a user's machine (some of them genuinely stale, resurrected by the write-side bug fixed
// alongside this in DraftSessionProvider) is dropped in one move rather than needing a migration.
const STORAGE_KEY = 'ffa.draftSession.v3';

/**
 * Session mode as persisted. This is a superset of `DraftBoardState['mode']` ('live' | 'manual'):
 * an ESPN bridge session runs the board in 'live' mode (picks flow through `livePicks`, not
 * overrides — see `App.tsx`'s bridge wiring), but on reload the app must know to reconstruct an
 * ESPN `{ kind: 'bridge' }` session rather than a plain Sleeper 'connected' one. 'espn' captures
 * that distinction; the board-mode value derived from it is always 'live'.
 */
export type PersistedSessionMode = 'live' | 'manual' | 'espn' | 'complete';

/**
 * Sleeper has no auth, so a stored userId is not a secret — persisting it
 * (plus draftId and manual corrections) is what lets a browser refresh
 * reconstruct the full board instead of losing corrections. `frozenInit`
 * carries the latest DraftInit captured by a manual takeover (or the ESPN bridge's manual-form
 * base), so a refresh restores the recommendation workspace and clock math, not just the picks.
 *
 * `completedAt`/`from`/`provider`/`savedLeagueId` (2026-08-28) only carry meaning when
 * `mode === 'complete'`: `from` is the mode the session completed FROM (reusing this same
 * vocabulary — 'live'/'espn' map back to the session kinds 'connected'/'bridge'), and `provider`
 * is `ActiveProvider` as it stood the instant before completion — stored explicitly rather than
 * re-derived from `from`, since a manual (takeover) session's kind alone can't distinguish a
 * Sleeper takeover from an ESPN one (that's `reconnectCred`, which nothing here persists). Without
 * this a rehydrated manual completion would have no honest way to recover which provider it was.
 */
export interface PersistedSession {
  userId: string | null;
  draftId: string | null;
  mode: PersistedSessionMode;
  overrides: PickOverride[];
  frozenInit: DraftInit | null;
  completedAt: string | null;
  from: PersistedSessionMode | null;
  provider: 'sleeper' | 'espn' | null;
  savedLeagueId: string | null;
}

/**
 * Minimal shape guard so a stale or corrupted `frozenInit` field degrades to `null` (no frozen
 * workspace) instead of crashing on mount. Not full runtime validation of the persisted session
 * record — that remains a possible future hardening pass.
 */
function isDraftInitLike(value: unknown): value is DraftInit {
  if (typeof value !== 'object' || value === null) return false;
  const init = value as Record<string, unknown>;
  return typeof init.provider === 'string'
    && typeof init.draftId === 'string'
    && typeof init.leagueId === 'string'
    && typeof init.teams === 'number'
    && typeof init.rounds === 'number'
    && typeof init.slotToTeam === 'object'
    && init.slotToTeam !== null
    && !Array.isArray(init.slotToTeam)
    && (typeof init.myTeamId === 'string' || init.myTeamId === null)
    && (typeof init.mySlot === 'number' || init.mySlot === null)
    && typeof init.settings === 'object'
    && init.settings !== null;
}

export function savePersistedSession(session: PersistedSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage can throw (private browsing, quota exceeded) — persistence
    // is a convenience, never required for the app to keep working.
  }
}

function isPersistedModeLike(value: unknown): value is PersistedSessionMode {
  return value === 'manual' || value === 'espn' || value === 'complete' || value === 'live';
}

export function loadPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    return {
      userId: typeof parsed.userId === 'string' ? parsed.userId : null,
      draftId: typeof parsed.draftId === 'string' ? parsed.draftId : null,
      mode: isPersistedModeLike(parsed.mode) ? parsed.mode : 'live',
      overrides: Array.isArray(parsed.overrides) ? parsed.overrides as PickOverride[] : [],
      frozenInit: isDraftInitLike(parsed.frozenInit) ? parsed.frozenInit : null,
      completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : null,
      from: isPersistedModeLike(parsed.from) ? parsed.from : null,
      provider: parsed.provider === 'sleeper' || parsed.provider === 'espn' ? parsed.provider : null,
      savedLeagueId: typeof parsed.savedLeagueId === 'string' ? parsed.savedLeagueId : null,
    };
  } catch {
    return null;
  }
}

export function clearPersistedSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
