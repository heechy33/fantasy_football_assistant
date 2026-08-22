#!/usr/bin/env python
"""Freeze a historical preseason input snapshot for the Edge Validation Gate's
historical out-of-sample draft backtest (PLAN.md evaluation layer A).

A backtest is only out-of-sample if the draft decisions run on what a drafter
could actually see before the season. This script captures the 2025 preseason
inputs — FFC's 2025 PPR ADP board (with real observed dispersion) and FFToday's
Season=2025 projections — into committed fixtures under
``fixtures/backtest/<season>/``, and gates the capture against leakage before
any snapshot artifact is written:

1. **Step 0 probe (fail fast).** FFC must actually serve ``year=<season>``; an
   empty payload is a hard stop, not a silently-empty ADP board.
2. **FFToday leakage gate (hard, blocking).** ``playerproj.php?Season=2025``
   must carry a *preseason* ``Updated:`` stamp (before the season's first
   game). An in-season refresh would leak outcomes into the "projections".
   The stamp is already parsed by fftoday.py; a missing, unparseable, or
   on/after-first-game date fails closed.
3. **Identity gate (hard, blocking).** At least ``IDENTITY_GATE_THRESHOLD`` of
   the FFC board must resolve to a sleeper_id through the existing
   ``match.match_ffc_entry`` crosswalk (the same convention as build_data.py's
   COVERAGE_GATE_THRESHOLD). Every miss is recorded by name — never silently
   dropped (CLAUDE.md).
4. **Outcome coverage (diagnostic only, non-blocking).** Players who resolve
   but have no rows in data/weekly-stats.json (preseason injuries, cuts,
   retirees) are listed, not failed: the harness must score them 0 all season.

The committed outcome set (data/weekly-stats.json, season 2025) and the player
pool (data/players.json) are pinned by SHA-256 in provenance.json so a later
regeneration of data/ cannot silently change what the snapshot validates
against.

All network work happens through the existing sources.py / fftoday.py
boundaries; everything else is pure and tested against fixtures
(test_backtest_snapshot.py).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import match
import sources
from fftoday import FFTodayProjectionProvider

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BACKTEST_ROOT = REPO_ROOT / "fixtures" / "backtest"

FFC_FORMAT = "ppr"
FFC_TEAMS = 12

# Mirrors build_data.py's COVERAGE_GATE_THRESHOLD (0.97, verified achievable at
# 1.00 on the live FFC sample) applied to the historical FFC board. This is the
# identity gate (FFC name/position/team -> sleeper_id), NOT an
# outcome-presence requirement — outcome presence is a separate diagnostic.
IDENTITY_GATE_THRESHOLD = 0.97

SNAPSHOT_SCHEMA_VERSION = 1

# Season -> first regular-season game. FFToday's Season=YYYY projection page
# must carry an "Updated:" stamp before this date to count as a preseason
# snapshot. Override per run with --fftoday-leakage-cutoff.
SEASON_FIRST_GAME: dict[str, date] = {
    "2025": date(2025, 9, 4),  # 2025 NFL season week 1 (Thursday night game)
}

_FFTODAY_UPDATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")


def git_head_sha() -> str:
    """HEAD SHA at snapshot time, or 'unknown' when git is unavailable."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=10, check=True,
        )
        return out.stdout.strip()
    except Exception:
        return "unknown"


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parse_fftoday_updated(raw: str) -> date | None:
    """Parse FFToday's 'M/D/YYYY' stamp; None for anything else (fail closed)."""
    m = _FFTODAY_UPDATE_RE.match(raw.strip())
    if not m:
        return None
    try:
        return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    except ValueError:
        return None


def fftoday_leakage_verdict(upstream_updated_at: str, first_game: date) -> dict[str, Any]:
    """Verdict dict: ``ok`` False unless the stamp parses to before ``first_game``."""
    parsed = parse_fftoday_updated(upstream_updated_at)
    if parsed is None:
        return {
            "ok": False,
            "reason": f"FFToday update stamp unparseable: {upstream_updated_at!r}",
        }
    ok = parsed < first_game
    return {
        "ok": ok,
        "parsedDate": parsed.isoformat(),
        "firstGame": first_game.isoformat(),
        "reason": None if ok else (
            f"FFToday 'Updated: {upstream_updated_at}' is on/after the season start "
            f"{first_game.isoformat()} — the page was refreshed in-season and leaks outcomes."
        ),
    }


def resolve_ffc_rows(
    ffc_players: list[dict[str, Any]],
    sleeper_index: dict[match.MatchKey, str],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Resolve every FFC board row to a sleeper_id via the existing crosswalk.

    Returns (rows, unmatched). Each returned row is the verbatim FFC row plus a
    ``sleeperId`` field (None when unmatched); ``unmatched`` holds display names
    for the audit trail. Never silently drops a row.
    """
    rows: list[dict[str, Any]] = []
    unmatched: list[str] = []
    for player in sorted(ffc_players, key=lambda p: p["adp"]):
        row = dict(player)
        sleeper_id = match.match_ffc_entry(player, sleeper_index)
        row["sleeperId"] = sleeper_id
        if sleeper_id is None:
            unmatched.append(
                f"{player['name']} ({match.normalize_ffc_position(player['position'])})"
            )
        rows.append(row)
    return rows, unmatched


def identity_gate_result(
    rows: list[dict[str, Any]],
    unmatched: list[str],
    threshold: float,
) -> dict[str, Any]:
    sample = len(rows)
    matched = sample - len(unmatched)
    rate = (matched / sample) if sample else 0.0
    return {
        "ok": sample > 0 and rate >= threshold,
        "sampleSize": sample,
        "matched": matched,
        "rate": round(rate, 4),
        "threshold": threshold,
        "unmatched": sorted(unmatched),
    }


#: Sleeper ids verified (2026-08-22, via a direct fetch of
#: `sources.fetch_sleeper_weekly_stats('2025', week)` for every week 1-18) to carry no `pts_ppr`
#: key at all, in any week, in Sleeper's own raw weekly-stats feed -- not a `data/weekly-stats.json`
#: build-time filtering artifact (that artifact was independently confirmed to reproduce the raw
#: feed exactly for this player set). Real absence, not a pipeline bug: score 0 all season.
VERIFIED_ZERO_OUTCOME_REASONS: dict[str, str] = {
    "2309": "Amari Cooper -- no pts_ppr in Sleeper's raw 2025 weekly stats feed, any week 1-18.",
    "4018": "Joe Mixon -- no pts_ppr in Sleeper's raw 2025 weekly stats feed, any week 1-18.",
    "6803": "Brandon Aiyuk -- no pts_ppr in Sleeper's raw 2025 weekly stats feed, any week 1-18.",
    "7042": "Tyler Bass -- no pts_ppr in Sleeper's raw 2025 weekly stats feed, any week 1-18.",
    "7437": "Kyle Williams -- no pts_ppr in Sleeper's raw 2025 weekly stats feed, any week 1-18.",
    # Found by widening the coverage check to the full FFToday-projected pool (2026-08-22), not
    # just the FFC board; verified the same way as the five above.
    "11581": "MarShawn Lloyd -- no pts_ppr in Sleeper's raw 2025 weekly stats feed, any week 1-18.",
    "11640": "Jermaine Burton -- no pts_ppr in Sleeper's raw 2025 weekly stats feed, any week 1-18.",
    "5119": "Jason Sanders -- no pts_ppr in Sleeper's raw 2025 weekly stats feed, any week 1-18.",
    "7561": "Elijah Mitchell -- no pts_ppr in Sleeper's raw 2025 weekly stats feed, any week 1-18.",
}


def outcome_coverage_result(
    sleeper_ids: list[str],
    weekly_players: dict[str, Any],
) -> dict[str, Any]:
    """Split resolved ids by whether data/weekly-stats.json has 2025 rows for them.

    `sleeper_ids` should cover every player the harness can actually draft --
    the FFC board *and* every FFToday-projected player, not just the FFC rows --
    so a gap in the FFToday-only long tail is not missed.

    Diagnostic only -- a player can legitimately resolve to a sleeper_id with no
    weekly rows (preseason injury, cut, retired before the season). The harness
    must score such players 0 all season, not drop them. Any id outside
    `VERIFIED_ZERO_OUTCOME_REASONS` is a *new* gap since the 2026-08-22
    verification and should be re-checked against the raw Sleeper feed before
    trusting the harness run, not assumed benign.
    """
    ids = sorted({pid for pid in sleeper_ids if pid})
    without = sorted(pid for pid in ids if pid not in weekly_players)
    unverified = sorted(pid for pid in without if pid not in VERIFIED_ZERO_OUTCOME_REASONS)
    return {
        "sampleSize": len(ids),
        "withOutcomes": len(ids) - len(without),
        "withoutOutcomes": len(without),
        "withoutOutcomesPlayers": without,
        "withoutOutcomesVerified": {
            pid: VERIFIED_ZERO_OUTCOME_REASONS[pid] for pid in without if pid in VERIFIED_ZERO_OUTCOME_REASONS
        },
        "withoutOutcomesUnverified": unverified,
    }


def _write_json(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", default="2025", help="Preseason inputs to freeze (nflverse season)")
    parser.add_argument("--teams", type=int, default=FFC_TEAMS)
    parser.add_argument(
        "--out-dir", default=None,
        help=f"Default: {DEFAULT_BACKTEST_ROOT}/<season>",
    )
    parser.add_argument("--data-dir", default=str(REPO_ROOT / "data"))
    parser.add_argument("--identity-threshold", type=float, default=IDENTITY_GATE_THRESHOLD)
    parser.add_argument(
        "--fftoday-leakage-cutoff", default=None,
        help="YYYY-MM-DD cutoff override; default per-season from SEASON_FIRST_GAME",
    )
    args = parser.parse_args(argv)

    season = args.season
    out_dir = Path(args.out_dir) if args.out_dir else DEFAULT_BACKTEST_ROOT / season
    data_dir = Path(args.data_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.now(timezone.utc).isoformat()

    if args.fftoday_leakage_cutoff:
        first_game = date.fromisoformat(args.fftoday_leakage_cutoff)
    else:
        first_game = SEASON_FIRST_GAME.get(season)
        if first_game is None:
            print(
                f"No FFToday leakage cutoff registered for season {season}; "
                "pass --fftoday-leakage-cutoff YYYY-MM-DD."
            )
            return 4

    provenance: dict[str, Any] = {
        "schemaVersion": SNAPSHOT_SCHEMA_VERSION,
        "season": season,
        "builtAt": fetched_at,
        "gitCommit": git_head_sha(),
        "leagueParams": {"teams": args.teams, "format": FFC_FORMAT, "season": season},
        "inputs": {},
        "gates": {},
    }

    # -------------------------------------------------------------------------
    # [1/4] Sleeper player pool + DynastyProcess crosswalk (identity inputs)
    # -------------------------------------------------------------------------
    sleeper_players = sources.fetch_sleeper_players()
    provenance["inputs"]["sleeperPlayers"] = {
        "url": f"{sources.SLEEPER_BASE}/v1/players/nfl",
        "fetchedAt": fetched_at,
        "rows": len(sleeper_players),
    }
    dp_rows = sources.fetch_dynastyprocess_crosswalk()
    provenance["inputs"]["dynastyProcessCrosswalk"] = {
        "url": sources.DYNASTYPROCESS_PLAYERIDS_URL,
        "fetchedAt": fetched_at,
        "rows": len(dp_rows),
    }
    sleeper_index = match.build_sleeper_match_index(sleeper_players)

    # -------------------------------------------------------------------------
    # [2/4] FFC ADP: step-0 probe (fail fast) + identity gate
    # -------------------------------------------------------------------------
    ffc_payload = sources.fetch_ffc_adp_payload(FFC_FORMAT, teams=args.teams, year=int(season))
    ffc_players = ffc_payload.get("players") or []
    ffc_meta = ffc_payload.get("meta") or {}
    provenance["inputs"]["ffcAdpPpr"] = {
        "url": f"{sources.FFC_BASE}/adp/{FFC_FORMAT}?teams={args.teams}&year={season}",
        "fetchedAt": fetched_at,
        "rows": len(ffc_players),
        "meta": ffc_meta,
    }
    step0 = {"ok": len(ffc_players) > 0, "rows": len(ffc_players)}
    provenance["gates"]["ffcStep0"] = step0
    if not step0["ok"]:
        provenance["gates"]["snapshotState"] = "failed-ffc-step0"
        _write_json(out_dir / "provenance.json", provenance)
        print(f"STEP 0 GATE FAILED: FFC returned no players for season {season}.")
        print("  ADP-implied inputs (baseline 1, opponent survival) are unavailable; stopping.")
        return 1

    rows, unmatched = resolve_ffc_rows(ffc_players, sleeper_index)
    identity = identity_gate_result(rows, unmatched, args.identity_threshold)
    provenance["gates"]["identity"] = identity
    if not identity["ok"]:
        provenance["gates"]["snapshotState"] = "failed-identity-gate"
        _write_json(out_dir / "provenance.json", provenance)
        print(
            f"IDENTITY GATE FAILED: {identity['rate']:.1%} "
            f"< {identity['threshold']:.1%} (matched {identity['matched']}/{identity['sampleSize']})."
        )
        print("  Unmatched:", ", ".join(identity["unmatched"]))
        return 2

    # -------------------------------------------------------------------------
    # [3/4] FFToday projections + leakage gate (blocking)
    # -------------------------------------------------------------------------
    top_adp_ids = [r["sleeperId"] for r in rows if r.get("sleeperId")]
    projection_result = FFTodayProjectionProvider(sleeper_players).load(
        season, top_adp_ids=top_adp_ids,
    )
    leakage = fftoday_leakage_verdict(projection_result.upstream_updated_at, first_game)
    provenance["inputs"]["fftoday"] = {
        "url": "https://www.fftoday.com/rankings/playerproj.php",
        "fetchedAt": fetched_at,
        "upstreamUpdatedAt": projection_result.upstream_updated_at,
        "sourceUrls": projection_result.diagnostics.get("sourceUrls", []),
        "positionRows": projection_result.position_rows,
        "matchedRows": len(projection_result.projections),
    }
    provenance["gates"]["fftodayLeakage"] = leakage
    if not leakage["ok"]:
        provenance["gates"]["snapshotState"] = "failed-fftoday-leakage"
        _write_json(out_dir / "provenance.json", provenance)
        print(f"FFTODAY LEAKAGE GATE FAILED: {leakage['reason']}")
        print("  Falling back to ADP-implied value only; baseline 2 (raw projection) is unavailable.")
        return 3

    # -------------------------------------------------------------------------
    # [4/4] Outcome coverage (diagnostic) + pin the outcome set
    # -------------------------------------------------------------------------
    weekly_stats_path = data_dir / "weekly-stats.json"
    players_json_path = data_dir / "players.json"
    weekly_stats = json.loads(weekly_stats_path.read_text(encoding="utf-8"))
    # Full drafted-eligible pool: the FFC board *and* every FFToday-projected player -- a gap in the
    # FFToday-only long tail (a player with a projection but no FFC ADP row) would otherwise be
    # invisible to this diagnostic even though baseline 2 (raw projected points) can draft them.
    coverage_pool = {r["sleeperId"] for r in rows if r.get("sleeperId")}
    coverage_pool.update(p.playerId for p in projection_result.projections if p.playerId)
    coverage = outcome_coverage_result(
        sorted(coverage_pool),
        weekly_stats.get("players") or {},
    )
    provenance["gates"]["outcomeCoverage"] = coverage
    provenance["inputs"]["weeklyStats"] = {
        "path": "data/weekly-stats.json",
        "sha256": sha256_of(weekly_stats_path),
        "season": weekly_stats.get("season"),
        "weeksFetched": weekly_stats.get("weeksFetched"),
        "players": len(weekly_stats.get("players") or {}),
    }
    provenance["inputs"]["playersJson"] = {
        "path": "data/players.json",
        "sha256": sha256_of(players_json_path),
    }
    provenance["gates"]["snapshotState"] = "ok"

    # -------------------------------------------------------------------------
    # Write artifacts
    # -------------------------------------------------------------------------
    adp_artifact = {
        "status": ffc_payload.get("status"),
        "meta": ffc_meta,
        # Verbatim FFC rows (including FFC's own player_id) plus the resolved
        # sleeperId this snapshot computed — the harness must key drafts off
        # sleeperId, never off FFC's player_id.
        "players": rows,
    }
    projections_artifact = {
        "schemaVersion": SNAPSHOT_SCHEMA_VERSION,
        "season": season,
        "source": "fftoday",
        "fetchedAt": fetched_at,
        "upstreamUpdatedAt": projection_result.upstream_updated_at,
        "sourceUrls": projection_result.diagnostics.get("sourceUrls", []),
        "positionRows": projection_result.position_rows,
        "matchedRows": len(projection_result.projections),
        "unmatched": projection_result.diagnostics.get("unmatched", []),
        "byeWeeks": projection_result.bye_weeks,
        "projections": [
            {"playerId": p.playerId, "source": p.source, "stats": p.stats}
            for p in projection_result.projections
        ],
    }
    _write_json(out_dir / "adp-ppr.json", adp_artifact)
    _write_json(out_dir / "projections.json", projections_artifact)
    _write_json(out_dir / "provenance.json", provenance)

    print(f"Snapshot written to {out_dir}:")
    print(
        f"  adp-ppr.json      {len(rows)} FFC rows "
        f"(identity {identity['rate']:.1%}, {identity['matched']}/{identity['sampleSize']})"
    )
    print(
        f"  projections.json  {len(projection_result.projections)} FFToday projections "
        f"(updated {projection_result.upstream_updated_at})"
    )
    print(
        f"  provenance.json   outcome coverage {coverage['withOutcomes']}/{coverage['sampleSize']}, "
        f"leakage {leakage['parsedDate']} (preseason)"
    )
    if coverage["withoutOutcomesVerified"]:
        print("  Note — verified-absent-from-Sleeper players (harness must score 0, not a bug):")
        for pid, reason in coverage["withoutOutcomesVerified"].items():
            print(f"    {pid}: {reason}")
    if coverage["withoutOutcomesUnverified"]:
        print("  WARNING — NEW zero-outcome players since the 2026-08-22 verification:")
        print("    Re-check these against the raw Sleeper weekly-stats feed before trusting the run:")
        for pid in coverage["withoutOutcomesUnverified"]:
            print(f"    {pid}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
