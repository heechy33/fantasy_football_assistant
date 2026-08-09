import type { DraftStatus, DraftType, OnTheClock, Pick } from '../../../shared/types';

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
  const round = Math.ceil(overall / teams);
  const posInRound = overall - (round - 1) * teams;
  const slot = draftType === 'snake' && round % 2 === 0 ? teams - posInRound + 1 : posInRound;
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
    const round = Math.ceil(overall / teams);
    const posInRound = overall - (round - 1) * teams;
    const slot = draftType === 'snake' && round % 2 === 0 ? teams - posInRound + 1 : posInRound;
    if (slotToTeam[slot] === teamId) return overall;
  }
  return null;
}

/**
 * The pair of pick numbers S3's rollout engine actually needs, disambiguated from `nextPick` in
 * `RecommendationPanel.tsx`. That existing field means two different things depending on who's on
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
  if (decisionPick == null) return { decisionPick: null, followUpPick: null };
  // Passing `decisionPick` itself as the "picks so far" count (with afterCurrentPick left false)
  // scans forward from decisionPick + 1 — i.e. "this team's next pick after decisionPick."
  const followUpPick = nextPickForTeam(draftType, teams, rounds, decisionPick, slotToTeam, myTeamId, false);
  return { decisionPick, followUpPick };
}

/**
 * Canonical, order-independent signature of the full pick list — the RNG seed input (via
 * `rng.ts`'s `hashStateSeed`), not a UI memo key. Must include `teamId` and `slot`: B3's
 * opponent-need modeling depends on which team owns each pick, so two draft states that differ only
 * in a pick's team ownership (e.g. a manual correction reassigning one) must hash to different
 * seeds rather than silently reusing a stale simulation. `RecommendationPanel.tsx`'s lighter
 * `${overall}:${playerId}` memo key stays as-is for its own render-optimization purpose; it is not
 * a substitute for this.
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

/** `rawStatus` is refreshed from Sleeper's draft endpoint alongside picks.
 * A full picks count still provides a safe fallback if that status lags.
 * status field). Trusting it alone would leave the derived status frozen at
 * whatever it was when the draft was connected — e.g. stuck on 'pre' for an
 * entire live draft if the user connected before the first pick landed. Any
 * pick actually existing is itself proof drafting has started, so that
 * overrides a stale 'pre_draft' snapshot; a full pick count still overrides
 * everything to 'complete' even if Sleeper's field hasn't flipped yet.
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
