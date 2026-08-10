import { memo, useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { DraftInit, DraftStatus, OnTheClock, Pick, PlayerId, PlayerMeta } from '../../../shared/types';
import type { DraftPollPhase } from '../hooks/useDraftPoll';

export interface DraftLogProps {
  draftInit: DraftInit | null;
  effectivePicks: Pick[];
  playersById: ReadonlyMap<PlayerId, PlayerMeta>;
  onTheClock: OnTheClock | null;
  status: DraftStatus | DraftPollPhase;
  isStale: boolean;
  dataAgeMs: number | null;
  onCorrectPick: (overall: number) => void;
}

interface DraftLogRowProps {
  overall: number;
  round: number;
  pick: Pick | undefined;
  playerName: string | undefined;
  isOnClock: boolean;
  isMine: boolean;
  isScrollTarget: boolean;
  currentRowRef: RefObject<HTMLLIElement | null>;
  onCorrectPick: (overall: number) => void;
}

/**
 * Memoized so the ~192-row list does not fully reconcile on every 1s stale-banner tick from
 * `useDraftPoll`. Parent still re-renders; unchanged row props bail out of DOM work.
 */
const DraftLogRow = memo(function DraftLogRow({
  overall,
  round,
  pick,
  playerName,
  isOnClock,
  isMine,
  isScrollTarget,
  currentRowRef,
  onCorrectPick,
}: DraftLogRowProps) {
  const isUnmatched = pick != null && pick.playerId === null;

  return (
    <li
      ref={isScrollTarget ? currentRowRef : undefined}
      data-on-clock={isOnClock || undefined}
      data-mine={isMine || undefined}
      data-scroll-target={isScrollTarget || undefined}
      className="draft-log-row"
    >
      <span className="draft-log-overall">#{overall}</span>
      <span className="draft-log-round">R{round}</span>
      <span className="draft-log-player">
        {pick
          ? isUnmatched
            ? `Unmatched: ${pick.providerPlayerName ?? pick.providerPlayerId}`
            : (playerName ?? pick.providerPlayerName ?? pick.playerId)
          : isOnClock
            ? 'On the clock'
            : ''}
      </span>
      {isUnmatched && (
        <button className="quiet-button draft-log-fix" type="button" onClick={() => onCorrectPick(overall)}>
          Fix
        </button>
      )}
    </li>
  );
});

/**
 * Left rail of the three-column workspace. Read-only for matched picks — the FIFA-workspace redesign
 * removes the old per-row "Correct" button on every pick, but an unmatched pick (crosswalk miss,
 * `pick.playerId === null`) keeps a `Fix` control. Removing that entirely would leave a drafted
 * player permanently shown as available on the recommendation board, which is the exact failure
 * `shared/types.d.ts`'s `Pick.playerId` doc calls out as strictly worse than a visible gap.
 */
export function DraftLog({
  draftInit,
  effectivePicks,
  playersById,
  onTheClock,
  status,
  isStale,
  dataAgeMs,
  onCorrectPick,
}: DraftLogProps) {
  const currentRowRef = useRef<HTMLLIElement | null>(null);
  // App passes an inline onCorrectPick; keep a stable identity so memoized rows survive the 1s
  // stale-banner re-render from useDraftPoll.
  const onCorrectPickRef = useRef(onCorrectPick);
  onCorrectPickRef.current = onCorrectPick;
  const stableCorrectPick = useCallback((overall: number) => {
    onCorrectPickRef.current(overall);
  }, []);

  const pickedByOverall = useMemo(() => new Map(effectivePicks.map((p) => [p.overall, p])), [effectivePicks]);
  const totalPicks = draftInit ? draftInit.teams * draftInit.rounds : 0;
  const overallNumbers = useMemo(() => Array.from({ length: totalPicks }, (_, i) => i + 1), [totalPicks]);
  const draftComplete = totalPicks > 0 && effectivePicks.length >= totalPicks;
  // On the clock while drafting; once the board is full, land on the final overall so
  // "Go to current pick" still has a destination (computeOnTheClock returns null when complete).
  const scrollTargetOverall = onTheClock?.overall ?? (draftComplete ? totalPicks : null);

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
        <div>
          <p className="eyebrow">Live</p>
          <h2>Draft log</h2>
        </div>
        <button className="quiet-button" type="button" onClick={scrollToCurrent}>Go to current pick</button>
      </div>
      <p>
        Status: {status}
        {isStale && <strong> — stale{dataAgeMs != null ? ` (${Math.round(dataAgeMs / 1000)}s old)` : ''}</strong>}
      </p>
      <ol className="draft-log-list">
        {overallNumbers.map((overall) => {
          const pick = pickedByOverall.get(overall);
          const isOnClock = onTheClock?.overall === overall;
          const isMine = (pick?.teamId ?? (isOnClock ? onTheClock.teamId : null)) === draftInit.myTeamId;
          const player = pick?.playerId ? playersById.get(pick.playerId) : undefined;
          const round = Math.ceil(overall / draftInit.teams);

          return (
            <DraftLogRow
              key={overall}
              overall={overall}
              round={round}
              pick={pick}
              playerName={player?.name}
              isOnClock={isOnClock}
              isMine={isMine}
              isScrollTarget={scrollTargetOverall === overall}
              currentRowRef={currentRowRef}
              onCorrectPick={stableCorrectPick}
            />
          );
        })}
      </ol>
    </section>
  );
}
