import type { DraftType, EspnLivePick } from '../../../shared/types';
import { slotForOverall } from './draftOrder';
import type { EspnStreamOffset } from './espnOffset';

export interface EspnDraftOrder {
  /** ESPN league team id -> 1-based draft position, derived from the confirmed absolute-pick offset
   * (`espnOffset.ts`) via `slotForOverall`, not from arrival order. Empty whenever `reliable` is
   * false. */
  positionByTeam: Map<number, number>;
  /** All `teams` positions observed. */
  complete: boolean;
  /** False whenever the stream's absolute-pick offset isn't confirmed yet (Step 6 — arrival index
   * cannot be laundered into a draft position without it), or the derived mapping is internally
   * inconsistent (the same team id computed to two different positions, which would mean the
   * offset itself is wrong despite passing espnOffset.ts's own checks — a belt-and-suspenders
   * guard, not the primary confirmation mechanism). */
  reliable: boolean;
}

/**
 * Derive the draft order from the CONFIRMED absolute-pick offset (Step 6), not from stream arrival
 * order. Recon (2026-08-15) proved ESPN's SELECTED first token is a league *team id*, not a draft
 * position, and the order is a random permutation of team ids — and a stream that attaches mid-draft
 * has an arrival index that isn't even the draft's absolute pick number, so arrival order alone
 * (the pre-Step-6 approach) cannot be trusted at all: a stream starting at the top of round 2 has
 * `teams` distinct arrivals and would look clean while mapping every team to the reversed order.
 * `offset` must come from `deriveEspnStreamOffset` (`espnOffset.ts`); an unconfirmed offset yields
 * an empty, unreliable order — no arrival-index fallback of any kind.
 */
export function deriveEspnDraftOrder(
  streamPicks: readonly EspnLivePick[],
  teams: number,
  draftType: DraftType,
  offset: EspnStreamOffset,
): EspnDraftOrder {
  if (!offset.confirmed || offset.offset == null) {
    return { positionByTeam: new Map(), complete: false, reliable: false };
  }
  const positionByTeam = new Map<number, number>();
  let conflict = false;
  for (const pick of streamPicks) {
    const absolute = pick.overall + offset.offset;
    const position = slotForOverall(draftType, teams, absolute);
    const existing = positionByTeam.get(pick.slot);
    if (existing != null && existing !== position) conflict = true;
    positionByTeam.set(pick.slot, position);
  }
  return { positionByTeam, complete: positionByTeam.size === teams, reliable: !conflict };
}

/** 1-based absolute draft position for a single stream pick, or `null` when the order is not
 * `reliable` (no confirmed offset, or an internal conflict) — callers must surface that rather than
 * normalize into an apparently-valid pick (see espn.ts, which drops the old `?? stream.slot`
 * fallback entirely in favor of this). `offsetValue` is `EspnStreamOffset.offset`, threaded
 * separately so callers that already hold `order` don't need to re-derive or re-pass the whole
 * offset object. */
export function streamPickPosition(
  order: EspnDraftOrder,
  pick: EspnLivePick,
  offsetValue: number | null,
  draftType: DraftType,
  teams: number,
): number | null {
  if (!order.reliable || offsetValue == null) return null;
  return slotForOverall(draftType, teams, pick.overall + offsetValue);
}
