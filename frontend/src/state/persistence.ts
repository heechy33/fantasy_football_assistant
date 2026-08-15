import type { DraftInit } from '../../../shared/types';
import type { DraftBoardState, PickOverride } from './draftBoardState';

const STORAGE_KEY = 'ffa.draftSession.v1';

/**
 * Sleeper has no auth, so a stored userId is not a secret — persisting it
 * (plus draftId and manual corrections) is what lets a browser refresh
 * reconstruct the full board instead of losing corrections. `frozenInit`
 * carries the latest DraftInit captured by a manual takeover, so a refresh
 * restores the recommendation workspace and clock math, not just the picks.
 */
export interface PersistedSession {
  userId: string | null;
  draftId: string | null;
  mode: DraftBoardState['mode'];
  overrides: PickOverride[];
  frozenInit: DraftInit | null;
}

/**
 * Minimal shape guard so a stale or corrupted `frozenInit` field degrades to `null` (no frozen
 * workspace) instead of crashing on mount. Full runtime validation of the persisted session
 * record lands with the versioned `ffa.draftSession.v2` key in Phase 3.
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
      mode: parsed.mode === 'manual' ? 'manual' : 'live',
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
