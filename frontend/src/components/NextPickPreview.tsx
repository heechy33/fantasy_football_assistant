import type { NextPickPreviewRow } from '../data/nextPickPreview';
import { PositionBadge } from './PositionBadge';

export interface NextPickPreviewProps {
  nextPick: number;
  rows: readonly NextPickPreviewRow[];
}

export function NextPickPreview({ nextPick, rows }: NextPickPreviewProps) {
  if (rows.length === 0) return null;
  return (
    <section className="next-pick-preview" aria-label={`Likely available around pick ${nextPick}`}>
      <div className="next-pick-preview-heading">
        <div>
          <p className="eyebrow">Market preview</p>
          <h3>Likely around your next pick</h3>
        </div>
        <span>Pick {nextPick}</span>
      </div>
      <p className="next-pick-preview-note">ADP neighborhood, not recommendation order.</p>
      <ol className="next-pick-preview-list">
        {rows.map((row) => (
          <li key={row.playerId}>
            {row.position && <PositionBadge position={row.position} />}
            <strong>{row.name}</strong>
            <span>ADP {row.adp.toFixed(1)}</span>
            <span>{Math.round(row.survivalProbability * 100)}% available</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
