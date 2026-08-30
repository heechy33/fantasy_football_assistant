import type { EspnLiveSnapshot } from '../../../shared/types';
import { resolveEspnPlayer, type EspnPlayerIndex } from './espn';
import { parseEspnDomPickRow } from './espnDom';

/** Crosswalk-join-only confirmation needs at least this many independently agreeing joins — a
 * single join with no board-depth corroboration is not enough evidence on its own (a bad crosswalk
 * match, however rare, would otherwise silently confirm a wrong offset). Board-depth-corroborated
 * confirmation only needs one agreeing join (see 'corroborated' below). */
const MIN_JOINS_WITHOUT_BOARD_DEPTH = 2;

/** A NON-ZERO detail-alignment must be corroborated by at least this many detail-history rows
 * beyond the aligned window itself (2026-08-28) — a window that consumes (almost) the entire
 * truncated history is only trivially "unique" because there was nowhere else for it to slide to,
 * not because the surrounding sequence actually confirms it. Offset 0 is exempt: the equal-length,
 * from-pick-1 case (detailHistory.length === streamPicks.length) is legitimate and has no room for
 * this margin by construction. */
const MIN_ALIGNMENT_MARGIN = 2;

export interface EspnStreamOffset {
  /** absoluteOverall = EspnLivePick.overall + offset. Null until confirmed. */
  offset: number | null;
  confirmed: boolean;
  /** 'board-empty': the board was confirmed empty (sampled) when the stream started, offset 0, no
   *  crosswalk work needed -- the normal from-pick-1 case.
   *  'corroborated': a non-zero board-depth candidate (domMaxAtStreamStart, or the on-the-clock
   *  reading) agrees with at least one crosswalk join -- the late-attach case.
   *  'crosswalk-join': no usable board-depth signal, but >= 2 independent crosswalk joins agree. */
  source: 'board-empty' | 'corroborated' | 'crosswalk-join' | 'detail-alignment' | null;
  /** Number of stream picks that successfully joined to a DOM row via a shared resolved playerId. */
  joins: number;
  /** Distinct offset values implied by those joins. >1 means contradictory evidence -- never
   * confirm, regardless of what board-depth says. */
  distinctCandidates: number;
  reason: string | null;
}

const UNCONFIRMED = (reason: string, joins = 0, distinctCandidates = 0): EspnStreamOffset =>
  ({ offset: null, confirmed: false, source: null, joins, distinctCandidates, reason });

/**
 * Derives the absolute-pick-number offset for an ESPN live stream: `absoluteOverall =
 * EspnLivePick.overall + offset`. Two independent estimates must agree before anything is trusted
 * (see PLAN "The core idea" / "Step 6"):
 *
 * 1. Board-depth — `live.domMaxAtStreamStart`, stamped by the extension the instant the first
 *    SELECTED landed (from the DOM's pick-number ticker and/or its on-the-clock reading). A
 *    confirmed-empty board (`domSampledBeforeStream === true` and the depth is 0) is trusted alone,
 *    since that is the normal from-pick-1 case and must not sit unattributed waiting for joins. Any
 *    NON-zero board-depth candidate, or a zero reading that was never actually confirmed sampled
 *    (the DOM-reconcile-vs-first-SELECTED race), requires join corroboration before it is trusted —
 *    the DOM can read 1 pick ahead of the socket, so board-depth alone is never enough on its own
 *    once it's non-zero.
 * 2. Crosswalk joins — a DOM row's resolved `playerId` matched against a stream pick's resolved
 *    `playerId` (now including the D/ST negative-id tier, so D/ST picks contribute evidence too)
 *    implies `offset = domRow.pickNumber - stream.overall`. Any two joins that disagree make the
 *    whole result unconfirmable, regardless of what board-depth says.
 */
export function deriveEspnStreamOffset(live: EspnLiveSnapshot | null, index: EspnPlayerIndex): EspnStreamOffset {
  if (!live || live.streamPicks.length === 0) return UNCONFIRMED('no stream picks yet');

  // Board-depth candidate. A confirmed-empty (sampled) board is the only case a plain `0` reading is
  // trusted; an unsampled `0` is indistinguishable from "we never looked" and must not false-confirm.
  const domMaxAtStreamStart = live.domMaxAtStreamStart ?? null;
  const boardEmpty = domMaxAtStreamStart === 0 && live.domSampledBeforeStream === true;
  const boardDepthCandidate = domMaxAtStreamStart != null && domMaxAtStreamStart > 0 ? domMaxAtStreamStart : null;

  // Crosswalk joins: resolve every DOM row through the DOM-only tiers (2-4: D/ST-by-team,
  // name+position+team, name+position -- no id, so tier 1/1.5 can never fire here), and every stream
  // pick through the id-only tiers (1: ids.espn, 1.5: the D/ST negative-id formula -- no name/team
  // passed, so tiers 2-4 can never fire there). A playerId that maps to more than one DOM pick number
  // is ambiguous and dropped rather than trusted.
  const domPickNumberByPlayerId = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const dom of live.domPicks ?? []) {
    const row = parseEspnDomPickRow(dom.text, dom.pickNumber);
    if (!row) continue;
    const resolved = resolveEspnPlayer(index, { providerPlayerId: '', name: row.name, position: row.position, teamText: row.teamAbbrev });
    if (!resolved.playerId || ambiguous.has(resolved.playerId)) continue;
    const existing = domPickNumberByPlayerId.get(resolved.playerId);
    if (existing != null && existing !== dom.pickNumber) {
      domPickNumberByPlayerId.delete(resolved.playerId);
      ambiguous.add(resolved.playerId);
      continue;
    }
    domPickNumberByPlayerId.set(resolved.playerId, dom.pickNumber);
  }

  const candidates: number[] = [];
  for (const stream of live.streamPicks) {
    const resolved = resolveEspnPlayer(index, { providerPlayerId: stream.playerId });
    if (!resolved.playerId) continue;
    const domPickNumber = domPickNumberByPlayerId.get(resolved.playerId);
    if (domPickNumber == null) continue;
    candidates.push(domPickNumber - stream.overall);
  }
  const joins = candidates.length;
  const distinctCandidates = new Set(candidates).size;
  const joinOffset = distinctCandidates === 1 ? candidates[0]! : null;

  if (distinctCandidates > 1) {
    return UNCONFIRMED(`crosswalk joins disagree on the offset (${[...new Set(candidates)].join(', ')})`, joins, distinctCandidates);
  }
  if (joinOffset != null && joinOffset < 0) {
    return UNCONFIRMED(`a crosswalk join implies a negative offset (${joinOffset}) -- the DOM cannot lag the stream by a whole pick`, joins, distinctCandidates);
  }

  // Detail-alignment joins (2026-08-28 mock drafts): autopick mocks send SELECTED playerId '-1',
  // so player-id crosswalk joins can never fire. But the stream's team-id sequence and ESPN's own
  // mDraftDetail history's team-id sequence must align at exactly ONE offset when both are present
  // — offset evidence that needs no player ids at all. The snake order makes the sequence
  // non-periodic (round 2 runs reversed), so a unique alignment is strong evidence; it also
  // outranks a one-shot board-depth ticker reading (the DOM can read a pick ahead of the socket).
  const detailHistory = live.detailPicks ?? [];
  if (detailHistory.length > 0) {
    const alignments: number[] = [];
    for (let o = 0; o + live.streamPicks.length <= detailHistory.length; o += 1) {
      let matches = true;
      for (let i = 0; i < live.streamPicks.length; i += 1) {
        const teamId = detailHistory[o + i]!.teamId;
        if (teamId == null || teamId === '' || String(teamId) !== String(live.streamPicks[i]!.slot)) { matches = false; break; }
      }
      if (matches) alignments.push(o);
    }
    if (alignments.length === 1) {
      const aligned = alignments[0]!;
      if (boardEmpty && aligned !== 0) {
        return UNCONFIRMED(`the board was confirmed empty at stream start, but the detail-history alignment implies offset ${aligned} — trusting neither`, joins, distinctCandidates);
      }
      // A non-zero alignment must be corroborated by margin beyond the window itself, not just be
      // the only offset that happened to fit (see MIN_ALIGNMENT_MARGIN's doc).
      if (aligned !== 0 && detailHistory.length - live.streamPicks.length < MIN_ALIGNMENT_MARGIN) {
        return UNCONFIRMED(`the detail-history alignment (offset ${aligned}) fits with no corroborating margin (${detailHistory.length} history rows for ${live.streamPicks.length} stream picks) -- trusting it would be indistinguishable from a padded/undrafted slate tail`, joins, distinctCandidates);
      }
      return { offset: aligned, confirmed: true, source: 'detail-alignment', joins, distinctCandidates, reason: null };
    }
  }

  if (boardEmpty) {
    if (joinOffset != null && joinOffset !== 0) {
      return UNCONFIRMED(`the board was confirmed empty at stream start, but a crosswalk join implies offset ${joinOffset} -- conflicting evidence, trusting neither`, joins, distinctCandidates);
    }
    return { offset: 0, confirmed: true, source: 'board-empty', joins, distinctCandidates, reason: null };
  }

  if (boardDepthCandidate != null) {
    if (joinOffset == null) {
      return UNCONFIRMED(`the board was ${boardDepthCandidate} picks deep when the stream started, but no crosswalk join has corroborated it yet`, joins, distinctCandidates);
    }
    if (joinOffset !== boardDepthCandidate) {
      return UNCONFIRMED(`the board-depth estimate (${boardDepthCandidate}) and a crosswalk join (${joinOffset}) disagree -- trusting neither`, joins, distinctCandidates);
    }
    return { offset: boardDepthCandidate, confirmed: true, source: 'corroborated', joins, distinctCandidates, reason: null };
  }

  // No board-depth signal at all (domMaxAtStreamStart is null, or it read 0 but was never confirmed
  // sampled -- the DOM-reconcile-vs-first-SELECTED race). Crosswalk joins alone can still confirm,
  // but only with enough independent agreement that a single stray match cannot false-confirm.
  if (joinOffset == null) return UNCONFIRMED('no board-depth signal and no crosswalk joins yet', joins, distinctCandidates);
  if (joins < MIN_JOINS_WITHOUT_BOARD_DEPTH) {
    return UNCONFIRMED(`only ${joins} crosswalk join(s) and no board-depth corroboration -- need at least ${MIN_JOINS_WITHOUT_BOARD_DEPTH}`, joins, distinctCandidates);
  }
  return { offset: joinOffset, confirmed: true, source: 'crosswalk-join', joins, distinctCandidates, reason: null };
}
