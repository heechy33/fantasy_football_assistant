import type { DraftBoardState, PickOverride } from './draftBoardState';

const STORAGE_KEY = 'ffa.draftSession.v1';

/**
 * Sleeper has no auth, so a stored userId is not a secret — persisting it
 * (plus draftId and manual corrections) is what lets a browser refresh
 * reconstruct the full board instead of losing corrections.
 */
export interface PersistedSession {
  userId: string | null;
  draftId: string | null;
  mode: DraftBoardState['mode'];
  overrides: PickOverride[];
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
    return JSON.parse(raw) as PersistedSession;
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
