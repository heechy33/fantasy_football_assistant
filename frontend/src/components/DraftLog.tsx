import { memo, useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { DraftInit, OnTheClock, Pick, PlayerId, PlayerMeta, Position } from '../../../shared/types';
import { roundForOverall, roundPickLabel, slotForOverall } from '../adapters/draftOrder';
import { PositionBadge } from './PositionBadge';

export interface DraftLogProps {
  draftInit: DraftInit | null;
  effectivePicks: Pick[];
  playersById: ReadonlyMap<PlayerId, PlayerMeta>;
  onTheClock: OnTheClock | null;
  onCorrectPick: (overall: number) => void;
  /** Row-click → player detail drawer, threaded from `DraftWorkspace`'s `handleViewDetails`.
   * Must stay a stable reference (see `stableViewPlayer` below) to honor the row memo contract. */
  onViewPlayer?: (playerId: PlayerId) => void;
  /** The user's own next selection (from `boundaries.decisionPick`) — the same target the top-bar
   * countdown is built from. Never recomputed here, so the recommendation board, top bar, and log
   * always agree on which pick is "yours." */
  userNextOverall: number | null;
  /** Picks remaining until that turn; `0` means the user is on the clock right now. */
  picksUntilUserTurn: number | null;
}

interface DraftLogRowProps {
  teams: number;
  overall: number;
  teamName: string;
  pick: Pick | undefined;
  playerId: PlayerId | null;
  playerName: string | undefined;
  position: Position | null;
  isOnClock: boolean;
  isMine: boolean;
  isYouUp: boolean;
  youUpText: string | null;
  isScrollTarget: boolean;
  currentRowRef: RefObject<HTMLLIElement | null>;
  onCorrectPick: (overall: number) => void;
  onViewPlayer: ((playerId: PlayerId) => void) | undefined;
}

function youUpLabel(picksUntilUserTurn: number | null): string | null {
  if (picksUntilUserTurn == null) return null;
  if (picksUntilUserTurn === 0) return "You're on the clock";
  return `You're up in ${picksUntilUserTurn} pick${picksUntilUserTurn === 1 ? '' : 's'}`;
}

/**
 * Memoized so the ~192-row list does not fully reconcile on every 1s stale-banner tick from
 * `useDraftPoll`. Parent still re-renders; unchanged row props bail out of DOM work. Every prop
 * here is a primitive (or a stable `Pick` reference from `effectivePicks`) — never a
 * freshly-allocated entry object — so an unrelated parent re-render can't defeat this memo.
 * `youUpText` is `null` on every row except the user's next pick, so a countdown tick only
 * reconciles that one row.
 */
const DraftLogRow = memo(function DraftLogRow({
  teams,
  overall,
  teamName,
  pick,
  playerId,
  playerName,
  position,
  isOnClock,
  isMine,
  isYouUp,
  youUpText,
  isScrollTarget,
  currentRowRef,
  onCorrectPick,
  onViewPlayer,
}: DraftLogRowProps) {
  const isUnmatched = pick != null && pick.playerId === null;
  const hasPlayerToView = playerId != null;
  const displayName = pick
    ? isUnmatched
      ? `Unmatched: ${pick.providerPlayerName ?? pick.providerPlayerId}`
      : (playerName ?? pick.providerPlayerName ?? pick.playerId)
    : null;

  const pickNo = roundPickLabel(teams, overall);
  const cardBody = (
    <>
      <span className="draft-log-name">{displayName ?? '———'}</span>
      <span className="draft-log-team">{teamName}</span>
      {position && <PositionBadge position={position} className="draft-log-position-chip" />}
    </>
  );

  return (
    <li
      ref={isScrollTarget ? currentRowRef : undefined}
      data-on-clock={isOnClock || undefined}
      data-mine={isMine || undefined}
      data-you-up={isYouUp || undefined}
      data-scroll-target={isScrollTarget || undefined}
      className="draft-log-row"
    >
      {youUpText && (
        <span className="draft-log-you-up">{youUpText}</span>
      )}
      <div className="draft-log-row-body">
        <span className="draft-log-pick-no" aria-label={`Pick ${pickNo}`}>{pickNo}</span>
        {hasPlayerToView ? (
          <button type="button" className="draft-log-card" onClick={() => onViewPlayer?.(playerId)}>
            {cardBody}
          </button>
        ) : (
          <div className={`draft-log-card ${pick ? 'draft-log-card-unmatched' : 'draft-log-card-future'}`}>
            {cardBody}
          </div>
        )}
      </div>
      {pick && (
        <button className="quiet-button draft-log-fix" type="button" onClick={() => onCorrectPick(overall)}>
          {isUnmatched ? 'Fix' : 'Edit'}
        </button>
      )}
    </li>
  );
});

type LogEntry =
  | { kind: 'round'; round: number }
  | {
      kind: 'row';
      overall: number;
      teamName: string;
      pick: Pick | undefined;
      playerId: PlayerId | null;
      playerName: string | undefined;
      position: Position | null;
      isOnClock: boolean;
      isMine: boolean;
      isYouUp: boolean;
      isScrollTarget: boolean;
    };

/**
 * Left rail of the three-column workspace. DraftSharks-style card list: each pick is a discrete
 * card showing `round.pick`, the player name, the team nickname, and a colored position chip; the
 * user's own upcoming pick is the highlighted "You're Up!" card. Landed picks (matched or
 * unmatched) keep a Fix/Edit control so a wrong match or crosswalk miss can be corrected — a
 * silently wrong board corrupts every downstream recommendation (see `shared/types.d.ts`'s
 * `Pick.playerId` doc).
 */
export function DraftLog({
  draftInit,
  effectivePicks,
  playersById,
  onTheClock,
  onCorrectPick,
  onViewPlayer,
  userNextOverall,
  picksUntilUserTurn,
}: DraftLogProps) {
  const currentRowRef = useRef<HTMLLIElement | null>(null);
  // App passes an inline onCorrectPick; keep a stable identity so memoized rows survive the 1s
  // stale-banner re-render from useDraftPoll.
  const onCorrectPickRef = useRef(onCorrectPick);
  onCorrectPickRef.current = onCorrectPick;
  const stableCorrectPick = useCallback((overall: number) => {
    onCorrectPickRef.current(overall);
  }, []);

  // Same stable-identity pattern for the card-click → player-detail handler, so ~192 memoized
  // rows never see a fresh closure on a poll tick.
  const onViewPlayerRef = useRef(onViewPlayer);
  onViewPlayerRef.current = onViewPlayer;
  const stableViewPlayer = useCallback((playerId: PlayerId) => {
    onViewPlayerRef.current?.(playerId);
  }, []);

  const pickedByOverall = useMemo(() => new Map(effectivePicks.map((p) => [p.overall, p])), [effectivePicks]);
  const totalPicks = draftInit ? draftInit.teams * draftInit.rounds : 0;
  const draftComplete = totalPicks > 0 && effectivePicks.length >= totalPicks;
  // On the clock while drafting; once the board is full, land on the final overall so
  // "Go to current pick" still has a destination (computeOnTheClock returns null when complete).
  const scrollTargetOverall = onTheClock?.overall ?? (draftComplete ? totalPicks : null);

  const entries = useMemo<LogEntry[]>(() => {
    if (!draftInit || totalPicks <= 0) return [];
    const list: LogEntry[] = [];
    for (let overall = 1; overall <= totalPicks; overall += 1) {
      const round = roundForOverall(draftInit.teams, overall);
      if (overall === (round - 1) * draftInit.teams + 1) {
        list.push({ kind: 'round', round });
      }
      // Landed pick slots remain authoritative (including manually corrected picks) — only
      // fall back to the arithmetic slot for picks that haven't landed yet.
      const pick = pickedByOverall.get(overall);
      const slot = pick?.slot ?? slotForOverall(draftInit.draftType, draftInit.teams, overall);
      const teamName = draftInit.slotToTeamName?.[slot] ?? `Team ${slot}`;
      const player = pick?.playerId ? playersById.get(pick.playerId) : undefined;
      const isOnClock = onTheClock?.overall === overall;
      const isMine = (pick?.teamId ?? (isOnClock ? onTheClock.teamId : null)) === draftInit.myTeamId;
      list.push({
        kind: 'row',
        overall,
        teamName,
        pick,
        playerId: pick?.playerId ?? null,
        playerName: player?.name,
        position: player?.position ?? null,
        isOnClock,
        isMine,
        isYouUp: overall === userNextOverall,
        isScrollTarget: scrollTargetOverall === overall,
      });
    }
    return list;
  }, [draftInit, totalPicks, pickedByOverall, playersById, onTheClock, userNextOverall, scrollTargetOverall]);

  function scrollToCurrent() {
    currentRowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // Auto-follow on connect / clock advance / draft completion.
  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: 'center' });
  }, [scrollTargetOverall]);

  if (!draftInit) {
    return <section className="draft-log"><p>No draft connected yet.</p></section>;
  }

  return (
    <section className="draft-log" aria-label="Draft log">
      <div className="section-heading">
        <h2 className="section-title-accent">Draft log</h2>
        <button className="quiet-button draft-log-jump" type="button" onClick={scrollToCurrent} aria-label="Go to current pick">
          Go to Current Pick
        </button>
      </div>
      <ol className="draft-log-list">
        {entries.map((entry) => {
          if (entry.kind === 'round') {
            return (
              <li key={`round-${entry.round}`} role="presentation" className="draft-log-round-header">
                Round {entry.round}
              </li>
            );
          }
          const {
            overall, teamName, pick, playerId, playerName, position, isOnClock, isMine, isYouUp, isScrollTarget,
          } = entry;
          return (
            <DraftLogRow
              key={overall}
              teams={draftInit.teams}
              overall={overall}
              teamName={teamName}
              pick={pick}
              playerId={playerId}
              playerName={playerName}
              position={position}
              isOnClock={isOnClock}
              isMine={isMine}
              isYouUp={isYouUp}
              youUpText={isYouUp ? youUpLabel(picksUntilUserTurn) : null}
              isScrollTarget={isScrollTarget}
              currentRowRef={currentRowRef}
              onCorrectPick={stableCorrectPick}
              onViewPlayer={stableViewPlayer}
            />
          );
        })}
      </ol>
    </section>
  );
}
