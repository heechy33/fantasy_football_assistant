import type { FantasyProsStars, PlayerMeta } from '../../../shared/types';
import type { TeamDepthRole } from '../data/teamDepthRole';
import type { Recommendation } from '../engine/recommend';

/**
 * Static demo rows for the landing page's card showcase — the REAL PlayerCard component rendered
 * with hardcoded data instead of PNG screenshots (which drifted and looked soft at high DPI).
 * Ids are the players' real Sleeper ids so headshots/team logos resolve from the same CDN the
 * Draft Room uses; every number is display-only marketing staging, never fed to the engine.
 */
export interface LandingDemoCard {
  player: PlayerMeta;
  recommendation: Recommendation;
  /** Card-face board rank shown next to the positional rank. */
  rank: number;
  fantasyPros: FantasyProsStars;
  depthRole: TeamDepthRole;
}

function demoRecommendation(
  playerId: string,
  rank: number,
  projectedPoints: number,
  availabilityAdp: number,
  availableNextPickProbability: number,
): Recommendation {
  return {
    playerId,
    rank,
    projectedPoints,
    marginalRosterValue: 0,
    marginalRosterUtility: 0,
    expectedFollowUpValue: 0,
    planValue: 0,
    planningHorizon: 0,
    replacementAdjustedValue: 0,
    replacementLevelPoints: 0,
    vor: 0,
    vona: null,
    vonaSource: 'unavailable',
    lookaheadValue: null,
    downside: null,
    simulatedSurvivalProbability: availableNextPickProbability,
    benchDepthValue: 0,
    recommendationMode: 'starter',
    rankingBasis: 'rosterUtility',
    deprioritized: false,
    tier: 1,
    tierGapAfter: 0,
    tierBoundaryGap: 0,
    tierUrgency: 0,
    availableNextPickProbability,
    availabilityAdp,
    availabilityAdpHigh: null,
    availabilityAdpLow: null,
    availabilityStdev: null,
    availabilitySampleSize: null,
    nearTie: false,
    scoringDiagnosticSeverity: 'none',
    missingScoringKeys: [],
    confidence: 'high',
    assignedRosterSlot: null,
    replacementPlayerId: null,
    pickAction: 'take-now',
    reasons: [],
    warnings: [],
  };
}

const achane: PlayerMeta = {
  playerId: '9226',
  name: "De'Von Achane",
  position: 'RB',
  eligiblePositions: ['RB'],
  team: 'MIA',
  byeWeek: 6,
  age: 24,
  yearsExp: 3,
  injuryStatus: null,
  ids: {},
};

const smithNjigba: PlayerMeta = {
  playerId: '9488',
  name: 'Jaxon Smith-Njigba',
  position: 'WR',
  eligiblePositions: ['WR'],
  team: 'SEA',
  byeWeek: 11,
  age: 24,
  yearsExp: 3,
  injuryStatus: null,
  ids: {},
};

function demoDepthRole(playerId: string, label: string, headline: string): TeamDepthRole {
  return {
    playerId,
    label,
    headline,
    provenance: `Prior-season volume share measured on the ${label === 'RB1' ? 'Dolphins' : 'Seahawks'} backfield.`,
    slot: 1,
    basis: 'volume',
    shape: 'clear',
    room: null,
  };
}

export const LANDING_DEMO_CARDS: ReadonlyArray<LandingDemoCard> = [
  {
    player: achane,
    recommendation: demoRecommendation(achane.playerId, 3, 248.6, 8.2, 0.86),
    rank: 3,
    fantasyPros: { rank: 6, tier: 1, upside: 5, bust: 2, sos: 3, ecrVsAdp: null, positionRank: 'RB6' },
    depthRole: demoDepthRole(achane.playerId, 'RB1', 'Miami lead back by measured carry share.'),
  },
  {
    player: smithNjigba,
    recommendation: demoRecommendation(smithNjigba.playerId, 7, 231.9, 14.6, 0.64),
    rank: 7,
    fantasyPros: { rank: 12, tier: 2, upside: 4, bust: 1, sos: 3, ecrVsAdp: null, positionRank: 'WR8' },
    depthRole: demoDepthRole(smithNjigba.playerId, 'WR1', "Seattle's clear top target by measured target share."),
  },
];
