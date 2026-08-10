import type { PlayerMeta, PlayerUsage } from '../../../shared/types';
import type { Recommendation } from '../engine/recommend';
import {
  buildOpportunityRoleProfile,
  buildPlayerContextSignals,
  formatOpportunityDelta,
} from '../data/playerContext';
import { useModalFocus } from '../hooks/useModalFocus';

export type PlayerContextFeedStatus = 'loading' | 'ready' | 'unavailable';

/** Which upstream actually produced the active `adp-<format>.json`, read off
 * `DataManifest.sources['adp_active_' + format]`, passed through so the modal's disclosure doesn't
 * need the whole manifest shape. Sleeper's draft-lobby ADP is canonical; the FFC-derived board (with
 * its own mock-draft population metadata) only appears when Sleeper's endpoint was unavailable or
 * too sparse that day — see pipeline/build_data.py's per-format fallback. */
export type AdpDisclosure =
  | { source: 'sleeper'; format: string }
  | { source: 'ffc-fallback'; mockDrafts: number | null; teams: number; format: string };

interface Props {
  player: PlayerMeta;
  usage: PlayerUsage | undefined;
  feedStatus: PlayerContextFeedStatus;
  /** When present, the modal opens on the engine-explanation tab for this card's recommendation
   * instead of jumping straight to prior-season context. Omitted when a player is opened from
   * somewhere that has no board entry for them (e.g. a drafted-but-not-recommended roster player). */
  recommendation?: Recommendation;
  adpDisclosure?: AdpDisclosure | null;
  onClose: () => void;
}

function percent(value: number | null): string {
  return value == null ? 'n/a' : `${Math.round(value * 100)}%`;
}

function number(value: number | null): string {
  return value == null ? 'n/a' : value.toFixed(1);
}

export function PlayerContextModal({ player, usage, feedStatus, recommendation, adpDisclosure, onClose }: Props) {
  const dialogRef = useModalFocus(onClose);
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section
        ref={dialogRef}
        className="pick-dialog player-context-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${player.name} context`}
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="eyebrow">Player context</p>
            <h2>{player.name}</h2>
            <p className="muted">
              {player.position ?? 'Unknown position'} · {player.team ?? 'Free agent'}
              {player.depthChartPosition ? ` · ${player.depthChartPosition}` : ''}
              {player.depthChartOrder != null ? ` #${player.depthChartOrder}` : ''}
            </p>
          </div>
          <button className="quiet-button" type="button" onClick={onClose}>Close</button>
        </header>

        {recommendation && (
          <div className="context-recommendation">
            <h3>Engine explanation</h3>
            <dl className="context-metrics">
              <div><dt>Projected points</dt><dd>{number(recommendation.projectedPoints)}</dd></div>
              <div><dt>Value over replacement (RAV)</dt><dd>{number(recommendation.replacementAdjustedValue)}</dd></div>
              <div><dt>VOR</dt><dd>{number(recommendation.vor)}</dd></div>
              <div><dt>Tier</dt><dd>{recommendation.tier}{recommendation.tierBoundaryGap > 0 ? ` (cliff ${number(recommendation.tierBoundaryGap)})` : ''}</dd></div>
              <div><dt>Confidence</dt><dd>{recommendation.confidence}</dd></div>
            </dl>
            {recommendation.missingScoringKeys.length > 0 && (
              <p className="muted">Missing applicable projection keys: {recommendation.missingScoringKeys.join(', ')}.</p>
            )}
            {recommendation.reasons.map((reason) => <p key={reason}>{reason}</p>)}
            {recommendation.warnings.map((warning) => <small key={warning}>⚠ {warning}</small>)}

            <h4>Availability model ({adpDisclosure?.source === 'ffc-fallback' ? 'FFC ADP — fallback' : 'Sleeper draft-lobby ADP'})</h4>
            <dl className="context-metrics">
              <div><dt>ADP</dt><dd>{number(recommendation.availabilityAdp)}</dd></div>
              <div><dt>Range</dt><dd>{recommendation.availabilityAdpLow != null && recommendation.availabilityAdpHigh != null ? `${recommendation.availabilityAdpHigh}–${recommendation.availabilityAdpLow}` : 'n/a'}</dd></div>
              <div><dt>Std. deviation</dt><dd>{number(recommendation.availabilityStdev)}</dd></div>
              <div><dt>Sample size</dt><dd>{recommendation.availabilitySampleSize != null ? `${recommendation.availabilitySampleSize} drafts` : 'n/a'}</dd></div>
              <div><dt>Next-pick availability</dt><dd>{percent(recommendation.availableNextPickProbability)}</dd></div>
            </dl>
            {adpDisclosure && (
              <p className="muted">
                {adpDisclosure.source === 'sleeper' ? (
                  <>Sourced from Sleeper's own draft-lobby ADP for {adpDisclosure.format} scoring — the real draft population this app tracks against, not a mock-only sample. Sleeper
                  {' '}does not publish draft-position range or sample size (those fields are n/a above), and the standard deviation is a fitted estimate calibrated against Fantasy
                  {' '}Football Calculator's dispersion shape rather than measured on Sleeper drafts — treat the availability percentage as experimental until calibrated.</>
                ) : (
                  <>Sleeper's draft-lobby ADP was unavailable or too sparse for this format, so this board falls back to {adpDisclosure.mockDrafts != null ? `${adpDisclosure.mockDrafts.toLocaleString()} recorded` : 'an unknown number of'} Fantasy
                  {' '}Football Calculator mock drafts, configured for {adpDisclosure.teams}-team {adpDisclosure.format} scoring.</>
                )}
                {' '}The availability percentage is a conditional model estimate assuming a normal draft-position
                distribution around ADP, given survival to the current pick — it is not a market-observed probability and does not affect this board's ordering.
              </p>
            )}
          </div>
        )}

        {(player.injuryStatus || player.injuryBodyPart || player.practiceParticipation) && (
          <div className="context-current">
            <h3>Current Sleeper status</h3>
            {player.injuryStatus && <p>Status: {player.injuryStatus}</p>}
            {player.injuryBodyPart && <p>Body part: {player.injuryBodyPart}</p>}
            {player.practiceParticipation && <p>Practice: {player.practiceParticipation}</p>}
          </div>
        )}

        {feedStatus === 'loading' && <p>Loading prior-season context…</p>}
        {feedStatus === 'unavailable' && (
          <p>Prior-season context is temporarily unavailable. Core projections and ADP are unaffected.</p>
        )}
        {feedStatus === 'ready' && (
          <>
            <div className="context-signals">
              {buildPlayerContextSignals(player, usage).map((signal) => <span key={signal}>{signal}</span>)}
            </div>

            {!usage ? <p>No verifiable prior-season roster history is available.</p> : (
              <>
                {usage.durabilityScore ? (
                  <div className="durability-score-card">
                    <div className="durability-score-heading">
                      <div><h3>Durability score</h3><p>Observed-history display index, not an injury probability.</p></div>
                      <strong>{usage.durabilityScore.score}<small>/100</small></strong>
                    </div>
                    <p className="durability-band">{usage.durabilityScore.band}</p>
                    <details>
                      <summary>Score components</summary>
                      <dl className="context-components">
                        {Object.entries(usage.durabilityScore.components).map(([label, value]) => (
                          <div key={label}><dt>{label}</dt><dd>{value >= 0 ? '+' : ''}{value.toFixed(1)}</dd></div>
                        ))}
                      </dl>
                    </details>
                  </div>
                ) : <p className="muted">Durability score unavailable — limited history.</p>}
                <h3>{usage.season} usage</h3>
                {usage.usageSeasonObserved === false ? (
                  <p>No verifiable {usage.season} roster or snap history for this player.</p>
                ) : usage.knownAbsent ? (
                  <p>Rostered for at least one team game, with no recorded snaps.</p>
                ) : (
                  <dl className="context-metrics">
                    <div><dt>Offensive snap share</dt><dd>{percent(usage.snapPct)}</dd></div>
                    <div><dt>Target share</dt><dd>{percent(usage.targetShare)}</dd></div>
                    <div><dt>Carry share</dt><dd>{percent(usage.carryShare)}</dd></div>
                    <div><dt>Games with any snap</dt><dd>{usage.gamesWithAnySnap}</dd></div>
                  </dl>
                )}
                {usage.teamChanged && <p>Team changed since the latest {usage.season} appearance ({usage.recentTeam}).</p>}

                {usage.opportunity && (
                  <>
                    <h3>{usage.season} opportunity</h3>
                    <div className="opportunity-profile">
                      <h4>Opportunity profile</h4>
                      {buildOpportunityRoleProfile(player, usage.opportunity.season).map((item) => (
                        <div className="opportunity-role" key={item.label}>
                          <div><span>{item.label}</span><strong>{item.rating}</strong></div>
                          <div className="role-bar"><span style={{ width: item.fill == null ? '0%' : Math.round(item.fill * 100) + '%' }} /></div>
                          <small>{item.basis}</small>
                        </div>
                      ))}
                    </div>
                    <dl className="context-metrics">
                      {player.position === 'RB' && <div><dt>Carry share</dt><dd>{percent(usage.opportunity.season.carryShare)}</dd></div>}
                      {player.position !== 'QB' && <div><dt>Target share</dt><dd>{percent(usage.opportunity.season.targetShare)}</dd></div>}
                      <div><dt>Air-yard share</dt><dd>{percent(usage.opportunity.season.airYardsShare)}</dd></div>
                      <div><dt>Targets/game</dt><dd>{number(usage.opportunity.season.targetsPerGame)}</dd></div>
                      <div><dt>{player.position === 'RB' ? 'Touches/game' : 'YAC'}</dt><dd>{player.position === 'RB' ? number(usage.opportunity.season.touchesPerGame) : number(usage.opportunity.season.receivingYardsAfterCatch)}</dd></div>
                      <div><dt>Red-zone targets</dt><dd>{usage.opportunity.season.redZoneTargets == null ? 'n/a' : usage.opportunity.season.redZoneTargets}</dd></div>
                      <div><dt>End-zone targets</dt><dd>{usage.opportunity.season.endZoneTargets == null ? 'n/a' : usage.opportunity.season.endZoneTargets}</dd></div>
                      {player.position === 'RB' && <div><dt>Goal-line carries</dt><dd>{usage.opportunity.season.goalLineCarries == null ? 'n/a' : usage.opportunity.season.goalLineCarries}</dd></div>}
                    </dl>
                    {usage.opportunity.finalFive && (
                      <div className="opportunity-evolution">
                        <h4>Final five observed games</h4>
                        <p>Targets/game {number(usage.opportunity.finalFive.targetsPerGame)} · touches/game {number(usage.opportunity.finalFive.touchesPerGame)}</p>
                        <p>
                          Role change: targets/game {formatOpportunityDelta(usage.opportunity.roleEvolution.targetsPerGameDelta)}
                          {player.position !== 'QB' && <> · target share {formatOpportunityDelta(usage.opportunity.roleEvolution.targetShareDelta, 'share')}</>}
                          {' · '}air-yard share {formatOpportunityDelta(usage.opportunity.roleEvolution.airYardsShareDelta, 'share')}
                        </p>
                      </div>
                    )}
                  </>
                )}

                <h3>Availability history</h3>
                {usage.seasons.length === 0 ? <p>No eligible seasons observed.</p> : (
                  <div className="context-table-wrap">
                    <table className="context-table">
                      <thead><tr><th>Season</th><th>Available</th><th>Team games</th><th>Report weeks</th><th>Out</th></tr></thead>
                      <tbody>{usage.seasons.map((season) => (
                        <tr key={season.season}>
                          <td>{season.season}</td>
                          <td>{percent(season.availabilityRate)}</td>
                          <td>{season.gamesWithAnySnap}/{season.teamGamesWhileRostered}</td>
                          <td>{season.injuryReportWeeks}</td>
                          <td>{season.outWeeks}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}

                {usage.injuryHistory.length > 0 && (
                  <>
                    <h3>Reported injury history</h3>
                    <ul className="context-injuries">
                      {usage.injuryHistory.map((history) => (
                        <li key={history.normalizedBodyPart}>
                          <strong>{history.normalizedBodyPart}</strong> · {history.episodes} episode{history.episodes === 1 ? '' : 's'}
                          <span>{history.reports.map((report) => `${report.season} W${report.week}: ${report.labels.join(' / ')}`).join(' · ')}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
            <p className="muted">Availability and injury-report history are descriptive context, not a future injury probability.</p>
          </>
        )}
      </section>
    </div>
  );
}
