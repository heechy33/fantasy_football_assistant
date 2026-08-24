"""Step A/A2 freezer: verbatim 2025 projection-source bytes + weekly outcomes (gates-blend-addendum).

Freezes, ONCE, the retrievable 2025 projection sources whose vintage the 2026-08-23 audit ruled
unverifiable (benchmarks/reports/2026-08-23-projection-vintage-audit.{md,json}), plus the raw
weekly-outcome feed needed to widen outcome coverage to the full candidate pool. Everything is
saved as VERBATIM HTTP response bytes — normalization happens downstream, never here — into the
committed directory fixtures/projection-freeze/2025-retrievable/, with SHA-256 pins and the audit's
vintage caveats copied into provenance.json.

Request shapes replicate production exactly (pipeline/sources.py::fetch_sleeper_adp,
pipeline/espn_projections.py::fetch_espn_projections, pipeline/sources.py::fetch_sleeper_weekly_stats)
so the frozen bytes are the same bytes production code sees.

Fails closed: any failed fetch aborts with nothing written; an existing non-empty target directory
aborts without --force. Never re-fetch silently: re-running against an existing freeze requires
--force and rewrites every file (treat as a new vintage).

Usage: python pipeline/freeze_2025_retrievable.py [--force]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))

import espn_projections  # noqa: E402  (ESPN_DEFAULTS_URL, fetch shape)
import sources  # noqa: E402  (SLEEPER_BASE, FANTASY_POSITIONS, USER_AGENT, TIMEOUT, weekly path)

TARGET_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "projection-freeze" / "2025-retrievable"
SEASON = "2025"
WEEKS = list(range(1, 19))  # 2025 regular season incl. week 18 (outcome coverage, not scored weeks)


def sha256_of_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_commit() -> str | None:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True,
        ).stdout.strip()
    except Exception:
        return None


def fetch_sleeper_projections_raw() -> tuple[bytes, int]:
    """Production request shape of sources.fetch_sleeper_adp, returning verbatim bytes."""
    resp = requests.get(
        f"{sources.SLEEPER_BASE}/projections/nfl/{SEASON}",
        params=[("season_type", "regular"), *[("position[]", p) for p in sources.FANTASY_POSITIONS]],
        headers={"User-Agent": sources.USER_AGENT},
        timeout=sources.TIMEOUT,
    )
    resp.raise_for_status()
    return resp.content, len(resp.json())


def fetch_espn_defaults_raw() -> tuple[bytes, int, int]:
    """Production request shape of espn_projections.fetch_espn_projections.

    Returns (canonical bytes, players_returned, entries_with_season_projection) using the module's
    own entry-selection contract (seasonId==season && statSourceId==1 && statSplitTypeId==0 &&
    scoringPeriodId==0). The parsed dict IS what production consumes; it is re-serialized with
    sorted keys so the pinned sha256 is stable rather than tied to upstream key order."""
    payload = espn_projections.fetch_espn_projections(SEASON)
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    raw_rows = payload.get("players", []) or []
    with_entry = 0
    for row in raw_rows:
        player = row.get(espn_projections._ROW_PLAYER_KEY) if isinstance(row, dict) else None
        if espn_projections._select_projection_entry(player or {}, int(SEASON)) is not None:
            with_entry += 1
    return raw, len(raw_rows), with_entry


def fetch_weekly_raw(week: int) -> tuple[bytes, int]:
    """Production request shape of sources.fetch_sleeper_weekly_stats, verbatim bytes."""
    resp = requests.get(
        f"{sources.SLEEPER_BASE}{sources.SLEEPER_WEEKLY_STATS_PATH.format(season=SEASON, week=week)}",
        headers={"User-Agent": sources.USER_AGENT},
        timeout=sources.TIMEOUT,
    )
    resp.raise_for_status()
    return resp.content, len(resp.json())


def file_entry(name: str, url: str, request_desc: str, data: bytes, rows: int) -> dict[str, Any]:
    return {
        "file": name,
        "url": url,
        "request": request_desc,
        "bytes": len(data),
        "rows": rows,
        "sha256": sha256_of_bytes(data),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="overwrite an existing freeze (new vintage)")
    args = parser.parse_args(argv)

    if TARGET_DIR.exists() and any(TARGET_DIR.iterdir()) and not args.force:
        print(f"[abort] {TARGET_DIR} is non-empty; a freeze already exists. Use --force deliberately.")
        return 2

    fetched_at = datetime.now(timezone.utc).isoformat()

    # --- Gather everything FIRST (fail closed): one failed fetch writes nothing. ---
    print("[1/3] Sleeper season projections 2025 (production request shape)...")
    sleeper_raw, sleeper_rows = fetch_sleeper_projections_raw()

    print("[2/3] ESPN leaguedefaults 2025 (production x-fantasy-filter)...")
    espn_raw, espn_players, espn_entries = fetch_espn_defaults_raw()

    print(f"[3/3] Sleeper weekly stats 2025, weeks {WEEKS[0]}-{WEEKS[-1]}...")
    weekly: dict[int, tuple[bytes, int]] = {}
    for week in WEEKS:
        weekly[week] = fetch_weekly_raw(week)
        print(f"      week {week}: {len(weekly[week][0])} bytes, {weekly[week][1]} rows")

    # --- All fetches succeeded; write. ---
    TARGET_DIR.mkdir(parents=True, exist_ok=True)

    sleeper_name = "sleeper-projections-2025.raw.json"
    (TARGET_DIR / sleeper_name).write_bytes(sleeper_raw)
    written: dict[str, Any] = {
        "sleeperProjections": file_entry(
            sleeper_name,
            f"{sources.SLEEPER_BASE}/projections/nfl/{SEASON}",
            "GET params=[('season_type','regular'), ('position[]',p) for p in QB/RB/WR/TE/K/DEF]; "
            f"User-Agent={sources.USER_AGENT!r} (pipeline/sources.py::fetch_sleeper_adp shape)",
            sleeper_raw,
            sleeper_rows,
        ),
    }

    espn_name = "espn-leaguedefaults-2025.raw.json"
    (TARGET_DIR / espn_name).write_bytes(espn_raw)
    espn_entry = file_entry(
        espn_name,
        espn_projections.ESPN_DEFAULTS_URL.format(season=SEASON),
        "GET params={'view':'kona_player_info'}; header x-fantasy-filter="
        '{"players":{"filterSlotIds":{"value":[0,2,4,6,17,16]},"limit":1500,'
        '"sortPercOwned":{"sortAsc":false,"sortPriority":100}}} '
        "(pipeline/espn_projections.py::fetch_espn_projections shape); canonical-key-sorted "
        "re-serialization of the parsed payload production consumes",
        espn_raw,
        espn_players,
    )
    espn_entry["playersReturned"] = espn_players
    espn_entry["entriesWithSeasonProjection"] = espn_entries
    written["espnLeaguedefaults"] = espn_entry

    weekly_files = []
    for week in WEEKS:
        name = f"sleeper-weekly-stats-2025-week-{week:02d}.raw.json"
        (TARGET_DIR / name).write_bytes(weekly[week][0])
        weekly_files.append(file_entry(
            name,
            f"{sources.SLEEPER_BASE}{sources.SLEEPER_WEEKLY_STATS_PATH.format(season=SEASON, week=week)}",
            f"User-Agent={sources.USER_AGENT!r} (pipeline/sources.py::fetch_sleeper_weekly_stats shape)",
            weekly[week][0],
            weekly[week][1],
        ))
    written["weeklyStats"] = {"weeks": list(WEEKS), "files": weekly_files}

    provenance = {
        "schemaVersion": 1,
        "frozenAt": fetched_at,
        "gitCommit": git_commit(),
        "purpose": (
            "Step A/A2 freeze for the blend-vs-FFToday backtest ladder "
            "(fixtures/backtest/2025/gates-blend-addendum.md sections 1-2). Verbatim retrievable "
            "2025 source bytes + raw weekly outcomes. Evaluation input: do not regenerate; do not "
            "re-fetch silently."
        ),
        "vintageStatus": (
            "UNVERIFIED - both projection sources FAILED the 2026-08-23 audit's pre-declared "
            "vintage rule. This freeze pins today's post-resync bytes; it cannot recover "
            "August-2025 values. Proceeding only under the addendum's asymmetric decision rule."
        ),
        "vintageCaveatsFromAudit": {
            "auditReport": "benchmarks/reports/2026-08-23-projection-vintage-audit.json",
            "sleeper": (
                "every row bulk re-synced last_modified = 2026-01-04T09:21Z (~20 s spread, one "
                "batch); rows carry 2025 rosters (Kyler Murray team=ARI) and gp=18; r=0.786 vs "
                "actuals (n=567)"
            ),
            "espn": "payload carries no as-of field of any kind; r=0.794 vs half-PPR actuals (n=478)",
        },
        "inputs": written,
    }
    prov_path = TARGET_DIR / "provenance.json"
    prov_path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")

    print(f"\n[frozen] {TARGET_DIR}")
    for key, entry in written.items():
        if key == "weeklyStats":
            print(f"  {key}: {len(entry['files'])} week files")
        else:
            print(f"  {key}: {entry['file']} ({entry['bytes']} bytes, sha256 {entry['sha256'][:16]}...)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
