import type { AdpFormat } from '../data/loadPlayerPool';

export const APP_NAME = 'Fantasy Assistant Bob';

export type AppPage = 'home' | 'draft' | 'teams';

export interface TopNavProps {
  active: AppPage;
  onNavigate: (page: AppPage) => void;
  /** `round.pick` hero label (e.g. `4.09`) — rendered only when a draft is loaded. */
  roundPick?: string | null;
  /** Picks remaining until the user's next decision (`0` = on the clock). `null` hides the chip. */
  picksUntilUserTurn?: number | null;
  /** Session-level control, owned by `App` (was CommandBar's gate). Omit to hide the button. */
  onChooseAnotherDraft?: () => void;
  /** Status subline: league name + active ADP format + a freshness dot. */
  leagueName?: string | null;
  adpFormat?: AdpFormat | null;
  isStale?: boolean;
  dataAgeMs?: number | null;
}

const NAV_ITEMS: ReadonlyArray<{ page: AppPage; label: string }> = [
  { page: 'home', label: 'Home' },
  { page: 'draft', label: 'Draft Room' },
  { page: 'teams', label: 'Teams' },
];

/**
 * Persistent top nav + session controls for the app shell — one seamless navy bar (CommandBar
 * folded in) that leads with the live `round.pick` hero and keeps every session control in the
 * same strip. No router — the app is a single screen, so navigation is a lifted `page` state in
 * App and buttons here (plain state switching keeps the zero-dependency, $0/month posture).
 */
export function TopNav({
  active,
  onNavigate,
  roundPick = null,
  picksUntilUserTurn = null,
  onChooseAnotherDraft,
  leagueName = null,
  adpFormat = null,
  isStale = false,
  dataAgeMs = null,
}: TopNavProps) {
  const showCountdown = picksUntilUserTurn != null && picksUntilUserTurn > 0;
  const showStatus = roundPick != null && (leagueName != null || adpFormat != null);

  return (
    <header className="top-nav">
      {roundPick != null && (
        <div className="top-nav-hero">
          <span className="top-nav-hero-label">Round</span>
          <strong className="top-nav-hero-pick">{roundPick}</strong>
          {showCountdown && (
            <span className="top-nav-countdown">{picksUntilUserTurn} until your turn</span>
          )}
        </div>
      )}

      <div className="top-nav-cluster">
        <div className="top-nav-bar-row">
          <h1 className="brand">
            <button
              type="button"
              className="brand-button"
              onClick={() => onNavigate('home')}
              aria-label={`${APP_NAME} — go to Home`}
            >
              {APP_NAME}
            </button>
          </h1>
          <nav aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.page}
                type="button"
                className="nav-link"
                aria-current={active === item.page ? 'page' : undefined}
                onClick={() => onNavigate(item.page)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        {showStatus && (
          <p className="top-nav-status">
            <span
              className="top-nav-status-dot"
              data-stale={isStale || undefined}
              aria-hidden="true"
            />
            Synced with {leagueName ?? 'draft'} · ADP {adpFormat}
            {isStale && dataAgeMs != null ? ` · ${Math.round(dataAgeMs / 1000)}s stale` : ''}
          </p>
        )}
      </div>

      {onChooseAnotherDraft && (
        <div className="top-nav-actions">
          <button type="button" className="chrome-outline-button" onClick={onChooseAnotherDraft}>
            Choose another draft
          </button>
        </div>
      )}
    </header>
  );
}
