import type { DraftInit, EspnDraftPickSummary, EspnLeagueSnapshot, Pick, PlayerId } from '../../../shared/types';
import { resolveEspnPlayer, type EspnPlayerIndex } from './espn';
import { espnLeagueToSettings } from './espnLeague';

/**
 * Completed-ESPN-draft import (2026-08-28 "one hub" connect surface). When the league-page capture
 * shows the league has ALREADY drafted (`drafted === true` + a populated `draftPicks` summary), the
 * connect card can write the drafted roster into My Leagues — the same `SavedDraft` shape
 * (`frozenInit` + `picks`) `/leagues/:id` already reconstructs ESPN rosters from. This adapter is
 * the one place raw ESPN picks become the app's `Pick` vocabulary; unmatched players resolve to
 * `playerId: null` with the raw name retained — surfaced, never dropped (CLAUDE.md).
 *
 * Slots are the standard SNAKE reconstruction: within round r, pick index i (0-based) maps to
 * slot i+1 on odd rounds and teams-i on even rounds. `slotToTeam` is derived from round 1's
 * actual teamIds (the capture's own draft order), and `mySlot` is the slot whose round-1 pick
 * belongs to the user's chosen team.
 */
export interface EspnImportedDraft {
  picks: Pick[];
  slotToTeam: Record<number, string>;
  mySlot: number | null;
  /** Count of picks whose player did not resolve to a canonical id (kept, shown honestly). */
  unmatchedPlayers: number;
}

export function buildEspnImportedDraft(
  snapshot: EspnLeagueSnapshot,
  myTeamId: number | null,
  index: EspnPlayerIndex,
): EspnImportedDraft | null {
  const summary = snapshot.draftPicks;
  if (!summary || summary.length === 0 || snapshot.teams <= 0) return null;
  const teams = snapshot.teams;

  const picks: Pick[] = [];
  const slotToTeam: Record<number, string> = {};
  let unmatchedPlayers = 0;
  for (const pick of summary) {
    const round = Math.ceil(pick.overall / teams);
    const indexInRound = (pick.overall - 1) % teams;
    const slot = round % 2 === 1 ? indexInRound + 1 : teams - indexInRound;
    const resolved = resolveEspnPlayer(index, {
      providerPlayerId: pick.playerId ?? '',
      name: pick.playerName,
      position: pick.position,
      proTeamId: pick.proTeamId,
    });
    if (resolved.playerId == null) unmatchedPlayers += 1;
    // Round 1's actual teamIds ARE the league's draft order — record slot -> teamId from them.
    if (round === 1 && pick.teamId != null) slotToTeam[slot] = String(pick.teamId);
    picks.push({
      overall: pick.overall,
      round,
      slot,
      teamId: pick.teamId != null ? String(pick.teamId) : String(slot),
      playerId: resolved.playerId,
      providerPlayerId: pick.playerId ?? String(pick.overall),
      providerPlayerName: resolved.providerPlayerName ?? pick.playerName ?? undefined,
    });
  }

  const roundOne = picks.filter((pick) => pick.round === 1);
  const myPick = myTeamId != null ? roundOne.find((pick) => pick.teamId === String(myTeamId)) : undefined;
  const mySlot = myPick?.slot ?? null;

  if (roundOne.length === teams && Object.keys(slotToTeam).length !== teams) {
    // Round 1 should pin every slot; a gap means ESPN omitted teamIds — disclosed, not fatal.
    console.info(`[ffa-import] round-1 teamIds incomplete: ${Object.keys(slotToTeam).length}/${teams} slots pinned`);
  }

  return { picks, slotToTeam, mySlot, unmatchedPlayers };
}

/** The `frozenInit` for an imported draft: the parsed snapshot's settings + the reconstruction's
 * seat/order data. `draftId` is synthetic (`espn-import:<leagueId>`) — ESPN's draft recap has no
 * stable draft id in the leagues-API capture, and the SavedLeague pointer is the durable key. */
export function buildEspnImportedInit(
  snapshot: EspnLeagueSnapshot,
  myTeamId: number | null,
  imported: EspnImportedDraft,
): DraftInit {
  return {
    provider: 'espn',
    draftId: `espn-import:${snapshot.leagueId}`,
    leagueId: snapshot.leagueId,
    draftType: 'snake',
    teams: snapshot.teams,
    rounds: snapshot.rounds ?? Math.ceil(imported.picks.length / Math.max(snapshot.teams, 1)),
    slotToTeam: imported.slotToTeam,
    myTeamId: myTeamId != null ? String(myTeamId) : null,
    mySlot: imported.mySlot,
    settings: espnLeagueToSettings(snapshot),
  };
}

/** Type guard used by the connect route — a summary entry with no usable identity is skipped
 * upstream; this re-checks the boundary cheaply. */
export function isImportablePickSummary(pick: EspnDraftPickSummary): pick is EspnDraftPickSummary & { playerId: PlayerId | null } {
  return pick.playerId != null || pick.playerName != null;
}