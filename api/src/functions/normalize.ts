import type { SavedDraft, SavedLeague } from '../../../shared/types.js';

/**
 * Client-supplied enum-ish fields are normalized against the `SavedLeague`/`SavedDraft` unions,
 * never trusted verbatim: a stray or hostile value (`provider: 'yahoo'`, an arbitrary mode
 * string) must degrade to a documented default rather than store a document that violates the
 * wire contract in shared/types.d.ts. Mirrors the frontend's `mapProvider` discipline
 * (frontend/src/state/draftSync.ts) at the API boundary.
 */
export function normalizeProvider(value: unknown): SavedLeague['provider'] {
  return value === 'sleeper' || value === 'espn' ? value : 'manual';
}

export function normalizeMode(value: unknown): SavedDraft['mode'] {
  return value === 'live' || value === 'espn' ? value : 'manual';
}

export function normalizeStatus(value: unknown): SavedDraft['status'] {
  return value === 'complete' ? 'complete' : 'active';
}

/**
 * Cosmos errors carry a numeric HTTP-style `code`. Only a genuine missing-item 404 may become a
 * "not found" response — a throttle (429) or transient failure must surface as a real failure
 * (rethrow → Functions 500), not lie that the item doesn't exist.
 */
export function isCosmosNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 404;
}
