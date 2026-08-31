import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ConnectSleeper } from '../components/ConnectSleeper';
import { ProviderBadge } from '../components/ProviderBadge';
import { buildSleeperLeagueInput, buildEspnLeagueInput, useSavedLeagues } from '../data/useSavedLeagues';
import { buildEspnImportedDraft, buildEspnImportedInit } from '../adapters/espnDraftImport';
import { loadEspnPlayerIndex } from '../adapters/espn';
import type { EspnLeagueSnapshot, LeagueRef, SleeperCred } from '../../../shared/types';
import { EspnSetupTabs } from './onboarding/EspnSetupTabs';

type ActiveConnectProvider = 'sleeper' | 'espn';

/**
 * The one connect surface, rendered by BOTH /leagues/connect and /onboarding/league. Since the
 * 2026-08-27 connect/start split (DECISIONS.md) it is SAVE-ONLY: it writes durable SavedLeague
 * pointers (Sleeper via the account, ESPN via the extension's league-page capture) and then
 * navigates to /leagues — the hub remounts, which refetches and shows the new card. Nothing here
 * starts a session or ever lands on /draft (routes.test.tsx asserts that regression).
 *
 * 2026-08-28 exception, still session-less: when the capture shows the league ALREADY drafted,
 * the completed transcript (frozenInit + picks) is written as a durable SavedDraft so /leagues/:id
 * can reconstruct the roster. That is an import of a historical record, not a live session.
 */
export function ConnectLeagueRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  // OnboardingLayout (the /onboarding/league alias) already supplies its own "Connect your
  // league" heading + step rail; this route's own page heading and "Back to My Leagues" link
  // would be redundant there (and the back link is actively wrong mid-wizard — the user hasn't
  // been to My Leagues yet). Shown only on the standalone /leagues/connect surface.
  const isStandalone = !location.pathname.startsWith('/onboarding');
  const { leagues, saveLeague, saveDraft } = useSavedLeagues();
  // Sleeper is the default active panel — this route is reached from several places (My Leagues'
  // "Connect a league", the onboarding wizard, a direct link) with no signal about which provider
  // the user wants, and Sleeper needs no external extension, so it is the lower-friction default.
  const [activeProvider, setActiveProvider] = useState<ActiveConnectProvider>('sleeper');

  /** Failures rethrow so ConnectSleeper's per-row button shows the error instead of a fake check.
   * The username rides along so `providerUsername` lands on the SavedLeague (2026-08-28). */
  async function handleSaveLeague(cred: SleeperCred, ref: LeagueRef, username: string | null): Promise<void> {
    await saveLeague(await buildSleeperLeagueInput(cred, ref, username));
    navigate('/leagues');
  }

  async function handleSaveEspnLeague(snapshot: EspnLeagueSnapshot, myTeamId: number | null): Promise<void> {
    await saveLeague(buildEspnLeagueInput(snapshot, myTeamId));
    navigate('/leagues');
  }

  async function handleImportEspnDraft(snapshot: EspnLeagueSnapshot, myTeamId: number | null): Promise<void> {
    // The crosswalk (ids.espn -> canonical Sleeper id) is required to resolve players; without it
    // every pick would store playerId: null, which is a worse (but still honest) outcome — so it
    // is awaited up front and a failure surfaces on the card rather than writing a hollow draft.
    const index = await loadEspnPlayerIndex();
    const imported = buildEspnImportedDraft(snapshot, myTeamId, index);
    if (!imported) throw new Error('No drafted picks were captured — open the league page after the draft, then scan again.');
    const league = await saveLeague(buildEspnLeagueInput(snapshot, myTeamId, imported.mySlot));
    await saveDraft({
      leagueId: league.id,
      provider: 'espn',
      providerDraftId: `espn-import:${snapshot.leagueId}`,
      mode: 'espn',
      frozenInit: buildEspnImportedInit(snapshot, myTeamId, imported),
      overrides: [],
      picks: imported.picks,
      status: 'complete',
    });
    navigate('/leagues');
  }

  return (
    <div className="onboarding-panel">
      {isStandalone && (
        <div className="section-heading">
          <div>
            <p className="eyebrow">My Leagues</p>
            <h2>Connect a league</h2>
          </div>
          <Link to="/leagues" className="quiet-button">Back</Link>
        </div>
      )}

      <div className="provider-chooser" role="tablist" aria-label="Choose a provider">
        <button
          type="button"
          role="tab"
          aria-selected={activeProvider === 'sleeper'}
          className="provider-chip"
          onClick={() => setActiveProvider('sleeper')}
        >
          <ProviderBadge brandKey="sleeper" size="sm" />
          Sleeper
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeProvider === 'espn'}
          className="provider-chip"
          onClick={() => setActiveProvider('espn')}
        >
          <ProviderBadge brandKey="espn" size="sm" />
          ESPN
        </button>
        <button type="button" role="tab" aria-selected={false} className="provider-chip" disabled>
          <ProviderBadge brandKey="yahoo" size="sm" />
          Yahoo <span className="provider-chip-note">coming soon</span>
        </button>
      </div>

      {activeProvider === 'sleeper' && (
        <section className="provider-panel" aria-label="Connect Sleeper">
          <div className="provider-panel-body">
            <ConnectSleeper onSaveLeague={handleSaveLeague} savedLeagues={leagues} />
          </div>
        </section>
      )}

      {activeProvider === 'espn' && (
        <section className="provider-panel" aria-label="Connect ESPN">
          <div className="provider-panel-body">
            <EspnSetupTabs onSaveEspnLeague={handleSaveEspnLeague} onImportEspnDraft={handleImportEspnDraft} />
          </div>
        </section>
      )}
    </div>
  );
}