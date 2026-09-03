import type { PlayerMeta, PlayerUsage } from '../../../shared/types';
import type { Recommendation } from '../engine/recommend';
import { buildPlayerContextSignals } from '../data/playerContext';
import type { TeamDepthRole } from '../data/teamDepthRole';

export type PlayerContextFeedStatus = 'loading' | 'ready' | 'unavailable';

/** Which upstream actually produced the active `adp-<format>.json`, read off
 * `DataManifest.sources['adp_active_' + format]`. Sleeper's draft-lobby ADP is canonical; the
 * FFC-derived board only appears when Sleeper's endpoint was unavailable or too sparse; the ESPN
 * variant appears only on ESPN PPR sessions whose `adp-espn-ppr.json` board actually loaded;
 * the Yahoo variant appears only on Yahoo sessions whose `adp-yahoo-<fmt>.json` board shipped. */
export type AdpDisclosure =
  | { source: 'sleeper'; format: string }
  | { source: 'ffc-fallback'; mockDrafts: number | null; teams: number; format: string }
  | { source: 'espn'; format: string }
  | { source: 'yahoo'; format: string };

export interface PlayerContextBodyProps {
  player: PlayerMeta;
  usage: PlayerUsage | undefined;
  feedStatus: PlayerContextFeedStatus;
  recommendation?: Recommendation;
  adpDisclosure?: AdpDisclosure | null;
  /** Team-depth role interpretation of the prior-season usage + depth chart (Part B). */
  depthRole?: TeamDepthRole | null;
}

function percent(value: number | null): string {
  return value == null ? 'n/a' : `${Math.round(value * 100)}%`;
}

function number(value: number | null): string {
  return value == null ? 'n/a' : value.toFixed(1);
}

/**
 * Presentational player-context diagnostics: engine explanation, availability disclosure,
 * durability, injury history, and the team-depth role interpretation. No dialog chrome,
 * focus management, or role/opportunity panel — those live in PlayerRolePanel and
 * TeamDepthRoleRow.
 */
export function PlayerContextBody({
  player,
  usage,
  feedStatus,
  recommendation,
  adpDisclosure,
  depthRole,
}: PlayerContextBodyProps) {
  return (
    <>
      {recommendation && (
        <div className="context-recommendation">
          <h3>Engine explanation{recommendation.recommendationMode === 'bench' ? ' — bench depth' : ''}</h3>
          <dl className="context-metrics">
            <div><dt>Projected points</dt><dd>{number(recommendation.projectedPoints)}</dd></div>
            <div><dt>Intrinsic roster utility</dt><dd>{number(recommendation.marginalRosterUtility)}</dd></div>
            <div><dt>Expected follow-up</dt><dd>{number(recommendation.expectedFollowUpValue)}</dd></div>
            <div><dt>Plan value</dt><dd>{number(recommendation.planValue)}</dd></div>
            <div><dt>VOR</dt><dd>{number(recommendation.vor)}</dd></div>
            <div><dt>Tier</dt><dd>{recommendation.tier}{recommendation.tierBoundaryGap > 0 ? ` (cliff ${number(recommendation.tierBoundaryGap)})` : ''}</dd></div>
            <div><dt>Confidence</dt><dd>{recommendation.confidence}</dd></div>
          </dl>
          {recommendation.recommendationMode === 'bench' && (
            <p className="muted">
              This player is bench-only today. Their depth component comes from a maximum one-to-one
              match between bench players and occupied starter slots, weighted by bye and availability
              risk. It is part of the same roster objective as starter production, not a separate mode.
            </p>
          )}
          {recommendation.missingScoringKeys.length > 0 && (
            <p className="muted">Missing applicable projection keys: {recommendation.missingScoringKeys.join(', ')}.</p>
          )}
          {recommendation.reasons.map((reason) => <p key={reason}>{reason}</p>)}
          {recommendation.warnings.map((warning) => <small key={warning}>⚠ {warning}</small>)}

          {(recommendation.lookaheadValue != null || recommendation.vona != null || recommendation.downside != null
            || recommendation.simulatedSurvivalProbability != null || recommendation.recommendationMode === 'bench') && (
            <details className="context-diagnostics">
              <summary>Model diagnostics</summary>
              <dl className="context-metrics">
                <div><dt>Marginal roster value (MRV)</dt><dd>{number(recommendation.marginalRosterValue)}</dd></div>
                <div><dt>Depth utility delta</dt><dd>{number(recommendation.marginalRosterUtility - recommendation.marginalRosterValue)}</dd></div>
                {recommendation.lookaheadValue != null && (
                  <div><dt>Rollout starter value (diagnostic)</dt><dd>{number(recommendation.lookaheadValue)}</dd></div>
                )}
                {recommendation.vona != null && (
                  <div><dt>VONA (wait cost, {recommendation.vonaSource})</dt><dd>{number(recommendation.vona)}</dd></div>
                )}
                {recommendation.downside != null && (
                  <div><dt>Downside (10th pct)</dt><dd>{number(recommendation.downside)}</dd></div>
                )}
                {recommendation.simulatedSurvivalProbability != null && (
                  <div><dt>Simulated survival</dt><dd>{percent(recommendation.simulatedSurvivalProbability)}</dd></div>
                )}
              </dl>
              <p className="muted">
                Plan value is the ranking objective: intrinsic starter-plus-depth utility now, plus
                the expected best follow-up at the next user pick. Analytic VONA compares this player
                with the expected surviving value from the same eligibility group. Seeded rollout
                fields remain diagnostics and a fallback only when ADP is missing.
              </p>
            </details>
          )}

          <h4>Availability model ({adpDisclosure?.source === 'ffc-fallback' ? 'FFC ADP — fallback' : adpDisclosure?.source === 'espn' ? 'ESPN default-PPR ADP' : adpDisclosure?.source === 'yahoo' ? 'Yahoo draft-analysis ADP' : 'Sleeper draft-lobby ADP'})</h4>
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
              ) : adpDisclosure.source === 'espn' ? (
                <>ESPN's own default-PPR average draft position, from the same public leaguedefaults feed the projections use — the default draft population on ESPN, not a mock-only
                {' '}sample. ESPN publishes no draft-position range or sample size (those fields are n/a above), and the standard deviation is a fitted estimate calibrated against Fantasy
                {' '}Football Calculator's dispersion shape — the same experimental treatment as Sleeper. The feed censors every undrafted player at a fixed late pick, so the board is
                {' '}truncated at the detected censoring point and the remaining players are carried over from the Sleeper board (clamped to the cutoff) — deep-ADP rows are Sleeper
                {' '}provenance, not ESPN.</>
              ) : adpDisclosure.source === 'yahoo' ? (
                <>Yahoo's own draft-analysis average pick for {adpDisclosure.format} scoring, from the public unauthenticated `pub-api-ro.fantasysports.yahoo.com` feed. The same fitted-stdev +
                {' '}null-population caveat as Sleeper/ESPN applies (Yahoo publishes no range or sample size, and the standard deviation is a fitted estimate calibrated against Fantasy Football
                {' '}Calculator's dispersion shape). The feed averages only over drafts where the player was actually picked, so the honest head is truncated at the detected censoring point and
                {' '}the remaining players are carried over from the Sleeper board (clamped to the cutoff) — deep-ADP rows are Sleeper provenance, not Yahoo.</>
              ) : (
                <>Sleeper's draft-lobby ADP was unavailable or too sparse for this format, so this board falls back to {adpDisclosure.mockDrafts != null ? `${adpDisclosure.mockDrafts.toLocaleString()} recorded` : 'an unknown number of'} Fantasy
                {' '}Football Calculator mock drafts, configured for {adpDisclosure.teams}-team {adpDisclosure.format} scoring.</>
              )}
              {' '}The availability percentage is a conditional model estimate assuming a normal draft-position
              distribution around ADP, given survival to the current pick — it is not a market-observed probability. It affects follow-up timing in plan value, never intrinsic player quality.
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
              {usage.teamChanged && <p>Team changed since the latest {usage.season} appearance ({usage.recentTeam}).</p>}
              {depthRole?.label != null && <p className="muted">{depthRole.provenance}</p>}

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
    </>
  );
}
