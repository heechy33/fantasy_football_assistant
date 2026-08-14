import type { InjuryBodyPartHistory, InjuryReportHistory } from '../../../shared/types';

/**
 * Pure lexicon mapping nflverse's free-text `normalizedBodyPart` strings onto a fixed set of
 * anatomical regions for `PlayerBodyMap`'s SVG figure. Table-driven against the real distribution
 * of labels observed in the committed `data/player-usage.json` (83 distinct strings as of this
 * writing) — see `injuryBodyMap.test.ts`, which asserts every one of them either resolves to a
 * region or lands in `unlocalized`, with zero falling through unclassified. That test is what
 * catches a silent regression the next time nflverse adds a new label.
 */

export type BodyRegion =
  | 'head'
  | 'neck'
  | 'shoulder'
  | 'chest'
  | 'abdomen'
  | 'back'
  | 'upper-arm'
  | 'elbow'
  | 'forearm'
  | 'wrist-hand'
  | 'hip'
  | 'groin'
  | 'thigh'
  | 'knee'
  | 'lower-leg'
  | 'ankle'
  | 'foot';

export type BodySide = 'left' | 'right' | 'unspecified';

export interface BodyMapRegionModel {
  region: BodyRegion;
  side: BodySide;
  episodes: number;
  recurring: boolean;
  reports: InjuryReportHistory[];
  /** 0 = no history (never assigned by buildBodyMapModel), 1-3 = bucketed tint steps. Bucketed
   *  rather than continuous so the legend stays finite and every tint step is contrast-testable. */
  heat: 1 | 2 | 3;
}

export interface BodyMapUnlocalizedEntry {
  /** The individual atomic label that could not be placed — not the full original
   *  `normalizedBodyPart` string, so "knee, illness" surfaces "knee" as a region hit and
   *  "illness" here, rather than losing the knee history to one unmatched compound string. */
  label: string;
  episodes: number;
}

export interface BodyMapModel {
  regions: BodyMapRegionModel[];
  /** Non-injury / administrative / illness entries and anything that fails to resolve. Rendered as
   *  plain text next to the figure, NEVER tinted onto it (CLAUDE.md: never silently drop). */
  unlocalized: BodyMapUnlocalizedEntry[];
}

/** Substring matches (case-insensitive; the source data is already lowercase) that mean "this
 *  label isn't a localizable injury" — administrative notes, illness, or prose asides. */
const DENY_SUBSTRINGS = [
  'illness',
  'cramps',
  'decision',
  'jury duty',
  'personal reasons',
  'did not travel',
  'suspension',
  'protocol evaluation',
];

/** Prose asides (e.g. "Concussion. Tremble has cleared concussion protocol. His game status is a
 *  result of a back injury.") run well past any real body-part label; length is a cheap, reliable
 *  backstop independent of the substring list above. */
const DENY_LENGTH_THRESHOLD = 40;

/** Exact-match synonym folds onto a `BodyRegion`. Keys are the CLEANED atomic part (trimmed,
 *  parenthetical stripped, side prefix stripped) — see `resolveBodyRegion`. */
const REGION_SYNONYMS: Record<string, BodyRegion> = {
  // Direct hits — the raw label already equals the BodyRegion name.
  head: 'head',
  neck: 'neck',
  shoulder: 'shoulder',
  chest: 'chest',
  abdomen: 'abdomen',
  back: 'back',
  'upper-arm': 'upper-arm',
  elbow: 'elbow',
  forearm: 'forearm',
  'wrist-hand': 'wrist-hand',
  hip: 'hip',
  groin: 'groin',
  thigh: 'thigh',
  knee: 'knee',
  'lower-leg': 'lower-leg',
  ankle: 'ankle',
  foot: 'foot',

  // Synonym folds, derived from the real label distribution.
  achilles: 'ankle',
  arm: 'forearm',
  biceps: 'forearm',
  calf: 'lower-leg',
  collarbone: 'chest',
  concussion: 'head',
  eye: 'head',
  face: 'head',
  feet: 'foot',
  fibula: 'lower-leg',
  finger: 'wrist-hand',
  glute: 'hip',
  hamstring: 'thigh',
  hand: 'wrist-hand',
  heel: 'foot',
  hernia: 'abdomen',
  hips: 'hip',
  jaw: 'head',
  kidney: 'abdomen',
  lung: 'abdomen',
  nose: 'head',
  oblique: 'abdomen',
  pectoral: 'chest',
  quadricep: 'thigh',
  rib: 'chest',
  ribs: 'chest',
  shin: 'lower-leg',
  teeth: 'head',
  thumb: 'wrist-hand',
  toe: 'foot',
  tooth: 'head',
  wrist: 'wrist-hand',
};

/** Splits a raw `normalizedBodyPart` string on its `, ` compound-injury separator (e.g.
 *  `"hamstring, abdomen"`, `"right shoulder, rib"`, `"knee, illness"`) into atomic parts. A label
 *  with no comma returns a single-element array unchanged. */
export function splitBodyPartLabel(raw: string): string[] {
  return raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
}

/** True when an atomic part is administrative/illness/prose rather than a localizable injury. */
export function isUnlocalizedLabel(part: string): boolean {
  if (part.length > DENY_LENGTH_THRESHOLD) return true;
  return DENY_SUBSTRINGS.some((needle) => part.includes(needle));
}

/** Strips a leading ordinal-injury-count annotation, e.g. `"third injury: ankle"` -> `"ankle"`. Real
 *  nflverse data occasionally numbers repeat injuries this way within a single report label. */
const ORDINAL_INJURY_PREFIX = /^\w+ injury:\s*/;

/**
 * Resolves a single ATOMIC body-part label (already split on `, ` — see `splitBodyPartLabel`; this
 * function does not itself split a compound string) to a region and side, or `null` when nothing in
 * the lexicon matches. Cleaning order: trim -> strip a trailing parenthetical annotation (e.g.
 * `"arm (laceration)"` -> `"arm"`) -> strip a leading ordinal-injury prefix (e.g.
 * `"third injury: ankle"` -> `"ankle"`) -> strip a leading `left `/`right ` side prefix -> exact-match
 * lookup.
 */
export function resolveBodyRegion(part: string): { region: BodyRegion; side: BodySide } | null {
  let cleaned = part.trim().replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(ORDINAL_INJURY_PREFIX, '').trim();

  let side: BodySide = 'unspecified';
  if (cleaned.startsWith('left ')) {
    side = 'left';
    cleaned = cleaned.slice('left '.length).trim();
  } else if (cleaned.startsWith('right ')) {
    side = 'right';
    cleaned = cleaned.slice('right '.length).trim();
  }

  const region = REGION_SYNONYMS[cleaned];
  return region ? { region, side } : null;
}

function heatFor(episodes: number, recurring: boolean): 1 | 2 | 3 {
  if (recurring || episodes >= 3) return 3;
  if (episodes === 2) return 2;
  return 1;
}

/**
 * Builds the full body-map model from a player's `injuryHistory`. Each `InjuryBodyPartHistory`
 * entry's `episodes`/`recurring`/`reports` are attributed to EVERY region its (possibly compound)
 * label resolves to — a `"hamstring, abdomen"` entry with 2 episodes contributes 2 episodes to both
 * the thigh and abdomen regions, since the same reported episodes affected both. When two entries
 * resolve to the same `(region, side)` (e.g. a `"knee"` entry and a separate `"left knee"` entry —
 * different sides, so they'd stay distinct; two entries that both resolve to plain `"knee"` would
 * merge), their episodes/reports are combined and `recurring` is OR'd.
 */
export function buildBodyMapModel(injuryHistory: InjuryBodyPartHistory[]): BodyMapModel {
  const regionsByKey = new Map<string, Omit<BodyMapRegionModel, 'heat'> & { heat?: never }>();
  const unlocalized: BodyMapUnlocalizedEntry[] = [];

  for (const entry of injuryHistory) {
    const parts = splitBodyPartLabel(entry.normalizedBodyPart);
    for (const part of parts) {
      if (isUnlocalizedLabel(part)) {
        unlocalized.push({ label: part, episodes: entry.episodes });
        continue;
      }
      const resolved = resolveBodyRegion(part);
      if (!resolved) {
        // Never silently drop — an unrecognized label still surfaces as text.
        unlocalized.push({ label: part, episodes: entry.episodes });
        continue;
      }
      const key = `${resolved.region}:${resolved.side}`;
      const existing = regionsByKey.get(key);
      if (existing) {
        existing.episodes += entry.episodes;
        existing.recurring = existing.recurring || entry.recurring;
        existing.reports = existing.reports.concat(entry.reports);
      } else {
        regionsByKey.set(key, {
          region: resolved.region,
          side: resolved.side,
          episodes: entry.episodes,
          recurring: entry.recurring,
          reports: [...entry.reports],
        });
      }
    }
  }

  const regions: BodyMapRegionModel[] = Array.from(regionsByKey.values()).map((r) => ({
    ...r,
    heat: heatFor(r.episodes, r.recurring),
  }));

  return { regions, unlocalized };
}
