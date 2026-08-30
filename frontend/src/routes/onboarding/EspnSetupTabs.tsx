import { useCallback, useEffect, useState } from 'react';
import type { EspnLeagueSnapshot } from '../../../../shared/types';
import { requestEspnLeague } from '../../adapters/espnBridge';
import { useEspnBridge } from '../../hooks/useEspnBridge';

export interface EspnSetupTabsProps {
  /** Persists the detected league to My Leagues with the user's team pick. Resolves after the
   * write; the connect route navigates to /leagues on success. This surface SAVES ONLY — starting
   * a draft is the Draft Room launcher's job (2026-08-27 connect/start split, DECISIONS.md). */
  onSaveEspnLeague: (snapshot: EspnLeagueSnapshot, myTeamId: number | null) => Promise<void>;
  /** Persists the detected league AND imports its completed draft (2026-08-28): the capture showed
   * the league already drafted, so the user's picked team's roster is reconstructed from the
   * captured picks and written as a complete SavedDraft. Optional; rendered only when the offer
   * can be honored (snapshot.drafted + draftPicks present). */
  onImportEspnDraft?: (snapshot: EspnLeagueSnapshot, myTeamId: number | null) => Promise<void>;
}

type Detection = 'detecting' | 'timeout' | 'none' | 'found';

const STATUS_COPY: Record<string, string> = {
  'no-extension': 'Extension not detected in this browser — load it unpacked (see steps below).',
  'no-espn-tab': 'Extension detected. Open your ESPN league page to capture the league.',
  'relay-silent': 'Extension stopped responding — reload this page and the ESPN tab.',
  live: 'Extension connected.',
  stale: 'Extension connection is stale.',
  disconnected: 'Extension disconnected.',
};

/** A field that was DERIVED (roundsDerived) or DEFAULTED (nothing found at all) gets a dotted
 * underline + title tooltip — the one thing that still needs to stand out. A verified field gets
 * no marker: previously every field, verified or not, carried the same muted "read from your ESPN
 * league page" tag on every row, which was both noisy (six repeats) and undifferentiated (the
 * verified/fallback distinction didn't read visually). */
function Field({ value, derived, fallback }: { value: string; derived?: boolean; fallback?: boolean }) {
  if (!value) return <span className="league-summary-empty">—</span>;
  if (derived) {
    return <span className="field-derived" title="Derived from the captured roster size — open your league's Draft Recap tab and reconnect for an exact count.">{value}</span>;
  }
  if (fallback) {
    return <span className="field-derived" title="Not found in the captured league JSON — default shown.">{value}</span>;
  }
  return <span>{value}</span>;
}

/** Step rail state for the three-step "getting your league" flow — Extension → League page →
 * Confirm. Reuses the .onboarding-rail/.onboarding-step[data-state] pattern already proven by
 * OnboardingLayout, rather than a bespoke rail component. */
function SetupRail({ extensionPresent, detection }: { extensionPresent: boolean; detection: Detection }) {
  const extensionState = extensionPresent ? 'done' : 'current';
  const leagueState = !extensionPresent ? 'todo' : detection === 'found' ? 'done' : 'current';
  const confirmState = detection === 'found' ? 'current' : 'todo';
  return (
    <ol className="onboarding-rail" aria-label="ESPN league setup steps">
      <li className="onboarding-step" data-state={extensionState}>Extension</li>
      <li className="onboarding-step" data-state={leagueState}>League page</li>
      <li className="onboarding-step" data-state={confirmState}>Confirm</li>
    </ol>
  );
}

/**
 * ESPN connect panel (2026-08-27, rebuilt 2026-08-28): detects the user's REAL league via the
 * extension's league-page capture (`requestEspnLeague` — requires the ESPN league page open in a
 * tab) and saves it to My Leagues. CONFIRM, DON'T EDIT: every league field renders read-only; the
 * one input is "which team is yours?" (the capture redacts swid|session, so ownership cannot be
 * read from ESPN — the user picks once, from a wrapping pill list rather than a bare <select>). A
 * field that couldn't be scraped shows an honest error naming the ESPN tab to open — never a text
 * input, and there is deliberately NO manual fallback. Starting a draft happens from the Draft
 * Room launcher. 2026-08-29: the bonus-rules/parsing-details disclosures and the separate
 * "import roster" button were cut for a calmer confirm card — `snapshot.unmodeledScoringItems`/
 * `diagnostics` are still on the type and still worth surfacing on `/leagues/:id` later; `Save
 * league` alone now imports the drafted roster when `canImport` is true.
 */
export function EspnSetupTabs({ onSaveEspnLeague, onImportEspnDraft }: EspnSetupTabsProps) {
  const [tab, setTab] = useState<'connect' | 'extension'>('connect');
  const [snapshot, setSnapshot] = useState<EspnLeagueSnapshot | null>(null);
  const [detection, setDetection] = useState<Detection>('detecting');
  const [myTeamId, setMyTeamId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { extensionPresent, status } = useEspnBridge(null);
  const canImport = Boolean(snapshot?.drafted && (snapshot.draftPicks?.length ?? 0) > 0 && onImportEspnDraft);

  const detect = useCallback(async () => {
    setDetection('detecting');
    setSaveError(null);
    const response = await requestEspnLeague();
    if (response.responded && response.league) {
      setSnapshot(response.league);
      setMyTeamId('');
      setDetection('found');
    } else {
      setSnapshot(null);
      setDetection(response.responded ? 'none' : 'timeout');
    }
  }, []);

  useEffect(() => {
    void detect();
  }, [detect]);

  // Genuinely unscrapeable views get a hint naming the ESPN tab to open — a dead end is never
  // replaced with a hand-typed input.
  const views = snapshot?.views;
  const missingRosterView = Boolean(views && views.length > 0 && !views.includes('mRoster'));
  const canConfirm = Boolean(snapshot) && myTeamId !== '';

  /** One save button covers both outcomes: when the capture shows the league already drafted
   * (canImport), saving also imports the drafted roster — that offer was previously a separate,
   * competing button, which made "save my league" a two-choice question it never needed to be. */
  async function handleSave() {
    if (!snapshot || !canConfirm) return;
    const teamId = typeof myTeamId === 'number' ? myTeamId : null;
    setBusy(true);
    setSaveError(null);
    try {
      if (canImport && teamId !== null) {
        await onImportEspnDraft!(snapshot, teamId);
      } else {
        await onSaveEspnLeague(snapshot, teamId);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="provider-subtabs" role="tablist" aria-label="ESPN setup">
        <button type="button" role="tab" aria-selected={tab === 'connect'} className={tab === 'connect' ? 'active' : undefined} onClick={() => setTab('connect')}>
          Connect league
        </button>
        <button type="button" role="tab" aria-selected={tab === 'extension'} className={tab === 'extension' ? 'active' : undefined} onClick={() => setTab('extension')}>
          Extension setup
        </button>
      </div>

      <div className="provider-subtab-panel">
        {tab === 'connect' ? (
          <div className="espn-connect">
            {detection !== 'found' && <SetupRail extensionPresent={extensionPresent} detection={detection} />}

            {detection !== 'found' && (
              <p className="muted" data-testid="espn-bridge-status">
                {/* The connect flow only cares whether the extension's relay is present — the
                    live-draft heartbeat statuses (live/stale/disconnected) belong to the Draft Room
                    bridge, not here. Rendering them on this save-only panel made a successful
                    league capture read as a failure whenever no draft tab was open. */}
                {extensionPresent
                  ? 'Extension detected.'
                  : STATUS_COPY[status === 'relay-silent' ? 'relay-silent' : 'no-extension']}
              </p>
            )}

            {detection === 'detecting' && <p className="muted">Checking for your ESPN league…</p>}

            {(detection === 'timeout' || detection === 'none') && (
              <>
                <p role="alert">
                  {detection === 'timeout'
                    ? 'Could not reach the extension. Make sure it is loaded unpacked, then try again.'
                    : 'No league captured yet. Open your ESPN league page (fantasy.espn.com/football/league) in a tab, then try again.'}
                </p>
                <button type="button" onClick={() => void detect()}>Try again</button>
                <p className="muted provider-card-note">There is no manual-entry form here on purpose — league details are read from your league page, never retyped.</p>
              </>
            )}

            {detection === 'found' && snapshot && (
              <div className="espn-confirm-card">
                <div className="league-summary">
                  <p className="league-summary-title">
                    <Field value={snapshot.name || 'ESPN league'} fallback={snapshot.name === 'ESPN league'} />
                    <span
                      className="league-summary-provenance"
                      title="All fields below are read from your ESPN league page via the extension — never typed."
                    >
                      via ESPN
                    </span>
                  </p>
                  <ul className="meta-chips">
                    <li className="meta-chip">
                      <Field value={snapshot.season} fallback={!snapshot.season} />
                    </li>
                    <li className="meta-chip">
                      <Field value={snapshot.teams > 0 ? `${snapshot.teams} teams` : ''} fallback={snapshot.teams <= 0} />
                    </li>
                    <li className="meta-chip">
                      <Field
                        value={snapshot.rounds != null ? `${snapshot.rounds} rounds` : ''}
                        derived={snapshot.roundsDerived}
                        fallback={snapshot.rounds == null}
                      />
                    </li>
                    <li className="meta-chip">
                      <Field
                        value={Object.keys(snapshot.scoring).length > 0
                          ? `${snapshot.format.reception} scoring (${Object.keys(snapshot.scoring).length} categories)`
                          : ''}
                        fallback={Object.keys(snapshot.scoring).length === 0}
                      />
                    </li>
                  </ul>
                  {snapshot.startingSlots.length > 0 && (
                    <ul className="slot-pills">
                      {snapshot.startingSlots.map((slot, index) => (
                        <li key={`${slot}-${index}`} className="slot-pill" data-pos={slot.toLowerCase()}>{slot}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {missingRosterView && (
                  <p role="note" className="muted">
                    Roster data was not in this capture — open your league&apos;s Rosters tab on ESPN, then reconnect.
                  </p>
                )}

                {snapshot.teamNames.length > 0 ? (
                  <form onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
                    <p>Which team is yours?</p>
                    <div className="team-pills" role="radiogroup" aria-label="Which team is yours?">
                      {snapshot.teamNames.map((team) => (
                        <button
                          key={team.id}
                          type="button"
                          role="radio"
                          aria-checked={myTeamId === team.id}
                          className="team-pill"
                          onClick={() => setMyTeamId(team.id)}
                        >
                          {team.name}
                        </button>
                      ))}
                    </div>

                    <button type="submit" className="primary-button" disabled={!canConfirm || busy}>
                      {busy ? (canImport ? 'Importing roster…' : 'Saving…') : 'Save league'}
                    </button>
                  </form>
                ) : (
                  <p role="note" className="muted">
                    Team names were not in this capture — open your league&apos;s Rosters tab on ESPN, then reconnect.
                  </p>
                )}

                <button className="quiet-button" type="button" onClick={() => void detect()}>Scan again</button>
                {saveError && <p role="alert">{saveError}</p>}
              </div>
            )}
          </div>
        ) : (
          <>
            <ol className="provider-card-steps">
              <li>Download the <code>extension</code> folder from the project repo.</li>
              <li>
                Open <code>chrome://extensions</code>, turn on Developer mode, click &quot;Load unpacked,&quot; and
                select that folder.
              </li>
              <li>Open your ESPN league page and your ESPN live draft page in tabs — the league is captured from the league page; picks stream in from the draft page.</li>
            </ol>
            <p className="muted" data-testid="espn-bridge-status">{STATUS_COPY[status] ?? ''}</p>
          </>
        )}
      </div>
    </>
  );
}
