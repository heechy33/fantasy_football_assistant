import { memo, useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { DraftInit, OnTheClock, Pick, PlayerId, PlayerMeta, Position } from '../../../shared/types';
import { picksMade, roundForOverall, slotForOverall } from '../adapters/draftOrder';
import { draftMark, draftMeasure, draftPollMarkName } from '../lib/perf';
import { PositionBadge } from './PositionBadge';

export interface DraftLogProps {
  draftInit: DraftInit | null;
  effectivePicks: Pick[];
  /** Id of the poll response that changed `effectivePicks`; dev timing only. */
  timingPollId?: number | null;
  playersById: ReadonlyMap<PlayerId, PlayerMeta>;
  onTheClock: OnTheClock | null;
  /** Row-click → player detail drawer, threaded from `DraftWorkspace`'s `handleViewDetails`.
   * Must stay a stable reference (see `stableViewPlayer` below) to honor the row memo contract. */
  onViewPlayer?: (playerId: PlayerId) => void;
  /** Row-level correction ("Edit pick"). Stable-reference contract like `onViewPlayer`. */
  onCorrect?: (overall: number) => void;
  /** The user's own next selection (from `boundaries.decisionPick`) — the same target the top-bar
   * countdown is built from. Never recomputed here, so the recommendation board, top bar, and log
   * always agree on which pick is "yours." */
  userNextOverall: number | null;
  /** Picks remaining until that turn; `0` means the user is on the clock right now. */
  picksUntilUserTurn: number | null;
  /** `round.pick` hero label (e.g. `6.09`) for the clock banner below the list — `null` hides the
   * banner (no draft connected yet). */
  roundPick: string | null;
}

interface DraftLogRowProps {
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
  onViewPlayer: ((playerId: PlayerId) => void) | undefined;
  onCorrect: ((overall: number) => void) | undefined;
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
  onViewPlayer,
  onCorrect,
}: DraftLogRowProps) {
  const isUnmatched = pick != null && pick.playerId === null;
  const hasPlayerToView = playerId != null;
  const displayName = pick
    ? isUnmatched
      ? `Unmatched: ${pick.providerPlayerName ?? pick.providerPlayerId}`
      : (playerName ?? pick.providerPlayerName ?? pick.playerId)
    : null;

  const pickNo = `#${overall}`;
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
        <button
          type="button"
          className="quiet-button draft-log-edit"
          aria-label={`Edit pick ${pickNo}`}
          onClick={() => onCorrect?.(overall)}
        >
          Edit
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

/** Whether the current row has scrolled fully out of the log's visible band. Auto-follow centers
 * the row, so a programmatic scroll can never trip this; only a manual user scroll can. */
function isRowOutOfView(row: HTMLElement, list: HTMLElement): boolean {
  const rowRect = row.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  return rowRect.bottom < listRect.top || rowRect.top > listRect.bottom;
}

/** Centers `row` within `list` by scrolling `list` alone (`Element.scrollBy`, not
 * `scrollIntoView`). `scrollIntoView` walks every scrollable ancestor — including the sticky
 * `.draft-log` panel's own containing block — so it was recentering the whole page around the row
 * instead of just the log. This keeps the jump local to the log's own scroll container. */
function centerRowInList(list: HTMLElement, row: HTMLElement, behavior: ScrollBehavior) {
  const listRect = list.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const delta = (rowRect.top + rowRect.height / 2) - (listRect.top + listRect.height / 2);
  list.scrollBy({ top: delta, behavior });
}

/**
 * Left rail of the three-column workspace. DraftSharks-style card list: each pick is a discrete
 * card showing the overall pick number (`#97`), the player name, the team nickname, and a colored
 * position chip; the user's own upcoming pick is the highlighted "You're Up!" card.
 */
export const DraftLog = memo(function DraftLog({
  draftInit,
  effectivePicks,
  timingPollId = null,
  playersById,
  onTheClock,
  onViewPlayer,
  onCorrect,
  userNextOverall,
  picksUntilUserTurn,
  roundPick,
}: DraftLogProps) {
  const currentRowRef = useRef<HTMLLIElement | null>(null);
  const logListRef = useRef<HTMLOListElement | null>(null);
  // True once the user has scrolled the current row out of view. Auto-follow then stays silent
  // until they click "Go to current pick" or a new draft connects.
  const userScrolledAwayRef = useRef(false);
  const measuredPollIdRef = useRef<number | null>(null);

  const onViewPlayerRef = useRef(onViewPlayer);
  onViewPlayerRef.current = onViewPlayer;
  const stableViewPlayer = useCallback((playerId: PlayerId) => {
    onViewPlayerRef.current?.(playerId);
  }, []);

  const onCorrectRef = useRef(onCorrect);
  onCorrectRef.current = onCorrect;
  const stableCorrect = useCallback((overall: number) => {
    onCorrectRef.current?.(overall);
  }, []);

  const pickedByOverall = useMemo(() => new Map(effectivePicks.map((p) => [p.overall, p])), [effectivePicks]);
  const totalPicks = draftInit ? draftInit.teams * draftInit.rounds : 0;
  const draftComplete = totalPicks > 0 && picksMade(effectivePicks) >= totalPicks;
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
    userScrolledAwayRef.current = false;
    const list = logListRef.current;
    const row = currentRowRef.current;
    if (list && row) centerRowInList(list, row, 'smooth');
  }

  // A manual scroll that takes the current row fully out of view is a "scrolled away" gesture.
  // Auto-follow's own scrollIntoView always centers the row, so it cannot trip this listener.
  useEffect(() => {
    const list = logListRef.current;
    if (!list) return;
    const handleScroll = () => {
      const row = currentRowRef.current;
      if (row && isRowOutOfView(row, list)) userScrolledAwayRef.current = true;
    };
    list.addEventListener('scroll', handleScroll, { passive: true });
    return () => list.removeEventListener('scroll', handleScroll);
  }, []);

  // A fresh draft re-engages auto-follow; the old draft's "scrolled away" state is meaningless.
  // When it does re-engage (the flag was actually set), scroll now — the clock target may be
  // unchanged, so the `scrollTargetOverall` effect alone would not fire again.
  useEffect(() => {
    const wasAway = userScrolledAwayRef.current;
    userScrolledAwayRef.current = false;
    const list = logListRef.current;
    const row = currentRowRef.current;
    if (wasAway && list && row) centerRowInList(list, row, 'auto');
  }, [draftInit]);

  // Auto-follow on connect / clock advance / draft completion — but never once the user has
  // manually scrolled away from the current row (they are reading elsewhere in the log). Smooth
  // so each clock advance eases the log down instead of snapping.
  useEffect(() => {
    if (userScrolledAwayRef.current) return;
    const list = logListRef.current;
    const row = currentRowRef.current;
    if (list && row) centerRowInList(list, row, 'smooth');
  }, [scrollTargetOverall]);

  // Layout effects happen before the browser paints, so call this a post-commit frame instead of
  // pretending it proves paint. Two animation frames give the committed log an opportunity to be
  // presented before we timestamp it.
  useEffect(() => {
    if (timingPollId == null || measuredPollIdRef.current === timingPollId) return;
    measuredPollIdRef.current = timingPollId;
    const responseMark = draftPollMarkName(timingPollId, 'response');
    const frameMark = draftPollMarkName(timingPollId, 'log-next-frame');
    const report = () => {
      draftMark(frameMark);
      if (!import.meta.env.DEV) return;
      const frameMs = draftMeasure(`log: poll/${timingPollId}→next-frame`, responseMark, frameMark);
      if (frameMs != null) {
        // eslint-disable-next-line no-console
        console.debug(`[draft-timing] poll→log next-frame ${frameMs.toFixed(1)}ms`);
      }
    };
    if (typeof requestAnimationFrame !== 'function') {
      report();
      return;
    }
    let secondFrame: number | null = null;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(report);
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame != null) cancelAnimationFrame(secondFrame);
    };
  }, [entries, timingPollId]);

  if (!draftInit) {
    return <section className="draft-log"><p>No draft connected yet.</p></section>;
  }

  const showCountdown = picksUntilUserTurn != null && picksUntilUserTurn > 0;
  const onClockNow = picksUntilUserTurn === 0;

  return (
    <section className="draft-log" aria-label="Draft log">
      <div className="section-heading">
        <h2 className="section-title-accent">Draft log</h2>
      </div>
      <ol ref={logListRef} className="draft-log-list">
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
              onViewPlayer={stableViewPlayer}
              onCorrect={stableCorrect}
            />
          );
        })}
      </ol>
      {roundPick != null && (
        <button
          type="button"
          className="draft-log-clock-banner"
          data-onclock={onClockNow || undefined}
          onClick={scrollToCurrent}
          aria-label="Go to current pick"
        >
          <span className="draft-log-clock-banner-label">Round</span>
          <strong className="draft-log-clock-banner-pick">{roundPick}</strong>
          {onClockNow && (
            <span className="draft-log-clock-banner-status" data-onclock="true">On the clock</span>
          )}
          {showCountdown && (
            <span className="draft-log-clock-banner-status">{picksUntilUserTurn} until your turn</span>
          )}
          <span className="draft-log-clock-banner-jump" aria-hidden="true">Jump to pick ↓</span>
        </button>
      )}
    </section>
  );
});
