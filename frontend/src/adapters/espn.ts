import type { DraftInit, DraftProviderAdapter, EspnDetailPick, EspnDomPick, EspnLivePick, EspnLiveSnapshot, Pick, PlayerId, PlayerMeta } from '../../../shared/types';
import { loadPlayerPool } from '../data/loadPlayerPool';
import { computeOnTheClock, deriveDraftStatus, picksMade, roundForOverall, slotForOverall } from './draftOrder';
import { canonicalTeam, teamFromFranchiseName, teamFromProTeamId } from './espnTeams';
import { deriveEspnDraftOrder, streamPickPosition, type EspnDraftOrder } from './espnDraftOrder';
import { parseEspnDomPickRow } from './espnDom';
import { deriveEspnStreamOffset, type EspnStreamOffset } from './espnOffset';

export interface EspnPickCandidate {
  /** ESPN player id from the SELECTED frame (or a DOM row's data-player-id). */
  providerPlayerId: string;
  /** Player name from the DOM pick row — the visible fallback when nothing resolves. */
  name?: string | null;
  /** ESPN position id (1=QB 2=RB 3=WR 4=TE 5=K 16=DEF) or abbreviation, when the DOM/correlation provides it. */
  position?: string | number | null;
  /** ESPN proTeamId, when the pool payload provides it. */
  proTeamId?: number | null;
  /** NFL team text from the DOM pick row (e.g. "Commanders" or "WAS"). */
  teamText?: string | null;
}

export interface EspnResolveResult {
  playerId: PlayerId | null;
  providerPlayerName: string | null;
}

export interface EspnPlayerIndex {
  byEspnId: Map<string, PlayerMeta>;
  byDefTeam: Map<string, PlayerMeta>;
  byNamePositionTeam: Map<string, PlayerMeta[]>;
  byNamePosition: Map<string, PlayerMeta[]>;
}

const ESPN_POSITION_BY_ID: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };

/** ESPN D/ST synthetic ids are `-(16000 + proTeamId)` -- derived and cross-verified against the
 * committed crosswalk from a real recon capture (2026-08-15, league 1488579454): 7 SELECTED frames
 * with negative ids, 4 independently confirmed against the DOM pick-row team text (e.g. `-16034` ->
 * proTeamId 34 -> HOU, matching DOM row "142Texans D/STHOU..."), 0 contradictions. Bounded to
 * `PRO_TEAM_ABBR`'s real id range so an unrelated small negative id (older/synthetic test ids like
 * `-5000`) never false-positives into this tier. See PLAN "Finding C" for the full derivation. */
function proTeamIdFromEspnDstId(providerPlayerId: string): number | null {
  if (!/^-\d+$/.test(providerPlayerId)) return null;
  const proTeamId = Math.abs(Number(providerPlayerId)) - 16000;
  return proTeamId >= 1 && proTeamId <= 40 ? proTeamId : null;
}

function foldName(name: string): string {
  return name.trim().toLowerCase().replace(/[.'’]/g, '').replace(/\s+/g, ' ');
}

function positionKey(position: string | number | null | undefined): string | null {
  if (position == null) return null;
  if (typeof position === 'number') return ESPN_POSITION_BY_ID[position] ?? null;
  const upper = position.trim().toUpperCase();
  if (upper === 'D/ST' || upper === 'DST') return 'DEF';
  return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(upper) ? upper : null;
}

/** Build the lookup indexes once per player-pool load (players.json is memoized). */
export function buildEspnPlayerIndex(players: PlayerMeta[]): EspnPlayerIndex {
  const byEspnId = new Map<string, PlayerMeta>();
  const byDefTeam = new Map<string, PlayerMeta>();
  const byNamePositionTeam = new Map<string, PlayerMeta[]>();
  const byNamePosition = new Map<string, PlayerMeta[]>();
  const push = (map: Map<string, PlayerMeta[]>, key: string, player: PlayerMeta) => {
    const bucket = map.get(key);
    if (bucket) bucket.push(player); else map.set(key, [player]);
  };
  for (const player of players) {
    if (player.ids?.espn) byEspnId.set(String(player.ids.espn), player);
    if (player.position === 'DEF' && player.team) {
      const key = canonicalTeam(player.team) ?? player.team;
      if (!byDefTeam.has(key)) byDefTeam.set(key, player);
    }
    const position = player.position ?? '?';
    const team = canonicalTeam(player.team) ?? '';
    push(byNamePositionTeam, `${foldName(player.name)}|${position}|${team}`, player);
    push(byNamePosition, `${foldName(player.name)}|${position}`, player);
  }
  return { byEspnId, byDefTeam, byNamePositionTeam, byNamePosition };
}

function uniquePlayer(bucket: PlayerMeta[] | undefined): PlayerMeta | null {
  return bucket && bucket.length === 1 ? bucket[0] ?? null : null;
}

/**
 * Draft-day resolution order:
 * 1. Exact ids.espn match (covers 272 of the top 300 by PPR ADP).
 * 1.5. D/ST by the recon-derived negative-id formula (`-(16000 + proTeamId)`) — resolves straight
 *      off the SELECTED frame's own playerId, no DOM/name/position hint needed. This is what makes
 *      D/ST picks joinable for the Step 6 offset derivation even before any DOM row exists for them.
 * 2. D/ST by team identity from DOM/proTeamId hints — for a D/ST id this tier's formula doesn't
 *    (yet) explain, or an older/synthetic test id. The team comes from proTeamId and/or the DOM
 *    pick-row team text, canonicalized (WSH -> WAS).
 * 3. Unique name + position + team, then unique name + position.
 * 4. playerId: null with the DOM name retained — never silently drop a pick.
 */
export function resolveEspnPlayer(index: EspnPlayerIndex, candidate: EspnPickCandidate): EspnResolveResult {
  const providerPlayerName = candidate.name ?? null;

  const direct = index.byEspnId.get(candidate.providerPlayerId);
  if (direct) return { playerId: direct.playerId, providerPlayerName: providerPlayerName ?? direct.name };

  const dstProTeamId = proTeamIdFromEspnDstId(candidate.providerPlayerId);
  if (dstProTeamId != null) {
    const team = teamFromProTeamId(dstProTeamId);
    if (team) {
      const def = index.byDefTeam.get(team);
      if (def) return { playerId: def.playerId, providerPlayerName: providerPlayerName ?? def.name };
    }
  }

  const position = positionKey(candidate.position);
  if (position === 'DEF') {
    const team = teamFromProTeamId(candidate.proTeamId)
      ?? (candidate.teamText ? teamFromFranchiseName(candidate.teamText) : null)
      ?? (candidate.teamText ? canonicalTeam(candidate.teamText) : null);
    if (team) {
      const def = index.byDefTeam.get(team);
      if (def) return { playerId: def.playerId, providerPlayerName: providerPlayerName ?? def.name };
    }
  }

  if (candidate.name && position) {
    const folded = foldName(candidate.name);
    const team = teamFromProTeamId(candidate.proTeamId)
      ?? (candidate.teamText ? teamFromFranchiseName(candidate.teamText) : null)
      ?? (candidate.teamText ? canonicalTeam(candidate.teamText) : null);
    if (team) {
      const hit = uniquePlayer(index.byNamePositionTeam.get(`${folded}|${position}|${team}`));
      if (hit) return { playerId: hit.playerId, providerPlayerName: candidate.name };
    }
    const hit = uniquePlayer(index.byNamePosition.get(`${folded}|${position}`));
    if (hit) return { playerId: hit.playerId, providerPlayerName: candidate.name };
  }

  return { playerId: null, providerPlayerName };
}

// ---------------------------------------------------------------------------
// DraftProviderAdapter (narrow, per the ESPN plan's correction #3) — the bridge
// merges the manual form's settings with the relayed snapshot and normalizes the
// live pick stream locally. No upstream GET, no fake in-season methods.
// ---------------------------------------------------------------------------

/** Merge the manual form's DraftInit with the relayed live snapshot: ESPN stamps provider/leagueId.
 * The form's typed value IS the draft position (ESPN reveals the order pre-draft) and stays
 * authoritative — JOINED/TOKEN `mySlot` is the ESPN league *team id* (recon 2026-08-15), which is
 * not a draft position and must never override it. slotToTeam stays the synthetic slot identity, so
 * myTeamId is non-null from pick 1 and boardKind never falls to 'no-seat' during round 1. */
export function mergeBridgeInit(base: DraftInit, live: EspnLiveSnapshot | null): DraftInit {
  return {
    ...base,
    provider: 'espn',
    leagueId: live?.leagueId ?? base.leagueId,
    mySlot: base.mySlot,
    myTeamId: base.mySlot != null ? String(base.mySlot) : null,
    slotToTeamName: enrichSlotToTeamNames(base, live),
  };
}

/** For contexts with no player-pool index available synchronously (`DraftProviderAdapter.init` is a
 * synchronous contract, and `useEspnBridge`'s seat-mismatch check runs outside the async `picks()`
 * path) — an empty index makes every crosswalk join impossible in `deriveEspnStreamOffset`, so this
 * can only ever confirm the board-empty (offset 0) case. That covers the common case (early in the
 * draft / before pick 1, exactly when seat-mismatch matters most and team-name enrichment starts);
 * a late attach simply stays unconfirmed here until `espnAdapter.picks()` — which DOES have the real
 * index — resolves attribution elsewhere. Never a correctness issue for callers that only use this
 * for display names or an advisory seat-mismatch warning, never for `Pick.slot`/`teamId`. */
const EMPTY_ESPN_PLAYER_INDEX: EspnPlayerIndex = buildEspnPlayerIndex([]);

/** See `EMPTY_ESPN_PLAYER_INDEX`. Exported so callers with no async index handy (useEspnBridge's
 * synchronous seat-mismatch memo) can derive the same board-empty-only offset without duplicating
 * the empty-index construction. */
export function deriveEspnStreamOffsetSync(live: EspnLiveSnapshot | null): EspnStreamOffset {
  return deriveEspnStreamOffset(live, EMPTY_ESPN_PLAYER_INDEX);
}

/** Fill slotToTeamName[position] from the DOM pick rows (Step B): a row's fantasy team name belongs
 * to the team that made pick `pickNumber`, whose draft position comes from the derived order. Rows
 * that don't join to a stream pick (or aren't parseable) are skipped — the synthetic "Team N" names
 * from the manual form stay in place. */
function enrichSlotToTeamNames(base: DraftInit, live: EspnLiveSnapshot | null): Record<number, string> {
  const names = base.slotToTeamName ? { ...base.slotToTeamName } : {};
  if (!live || !Array.isArray(live.domPicks) || live.domPicks.length === 0) return names;
  const offset = deriveEspnStreamOffsetSync(live);
  if (!offset.confirmed || offset.offset == null) return names;
  const order = deriveEspnDraftOrder(live.streamPicks, base.teams, base.draftType, offset);
  if (!order.reliable) return names;
  const streamByAbsolute = new Map<number, EspnLivePick>();
  for (const stream of live.streamPicks) streamByAbsolute.set(stream.overall + offset.offset, stream);
  for (const dom of live.domPicks) {
    const stream = streamByAbsolute.get(dom.pickNumber);
    if (!stream) continue;
    const row = parseEspnDomPickRow(dom.text, dom.pickNumber);
    if (!row?.fantasyTeamName) continue;
    const position = streamPickPosition(order, stream, offset.offset, base.draftType, base.teams);
    if (position == null || position < 1 || position > base.teams) continue;
    // ESPN's default "Team <id>" name and the trailing round/points/undo noise concatenate with no
    // delimiter (e.g. "Team 7133100.3undo"), so the generic trailing-digit strip in espnDom.ts
    // cannot tell where the name's own digit ends and the noise begins — it collapses to the
    // degenerate literal "Team". Recover the honest default name from the pick's own known ESPN
    // team id (stream.slot) instead of re-parsing ambiguous concatenated digits. A genuinely custom
    // name never collapses to exactly "Team" and is left untouched.
    names[position] = row.fantasyTeamName === 'Team' ? `Team ${stream.slot}` : row.fantasyTeamName;
  }
  return names;
}

/**
 * Self-calibrates a SELECTED-frame posToken -> canonical position mapping from picks that already
 * resolved through ids.espn (the direct tier) in this same stream, rather than hard-decoding an
 * unverified ESPN enum (recon has only observed raw values 2, 4, 5 with no documented meaning). A
 * token that maps to more than one distinct position across resolved picks is contradictory
 * evidence and is discarded rather than guessed. Note: D/ST picks essentially never resolve via the
 * direct tier (their SELECTED playerId is a negative synthetic, never the crosswalk's ids.espn), so
 * in practice this mainly calibrates skill positions/K — D/ST resolution still depends on Step B's
 * DOM enrichment; this is a diagnostic hedge, not a D/ST-resolution path on its own.
 */
export function learnPosTokenPositions(streamPicks: readonly EspnLivePick[], index: EspnPlayerIndex): Map<number, string> {
  const observed = new Map<number, Set<string>>();
  for (const pick of streamPicks) {
    if (pick.posToken == null) continue;
    const player = index.byEspnId.get(pick.playerId);
    if (!player?.position) continue;
    const positions = observed.get(pick.posToken) ?? new Set<string>();
    positions.add(player.position);
    observed.set(pick.posToken, positions);
  }
  const learned = new Map<number, string>();
  for (const [token, positions] of observed) {
    if (positions.size === 1) learned.set(token, [...positions][0]!);
  }
  return learned;
}

/** Does this detail-history row carry a real identity (a usable player id or a name), rather than
 * ESPN's pre-generated slate padding (teamId set, playerId '-1'/'0'/'', no name)? Prefers the
 * extension's own `identified` flag (normalize.js's `applyDetailPicks`); falls back to checking the
 * raw fields for a snapshot captured before that flag existed. */
export function hasDetailIdentity(entry: EspnDetailPick): boolean {
  if (entry.identified != null) return entry.identified;
  const idUsable = entry.playerId !== '' && entry.playerId !== '0' && entry.playerId !== '-1';
  return idUsable || Boolean(entry.name);
}

/** Drop any pick whose resolved playerId already appears earlier in `list` — a player can only be
 * drafted once, so a second occurrence is always a numbering disagreement between the live stream
 * and the detail history (the screenshot bug: the same player logged at two different `overall`s).
 * `list` must already be sorted by `overall`; the earlier (lower-overall) copy is kept since the
 * detail history — when it wins that copy — owns absolute numbering. Unresolved picks
 * (`playerId: null`) are never deduped against each other. */
function dedupeByResolvedPlayer(list: Pick[]): Pick[] {
  const seen = new Set<PlayerId>();
  const result: Pick[] = [];
  for (const pick of list) {
    if (pick.playerId != null) {
      if (seen.has(pick.playerId)) continue;
      seen.add(pick.playerId);
    }
    result.push(pick);
  }
  return result;
}

/** Normalize the relayed stream into canonical Pick[]. Unresolved PLAYERS keep `playerId: null` and
 * any available name — never silently dropped (CLAUDE.md). Unresolved ATTRIBUTION (Step 6) is the
 * same principle applied to seat/position: the drafted player still comes off the board (the pick
 * still appears, still resolved where possible) but `slot`/`teamId` are zeroed and `unattributed:
 * true` is set rather than laundering the ESPN league team id (`stream.slot`) into an apparently-
 * valid draft position — the pre-Step-6 `?? stream.slot` fallback this replaces could attribute a
 * pick to a nonexistent team, corrupting MyTeamRail and userPickBoundaries. Positions come from the
 * CONFIRMED absolute-pick offset (`espnOffset.ts`), not arrival order — a stream that attaches
 * mid-draft has no draft-position information in arrival order at all (see espnDraftOrder.ts). The
 * raw team id is preserved on providerTeamId regardless of attribution, and DOM-enriched
 * name/position/team feed resolveEspnPlayer's tiers 2–4 (D/ST, unmatched tail); the self-calibrated
 * posToken position (learnPosTokenPositions) fills in only when DOM has no row for this pick yet. */
export function bridgePicksToNormalized(init: DraftInit, index: EspnPlayerIndex, live: EspnLiveSnapshot | null): Pick[] {
  if (!live) return [];
  const offset = deriveEspnStreamOffset(live, index);
  const order = deriveEspnDraftOrder(live.streamPicks, init.teams, init.draftType, offset);
  const confirmedOffset = offset.confirmed ? offset.offset : null;
  const domByAbsolute = new Map<number, EspnDomPick>();
  for (const dom of live.domPicks ?? []) domByAbsolute.set(dom.pickNumber, dom);
  const posTokenPositions = learnPosTokenPositions(live.streamPicks, index);
  const picks: Pick[] = live.streamPicks.map((stream) => {
    const absolute = confirmedOffset != null ? stream.overall + confirmedOffset : null;
    const dom = absolute != null ? domByAbsolute.get(absolute) : undefined;
    const row = dom ? parseEspnDomPickRow(dom.text, dom.pickNumber) : null;
    const position = streamPickPosition(order, stream, confirmedOffset, init.draftType, init.teams);
    const fallbackPosition = stream.posToken != null ? posTokenPositions.get(stream.posToken) ?? null : null;
    const resolved = resolveEspnPlayer(index, {
      providerPlayerId: stream.playerId,
      name: row?.name ?? null,
      position: row?.position ?? fallbackPosition,
      teamText: row?.teamAbbrev ?? null,
    });
    // `overall` is a display ordinal when unattributed (arrival order — still strictly increasing,
    // since `confirmedOffset` is the same constant for every pick in one call, so it is EITHER
    // applied to all streamPicks or none; never a per-pick mix within a single normalization pass).
    // `unattributed: true` is the signal callers must check before treating it as the true overall.
    const overall = absolute ?? stream.overall;
    return {
      overall,
      round: roundForOverall(init.teams, overall),
      slot: position ?? 0,
      teamId: position != null ? (init.slotToTeam[position] ?? String(position)) : '',
      playerId: resolved.playerId,
      providerPlayerId: stream.playerId,
      providerPlayerName: resolved.providerPlayerName ?? row?.name ?? undefined,
      providerTeamId: String(stream.slot),
      unattributed: position == null ? true : undefined,
    };
  });
  // Missed-frame self-correction + MOCK-DRAFT identity (2026-08-28). detailPicks is ESPN's OWN
  // full pick history (absolute overalls, re-read by the extension every 30s). When it is
  // contiguous from pick 1 — which it always is for a draft in progress — it is authoritative for
  // BOTH numbering and identity, and it decouples mock drafts (whose autopick SELECTED frames
  // carry the '-1' sentinel and no id at all) from the stream's crosswalk-join offset derivation.
  // Identity resolves through ids.espn when the id is real, otherwise through the DOM pick row
  // joined at the same absolute pick (name tiers) — never guessed. A row with neither resolves to
  // an honest hole rather than an "Unmatched: -1" row.
  const detailList = (live.detailPicks ?? []).slice().sort((a, b) => a.overall - b.overall);
  const detailContiguous = detailList.length > 0 && detailList.every((entry, i) => entry.overall === i + 1);
  // A contiguous-from-1 slate is NOT automatically real history: ESPN pre-generates the full
  // un-drafted snake slate with teamId set and playerId '-1'/no name, and that padding is
  // structurally indistinguishable from a genuine draft's history by contiguity alone. Only treat
  // it as authoritative once at least one row actually carries an identity — otherwise this falls
  // through to the backfill branch below, which already skips unidentified rows individually.
  const detailAuthoritative = detailContiguous && detailList.some((entry) => hasDetailIdentity(entry));
  if (detailAuthoritative) {
    const byOverall = new Map<number, Pick>();
    for (const entry of detailList) {
      const domEntry = domByAbsolute.get(entry.overall);
      const domRow = domEntry ? parseEspnDomPickRow(domEntry.text, domEntry.pickNumber) : null;
      const idUsable = entry.playerId !== '' && entry.playerId !== '0' && entry.playerId !== '-1';
      const resolved = resolveEspnPlayer(index, {
        providerPlayerId: idUsable ? entry.playerId : '',
        name: entry.name ?? domRow?.name ?? null,
        position: entry.position ?? domRow?.position ?? null,
        teamText: entry.proTeam ?? domRow?.teamAbbrev ?? null,
      });
      if (!resolved.playerId && resolved.providerPlayerName == null) continue;
      const slot = slotForOverall(init.draftType, init.teams, entry.overall);
      byOverall.set(entry.overall, {
        overall: entry.overall,
        round: roundForOverall(init.teams, entry.overall),
        slot,
        teamId: init.slotToTeam[slot] ?? '',
        playerId: resolved.playerId,
        providerPlayerId: entry.playerId,
        providerPlayerName: resolved.providerPlayerName ?? entry.name ?? domRow?.name ?? undefined,
        providerTeamId: entry.teamId ?? '',
      });
    }
    if (confirmedOffset != null) {
      // Live stream picks the last reconcile had not captured yet — or that resolved where the
      // detail row could not — win. They are fresher than the 30s-old detail history. An
      // UNATTRIBUTED stream pick (slot 0 — offset unconfirmed for it) must never overwrite an
      // authoritative, correctly-numbered board; it would only ever add a bogus "Team 0" row.
      for (const pick of picks) {
        if (pick.unattributed) continue;
        if (!byOverall.has(pick.overall) || pick.playerId) byOverall.set(pick.overall, pick);
      }
    }
    return dedupeByResolvedPlayer([...byOverall.values()].sort((a, b) => a.overall - b.overall));
  }
  // Non-contiguous detail (defensive; ESPN's history is contiguous in practice): the append-only
  // backfill for picks the websocket missed, gated on a confirmed offset as before.
  if (detailList.length > 0 && confirmedOffset != null) {
    const covered = new Set(picks.map((pick) => pick.overall));
    for (const entry of detailList) {
      if (covered.has(entry.overall)) continue;
      const domEntry = domByAbsolute.get(entry.overall);
      const domRow = domEntry ? parseEspnDomPickRow(domEntry.text, domEntry.pickNumber) : null;
      const idUsable = entry.playerId !== '' && entry.playerId !== '0' && entry.playerId !== '-1';
      const resolved = resolveEspnPlayer(index, {
        providerPlayerId: idUsable ? entry.playerId : '',
        name: entry.name ?? domRow?.name ?? null,
        position: entry.position ?? domRow?.position ?? null,
        teamText: entry.proTeam ?? domRow?.teamAbbrev ?? null,
      });
      if (!idUsable && !resolved.playerId && resolved.providerPlayerName == null) continue;
      picks.push({
        overall: entry.overall,
        round: roundForOverall(init.teams, entry.overall),
        slot: slotForOverall(init.draftType, init.teams, entry.overall),
        teamId: init.slotToTeam[slotForOverall(init.draftType, init.teams, entry.overall)] ?? '',
        playerId: resolved.playerId,
        providerPlayerId: entry.playerId,
        providerPlayerName: resolved.providerPlayerName ?? entry.name ?? domRow?.name ?? undefined,
        providerTeamId: entry.teamId ?? '',
      });
    }
    picks.sort((a, b) => a.overall - b.overall);
  }
  return dedupeByResolvedPlayer(picks);
}

/** Guard that would have caught the 2026-08-15 rehearsal bug live: the form's typed slot (a draft
 * position) must agree with the position the stream's own order assigns to your ESPN team id
 * (`live.mySlot`). Silent (null) when there is no signal yet — no snapshot, no JOINED/TOKEN team id,
 * no typed slot, an unreliable order, or the team hasn't picked yet. A warning only: never a silent
 * override. */
export function espnSeatMismatch(live: EspnLiveSnapshot | null, order: EspnDraftOrder, typedSlot: number | null): string | null {
  if (!live || live.mySlot == null || typedSlot == null) return null;
  if (!order.reliable) return null;
  const derivedPosition = order.positionByTeam.get(live.mySlot);
  if (derivedPosition == null) return null;
  if (derivedPosition === typedSlot) return null;
  return `Your ESPN team (${live.mySlot}) drafts at position ${derivedPosition}, but the setup form says position ${typedSlot} — the seat math and recommendation timing will be wrong. Correct your draft position in setup.`;
}

/**
 * Desync signals for the ESPN bridge, replacing the old slotForOverall comparison (which compared
 * arrival order against snake slots and fired on EVERY ESPN draft, since SELECTED's first token is a
 * team id, not a position). In order:
 *  a. an unreliable order (Step 6) — the absolute-pick offset isn't confirmed yet (or is internally
 *     inconsistent), so pick attribution is not trustworthy;
 *  b. the DOM's highest absolute pick number running past the stream's own latest CONFIRMED absolute
 *     pick — N picks were missed. Compared against the true absolute count now, not arrival length
 *     (which undercounts by the offset once one is confirmed non-zero).
 * Flags only: picks are never renumbered or dropped, per the existing contract. The richer
 * unattributed-count / late-attach-point alerts these feed live in App.tsx's SessionAlerts producer.
 */
export function espnDesyncReason(live: EspnLiveSnapshot | null, order: EspnDraftOrder, offset: EspnStreamOffset): string | null {
  if (!live) return null;
  if (!order.reliable) {
    return offset.confirmed
      ? 'The absolute pick offset is confirmed but internally inconsistent — pick attribution may be off. Verify the log below.'
      : 'Pick attribution is not confirmed yet — picks are still tracked as they arrive, but team/position may be off until it resolves. Verify the log below.';
  }
  const lastAbsolute = live.streamPicks.length && offset.offset != null
    ? live.streamPicks[live.streamPicks.length - 1]!.overall + offset.offset
    : 0;
  // Missed-frame self-correction (2026-08-28): picks recovered from the league's own mDraftDetail
  // pick history (`detailPicks`) count as confirmed — the extension's reconciler backfilled them,
  // so once they reach the board depth the gap no longer exists and the alert clears.
  let detailMax = 0;
  for (const entry of live.detailPicks ?? []) {
    if (entry.overall > detailMax) detailMax = entry.overall;
  }
  const confirmedLatest = Math.max(lastAbsolute, detailMax);
  let maxDomPickNumber = 0;
  for (const dom of live.domPicks ?? []) {
    if (dom.pickNumber > maxDomPickNumber) maxDomPickNumber = dom.pickNumber;
  }
  if (maxDomPickNumber > confirmedLatest) {
    const missed = maxDomPickNumber - confirmedLatest;
    return `The ESPN tab missed frames — the board shows pick #${maxDomPickNumber} but the stream's latest confirmed pick is #${confirmedLatest} (${missed} missing). Verify the log below.`;
  }
  return null;
}

let playerIndexPromise: Promise<EspnPlayerIndex> | null = null;
/** players.json is memoized upstream; this additionally caches the built crosswalk across polls.
 * Exported for the completed-draft import path (espnDraftImport) — same crosswalk, same tiers. */
export function loadEspnPlayerIndex(): Promise<EspnPlayerIndex> {
  if (!playerIndexPromise) {
    playerIndexPromise = loadPlayerPool()
      .then((players) => buildEspnPlayerIndex(players))
      .catch((err: unknown) => {
        playerIndexPromise = null;
        throw err;
      });
  }
  return playerIndexPromise;
}

/**
 * The league size a from-pick-1 snake stream itself reveals: the arrival index of the FIRST team
 * id to repeat is exactly the team count (one full round completed). Null when no repeat has been
 * seen yet, when the repeat comes too early to trust (a mid-draft attach repeats immediately), or
 * when the count is not a plausible league size. This is what lets the live-detected card's
 * seeded team-count guess be corrected from the stream itself — the socket never states it.
 */
/**
 * The league size from ESPN's OWN pick history: `detailPicks` is the full history from absolute
 * pick 1, so the first team id to repeat sits at index exactly `teams` (round 2 begins with the
 * last pick of round 1 in snake, or team 1 again in linear). Because it starts at pick 1, this is
 * immune to the mid-draft-attach hazard that breaks the stream-based count: a stream attaching at
 * pick 15 of a 10-team league reads t6..t1,t1 and its first repeat lands at index 6 - the exact
 * wrong answer. Any teamId missing before the first repeat makes the count untrustworthy.
 */
export function observedTeamCountFromDetail(detailPicks: readonly EspnDetailPick[] | undefined): number | null {
  if (!detailPicks || detailPicks.length === 0) return null;
  const seen = new Set<string>();
  for (let i = 0; i < detailPicks.length; i += 1) {
    const teamId = detailPicks[i]!.teamId;
    if (teamId == null || teamId === '') return null; // a hole before the repeat - no count
    if (seen.has(teamId)) return i >= 4 && i <= 20 ? i : null;
    seen.add(teamId);
  }
  return null;
}

export function observedTeamCount(streamPicks: readonly EspnLivePick[]): number | null {
  const seen = new Set<number>();
  for (let i = 0; i < streamPicks.length; i += 1) {
    const slot = streamPicks[i]!.slot;
    if (seen.has(slot)) return i >= 6 && i <= 20 ? i : null;
    seen.add(slot);
  }
  return null;
}

export const espnAdapter: DraftProviderAdapter = {
  provider: 'espn',
  init: mergeBridgeInit,
  async picks(init, live) {
    const index = await loadEspnPlayerIndex();
    const picks = bridgePicksToNormalized(init, index, live);
    // Step 6c: once a non-zero offset is confirmed, normalized `overall` is the absolute pick
    // number (e.g. 138..147 for a late attach), so the clock/completion math must key off
    // max(overall), never the arrival length — `picks.length` would undercount by the offset.
    const made = picksMade(picks);
    const status = deriveDraftStatus('pre', made, init.teams, init.rounds);
    const onTheClock = computeOnTheClock(init.draftType, init.teams, init.rounds, made, init.slotToTeam);
    const offset = deriveEspnStreamOffset(live, index);
    const order = deriveEspnDraftOrder(live?.streamPicks ?? [], init.teams, init.draftType, offset);
    const desyncReason = espnDesyncReason(live, order, offset);
    const unattributedCount = picks.reduce((count, pick) => count + (pick.unattributed ? 1 : 0), 0);
    return { status, picks, onTheClock, fetchedAt: Date.now(), desyncReason, unattributedCount };
  },
};
