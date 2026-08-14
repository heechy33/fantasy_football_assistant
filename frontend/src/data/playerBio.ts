import type { PlayerMeta } from '../../../shared/types';

/** `77` inches → `6'5"`. Null/non-finite stays hidden. */
export function formatHeight(inches: number | null | undefined): string | null {
  if (inches == null || !Number.isFinite(inches) || inches <= 0) return null;
  const whole = Math.round(inches);
  const feet = Math.floor(whole / 12);
  const rest = whole % 12;
  return `${feet}'${rest}"`;
}

export function formatWeight(lbs: number | null | undefined): string | null {
  if (lbs == null || !Number.isFinite(lbs) || lbs <= 0) return null;
  return `${Math.round(lbs)} lbs`;
}

export function formatYearsExp(yearsExp: number | null | undefined): string | null {
  if (yearsExp == null || !Number.isFinite(yearsExp) || yearsExp < 0) return null;
  if (yearsExp === 0) return 'Rookie';
  return `${Math.round(yearsExp)} yrs`;
}

/** `2018 · Rd 1 · Pk 7`. Omits the whole line when year is missing; round/pick are optional extras. */
export function formatDraft(
  year: number | null | undefined,
  round: number | null | undefined,
  pick: number | null | undefined,
): string | null {
  if (year == null || !Number.isFinite(year) || year < 1960) return null;
  const parts = [String(Math.round(year))];
  if (round != null && Number.isFinite(round) && round > 0) {
    parts.push(`Rd ${Math.round(round)}`);
  }
  if (pick != null && Number.isFinite(pick) && pick > 0) {
    parts.push(`Pk ${Math.round(pick)}`);
  }
  return parts.join(' · ');
}

/** `2.01 (2022)` — compact draft-pick chip for the hero (`round.pick`, year in parens).
 * Falls back to a bare year when round/pick are both missing (the same fallback
 * `formatDraft` gives), so a year-only record still surfaces; `formatDraft` keeps the
 * full `2018 · Rd 1 · Pk 7` line for Diagnostics. */
export function formatDraftPick(
  round: number | null | undefined,
  pick: number | null | undefined,
  year: number | null | undefined,
): string | null {
  const roundPart = round != null && Number.isFinite(round) && round > 0 ? String(Math.round(round)) : null;
  const pickPart = pick != null && Number.isFinite(pick) && pick > 0 ? String(Math.round(pick)).padStart(2, '0') : null;
  const core = roundPart != null && pickPart != null ? `${roundPart}.${pickPart}` : (roundPart ?? pickPart);
  if (core == null) {
    if (year == null || !Number.isFinite(year) || year < 1960) return null;
    return String(Math.round(year));
  }
  if (year != null && Number.isFinite(year) && year >= 1960) return `${core} (${Math.round(year)})`;
  return core;
}

export interface PlayerBioItem {
  label: string;
  value: string;
}

/** Skill-player profile chips. DEF / missing fields are omitted rather than shown as n/a. */
export function playerBioItems(player: PlayerMeta): PlayerBioItem[] {
  const items: PlayerBioItem[] = [];
  const isDef = player.position === 'DEF';

  // Reference order: Age, Height, Weight, Experience, Draft Pick on the first
  // row; Bye, No., College wrap onto the second. The hero uses the compact
  // draft-pick form; Diagnostics keeps the full formatDraft line.
  if (player.age != null && Number.isFinite(player.age)) {
    items.push({ label: 'Age', value: String(player.age) });
  }
  if (!isDef) {
    const height = formatHeight(player.heightInches);
    if (height) items.push({ label: 'Height', value: height });
    const weight = formatWeight(player.weightLbs);
    if (weight) items.push({ label: 'Weight', value: weight });
  }
  const exp = formatYearsExp(player.yearsExp);
  if (exp) items.push({ label: 'Experience', value: exp });
  if (!isDef) {
    const draftPick = formatDraftPick(player.draftRound, player.draftPick, player.draftYear);
    if (draftPick) items.push({ label: 'Draft Pick', value: draftPick });
  }
  if (player.byeWeek != null && Number.isFinite(player.byeWeek)) {
    items.push({ label: 'Bye', value: String(player.byeWeek) });
  }
  if (!isDef && player.jerseyNumber != null && Number.isFinite(player.jerseyNumber)) {
    items.push({ label: 'No.', value: `#${player.jerseyNumber}` });
  }
  if (!isDef && player.college?.trim()) {
    items.push({ label: 'College', value: player.college.trim() });
  }
  return items;
}
