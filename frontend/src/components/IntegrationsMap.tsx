import { useState, type CSSProperties } from 'react';
import fantasyBobLogo from '../assets/brand/fantasy-bob.png';
import { ProviderBadge } from './ProviderBadge';
import { providerBrand } from '../data/providerBrand';

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

/** Non-uniform per-branch delays, spaced across the full 20s loop (App.css's
 * `.integrations-pulse-*` duration) so every consecutive gap exceeds the ~3s travel window each
 * comet takes to cross its wire. All five branches' final approach shares the exact same trunk
 * pixels into the hub (`BRANCH_PATHS`'s common ` H 400 V 0`/`V 0` tail) — the original tighter
 * delays (0/1.4/2.6/3.5/5.1s on a 10s loop) had overlapping travel windows, so two or three comets
 * were regularly mid-flight through that shared trunk at once, reading as cars queued nose-to-tail
 * rather than one comet at a time (2026-08-30 fix). These gaps (3.8/4.4/3.9/4.3/3.6s, wrapping)
 * stay irregular on purpose — evenly-spaced delays would read as a metronome — but none is smaller
 * than the travel window, so at most one comet is ever in flight. */
const BRANCH_DELAYS = ['0s', '3.8s', '8.2s', '12.1s', '16.4s'];

interface ProviderFeature {
  title: string;
  desc: string;
}

const PROVIDER_FEATURES: Readonly<Record<string, ProviderFeature>> = {
  sleeper: {
    title: 'Sleeper',
    desc: 'Direct WebSocket feed & real-time draft board sync',
  },
  espn: {
    title: 'ESPN',
    desc: 'Chrome extension live pick capture & custom league scoring',
  },
  cbs: {
    title: 'CBS Sports',
    desc: 'Consensus rankings & weekly projections feed',
  },
  underdog: {
    title: 'Underdog',
    desc: 'Best ball ADP & tournament market consensus',
  },
  yahoo: {
    title: 'Yahoo Fantasy',
    desc: 'Draft log parser & custom league sync',
  },
};

/**
 * The "03 · Data sources" illustration: a hub plate wired to one tile per platform, with an
 * animated comet traveling each wire on a staggered loop (pure CSS — see `.integrations-pulse-*`
 * in App.css; no animation library per the repo's zero-animation-library baseline).
 *
 * Interactive across all interfaces: tapping any provider badge lights up its wire and reveals
 * how that source powers the Fantasy Bob draft engine.
 */
export function IntegrationsMap() {
  const [activeTile, setActiveTile] = useState<string | null>(null);

  const activeFeature = activeTile ? PROVIDER_FEATURES[activeTile] : null;

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
          {BRANCH_PATHS.map((d, i) => {
            const isBranchActive = activeTile === INTEGRATION_TILES[i];
            return (
              <path
                key={d}
                d={d}
                pathLength={100}
                vectorEffect="non-scaling-stroke"
                className={isBranchActive ? 'integrations-wire-active' : undefined}
              />
            );
          })}
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
        {INTEGRATION_TILES.map((key) => {
          const isSelected = activeTile === key;
          const label = providerBrand(key)?.label ?? key;
          return (
            <li key={key} className="integrations-tile">
              <button
                type="button"
                className="integrations-tile-btn"
                aria-pressed={isSelected}
                aria-label={`Show ${label} data integration`}
                onClick={() => setActiveTile(isSelected ? null : key)}
              >
                <ProviderBadge brandKey={key} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="integrations-detail-wrap" aria-live="polite">
        {activeFeature && (
          <div className="integrations-detail-pill">
            <span className="integrations-detail-dot" aria-hidden="true" />
            <strong>{activeFeature.title}</strong>
            <span className="integrations-detail-desc">{activeFeature.desc}</span>
          </div>
        )}
      </div>
    </div>
  );
}
