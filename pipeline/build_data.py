#!/usr/bin/env python
"""
Regenerates data/*.json from live upstream sources (Sleeper, FFC, DynastyProcess).

Run via `npm run pipeline` locally, or on a schedule by
.github/workflows/refresh-data.yml. Exits non-zero if the crosswalk coverage
gate fails, which should block the workflow from committing degraded data —
see match.py's docstring for why the threshold below is 0.95 rather than 1.0.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import match
import sources
import transform

DEFAULT_SEASON = "2026"
COVERAGE_GATE_FORMAT = "ppr"  # largest FFC sample (~4600+ drafts) -> most stable signal
COVERAGE_GATE_THRESHOLD = 0.97  # verified achievable at 1.00 on the initial snapshot; buffer left for future edge cases

# Bumped whenever a source's manifest entry shape changes (fields added/removed/
# retyped) so consumers can detect a manifest from an older pipeline version
# instead of guessing from field presence.
SOURCE_SCHEMA_VERSION = 1


def _source_entry(url: str, rows: int, fetched_at: str, status: str = "ok") -> dict[str, Any]:
    """One `manifest.sources[*]` entry. `status` is 'ok' unless/until the
    pipeline gains a fallback path that can reuse stale data after a failed
    fetch — today a failed fetch raises and no manifest is written at all."""
    return {
        "url": url,
        "rows": rows,
        "fetchedAt": fetched_at,
        "schemaVersion": SOURCE_SCHEMA_VERSION,
        "status": status,
    }


def _write_json(path: Path, obj: Any) -> int:
    payload = json.dumps(obj, separators=(",", ":"), default=transform.to_json_ready)
    path.write_text(payload, encoding="utf-8")
    return len(payload.encode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", default=DEFAULT_SEASON)
    parser.add_argument("--teams", type=int, default=12, help="League size FFC's ADP is computed for")
    parser.add_argument("--out-dir", default=str(Path(__file__).resolve().parent.parent / "data"))
    parser.add_argument(
        "--coverage-threshold",
        type=float,
        default=COVERAGE_GATE_THRESHOLD,
        help="Fail the run if top-300 ADP crosswalk match rate drops below this",
    )
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.now(timezone.utc).isoformat()
    manifest_sources: dict[str, dict[str, Any]] = {}

    print(f"[1/5] Fetching Sleeper player pool (season {args.season})...")
    sleeper_players = sources.fetch_sleeper_players()
    manifest_sources["sleeper_players"] = _source_entry(
        f"{sources.SLEEPER_BASE}/v1/players/nfl", len(sleeper_players), fetched_at
    )

    print("[2/5] Fetching Sleeper season projections...")
    raw_projections = sources.fetch_sleeper_season_projections(args.season)
    manifest_sources["sleeper_season_projections"] = _source_entry(
        f"{sources.SLEEPER_BASE}/projections/nfl/{args.season}", len(raw_projections), fetched_at
    )

    print("[3/5] Fetching DynastyProcess player ID crosswalk...")
    dp_rows = sources.fetch_dynastyprocess_crosswalk()
    manifest_sources["dynastyprocess_playerids"] = _source_entry(
        sources.DYNASTYPROCESS_PLAYERIDS_URL, len(dp_rows), fetched_at
    )

    print("[4/5] Fetching FFC ADP for", ", ".join(sources.ADP_FORMATS))
    ffc_by_format: dict[str, list[dict[str, Any]]] = {}
    for fmt in sources.ADP_FORMATS:
        ffc_by_format[fmt] = sources.fetch_ffc_adp(fmt, teams=args.teams, year=int(args.season))
        manifest_sources[f"ffc_adp_{fmt}"] = _source_entry(
            f"{sources.FFC_BASE}/adp/{fmt}?teams={args.teams}&year={args.season}",
            len(ffc_by_format[fmt]),
            fetched_at,
        )

    print("[5/5] Transforming and writing data/*.json...")
    players = transform.build_player_meta(sleeper_players, dp_rows)
    projections = transform.build_season_projections(raw_projections, set(players.keys()))

    # Built once and reused across every ADP format below: the index depends
    # only on sleeper_players, which doesn't change between formats, so
    # rebuilding it per format was pure repeated work over the ~12k-14k
    # player pool.
    sleeper_index = match.build_sleeper_match_index(sleeper_players)

    adp_by_format: dict[str, list[transform.AdpEntry]] = {}
    gate_diagnostics: dict[str, Any] | None = None
    for fmt, raw in ffc_by_format.items():
        entries, diagnostics = transform.build_adp_entries(raw, sleeper_index)
        adp_by_format[fmt] = entries
        if fmt == COVERAGE_GATE_FORMAT:
            gate_diagnostics = diagnostics
            transform.backfill_bye_weeks(players, entries)

    assert gate_diagnostics is not None, f"COVERAGE_GATE_FORMAT={COVERAGE_GATE_FORMAT!r} not in ADP_FORMATS"

    # Numeric sleeper_ids sort numerically; DEF entries (team abbreviations
    # like "DEN") sort alphabetically after them.
    def _player_sort_key(pid: str) -> tuple[int, int | str]:
        return (0, int(pid)) if pid.isdigit() else (1, pid)

    players_sorted = [players[pid] for pid in sorted(players.keys(), key=_player_sort_key)]

    sizes = {
        "players.json": _write_json(out_dir / "players.json", players_sorted),
        "projections-season.json": _write_json(out_dir / "projections-season.json", projections),
    }
    for fmt, entries in adp_by_format.items():
        sizes[f"adp-{fmt}.json"] = _write_json(out_dir / f"adp-{fmt}.json", entries)

    manifest = {
        "builtAt": fetched_at,
        "season": args.season,
        "week": None,  # populated by the Track B weekly pipeline once in-season
        "sources": manifest_sources,
        "crosswalk": {
            "totalPlayers": len(players),
            "top300MatchRate": gate_diagnostics["top300MatchRate"],
            "unmatchedTop300": gate_diagnostics["unmatchedTop300"],
        },
    }
    sizes["manifest.json"] = _write_json(out_dir / "manifest.json", manifest)

    print()
    print("Wrote:")
    for name, size in sizes.items():
        print(f"  data/{name:<28} {size / 1024:>8.1f} KB")
    print()
    print(f"Players: {len(players)}  Season projections: {len(projections)}")
    print(
        f"Crosswalk coverage (top {gate_diagnostics['sampleSize']} by {COVERAGE_GATE_FORMAT} ADP): "
        f"{gate_diagnostics['top300MatchRate']:.1%}"
    )

    if gate_diagnostics["top300MatchRate"] < args.coverage_threshold:
        print()
        print(
            f"COVERAGE GATE FAILED: {gate_diagnostics['top300MatchRate']:.1%} "
            f"< required {args.coverage_threshold:.1%}"
        )
        print("Unmatched:", ", ".join(gate_diagnostics["unmatchedTop300"]))
        return 1

    print("Coverage gate passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
