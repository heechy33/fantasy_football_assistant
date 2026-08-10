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
  currentProviderName?: string;
  rankedPlayers: RankedPlayer[];
  unavailablePlayerIds: ReadonlySet<PlayerId>;
  onSubmit: (override: PickOverride) => void;
  onUndo: (overall: number) => void;
  onClose: () => void;
}

/**
 * Same component serves both a live-pick correction and universal manual entry.
 * Instead of an opaque name search, it exposes the available ADP board in rank
 * order so the next player is always one click away.
 */
export function ManualPickCorrection({
  mode,
  overall,
  round,
  slot,
  teamId,
  currentProviderName,
  rankedPlayers,
  unavailablePlayerIds,
  onSubmit,
  onUndo,
  onClose,
}: ManualPickCorrectionProps) {
  const isAddManual = mode === 'add-manual';
  const [selected, setSelected] = useState<RankedPlayer | null>(null);
  const [teamIdInput, setTeamIdInput] = useState(teamId ?? '');
  const [roundInput, setRoundInput] = useState(String(round ?? 1));

  const availablePlayers = useMemo(
    () => rankedPlayers.filter((player) => !unavailablePlayerIds.has(player.playerId)),
    [rankedPlayers, unavailablePlayerIds],
  );
  const trimmedTeamId = teamIdInput.trim();
  const parsedRound = Number(roundInput);
  const canSubmit = selected != null && (!isAddManual || (trimmedTeamId !== '' && Number.isFinite(parsedRound)));
  const dialogRef = useModalFocus(onClose);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selected) return;
    onSubmit({
      overall,
      round: isAddManual ? parsedRound : round,
      slot: isAddManual ? parsedRound : slot,
      teamId: isAddManual ? trimmedTeamId : teamId,
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
        <form onSubmit={handleSubmit}>
          {isAddManual && (
            <div className="pick-details">
              <label>
                Team
                <input value={teamIdInput} onChange={(e) => setTeamIdInput(e.target.value)} placeholder="Team or owner" required />
              </label>
              <label>
                Round
                <input type="number" min={1} value={roundInput} onChange={(e) => setRoundInput(e.target.value)} required />
              </label>
            </div>
          )}
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
