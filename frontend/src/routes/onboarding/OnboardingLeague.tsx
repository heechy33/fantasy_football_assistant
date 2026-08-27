import { ConnectSleeper } from '../../components/ConnectSleeper';
import { useDraftSession } from '../../session/DraftSessionProvider';
import { EspnSetupTabs } from './EspnSetupTabs';

/**
 * The real connect flow — relocated here in Phase 3 from the landing. Both providers render
 * UNCHANGED: ConnectSleeper's `onConnect(cred, draftId)` already fits the session provider's
 * `handleConnect`, and the ESPN path arms the bridge through the shared ManualDraftSetup dialog
 * (`handleManualMode` → the dialog that renders globally in AppLayout). Nothing about either
 * provider's internals moved.
 */
export function OnboardingLeague() {
  const { activeProvider, handleConnect, handleManualMode } = useDraftSession();

  return (
    <div className="onboarding-panel">
      <section className="provider-panel" aria-label="Connect Sleeper">
        <div className="provider-panel-lede">
          <h3>Sleeper</h3>
          <p className="provider-card-copy">
            Connect your Sleeper account, pick a league or mock draft, and start tracking it live.
          </p>
          {activeProvider === 'espn' && (
            <p className="muted provider-card-warning">Starting a Sleeper draft replaces your active ESPN draft.</p>
          )}
        </div>
        <div className="provider-panel-body">
          <ConnectSleeper onConnect={handleConnect} />
        </div>
      </section>

      <section className="provider-panel" aria-label="Set up ESPN">
        <div className="provider-panel-lede">
          <h3>ESPN</h3>
          {activeProvider === 'sleeper' && (
            <p className="muted provider-card-warning">Starting an ESPN draft replaces your active Sleeper draft.</p>
          )}
        </div>
        <div className="provider-panel-body">
          <EspnSetupTabs active={activeProvider} onStartEspn={handleManualMode} />
        </div>
      </section>
    </div>
  );
}
