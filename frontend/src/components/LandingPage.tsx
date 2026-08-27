import { lazy, Suspense } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useRevealOnScroll } from '../hooks/useRevealOnScroll';
import type { ActiveProvider } from '../session/activeProvider';
import { APP_NAME } from './TopNav';
import { LANDING_DEMO_CARDS } from './landingDemoPlayers';
import { PlayerCard } from './PlayerCard';
import { ProviderBadge } from './ProviderBadge';
import { SleeperIllustration, EspnIllustration } from './ProviderIllustration';

// Lazy: keeps the cinematic canvas (and everything it pulls) out of whatever entry chunk a
// /draft-guide visitor downloads. three.js itself was ALREADY dynamically imported inside the
// canvas module — this splits the canvas module too.
const LandingHeroCanvas = lazy(() => import('./LandingHeroCanvas').then((m) => ({ default: m.LandingHeroCanvas })));

/** Back-compat alias — the type's real home is `session/activeProvider.ts` (it is session
 * vocabulary, not landing vocabulary). New code imports ActiveProvider directly. */
export type LandingActiveProvider = ActiveProvider;

/** Spokes of the integrations map — every platform the product reads from or aligns with. The
 * two live providers come first; the rest render brand-colored monogram chips. */
const INTEGRATION_KEYS = ['espn', 'sleeper', 'cbs', 'rtsports', 'fantrax', 'fftoday'] as const;

export interface LandingPageProps {
  /** Which provider owns the current session, if any — derived by `AppLayout` from the draft
   * session (a Sleeper takeover still counts as 'sleeper'; a pure-manual ESPN session counts as
   * 'espn'). The connect forms themselves left the landing in Phase 3 — they render as inert
   * illustrations here; the real flow lives at `/onboarding/league`. */
  active: LandingActiveProvider;
  leagueName: string | null;
}

/**
 * Home — a product-first landing in the STACKED mold: direct headlines, real product UI shown
 * instead of described, and the 3D trophy room kept as one persistent cinematic layer behind
 * everything. Structure:
 *
 *   Scene    one fixed full-viewport Three.js layer (LandingHeroCanvas) behind every section.
 *   Hero     pill badge + headline + one-line pitch + public CTAs over the trophy.
 *   01       three short feature beats (live picks / ranked board / next-pick odds).
 *   02       a staged Draft-Room feed beside the REAL PlayerCard faces with static demo data.
 *   03       an integrations hub-and-spokes map; the Sleeper / ESPN connect cards render as
 *            inert illustrations — the real flow lives at `/onboarding/league` (an active session
 *            renders a Resume card first).
 *
 * Scroll reveals are native IntersectionObserver via useRevealOnScroll — no animation library.
 */
export function LandingPage({ active, leagueName }: LandingPageProps) {
  const pageRef = useRevealOnScroll<HTMLDivElement>();

  return (
    <div className="landing-page" ref={pageRef}>
      {/* The scene is one fixed layer behind every section — a continuous shot, not a hero prop
          that vanishes after the first scroll. */}
      <div className="landing-scene" aria-hidden="true">
        <Suspense fallback={null}>
          <LandingHeroCanvas />
        </Suspense>
        <div className="landing-scene-glow" />
        <div className="landing-vignette" />
      </div>

      <section className={`landing-hero${active !== 'none' ? ' has-active' : ''}`}>
        <p className="landing-hero-pill">
          <span className="landing-feed-dot" aria-hidden="true" />
          Live draft assistant · Sleeper + ESPN
        </p>
        <h2 className="landing-hero-title">Draft day, handled.</h2>
        <p className="landing-hero-copy">
          {APP_NAME} watches every pick, ranks the board, and tells you who to take before your
          clock runs out.
        </p>
        {active !== 'none' ? (
          <Link to="/draft" className="primary-button landing-hero-cta">
            Return to your draft
          </Link>
        ) : (
          <div className="landing-hero-ctas">
            <Link to="/draft-guide" className="primary-button landing-hero-cta">
              Browse the Draft Guide — no account needed
            </Link>
            <Link to="/sign-up" className="landing-hero-cta-secondary">
              Create free account
            </Link>
          </div>
        )}
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
            <p>Every pick lands on your board the second it happens — Sleeper directly, ESPN through the extension.</p>
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
        <p className="landing-board-note" data-reveal>
          Projections, ADP, usage, survival odds, and ratings — one card per player, one glance per pick.
        </p>
      </section>

      <section
        className="landing-section landing-integrations"
        id="connect"
        aria-label="Integrations and connecting your league"
      >
        <header data-reveal>
          <p className="landing-kicker">03 · Integrations</p>
          <h3>One hub for all your leagues.</h3>
          <p className="landing-section-lede">
            {APP_NAME} plugs into the platforms your league already lives on — synced draft state in,
            ranked picks out.
          </p>
        </header>

        {/* Hub-and-spokes: the product at center, every supported platform hanging off it. Pure
            CSS wiring (stem → rail → per-spoke stubs) so it stays crisp and responsive. */}
        <div className="integrations-map" data-reveal>
          <div className="integrations-hub">
            <span className="integrations-hub-mark" aria-hidden="true">FB</span>
            <span className="integrations-hub-label">{APP_NAME}</span>
          </div>
          <div className="integrations-stem" aria-hidden="true" />
          <div className="integrations-rail" aria-hidden="true" />
          <ul className="integrations-spokes">
            {INTEGRATION_KEYS.map((key) => (
              <li key={key}>
                <ProviderBadge brandKey={key} />
              </li>
            ))}
          </ul>
        </div>

        {active !== 'none' && (
          <section className="provider-panel provider-panel-active" data-reveal>
            <div className="provider-card-heading">
              <ProviderBadge brandKey={active} />
              <h3>{active === 'espn' ? 'ESPN' : 'Sleeper'}</h3>
            </div>
            <ResumeCard leagueName={leagueName} />
          </section>
        )}

        {/* The connect cards are inert illustrations now (Phase 3): the real flow lives at
            /onboarding/league, so the landing shows what connecting LOOKS like without wiring. */}
        {active !== 'sleeper' && (
          <section className="provider-panel" data-reveal>
            <div className="provider-panel-lede">
              <ProviderBadge brandKey="sleeper" />
              <div>
                <h3>Sleeper</h3>
                <p className="provider-card-copy">
                  Connect your Sleeper account, pick a league or mock draft, and start tracking it live.
                </p>
              </div>
            </div>
            <div className="provider-panel-body">
              <SleeperIllustration />
            </div>
          </section>
        )}

        {active !== 'espn' && (
          <section className="provider-panel" data-reveal>
            <div className="provider-panel-lede">
              <ProviderBadge brandKey="espn" />
              <div>
                <h3>ESPN</h3>
              </div>
            </div>
            <div className="provider-panel-body">
              <EspnIllustration />
            </div>
          </section>
        )}
      </section>

      <footer className="landing-footer" data-reveal>
        <p>{APP_NAME} · Live draft assistant</p>
      </footer>
    </div>
  );
}

const DEMO_FEED: { pick: string; name: string; meta: string; note: string; live?: boolean }[] = [
  { pick: '1.09', name: 'Bijan Robinson', meta: 'RB · ATL', note: 'off the board' },
  { pick: '1.10', name: 'Kyren Williams', meta: 'RB · LAR', note: 'off the board' },
  { pick: '2.01', name: 'Josh Jacobs', meta: 'RB · GB', note: 'off the board' },
  { pick: '2.02', name: 'Jonathan Taylor', meta: 'RB · IND', note: 'on the clock', live: true },
];

/** A real link (not a button) so an in-progress draft is openable in a new tab — this is the
 * "you have a draft in progress" signal now that rehydration no longer auto-navigates. */
function ResumeCard({ leagueName }: { leagueName: string | null }) {
  return (
    <>
      <p className="provider-card-copy">
        {leagueName ? <>Your <strong>{leagueName}</strong> draft is loaded.</> : 'Your draft is loaded.'}
      </p>
      <Link to="/draft" className="primary-button">Resume draft</Link>
    </>
  );
}
