/**
 * Static lookalikes of the provider connect cards for the public landing — the visual promise of
 * the real flow without any of its machinery. Deliberately inert: no `<form>`, no handlers, no
 * fetch, every control `disabled`. The REAL connect flow lives at `/onboarding/league` (post-signup
 * in the target architecture); this is marketing-only, same precedent as `landingDemoPlayers.ts`.
 */

/** Sleeper card illustration: username field + resolved-user row, all disabled. */
export function SleeperIllustration() {
  return (
    <div className="connect-sleeper">
      <div>
        <label>
          Sleeper username or user ID
          <input value="" placeholder="Sleeper username" disabled />
        </label>
        <button type="button" disabled>Continue</button>
      </div>
      <p className="provider-card-copy">
        Connected as <strong>@mock_user</strong>.{' '}
      </p>
      <button type="button" disabled>Show my 2026 leagues and drafts</button>
    </div>
  );
}

/** ESPN card illustration: the setup button + extension note, all disabled. */
export function EspnIllustration() {
  return (
    <div>
      <p className="provider-card-copy">
        Set your league and draft position, then start tracking — picks stream live from your ESPN
        draft tab via the Chrome extension as soon as setup is done.
      </p>
      <button type="button" className="primary-button" disabled>Set up ESPN draft</button>
    </div>
  );
}
