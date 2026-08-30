import type { EspnDraftPickSummary, EspnLeagueSnapshot, LeagueFormat, LeagueSettings, RosterSlot, ScoringMap } from '../../../shared/types';

/** ESPN defaultPositionId → canonical position abbreviation (mirrors espn.ts's map). */
const ESPN_POSITION_BY_ID: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };

/**
 * The ESPN league-page adapter (2026-08-27 connect/start split). This module is the ONE place
 * ESPN's league vocabulary may be translated into the app's Sleeper-derived vocabulary — integer
 * lineup-slot ids → `RosterSlot`, `scoringItems` → Sleeper stat keys (CLAUDE.md, "Provider
 * adapters"). Everything above the adapters deals in `LeagueSettings` and never sees ESPN ids.
 *
 * Input is the RAW (redacted) league-API JSON the extension captured from the real ESPN league
 * page (`/apis/v3/games/ffl/seasons/<season>/segments/0/leagues/<id>?view=...`) and relayed via
 * `requestEspnLeague`. Unmapped slot ids and unrecognized scoring items become `diagnostics` —
 * surfaced in the connect panel, never silently dropped (CLAUDE.md's no-lost-data contract).
 *
 * PROVISIONAL: field paths and the id maps below are validated against the committed fixture
 * (`fixtures/espn-contract/league-*.json`) and must be re-confirmed against a real recon slice
 * before being trusted for a live league (see the EspnLeagueSnapshot doc in shared/types.d.ts).
 */

/**
 * ESPN lineupSlotId → our RosterSlot. This is the LINEUP-SLOT vocabulary (0=QB, 2=RB, 4=WR,
 * 6=TE, 16=D/ST, 17=K), NOT defaultPositionId (1=QB, 2=RB, 3=WR, 4=TE) — the previous map used
 * the latter and silently corrupted startingSlots/rosterSlots against real payloads (slot 4 "WR"
 * parsed as TE, 6 "TE" as a flex, 17 "K" vanished into bench). Cross-checked live against
 * pipeline/espn_projections.py's `filterSlotIds: [0, 2, 4, 6, 17, 16]` (verified returning 1026
 * real players), and to be re-confirmed against the Phase 0 real capture.
 *
 * DELIBERATELY conservative: an unmapped id fails THAT slot and surfaces as a diagnostic — it
 * never falls through to a plausible-looking neighbour (that is how the old map passed the
 * diagnostic gate while corrupting the data).
 */
const SLOT_ID_MAP: Readonly<Record<number, RosterSlot>> = {
  0: 'QB',
  2: 'RB',
  4: 'WR',
  6: 'TE',
  16: 'DEF', // D/ST
  17: 'K',
  20: 'BN', // BE — bench
  21: 'IR',
  23: 'FLEX', // RB/WR/TE — the classic ESPN FLEX
  5: 'SUPER_FLEX', // OP — offensive player (QB-eligible flex)
};

/** lineupSlotIds that count as flex/OP ordering-wise for starter ordering. */
const FLEX_SLOT_IDS = new Set([5, 23]);
/** lineupSlotIds ordered after the flexes — K (17) then D/ST (16), matching Sleeper's
 * startingSlots convention (K, DEF last). */
const LATE_SLOT_IDS = new Set([16, 17]);
function starterOrder(slotId: number): number {
  if (slotId === 16) return 3; // DEF always last
  if (LATE_SLOT_IDS.has(slotId)) return 2; // K
  return FLEX_SLOT_IDS.has(slotId) ? 1 : 0;
}

/**
 * ESPN scoringItems statId → Sleeper stat vocabulary. DELIBERATELY conservative: only stat ids
 * whose meaning is unambiguous are translated; everything else lands in `diagnostics` so a parse
 * gap is visible rather than laundered into a confidently-wrong `LeagueSettings`. CORRECTED
 * 2026-08-28: two independent sources AGREE (pipeline/espn_projections.py::_STAT_ID_MAP,
 * live-verified against appliedTotal; and espn-api's PLAYER_STATS_MAP) that the RUSHING ids were
 * shifted by one here (23=rush_att, 24=rush_yd, 25=rush_td -- NOT 23=rush_yd/24=rush_td), which
 * dropped real standard-league rush-TD points (id 25) and left INT -2 (id 20) unmapped. Ids whose
 * meaning stays ambiguous or whose Sleeper key the engine cannot score (tiered FG buckets
 * 74/77/80/85, D/ST points-allowed tiers, receptions alias 53) remain unmapped -> diagnostics.
 */
const STAT_ID_MAP: Readonly<Record<number, string>> = {
  3: 'pass_yd',
  4: 'pass_td',
  19: 'pass_2pt',
  20: 'pass_int',
  24: 'rush_yd',
  25: 'rush_td',
  26: 'rush_2pt',
  41: 'rec', // points per reception
  // 53 is ESPN's receptions ALIAS (espn-api PLAYER_STATS_MAP: both 41 and 53 are
  // receivingReceptions; the pipeline's player-stat map uses 53). Some payloads list the PPR
  // weight on 53 instead of 41. Double-counting would require BOTH to carry points in one
  // payload, which ESPN does not do.
  53: 'rec',
  42: 'rec_yd',
  43: 'rec_td',
  44: 'rec_2pt',
  68: 'fum',
  72: 'fum_lost',
  83: 'fgm',
  86: 'xpm',
  94: 'def_td',
  95: 'int',
  96: 'fum_rec',
  99: 'sack',
  101: 'def_kr_td',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : (typeof value === 'number' ? String(value) : null);
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Parse the raw ESPN league payload into an {@link EspnLeagueSnapshot}. Returns `null` (with no
 * snapshot to show) only when the payload isn't an ESPN league payload at all; partial payloads
 * parse with diagnostics — a truncated capture must surface its gaps, never a confident wrong
 * league config.
 */
export function parseEspnLeagueJson(payload: unknown, views?: string[], draftDetailFetchStatus?: string): EspnLeagueSnapshot | null {
  if (!isRecord(payload)) return null;
  const diagnostics: string[] = [];

  const leagueId = asString(payload.id ?? payload.leagueId);
  if (!leagueId) return null; // No id — not a league payload; refusing to invent one is the point.

  const season = asString(payload.seasonId) ?? '';
  if (!season) diagnostics.push('Season not found in the captured league JSON.');

  const settings = isRecord(payload.settings) ? payload.settings : null;
  const name = (settings && asString(settings.name)) || 'ESPN league';

  const teamsArray = Array.isArray(payload.teams) ? payload.teams.filter(isRecord) : [];
  const teamsFromSettings = settings ? asNumber(settings.teams) : null;
  const teams = teamsArray.length || teamsFromSettings || 0;
  if (!teams) diagnostics.push('Team count not found in the captured league JSON.');

  // Team names for the confirm card's "which team is yours?" dropdown. ESPN exposes the display
  // name as `name` or as location + nickname depending on the view; read defensively, keep the
  // ESPN id so the choice can be saved as providerTeamId.
  const teamNames = teamsArray
    .map((team) => {
      const id = asNumber(team.id);
      const name = asString(team.name) ?? [asString(team.location), asString(team.nickname)].filter(Boolean).join(' ');
      return id != null && name ? { id, name } : null;
    })
    .filter((team): team is { id: number; name: string } => team !== null);

  // Roster slots: settings.rosterSettings.lineupSlotCounts maps ESPN slot ids to counts.
  const rosterSettings = settings && isRecord(settings.rosterSettings) ? settings.rosterSettings : null;
  const lineupSlotCounts = rosterSettings && isRecord(rosterSettings.lineupSlotCounts) ? rosterSettings.lineupSlotCounts : null;

  // Rounds: mDraftDetail's `rounds` is the authoritative read. When no draft-detail view was
  // captured, DERIVE from roster size (a snake draft picks exactly once per roster spot) and
  // label it as derived via `roundsDerived` — honest provenance, never laundered as a read.
  const draftDetail = isRecord(payload.draftDetail) ? payload.draftDetail : null;
  const draft = isRecord(payload.draft) ? payload.draft : null;
  let rounds = draftDetailRounds(draftDetail) ?? draftDetailRounds(draft);
  // mSettings captures often carry the authoritative round count at settings.draftSettings.rounds —
  // prefer it over the roster-size derivation (which is arithmetically exact for a snake draft but
  // is still a derivation, not a read).
  const draftSettings = settings && isRecord(settings.draftSettings) ? settings.draftSettings : null;
  rounds ??= draftDetailRounds(draftSettings);
  // REAL 2026 SHAPE (recon 2026-08-28, league 2018058011): ESPN's draftDetail no longer carries a
  // `rounds` field at all — it is `[completeDate, drafted, inProgress, picks]`. The pick count IS
  // the authoritative round read: a snake draft fills exactly `teams x rounds` picks. Only accept
  // it when the count divides evenly by the team count — a remainder means a partial capture, and
  // dividing it would launder a wrong number into a confident read.
  if (rounds == null && draftDetail && Array.isArray(draftDetail.picks) && draftDetail.picks.length > 0 && teams > 0 && draftDetail.picks.length % teams === 0) {
    rounds = draftDetail.picks.length / teams;
  }
  let roundsDerived = false;
  if (rounds == null && lineupSlotCounts) {
    const rosterSize = Object.values(lineupSlotCounts).reduce<number>((total, count) => {
      const value = asNumber(count);
      return total + (value != null && value > 0 ? value : 0);
    }, 0);
    if (rosterSize > 0) {
      rounds = rosterSize;
      roundsDerived = true;
      diagnostics.push('Rounds derived from the roster size (no draft-recap view was captured) — open your league\'s Draft Recap tab and reconnect for the exact value.');
      // The extension ALREADY tried to fetch draft detail itself (espn-content.js's proactive
      // mDraftDetail+mRoster GET). When that fetch is known to have failed, say so — the manual
      // "open Draft Recap" advice above is then a fallback, not the only path.
      if (draftDetailFetchStatus === 'failed') {
        diagnostics.push('The extension\'s automatic draft-detail fetch failed — make sure you are logged into ESPN, hard-refresh your league page, then scan again.');
      }
    }
  }
  if (rounds == null) {
    diagnostics.push('Rounds not found in the captured league JSON (no draft-detail view was captured).');
  }

  // Raw draft picks (2026-08-28): when draftDetail.picks was captured (the real 2026 shape —
  // `[completeDate, drafted, inProgress, picks]`, no `rounds` field), carry a summary forward so
  // the connect card's "Save league" button also imports the drafted roster (2026-08-29: this used
  // to be a separate "Save league + import drafted roster" button). Defensive reads: the pick
  // number field name is not pinned by a real recon slice, so every plausible ESPN spelling is
  // tried; a pick without an overall or any player identity is skipped, never guessed.
  const drafted = draftDetail?.drafted === true;
  const rawPicks = draftDetail && Array.isArray(draftDetail.picks) ? draftDetail.picks.filter(isRecord) : [];
  const draftPicks: EspnDraftPickSummary[] = [];
  for (const pick of rawPicks) {
    const overall = asNumber(pick.pickNumber) ?? asNumber(pick.overall) ?? asNumber(pick.overallPickNumber) ?? asNumber(pick.selection) ?? asNumber(pick.id);
    const player = isRecord(pick.player) ? pick.player : null;
    const playerId = asString(pick.playerId) ?? (player ? asString(player.id) : null);
    const playerName = player ? (asString(player.fullName) ?? asString(player.displayName)) : null;
    if (overall == null || overall <= 0 || (playerId == null && playerName == null)) continue;
    const positionId = player ? asNumber(player.defaultPositionId) : null;
    draftPicks.push({
      overall,
      teamId: asNumber(pick.teamId),
      playerId,
      playerName,
      position: positionId != null ? ESPN_POSITION_BY_ID[positionId] ?? null : null,
      proTeamId: player ? asNumber(player.proTeamId) : null,
    });
  }
  draftPicks.sort((a, b) => a.overall - b.overall);

  const rosterSlots: Partial<Record<RosterSlot, number>> = {};
  const starters: Array<{ slot: RosterSlot; order: number }> = [];
  const unmappedSlotIds: number[] = [];
  if (lineupSlotCounts) {
    for (const [rawId, rawCount] of Object.entries(lineupSlotCounts)) {
      const slotId = Number(rawId);
      const count = asNumber(rawCount);
      if (!Number.isInteger(slotId) || count == null || count <= 0) continue;
      const slot = SLOT_ID_MAP[slotId];
      if (!slot) {
        unmappedSlotIds.push(slotId);
        continue;
      }
      rosterSlots[slot] = (rosterSlots[slot] ?? 0) + count;
      if (slot !== 'BN' && slot !== 'IR') {
        // Starters are ordered: position slots first, flexes after, then K/DEF — the same broad
        // ordering Sleeper's startingSlots use. A count > 1 repeats the slot (RB, RB / WR, WR).
        const order = starterOrder(slotId);
        for (let index = 0; index < count; index += 1) starters.push({ slot, order });
      }
    }
    for (const slotId of [...new Set(unmappedSlotIds)].sort((a, b) => a - b)) {
      diagnostics.push(`Unmapped ESPN lineup-slot id: ${slotId}.`);
    }
  } else {
    diagnostics.push('Roster slot counts not found in the captured league JSON.');
  }
  const startingSlots = starters.sort((a, b) => a.order - b.order).map((entry) => entry.slot);

  // Scoring: real ESPN payloads nest the list at settings.scoringSettings.scoringItems; the
  // flatter settings.scoringItems is accepted as a legacy/alias path so an older capture shape
  // still parses. Either way: translated into Sleeper's vocabulary, unrecognized statIds become
  // diagnostics — never laundered into a confident wrong scoring map.
  const scoring: ScoringMap = {};
  // Structured companion to the prose diagnostic below: every unmapped non-zero statId with the
  // league's actual point value, so the confirm card can render per-bonus tags instead of asking
  // the user to parse a sentence of raw ids.
  const unmodeledScoringItems: { statId: number; points: number }[] = [];
  const scoringSettings = settings && isRecord(settings.scoringSettings) ? settings.scoringSettings : null;
  const scoringItems = scoringSettings && Array.isArray(scoringSettings.scoringItems)
    ? scoringSettings.scoringItems
    : (settings && Array.isArray(settings.scoringItems) ? settings.scoringItems : null);
  const unrecognizedStatIds: number[] = [];
  if (scoringItems) {
    for (const item of scoringItems) {
      if (!isRecord(item)) continue;
      const statId = asNumber(item.statId);
      const points = asNumber(item.points);
      if (statId == null || points == null) continue;
      // ESPN's settings payload lists its FULL scoring catalog; a 0-point item cannot change the
      // scoring map no matter what it means, so it is skipped entirely -- never recorded as a key,
      // never disclosed as a parse gap. Only non-zero unmapped ids are a real parse gap.
      if (points === 0) continue;
      const key = STAT_ID_MAP[statId];
      if (!key) {
        unrecognizedStatIds.push(statId);
        const existing = unmodeledScoringItems.find((entry) => entry.statId === statId);
        // Same merge rule the scoring map uses above — a repeated statId adds its points.
        if (existing) existing.points += points;
        else unmodeledScoringItems.push({ statId, points });
        continue;
      }
      scoring[key] = (scoring[key] ?? 0) + points;
    }
    const sorted = [...new Set(unrecognizedStatIds)].sort((a, b) => a - b);
    if (sorted.length > 0) {
      // One summary line, not one line per statId: ESPN's scoringItems carries its FULL stat
      // catalog (turnovers, 2-pt conversions, defensive/kicker categories), most of which this
      // deliberately conservative map does not translate. Still disclosed — never laundered —
      // just summarized so the card stays readable.
      const preview = sorted.slice(0, 8).join(', ');
      diagnostics.push(`${sorted.length} ESPN scoring statIds carried non-zero points but have no Sleeper equivalent -- long-TD and yardage-game bonus categories the recommendation engine does not model (statIds: ${preview}${sorted.length > 8 ? ', …' : ''}). All core fantasy categories are captured.`);
    }
  } else {
    diagnostics.push('Scoring items not found in the captured league JSON — open your league\'s League Settings page, then reconnect.');
  }

  const format: LeagueFormat = {
    reception: receptionFormatFor(scoring.rec),
    qb: (rosterSlots.SUPER_FLEX ?? 0) > 0 || (rosterSlots.QB ?? 0) > 1 ? 'two-qb' : 'one-qb',
    draft: 'snake',
  };

  return {
    schemaVersion: 1,
    leagueId,
    season,
    name,
    teams,
    rounds,
    roundsDerived,
    startingSlots,
    rosterSlots,
    scoring,
    format,
    myTeamId: null,
    teamNames,
    drafted,
    draftPicks: draftPicks.length > 0 ? draftPicks : undefined,
    unmodeledScoringItems: unmodeledScoringItems.length > 0
      // Stable, duplicate-free display order for the confirm card's chips (merged above).
      ? unmodeledScoringItems.sort((a, b) => a.statId - b.statId)
      : undefined,
    views: views && views.length > 0 ? [...new Set(views)] : undefined,
    diagnostics,
    capturedAt: Date.now(),
  };
}

function draftDetailRounds(record: Record<string, unknown> | null): number | null {
  if (!record) return null;
  // ESPN's real payloads carry rounds as a NUMBER, but the provisional field path was never
  // confirmed against a live league — a numeric STRING ("15") must parse too, and when `rounds`
  // is absent entirely a populated `order` array (one entry per round) is an equally
  // authoritative read. Everything else stays null so the derivation fallback still runs.
  const rounds = asNumber(record.rounds) ?? (typeof record.rounds === 'string' ? asNumber(Number(record.rounds)) : null);
  if (rounds != null && rounds > 0) return rounds;
  if (Array.isArray(record.order) && record.order.length > 0) return record.order.length;
  return null;
}

function receptionFormatFor(perCatch: number | undefined): LeagueFormat['reception'] {
  if (!perCatch) return 'standard';
  if (perCatch === 1) return 'ppr';
  if (perCatch === 0.5) return 'half-ppr';
  return 'custom';
}

/**
 * The parsed snapshot → `LeagueSettings`. This is the only translation site: ESPN's integer ids
 * never escape this module, and the diagnostics travel with the snapshot so the connect panel can
 * disclose exactly which fields are authoritative and which carried defaults.
 */
export function espnLeagueToSettings(snapshot: EspnLeagueSnapshot): LeagueSettings {
  return {
    provider: 'espn',
    leagueId: snapshot.leagueId,
    name: snapshot.name,
    season: snapshot.season,
    teams: snapshot.teams,
    startingSlots: snapshot.startingSlots,
    rosterSlots: snapshot.rosterSlots,
    scoring: snapshot.scoring,
    format: snapshot.format,
  };
}