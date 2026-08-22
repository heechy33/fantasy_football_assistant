import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { SleeperCred } from '../../../shared/types';
import { useRevealOnScroll } from '../hooks/useRevealOnScroll';
import { APP_NAME } from './TopNav';
import { ConnectSleeper } from './ConnectSleeper';
import { LandingHeroCanvas } from './LandingHeroCanvas';
import { LANDING_DEMO_CARDS } from './landingDemoPlayers';
import { PlayerCard } from './PlayerCard';
import { ProviderBadge } from './ProviderBadge';

type EspnSubTab = 'start' | 'extension';

export type LandingActiveProvider = 'none' | 'sleeper' | 'espn';

/** Spokes of the integrations map — every platform the product reads from or aligns with. The
 * two live providers come first; the rest render brand-colored monogram chips. */
const INTEGRATION_KEYS = ['espn', 'sleeper', 'cbs', 'rtsports', 'fantrax', 'fantasypros'] as const;

export interface LandingPageProps {
  /** Which provider owns the current session, if any — derived by `App` from its `Session` union
   * (a Sleeper takeover still counts as 'sleeper'; a pure-manual ESPN session counts as 'espn'). */
  active: LandingActiveProvider;
  leagueName: string | null;
  onConnect: (cred: SleeperCred, draftId: string) => void;
  onStartEspn: () => void;
  onResume: () => void;
}

/**
 * Home — a product-first landing in the STACKED mold: direct headlines, real product UI shown
 * instead of described, and the 3D trophy room kept as one persistent cinematic layer behind
 * everything. Structure:
 *
 *   Scene    one fixed full-viewport Three.js layer (LandingHeroCanvas) behind every section.
 *   Hero     pill badge + headline + one-line pitch + connect CTA over the trophy.
 *   01       three short feature beats (live picks / ranked board / next-pick odds).
 *   02       a staged Draft-Room feed beside the REAL PlayerCard faces with static demo data.
 *   03       an integrations hub-and-spokes map; the Sleeper / ESPN setup forms stay collapsed
 *            behind a "Connect your league" CTA (an active session renders a Resume card first).
 *
 * Scroll reveals are native IntersectionObserver via useRevealOnScroll — no animation library.
 */
export function LandingPage({ active, leagueName, onConnect, onStartEspn, onResume }: LandingPageProps) {
  const pageRef = useRevealOnScroll<HTMLDivElement>();
  // The provider setup forms sit collapsed behind a CTA so the integrations story owns the
  // chapter; an active session skips the gate (its Resume panel is the useful content).
  const [connectOpen, setConnectOpen] = useState(active !== 'none');
  const showProviderPanels = connectOpen || active !== 'none';

  return (
    <div className="landing-page" ref={pageRef}>
      {/* The scene is one fixed layer behind every section — a continuous shot, not a hero prop
          that vanishes after the first scroll. */}
      <div className="landing-scene" aria-hidden="true">
        <LandingHeroCanvas />
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
          <button type="button" className="primary-button landing-hero-cta" onClick={onResume}>
            Return to your draft
          </button>
        ) : (
          <a className="primary-button landing-hero-cta" href="#connect">
            Connect your league
          </a>
        )}
      </section>

      <section className="landing-section" aria-label={`How ${APP_NAME} works`}>
        <header data-reveal>
          <p className="landing-kicker">01 · How it works</p>
          <h3>Built for the clock.</h3>
        </header>
        <div className="landing-beats">
          <article className="landing-beat" data-reveal>
            <h4>Live picks</h4>
            <p>Every pick lands on your board the second it happens — Sleeper directly, ESPN through the extension.</p>
          </article>
          <article className="landing-beat" data-reveal>
            <h4>Ranked for your pick</h4>
            <p>A clear take-next recommendation built from ADP, your roster needs, and positional scarcity.</p>
          </article>
          <article className="landing-beat" data-reveal>
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
                  rank={demo.rank}
                  adpSource="sleeper"
                  fantasyPros={demo.fantasyPros}
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
            <ResumeCard leagueName={leagueName} onResume={onResume} />
          </section>
        )}

        {active === 'none' && !connectOpen && (
          <div className="landing-connect-cta" data-reveal>
            <button type="button" className="primary-button" onClick={() => setConnectOpen(true)}>
              Connect your league
            </button>
            <p className="landing-connect-note">
              Sleeper connects directly. ESPN syncs through the Chrome extension.
            </p>
          </div>
        )}

        {showProviderPanels && (
          <>
            {active !== 'sleeper' && (
              <section className="provider-panel" data-reveal>
                <div className="provider-panel-lede">
                  <ProviderBadge brandKey="sleeper" />
                  <div>
                    <h3>Sleeper</h3>
                    <p className="provider-card-copy">
                      Connect your Sleeper account, pick a league or mock draft, and start tracking it live.
                    </p>
                    {active === 'espn' && (
                      <p className="muted provider-card-warning">Starting a Sleeper draft replaces your active ESPN draft.</p>
                    )}
                  </div>
                </div>
                <div className="provider-panel-body">
                  <ConnectSleeper onConnect={onConnect} />
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
                  <EspnSetupTabs active={active} onStartEspn={onStartEspn} />
                </div>
              </section>
            )}
          </>
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

function EspnSetupTabs({ active, onStartEspn }: { active: LandingActiveProvider; onStartEspn: () => void }) {
  const [tab, setTab] = useState<EspnSubTab>('start');
  return (
    <>
      <div className="provider-subtabs" role="tablist" aria-label="ESPN setup">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'start'}
          className={tab === 'start' ? 'active' : undefined}
          onClick={() => setTab('start')}
        >
          Start draft
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'extension'}
          className={tab === 'extension' ? 'active' : undefined}
          onClick={() => setTab('extension')}
        >
          Extension setup
        </button>
      </div>

      <div className="provider-subtab-panel">
        {tab === 'start' ? (
          <>
            <p className="provider-card-copy">
              Set your league and draft position, then start tracking — picks stream live from
              your ESPN draft tab via the Chrome extension as soon as setup is done.
            </p>
            {active === 'sleeper' && (
              <p className="muted provider-card-warning">Starting an ESPN draft replaces your active Sleeper draft.</p>
            )}
            <button type="button" className="primary-button" onClick={onStartEspn}>Set up ESPN draft</button>
            <p className="muted provider-card-note">
              No extension connected yet? Picks can still be logged by hand from the Draft Room.
            </p>
          </>
        ) : (
          <ol className="provider-card-steps">
            <li>Download the <code>extension</code> folder from the project repo.</li>
            <li>
              Open <code>chrome://extensions</code>, turn on Developer mode, click &quot;Load unpacked,&quot; and
              select that folder.
            </li>
            <li>Open your ESPN live draft page in a tab — picks stream in automatically once the extension is loaded.</li>
          </ol>
        )}
      </div>
    </>
  );
}

function ResumeCard({ leagueName, onResume }: { leagueName: string | null; onResume: () => void }) {
  return (
    <>
      <p className="provider-card-copy">
        {leagueName ? <>Your <strong>{leagueName}</strong> draft is loaded.</> : 'Your draft is loaded.'}
      </p>
      <button type="button" className="primary-button" onClick={onResume}>Resume draft</button>
    </>
  );
}
