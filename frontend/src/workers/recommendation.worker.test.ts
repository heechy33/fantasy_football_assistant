// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdpEntry, LeagueSettings, PlayerMeta, Position, SeasonProjection } from '../../../shared/types';
import type {
  RecommendationWorkerDynamicInput,
  RecommendationWorkerRequest,
  RecommendationWorkerResponse,
} from '../engine/recommendationWorkerProtocol';

/**
 * Drives `recommendation.worker.ts` as a plain module with a fake `self` + `fetch`, so the
 * cooperative-cancel contract (off-clock cancel, superseding compute, stale-version cancels) is
 * tested without a real worker host. Node environment on purpose: the module reads `self` at
 * import time, and `vi.stubGlobal` is the only reliable way to own that reference.
 */

interface WorkerScope {
  onmessage: ((event: { data: RecommendationWorkerRequest }) => void) | null;
  postMessage(message: RecommendationWorkerResponse): void;
  posts: RecommendationWorkerResponse[];
}

function createScope(): WorkerScope {
  const posts: RecommendationWorkerResponse[] = [];
  return {
    onmessage: null,
    posts,
    postMessage(message) {
      posts.push(message);
    },
  };
}

const settings: LeagueSettings = {
  provider: 'sleeper', leagueId: 'worker-cancel', name: 'Worker cancel', season: '2026', teams: 4,
  startingSlots: ['QB', 'RB', 'WR', 'FLEX'],
  rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BN: 4 },
  scoring: { bonus: 1 },
  format: { reception: 'ppr', qb: 'one-qb', draft: 'snake' },
};

function player(playerId: string, position: Position): PlayerMeta {
  return {
    playerId, name: playerId, position, eligiblePositions: [position], team: 'SEA',
    byeWeek: null, age: null, yearsExp: null, injuryStatus: null, ids: {},
  };
}

const players: PlayerMeta[] = [
  player('qb1', 'QB'), player('qb2', 'QB'),
  player('rb1', 'RB'), player('rb2', 'RB'), player('rb3', 'RB'), player('rb4', 'RB'),
  player('wr1', 'WR'), player('wr2', 'WR'), player('wr3', 'WR'), player('wr4', 'WR'),
  player('te1', 'TE'), player('te2', 'TE'),
  player('k1', 'K'), player('def1', 'DEF'),
];
const points = new Map(players.map((entry, index) => [entry.playerId, 120 - index * 3]));
const projections: SeasonProjection[] = players.map((entry) => ({
  playerId: entry.playerId, source: 'fftoday', stats: { bonus: points.get(entry.playerId) ?? 0 },
}));
const adp: AdpEntry[] = players.map((entry, index) => ({
  playerId: entry.playerId, name: entry.name, position: entry.position ?? '', team: entry.team,
  adp: index + 1.5, stdev: 2, high: index + 1, low: index + 20,
  timesDrafted: 100, byeWeek: null, adpSource: 'ffc', stdevSource: 'observed',
}));
const slotToTeam = { 1: 'me', 2: 't2', 3: 't3', 4: 't4' };

const computeInput: RecommendationWorkerDynamicInput = {
  settings,
  picks: [],
  myTeamId: 'me',
  nextPick: 8,
  currentPick: 1,
  limit: 24,
  rolloutDisplayLimit: 24,
  simulationCandidateLimit: 10,
  displayPosition: null,
  includeRecommendationViews: false,
  includeMarketRecommendations: false,
  includeExpansion: false,
  rosterSpotsPerTeam: 4,
  draftRounds: 4,
  availabilityEntries: [],
  simulation: {
    draftId: 'worker-cancel-test',
    draftType: 'snake',
    teams: 4,
    rounds: 4,
    slotToTeam,
    decisionPick: 1,
    followUpPick: 8,
    executionMode: { mode: 'fixed', scenarios: 40, batchSize: 1 },
  },
};

function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Timed out waiting for worker message'));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

function computeMessage(requestId: number): RecommendationWorkerRequest {
  return {
    type: 'compute',
    requestId,
    requestKey: `draft|pick-${requestId}`,
    staticVersion: 1,
    queuedAt: Date.now(),
    input: computeInput,
  };
}

function cancelMessage(requestId: number, staticVersion = 1): RecommendationWorkerRequest {
  return { type: 'cancel', requestId, staticVersion };
}

const s2Of = (requestId: number) => (m: RecommendationWorkerResponse): boolean =>
  m.type === 'result' && m.phase === 's2' && m.requestId === requestId;
const stageCOf = (requestId: number) => (m: RecommendationWorkerResponse): boolean =>
  m.type === 'result' && m.phase === 'stageC' && m.requestId === requestId;

// `new Response(string)` defaults to `Content-Type: text/plain` — real static hosts (Vite's dev
// server, SWA's configured `.json` mime type) set `application/json` for these files, which
// adpBoard.ts's isJsonResponse now relies on to distinguish a real board from an HTML SPA
// fallback. Explicit here so the mock matches actual server behavior.
function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

let scope: WorkerScope;

beforeEach(() => {
  vi.resetModules();
  scope = createScope();
  vi.stubGlobal('self', scope);
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    let payload: unknown;
    if (url.endsWith('/data/players.json')) payload = players;
    else if (url.endsWith('/data/projections-season.json')) payload = projections;
    else if (url.endsWith('/data/adp-ppr.json')) payload = adp;
    else throw new Error(`Unexpected fetch: ${url}`);
    return jsonResponse(payload);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function initWorker(): Promise<void> {
  await import('../workers/recommendation.worker');
  expect(scope.onmessage).not.toBeNull();
  scope.onmessage?.({ data: { type: 'init', staticVersion: 1, adpBoardKey: 'ppr', adpFormat: 'ppr' } });
  await waitFor(() => scope.posts.some((m) => m.type === 'ready'));
}

describe('recommendation.worker cooperative cancellation', () => {
  it('posts the S2 snapshot but never Stage C for a request cancelled before it starts', async () => {
    await initWorker();
    scope.onmessage?.({ data: cancelMessage(1) });
    scope.onmessage?.({ data: computeMessage(1) });

    // S2 is posted before any abort check; the cancel token then aborts Stage C at the yield.
    await waitFor(() => scope.posts.some(s2Of(1)));
    // Give the worker a few macrotask yields; no stageC may ever arrive for request 1.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(scope.posts.filter((m) => m.type === 'result' && m.phase === 'stageC')).toHaveLength(0);
  });

  it('aborts the older Stage C when a newer compute supersedes it', async () => {
    await initWorker();
    scope.onmessage?.({ data: computeMessage(1) });
    scope.onmessage?.({ data: computeMessage(2) });

    await waitFor(() => scope.posts.some(s2Of(1)));
    await waitFor(() => scope.posts.some(s2Of(2)));
    await waitFor(() => scope.posts.some(stageCOf(2)));

    const stageCs = scope.posts.filter((m) => m.type === 'result' && m.phase === 'stageC');
    expect(stageCs).toHaveLength(1);
    expect(stageCs[0]).toMatchObject({ requestId: 2 });
    expect(scope.posts.filter(s2Of(1))).toHaveLength(1);
  });

  it('ignores a cancel whose static version is stale', async () => {
    await initWorker();
    scope.onmessage?.({ data: computeMessage(1) });
    // A cancel from an old init generation must not abort a request on the current static data.
    scope.onmessage?.({ data: cancelMessage(1, 99) });

    await waitFor(() => scope.posts.some(stageCOf(1)));
    expect(scope.posts.filter(stageCOf(1))).toHaveLength(1);
  });
});

describe('recommendation.worker ESPN ADP board selection', () => {
  it('fetches adp-espn-ppr.json when init carries adpBoardKey espn-ppr', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      let payload: unknown;
      if (url.endsWith('/data/players.json')) payload = players;
      else if (url.endsWith('/data/projections-season.json')) payload = projections;
      else if (url.endsWith('/data/adp-espn-ppr.json')) payload = adp;
      else throw new Error(`Unexpected fetch: ${url}`);
      return jsonResponse(payload);
    }));

    await import('../workers/recommendation.worker');
    scope.onmessage?.({ data: { type: 'init', staticVersion: 1, adpBoardKey: 'espn-ppr', adpFormat: 'ppr' } });
    await waitFor(() => scope.posts.some((m) => m.type === 'ready'));
    expect(scope.posts).toContainEqual(expect.objectContaining({ type: 'ready', staticVersion: 1 }));
  });

  it('falls back to adp-ppr.json when the espn board 404s (fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      let payload: unknown;
      if (url.endsWith('/data/players.json')) payload = players;
      else if (url.endsWith('/data/projections-season.json')) payload = projections;
      else if (url.endsWith('/data/adp-ppr.json')) payload = adp;
      else if (url.endsWith('/data/adp-espn-ppr.json')) return new Response('nope', { status: 404 });
      else throw new Error(`Unexpected fetch: ${url}`);
      return jsonResponse(payload);
    }));

    await import('../workers/recommendation.worker');
    scope.onmessage?.({ data: { type: 'init', staticVersion: 1, adpBoardKey: 'espn-ppr', adpFormat: 'ppr' } });
    await waitFor(() => scope.posts.some((m) => m.type === 'ready'));
    expect(scope.posts).toContainEqual(expect.objectContaining({ type: 'ready', staticVersion: 1 }));
  });

  // Regression: a missing /data/adp-espn-ppr.json 200s with the SPA-fallback HTML page on Vite's
  // dev server (and any host without SWA's /data/* navigationFallback exclusion) instead of
  // 404ing — see adpBoard.ts's isJsonResponse doc. Before that fix this HTML response.json() throw
  // escaped fetchStaticData entirely and the worker never posted 'ready'.
  it('falls back to adp-ppr.json when the espn board 200s with the SPA-fallback HTML page instead of 404ing', async () => {
    const htmlFallback = new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      let payload: unknown;
      if (url.endsWith('/data/players.json')) payload = players;
      else if (url.endsWith('/data/projections-season.json')) payload = projections;
      else if (url.endsWith('/data/adp-ppr.json')) payload = adp;
      else if (url.endsWith('/data/adp-espn-ppr.json')) return htmlFallback;
      else throw new Error(`Unexpected fetch: ${url}`);
      return jsonResponse(payload);
    }));

    await import('../workers/recommendation.worker');
    scope.onmessage?.({ data: { type: 'init', staticVersion: 1, adpBoardKey: 'espn-ppr', adpFormat: 'ppr' } });
    await waitFor(() => scope.posts.some((m) => m.type === 'ready'));
    expect(scope.posts).toContainEqual(expect.objectContaining({ type: 'ready', staticVersion: 1 }));
  });
});

