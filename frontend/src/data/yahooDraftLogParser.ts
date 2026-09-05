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
}

const INJURY_STATUSES = new Set(['Q', 'IR', 'O', 'PUP', 'SUSP', 'NA', 'D', 'SSPD']);

function cleanLastName(name: string): string {
  return name.replace(/\s+(?:III|II|IV|V|Jr\.?|Sr\.?)$/i, '').trim().toLowerCase();
}

/**
 * Parses raw text copied directly from the Yahoo live draft room feed.
 */
export function parseYahooDraftText(
  rawText: string,
  players: readonly PlayerMeta[],
  idpPlayers?: readonly IdpPlayer[],
  teams = 10,
): YahooParseResult {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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

      let manager: string | null = null;
      let pickNum: number | null = null;

      if (playerIdx >= 1) {
        const prev1 = lines[playerIdx - 1]!;
        if (/^\d+$/.test(prev1)) {
          pickNum = parseInt(prev1, 10);
        } else {
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

  // Pre-index players by (cleanLastName, position)
  const playersByLastAndPos = new Map<string, PlayerMeta[]>();
  for (const player of players) {
    const fullName = player.name ?? '';
    const parts = fullName.split(' ');
    const last = cleanLastName(parts.length > 1 ? parts.slice(1).join(' ') : fullName);
    const key = `${last}|${player.position ?? ''}`.toLowerCase();
    const existing = playersByLastAndPos.get(key) ?? [];
    existing.push(player);
    playersByLastAndPos.set(key, existing);
  }

  // Pre-index IDP players by cleanLastName and pos
  const idpByLast = new Map<string, IdpPlayer[]>();
  if (idpPlayers) {
    for (const idp of idpPlayers) {
      const parts = idp.name.split(' ');
      const last = cleanLastName(parts.length > 1 ? parts.slice(1).join(' ') : idp.name);
      const key = `${last}|${idp.pos}`.toLowerCase();
      const existing = idpByLast.get(key) ?? [];
      existing.push(idp);
      idpByLast.set(key, existing);
    }
  }

  const slotToTeamName: Record<number, string> = {};
  let detectedUserSlot: number | null = null;
  const picks: ParsedYahooPick[] = [];

  for (let idx = 0; idx < rawPicks.length; idx += 1) {
    const raw = rawPicks[idx]!;
    const overall = raw.pickNum ?? (idx + 1);
    const slot = slotForOverall('snake', teams, overall);

    let isUserPick = false;
    if (raw.manager) {
      if (raw.manager.toLowerCase() === 'you') {
        isUserPick = true;
        detectedUserSlot = slot;
      } else {
        slotToTeamName[slot] = raw.manager;
      }
    }

    // Match player
    let matchedPlayer: PlayerMeta | undefined;
    let matchedIdp: IdpPlayer | undefined;
    let playerId: PlayerId | null = null;

    const parts = raw.playerName.split('. ');
    let init = '';
    let last = cleanLastName(raw.playerName);
    if (parts.length === 2) {
      init = parts[0]!.toLowerCase().replace(/[^a-z]/g, '');
      last = cleanLastName(parts[1]!);
    }

    const key = `${last}|${raw.position}`.toLowerCase();
    const candidates = playersByLastAndPos.get(key) ?? [];

    const nameFiltered = candidates.filter((c) => {
      if (!init) return true;
      const firstName = (c.name ?? '').split(' ')[0] ?? '';
      return firstName.toLowerCase().startsWith(init);
    });

    if (nameFiltered.length === 1 && nameFiltered[0]) {
      matchedPlayer = nameFiltered[0];
      playerId = matchedPlayer.playerId;
    } else if (nameFiltered.length > 1) {
      const teamMatches = nameFiltered.filter((c) => (c.team ?? '').toLowerCase() === raw.nflTeam.toLowerCase());
      const chosen = (teamMatches.length === 1 && teamMatches[0]) ? teamMatches[0] : nameFiltered[0];
      if (chosen) {
        matchedPlayer = chosen;
        playerId = chosen.playerId;
      }
    }

    // If not matched in offensive pool, check IDP pool
    if (!matchedPlayer && idpPlayers) {
      const idpKey = `${last}|${raw.position}`.toLowerCase();
      const idpCandidates = idpByLast.get(idpKey) ?? [];
      const idpFiltered = idpCandidates.filter((c) => {
        if (!init) return true;
        const firstName = c.name.split(' ')[0] ?? '';
        return firstName.toLowerCase().startsWith(init);
      });
      if (idpFiltered.length >= 1) {
        matchedIdp = idpFiltered.find((c) => c.team.toLowerCase() === raw.nflTeam.toLowerCase()) ?? idpFiltered[0];
      }
    }

    picks.push({
      overall,
      managerName: raw.manager ?? undefined,
      isUserPick,
      playerName: matchedPlayer?.name ?? matchedIdp?.name ?? raw.playerName,
      injury: raw.injury,
      position: raw.position,
      nflTeam: raw.nflTeam,
      byeWeek: raw.byeWeek,
      playerId,
      matchedPlayer,
      matchedIdp,
    });
  }

  return {
    picks,
    slotToTeamName,
    detectedUserSlot,
  };
}
