import { useMemo, useState, type FormEvent } from 'react';
import type { DraftInit, PlayerMeta } from '../../../shared/types';
import { roundForOverall, slotForOverall } from '../adapters/draftOrder';
import { loadAllIdpPlayers } from '../data/idpProjections';
import { parseYahooDraftText, type ParsedYahooPick } from '../data/yahooDraftLogParser';
import { useModalFocus } from '../hooks/useModalFocus';
import type { PickOverride } from '../state/draftBoardState';

export interface YahooPastePicksModalProps {
  draftInit: DraftInit;
  players: readonly PlayerMeta[];
  onSubmit: (
    overrides: PickOverride[],
    detectedSlot: number | null,
    slotToTeamName: Record<number, string>,
    detectedTeams?: number | null,
  ) => void;
  onClose: () => void;
}

export function YahooPastePicksModal({
  draftInit,
  players,
  onSubmit,
  onClose,
}: YahooPastePicksModalProps) {
  const [rawText, setRawText] = useState('');
  const dialogRef = useModalFocus(onClose);

  const allIdpPlayers = useMemo(() => loadAllIdpPlayers(), []);

  const parseResult = useMemo(() => {
    if (!rawText.trim()) {
      return { picks: [] as ParsedYahooPick[], slotToTeamName: {}, detectedUserSlot: null, detectedTeams: null };
    }
    return parseYahooDraftText(rawText, players, allIdpPlayers, draftInit.teams);
  }, [rawText, players, allIdpPlayers, draftInit.teams]);

  const canSubmit = parseResult.picks.length > 0;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const effectiveTeams = parseResult.detectedTeams ?? draftInit.teams;
    const overrides: PickOverride[] = parseResult.picks.map((pick) => {
      const round = roundForOverall(effectiveTeams, pick.overall);
      const slot = slotForOverall(draftInit.draftType, effectiveTeams, pick.overall);
      const teamId = draftInit.slotToTeam[slot] ?? String(slot);
      const providerPlayerName = pick.matchedPlayer?.name
        ?? (pick.matchedIdp ? pick.matchedIdp.name : pick.playerName);

      return {
        overall: pick.overall,
        round,
        slot,
        teamId,
        playerId: pick.playerId,
        providerPlayerName,
        source: 'manual-entry',
        correctedAt: Date.now(),
      };
    });

    onSubmit(
      overrides,
      parseResult.detectedUserSlot,
      parseResult.slotToTeamName,
      parseResult.detectedTeams,
    );
    onClose();
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="pick-dialog yahoo-paste-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Paste Yahoo draft picks"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="eyebrow">Yahoo Live Draft Sync</p>
            <h2>Paste draft picks</h2>
          </div>
          <button className="quiet-button" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="yahoo-paste-steps">
          <div className="yahoo-paste-step">
            <span className="yahoo-paste-step-badge">1</span>
            <span>Copy either the chat / picks feed OR the Draft Board in your Yahoo draft room</span>
          </div>
          <div className="yahoo-paste-step">
            <span className="yahoo-paste-step-badge">2</span>
            <span>Paste below &mdash; offense, defense, &amp; managers sync automatically</span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="yahoo-paste-textarea-wrap">
            <label htmlFor="yahoo-raw-draft-input" className="visually-hidden">
              Yahoo draft text
            </label>
            <textarea
              id="yahoo-raw-draft-input"
              className="yahoo-paste-textarea"
              rows={8}
              placeholder={'Paste Yahoo chat / picks feed (e.g. "J. Gibbs RB Det Bye 6")\nOR Yahoo Draft Board (e.g. "Jahmyr Gibbs RB Det 1.1") here...'}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              autoFocus
            />
          </div>

          {rawText.trim() && (
            <div className="yahoo-paste-summary" aria-live="polite">
              <div className="yahoo-paste-summary-stats">
                <strong>{parseResult.picks.length} picks recognized</strong>
                {parseResult.detectedUserSlot != null && (
                  <span className="yahoo-detected-user-badge">
                    Seat detected: Slot {parseResult.detectedUserSlot} (You)
                  </span>
                )}
                {parseResult.detectedTeams != null && (
                  <span className="yahoo-detected-teams-badge">
                    {parseResult.detectedTeams} teams detected
                  </span>
                )}
                {Object.keys(parseResult.slotToTeamName).length > 0 && (
                  <span className="yahoo-detected-teams-badge">
                    {Object.keys(parseResult.slotToTeamName).length} team names mapped
                  </span>
                )}
              </div>

              {parseResult.picks.length > 0 && (
                <div className="yahoo-paste-preview-table-container">
                  <table className="yahoo-paste-preview-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Manager</th>
                        <th>Player</th>
                        <th>Pos</th>
                        <th>Team</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parseResult.picks.map((p) => {
                        const statusLabel = p.matchedPlayer
                          ? 'Matched'
                          : p.matchedIdp
                            ? 'IDP'
                            : 'Unmatched';
                        return (
                          <tr key={p.overall} data-matched={Boolean(p.matchedPlayer || p.matchedIdp)}>
                            <td>#{p.overall}</td>
                            <td>{p.managerName || (p.isUserPick ? 'You' : '—')}</td>
                            <td>
                              <strong>
                                {p.matchedPlayer?.name ?? p.matchedIdp?.name ?? p.playerName}
                              </strong>
                              {p.injury && (
                                <>
                                  {' '}
                                  <span className="yahoo-paste-injury-tag">{p.injury}</span>
                                </>
                              )}
                            </td>
                            <td>{p.position}</td>
                            <td>{p.nflTeam}</td>
                            <td>
                              <span className={`yahoo-status-badge status-${statusLabel.toLowerCase()}`}>
                                {statusLabel}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <footer className="dialog-actions">
            <button type="submit" disabled={!canSubmit} className="primary-button">
              Apply {parseResult.picks.length > 0 ? `${parseResult.picks.length} picks` : 'picks'}
            </button>
            <button className="quiet-button" type="button" onClick={onClose}>
              Cancel
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
