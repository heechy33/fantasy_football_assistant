import { useState } from 'react';
import type { InjuryBodyPartHistory } from '../../../shared/types';
import {
  buildBodyMapModel,
  type BodyMapRegionModel,
  type BodyRegion,
  type BodySide,
} from '../data/injuryBodyMap';

export type BodyMapFeedStatus = 'loading' | 'ready' | 'unavailable';

export interface PlayerBodyMapProps {
  injuryHistory: InjuryBodyPartHistory[] | undefined;
  feedStatus: BodyMapFeedStatus;
  playerName: string;
}

const REGION_LABEL: Record<BodyRegion, string> = {
  head: 'Head', neck: 'Neck', shoulder: 'Shoulder', chest: 'Chest', abdomen: 'Abdomen', back: 'Back',
  'upper-arm': 'Upper arm', elbow: 'Elbow', forearm: 'Forearm', 'wrist-hand': 'Wrist/hand', hip: 'Hip',
  groin: 'Groin', thigh: 'Thigh', knee: 'Knee', 'lower-leg': 'Lower leg', ankle: 'Ankle', foot: 'Foot',
};

interface ShapeDef {
  shape: 'ellipse' | 'rect';
  cx?: number; cy?: number; rx?: number; ry?: number;
  x?: number; y?: number; width?: number; height?: number; rx2?: number;
}

interface RegionSlot {
  region: BodyRegion;
  side: BodySide;
  shape: ShapeDef;
}

// A simplified front-facing figure, viewBox 0 0 120 260. Not anatomically precise — it exists to
// give each region a distinct, hoverable/focusable shape, not to be a medical illustration. Paired
// regions get a left and a right shape mirrored around x=60; unpaired regions get one centered shape.
// "Back" has no front-view analog, so it renders as a thin spine-adjacent strip purely for
// interaction — its label makes that explicit.
const REGION_SLOTS: RegionSlot[] = [
  { region: 'head', side: 'unspecified', shape: { shape: 'ellipse', cx: 60, cy: 18, rx: 13, ry: 15 } },
  { region: 'neck', side: 'unspecified', shape: { shape: 'rect', x: 53, y: 32, width: 14, height: 10, rx2: 3 } },
  { region: 'chest', side: 'unspecified', shape: { shape: 'rect', x: 38, y: 44, width: 44, height: 28, rx2: 6 } },
  { region: 'back', side: 'unspecified', shape: { shape: 'rect', x: 57, y: 46, width: 6, height: 50, rx2: 2 } },
  { region: 'abdomen', side: 'unspecified', shape: { shape: 'rect', x: 42, y: 72, width: 36, height: 24, rx2: 6 } },

  { region: 'shoulder', side: 'left', shape: { shape: 'ellipse', cx: 32, cy: 48, rx: 9, ry: 8 } },
  { region: 'shoulder', side: 'right', shape: { shape: 'ellipse', cx: 88, cy: 48, rx: 9, ry: 8 } },
  { region: 'upper-arm', side: 'left', shape: { shape: 'rect', x: 24, y: 56, width: 10, height: 26, rx2: 5 } },
  { region: 'upper-arm', side: 'right', shape: { shape: 'rect', x: 86, y: 56, width: 10, height: 26, rx2: 5 } },
  { region: 'elbow', side: 'left', shape: { shape: 'ellipse', cx: 29, cy: 86, rx: 7, ry: 6 } },
  { region: 'elbow', side: 'right', shape: { shape: 'ellipse', cx: 91, cy: 86, rx: 7, ry: 6 } },
  { region: 'forearm', side: 'left', shape: { shape: 'rect', x: 22, y: 92, width: 10, height: 26, rx2: 5 } },
  { region: 'forearm', side: 'right', shape: { shape: 'rect', x: 88, y: 92, width: 10, height: 26, rx2: 5 } },
  { region: 'wrist-hand', side: 'left', shape: { shape: 'ellipse', cx: 27, cy: 122, rx: 7, ry: 8 } },
  { region: 'wrist-hand', side: 'right', shape: { shape: 'ellipse', cx: 93, cy: 122, rx: 7, ry: 8 } },

  { region: 'hip', side: 'left', shape: { shape: 'ellipse', cx: 48, cy: 100, rx: 10, ry: 8 } },
  { region: 'hip', side: 'right', shape: { shape: 'ellipse', cx: 72, cy: 100, rx: 10, ry: 8 } },
  { region: 'groin', side: 'unspecified', shape: { shape: 'ellipse', cx: 60, cy: 104, rx: 8, ry: 7 } },
  { region: 'thigh', side: 'left', shape: { shape: 'rect', x: 42, y: 108, width: 15, height: 40, rx2: 6 } },
  { region: 'thigh', side: 'right', shape: { shape: 'rect', x: 63, y: 108, width: 15, height: 40, rx2: 6 } },
  { region: 'knee', side: 'left', shape: { shape: 'ellipse', cx: 49, cy: 152, rx: 8, ry: 7 } },
  { region: 'knee', side: 'right', shape: { shape: 'ellipse', cx: 71, cy: 152, rx: 8, ry: 7 } },
  { region: 'lower-leg', side: 'left', shape: { shape: 'rect', x: 43, y: 160, width: 13, height: 40, rx2: 6 } },
  { region: 'lower-leg', side: 'right', shape: { shape: 'rect', x: 64, y: 160, width: 13, height: 40, rx2: 6 } },
  { region: 'ankle', side: 'left', shape: { shape: 'ellipse', cx: 49, cy: 204, rx: 6, ry: 5 } },
  { region: 'ankle', side: 'right', shape: { shape: 'ellipse', cx: 71, cy: 204, rx: 6, ry: 5 } },
  { region: 'foot', side: 'left', shape: { shape: 'ellipse', cx: 48, cy: 218, rx: 9, ry: 6 } },
  { region: 'foot', side: 'right', shape: { shape: 'ellipse', cx: 72, cy: 218, rx: 9, ry: 6 } },
];

function findRegionModel(
  regions: BodyMapRegionModel[],
  region: BodyRegion,
  side: BodySide,
): BodyMapRegionModel | undefined {
  if (side === 'unspecified') return regions.find((r) => r.region === region);
  return regions.find((r) => r.region === region && r.side === side)
    ?? regions.find((r) => r.region === region && r.side === 'unspecified');
}

function describeModel(label: string, model: BodyMapRegionModel): string {
  const episodeText = `${model.episodes} episode${model.episodes === 1 ? '' : 's'}${model.recurring ? ', recurring' : ''}`;
  const reportsText = model.reports.length > 0
    ? model.reports.map((r) => `${r.season} W${r.week}: ${r.labels.join(' / ')}`).join(' · ')
    : 'no dated reports on file';
  return `${label} — ${episodeText}. ${reportsText}`;
}

/**
 * Inline-SVG anatomical figure. Body regions tint by reported injury frequency (bucketed heat 1-3);
 * hovering or focusing a region reveals its episode count and dated report history. Regions with no
 * history are decorative (`aria-hidden`) so keyboard tab stops track only what's actually reportable
 * — typically 1-5 stops, not all ~17 shapes.
 *
 * Honesty rule: when the underlying usage feed isn't ready, this renders explanatory text instead of
 * the figure. An untinted skeleton must never be shown as if it meant "no injuries" — it would mean
 * "we don't know."
 */
export function PlayerBodyMap({ injuryHistory, feedStatus, playerName }: PlayerBodyMapProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);

  if (feedStatus !== 'ready') {
    return (
      <div className="body-map body-map-unavailable">
        <h4>Injury history</h4>
        <p className="muted">
          {feedStatus === 'loading' ? 'Loading injury history…' : 'Injury history is unavailable.'}
        </p>
      </div>
    );
  }

  const model = buildBodyMapModel(injuryHistory ?? []);
  const activeDetail = REGION_SLOTS
    .map((slot) => ({ slot, regionModel: findRegionModel(model.regions, slot.region, slot.side) }))
    .find(({ slot, regionModel }) => regionModel && `${slot.region}:${slot.side}` === activeKey);

  const detailText = activeDetail?.regionModel
    ? describeModel(
        `${activeDetail.slot.side !== 'unspecified' ? `${activeDetail.slot.side === 'left' ? 'Left' : 'Right'} ` : ''}${REGION_LABEL[activeDetail.slot.region]}`,
        activeDetail.regionModel,
      )
    : 'Hover or focus a highlighted region for its reported injury history.';

  return (
    <div className="body-map">
      <h4>Injury history</h4>
      <div className="body-map-figure-wrap body-map-holo">
        <svg
          className="body-map-figure"
          viewBox="0 0 120 260"
          role="img"
          aria-labelledby="body-map-figure-title"
        >
          <title id="body-map-figure-title">{`${playerName}'s reported injury history by body region`}</title>
          {REGION_SLOTS.map((slot) => {
            const regionModel = findRegionModel(model.regions, slot.region, slot.side);
            const key = `${slot.region}:${slot.side}`;
            const heat = regionModel?.heat ?? 0;
            const interactive = regionModel != null;
            const label = `${slot.side !== 'unspecified' ? `${slot.side === 'left' ? 'Left' : 'Right'} ` : ''}${REGION_LABEL[slot.region]}`;
            const commonProps = {
              className: 'body-map-region',
              'data-heat': heat,
              'data-active': activeKey === key || undefined,
            } as const;

            const shapeEl = slot.shape.shape === 'ellipse'
              ? (
                <ellipse
                  {...commonProps}
                  cx={slot.shape.cx} cy={slot.shape.cy} rx={slot.shape.rx} ry={slot.shape.ry}
                />
              ) : (
                <rect
                  {...commonProps}
                  x={slot.shape.x} y={slot.shape.y} width={slot.shape.width} height={slot.shape.height}
                  rx={slot.shape.rx2}
                />
              );

            if (!interactive) {
              return <g key={key} aria-hidden="true">{shapeEl}</g>;
            }

            return (
              <g
                key={key}
                tabIndex={0}
                role="button"
                aria-label={describeModel(label, regionModel!)}
                onMouseEnter={() => setActiveKey(key)}
                onMouseLeave={() => setActiveKey((current) => (current === key ? null : current))}
                onFocus={() => setActiveKey(key)}
                onBlur={() => setActiveKey((current) => (current === key ? null : current))}
              >
                {shapeEl}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="body-map-detail" role="status" aria-live="polite">{detailText}</p>

      {model.unlocalized.length > 0 && (
        <ul className="body-map-unlocalized">
          {model.unlocalized.map((entry, index) => (
            <li key={`${entry.label}-${index}`}>
              {entry.label} · {entry.episodes} episode{entry.episodes === 1 ? '' : 's'}
            </li>
          ))}
        </ul>
      )}

      <div className="body-map-legend">
        <span><i className="body-map-swatch" data-heat={1} /> 1 episode</span>
        <span><i className="body-map-swatch" data-heat={2} /> 2 episodes</span>
        <span><i className="body-map-swatch" data-heat={3} /> 3+ or recurring</span>
      </div>
      <p className="muted">Reported injury history, not a future injury probability.</p>
    </div>
  );
}
