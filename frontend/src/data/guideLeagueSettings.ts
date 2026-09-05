import type { LeagueFormat, LeagueSettings, Position, RosterSlot } from '../../../shared/types';
import { DEFAULT_MOCK_SCORING } from '../adapters/sleeper';
import { TARGET_ROSTER_SLOTS, TARGET_STARTING_SLOTS } from '../components/ManualDraftSetup';

/**
 * The Draft Guide's league-format selection — the anonymous public page's stand-in for a real
 * connected draft. Deliberately a sibling of `buildEspnDraftInit` (ManualDraftSetup): same
 * slot/scoring vocabulary, no draft identity, no seat.
 *
 * Note there is deliberately no 2qb key in `DEFAULT_MOCK_SCORING` — superflex is the format.qb
 * dimension plus a SUPER_FLEX starting slot, not a different scoring map.
 */
export interface GuideFormat {
  reception: 'standard' | 'half-ppr' | 'ppr';
  qb: 'one-qb' | 'superflex';
  teams: number;
  rounds: number;
}

export const GUIDE_TEAMS: readonly number[] = [8, 10, 12, 14];
export const GUIDE_ROUNDS: readonly number[] = [12, 13, 14, 15, 16];
/** The guide's position filter vocabulary — shared by the filter buttons and the route's URL-param
 * validation (an unknown `pos` degrades to 'ALL' instead of silently filtering everything away). */
export const GUIDE_POSITIONS: readonly (Position | 'ALL')[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
export type GuidePosition = Position | 'ALL' | 'D' | 'S';
export const ALL_GUIDE_POSITIONS: readonly GuidePosition[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'D', 'S'];

export const GUIDE_DEFAULT_FORMAT: GuideFormat = {
  reception: 'ppr',
  qb: 'one-qb',
  teams: 12,
  rounds: 15,
};

const RECEPTIONS: readonly GuideFormat['reception'][] = ['standard', 'half-ppr', 'ppr'];

/** Parse the format from `/draft-guide`'s URL query string. Invalid or missing values fall back
 * to the defaults — an anonymous user's selectors live entirely in the URL, so nothing here reads
 * or writes storage. */
export function parseGuideFormat(params: URLSearchParams): GuideFormat {
  const reception = params.get('scoring');
  const qb = params.get('qb');
  const teams = Number(params.get('teams'));
  const rounds = Number(params.get('rounds'));
  return {
    reception: RECEPTIONS.includes(reception as GuideFormat['reception'])
      ? reception as GuideFormat['reception']
      : GUIDE_DEFAULT_FORMAT.reception,
    qb: qb === 'superflex' ? 'superflex' : 'one-qb',
    teams: GUIDE_TEAMS.includes(teams) ? teams : GUIDE_DEFAULT_FORMAT.teams,
    rounds: GUIDE_ROUNDS.includes(rounds) ? rounds : GUIDE_DEFAULT_FORMAT.rounds,
  };
}

export function serializeGuideFormat(f: GuideFormat): URLSearchParams {
  return new URLSearchParams({
    scoring: f.reception,
    qb: f.qb,
    teams: String(f.teams),
    rounds: String(f.rounds),
  });
}

/** Which ADP lane the guide's active board reads — mirrors DraftSessionProvider.tsx's
 * adpFormatForDraft mapping (superflex drafts draft against the 2QB board; otherwise the plain
 * reception board). */
export function guideAdpFormat(f: GuideFormat): AdpFormatForGuide {
  return f.qb === 'superflex' ? '2qb' : f.reception;
}

type AdpFormatForGuide = 'standard' | 'half-ppr' | 'ppr' | '2qb';

/** A complete, valid LeagueSettings synthesized purely from the selector state — the engine never
 * knows it isn't a real connected league. Slot identity follows buildEspnDraftInit's convention
 * (slot N → "N"), which the guide never uses anyway (picks: [], myTeamId: null). */
export function buildGuideSettings(f: GuideFormat): LeagueSettings {
  // Superflex gains a SUPER_FLEX starting slot on top of the 1QB base (see module doc — this is
  // a roster-shape dimension, not a scoring change).
  const startingSlots: RosterSlot[] = f.qb === 'superflex'
    ? [...TARGET_STARTING_SLOTS.slice(0, -2), 'SUPER_FLEX', ...TARGET_STARTING_SLOTS.slice(-2)]
    : TARGET_STARTING_SLOTS;
  return {
    provider: 'manual',
    leagueId: 'draft-guide',
    name: `Draft Guide (${f.reception} · ${f.qb === 'superflex' ? 'superflex' : '1QB'} · ${f.teams} teams)`,
    season: '2026',
    teams: f.teams,
    startingSlots,
    rosterSlots: f.qb === 'superflex'
      ? { ...TARGET_ROSTER_SLOTS, SUPER_FLEX: 1 }
      : TARGET_ROSTER_SLOTS,
    scoring: DEFAULT_MOCK_SCORING[f.reception],
    format: { reception: f.reception, qb: f.qb, draft: 'snake' } satisfies LeagueFormat,
  };
}
