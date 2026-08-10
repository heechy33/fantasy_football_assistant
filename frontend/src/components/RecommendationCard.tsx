import type { PlayerMeta } from '../../../shared/types';
import type { Recommendation } from '../engine/recommend';
import { PlayerPortrait } from './PlayerPortrait';

export interface RecommendationCardProps {
  recommendation: Recommendation;
  player: PlayerMeta | undefined;
  contextSignals: string[];
  onViewDetails: () => void;
}

/**
 * FIFA-ultimate-team-style card face. All ordering/inclusion is decided upstream by
 * `buildRecommendationBoard` — this component only renders one already-ranked entry and never
 * re-derives rank, value, or eligibility from its props.
 */
export function RecommendationCard({ recommendation, player, contextSignals, onViewDetails }: RecommendationCardProps) {
  const name = player?.name ?? recommendation.playerId;
  const position = player?.position ? (player.position === 'DEF' ? 'D/ST' : player.position) : '—';

  return (
    <article className="recommendation-card" data-confidence={recommendation.confidence}>
      <header className="recommendation-card-head">
        <span className="recommendation-card-rank">#{recommendation.rank}</span>
        {player && <PlayerPortrait player={player} />}
        <div className="recommendation-card-identity">
          <strong>{name}</strong>
          <span>{position} · {player?.team ?? 'FA'}{player?.byeWeek != null ? ` · Bye ${player.byeWeek}` : ''}</span>
        </div>
      </header>

      <div className="recommendation-card-badges">
        <span className={`badge badge-confidence-${recommendation.confidence}`}>{recommendation.confidence} confidence</span>
        {recommendation.deprioritized && <span className="badge badge-warning">Too early</span>}
        {recommendation.nearTieWithLeader && <span className="badge badge-info">Near tie</span>}
        {recommendation.warnings.length > 0 && <span className="badge badge-warning">{recommendation.warnings.length} warning{recommendation.warnings.length === 1 ? '' : 's'}</span>}
        {contextSignals.map((signal) => <span className="badge badge-context" key={signal}>{signal}</span>)}
      </div>

      <dl className="recommendation-card-stats">
        <div><dt>Projected</dt><dd>{recommendation.projectedPoints.toFixed(1)}</dd></div>
        <div><dt>Value</dt><dd>{recommendation.replacementAdjustedValue.toFixed(1)}</dd></div>
        <div><dt>ADP</dt><dd>{recommendation.availabilityAdp?.toFixed(1) ?? 'n/a'}</dd></div>
        <div><dt>Next pick</dt><dd>{recommendation.availableNextPickProbability == null ? 'n/a' : `${Math.round(recommendation.availableNextPickProbability * 100)}%`}</dd></div>
        <div><dt>Tier</dt><dd>{recommendation.tier}</dd></div>
        <div><dt>Slot</dt><dd>{recommendation.assignedRosterSlot ?? 'Bench'}</dd></div>
      </dl>

      <p className="recommendation-card-reason">{recommendation.reasons[0]}</p>

      <button className="quiet-button recommendation-card-details" type="button" onClick={onViewDetails}>
        View details
      </button>
    </article>
  );
}
