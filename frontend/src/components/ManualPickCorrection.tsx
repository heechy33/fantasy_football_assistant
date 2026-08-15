import { useMemo, useState, type FormEvent } from 'react';
import type { PlayerId } from '../../../shared/types';
import type { RankedPlayer } from '../data/loadPlayerPool';
import { useModalFocus } from '../hooks/useModalFocus';
import type { PickOverride } from '../state/draftBoardState';

export interface ManualPickCorrectionProps {
  mode: 'correct-existing' | 'add-manual';
  overall: number;
  round?: number;
  slot?: number;
  teamId?: string;
  /** Display name for `teamId` (e.g. "Team 7") — purely informational, never submitted. */
  teamName?: string;
  currentProviderName?: string;
  rankedPlayers: RankedPlayer[];
  unavailablePlayerIds: ReadonlySet<PlayerId>;
  onSubmit: (override: PickOverride) => void;
  onUndo: (overall: number) => void;
  onClose: () => void;
}

/**
 * Same component serves both a live-pick correction and universal manual entry. Round/slot/team
 * are always derived by the caller from the snake draft order and passed in read-only — the whole
 * point of tracking a draft is that its order is known in advance, so re-typing "who's picking"
 * for every pick would just be busywork. Instead of an opaque name search, the available ADP
 * board is exposed in rank order so the next player is always one click away.
 */
export function ManualPickCorrection({
  mode,
  overall,
  round,
  slot,
  teamId,
  teamName,
  currentProviderName,
  rankedPlayers,
  unavailablePlayerIds,
  onSubmit,
  onUndo,
  onClose,
}: ManualPickCorrectionProps) {
  const isAddManual = mode === 'add-manual';
  const [selected, setSelected] = useState<RankedPlayer | null>(null);

  const availablePlayers = useMemo(
    () => rankedPlayers.filter((player) => !unavailablePlayerIds.has(player.playerId)),
    [rankedPlayers, unavailablePlayerIds],
  );
  const canSubmit = selected != null && (!isAddManual || teamId != null);
  const dialogRef = useModalFocus(onClose);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selected) return;
    onSubmit({
      overall,
      round,
      slot,
      teamId,
      playerId: selected.playerId,
      providerPlayerName: selected.name,
      source: isAddManual ? 'manual-entry' : 'manual-correction',
      correctedAt: Date.now(),
    });
    onClose();
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section
        ref={dialogRef}
        className="pick-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'add-manual' ? 'Log pick' : 'Correct pick'}
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="eyebrow">{isAddManual ? 'Manual draft' : 'Draft correction'}</p>
            <h2>{isAddManual ? `Log pick #${overall}` : `Correct pick #${overall}`}</h2>
          </div>
          <button className="quiet-button" type="button" onClick={onClose}>Close</button>
        </header>
        {currentProviderName && <p>Currently recorded as <strong>{currentProviderName}</strong>.</p>}
        {round != null && slot != null && (
          <p className="pick-target">
            Round {round}, pick {slot} — <strong>{teamName ?? teamId ?? 'unknown team'}</strong> is on the clock.
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <div className="player-board-heading">
            <div>
              <h3>Available players</h3>
              <p>Ranked by format-specific ADP. Drafted players are hidden.</p>
            </div>
            {selected && <p className="selected-player">Selected: #{selected.rank} {selected.name}</p>}
          </div>
          <div className="player-board" aria-label="Available players ranked by ADP">
            {availablePlayers.length === 0 ? (
              <p>Loading the ranked player board…</p>
            ) : (
              availablePlayers.map((player) => (
                <button
                  className="player-row"
                  data-selected={selected?.playerId === player.playerId || undefined}
                  key={player.playerId}
                  type="button"
                  onClick={() => setSelected(player)}
                >
                  <span className="player-rank">#{player.rank}</span>
                  <span className="player-name">{player.name}</span>
                  <span className="player-meta">{player.position ?? '—'} · {player.team ?? 'FA'}</span>
                  <span className="player-adp">ADP {player.adp.toFixed(1)}</span>
                </button>
              ))
            )}
          </div>
          <footer className="dialog-actions">
            <button type="submit" disabled={!canSubmit}>Save pick</button>
            {!isAddManual && (
              <button className="quiet-button" type="button" onClick={() => { onUndo(overall); onClose(); }}>
                Undo correction
              </button>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
}
