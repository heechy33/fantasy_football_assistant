import { useEffect, useMemo, useState } from 'react';
import type { AdpEntry, DataManifest, DraftInit, Pick, PlayerMeta, SeasonProjection } from '../../../shared/types';
import type { AdpFormat } from '../data/loadPlayerPool';
import { buildRecommendationBoard } from '../engine/recommend';

import { computeOnTheClock, nextPickForTeam } from '../adapters/draftOrder';
interface Props { draftInit: DraftInit | null; picks: Pick[]; manifest: DataManifest | null; adpFormat: AdpFormat; }

export function RecommendationPanel({ draftInit, picks, manifest, adpFormat }: Props) {
  const [players, setPlayers] = useState<PlayerMeta[]>([]);
  const [projections, setProjections] = useState<SeasonProjection[]>([]);
  const [adp, setAdp] = useState<AdpEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/data/players.json').then((response) => response.json() as Promise<PlayerMeta[]>),
      fetch('/data/projections-season.json').then((response) => response.json() as Promise<SeasonProjection[]>),
      fetch(`/data/adp-${adpFormat}.json`).then((response) => response.json() as Promise<AdpEntry[]>),
    ]).then(([nextPlayers, nextProjections, nextAdp]) => {
      if (!active) return;
      setPlayers(nextPlayers); setProjections(nextProjections); setAdp(nextAdp); setLoadError(null);
    }).catch(() => { if (active) setLoadError('Projection board is unavailable; use the ADP board/manual tracker.'); });
    return () => { active = false; };
  }, [adpFormat]);

  // players.json is ~4400 entries; a Map avoids an O(n) .find() per rendered row.
  const playersById = useMemo(() => new Map(players.map((p) => [p.playerId, p])), [players]);

  // The live poll hands back a new `picks` array identity every ~2.5s even when nothing changed
  // (see useDraftPoll/draftBoardState), which would otherwise force a full engine rebuild on every
  // tick. This cheap signature lets the expensive memo below skip recompute when the content didn't
  // actually move, while still reading the current `picks` value once it does.
  const picksSignature = useMemo(() => picks.map((pick) => `${pick.overall}:${pick.playerId ?? '~'}`).join('|'), [picks]);

  const board = useMemo(() => {
    if (!draftInit || !players.length || !projections.length) return null;
    const onTheClock = computeOnTheClock(
      draftInit.draftType, draftInit.teams, draftInit.rounds, picks.length, draftInit.slotToTeam,
    );
    const nextPick = nextPickForTeam(
      draftInit.draftType, draftInit.teams, draftInit.rounds, picks.length, draftInit.slotToTeam, draftInit.myTeamId,
      onTheClock?.teamId === draftInit.myTeamId,
    );
    if (nextPick == null) return null;
    const currentPick = onTheClock?.overall ?? picks.length + 1;
    return buildRecommendationBoard({ settings: draftInit.settings, players, projections, adp, picks, myTeamId: draftInit.myTeamId, nextPick, currentPick, limit: 5 });
    // picksSignature stands in for `picks` here — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adp, draftInit, picksSignature, players, projections]);

  const recommendations = board?.recommendations ?? [];
  const diagnostics = board?.diagnostics ?? null;

  const source = manifest?.sources.fftoday_projections;
  if (!draftInit) return null;
  if (!source || source.status !== 'ok' || loadError || Object.keys(draftInit.settings.scoring).length === 0) {
    return <section className="recommendation-panel"><h2>Recommendations</h2><p>{loadError ?? (Object.keys(draftInit.settings.scoring).length === 0 ? 'This mock has custom or unknown scoring, which Sleeper does not expose through its draft payload. Live tracking remains active, but recommendations are unavailable.' : 'FFToday projections are unavailable or stale. Live draft tracking remains active; recommendations fall back to ADP/manual review.')}</p></section>;
  }

  return (
    <section className="recommendation-panel">
      <div className="section-heading"><div><p className="eyebrow">S2 deterministic board</p><h2>Top deterministic values</h2></div><span>FFToday · updated {source.upstreamUpdatedAt ?? source.fetchedAt}</span></div>
      <p className="warning-banner">Availability is context only and does not affect S2 ordering. S3 will incorporate the cost of waiting.</p>
      {diagnostics != null && diagnostics.unmatchedPickCount > 0 && (
        <p className="warning-banner" role="alert">
          {diagnostics.unmatchedPickCount} drafted pick{diagnostics.unmatchedPickCount === 1 ? '' : 's'} (overall {diagnostics.unmatchedPickOveralls.join(', ')}) couldn't be matched to a player —
          someone recommended below may already be gone. Use "Correct" on the draft board above to fix it.
        </p>
      )}
      {recommendations.length === 0 ? <p>Waiting for a validated projection snapshot.</p> : (
        <ol className="recommendations">
          {recommendations.map((recommendation) => {
            const player = playersById.get(recommendation.playerId);
            return <li key={recommendation.playerId}>
              <div><strong>#{recommendation.rank} {player?.name ?? recommendation.playerId}</strong><span>{player?.position} · {recommendation.projectedPoints.toFixed(1)} projected points · {recommendation.assignedRosterSlot ?? 'bench'}</span></div>
              <p>{recommendation.reasons.join(' ')}</p>
              {recommendation.warnings.map((warning) => <small key={warning}>⚠ {warning}</small>)}
              {recommendation.missingScoringKeys.length > 0 && (
                <details>
                  <summary>Scoring coverage details</summary>
                  <small>Missing applicable projection keys: {recommendation.missingScoringKeys.join(', ')}.</small>
                </details>
              )}
              {recommendation.availabilityAdp != null && (
                <details>
                  <summary>Availability model details</summary>
                  <small>
                    ADP {recommendation.availabilityAdp.toFixed(1)} · standard deviation {recommendation.availabilityStdev?.toFixed(1) ?? 'n/a'} picks · sample size {recommendation.availabilitySampleSize ?? 'n/a'} drafts.
                    The percentage is a conditional model estimate, not an ordering input.
                  </small>
                </details>
              )}
              <span>
                Value {recommendation.replacementAdjustedValue.toFixed(1)} · VOR {recommendation.vor.toFixed(1)} · tier {recommendation.tier}
                {recommendation.tierGapAfter > 0 ? ` (gap to next player ${recommendation.tierGapAfter.toFixed(1)})` : ''}
                {recommendation.tierBoundaryGap > 0 ? ` · tier cliff ${recommendation.tierBoundaryGap.toFixed(1)}` : ''} ·
                next-pick availability model estimate {recommendation.availableNextPickProbability == null ? 'n/a' : `${Math.round(recommendation.availableNextPickProbability * 100)}%`} ·
                confidence {recommendation.confidence}
              </span>
            </li>;
          })}
        </ol>
      )}
      <p className="muted">Custom scoring is recomputed from normalized components. Replacement levels are modeled estimates, not observed league truth. S2 values starter impact only, so bench depth is not yet priced. K/DEF are not high-confidence custom-scoring values.</p>
    </section>
  );
}
