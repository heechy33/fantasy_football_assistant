import type { PlayerId } from '../../../shared/types';
import type { GuideRow } from './guideBoard';

/**
 * Display-only derivations shared by the Draft Guide's table and draft-grid views. This module
 * MUST stay outside `frontend/src/engine/` (same display-only invariant as
 * `guideProviderColumns.ts` — displayOnlySourceInvariant.test.ts fails CI on any engine file
 * referencing these artifacts) and must never feed ranking math: everything here re-derives
 * presentation facts from rows the engine already produced.
 */

/**
 * Dense 1-based rank WITHIN each position (the `RB1` chip), ordered by the engine's projected
 * points desc. Players without a projection sort after all projected peers (engine order, then
 * name, keeps it deterministic) — they still get a rank, they just never lead. K/DEF included.
 */
export function buildPositionRankByPlayer(rows: readonly GuideRow[]): ReadonlyMap<PlayerId, number> {
  const rowsByPosition = new Map<string, GuideRow[]>();
  for (const row of rows) {
    const position = row.player?.position;
    if (position == null) continue;
    const list = rowsByPosition.get(position);
    if (list) list.push(row);
    else rowsByPosition.set(position, [row]);
  }

  const ranks = new Map<PlayerId, number>();
  for (const list of rowsByPosition.values()) {
    const projected = Number.NEGATIVE_INFINITY;
    const unprojected = Number.POSITIVE_INFINITY;
    const ordered = [...list].sort((a, b) =>
      (b.recommendation?.projectedPoints ?? projected) - (a.recommendation?.projectedPoints ?? projected)
      || (a.engineRank ?? unprojected) - (b.engineRank ?? unprojected)
      || (a.player?.name ?? a.playerId).localeCompare(b.player?.name ?? b.playerId));
    ordered.forEach((row, index) => ranks.set(row.playerId, index + 1));
  }
  return ranks;
}

/** The chip label (`RB1`) for a row, or null when the row has no position to rank within. */
export function positionRankLabel(
  row: GuideRow,
  positionRankByPlayer: ReadonlyMap<PlayerId, number>,
): string | null {
  const position = row.player?.position;
  const rank = positionRankByPlayer.get(row.playerId);
  return position != null && rank != null ? `${position}${rank}` : null;
}

/** One provider column of the STACKED-style table: the lane's identity plus the per-player maps
 * its cells read. Built from `ProviderColumn` in the route; unavailable lanes keep their slot
 * (honest absence — the column renders em-dashes, it never vanishes). */
export interface GuideLane {
  key: string;
  label: string;
  brandKey: string;
  status: 'ready' | 'unavailable';
  rankByPlayer: ReadonlyMap<PlayerId, number>;
  adpByPlayer: ReadonlyMap<PlayerId, number>;
}

/** One lane cell: the lane's raw ADP plus its delta vs the ANCHOR rank — disagreement between
 * the lane and the anchor, never superiority (the table's title/disclaimer carries the wording). */
export interface GuideLaneCell {
  adp: number | null;
  delta: number | null;
}

export function buildLaneCell(lane: GuideLane, playerId: PlayerId, anchorRank: number | null): GuideLaneCell {
  if (lane.status !== 'ready') return { adp: null, delta: null };
  const adp = lane.adpByPlayer.get(playerId);
  if (adp == null) return { adp: null, delta: null };
  return { adp, delta: anchorRank == null ? null : adp - anchorRank };
}

/** RFC-4180-ish CSV for the Export button: quotes only cells that need it, CRLF-safe by
 * construction (values never contain newlines — they come from fixed formatters). */
export function serializeGuideCsv(
  rows: readonly GuideRow[],
  columns: readonly { header: string; value: (row: GuideRow) => string }[],
): string {
  const escape = (value: string): string => (
    /[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  );
  const lines = [columns.map((column) => escape(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escape(column.value(row))).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** "14h ago"-style age for the header's last-updated line. Accepts the manifest's ISO timestamp
 * or epoch ms. Null when the artifact never reported a fetch time (the header line then renders
 * nothing — never a fake 'just now'). */
export function formatRelativeAge(fetchedAt: string | number | null | undefined, nowMs: number): string | null {
  const ms = typeof fetchedAt === 'string' ? Date.parse(fetchedAt) : fetchedAt;
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.max(0, Math.round((nowMs - ms) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}