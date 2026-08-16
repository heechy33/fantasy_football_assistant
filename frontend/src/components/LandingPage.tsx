import { useState } from 'react';
import type { SleeperCred } from '../../../shared/types';
import { APP_NAME } from './TopNav';
import { ConnectSleeper } from './ConnectSleeper';
import { ProviderBadge } from './ProviderBadge';

type EspnSubTab = 'start' | 'extension';

export type LandingActiveProvider = 'none' | 'sleeper' | 'espn';

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
 * Home. Chrome-less landing (see TopNav's identity-only row on this page) with two side-by-side
 * provider paths instead of a single Sleeper form burying ESPN behind a "skip connecting" link.
 * Resume is per-card: whichever provider owns the live session gets a resume CTA in place of its
 * normal connect/setup flow; the other card still works, but starting it replaces the current
 * draft (same `board.reset`/`handleEspnSetupSubmit` behavior as today), so it carries a warning.
 */
export function LandingPage({ active, leagueName, onConnect, onStartEspn, onResume }: LandingPageProps) {
  return (
    <>
      <section className="landing-hero">
        <p className="eyebrow">Live draft assistant</p>
        <h2>
          Track the board. Get <span className="landing-hero-accent">{APP_NAME}&apos;s</span> picks.
        </h2>
        <p className="landing-hero-copy">
          Connect Sleeper or ESPN and track picks live with ranked recommendations as they land.
        </p>
      </section>

      <div className="landing-features" aria-label={`What ${APP_NAME} does`}>
        <article className="feature-card">
          <h3>Tracks your draft live</h3>
          <p>Picks stream in from Sleeper or the ESPN bridge, and the board updates the moment they land.</p>
        </article>
        <article className="feature-card">
          <h3>Recommends the best pick</h3>
          <p>Works the board ahead of your turn and ranks what&apos;s left with the reasoning up front.</p>
        </article>
      </div>

      <div className="landing-paths">
        <section className="provider-card">
          <div className="provider-card-heading">
            <ProviderBadge brandKey="sleeper" />
            <h3>Sleeper</h3>
          </div>
          {active === 'sleeper' ? (
            <ResumeCard leagueName={leagueName} onResume={onResume} />
          ) : (
            <>
              <p className="provider-card-copy">
                Connect your Sleeper account, pick a league or mock draft, and start tracking it live.
              </p>
              {active === 'espn' && (
                <p className="muted provider-card-warning">Starting a Sleeper draft replaces your active ESPN draft.</p>
              )}
              <ConnectSleeper onConnect={onConnect} />
            </>
          )}
        </section>

        <section className="provider-card">
          <div className="provider-card-heading">
            <ProviderBadge brandKey="espn" />
            <h3>ESPN</h3>
          </div>
          {active === 'espn' ? (
            <ResumeCard leagueName={leagueName} onResume={onResume} />
          ) : (
            <EspnSetupTabs active={active} onStartEspn={onStartEspn} />
          )}
        </section>
      </div>
    </>
  );
}

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
