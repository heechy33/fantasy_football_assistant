import type { CSSProperties } from 'react';
import fantasyBobLogo from '../assets/brand/fantasy-bob.png';
import { ProviderBadge } from './ProviderBadge';

/** Tiles left-to-right. Order is the user's; index drives both the grid column and the
 *  connector-branch x-coordinate below. */
const INTEGRATION_TILES = ['sleeper', 'espn', 'cbs', 'underdog', 'yahoo'] as const;

/** viewBox is 800×140: rail at y=70, hub bottom at y=0, tile tops at y=140. Column centers are
 * 10/30/50/70/90% of 800 = 80/240/400/560/720, and the hub sits on the middle column (x=400) so
 * the center branch is a straight vertical run. This only lines up with the real tile row because
 * both `.integrations-wires` and `.integrations-tiles` are sized to the same `--int-row` custom
 * property in App.css — five equal tiles with equal gaps puts tile centers at those same
 * percentages regardless of the row's actual pixel width. Every path is authored tile → hub so the
 * dash comet (CSS, in App.css) always travels upward into the hub. */
const BRANCH_PATHS = [
  'M 80 140 V 70 H 400 V 0', // sleeper
  'M 240 140 V 70 H 400 V 0', // espn
  'M 400 140 V 0', // cbs (straight up the middle)
  'M 560 140 V 70 H 400 V 0', // underdog
  'M 720 140 V 70 H 400 V 0', // yahoo
];

/** Non-uniform per-branch delays so the pulses never read as a metronome. */
const BRANCH_DELAYS = ['0s', '1.4s', '2.6s', '3.5s', '5.1s'];

/**
 * The "03 · Data sources" illustration: a hub plate wired to one tile per platform, with an
 * animated comet traveling each wire on a staggered loop (pure CSS — see `.integrations-pulse-*`
 * in App.css; no animation library per the repo's zero-animation-library baseline).
 */
export function IntegrationsMap() {
  return (
    <div className="integrations-map" data-reveal>
      <div className="integrations-hub">
        <span className="integrations-hub-glow" aria-hidden="true" />
        <span className="integrations-hub-mark" aria-hidden="true">
          <img className="integrations-hub-logo" src={fantasyBobLogo} alt="" />
        </span>
      </div>
      <svg
        className="integrations-wires"
        viewBox="0 0 800 140"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <g className="integrations-trace">
          {BRANCH_PATHS.map((d) => (
            <path key={d} d={d} pathLength={100} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        <g className="integrations-pulse-tail">
          {BRANCH_PATHS.map((d, i) => (
            <path
              key={d}
              d={d}
              pathLength={100}
              vectorEffect="non-scaling-stroke"
              style={{ '--branch-delay': BRANCH_DELAYS[i] } as CSSProperties}
            />
          ))}
        </g>
        <g className="integrations-pulse-head">
          {BRANCH_PATHS.map((d, i) => (
            <path
              key={d}
              d={d}
              pathLength={100}
              vectorEffect="non-scaling-stroke"
              style={{ '--branch-delay': BRANCH_DELAYS[i] } as CSSProperties}
            />
          ))}
        </g>
      </svg>
      <ul className="integrations-tiles">
        {INTEGRATION_TILES.map((key) => (
          <li key={key} className="integrations-tile">
            <ProviderBadge brandKey={key} />
          </li>
        ))}
      </ul>
    </div>
  );
}
