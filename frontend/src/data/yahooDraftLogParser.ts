import type { PlayerId, PlayerMeta } from '../../../shared/types';
import { slotForOverall } from '../adapters/draftOrder';
import type { IdpPlayer } from './idpProjections';

export interface ParsedYahooPick {
  overall: number;
  managerName?: string;
  isUserPick: boolean;
  playerName: string;
  injury?: string;
  position: string;
  nflTeam: string;
  byeWeek?: number;
  playerId: PlayerId | null;
  matchedPlayer?: PlayerMeta;
  matchedIdp?: IdpPlayer;
}

export interface YahooParseResult {
  picks: ParsedYahooPick[];
  slotToTeamName: Record<number, string>;
  detectedUserSlot: number | null;
  detectedTeams?: number | null;
}

const INJURY_STATUSES = new Set(['Q', 'IR', 'O', 'PUP', 'SUSP', 'NA', 'D', 'SSPD']);
const POSITIONS = new Set([
  'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DST', 'D/ST',
  'LB', 'DB', 'DL', 'DE', 'DT', 'CB', 'S', 'FLEX',
]);

function cleanLastName(name: string): string {
  return name
    .replace(/\s+(?:III|II|IV|V|Jr\.?|Sr\.?)$/i, '')
    .replace(/\./g, '')
    .trim()
    .toLowerCase();
}

function buildPlayersByLastAndPos(players: readonly PlayerMeta[]): Map<string, PlayerMeta[]> {
  const map = new Map<string, PlayerMeta[]>();
  for (const player of players) {
    const fullName = player.name ?? '';
    const parts = fullName.split(' ');
    const last = cleanLastName(parts.length > 1 ? parts.slice(1).join(' ') : fullName);
    const key = `${last}|${player.position ?? ''}`.toLowerCase();
    const existing = map.get(key) ?? [];
    existing.push(player);
    map.set(key, existing);
  }
  return map;
}

function buildIdpByLast(idpPlayers?: readonly IdpPlayer[]): Map<string, IdpPlayer[]> {
  const map = new Map<string, IdpPlayer[]>();
  if (idpPlayers) {
    for (const idp of idpPlayers) {
      const parts = idp.name.split(' ');
      const last = cleanLastName(parts.length > 1 ? parts.slice(1).join(' ') : idp.name);
      const key = `${last}|${idp.pos}`.toLowerCase();
      const existing = map.get(key) ?? [];
      existing.push(idp);
      map.set(key, existing);
    }
  }
  return map;
}

function matchPlayer(
  rawPlayerName: string,
  rawPosition: string,
  rawTeam: string,
  players: readonly PlayerMeta[],
  playersByLastAndPos: Map<string, PlayerMeta[]>,
  idpPlayers?: readonly IdpPlayer[],
  idpByLast?: Map<string, IdpPlayer[]>,
): { matchedPlayer?: PlayerMeta; matchedIdp?: IdpPlayer; playerId: PlayerId | null } {
  let matchedPlayer: PlayerMeta | undefined;
  let matchedIdp: IdpPlayer | undefined;
  let playerId: PlayerId | null = null;

  // 1. Direct full-name match (handles clean full names like "Amon-Ra St. Brown", "James Cook III")
  const cleanRaw = cleanLastName(rawPlayerName);
  const exact = players.find(
    (p) =>
      cleanLastName(p.name ?? '') === cleanRaw &&
      (p.position?.toLowerCase() === rawPosition.toLowerCase() ||
        p.eligiblePositions?.some((pos) => pos.toLowerCase() === rawPosition.toLowerCase())),
  );
  if (exact) {
    return { matchedPlayer: exact, playerId: exact.playerId };
  }

  // 2. Direct DEF match by NFL team code
  if (
    rawPosition.toUpperCase() === 'DEF' ||
    rawPosition.toUpperCase() === 'D/ST' ||
    rawPosition.toUpperCase() === 'DST'
  ) {
    const defPlayer = players.find(
      (p) =>
        (p.position === 'DEF' || p.eligiblePositions?.includes('DEF')) &&
        p.team?.toLowerCase() === rawTeam.toLowerCase(),
    );
    if (defPlayer) {
      return { matchedPlayer: defPlayer, playerId: defPlayer.playerId };
    }
  }

  // 3. Match by initials and last name (e.g. "A. St. Brown", "J. Gibbs")
  let init = '';
  let last = cleanLastName(rawPlayerName);
  const initialMatch = rawPlayerName.match(/^([A-Za-z](?:\.\s*[A-Za-z])*\.?)\s+(.*)$/);
  if (initialMatch && (initialMatch[1]!.includes('.') || initialMatch[1]!.length <= 2)) {
    init = initialMatch[1]!.replace(/[^a-z]/gi, '').toLowerCase();
    last = cleanLastName(initialMatch[2]!);
  }

  const key = `${last}|${rawPosition}`.toLowerCase();
  const candidates = playersByLastAndPos.get(key) ?? [];

  const nameFiltered = candidates.filter((c) => {
    if (!init) return true;
    const firstName = (c.name ?? '').split(' ')[0] ?? '';
    const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
    return cleanFirst.startsWith(init);
  });

  if (nameFiltered.length === 1 && nameFiltered[0]) {
    matchedPlayer = nameFiltered[0];
    playerId = matchedPlayer.playerId;
  } else if (nameFiltered.length > 1) {
    const teamMatches = nameFiltered.filter((c) => (c.team ?? '').toLowerCase() === rawTeam.toLowerCase());
    const chosen = teamMatches.length === 1 && teamMatches[0] ? teamMatches[0] : nameFiltered[0];
    if (chosen) {
      matchedPlayer = chosen;
      playerId = chosen.playerId;
    }
  }

  // 4. IDP pool match
  if (!matchedPlayer && idpPlayers && idpByLast) {
    const idpKey = `${last}|${rawPosition}`.toLowerCase();
    const idpCandidates = idpByLast.get(idpKey) ?? [];
    const idpFiltered = idpCandidates.filter((c) => {
      if (!init) return true;
      const firstName = c.name.split(' ')[0] ?? '';
      const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
      return cleanFirst.startsWith(init);
    });
    if (idpFiltered.length >= 1) {
      matchedIdp = idpFiltered.find((c) => c.team.toLowerCase() === rawTeam.toLowerCase()) ?? idpFiltered[0];
    }
  }

  return { matchedPlayer, matchedIdp, playerId };
}

/**
 * Parses raw text copied directly from Yahoo live draft feed (chat / picks stream).
 */
function parseYahooDraftFeedText(
  lines: string[],
  players: readonly PlayerMeta[],
  idpPlayers?: readonly IdpPlayer[],
  teams = 10,
): YahooParseResult {
  const rawPicks: Array<{
    pickNum: number | null;
    manager: string | null;
    playerName: string;
    injury?: string;
    position: string;
    nflTeam: string;
    byeWeek?: number;
  }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.startsWith('Bye ')) {
      const byeMatch = line.match(/^Bye\s+(\d+)/i);
      const byeWeek = byeMatch ? parseInt(byeMatch[1]!, 10) : undefined;
      const nflTeam = lines[i - 1] ?? '';
      const pos = lines[i - 2] ?? '';

      let injury: string | undefined;
      let playerIdx = i - 3;
      if (playerIdx >= 0 && INJURY_STATUSES.has(lines[playerIdx]!.toUpperCase())) {
        injury = lines[playerIdx];
        playerIdx = i - 4;
      }

      if (playerIdx < 0) continue;
      const playerName = lines[playerIdx]!;

      // Skip duplicate player name lines (avatar/anchor text + name text)
      while (playerIdx >= 1 && lines[playerIdx - 1]!.trim().toLowerCase() === playerName.trim().toLowerCase()) {
        playerIdx -= 1;
      }

      let manager: string | null = null;
      let pickNum: number | null = null;

      if (playerIdx >= 1) {
        const prev1 = lines[playerIdx - 1]!;
        if (/^\d+$/.test(prev1)) {
          pickNum = parseInt(prev1, 10);
        } else if (!/\b(?:joined|left)\b/i.test(prev1)) {
          manager = prev1;
          if (playerIdx >= 2 && /^\d+$/.test(lines[playerIdx - 2]!)) {
            pickNum = parseInt(lines[playerIdx - 2]!, 10);
          }
        }
      }

      rawPicks.push({
        pickNum,
        manager,
        playerName,
        injury,
        position: pos,
        nflTeam,
        byeWeek,
      });
    }
  }

  const playersByLastAndPos = buildPlayersByLastAndPos(players);
  const idpByLast = buildIdpByLast(idpPlayers);

  // Auto-detect league size from snake turnarounds if available (e.g. manager picking at 10 and 11)
  let detectedTeams: number | null = null;
  for (let i = 0; i < rawPicks.length - 1; i += 1) {
    const m1 = rawPicks[i]?.manager?.trim().toLowerCase();
    const m2 = rawPicks[i + 1]?.manager?.trim().toLowerCase();
    if (m1 && m2 && m1 === m2) {
      const candidateTeams = rawPicks[i]?.pickNum ?? (i + 1);
      if (candidateTeams >= 4 && candidateTeams <= 32) {
        detectedTeams = candidateTeams;
        break;
      }
    }
  }

  const effectiveTeams = detectedTeams ?? teams;
  const slotToTeamName: Record<number, string> = {};
  let detectedUserSlot: number | null = null;
  const picks: ParsedYahooPick[] = [];

  for (let idx = 0; idx < rawPicks.length; idx += 1) {
    const raw = rawPicks[idx]!;
    const overall = raw.pickNum ?? (idx + 1);
    const slot = slotForOverall('snake', effectiveTeams, overall);

    let isUserPick = false;
    if (raw.manager) {
      if (raw.manager.toLowerCase() === 'you') {
        isUserPick = true;
        detectedUserSlot = slot;
      } else {
        slotToTeamName[slot] = raw.manager;
      }
    }

    const match = matchPlayer(
      raw.playerName,
      raw.position,
      raw.nflTeam,
      players,
      playersByLastAndPos,
      idpPlayers,
      idpByLast,
    );

    picks.push({
      overall,
      managerName: raw.manager ?? undefined,
      isUserPick,
      playerName: match.matchedPlayer?.name ?? match.matchedIdp?.name ?? raw.playerName,
      injury: raw.injury,
      position: raw.position,
      nflTeam: raw.nflTeam,
      byeWeek: raw.byeWeek,
      playerId: match.playerId,
      matchedPlayer: match.matchedPlayer,
      matchedIdp: match.matchedIdp,
    });
  }

  return {
    picks,
    slotToTeamName,
    detectedUserSlot,
    detectedTeams,
  };
}

/**
 * Parses raw text copied directly from Yahoo Draft Board grid view
 * (e.g. column headers: managers; cells: player details ending with "<round>.<slot>").
 */
function parseYahooDraftBoardText(
  lines: string[],
  players: readonly PlayerMeta[],
  idpPlayers?: readonly IdpPlayer[],
  teams = 10,
): YahooParseResult {
  const playersByLastAndPos = buildPlayersByLastAndPos(players);
  const idpByLast = buildIdpByLast(idpPlayers);

  // Find all cell label indices (e.g. "1.1", "1.10", "2.7", "3.1")
  const cellPositions: Array<{ index: number; round: number; pickInRound: number }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i]!.match(/^(\d+)\.(\d+)\.?$/);
    if (m) {
      cellPositions.push({
        index: i,
        round: parseInt(m[1]!, 10),
        pickInRound: parseInt(m[2]!, 10),
      });
    }
  }

  if (cellPositions.length === 0) {
    return { picks: [], slotToTeamName: {}, detectedUserSlot: null, detectedTeams: null };
  }

  // Detect league size: max pick in round 1
  const round1Picks = cellPositions.filter((c) => c.round === 1);
  const maxRound1Pick = round1Picks.length > 0 ? Math.max(...round1Picks.map((c) => c.pickInRound)) : 0;
  const detectedTeams = maxRound1Pick >= 4 && maxRound1Pick <= 32 ? maxRound1Pick : (teams >= 4 && teams <= 32 ? teams : 10);

  // Extract manager headers from lines preceding the first pick.
  // In Yahoo Draft Board, the column headers are the manager names (1 per team, slots 1..detectedTeams).
  const slotToTeamName: Record<number, string> = {};
  let detectedUserSlot: number | null = null;
  let hasManagerHeader = false;

  if (cellPositions[0]!.index >= detectedTeams) {
    const candidateManagers = lines.slice(0, detectedTeams);
    const hasCellLabelInHeader = candidateManagers.some(
      (l) => /^\d+\.\d+\.?$/.test(l) || /^on the clock$/i.test(l),
    );
    if (!hasCellLabelInHeader) {
      hasManagerHeader = true;
      for (let s = 0; s < candidateManagers.length; s += 1) {
        const slot = s + 1;
        const manager = candidateManagers[s]!.trim();
        if (manager.toLowerCase() === 'you') {
          detectedUserSlot = slot;
        } else {
          slotToTeamName[slot] = manager;
        }
      }
    }
  }

  const picks: ParsedYahooPick[] = [];
  let prevCellIndex = hasManagerHeader ? detectedTeams - 1 : -1;

  for (let c = 0; c < cellPositions.length; c += 1) {
    const cell = cellPositions[c]!;
    const i = cell.index;

    let isFilled = false;
    let pos: string | undefined;
    let nflTeam: string | undefined;
    let injury: string | undefined;
    let nameEndIdx = -1;

    if (i >= 2) {
      const candidatePos = lines[i - 2]!.toUpperCase();
      const candidateTeam = lines[i - 1]!;
      if (POSITIONS.has(candidatePos) && /^[A-Za-z]{2,4}$/.test(candidateTeam)) {
        isFilled = true;
        pos = lines[i - 2]!;
        nflTeam = candidateTeam;
        nameEndIdx = i - 3;
        if (nameEndIdx >= 0 && INJURY_STATUSES.has(lines[nameEndIdx]!.toUpperCase())) {
          injury = lines[nameEndIdx]!;
          nameEndIdx -= 1;
        }
      } else if (i >= 3) {
        const candidateInjury = lines[i - 2]!.toUpperCase();
        const candidatePos2 = lines[i - 3]!.toUpperCase();
        if (INJURY_STATUSES.has(candidateInjury) && POSITIONS.has(candidatePos2) && /^[A-Za-z]{2,4}$/.test(candidateTeam)) {
          isFilled = true;
          pos = lines[i - 3]!;
          nflTeam = candidateTeam;
          injury = lines[i - 2]!;
          nameEndIdx = i - 4;
        }
      }
    }

    if (isFilled && pos && nflTeam && nameEndIdx > prevCellIndex) {
      const rawNameParts = lines
        .slice(prevCellIndex + 1, nameEndIdx + 1)
        .filter((l) => !/^on the clock$/i.test(l) && !/^\d+\.\d+\.?$/.test(l));
      const rawPlayerName = rawNameParts.join(' ');

      if (rawPlayerName) {
        const overall = (cell.round - 1) * detectedTeams + cell.pickInRound;
        const slot = slotForOverall('snake', detectedTeams, overall);
        const isUserPick = detectedUserSlot != null ? slot === detectedUserSlot : false;
        const managerName = isUserPick ? 'You' : slotToTeamName[slot];

        const match = matchPlayer(
          rawPlayerName,
          pos,
          nflTeam,
          players,
          playersByLastAndPos,
          idpPlayers,
          idpByLast,
        );

        picks.push({
          overall,
          managerName,
          isUserPick,
          playerName: match.matchedPlayer?.name ?? match.matchedIdp?.name ?? rawPlayerName,
          injury,
          position: pos,
          nflTeam,
          playerId: match.playerId,
          matchedPlayer: match.matchedPlayer,
          matchedIdp: match.matchedIdp,
        });
      }
    }

    prevCellIndex = i;
  }

  // Sort picks chronologically by overall pick number
  picks.sort((a, b) => a.overall - b.overall);

  return {
    picks,
    slotToTeamName,
    detectedUserSlot,
    detectedTeams,
  };
}

/**
 * Parses raw text copied directly from either the Yahoo live draft room feed
 * (chat/picks stream) or the Yahoo Draft Board grid view.
 */
export function parseYahooDraftText(
  rawText: string,
  players: readonly PlayerMeta[],
  idpPlayers?: readonly IdpPlayer[],
  teams = 10,
): YahooParseResult {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { picks: [], slotToTeamName: {}, detectedUserSlot: null, detectedTeams: null };
  }

  // Detect Yahoo Draft Board grid view: contains "<round>.<pick>" labels (e.g. "1.1", "1.10", "2.1")
  // and does NOT contain "Bye <week>" feed markers.
  const hasByeLines = lines.some((l) => /^Bye\s+\d+/i.test(l));
  const hasBoardCellLabels = lines.some((l) => /^\d+\.\d+\.?$/.test(l));

  if (!hasByeLines && hasBoardCellLabels) {
    return parseYahooDraftBoardText(lines, players, idpPlayers, teams);
  }

  return parseYahooDraftFeedText(lines, players, idpPlayers, teams);
}
