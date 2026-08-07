# Sleeper fixtures

Hand-authored, matching Sleeper's documented public API shapes and `shared/types.d.ts` — **not**
recordings of a real draft. No live Sleeper mock draft was available to record from when these were
written (2026-08-06). Swap these for real recorded fixtures once S1 (live Sleeper connection) lands,
and keep the hand-authored ones only if they're still useful as a minimal/synthetic case.

Player ids and names here (`9001`, "RB One", ...) are fictional placeholders, not real Sleeper
player ids — don't rely on them matching anything in the committed `data/` pipeline output.

- `league-settings.json` — a `LeagueSettings` object: 12-team, one-QB, full-PPR, standard FLEX.
- `draft-init.json` — a `DraftInit` object for the same league: snake, 15 rounds.
- `picks-partial.json` — a `DraftPicks` object mid-draft: 5 picks in, pick 6 on the clock, one
  unmatched pick (`playerId: null`) to exercise the "never silently drop" path.
- `scoring-ppr.json` — a standalone `ScoringMap`, standard full-PPR weights.
- `projections-sample.json` — a handful of `SeasonProjection` entries.
- `adp-sample.json` — a handful of `AdpEntry` entries, including one with a wide `stdev` (low
  sample size / low confidence case).
