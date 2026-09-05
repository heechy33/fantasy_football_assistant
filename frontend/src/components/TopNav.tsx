import { useEffect, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { computeStaleness, type PollHealth } from '../hooks/useDraftPoll';
import { providerBrand } from '../data/providerBrand';
import { ProviderBadge } from './ProviderBadge';
import fantasyBobMark from '../assets/brand/fantasy-bob-mark.png';

export const APP_NAME = 'Fantasy Bob';

export type AppPage = 'home' | 'guide' | 'draft' | 'leagues';

/** Page → path, owned here since the tabs became real links (Phase 3's deferred conversion:
 * public pages need middle-click/open-in-new-tab nav targets). */
const PATH_BY_PAGE: Readonly<Record<AppPage, string>> = {
  home: '/',
  guide: '/draft-guide',
  draft: '/draft',
  leagues: '/leagues',
};

export interface TopNavProps {
  active: AppPage;
  /** Connection-status pill, rendered top-right (2026-09-01 redesign): a blinking status dot,
   * THEN the provider logo, then "<Provider> connected" — the old league-name/ADP/pick-count text
   * is gone (the draft room's own header owns that detail). The stale suffix ("· Ns stale")
   * survives as an honesty marker. The round/pick clock and the session `⋯` menu live elsewhere
   * now (the draft log's clock banner and next to the board's card/row toggle, respectively). */
  isStale?: boolean;
  dataAgeMs?: number | null;
  pollHealthRef?: RefObject<PollHealth> | null;
  /** Brand key for the status pill's provider chip ('espn' | 'sleeper' | 'yahoo'); null shows nothing. */
  statusProvider?: string | null;
  /** True while the caller is on the Draft Room with NO live provider — renders the red blinking
   * "Disconnected" pill instead of a provider chip. */
  showDisconnected?: boolean;
  /** Home renders the landing's cinematic scene; the bar dissolves into it (fading scrim)
   * instead of sitting as a solid slab above it. */
  immersive?: boolean;
  /** True once the active AuthAdapter reports a signed-in user (Phase 4's `useAuth()`, wired by
   * AppLayout). While false, account tabs (Draft Room, My Leagues) stay hidden and Sign in / Sign up
   * links render instead — the app reads as a public marketing landing. */
  authenticated?: boolean;
  /** Sign-out handler, present only while authenticated. Optional so TopNav still renders sanely
   * in tests/stories that pass `authenticated: true` without wiring a real auth context. */
  onSignOut?: () => void;
}

const PUBLIC_NAV_ITEMS: ReadonlyArray<{ page: AppPage; label: string }> = [
  { page: 'home', label: 'Home' },
  { page: 'guide', label: 'Draft Guide' },
];

/** Account features — hidden entirely while signed out so they read as gated, matching the
 * public/marketing-first flow (`DECISIONS.md`, 2026-08-25's public/gated split). */
const PRIVATE_NAV_ITEMS: ReadonlyArray<{ page: AppPage; label: string }> = [
  { page: 'draft', label: 'Draft Room' },
  { page: 'leagues', label: 'My Leagues' },
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
 * Two-tier app shell header. The identity row (brand + page tabs; placeholder Sign in / Sign up
 * CTAs replace the account tabs while signed out) is always present. The status row
 * (league/ADP/pick-count pill, top-right) renders only when the caller supplies draft state —
 * `AppLayout` only passes `leagueName`/`adpFormat`/etc on `/draft`, so other routes get brand+nav
 * and nothing else. Tabs and the brand are real `<Link>`s (middle-click/open-in-new-tab works,
 * including on the public pages); `aria-current="page"` marks the active tab.
 */
export function TopNav({
  active,
  isStale = false,
  dataAgeMs = null,
  pollHealthRef = null,
  statusProvider = null,
  showDisconnected = false,
  immersive = false,
  authenticated = false,
  onSignOut,
}: TopNavProps) {
  const providerBadgeKey = statusProvider === 'espn' || statusProvider === 'sleeper' || statusProvider === 'yahoo' ? statusProvider : null;
  const showStatus = providerBadgeKey != null || showDisconnected;

  return (
    <header className={immersive ? 'top-nav top-nav-immersive' : 'top-nav'}>
      <div className="top-nav-identity">
        <h1 className="brand">
          <Link to={PATH_BY_PAGE.home} className="brand-button" aria-label={`${APP_NAME} — go to Home`}>
            <img
              className="brand-mark"
              src={fantasyBobMark}
              alt=""
              width={28}
              height={28}
              aria-hidden="true"
            />
            {APP_NAME}
          </Link>
        </h1>
        {/* Signed-in nav shows public + account tabs; signed out, only the public surface so
            Draft Room / My Leagues still read as gated account features. */}
        <nav aria-label="Primary">
          {(authenticated ? [...PUBLIC_NAV_ITEMS, ...PRIVATE_NAV_ITEMS] : PUBLIC_NAV_ITEMS).map((item) => (
            <Link
              key={item.page}
              to={PATH_BY_PAGE[item.page]}
              className="nav-link"
              aria-current={active === item.page ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {/* Real auth CTA (Phase 4) — Link, not button, so the destination gets normal link
            semantics (middle-click, open-in-new-tab) like the rest of this nav. One CTA only:
            sign-up doubles as sign-in (2026-09-01 — the separate Sign in link was redundant). */}
        {!authenticated && (
          <div className="top-nav-auth">
            <Link to="/sign-up" className="primary-button nav-auth-signup">Sign up</Link>
          </div>
        )}
        {(showStatus || (authenticated && onSignOut)) && (
          <div className="top-nav-auth">
            {showStatus && (
              <p className="session-pill" data-state={providerBadgeKey ? 'connected' : 'disconnected'}>
                {providerBadgeKey ? (
                  <>
                    {/* Blinker first, then the logo, then the label — the connection story reads
                        left to right: live dot → whose connection → state. */}
                    <StaleStatus healthRef={pollHealthRef} fallbackIsStale={isStale} fallbackDataAgeMs={dataAgeMs} />
                    <ProviderBadge brandKey={providerBadgeKey} size="sm" />
                    <span className="session-pill-text">
                      {providerBrand(providerBadgeKey)?.label ?? providerBadgeKey} {providerBadgeKey === 'yahoo' ? 'manual' : 'connected'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="top-nav-status-dot" data-disconnected="true" aria-hidden={true} />
                    <span className="session-pill-text">Disconnected</span>
                  </>
                )}
              </p>
            )}
            {authenticated && onSignOut && (
              <button type="button" className="nav-auth-signin" onClick={onSignOut}>Sign out</button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
