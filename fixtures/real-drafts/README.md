# Real human-draft fixtures (Phase 2b)

Transcribed from real ESPN league recaps. **All picks were made by humans**
(`humanSeats: 10`, `autodraftShare: 0`, `marketShare: 0`) — these are the
held-out *human-shape* validation cohort for the Phase 2c gates, as opposed to
`fixtures/sleeper/recorded/` (9 Sleeper mocks whose non-user seats were bots —
the *machinery* cohort).

| Directory | Source | League | Picks | Market reference |
|---|---|---|---|---|
| `2026-08-15-espn-10team/` | `espn_draft1.txt` | 10-team, 14-round, PPR snake, 1-QB, deep bench | 140 | `data/adp-espn-ppr.json` |
| `espn-draft2-10team-16round/` | `espn_draft2.txt` | 10-team, 16-round, PPR snake, 1-QB, deep bench | 160 | `data/adp-espn-ppr.json` |

## Shape

Each directory holds the raw-Sleeper API shape consumed unchanged by
`frontend/src/adapters/sleeper.ts` (via the benchmark harness's mocked fetch):

- `draft.json` — `RawDraft`: snake, `status: complete`, `settings.teams/rounds`,
  `draft_order` (userId → slot), `slot_to_roster_id` (slot → roster id).
- `picks.json` — `RawPick[]`, sorted by `pick_no`, `player_id` resolved to
  `data/players.json` Sleeper ids (DEF rows keyed by team abbreviation, e.g.
  `SEA`).
- `metadata.json` — the Phase 2b/2d harness descriptor: `provider`,
  `transcribed`, `source`, `humanSeats`, `autodraftShare`, `marketShare`,
  `adpFile` (each draft's market reference), `scoringType`, `qbFormat`,
  `rounds`, `replayUserId` (the seat the recommendation-replay section uses).

## Regenerate

```sh
python scripts/transcribe-espn-draft.py
```

The transcriber resolves every pick against the committed `data/players.json`
and **exits non-zero on any miss** — a silent crosswalk miss would corrupt the
harness's ground-truth `actualSurvived`. Current state: 140/140 and 160/160
resolve.

## Known assumption

`settings.slots_*` assumes the standard ESPN 1-QB lineup (1QB 2RB 2WR 1TE 1FLEX
1K 1DEF; bench = rounds − 9). The availability/survival gates do not depend on
roster depth; only the Section C recommendation replay does. Regenerate with
the real roster slots if they differ.
