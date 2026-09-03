import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataManifest } from '../../../shared/types';
import type { PollHealth } from '../hooks/useDraftPoll';
import { DataHealth } from './DataHealth';

let healthRef: { current: PollHealth };

function okSource(fetchedAt: string, extra: Record<string, unknown> = {}) {
  return { url: 'x', rows: 1, fetchedAt, schemaVersion: 3, status: 'ok' as const, ...extra };
}

function manifestWith(sources: Record<string, unknown>): DataManifest {
  return {
    builtAt: '2026-08-14T00:00:00Z', season: '2026', week: null,
    sources: sources as DataManifest['sources'],
    crosswalk: { totalPlayers: 0, top300MatchRate: 0, unmatchedTop300: [] },
  };
}

function renderHealth(props: Partial<Parameters<typeof DataHealth>[0]> = {}) {
  return render(
    <DataHealth
      manifest={null}
      effectivePicks={[]}
      isStale={false}
      dataAgeMs={null}
      consecutiveFailures={0}
      lastError={null}
      pollHealthRef={healthRef}
      adpFormat="ppr"
      activeProvider="sleeper"
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
  healthRef = {
    current: {
      lastSuccessfulPollAt: Date.now(),
      lastChangedAt: Date.now(),
      lastHttpStatus: 200,
      retryAt: null,
      requestDurationMs: 20,
      consecutiveFailures: 0,
      lastError: null,
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('DataHealth', () => {
  it('renders no health banner when healthy — no permanent "Data healthy" line (2026-08-30)', () => {
    // The freshness disclosure below is unconditional (like EspnCapturePanel) and does render here
    // — this test only asserts the absence of the WARNING banner, not of every child.
    const { container } = renderHealth({
      manifest: manifestWith({
        fftoday_projections: okSource('2026-08-14T00:00:00Z'),
        adp_active_ppr: okSource('2026-08-14T00:00:00Z', { activeAdpSource: 'sleeper' }),
      }),
    });
    expect(screen.queryByText(/Data healthy/)).toBeNull();
    expect(container.querySelector('.data-health')).toBeNull();
  });

  it('reads ref-backed health on its own tick and exposes a stalled poll', () => {
    renderHealth();

    expect(screen.queryByText(/Live draft data is stale/)).toBeNull();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText(/Live draft data is stale \(3s old\)/)).toBeInTheDocument();
  });

  it('renders unmodeled-scoring diagnostics as banner items when provided', () => {
    renderHealth({ scoringDiagnostics: ['Custom PPR bonuses are not modeled.'] });
    expect(screen.getByText('Custom PPR bonuses are not modeled.')).toBeInTheDocument();
  });

  it('resolves health against adp_active_espn_ppr on an ESPN PPR session whose board shipped', () => {
    renderHealth({
      manifest: manifestWith({
        fftoday_projections: okSource('2026-08-14T00:00:00Z'),
        adp_active_ppr: okSource('2026-08-14T00:00:00Z', { activeAdpSource: 'sleeper' }),
        adp_active_espn_ppr: okSource('2026-08-14T00:00:00Z', { activeAdpSource: 'espn' }),
      }),
      activeProvider: 'espn',
    });
    expect(screen.queryByText(/Data health warning/)).not.toBeInTheDocument();
  });

  it('keeps the plain adp_active_ppr key when the ESPN board did not ship (fail-open fallback)', () => {
    renderHealth({
      manifest: manifestWith({
        fftoday_projections: okSource('2026-08-14T00:00:00Z'),
        adp_active_ppr: okSource('2026-08-14T00:00:00Z', { activeAdpSource: 'sleeper' }),
        espn_adp_ppr: { url: 'x', rows: 0, fetchedAt: '2026-08-14T00:00:00Z', schemaVersion: 3, status: 'error', diagnostic: 'offline' },
      }),
      activeProvider: 'espn',
    });
    expect(screen.queryByText(/Data health warning/)).not.toBeInTheDocument();
  });

  describe('freshness disclosure', () => {
    it('shows per-lane age, the active ADP source, and its pooled window when present', () => {
      renderHealth({
        manifest: manifestWith({
          sleeper_players: okSource('2026-08-14T09:00:00Z'),
          fftoday_projections: okSource('2026-08-14T09:00:00Z', { upstreamUpdatedAt: '8/11/2026' }),
          adp_active_ppr: okSource('2026-08-14T09:00:00Z', {
            activeAdpSource: 'ffc-fallback',
            freshnessWindow: { mockDrafts: 8161, startDate: '2026-08-07', endDate: '2026-08-14' },
          }),
        }),
      });
      expect(screen.getByText('Data freshness')).toBeInTheDocument();
      expect(screen.getByText(/FFC \(fallback\), 3\.0h ago/)).toBeInTheDocument();
      expect(screen.getByText(/pooled average, 2026-08-07 to 2026-08-14 \(8,161 drafts\)/)).toBeInTheDocument();
      expect(screen.getByText(/3\.0h ago, upstream dated 8\/11\/2026/)).toBeInTheDocument();
    });

    it('discloses an unpublished window honestly instead of hiding the gap', () => {
      renderHealth({
        manifest: manifestWith({
          adp_active_ppr: okSource('2026-08-14T09:00:00Z', { activeAdpSource: 'sleeper', freshnessWindow: null }),
        }),
      });
      expect(screen.getByText(/window unpublished/)).toBeInTheDocument();
    });

    it('shows the Underdog display-only lane only when the manifest carries it', () => {
      const { rerender } = renderHealth({ manifest: manifestWith({}) });
      expect(screen.queryByText(/Underdog market ADP/)).toBeNull();

      rerender(
        <DataHealth
          manifest={manifestWith({ underdog_bestball: okSource('2026-08-14T09:00:00Z', { upstreamUpdatedAt: 'August 12' }) })}
          effectivePicks={[]}
          isStale={false}
          dataAgeMs={null}
          consecutiveFailures={0}
          lastError={null}
          pollHealthRef={healthRef}
          adpFormat="ppr"
          activeProvider="sleeper"
        />,
      );
      expect(screen.getByText(/Underdog market ADP/)).toBeInTheDocument();
      expect(screen.getByText(/upstream dated August 12/)).toBeInTheDocument();
    });

    it('does not render the panel when there is no manifest', () => {
      const { container } = renderHealth({ manifest: null });
      expect(container.querySelector('.data-health-freshness')).toBeNull();
    });
  });
});
