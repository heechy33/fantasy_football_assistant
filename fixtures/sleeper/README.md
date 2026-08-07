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

## Raw Sleeper API fixtures (S1)

The fixtures above are **canonical/post-adapter shape** — what `adapters/sleeper.ts` should produce.
The fixtures below are **raw Sleeper API response shape** (field names like `pick_no`, `roster_id`,
`draft_slot`, `scoring_settings`) — what the adapter consumes and normalizes. Shapes were verified
against https://docs.sleeper.com/ on 2026-08-07, not guessed. Used by `adapters/sleeper.test.ts`.

- `raw-user.json` — `GET /v1/user/<id>` response for a fictional user `u-3`, matching the `u-3` entry
  in `raw-draft.json`'s `draft_order` so adapter tests can exercise `myTeamId`/`mySlot` derivation.
- `raw-leagues.json` — `GET /v1/user/<id>/leagues/nfl/<season>` response, 3 leagues varying `status`,
  `scoring_settings.rec` (1 / 0.5 / absent), and `roster_positions` (one/two `QB` slots, one with
  `SUPER_FLEX`) to exercise every `LeagueFormat.reception`/`.qb` derivation branch.
- `raw-draft.json` — `GET /v1/draft/<id>` response matching `raw-leagues.json`'s first league
  (`raw-league-ppr`): 12-team snake, 15 rounds, populated `draft_order`/`slot_to_roster_id`.
- `raw-draft-picks.json` — `GET /v1/draft/<id>/picks` response, 15 picks (crosses the round-1→2 snake
  reversal boundary), including one DEF pick (`player_id: "SF"`, the team-abbreviation convention) and
  one pick (`player_id: "unmatched-2099"`) deliberately absent from `known-player-pool-sample.json` to
  exercise the unmatched-player path.
- `known-player-pool-sample.json` — a trimmed `PlayerMeta[]` slice standing in for `data/players.json`
  in adapter tests: covers every matched id in `raw-draft-picks.json` plus the `"SF"` DEF id, and
  deliberately excludes `unmatched-2099`.
- `raw-league-rosters.json`, `raw-league-users.json` — `GET /v1/league/<id>/rosters` and `/users`
  responses, lower test priority (not exercised by S1's exit criteria; cover `rosters()`/`settings()`
  interface completeness only).
