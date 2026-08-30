import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftInit, DraftPicks, EspnDomPick } from '../../../shared/types';
import { __resetPlayerPoolCache } from '../data/loadPlayerPool';
import { espnAdapter } from '../adapters/espn';
import { useEspnBridge, type UseEspnBridgeResult } from './useEspnBridge';

/** A minimal ESPN bridge DraftInit — replaces the removed `buildManualDraftInit` as the test
 * base (the manual-create path is gone; bridge sessions only ever start from saved leagues). */
function espnDraftInit(leagueName: string, mySlot: number): DraftInit {
  const teams = 10;
  const slotToTeam: Record<number, string> = {};
  const slotToTeamName: Record<number, string> = {};
  for (let slot = 1; slot <= teams; slot += 1) {
    slotToTeam[slot] = String(slot);
    slotToTeamName[slot] = `Team ${slot}`;
  }
  return {
    provider: 'espn',
    draftId: 'manual-session',
    leagueId: 'espn-test',
    draftType: 'snake',
    teams,
    rounds: 14,
    slotToTeam,
    slotToTeamName,
    myTeamId: String(mySlot),
    mySlot,
    settings: {
      provider: 'espn',
      leagueId: 'espn-test',
      name: leagueName,
      season: '2026',
      teams,
      startingSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'K'],
      rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DEF: 1, K: 1, BN: 5, IR: 1 },
      scoring: { rec: 1, pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6 },
      format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
    },
  };
}

const BASE: DraftInit = espnDraftInit('LeAgUe', 2);

const { requestEspnSnapshotMock, requestEspnDraftLeagueMock } = vi.hoisted(() => ({
  requestEspnSnapshotMock: vi.fn(),
  // Draft-league settings poll (2026-08-29) — a separate relay round trip on its own cadence,
  // orthogonal to every test in this file (none of them exercise `detectedLeague`). Defaults to
  // "never responds" so it never flips `detectedLeague` away from null underneath an assertion.
  requestEspnDraftLeagueMock: vi.fn().mockResolvedValue({ responded: false, league: null }),
}));
vi.mock('../adapters/espnBridge', () => ({
  requestEspnSnapshot: requestEspnSnapshotMock,
  requestEspnDraftLeague: requestEspnDraftLeagueMock,
}));

let probe: UseEspnBridgeResult | null = null;
function BridgeProbe({ base }: { base: DraftInit | null }) {
  probe = useEspnBridge(base);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  requestEspnSnapshotMock.mockReset();
  requestEspnDraftLeagueMock.mockReset().mockResolvedValue({ responded: false, league: null });
  // Every bridge session with a non-null base resolves `picks` via espnAdapter.picks() ->
  // loadPlayerPool() -> fetch('/data/players.json'); stub it to an empty pool so that resolution
  // settles deterministically instead of depending on jsdom's real-fetch behavior.
  __resetPlayerPoolCache();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
  probe = null;
});

describe('useEspnBridge', () => {
  it('reports no-extension when the relay never responds', async () => {
    requestEspnSnapshotMock.mockResolvedValue({ responded: false, live: null });
    render(createElement(BridgeProbe, { base: BASE }));
    await act(async () => {});
    expect(probe?.status).toBe('no-extension');
    expect(probe?.extensionPresent).toBe(false);

    // Stays no-extension across further polls, not flickering to anything else.
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(probe?.status).toBe('no-extension');
  });

  it('reports no-espn-tab once the extension answers but has no live snapshot yet', async () => {
    requestEspnSnapshotMock.mockResolvedValue({ responded: true, live: null });
    render(createElement(BridgeProbe, { base: BASE }));
    await act(async () => {});
    expect(probe?.extensionPresent).toBe(true);
    expect(probe?.status).toBe('no-espn-tab');
  });

  it('is live within 10s of the last heartbeat, stale past 10s, disconnected past 15s', async () => {
    const heartbeatAt = Date.now();
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: { schemaVersion: 1, streamPicks: [], mySlot: 2, leagueId: 'L1', lastHeartbeatAt: heartbeatAt },
    });
    render(createElement(BridgeProbe, { base: BASE }));
    await act(async () => {});
    expect(probe?.status).toBe('live');
    expect(probe?.isStale).toBe(false);

    // Advance well past the 10s stale threshold (with margin past the 1s poll cadence so the
    // boundary tick has actually landed, not just the fake clock).
    await act(async () => { await vi.advanceTimersByTimeAsync(11000); });
    expect(probe?.status).toBe('stale');
    expect(probe?.isStale).toBe(true);

    // Advance well past the 15s disconnected threshold.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(probe?.status).toBe('disconnected');
    expect(probe?.isStale).toBe(true);
  });

  it('polls unconditionally even with no active session (base: null) so a connect screen can show status', async () => {
    requestEspnSnapshotMock.mockResolvedValue({ responded: true, live: null });
    render(createElement(BridgeProbe, { base: null }));
    await act(async () => {});
    expect(requestEspnSnapshotMock).toHaveBeenCalled();
    // No base -> no DraftInit to merge into, so init/picks resolution never runs.
    expect(probe?.init).toBeNull();
    expect(probe?.picks).toBeNull();
  });

  it('reports a seat mismatch when the ESPN team\'s derived position disagrees with the typed slot', async () => {
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: {
        schemaVersion: 2,
        streamPicks: [
          { overall: 1, slot: 10, playerId: '11111' },
          { overall: 2, slot: 7, playerId: '22222' },
        ],
        mySlot: 7, // ESPN team 7
        leagueId: 'L1',
        lastHeartbeatAt: Date.now(),
        domMaxAtStreamStart: 0, // attached from pick 1 -> offset 0, so the order can confirm
        domSampledBeforeStream: true,
      },
    });
    // base.mySlot = 7, but team 7 drafts 2nd in the stream's order -> the guard fires.
    render(createElement(BridgeProbe, { base: espnDraftInit('LeAgUe', 7) }));
    await act(async () => {});
    expect(probe?.seatMismatch).toContain('position 2');
  });

  it('keeps init/picks referential identity across a heartbeat-only tick, and changes it when a new stream pick arrives (D1 regression guard)', async () => {
    const streamPicksV1 = [
      { overall: 1, slot: 10, playerId: '11111' },
      { overall: 2, slot: 7, playerId: '22222' },
    ];
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: { schemaVersion: 2, streamPicks: streamPicksV1, mySlot: 7, leagueId: 'L1', lastHeartbeatAt: Date.now() },
    });
    render(createElement(BridgeProbe, { base: BASE }));
    await act(async () => {});
    const initAfterFirstTick = probe?.init;
    const picksAfterFirstTick = probe?.picks;
    const heartbeatAfterFirstTick = probe?.live?.lastHeartbeatAt;
    expect(initAfterFirstTick).not.toBeNull();

    // Next poll: same streamPicks length/content, only lastHeartbeatAt (and thus `live`'s object
    // identity) changes — this is the ~1s CLOCK-frame case that must NOT re-trigger the engine.
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: { schemaVersion: 2, streamPicks: [...streamPicksV1], mySlot: 7, leagueId: 'L1', lastHeartbeatAt: Date.now() + 1000 },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    // `live` itself did get a new heartbeat (proves the memo test below isn't vacuous)...
    expect(probe?.live?.lastHeartbeatAt).not.toBe(heartbeatAfterFirstTick);
    // ...but init/picks stayed referentially stable across it.
    expect(probe?.init).toBe(initAfterFirstTick);
    expect(probe?.picks).toBe(picksAfterFirstTick);

    // A real new pick must still invalidate the memo.
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: {
        schemaVersion: 2,
        streamPicks: [...streamPicksV1, { overall: 3, slot: 9, playerId: '33333' }],
        mySlot: 7,
        leagueId: 'L1',
        lastHeartbeatAt: Date.now() + 2000,
      },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => {}); // flush the async espnAdapter.picks() resolution
    expect(probe?.init).not.toBe(initAfterFirstTick);
    expect(probe?.picks?.picks.length).toBe(3);
  });

  it('invalidates init/picks when a DOM row for an EXISTING pickNumber changes text (same count and max — D1 domPicks-content gap)', async () => {
    // Baseline: one stream pick + one DOM row whose text is not yet parseable (a row captured
    // mid-render before its position token exists, say).
    const domRow = (text: string): EspnDomPick[] => [{ pickNumber: 1, text, segments: [] }];
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: {
        schemaVersion: 2,
        streamPicks: [{ overall: 1, slot: 5, playerId: 'unmatched-id' }],
        domPicks: domRow('1garbage-not-parseable'),
        mySlot: 7,
        leagueId: 'L1',
        lastHeartbeatAt: Date.now(),
        domMaxAtStreamStart: 0, // attached from pick 1 -> offset 0, so attribution can resolve
        domSampledBeforeStream: true,
      },
    });
    render(createElement(BridgeProbe, { base: BASE }));
    await act(async () => {});
    const initV1 = probe?.init;
    const picksV1 = probe?.picks;
    const heartbeatV1 = probe?.live?.lastHeartbeatAt;
    expect(probe?.picks?.picks[0]?.providerPlayerName).toBeUndefined();

    // Heartbeat-only tick: same row content (the extension hands back a freshly-sorted array with
    // identical text), only lastHeartbeatAt changes -> the memo must hold.
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: {
        schemaVersion: 2,
        streamPicks: [{ overall: 1, slot: 5, playerId: 'unmatched-id' }],
        domPicks: domRow('1garbage-not-parseable'),
        mySlot: 7,
        leagueId: 'L1',
        lastHeartbeatAt: Date.now() + 1000,
        domMaxAtStreamStart: 0,
        domSampledBeforeStream: true,
      },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    // `live` itself did get a fresh heartbeat (proves the assertions below aren't vacuous)...
    expect(probe?.live?.lastHeartbeatAt).not.toBe(heartbeatV1);
    expect(probe?.init).toBe(initV1);
    expect(probe?.picks).toBe(picksV1);

    // Same pickNumber, same row count, same max pick number — but the row text is now parseable
    // (the exact D/ST-style enrichment case Step B depends on). This MUST invalidate the memo:
    // init re-enriches slotToTeamName and picks re-resolve with the DOM name.
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: {
        schemaVersion: 2,
        streamPicks: [{ overall: 1, slot: 5, playerId: 'unmatched-id' }],
        domPicks: domRow('1Commanders D/STWSHD/STMy Squad2'),
        mySlot: 7,
        leagueId: 'L1',
        lastHeartbeatAt: Date.now() + 2000,
        domMaxAtStreamStart: 0,
        domSampledBeforeStream: true,
      },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => {}); // flush the async espnAdapter.picks() resolution
    expect(probe?.init).not.toBe(initV1);
    expect(probe?.picks).not.toBe(picksV1);
    expect(probe?.picks?.picks[0]?.providerPlayerName).toBe('Commanders D/ST');
  });

  it('reports relay-silent (not no-extension) when the relay stops answering after delivering a snapshot', async () => {
    // The relay answered and delivered a live snapshot at least once...
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: { schemaVersion: 2, streamPicks: [], mySlot: 2, leagueId: 'L1', lastHeartbeatAt: Date.now() },
    });
    render(createElement(BridgeProbe, { base: BASE }));
    await act(async () => {});
    expect(probe?.status).toBe('live');

    // ...then goes silent (e.g. the unpacked extension was reloaded). This must read as
    // 'relay-silent', with a "reload both tabs" fix, not 'no-extension' ("install the extension").
    requestEspnSnapshotMock.mockResolvedValue({ responded: false, live: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(probe?.status).toBe('relay-silent');
    expect(probe?.extensionPresent).toBe(false);
  });

  it('clears the held live snapshot when the relay responds with no ESPN tab (does not keep showing a stale one)', async () => {
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: { schemaVersion: 2, streamPicks: [{ overall: 1, slot: 5, playerId: '11111' }], mySlot: 2, leagueId: 'L1', lastHeartbeatAt: Date.now() },
    });
    render(createElement(BridgeProbe, { base: BASE }));
    await act(async () => {});
    expect(probe?.live?.streamPicks.length).toBe(1);

    // The ESPN tab is closed — the relay is still there, but has nothing to report.
    requestEspnSnapshotMock.mockResolvedValue({ responded: true, live: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(probe?.status).toBe('no-espn-tab');
    expect(probe?.live).toBeNull();
  });

  it('does not let a healthy relay poll clear a real pick-resolution error, and clears it only on a subsequent successful resolution (D2/relayWarning-vs-pickError split)', async () => {
    const picksSpy = vi.spyOn(espnAdapter, 'picks');
    const okResult: DraftPicks = { status: 'drafting', picks: [], onTheClock: null, fetchedAt: Date.now() };
    // The mount-time resolution (before any relay snapshot lands — material is still null) resolves
    // with an empty board; the rejection is for the first real stream-backed resolution, which is the
    // one this test is about.
    picksSpy.mockResolvedValueOnce(okResult);
    picksSpy.mockRejectedValueOnce(new Error('crosswalk load failed'));
    picksSpy.mockResolvedValue(okResult);

    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: { schemaVersion: 2, streamPicks: [{ overall: 1, slot: 5, playerId: '11111' }], mySlot: 2, leagueId: 'L1', lastHeartbeatAt: Date.now() },
    });
    render(createElement(BridgeProbe, { base: BASE }));
    await act(async () => {}); // first pick resolution rejects
    expect(probe?.pickError).toBe('crosswalk load failed');

    // A healthy heartbeat-only relay tick (same streamPicks, only lastHeartbeatAt changes) must not
    // touch pickError — the `material` memo holds, so the pick-resolution effect doesn't even rerun.
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: { schemaVersion: 2, streamPicks: [{ overall: 1, slot: 5, playerId: '11111' }], mySlot: 2, leagueId: 'L1', lastHeartbeatAt: Date.now() + 1000 },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(probe?.pickError).toBe('crosswalk load failed');

    // A real new pick re-runs pick resolution, which now succeeds and clears the error.
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: {
        schemaVersion: 2,
        streamPicks: [{ overall: 1, slot: 5, playerId: '11111' }, { overall: 2, slot: 6, playerId: '22222' }],
        mySlot: 2,
        leagueId: 'L1',
        lastHeartbeatAt: Date.now() + 2000,
      },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => {});
    expect(probe?.pickError).toBeNull();

    picksSpy.mockRestore();
  });

  it('is silent on the seat cross-check when the typed position matches', async () => {
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: {
        schemaVersion: 2,
        streamPicks: [
          { overall: 1, slot: 10, playerId: '11111' },
          { overall: 2, slot: 7, playerId: '22222' },
        ],
        mySlot: 7, // ESPN team 7 = position 2
        leagueId: 'L1',
        lastHeartbeatAt: Date.now(),
      },
    });
    render(createElement(BridgeProbe, { base: BASE })); // BASE.mySlot = 2
    await act(async () => {});
    expect(probe?.seatMismatch).toBeNull();
  });

  it('follows a clean league switch (epoch bump) silently, and warns only on a dirty merge without one', async () => {
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: { schemaVersion: 2, epoch: 0, streamPicks: [{ overall: 1, slot: 5, playerId: '11111' }], mySlot: 2, leagueId: 'L1', lastHeartbeatAt: Date.now() },
    });
    render(createElement(BridgeProbe, { base: BASE }));
    await act(async () => {});
    expect(probe?.live?.leagueId).toBe('L1');
    expect(probe?.relayWarning).toBeNull();

    // Extension reset for a new league: epoch bumped, streamPicks reset. Follow silently.
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: { schemaVersion: 2, epoch: 1, streamPicks: [{ overall: 1, slot: 9, playerId: '99999' }], mySlot: 2, leagueId: 'L2', lastHeartbeatAt: Date.now() + 1000 },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(probe?.relayWarning).toBeNull();
    expect(probe?.live?.leagueId).toBe('L2');
    expect(probe?.init?.leagueId).toBe('L2');

    // Dirty merge: league changed but epoch did NOT bump (the extension could not reset). Warn.
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: {
        schemaVersion: 2,
        epoch: 1,
        streamPicks: [
          { overall: 1, slot: 9, playerId: '99999' },
          { overall: 2, slot: 3, playerId: '33333' },
        ],
        mySlot: 2,
        leagueId: 'L3',
        lastHeartbeatAt: Date.now() + 2000,
      },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(probe?.relayWarning).toContain('league id changed mid-session');
  });

  it('resets the pinned league on a new base, so a same-tab restart never inherits the old pin', async () => {
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: { schemaVersion: 2, epoch: 0, streamPicks: [], mySlot: 2, leagueId: 'L1', lastHeartbeatAt: Date.now() },
    });
    const { rerender } = render(createElement(BridgeProbe, { base: BASE }));
    await act(async () => {});
    expect(probe?.live?.leagueId).toBe('L1');
    expect(probe?.relayWarning).toBeNull();

    // The user starts a new ESPN session (new base) for a mock the extension has already switched
    // to. The pin reset on base change must make this a silent re-pin, not a warning.
    requestEspnSnapshotMock.mockResolvedValue({
      responded: true,
      live: { schemaVersion: 2, epoch: 1, streamPicks: [], mySlot: 2, leagueId: 'L2', lastHeartbeatAt: Date.now() + 1000 },
    });
    await act(async () => {
      rerender(createElement(BridgeProbe, { base: espnDraftInit('LeAgUe2', 2) }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(probe?.live?.leagueId).toBe('L2');
    expect(probe?.relayWarning).toBeNull();
  });
});
