import type { DraftInit, DraftStatus, OnTheClock, Pick } from '../../../shared/types';
import type { DraftPollPhase } from '../hooks/useDraftPoll';

export interface DraftBoardProps {
  draftInit: DraftInit | null;
  effectivePicks: Pick[];
  onTheClock: OnTheClock | null;
  status: DraftStatus | DraftPollPhase;
  isStale: boolean;
  dataAgeMs: number | null;
  onCorrectPick: (overall: number) => void;
}

/**
 * Presentational only — doesn't compute staleness or on-the-clock itself,
 * just renders what it's given. Minimal styling; visual polish is S4's
 * explicit territory.
 */
export function DraftBoard({
  draftInit,
  effectivePicks,
  onTheClock,
  status,
  isStale,
  dataAgeMs,
  onCorrectPick,
}: DraftBoardProps) {
  if (!draftInit) {
    return <p>No draft connected yet.</p>;
  }

  const pickedByOverall = new Map(effectivePicks.map((p) => [p.overall, p]));
  const totalPicks = draftInit.teams * draftInit.rounds;
  const overallNumbers = Array.from({ length: totalPicks }, (_, i) => i + 1);

  return (
    <section>
      <h2>Draft board</h2>
      <p>
        Status: {status}
        {isStale && (
          <strong> — stale{dataAgeMs != null ? ` (${Math.round(dataAgeMs / 1000)}s old)` : ''}</strong>
        )}
      </p>
      {onTheClock && (
        <p>
          On the clock: team {onTheClock.teamId} (round {onTheClock.round}, pick {onTheClock.overall})
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Overall</th>
            <th>Round</th>
            <th>Team</th>
            <th>Player</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {overallNumbers.map((overall) => {
            const pick = pickedByOverall.get(overall);
            const isOnClock = onTheClock?.overall === overall;
            const isUnmatched = pick != null && pick.playerId === null;

            return (
              <tr key={overall} data-on-clock={isOnClock || undefined}>
                <td>{overall}</td>
                <td>{Math.ceil(overall / draftInit.teams)}</td>
                <td>{pick?.teamId ?? (isOnClock ? onTheClock.teamId : '')}</td>
                <td data-unmatched={isUnmatched || undefined}>
                  {pick
                    ? isUnmatched
                      ? `Unmatched: ${pick.providerPlayerName ?? pick.providerPlayerId}`
                      : (pick.providerPlayerName ?? pick.playerId)
                    : isOnClock
                      ? 'On the clock'
                      : ''}
                </td>
                <td>
                  {pick && (
                    <button type="button" onClick={() => onCorrectPick(overall)}>
                      Correct
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
