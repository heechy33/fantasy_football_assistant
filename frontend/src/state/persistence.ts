import type { DraftInit } from '../../../shared/types';
import type { PickOverride } from './draftBoardState';

// Bumped from v1: the persisted shape changed (mode gained 'espn', and ESPN bridge picks are no
// longer written as manual-entry overrides — see the ESPN sync-restoration plan, 2026-08-15). A v1
// record under the old key is not readable as a v2 one — replaying its `mode: 'manual'` value (the
// only value that build could write for a bridge session) restores a disarmed manual session while
// `activeProvider` still paints the ESPN pill, and its overrides can mask a live stream that no
// longer produces them. Bumping the key drops the old record wholesale instead of half-restoring it.
const STORAGE_KEY = 'ffa.draftSession.v2';

/**
 * Session mode as persisted. This is a superset of `DraftBoardState['mode']` ('live' | 'manual'):
 * an ESPN bridge session runs the board in 'live' mode (picks flow through `livePicks`, not
 * overrides — see `App.tsx`'s bridge wiring), but on reload the app must know to reconstruct an
 * ESPN `{ kind: 'bridge' }` session rather than a plain Sleeper 'connected' one. 'espn' captures
 * that distinction; the board-mode value derived from it is always 'live'.
 */
export type PersistedSessionMode = 'live' | 'manual' | 'espn';

/**
 * Sleeper has no auth, so a stored userId is not a secret — persisting it
 * (plus draftId and manual corrections) is what lets a browser refresh
 * reconstruct the full board instead of losing corrections. `frozenInit`
 * carries the latest DraftInit captured by a manual takeover (or the ESPN bridge's manual-form
 * base), so a refresh restores the recommendation workspace and clock math, not just the picks.
 */
export interface PersistedSession {
  userId: string | null;
  draftId: string | null;
  mode: PersistedSessionMode;
  overrides: PickOverride[];
  frozenInit: DraftInit | null;
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

export function loadPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    return {
      userId: typeof parsed.userId === 'string' ? parsed.userId : null,
      draftId: typeof parsed.draftId === 'string' ? parsed.draftId : null,
      mode: parsed.mode === 'manual' || parsed.mode === 'espn' ? parsed.mode : 'live',
      overrides: Array.isArray(parsed.overrides) ? parsed.overrides as PickOverride[] : [],
      frozenInit: isDraftInitLike(parsed.frozenInit) ? parsed.frozenInit : null,
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
