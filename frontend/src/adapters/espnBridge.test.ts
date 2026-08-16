import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestEspnSnapshot } from './espnBridge';

const REQUEST = 'ffa.espn.snapshot.request';
const RESPONSE = 'ffa.espn.snapshot.response';

let postMessageSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // requestEspnSnapshot's own send/receive round trip goes through real window.postMessage, but
  // jsdom's postMessage dispatch is a real cross-task-queue implementation with its own timing —
  // spying lets the test control the "relay answered" leg deterministically (dispatchEvent fires
  // listeners synchronously) instead of racing jsdom's scheduling.
  postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
});

afterEach(() => {
  postMessageSpy.mockRestore();
});

/** Reads the requestId off the most recent REQUEST the code under test sent, then synchronously
 * dispatches the RESPONSE app-content.js would have posted back for it. */
function respondWith(live: unknown) {
  const sent = postMessageSpy.mock.calls.at(-1)?.[0] as { type?: string; requestId?: string } | undefined;
  expect(sent?.type).toBe(REQUEST);
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: RESPONSE, requestId: sent?.requestId, live },
    origin: location.origin,
    source: window,
  }));
}

describe('requestEspnSnapshot', () => {
  it('resolves responded:true with the live snapshot when the relay answers', async () => {
    const live = { schemaVersion: 1, streamPicks: [], mySlot: 2, leagueId: 'L1', lastHeartbeatAt: 123 };
    const promise = requestEspnSnapshot(1000);
    respondWith(live);
    await expect(promise).resolves.toEqual({ responded: true, live });
  });

  it('resolves responded:true with live:null when the extension has no snapshot yet (no ESPN tab)', async () => {
    const promise = requestEspnSnapshot(1000);
    respondWith(null);
    await expect(promise).resolves.toEqual({ responded: true, live: null });
  });

  it('resolves responded:true with live:null on a malformed payload — never crashes the caller', async () => {
    const promise = requestEspnSnapshot(1000);
    respondWith({ garbage: true });
    await expect(promise).resolves.toEqual({ responded: true, live: null });
  });

  it('resolves responded:false on timeout — the only signal that the extension is not installed here', () => {
    // No response dispatched at all.
    return expect(requestEspnSnapshot(20)).resolves.toEqual({ responded: false, live: null });
  });

  it('ignores a response carrying a mismatched requestId instead of resolving early', async () => {
    const promise = requestEspnSnapshot(20);
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: RESPONSE, requestId: 'some-other-request', live: { schemaVersion: 1, streamPicks: [] } },
      origin: location.origin,
      source: window,
    }));
    await expect(promise).resolves.toEqual({ responded: false, live: null });
  });
});
