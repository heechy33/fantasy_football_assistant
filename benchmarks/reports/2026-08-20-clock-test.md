# S5 Clock test — live Sleeper mock, worker path

> **SUPERSEDED 2026-08-30.** S5 closed on operational mock-draft evidence instead
> of this instrumented run (see `DECISIONS.md`, 2026-08-30 (6), and
> `archive/PLAN-history.md`'s S5 entry). The DEV clock instrumentation this
> procedure depends on (`frontend/src/lib/perf.ts` marks, `DraftTimingPanel`) was
> deliberately removed in `ec69271` — none of the marks below exist anymore, and
> the "already shipped" claim in the Instrumentation section is stale. Do not try
> to run this procedure as written; latency is instead gated in CI by
> `engine/recommendPerformance.test.ts` (median < 3000 ms against real `data/`).

Status: **PENDING LIVE RUN** — this file is the procedure + instrumentation reference. The live-mock
measurements below require a real Sleeper mock draft session (the repo has no mock-lobby harness; a
bot-filled mock is fine, since this measures latency, not opponent type). See "How to run" before
filling in the results table.

## Acceptance (from CLAUDE.md / PLAN.md S5)

Pick lands upstream → updated recommendation on screen **under 3 seconds** on the worker path, against
a real Sleeper mock draft. This is the only honest test of the live poll → worker → render pipeline;
Node-level engine timing (`recommendPerformance.test.ts`) does not cover it.

## Instrumentation (already shipped, `frontend/src/lib/perf.ts`)

All `ffa:` marks are no-ops outside `import.meta.env.DEV`, so run the dev server.

- `ffa:poll-<id>-response` — a poll response landed in `useDraftPoll` (pick-lands moment upstream).
- `ffa:<name>-worker-s2-received` / `ffa:<name>-worker-stagec-received` — the main thread received
  the worker's S2 snapshot / Stage C patch for that request (`useRecommendationRefinement.ts`).
- `[draft-timing]` console lines from `draftMeasureSync` (DEV only) for the main-thread compute paths.

Measure `performance.measure('ffa:poll-lands-to-stageC', 'ffa:poll-<id>-response', 'ffa:<name>-worker-stagec-received')`
or read the two mark timestamps directly. The Stage C receipt is the "updated recommendation on screen"
moment (S2 is the first paint; Stage C is the final patch).

## How to run

1. `npm run dev` (frontend), and start the local API if the dev wiring requires it.
2. Join a Sleeper mock draft in the same browser session the extension/bridge reads from.
3. Open DevTools → Performance, and the Console (filter `[draft-timing]`).
4. Play normally until your first pick; for each of your picks, note the poll mark id and the worker
   receipt marks for the same pick, and record `pick-lands → stageC-received` wall time.
5. Do not use this session to judge availability calibration or recommendation quality — latency only.

## Results (fill in per pick; target < 3000 ms)

| # | Pick (overall) | Poll id | poll-lands → S2 received (ms) | poll-lands → Stage C received (ms) | Notes |
|---|---|---|---:|---:|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |

## Outcomes

- [ ] Under 3s on all picks — clock test passes on the worker path.
- [ ] Any pick ≥ 3s recorded above with the phase that consumed the budget (poll delay / worker S2 /
      Stage C / render), so the next fix targets the measured phase instead of guessing.

## Forced-failure check (main-thread fallback, Phase 1)

With the board on the clock, force a worker error (e.g. `worker.terminate()` on the
`recommendation.worker.ts` instance in DevTools, or temporarily `throw` at the top of
`handleCompute`) and confirm the board renders a usable deterministic board behind the
"Computing recommendations on the main thread…" status instead of staying blank.
