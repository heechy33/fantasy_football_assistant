import type { DraftStatus, DraftType, OnTheClock, Pick } from '../../../shared/types';

/** 1-indexed round containing a given overall pick, for `teams` teams per round. */
export function roundForOverall(teams: number, overall: number): number {
  return Math.ceil(overall / teams);
}

/**
 * 1-indexed draft slot on the clock at a given overall pick. Linear order is ascending slot
 * order every round; snake reverses on even rounds. `auction` is a documented no-op at its
 * callers (`computeOnTheClock`/`nextPickForTeam` short-circuit before reaching this), so this
 * function's `draftType` param only ever distinguishes `snake` from `linear` in practice.
 */
export function slotForOverall(draftType: DraftType, teams: number, overall: number): number {
  const round = roundForOverall(teams, overall);
  const posInRound = overall - (round - 1) * teams;
  return draftType === 'snake' && round % 2 === 0 ? teams - posInRound + 1 : posInRound;
}

/**
 * Pure, provider-agnostic draft-order arithmetic. Sleeper's picks endpoint has
 * no explicit "on the clock" field, so this is computed from the pick count
 * plus the draft's own settings/slot map.
 *
 * `auction` is a documented no-op (returns null) — the active product promise
 * is snake-only during edge validation; auction On-The-Clock semantics don't
 * exist yet and shouldn't be guessed at.
 */
export function computeOnTheClock(
  draftType: DraftType,
  teams: number,
  rounds: number,
  picksCount: number,
  slotToTeam: Record<number, string>,
): OnTheClock | null {
  if (draftType === 'auction') return null;
  if (teams <= 0 || rounds <= 0) return null;
  if (picksCount >= teams * rounds) return null;

  const overall = picksCount + 1;
  const round = roundForOverall(teams, overall);
  const slot = slotForOverall(draftType, teams, overall);
  const teamId = slotToTeam[slot];
  if (teamId === undefined) return null;

  return { teamId, slot, round, overall };
}

/** Return the next selection owned by teamId. When the team is currently on
 * the clock, `afterCurrentPick` finds its following turn, which is the pick
 * relevant to a "can I wait?" availability estimate. */
export function nextPickForTeam(
  draftType: DraftType,
  teams: number,
  rounds: number,
  picksCount: number,
  slotToTeam: Record<number, string>,
  teamId: string | null,
  afterCurrentPick = false,
): number | null {
  if (!teamId || teams <= 0 || rounds <= 0 || draftType === 'auction') return null;
  const firstOverall = picksCount + 1 + (afterCurrentPick ? 1 : 0);
  for (let overall = firstOverall; overall <= teams * rounds; overall += 1) {
    const slot = slotForOverall(draftType, teams, overall);
    if (slotToTeam[slot] === teamId) return overall;
  }
  return null;
}

/** Single source of truth for the `round.slot` display label used across the command bar and
 * draft log (e.g. `3.07`). */
export function pickLabel(round: number, slot: number): string {
  return `${round}.${String(slot).padStart(2, '0')}`;
}

/** `round.pick` display label (e.g. `4.09`) — the **linear** pick-within-round
 * (`overall - (round - 1) * teams`, i.e. 1..teams), not the snake slot. That is the DraftSharks
 * war-room convention and the way the round separators in DraftLog are keyed (`overall ===
 * (round - 1) * teams + 1` starts each round). `pickLabel` above remains the snake-slot formatter;
 * this is the shared helper for the top-bar hero pick numbering. */
export function roundPickLabel(teams: number, overall: number): string {
  const round = roundForOverall(teams, overall);
  const pickInRound = overall - (round - 1) * teams;
  return pickLabel(round, pickInRound);
}

/**
 * The pair of pick numbers S3's rollout engine actually needs, disambiguated from `nextPick` in
 * `DraftWorkspace.tsx`. That existing field means two different things depending on who's on
 * the clock: the user's *upcoming* decision when an opponent is picking right now, or the user's
 * *following* turn when the user is on the clock. Forcing a rollout candidate onto whichever pick
 * `nextPick` happens to mean at the moment would assign the user's own pick to an opponent's roster
 * on the majority of renders (PLAN.md's S3 stage-B note).
 *
 * - `decisionPick` — the user's next actual selection. Never occupied by a simulated opponent pick.
 * - `followUpPick` — the user's selection after that, or `null` if the draft ends first.
 *
 * Opponents are simulated over `decisionPick + 1 … followUpPick − 1` only — see `simulate.ts`.
 */
export interface UserPickBoundaries {
  decisionPick: number | null;
  followUpPick: number | null;
  secondFollowUpPick: number | null;
}

export function userPickBoundaries(
  draftType: DraftType,
  teams: number,
  rounds: number,
  picksCount: number,
  slotToTeam: Record<number, string>,
  myTeamId: string | null,
): UserPickBoundaries {
  const decisionPick = nextPickForTeam(draftType, teams, rounds, picksCount, slotToTeam, myTeamId, false);
  if (decisionPick == null) return { decisionPick: null, followUpPick: null, secondFollowUpPick: null };
  // Passing `decisionPick` itself as the "picks so far" count (with afterCurrentPick left false)
  // scans forward from decisionPick + 1 — i.e. "this team's next pick after decisionPick."
  const followUpPick = nextPickForTeam(draftType, teams, rounds, decisionPick, slotToTeam, myTeamId, false);
  const secondFollowUpPick = followUpPick == null
    ? null
    : nextPickForTeam(draftType, teams, rounds, followUpPick, slotToTeam, myTeamId, false);
  return { decisionPick, followUpPick, secondFollowUpPick };
}

/**
 * Number of picks made = the maximum `overall` in the list, NOT the array length. The two are
 * identical for Sleeper/manual drafts (overalls are contiguous 1..N), but a Step-6 confirmed ESPN
 * late-attach normalizes picks at their ABSOLUTE positions (e.g. 138..147), so `picks.length`
 * undercounts and would compute a wrong clock/completion state. Correct in both regimes; 0 when
 * empty. Every caller that feeds `computeOnTheClock` / `deriveDraftStatus` / `userPickBoundaries`
 * / the draft log's completion check must use this, never `picks.length`.
 */
export function picksMade(picks: readonly Pick[]): number {
  return picks.reduce((max, p) => Math.max(max, p.overall), 0);
}

/**
 * Canonical, order-independent signature of the full pick list — the RNG seed input (via
 * `rng.ts`'s `hashStateSeed`), not a UI memo key. Must include `teamId` and `slot`: B3's
 * opponent-need modeling depends on which team owns each pick, so two draft states that differ only
 * in a pick's team ownership (e.g. a manual correction reassigning one) must hash to different
 * seeds rather than silently reusing a stale simulation. `DraftWorkspace.tsx` also uses this
 * complete signature for its render memo, so a team/slot correction cannot retain a stale board.
 */
export function canonicalPicksSignature(picks: readonly Pick[]): string {
  const frame = (value: string): string => `${value.length}:${value}`;
  return picks
    .map((pick) => [
      frame(String(pick.overall)),
      frame(pick.teamId),
      frame(String(pick.slot)),
      frame(pick.playerId ?? '~'),
    ].join(''))
    .sort()
    .join('');
}

/** `rawStatus` is the draft status captured at `init()` (or last explicit refresh).
 * Trusting it alone would leave the derived status frozen — e.g. stuck on 'pre' for an
 * entire live draft if the user connected before the first pick landed. Any pick actually
 * existing is itself proof drafting has started, so that overrides a stale 'pre_draft'
 * snapshot; a full pick count still overrides everything to 'complete' even if Sleeper's
 * field hasn't flipped yet. This is what lets `picks()` stay a single upstream GET.
 */
export function deriveDraftStatus(
  rawStatus: string,
  picksCount: number,
  teams: number,
  rounds: number,
): DraftStatus {
  if (teams > 0 && rounds > 0 && picksCount >= teams * rounds) return 'complete';
  if (rawStatus === 'complete') return 'complete';
  if (picksCount > 0) return 'drafting';
  if (rawStatus === 'drafting') return 'drafting';
  return 'pre';
}
