import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PollHealth } from '../hooks/useDraftPoll';
import { DataHealth } from './DataHealth';

let healthRef: { current: PollHealth };

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
  it('reads ref-backed health on its own tick and exposes a stalled poll', () => {
    render(
      <DataHealth
        manifest={null}
        effectivePicks={[]}
        isStale={false}
        dataAgeMs={null}
        consecutiveFailures={0}
        lastError={null}
        pollHealthRef={healthRef}
        adpFormat={'ppr'}
      />,
    );

    expect(screen.queryByText(/Live draft data is stale/)).toBeNull();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText(/Live draft data is stale \(3s old\)/)).toBeInTheDocument();
  });

  it('renders unmodeled-scoring diagnostics as banner items when provided', () => {
    render(
      <DataHealth
        manifest={null}
        effectivePicks={[]}
        isStale={false}
        dataAgeMs={null}
        consecutiveFailures={0}
        lastError={null}
        adpFormat={'ppr'}
        scoringDiagnostics={['Custom PPR bonuses are not modeled.']}
      />,
    );
    expect(screen.getByText('Custom PPR bonuses are not modeled.')).toBeInTheDocument();
  });

});
