import { useState } from 'react';
import type { ActiveProvider } from '../../session/activeProvider';

type EspnSubTab = 'start' | 'extension';

export interface EspnSetupTabsProps {
  /** The active session's provider, for the replace warnings. */
  active: ActiveProvider;
  /** Arms the ESPN bridge: opens the shared ManualDraftSetup dialog via the draft-session
   * provider (`handleManualMode`) — same handler the landing used before Phase 3 relocated this
   * component here. The dialog itself renders globally in AppLayout. */
  onStartEspn: () => void;
}

/** ESPN setup flow, hosted by OnboardingLeague (relocated verbatim from LandingPage.tsx in
 * Phase 3 when the landing became illustration-only). */
export function EspnSetupTabs({ active, onStartEspn }: EspnSetupTabsProps) {
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
