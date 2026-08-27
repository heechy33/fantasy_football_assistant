# Agent instructions

Tool-agnostic operating guide for any coding agent (Cursor, Claude Code, Codex, Cline, etc.).
Product conventions, layout, and architecture: `CLAUDE.md`. Status: `PLAN.md`. Design history:
`DECISIONS.md`.

## Verification loop (do this; it is how we develop)

You are **not** supposed to run the full suite after every edit. That is the outer loop, not the
inner loop. CI and a single end-of-task `npm test` are the gates. Repeating `npm test` / typecheck /
build / `verify:artifact` in one session is what makes work take hours.

### Inner loop — while implementing

After a cluster of related edits, run **only** the cheapest check that would fail if this change is
wrong:

```
npm run test:frontend -- src/engine/recommendStageC.test.ts
npm run test:frontend -- src/data/
npm run test:api -- src/functions/leagues.test.ts
python -m pytest pipeline/test_underdog_adp.py
```

Prefer a sibling `*.test.ts` next to the file you changed. If none exists, add a focused test rather
than running the whole package. Re-run **that same command** after a failure — not `npm test`.

Typecheck only the package you touched, and only if the change is likely to break types:

```
npm --prefix frontend run typecheck
npm --prefix api run typecheck
```

### Outer loop — once per task

When the work is otherwise done (and only if you changed runtime code, not docs-only):

1. `npm test` **once**.
2. If that is green, **stop**. Do not re-run it unless you edit more code.
3. `npm run typecheck` only if you skipped package typecheck in the inner loop.
4. `npm run build` / `npm run verify:artifact` only if you changed packaging, `staticwebapp.config.json`,
   data staging, or the production artifact layout.

Do **not** stack `npm test` + typecheck + build + pipeline as a ritual.

### Never unless that is the task

`npm run backtest`, `npm run probe:simsort`, `npm run pipeline`, `npm run benchmark:availability`,
`STAGE_C_BENCH=1`, `BENCHMARK=1`. Those are opt-in and slow. `*.bench.ts` files are already skipped
in the default suite unless those env vars are set — do not set them to "be thorough."

### Browser

Exercise the UI in a browser only when you changed UI, layout, styling, routing, client state, or
rendered data. Engine-only, adapter-only, pipeline, API, and docs changes do not need a browser.

### Docs-only

If the diff is markdown / comments only, run nothing.
