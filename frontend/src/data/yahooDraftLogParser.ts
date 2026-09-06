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
 * Parses a pick number from a string line in various Yahoo formats:
 * - Pure integer / dotted / hashed: "22", "22.", "#22", "Pick 22", "Pick #22", "Pk 22"
 * - Parenthesized: "(Pick 22)", "(22)", "Pick 22 (Round 3, Pick 2)"
 * - Round and pick notation: "Round 3, Pick 2", "Rd 3, Pick 2", "3.2", "3.02"
 */
function parsePickNumber(str: string, teams: number): number | null {
  const trimmed = str.trim();

  // 1. Pure number, with optional '#', 'Pick', 'Pk', trailing period or colon
  const m1 = trimmed.match(/^(?:(?:Pick|Pk)\s*)?#?\s*(\d+)\.?$/i);
  if (m1) {
    const val = parseInt(m1[1]!, 10);
    if (val >= 1 && val <= 500) return val;
  }

  // 2. Parenthesized pick number, e.g. "(Pick 22)", "(22)", "Pick 22 (Round 3, Pick 2)"
  const m2 = trimmed.match(/\((?:Pick\s*)?#?(\d+)\)/i) || trimmed.match(/^(?:Pick\s*)?#?(\d+)\s*\(/i);
  if (m2) {
    const val = parseInt(m2[1]!, 10);
    if (val >= 1 && val <= 500) return val;
  }

  // 3. Round and pick notation: e.g. "Round 3, Pick 2", "Rd 3, Pick 2"
  const m3 = trimmed.match(/^(?:Round|Rd)?\s*(\d+)[,\s]+(?:Pick|Pk)?\s*(\d+)\.?$/i);
  if (m3 && teams >= 4) {
    const round = parseInt(m3[1]!, 10);
    const pickInRound = parseInt(m3[2]!, 10);
    if (round >= 1 && round <= 40 && pickInRound >= 1 && pickInRound <= teams) {
      return (round - 1) * teams + pickInRound;
    }
  }

  // 4. Grid cell notation: e.g. "3.2", "3.02", "3.2."
  const m4 = trimmed.match(/^(\d+)\.(\d+)\.?$/);
  if (m4 && teams >= 4) {
    const round = parseInt(m4[1]!, 10);
    const pickInRound = parseInt(m4[2]!, 10);
    if (round >= 1 && round <= 40 && pickInRound >= 1 && pickInRound <= teams) {
      return (round - 1) * teams + pickInRound;
    }
  }

  return null;
}

/**
 * Checks for a combined pick number and manager name on a single line, e.g.:
 * "22. Frank", "22 - Frank", "Pick 22: Frank"
 */
function parsePickAndManagerCombo(str: string): { pickNum: number; manager: string } | null {
  const trimmed = str.trim();
  const m = trimmed.match(/^(?:(?:Pick|Pk)\s*)?#?(\d+)[.:\-–—]\s+(.+)$/i);
  if (m) {
    const val = parseInt(m[1]!, 10);
    const mgr = m[2]!.trim();
    if (val >= 1 && val <= 500 && mgr.length > 0 && !/\b(?:joined|left)\b/i.test(mgr)) {
      return { pickNum: val, manager: mgr };
    }
  }
  return null;
}

/**
 * Recognizes position and NFL team codes, whether on separate lines (standard Yahoo chat feed)
 * or combined on a single line (e.g. "TE - LV", "LV - TE", "TE LV").
 */
function parsePosAndTeamAtLine(
  lines: string[],
  idx: number,
): { pos: string; nflTeam: string; consumedLines: number } | null {
  if (idx < 0 || idx >= lines.length) return null;
  const line1 = lines[idx]!.trim();

  // Try line1 alone: "TE - LV", "LV - TE", "TE LV", "TE/LV", "TE, LV"
  const comboMatch = line1.match(/^([A-Za-z]{1,4})\s*[-–—,/]\s*([A-Za-z]{2,4})$/);
  if (comboMatch) {
    const p1 = comboMatch[1]!.toUpperCase();
    const p2 = comboMatch[2]!.toUpperCase();
    if (POSITIONS.has(p1)) return { pos: comboMatch[1]!, nflTeam: comboMatch[2]!, consumedLines: 1 };
    if (POSITIONS.has(p2)) return { pos: comboMatch[2]!, nflTeam: comboMatch[1]!, consumedLines: 1 };
  }
  const spaceMatch = line1.match(/^([A-Za-z]{1,4})\s+([A-Za-z]{2,4})$/);
  if (spaceMatch) {
    const p1 = spaceMatch[1]!.toUpperCase();
    const p2 = spaceMatch[2]!.toUpperCase();
    if (POSITIONS.has(p1)) return { pos: spaceMatch[1]!, nflTeam: spaceMatch[2]!, consumedLines: 1 };
    if (POSITIONS.has(p2)) return { pos: spaceMatch[2]!, nflTeam: spaceMatch[1]!, consumedLines: 1 };
  }

  // Try line1 (team) and line2 (pos) — standard Yahoo chat feed (e.g. line2 = "RB", line1 = "Det")
  if (idx >= 1) {
    const line2 = lines[idx - 1]!.trim();
    const posUpper = line2.toUpperCase();
    if (POSITIONS.has(posUpper) && /^[A-Za-z]{2,4}$/.test(line1)) {
      return { pos: line2, nflTeam: line1, consumedLines: 2 };
    }
    const teamUpper = line1.toUpperCase();
    if (POSITIONS.has(teamUpper) && /^[A-Za-z]{2,4}$/.test(line2)) {
      return { pos: line1, nflTeam: line2, consumedLines: 2 };
    }
  }

  return null;
}

/**
 * Fallback parser for text copied from tables or lists where "Bye" markers are absent.
 */
function parseFallbackRawPicks(
  lines: string[],
  rawPicks: Array<{
    pickNum: number | null;
    manager: string | null;
    playerName: string;
    injury?: string;
    position: string;
    nflTeam: string;
    byeWeek?: number;
  }>,
  teams: number,
) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Tab-delimited row: e.g. "22\tBrock Bowers\tTE\tLV\tFrank\t13"
    if (trimmed.includes('\t')) {
      const parts = trimmed.split('\t').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        let pickNum: number | null = null;
        let pIdx = 0;
        const parsed = parsePickNumber(parts[0]!, teams);
        if (parsed != null) {
          pickNum = parsed;
          pIdx = 1;
        }
        const playerName = parts[pIdx] ?? '';
        let pos = '';
        let nflTeam = '';
        for (let j = pIdx + 1; j < parts.length; j += 1) {
          const pt = parsePosAndTeamAtLine([parts[j]!], 0);
          if (pt) {
            pos = pt.pos;
            nflTeam = pt.nflTeam;
            break;
          }
          if (POSITIONS.has(parts[j]!.toUpperCase())) pos = parts[j]!;
          else if (/^[A-Za-z]{2,4}$/.test(parts[j]!)) nflTeam = parts[j]!;
        }
        if (playerName && (pos || nflTeam)) {
          rawPicks.push({ pickNum, manager: null, playerName, position: pos, nflTeam });
          continue;
        }
      }
    }

    // Numbered line: e.g. "22. Brock Bowers (LV - TE)" or "Pick 22: Brock Bowers - TE, LV"
    const m = trimmed.match(
      /^(?:(?:Pick|Pk)\s*)?#?(\d+)[.):\s]+([A-Za-z'.-]+(?:\s+[A-Za-z'.-]+)+)(?:[,\s\-–—(]+([A-Za-z]{1,4})\s*[-–—,/]\s*([A-Za-z]{2,4})\)?)?/i,
    );
    if (m) {
      const pickNum = parseInt(m[1]!, 10);
      const playerName = m[2]!.trim();
      let pos = '';
      let nflTeam = '';
      if (m[3] && m[4]) {
        const pt = parsePosAndTeamAtLine([`${m[3]} - ${m[4]}`], 0);
        if (pt) {
          pos = pt.pos;
          nflTeam = pt.nflTeam;
        }
      }
      rawPicks.push({ pickNum, manager: null, playerName, position: pos, nflTeam });
    }
  }
}

/**
 * Parses raw text copied directly from Yahoo live draft feed (chat / picks stream).
 */
function parseYahooDraftFeedText(
  lines: string[],
  players: readonly PlayerMeta[],
  idpPlayers?: readonly IdpPlayer[],
  teams = 10,
  fallbackStartingOverall?: number,
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

  let lastPickEndIdx = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const byeMatch = line.match(/(?:^|\b)Bye\s*[:\-]?\s*(\d+)/i);

    if (byeMatch) {
      const byeWeek = parseInt(byeMatch[1]!, 10);

      // Check if pos and team are on the lines preceding "Bye" or on the same line
      let posAndTeam = parsePosAndTeamAtLine(lines, i - 1);
      let consumedLines = posAndTeam ? posAndTeam.consumedLines : 0;

      if (!posAndTeam) {
        const beforeBye = line.slice(0, byeMatch.index).trim();
        if (beforeBye) {
          posAndTeam = parsePosAndTeamAtLine([beforeBye], 0);
          if (posAndTeam) consumedLines = 0;
        }
      }

      if (!posAndTeam) continue;

      const { pos, nflTeam } = posAndTeam;
      let playerIdx = (i - 1) - consumedLines;
      if (consumedLines === 0) playerIdx = i - 1;

      let injury: string | undefined;
      if (playerIdx >= 0 && INJURY_STATUSES.has(lines[playerIdx]!.toUpperCase())) {
        injury = lines[playerIdx];
        playerIdx -= 1;
      }

      if (playerIdx < 0) continue;
      const playerName = lines[playerIdx]!;

      // Skip duplicate player name lines (avatar/anchor text + name text)
      while (playerIdx >= 1 && lines[playerIdx - 1]!.trim().toLowerCase() === playerName.trim().toLowerCase()) {
        playerIdx -= 1;
      }

      // Candidate lines for this pick's metadata (pick number, manager, chat noise)
      const startIdx = Math.max(0, lastPickEndIdx + 1);
      const candidateLines = lines.slice(startIdx, playerIdx);

      let manager: string | null = null;
      let pickNum: number | null = null;
      let pickNumLineIdx = -1;

      // Check for combo line or explicit pick number in candidateLines (from bottom up)
      for (let c = candidateLines.length - 1; c >= 0; c -= 1) {
        const cLine = candidateLines[c]!;
        const combo = parsePickAndManagerCombo(cLine);
        if (combo) {
          pickNum = combo.pickNum;
          manager = combo.manager;
          pickNumLineIdx = c;
          break;
        }
        const parsed = parsePickNumber(cLine, teams);
        if (parsed != null) {
          pickNum = parsed;
          pickNumLineIdx = c;
          break;
        }
      }

      // If manager not found from combo, look for manager among remaining candidate lines
      if (!manager) {
        for (let c = candidateLines.length - 1; c >= 0; c -= 1) {
          if (c === pickNumLineIdx) continue;
          const cLine = candidateLines[c]!.trim();
          if (/^\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?$/i.test(cLine)) continue;
          if (/\b(?:joined|left|auto pick|on the clock|drafted|time remaining)\b/i.test(cLine)) continue;
          if (/^(?:pick|round|bye)\b/i.test(cLine)) continue;
          if (/^\d+$/.test(cLine)) continue;
          manager = cLine;
          break;
        }
      }

      lastPickEndIdx = i;

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

  // Fallback: If no Bye lines matched at all, try line-by-line / table parser
  if (rawPicks.length === 0) {
    parseFallbackRawPicks(lines, rawPicks, teams);
  }

  // Contiguous pick number inference:
  // If ANY pick in the snippet has a known pickNum, propagate contiguous numbers forward/backward
  const hasAnyPickNum = rawPicks.some((p) => p.pickNum != null);

  if (hasAnyPickNum) {
    for (let i = 0; i < rawPicks.length; i += 1) {
      if (rawPicks[i]!.pickNum == null) {
        // Look ahead for the next known pickNum
        const nextKnownIdx = rawPicks.findIndex((p, idx) => idx > i && p.pickNum != null);
        if (nextKnownIdx !== -1) {
          const diff = nextKnownIdx - i;
          rawPicks[i]!.pickNum = Math.max(1, rawPicks[nextKnownIdx]!.pickNum! - diff);
        } else {
          // Look behind for the previous known pickNum
          const prevKnownIdx = i - 1;
          if (prevKnownIdx >= 0 && rawPicks[prevKnownIdx]!.pickNum != null) {
            rawPicks[i]!.pickNum = rawPicks[prevKnownIdx]!.pickNum! + 1;
          }
        }
      }
    }
  } else {
    // No pick numbers found in the entire snippet!
    // Start from fallbackStartingOverall (e.g. nextManualOverall from the draft session), defaulting to 1
    const baseOverall = fallbackStartingOverall ?? 1;
    for (let i = 0; i < rawPicks.length; i += 1) {
      rawPicks[i]!.pickNum = baseOverall + i;
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
      const turnaroundPick = rawPicks[i]?.pickNum;
      if (turnaroundPick != null) {
        // In a snake draft of T teams, turnarounds occur at pick P = round * T.
        // If the session's existing teams divides turnaroundPick, it confirms the existing league size!
        if (teams >= 4 && teams <= 20 && turnaroundPick % teams === 0) {
          detectedTeams = teams;
          break;
        }
        // If turnaround is in Round 1 (P in [4..16]):
        if (turnaroundPick >= 4 && turnaroundPick <= 16) {
          detectedTeams = turnaroundPick;
          break;
        }
        // For later round turnarounds (e.g. turnaroundPick = 20, 24, 30, 36), find plausible T in [10, 12, 8, 14, 16] that divides P:
        const candidateSizes = [10, 12, 8, 14, 16];
        const matchedSize = candidateSizes.find((cand) => turnaroundPick % cand === 0);
        if (matchedSize != null) {
          detectedTeams = matchedSize;
          break;
        }
      }
    }
  }

  const effectiveTeams = detectedTeams ?? teams;
  const slotToTeamName: Record<number, string> = {};
  let detectedUserSlot: number | null = null;
  const picks: ParsedYahooPick[] = [];

  for (let idx = 0; idx < rawPicks.length; idx += 1) {
    const raw = rawPicks[idx]!;
    const overall = raw.pickNum!;
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

  // Detect league size: max pick in round 1, or max pick in any round across the pasted board cells
  const round1Picks = cellPositions.filter((c) => c.round === 1);
  const maxRound1Pick = round1Picks.length > 0 ? Math.max(...round1Picks.map((c) => c.pickInRound)) : 0;
  const maxAnyPickInRound = Math.max(...cellPositions.map((c) => c.pickInRound), 0);
  const detectedTeams = maxRound1Pick >= 4 && maxRound1Pick <= 20
    ? maxRound1Pick
    : maxAnyPickInRound >= 4 && maxAnyPickInRound <= 20
      ? maxAnyPickInRound
      : (teams >= 4 && teams <= 20 ? teams : 10);

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
  fallbackStartingOverall?: number,
): YahooParseResult {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { picks: [], slotToTeamName: {}, detectedUserSlot: null, detectedTeams: null };
  }

  // Detect Yahoo Draft Board grid view: contains "<round>.<pick>" labels (e.g. "1.1", "1.10", "2.1")
  // and does NOT contain "Bye <week>" feed markers.
  const hasByeLines = lines.some((l) => /\bBye\s*[:\-]?\s*\d+/i.test(l));
  const hasBoardCellLabels = lines.some((l) => /^\d+\.\d+\.?$/.test(l));

  if (!hasByeLines && hasBoardCellLabels) {
    return parseYahooDraftBoardText(lines, players, idpPlayers, teams);
  }

  return parseYahooDraftFeedText(lines, players, idpPlayers, teams, fallbackStartingOverall);
}
