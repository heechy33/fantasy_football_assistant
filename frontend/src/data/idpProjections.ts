import type { Pick } from '../../../shared/types';
import idpData from './idpProjections.json';

export type IdpSlot = 'D' | 'S';

export interface IdpPlayerBio {
  age?: number | null;
  height?: string | null;
  heightInches?: number | null;
  weight?: number | null;
  yearsExp?: number | null;
  college?: string | null;
  jerseyNumber?: number | null;
  draftPick?: string | null;
  draftYear?: number | null;
  draftRound?: number | null;
  status?: string | null;
}

export interface IdpWeeklyGame {
  week: number;
  kind: 'played' | 'bye' | 'inactive';
  opponent: string | null;
  pts: number | null;
  defSnaps?: number | null;
  teamDefSnaps?: number | null;
  snapPct?: number | null;
  solo: number;
  ast: number;
  tkl: number;
  sack: number;
  tfl: number;
  qbHit: number;
  int: number;
  pd: number;
  ff: number;
  fr: number;
  gs?: number;
}

export interface IdpRoleSummary {
  gamesPlayed: number;
  gamesStarted: number;
  snapPct: number | null;
  snapsPerGame: number | null;
  tacklesPerGame: number | null;
  soloPerGame: number | null;
  astPerGame: number | null;
  sacksPerGame: number | null;
  totalSacks: number;
  tflPerGame: number | null;
  qbHitsPerGame: number | null;
  pdPerGame: number | null;
  intPerGame: number | null;
  totalInt: number;
  forcedFumbles: number;
  fumbleRecoveries: number;
  fptsPerGame: number | null;
  last5FptsPerGame: number | null;
  formRating: 'Rising' | 'Steady' | 'Falling' | 'Unavailable';
  ceiling: number | null;
  floor: number | null;
}

export interface IdpPlayer {
  id: string;
  sleeperId?: string;
  name: string;
  team: string;
  bye: number | null;
  pos: string; // 'LB', 'DE', 'DB', etc.
  slot: IdpSlot;
  rank: number;
  projectedPoints: number;
  fptsRaw: number;
  tackles: number;
  assists: number;
  sacks: number;
  pd: number;
  int: number;
  ff: number;
  fr: number;
  bio?: IdpPlayerBio;
  role?: IdpRoleSummary;
  weekly?: IdpWeeklyGame[];
}

interface IdpDataset {
  season: string;
  source: string;
  updatedAt: string;
  D: IdpPlayer[];
  S: IdpPlayer[];
}

const typedIdpData = idpData as unknown as IdpDataset;

/**
 * Returns the sorted list of IDP players for slot 'D' (DE/LB) or 'S' (DB/S).
 */
export function loadIdpPlayers(slot: IdpSlot): IdpPlayer[] {
  return typedIdpData[slot] ?? [];
}

/**
 * Returns all IDP players combined across D and S.
 */
export function loadAllIdpPlayers(): IdpPlayer[] {
  return [...typedIdpData.D, ...typedIdpData.S];
}

/**
 * Normalizes a player name for matching (removes punctuation, extra spaces, lowercase).
 */
export function normalizePlayerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Checks if an IDP player has already been drafted based on the effective draft picks.
 */
export function getDraftedIdpNames(effectivePicks: readonly Pick[]): Set<string> {
  const drafted = new Set<string>();
  for (const pick of effectivePicks) {
    if (pick.providerPlayerName) {
      drafted.add(normalizePlayerName(pick.providerPlayerName));
    }
  }
  return drafted;
}

/**
 * Filter and search IDP players by query string.
 */
export function searchIdpPlayers(players: readonly IdpPlayer[], query: string): IdpPlayer[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...players];
  return players.filter((p) =>
    p.name.toLowerCase().includes(q) ||
    p.team.toLowerCase().includes(q) ||
    p.pos.toLowerCase().includes(q)
  );
}

/**
 * Look up an IDP player by either synthetic id ('idp-d-1') or sleeperId.
 */
export function getIdpPlayerById(id: string): IdpPlayer | undefined {
  const all = loadAllIdpPlayers();
  return all.find((p) => p.id === id || p.sleeperId === id);
}
