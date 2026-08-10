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
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import match
import context
import history
import nflverse_source
import sources
import transform
from fftoday import FFTodayProjectionProvider, validate_projection_gates

DEFAULT_SEASON = "2026"
COVERAGE_GATE_FORMAT = "ppr"  # largest FFC sample (~4600+ drafts) -> most stable signal
COVERAGE_GATE_THRESHOLD = 0.97  # verified achievable at 1.00 on the initial snapshot; buffer left for future edge cases

# Below this many usable rows (post-999-sentinel-filter) for a format, Sleeper's
# ADP is considered too sparse to serve and that format falls back to the
# retained FFC board instead. Buffer under the ~311 usable PPR rows observed
# live; this is a per-format soft fallback, not a build-failing gate — FFC
# remains the hard-gated safety net (COVERAGE_GATE_THRESHOLD, above).
SLEEPER_ADP_MIN_ROWS = 250

# Bumped whenever a source's manifest entry shape changes (fields added/removed/
# retyped) so consumers can detect a manifest from an older pipeline version
# instead of guessing from field presence.
SOURCE_SCHEMA_VERSION = 2


def select_active_adp(
    sleeper_entries: list[transform.AdpEntry],
    ffc_entries: list[transform.AdpEntry],
    *,
    sleeper_error: str | None,
    min_rows: int = SLEEPER_ADP_MIN_ROWS,
) -> tuple[list[transform.AdpEntry], str]:
    """Pick the committed board for one format and name the winner explicitly.

    Returns `(entries, active_source)` where `active_source` is `'sleeper'` or
    `'ffc-fallback'`. Sleeper wins only when the fetch succeeded and the
    post-sentinel usable row count clears `min_rows`; otherwise FFC is the
    retained safety net. Pure function of already-built entry lists — tested
    directly so the fallback trigger can't silently regress.
    """
    if sleeper_error is None and len(sleeper_entries) >= min_rows:
        return sleeper_entries, "sleeper"
    return ffc_entries, "ffc-fallback"

def active_projection_diagnostics(
    entries: list[transform.AdpEntry],
    projections: list[transform.SeasonProjection],
    *,
    limit: int = 300,
) -> dict[str, Any]:
    """Coverage of the board actually committed for the projection gate format."""
    top = entries[:limit]
    projected_ids = {projection.playerId for projection in projections}
    unmatched = [entry.name for entry in top if entry.playerId is None or entry.playerId not in projected_ids]
    return {
        "top300MatchRate": round((len(top) - len(unmatched)) / len(top), 4) if top else 0.0,
        "unmatchedTop300": unmatched,
        "sampleSize": len(top),
    }

def _source_entry(url: str, rows: int, fetched_at: str, status: str = "ok") -> dict[str, Any]:
    """One manifest source entry; context sources may fail open with error status."""
    return {
        "url": url,
        "rows": rows,
        "fetchedAt": fetched_at,
        "schemaVersion": SOURCE_SCHEMA_VERSION,
        "status": status,
    }


def _sanitized_diagnostic(error: BaseException) -> str:
    message = re.sub(r"https?://\S+", "[url]", str(error))
    message = message.replace(str(Path.cwd()), "[workspace]")
    return f"{type(error).__name__}: {message}"[:240]


def _build_context_artifact(
    players: dict[str, transform.PlayerMeta],
    ppr_adp: list[transform.AdpEntry],
    draft_season: int,
    fetched_at: str,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, dict[str, Any]]]:
    history_seasons = list(range(draft_season - 3, draft_season))
    source_entries: dict[str, dict[str, Any]] = {}
    frames: dict[str, list[dict[str, Any]]] = {}

    try:
        loaders = nflverse_source.loaders()
    except Exception as error:
        diagnostic = _sanitized_diagnostic(error)
        for name, url in nflverse_source.SOURCE_URLS.items():
            source_entries[name] = {
                **_source_entry(url, 0, fetched_at, status="error"),
                "diagnostic": diagnostic,
            }
        coverage = context.coverage_report(players, ppr_adp, {})
        return {}, {
            "usageSeason": draft_season - 1,
            "historySeasons": history_seasons,
            "diagnostics": {"error": diagnostic},
            "coverage": coverage,
        }, source_entries

    for name, loader in loaders.items():
        try:
            rows = nflverse_source.to_rows(loader(history_seasons))
            context.assert_no_season_leakage(rows, draft_season, name)
            frames[name] = rows
            source_entries[name] = _source_entry(
                nflverse_source.SOURCE_URLS[name], len(rows), fetched_at,
            )
        except Exception as error:
            source_entries[name] = {
                **_source_entry(
                    nflverse_source.SOURCE_URLS[name], 0, fetched_at, status="error",
                ),
                "diagnostic": _sanitized_diagnostic(error),
            }

    optional_errors: dict[str, str] = {}
    try:
        optional_loaders = nflverse_source.optional_loaders()
    except Exception as error:
        optional_loaders = {}
        optional_errors["nflverse_pbp"] = _sanitized_diagnostic(error)
    for name, loader in optional_loaders.items():
        try:
            rows = nflverse_source.to_rows(loader(history_seasons))
            context.assert_no_season_leakage(rows, draft_season, name)
            frames[name] = rows
            source_entries[name] = _source_entry(
                nflverse_source.SOURCE_URLS[name], len(rows), fetched_at,
            )
        except Exception as error:
            diagnostic = _sanitized_diagnostic(error)
            optional_errors[name] = diagnostic
            source_entries[name] = {
                **_source_entry(
                    nflverse_source.SOURCE_URLS[name], 0, fetched_at, status="error",
                ),
                "diagnostic": diagnostic,
            }

    if any(name not in frames for name in loaders):
        diagnostic = "One or more nflverse sources failed; context artifact cleared"
        coverage = context.coverage_report(players, ppr_adp, {})
        return {}, {
            "usageSeason": draft_season - 1,
            "historySeasons": history_seasons,
            "diagnostics": {"error": diagnostic},
            "coverage": coverage,
        }, source_entries

    try:
        result = context.build_player_context(
            players,
            frames["nflverse_player_stats"],
            frames["nflverse_snap_counts"],
            frames["nflverse_weekly_rosters"],
            frames["nflverse_injuries"],
            draft_season,
            frames.get("nflverse_pbp"),
        )
    except Exception as error:
        diagnostic = _sanitized_diagnostic(error)
        for name, entry in source_entries.items():
            source_entries[name] = {**entry, "status": "error", "diagnostic": diagnostic}
        coverage = context.coverage_report(players, ppr_adp, {})
        return {}, {
            "usageSeason": draft_season - 1,
            "historySeasons": history_seasons,
            "diagnostics": {"error": diagnostic},
            "coverage": coverage,
        }, source_entries

    if optional_errors:
        result.diagnostics["optionalSourceErrors"] = optional_errors
    coverage = context.coverage_report(players, ppr_adp, result.usage)
    return result.usage, {
        "usageSeason": draft_season - 1,
        "historySeasons": history_seasons,
        "diagnostics": result.diagnostics,
        "coverage": coverage,
    }, source_entries


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

    print(f"[1/6] Fetching Sleeper player pool (season {args.season})...")
    sleeper_players = sources.fetch_sleeper_players()
    manifest_sources["sleeper_players"] = _source_entry(
        f"{sources.SLEEPER_BASE}/v1/players/nfl", len(sleeper_players), fetched_at
    )

    print("[2/6] Fetching DynastyProcess player ID crosswalk...")
    dp_rows = sources.fetch_dynastyprocess_crosswalk()
    manifest_sources["dynastyprocess_playerids"] = _source_entry(
        sources.DYNASTYPROCESS_PLAYERIDS_URL, len(dp_rows), fetched_at
    )

    print("[3/6] Fetching FFC ADP for", ", ".join(sources.ADP_FORMATS))
    ffc_by_format: dict[str, list[dict[str, Any]]] = {}
    ffc_meta_by_format: dict[str, dict[str, Any]] = {}
    for fmt in sources.ADP_FORMATS:
        payload = sources.fetch_ffc_adp_payload(fmt, teams=args.teams, year=int(args.season))
        ffc_by_format[fmt] = payload.get("players", [])
        meta = payload.get("meta") or {}
        ffc_meta_by_format[fmt] = meta
        manifest_sources[f"ffc_adp_{fmt}"] = {
            **_source_entry(
            f"{sources.FFC_BASE}/adp/{fmt}?teams={args.teams}&year={args.season}",
            len(ffc_by_format[fmt]),
            fetched_at,
            ),
            "population": {
                "mockDrafts": meta.get("total_drafts"),
                "teams": args.teams,
                "season": int(args.season),
                "format": fmt,
                "rows": len(ffc_by_format[fmt]),
            },
        }

    # Sleeper's ADP is the new canonical board (see PLAN.md's ADP-switch
    # writeup: FFC's mock-only lobby diverges from Sleeper's real draft-lobby
    # population by 15-20+ picks at TE). One GET returns every format's ADP
    # mean at once (unlike FFC, which needs one call per format), so a failure
    # here is caught once and degrades every format to its FFC fallback rather
    # than crashing the whole build — FFC stays the hard-gated safety net.
    print(f"[3/6] Fetching Sleeper draft-lobby ADP (season {args.season})...")
    sleeper_adp_url = f"{sources.SLEEPER_BASE}/projections/nfl/{args.season}"
    try:
        sleeper_adp_rows = sources.fetch_sleeper_adp(args.season)
        sleeper_adp_error: str | None = None
    except Exception as error:
        sleeper_adp_rows = []
        sleeper_adp_error = _sanitized_diagnostic(error)

    print("[4/6] Transforming core data...")
    players = transform.build_player_meta(sleeper_players, dp_rows)

    # Built once and reused across every ADP format below: the index depends
    # only on sleeper_players, which doesn't change between formats, so
    # rebuilding it per format was pure repeated work over the ~12k-14k
    # player pool.
    sleeper_index = match.build_sleeper_match_index(sleeper_players)

    # FFC entries are built for every format regardless of whether Sleeper's
    # board ends up canonical: they're the bye-week backfill source (Sleeper's
    # player object and its ADP rows carry no bye week at all), the
    # fitted-stdev calibration input, and the per-format fallback board.
    ffc_entries_by_format: dict[str, list[transform.AdpEntry]] = {}
    gate_diagnostics: dict[str, Any] | None = None
    for fmt, raw in ffc_by_format.items():
        entries, diagnostics = transform.build_adp_entries(raw, sleeper_index)
        ffc_entries_by_format[fmt] = entries
        if fmt == COVERAGE_GATE_FORMAT:
            gate_diagnostics = diagnostics
            transform.backfill_bye_weeks(players, entries)

    assert gate_diagnostics is not None, f"COVERAGE_GATE_FORMAT={COVERAGE_GATE_FORMAT!r} not in ADP_FORMATS"

    # Per-format soft fallback: Sleeper is canonical unless its endpoint failed
    # outright or a format came back too sparse (SLEEPER_ADP_MIN_ROWS), in which
    # case that one format's committed adp-<fmt>.json is the FFC board instead.
    # `adp_active_<fmt>` always names whichever source actually won, so the UI
    # disclosure never has to guess (and never silently mislabels a fallback
    # day as "Sleeper" — see CLAUDE.md's "never switch sources silently" rule).
    adp_by_format: dict[str, list[transform.AdpEntry]] = {}
    sleeper_entries_by_format: dict[str, list[transform.AdpEntry]] = {}
    for fmt in sources.ADP_FORMATS:
        cv_bands = transform.fit_adp_cv_bands(ffc_entries_by_format[fmt])
        if sleeper_adp_error is None:
            sleeper_entries, sleeper_diag = transform.build_sleeper_adp_entries(sleeper_adp_rows, fmt, cv_bands)
        else:
            sleeper_entries, sleeper_diag = [], {"sampleSize": 0}
        sleeper_entries_by_format[fmt] = sleeper_entries

        manifest_sources[f"sleeper_adp_{fmt}"] = {
            **_source_entry(
                sleeper_adp_url,
                sleeper_diag["sampleSize"],
                fetched_at,
                status="error" if sleeper_adp_error else "ok",
            ),
            **({"diagnostic": sleeper_adp_error} if sleeper_adp_error else {}),
        }

        chosen, active_source = select_active_adp(
            sleeper_entries,
            ffc_entries_by_format[fmt],
            sleeper_error=sleeper_adp_error,
        )
        adp_by_format[fmt] = chosen
        active_url = sleeper_adp_url if active_source == "sleeper" else f"{sources.FFC_BASE}/adp/{fmt}?teams={args.teams}&year={args.season}"
        manifest_sources[f"adp_active_{fmt}"] = {
            **_source_entry(active_url, len(chosen), fetched_at),
            "activeAdpSource": active_source,
        }

    # Coverage-gate ADP entries double as the projection provider's top-ADP
    # sample, so a rookie/traded player who is highly drafted but silently
    # unmatched by FFToday fails loudly instead of just vanishing from boards.
    top_adp_ids = [entry.playerId for entry in adp_by_format[COVERAGE_GATE_FORMAT][:300] if entry.playerId]
    projection_result = FFTodayProjectionProvider(sleeper_players).load(args.season, top_adp_ids=top_adp_ids)
    projections = projection_result.projections
    manifest_sources['fftoday_projections'] = {
        'url': projection_result.source_url,
        'rows': len(projections),
        'fetchedAt': projection_result.fetched_at,
        'upstreamUpdatedAt': projection_result.upstream_updated_at,
        'schemaVersion': SOURCE_SCHEMA_VERSION,
        'status': 'ok',
    }

    print("[5/6] Building fail-open player context...")
    active_diagnostics = active_projection_diagnostics(adp_by_format[COVERAGE_GATE_FORMAT], projections)
    player_usage, context_manifest, context_sources = _build_context_artifact(
        players,
        adp_by_format[COVERAGE_GATE_FORMAT],
        int(args.season),
        fetched_at,
    )
    manifest_sources.update(context_sources)

    # Numeric sleeper_ids sort numerically; DEF entries (team abbreviations
    # like "DEN") sort alphabetically after them.
    def _player_sort_key(pid: str) -> tuple[int, int | str]:
        return (0, int(pid)) if pid.isdigit() else (1, pid)

    players_sorted = [players[pid] for pid in sorted(players.keys(), key=_player_sort_key)]

    # All source and coverage validation happens before the first artifact is
    # written, so a failed refresh leaves the last successful snapshot intact.
    if gate_diagnostics['top300MatchRate'] < args.coverage_threshold:
        print('COVERAGE GATE FAILED: preserving the last successful artifact.')
        return 1

    sizes = {
        "players.json": _write_json(out_dir / "players.json", players_sorted),
        "projections-season.json": _write_json(out_dir / "projections-season.json", projections),
        "player-usage.json": _write_json(out_dir / "player-usage.json", player_usage),
    }
    for fmt, entries in adp_by_format.items():
        sizes[f"adp-{fmt}.json"] = _write_json(out_dir / f"adp-{fmt}.json", entries)

    print("[6/6] Appending ADP history snapshot...")
    sleeper_upstream = history.sleeper_upstream_updated_at(sleeper_adp_rows)
    for fmt in sources.ADP_FORMATS:
        ffc_meta = ffc_meta_by_format.get(fmt) or {}
        ffc_window = {
            "startDate": ffc_meta.get("start_date"),
            "endDate": ffc_meta.get("end_date"),
            "totalDrafts": ffc_meta.get("total_drafts"),
        }
        history_bytes = history.append_snapshot(
            out_dir, fmt, fetched_at,
            sleeper_entries=sleeper_entries_by_format.get(fmt),
            ffc_entries=ffc_entries_by_format.get(fmt),
            ffc_window=ffc_window,
            sleeper_upstream_updated_at=sleeper_upstream,
        )
        if history_bytes:
            sizes[f"history/adp-{fmt}.jsonl (appended)"] = history_bytes

    manifest = {
        "builtAt": fetched_at,
        "season": args.season,
        "week": None,  # populated by the Track B weekly pipeline once in-season
        "sources": manifest_sources,
        "crosswalk": {
            "totalPlayers": len(players),
            "top300MatchRate": active_diagnostics["top300MatchRate"],
            "unmatchedTop300": active_diagnostics["unmatchedTop300"],
        },
        "context": context_manifest,
    }
    sizes["manifest.json"] = _write_json(out_dir / "manifest.json", manifest)

    print()
    print("Wrote:")
    for name, size in sizes.items():
        print(f"  data/{name:<28} {size / 1024:>8.1f} KB")
    print()
    print(
        f"Players: {len(players)}  Season projections: {len(projections)}  "
        f"Player context: {len(player_usage)}"
    )
    print(
        f"Active-board projection coverage (top {active_diagnostics['sampleSize']} by {COVERAGE_GATE_FORMAT} ADP): "
        f"{active_diagnostics['top300MatchRate']:.1%}"
    )
    coverage = context_manifest["coverage"]
    print(
        "Context coverage "
        f"({coverage['total']} top-200 PPR veterans): {coverage['covered']} covered, "
        f"{coverage['knownAbsent']} known absent, {coverage['missing']} missing "
        f"({coverage['matchRate']:.1%})"
    )

    print("Coverage gate passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
