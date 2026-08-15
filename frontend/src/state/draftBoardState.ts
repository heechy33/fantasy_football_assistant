import type { Pick, PlayerId } from '../../../shared/types';

/**
 * An override always wins over a live-polled pick at the same `overall`. It's
 * the single mechanism behind both "universal manual mode" (every pick is a
 * `manual-entry` override, no live picks underneath) and "undo/correction"
 * (a `manual-correction` override sits on top of a live-polled pick) — same
 * merge function, unified data model.
 *
 * `round`/`slot`/`teamId` are optional because a correction can omit them and
 * inherit from the live pick underneath; a manual-entry override (no live
 * pick to inherit from) should supply all of them.
 */
export interface PickOverride {
  overall: number;
  round?: number;
  slot?: number;
  teamId?: string;
  playerId: PlayerId | null;
  /**
   * Provider's own player id, retained verbatim so a manual-entry override can round-trip the
   * provider id a live pick carried (the atomic manual-takeover freeze depends on this). Falls
   * back to the canonical id at read time.
   */
  providerPlayerId?: string;
  providerPlayerName?: string;
  source: 'manual-correction' | 'manual-entry';
  correctedAt: number;
}

export interface DraftBoardState {
  mode: 'live' | 'manual';
  livePicks: Pick[];
  overrides: Map<number, PickOverride>;
}

export function createDraftBoardState(mode: DraftBoardState['mode'] = 'live'): DraftBoardState {
  return { mode, livePicks: [], overrides: new Map() };
}

/** A poll's fresh picks. No-op in manual mode — manual sessions never have a live layer.
 * Also a no-op when pick content is unchanged so the ~2.5s poll does not force a new state
 * identity (and a full App → workspace re-render) on every tick. */
export function setLivePicks(state: DraftBoardState, livePicks: Pick[]): DraftBoardState {
  if (state.mode === 'manual') return state;
  if (state.livePicks === livePicks) return state;
  if (
    state.livePicks.length === livePicks.length
    && state.livePicks.every((pick, index) => {
      const next = livePicks[index];
      return next != null
        && pick.overall === next.overall
        && pick.teamId === next.teamId
        && pick.slot === next.slot
        && pick.playerId === next.playerId
        && pick.providerPlayerId === next.providerPlayerId
        && pick.providerPlayerName === next.providerPlayerName;
    })
  ) {
    return state;
  }
  return { ...state, livePicks };
}

export function setMode(state: DraftBoardState, mode: DraftBoardState['mode']): DraftBoardState {
  if (state.mode === mode) return state;
  return mode === 'manual' ? { ...state, mode, livePicks: [] } : { ...state, mode };
}

/**
 * Atomic manual-takeover freeze: every effective pick (the live layer merged with any existing
 * corrections) becomes a complete `manual-entry` override and the state switches to manual mode in
 * the same operation — this is the "switch to manual while retaining N picks" action. Nothing is
 * dropped: overall/round/slot/team, canonical id, provider id, and name are all retained, so the
 * frozen board and the DraftWorkspace keep working with no live layer underneath. Idempotent when
 * already in manual mode (effective picks are simply re-frozen).
 */
export function freezeLivePicksToOverrides(state: DraftBoardState): DraftBoardState {
  const overrides = new Map<number, PickOverride>();
  for (const pick of computeEffectivePicks(state)) {
    overrides.set(pick.overall, {
      overall: pick.overall,
      round: pick.round,
      slot: pick.slot,
      teamId: pick.teamId,
      playerId: pick.playerId,
      providerPlayerId: pick.providerPlayerId,
      providerPlayerName: pick.providerPlayerName,
      source: 'manual-entry',
      correctedAt: Date.now(),
    });
  }
  return { mode: 'manual', livePicks: [], overrides };
}

/**
 * A poll updating `livePicks` never touches `overrides` — they're separate
 * state slices, merged only here at read time. That's what makes the
 * precedence rule airtight: there's no code path where a poll write and a
 * correction write race on the same field.
 */
export function applyOverride(state: DraftBoardState, override: PickOverride): DraftBoardState {
  const overrides = new Map(state.overrides);
  overrides.set(override.overall, override);
  return { ...state, overrides };
}

/**
 * Deletes the override; the effective value falls back to whatever
 * `livePicks` currently holds for that `overall` (or "undrafted" if there
 * never was one — correct in manual mode, or if live polling hasn't reached
 * that pick yet).
 */
export function undoOverride(state: DraftBoardState, overall: number): DraftBoardState {
  if (!state.overrides.has(overall)) return state;
  const overrides = new Map(state.overrides);
  overrides.delete(overall);
  return { ...state, overrides };
}

/**
 * Because "drafted" is always derived from this function's output, correcting
 * a bad match (pick #4 wrongly matched to player A instead of player B) by
 * overriding `#4 -> B` automatically un-drafts A too — A was never recorded
 * as drafted anywhere except transiently inside that one live `Pick`.
 */
export function computeEffectivePicks(state: DraftBoardState): Pick[] {
  const byOverall = new Map<number, Pick>();
  for (const pick of state.livePicks) byOverall.set(pick.overall, pick);

  for (const override of state.overrides.values()) {
    const existing = byOverall.get(override.overall);
    byOverall.set(override.overall, {
      overall: override.overall,
      round: override.round ?? existing?.round ?? 0,
      slot: override.slot ?? existing?.slot ?? 0,
      teamId: override.teamId ?? existing?.teamId ?? '',
      playerId: override.playerId,
      providerPlayerId: override.providerPlayerId ?? override.playerId ?? existing?.providerPlayerId ?? '',
      providerPlayerName: override.providerPlayerName ?? existing?.providerPlayerName,
    });
  }

  return [...byOverall.values()].sort((a, b) => a.overall - b.overall);
}
