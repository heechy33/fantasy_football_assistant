import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { DraftInit, PlayerId } from '../../../shared/types';

const useEspnBridgeMock = vi.fn();

vi.mock('../hooks/useEspnBridge', () => ({
  useEspnBridge: (...args: unknown[]) => useEspnBridgeMock(...args),
}));

const { DraftSessionProvider, useDraftSession } = await import('./DraftSessionProvider');

const RANKED_PLAYER_ID = 'ranked-1';
const RANKED_PLAYER_NAME = 'Ranked Test';

vi.mock('../data/loadPlayerPool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/loadPlayerPool')>();
  return {
    ...actual,
    loadRankedPlayers: () => Promise.resolve([
      // Minimal player record — `handleDraftPlayer` looks up the name from rankedPlayers.
      { playerId: RANKED_PLAYER_ID, name: RANKED_PLAYER_NAME, position: 'RB', eligiblePositions: ['RB'], team: 'BUF', byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {}, rank: 1, adp: 1.0 },
    ] as never),
  };
});

interface Captured {
  session: ReturnType<typeof useDraftSession>['session'];
  effectiveInit: DraftInit | null;
  activeProvider: string;
  boardOverridesSize: () => number;
}

function yahooInit(): DraftInit {
  // 12 teams × 5 rounds = 60 picks, slot 4 of 12. Snake order: pick 1 = slot 1, pick 12 = slot 12,
  // pick 13 = slot 12, pick 14 = slot 11, ... So pick 4 lands on slot 4 (round 1).
  return {
    provider: 'yahoo',
    draftId: 'yahoo-1',
    leagueId: 'yahoo-1',
    draftType: 'snake',
    teams: 12,
    rounds: 5,
    slotToTeam: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, String(i + 1)])),
    slotToTeamName: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, `Team ${i + 1}`])),
    myTeamId: '4',
    mySlot: 4,
    settings: {
      provider: 'yahoo',
      leagueId: 'yahoo-1',
      name: 'Yahoo Test',
      season: '2026',
      teams: 12,
      startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6 },
      scoring: { rec: 0.5, pass_yd: 0.04, pass_td: 4 },
      format: { reception: 'half-ppr', qb: 'one-qb', draft: 'snake' },
    },
  };
}

function YahooStartProbe({ captured }: { captured: { current: Partial<Captured> } }) {
  const ctx = useDraftSession();
  captured.current.session = ctx.session;
  captured.current.effectiveInit = ctx.effectiveInit;
  captured.current.activeProvider = ctx.activeProvider;
  captured.current.boardOverridesSize = () => ctx.board.state.overrides.size;
  const init = yahooInit();
  return (
    <>
      <button type="button" onClick={() => ctx.handleYahooStart(init)}>start-yahoo</button>
      <button type="button" onClick={() => ctx.handleDraftPlayer(RANKED_PLAYER_ID as PlayerId)}>click-draft</button>
    </>
  );
}

function DisconnectedProbe({ captured }: { captured: { current: Partial<Captured> } }) {
  const ctx = useDraftSession();
  captured.current.session = ctx.session;
  captured.current.activeProvider = ctx.activeProvider;
  return (
    <button type="button" onClick={() => ctx.handleDraftPlayer(RANKED_PLAYER_ID as PlayerId)}>click-draft</button>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useEspnBridgeMock.mockReturnValue({
    extensionPresent: false,
    live: null,
    init: null,
    picks: null,
    lastHeartbeatAt: null,
    dataAgeMs: null,
    status: 'no-extension' as const,
    isStale: false,
    pickError: null,
    relayWarning: null,
    seatMismatch: null,
    derivedSeat: null,
    offset: null,
  });
});

describe('DraftSessionProvider — Yahoo from-scratch + click-to-log (2026-09-01)', () => {
  it('handleYahooStart creates a kind: manual session with provider: yahoo and activeProvider: yahoo', async () => {
    const captured: { current: Partial<Captured> } = { current: {} };
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DraftSessionProvider>
          <YahooStartProbe captured={captured} />
        </DraftSessionProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByText('start-yahoo'));
    expect(captured.current.session?.kind).toBe('manual');
    if (captured.current.session?.kind === 'manual') {
      expect(captured.current.session.provider).toBe('yahoo');
    }
    expect(captured.current.activeProvider).toBe('yahoo');
  });

  it('handleDraftPlayer commits a manual-entry override for the next manual overall', async () => {
    const captured: { current: Partial<Captured> } = { current: {} };
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DraftSessionProvider>
          <YahooStartProbe captured={captured} />
        </DraftSessionProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByText('start-yahoo'));
    expect(captured.current.boardOverridesSize?.()).toBe(0);
    await user.click(screen.getByText('click-draft'));
    // After one click: one manual-entry override is on the board.
    expect(captured.current.boardOverridesSize?.()).toBe(1);
  });

  it('handleDraftPlayer is a no-op for a kind: disconnected session (no live or manual layer)', async () => {
    const captured: { current: Partial<Captured> } = { current: {} };
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DraftSessionProvider>
          <DisconnectedProbe captured={captured} />
        </DraftSessionProvider>
      </MemoryRouter>,
    );
    expect(captured.current.session?.kind).toBe('disconnected');
    // Click should not throw and should not change session state.
    await user.click(screen.getByText('click-draft'));
    expect(captured.current.session?.kind).toBe('disconnected');
  });

  it('rehydrates a saved Yahoo manual session with provider: yahoo and activeProvider: yahoo', async () => {
    localStorage.setItem('ffa.draftSession.v4', JSON.stringify({
      userId: null,
      draftId: null,
      mode: 'manual',
      overrides: [],
      frozenInit: yahooInit(),
      completedAt: null,
      from: null,
      provider: null,
      savedLeagueId: null,
    }));
    const captured: { current: Partial<Captured> } = { current: {} };
    render(
      <MemoryRouter>
        <DraftSessionProvider>
          <YahooStartProbe captured={captured} />
        </DraftSessionProvider>
      </MemoryRouter>,
    );
    expect(captured.current.session?.kind).toBe('manual');
    if (captured.current.session?.kind === 'manual') {
      expect(captured.current.session.provider).toBe('yahoo');
    }
    expect(captured.current.activeProvider).toBe('yahoo');
  });
});
