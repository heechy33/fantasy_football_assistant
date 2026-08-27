import { ConnectSleeper } from '../components/ConnectSleeper';
import { useDraftSession } from '../session/DraftSessionProvider';
import { buildSleeperLeagueInput, useSavedLeagues } from '../data/useSavedLeagues';
import type { LeagueRef, SleeperCred } from '../../../shared/types';
import { EspnSetupTabs } from './onboarding/EspnSetupTabs';

/**
 * The one connect surface, rendered by BOTH /leagues/connect and /onboarding/league. Both providers
 * render UNCHANGED: ConnectSleeper's `onConnect(cred, draftId)` fits the session provider's
 * `handleConnect`, and the ESPN path arms the bridge through the shared ManualDraftSetup dialog.
 *
 * `handleSaveLeague` is the league-first half of the connect split (2026-08-26 decision): saving a
 * league writes a durable SavedLeague pointer immediately — real season included — while "Track
 * draft" only starts a session. Either can happen without the other; draft sync reconciles them.
 */
export function ConnectLeagueRoute() {
  const { activeProvider, handleConnect, handleManualMode } = useDraftSession();
  const { saveLeague } = useSavedLeagues();

  /** Failures rethrow so ConnectSleeper's per-row button shows the error instead of a fake check. */
  async function handleSaveLeague(cred: SleeperCred, ref: LeagueRef): Promise<void> {
    await saveLeague(await buildSleeperLeagueInput(cred, ref));
  }

  return (
    <div className="onboarding-panel">
      <section className="provider-panel" aria-label="Connect Sleeper">
        <div className="provider-panel-lede">
          <h3>Sleeper</h3>
          <p className="provider-card-copy">
            Connect your Sleeper account — save a league to My Leagues, or track a draft live.
          </p>
          {activeProvider === 'espn' && (
            <p className="muted provider-card-warning">Starting a Sleeper draft replaces your active ESPN draft.</p>
          )}
        </div>
        <div className="provider-panel-body">
          <ConnectSleeper onConnect={handleConnect} onSaveLeague={handleSaveLeague} />
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