import { lazy, Suspense } from 'react';
import type { CSSProperties } from 'react';
import { useRevealOnScroll } from '../hooks/useRevealOnScroll';
import type { ActiveProvider } from '../session/activeProvider';
import { APP_NAME } from './TopNav';
import { IntegrationsMap } from './IntegrationsMap';
import { LANDING_DEMO_CARDS } from './landingDemoPlayers';
import { PlayerCard } from './PlayerCard';

// Lazy: keeps the cinematic canvas (and everything it pulls) out of whatever entry chunk a
// /draft-guide visitor downloads. three.js itself was ALREADY dynamically imported inside the
// canvas module — this splits the canvas module too.
const LandingHeroCanvas = lazy(() => import('./LandingHeroCanvas').then((m) => ({ default: m.LandingHeroCanvas })));

/** Back-compat alias — the type's real home is `session/activeProvider.ts` (it is session
 * vocabulary, not landing vocabulary). New code imports ActiveProvider directly. */
export type LandingActiveProvider = ActiveProvider;

export interface LandingPageProps {
  /** Which provider owns the current session, if any — derived by `AppLayout` from the draft
   * session (a Sleeper takeover still counts as 'sleeper'; a pure-manual ESPN session counts as
   * 'espn'). The connect forms themselves left the landing in Phase 3 — the real flow lives at
   * `/onboarding/league`. `leagueName` remains part of the contract (callers pass it) but the
   * compact landing no longer renders it. */
  active: LandingActiveProvider;
  leagueName: string | null;
}

/**
 * Home — a product-first landing in the STACKED mold: direct headlines, real product UI shown
 * instead of described, and the 3D trophy room kept as one persistent cinematic layer behind
 * everything. Structure:
 *
 *   Scene    one fixed full-viewport Three.js layer (LandingHeroCanvas) behind every section,
 *            with a CSS starfield carrying the first paint until the trophy GLB lands.
 *   Hero     kicker + "The Chip Is Yours" + italic sub-line over the trophy. No CTAs here (2026-08-29)
 *            — TopNav already carries Draft Guide + Sign up, and duplicating them read as noise.
 *   01       three short feature beats (live picks / ranked board / next-pick odds).
 *   02       a staged Draft-Room feed beside the REAL PlayerCard faces with static demo data.
 *   03       a data-sources map (IntegrationsMap): an animated hub-and-wires illustration showing
 *            every platform the engine reads ADP/rankings/projections from — not a league-connect
 *            claim. The connect rows themselves are gone — the real flow lives at
 *            `/onboarding/league` and `/leagues/connect`.
 *
 * Scroll reveals are native IntersectionObserver via useRevealOnScroll — no animation library.
 */
export function LandingPage({ active }: LandingPageProps) {
  const pageRef = useRevealOnScroll<HTMLDivElement>();

  return (
    <div className="landing-page" ref={pageRef}>
      {/* The scene is one fixed layer behind every section — a continuous shot, not a hero prop
          that vanishes after the first scroll. */}
      <div className="landing-scene" aria-hidden="true">
        <Suspense fallback={null}>
          <LandingHeroCanvas />
        </Suspense>
        <div className="landing-stars" />
        <div className="landing-vignette" />
      </div>

      <section className={`landing-hero${active !== 'none' ? ' has-active' : ''}`}>
        <p className="landing-hero-pill">
          <span className="landing-feed-dot" aria-hidden="true" />
          Fantasy Bob · Live draft assistant
        </p>
        <h2 className="landing-hero-title">THE CHIP IS YOURS</h2>
        <p className="landing-hero-sub">with FANTASY BOB</p>
      </section>

      <section className="landing-section" aria-label={`How ${APP_NAME} works`}>
        <header data-reveal>
          <p className="landing-kicker">01 · How it works</p>
          <h3>Built for the clock.</h3>
        </header>
        <div className="landing-beats">
          <article className="landing-beat" data-reveal>
            <span className="landing-beat-index" aria-hidden="true">01</span>
            <h4>Live picks</h4>
            <p>Every pick lands on your board the second it happens: Sleeper directly, ESPN through the extension.</p>
          </article>
          <article className="landing-beat" data-reveal>
            <span className="landing-beat-index" aria-hidden="true">02</span>
            <h4>Ranked for your pick</h4>
            <p>A clear take-next recommendation built from ADP, your roster needs, and positional scarcity.</p>
          </article>
          <article className="landing-beat" data-reveal>
            <span className="landing-beat-index" aria-hidden="true">03</span>
            <h4>Next-pick odds</h4>
            <p>Know who&rsquo;s likely to survive to your next selection before you reach for anyone.</p>
          </article>
        </div>
      </section>

      {/* 02 — the product itself: staged Draft-Room feed beside the card art. Show it, don't
          describe it (the STACKED pattern). */}
      <section className="landing-section" aria-label="The board during a draft">
        <header data-reveal>
          <p className="landing-kicker">02 · On the clock</p>
          <h3>The board, mid-draft</h3>
        </header>
        <div className="landing-board">
          <div className="landing-board-feed" data-reveal>
            <p className="landing-feed-head">
              <span className="landing-feed-dot" aria-hidden="true" />
              Round 2 · Pick 19 · You&rsquo;re on the clock
            </p>
            <ol className="landing-feed-list">
              {DEMO_FEED.map((row, i) => (
                <li key={row.pick} className="landing-feed-row" style={{ '--feed-i': i } as CSSProperties}>
                  <span className="landing-feed-pick">{row.pick}</span>
                  <span className="landing-feed-who">
                    <strong>{row.name}</strong> <em>{row.meta}</em>
                  </span>
                  <span className="landing-feed-note" data-state={row.live ? 'live' : undefined}>
                    {row.note}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="landing-board-cards">
            {/* The REAL Draft-Room card face with static demo data — no PNG screenshots to go
                stale or soft. Cards are display-only: the details click is a no-op here. */}
            {LANDING_DEMO_CARDS.map((demo, i) => (
              <div
                key={demo.player.playerId}
                className={`landing-demo-card landing-demo-card-${i === 0 ? 'left' : 'right'}`}
              >
                <PlayerCard
                  playerId={demo.player.playerId}
                  recommendation={demo.recommendation}
                  player={demo.player}
                  adpSource="sleeper"
                  nextUp={demo.nextUp}
                  depthRole={demo.depthRole}
                  onViewDetails={() => undefined}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        className="landing-section landing-integrations"
        id="connect"
        aria-label="Where the data comes from"
      >
        {/* STACKED pattern: copy on the left, live illustration on the right. */}
        <div className="landing-integrations-grid">
          <header data-reveal className="landing-integrations-copy">
            <p className="landing-kicker">03 · Data sources</p>
            <h3>Every source. One board.</h3>
            <p className="landing-section-lede">
              {APP_NAME} pulls ADP, rankings, and projections from the platforms your league already
              lives on, and reconciles them into one ranked board.
            </p>
          </header>

          <IntegrationsMap />
        </div>

        {/* The connect rows are gone — this map plus the hero CTAs carry the whole story; the
            real connect flow lives at /leagues/connect and /onboarding/league. */}
      </section>

      <footer className="landing-footer" data-reveal>
        <p>{APP_NAME} · Live draft assistant</p>
      </footer>
    </div>
  );
}

const DEMO_FEED: { pick: string; name: string; meta: string; note: string; live?: boolean }[] = [
  { pick: '2.04', name: 'Bijan Robinson', meta: 'RB · ATL', note: 'off the board' },
  { pick: '2.05', name: 'Kyren Williams', meta: 'RB · LAR', note: 'off the board' },
  { pick: '2.06', name: 'Josh Jacobs', meta: 'RB · GB', note: 'off the board' },
  { pick: '2.07', name: 'Jonathan Taylor', meta: 'RB · IND', note: 'on the clock', live: true },
];
