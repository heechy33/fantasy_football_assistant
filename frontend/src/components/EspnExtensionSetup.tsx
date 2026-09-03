/**
 * The ESPN extension's download + install steps — extracted from routes/onboarding/EspnSetupTabs
 * (2026-08-30) so the exact same instructions can render in the Draft Room launcher's ESPN column
 * too, not just /leagues/connect's "Extension setup" tab. Purely static content, no props.
 */
export function EspnExtensionSetup() {
  return (
    <>
      <a className="espn-download-button" href="/extension.zip" download="ffa-extension.zip">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v11" />
          <path d="M6.5 10.5 12 16l5.5-5.5" />
          <path d="M4 21h16" />
        </svg>
        Download extension
      </a>
      <p className="muted">Unzip it somewhere you can find it (e.g. your Downloads folder), then follow the steps below.</p>
      <ol className="provider-card-steps">
        <li>
          Go to <code>chrome://extensions</code> → toggle <strong>Developer mode</strong> (top-right corner) →
          click <strong>Load unpacked</strong> (top-left corner) → select the unzipped <code>extension</code> folder.
        </li>
        <li>Open your ESPN league page and your ESPN live draft page in tabs — the league is captured from the league page; picks stream in from the draft page.</li>
      </ol>
    </>
  );
}
