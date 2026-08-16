import { useEffect, useState, type RefObject } from 'react';
import type { AdpFormat } from '../data/loadPlayerPool';
import { computeStaleness, type PollHealth } from '../hooks/useDraftPoll';
import { ProviderBadge } from './ProviderBadge';

export const APP_NAME = 'Fantasy Bob';

export type AppPage = 'home' | 'draft' | 'teams';

export interface TopNavProps {
  active: AppPage;
  onNavigate: (page: AppPage) => void;
  /** Status subline: league name + active ADP format + a freshness dot. Rendered top-right; the
   * round/pick clock and the session `⋯` menu live elsewhere now (the draft log's clock banner and
   * next to the board's card/row toggle, respectively) so this row is status-only. */
  leagueName?: string | null;
  adpFormat?: AdpFormat | null;
  isStale?: boolean;
  dataAgeMs?: number | null;
  pollHealthRef?: RefObject<PollHealth> | null;
  /** Brand key for the status pill's provider chip ('espn' | 'sleeper'); null/'manual' shows a
   * plain text pill instead. */
  statusProvider?: string | null;
  /** Effective pick count, appended to the status pill (e.g. "· 29 picks"). */
  pickCount?: number | null;
}

const NAV_ITEMS: ReadonlyArray<{ page: AppPage; label: string }> = [
  { page: 'home', label: 'Home' },
  { page: 'draft', label: 'Draft Room' },
  { page: 'teams', label: 'Teams' },
];

function StaleStatus({ healthRef, fallbackIsStale, fallbackDataAgeMs }: {
  healthRef: RefObject<PollHealth> | null;
  fallbackIsStale: boolean;
  fallbackDataAgeMs: number | null;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (healthRef == null) return;
    const id = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [healthRef]);
  const freshness = healthRef == null
    ? { isStale: fallbackIsStale, dataAgeMs: fallbackDataAgeMs }
    : computeStaleness(healthRef.current.lastSuccessfulPollAt, 2000, Date.now());
  return (
    <>
      <span className={'top-nav-status-dot'} data-stale={freshness.isStale || undefined} aria-hidden={true} />
      {freshness.isStale && freshness.dataAgeMs != null ? ` · ${Math.round(freshness.dataAgeMs / 1000)}s stale` : ''}
    </>
  );
}

/**
 * Two-tier app shell header. The identity row (brand + Home/Draft Room/Teams tabs) is always
 * present. The status row (league/ADP/pick-count pill, top-right) renders only when the caller
 * supplies draft state — `App` only passes `leagueName`/`adpFormat`/etc while `page === 'draft'`,
 * so Home gets brand+nav and nothing else. No router — the app is a single screen, so navigation
 * is a lifted `page` state in App and buttons here.
 */
export function TopNav({
  active,
  onNavigate,
  leagueName = null,
  adpFormat = null,
  isStale = false,
  dataAgeMs = null,
  pollHealthRef = null,
  statusProvider = null,
  pickCount = null,
}: TopNavProps) {
  const showStatus = leagueName != null || adpFormat != null;
  const providerBadgeKey = statusProvider === 'espn' || statusProvider === 'sleeper' ? statusProvider : null;

  return (
    <header className="top-nav">
      <div className="top-nav-identity">
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
        <div className="top-nav-live">
          <p className="session-pill">
            {providerBadgeKey && <ProviderBadge brandKey={providerBadgeKey} size="sm" />}
            <StaleStatus healthRef={pollHealthRef} fallbackIsStale={isStale} fallbackDataAgeMs={dataAgeMs} />
            <span className="session-pill-text">
              {leagueName ?? 'draft'} · ADP {adpFormat}
              {pickCount != null ? ` · ${pickCount} pick${pickCount === 1 ? '' : 's'}` : ''}
            </span>
          </p>
        </div>
      )}
    </header>
  );
}
