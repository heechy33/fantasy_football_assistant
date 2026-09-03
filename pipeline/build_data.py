#!/usr/bin/env python
"""
Regenerates data/*.json from live upstream sources (Sleeper, FFC, DynastyProcess).

Run via `npm run pipeline` locally, or on a schedule by
.github/workflows/refresh-data.yml. Exits non-zero if the FFC→Sleeper crosswalk
coverage gate fails, which should block the workflow from committing degraded
data — see COVERAGE_GATE_THRESHOLD below (buffered under a verified 1.0 sample
so a single future edge-case miss doesn't brick the refresh).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import match
import context
import cbs_projections
import espn_adp
import espn_projections
import history
import nflverse_source
import provider_projections
import requests
import sources
import transform
import underdog_adp
import weekly_stats
import yahoo_adp
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

# ESPN's leaguedefaults ADP saturates at ~171 picks (every undrafted player's
# averageDraftPosition converges on the ceiling), so the honest head below the
# detected censor cutoff is ~168 rows. Below this many honest head rows the
# ESPN board is not shipped and adp-ppr.json stays the only engine input.
ESPN_ADP_MIN_ROWS = 120

# Yahoo draft-analysis (2026-09-XX, Phase 2): additive, fail-open, one board per
# scoring format Yahoo actually serves (standard/half-ppr/ppr, NOT 2qb). Each
# board's honest head is truncated at the detected censor cliff; the remaining
# tail is splice-sourced from Sleeper, clamped to the cutoff (mirroring ESPN's
# pattern). Yahoo publishes no freshness stamp so we explicitly write None
# rather than omitting the field -- the UI can say "unpublished" not "unknown".
YAHOO_ADP_FORMATS = ("standard", "half-ppr", "ppr")
YAHOO_ADP_MIN_ROWS = 120  # honest head floor; mirrors ESPN_ADP_MIN_ROWS
YAHOO_ADP_BOARD_FILENAME_TEMPLATE = "adp-yahoo-{fmt}.json"

# Underdog's best-ball ADP is a SEPARATE LANE, never blended into the redraft
# composites above: its own artifact / board key (half-PPR TE-premium), used
# for display/decoration and as raw market-spread material only — never an
# engine input. Underdog's own draft boards sit behind login and their pick'em
# API exposes no ADP path (every candidate endpoint 404s, verified 2026-08),
# so this lane points at Sharp Football Analysis's server-rendered republication
# of Underdog ADP — a THIRD-PARTY source, and the frontend labels it as such
# (the repo's honesty convention, cf. the per-player adpSource badge). The gate
# below is deliberately strict: any drift or shortfall fails open and leaves the
# prior committed board byte-identical.
UNDERDOG_ADP_URL = (
    "https://www.sharpfootballanalysis.com/fantasy/fantasy-football-adp-half-ppr-underdog-best-ball/"
)
UNDERDOG_BOARD_FILENAME = "adp-underdog-bestball.json"
# A real Underdog best-ball draft is ~20 rounds x 12+ teams of distinct
# players; below this many crosswalk-matched rows the page is considered
# degenerate (drift / truncated response), not merely sparse.
UNDERDOG_ADP_MIN_ROWS = 150

# Hand-maintained, committed same-day availability corrections (see
# transform.apply_status_overrides) — a repo-root-relative path independent of
# --out-dir, since this is an input the pipeline reads, never one it writes.
STATUS_OVERRIDES_PATH = Path(__file__).resolve().parent.parent / "data" / "player-status-overrides.json"


def _load_status_overrides(path: Path = STATUS_OVERRIDES_PATH) -> list[dict[str, Any]]:
    """Missing file or malformed JSON both fail open to an empty list — a typo in a
    hand-edited override file must never block the whole refresh."""
    if not path.exists():
        return []
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"[warn] player-status-overrides: could not read {path.name}: {_sanitized_diagnostic(error)}")
        return []
    if not isinstance(rows, list):
        print(f"[warn] player-status-overrides: {path.name} is not a JSON array; ignoring")
        return []
    return rows

# Bumped whenever a source's manifest entry shape changes (fields added/removed/
# retyped) so consumers can detect a manifest from an older pipeline version
# instead of guessing from field presence. v3: sleeper_weekly_stats introduces
# status: "partial" and the weeksFetched/weeksFailed fields.
SOURCE_SCHEMA_VERSION = 3

# Sleeper's weekly stats endpoint is undocumented; be polite about it. Weeks
# are fetched sequentially (not in parallel) with a short per-week retry.
WEEKLY_STATS_FETCH_ATTEMPTS = 2
WEEKLY_STATS_WEEK_COUNT = 18


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


@dataclass
class ContextArtifacts:
    usage: dict[str, Any]
    weekly: dict[str, list[dict[str, Any]]]
    weeklyStats: dict[str, Any]
    manifest: dict[str, Any]
    sources: dict[str, dict[str, Any]]


def _build_context_artifact(
    players: dict[str, transform.PlayerMeta],
    ppr_adp: list[transform.AdpEntry],
    draft_season: int,
    fetched_at: str,
    weekly_payloads: dict[int, dict[str, dict[str, Any]]],
    weeks_fetched: list[int],
) -> ContextArtifacts:
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
        return ContextArtifacts(
            usage={},
            weekly={},
            weeklyStats={},
            manifest={
                "usageSeason": draft_season - 1,
                "historySeasons": history_seasons,
                "diagnostics": {"error": diagnostic},
                "coverage": coverage,
            },
            sources=source_entries,
        )

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
        diagnostic = _sanitized_diagnostic(error)
        optional_loaders = {}
        # Give every known optional source (not just pbp) an error manifest
        # entry here -- otherwise a source added to OPTIONAL_SOURCE_NAMES after
        # pbp (e.g. schedules) would get no manifest entry at all on this
        # particular failure path.
        for name in nflverse_source.OPTIONAL_SOURCE_NAMES:
            optional_errors[name] = diagnostic
            source_entries[name] = {
                **_source_entry(nflverse_source.SOURCE_URLS[name], 0, fetched_at, status="error"),
                "diagnostic": diagnostic,
            }
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
        return ContextArtifacts(
            usage={},
            weekly={},
            weeklyStats={},
            manifest={
                "usageSeason": draft_season - 1,
                "historySeasons": history_seasons,
                "diagnostics": {"error": diagnostic},
                "coverage": coverage,
            },
            sources=source_entries,
        )

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
        return ContextArtifacts(
            usage={},
            weekly={},
            weeklyStats={},
            manifest={
                "usageSeason": draft_season - 1,
                "historySeasons": history_seasons,
                "diagnostics": {"error": diagnostic},
                "coverage": coverage,
            },
            sources=source_entries,
        )

    if optional_errors:
        result.diagnostics["optionalSourceErrors"] = optional_errors

    # Weekly Sleeper game-log artifact (data/weekly-stats.json). Built here,
    # not in main(), because it needs `frames` -- nflverse_weekly_rosters,
    # nflverse_player_stats, and (optional) nflverse_schedules -- which is
    # local to this function. A failure here is independent of usage/weekly:
    # it only clears weeklyStats, never the rest of the context artifact.
    usage_season = draft_season - 1
    weekly_stats_artifact: dict[str, Any] = {}
    try:
        # Same crosswalk construction as context.build_player_context: strip
        # padded DynastyProcess gsis strings so they still match clean
        # nflverse ids.
        gsis_to_player = {
            meta.ids["gsis"].strip(): pid
            for pid, meta in players.items()
            if meta.ids.get("gsis") and meta.ids["gsis"].strip()
        }
        weekly_stats_artifact, weekly_stats_diagnostics = weekly_stats.build_weekly_stats(
            weekly_payloads,
            weeks_fetched,
            players,
            gsis_to_player,
            frames.get("nflverse_schedules"),
            frames.get("nflverse_weekly_rosters"),
            frames.get("nflverse_player_stats", []),
            usage_season,
        )
        result.diagnostics["weeklyStats"] = weekly_stats_diagnostics
    except Exception as error:
        weekly_stats_artifact = {}
        result.diagnostics["weeklyStats"] = {"error": _sanitized_diagnostic(error)}

    coverage = context.coverage_report(players, ppr_adp, result.usage)
    return ContextArtifacts(
        usage=result.usage,
        weekly=result.weekly,
        weeklyStats=weekly_stats_artifact,
        manifest={
            "usageSeason": draft_season - 1,
            "historySeasons": history_seasons,
            "diagnostics": result.diagnostics,
            "coverage": coverage,
        },
        sources=source_entries,
    )


def _write_json(path: Path, obj: Any) -> int:
    payload = json.dumps(obj, separators=(",", ":"), default=transform.to_json_ready)
    path.write_text(payload, encoding="utf-8")
    return len(payload.encode("utf-8"))


def _run_provider_projections(
    sleeper_adp_rows: list[dict[str, Any]],
    valid_player_ids: set[str],
    *,
    season: str,
    out_dir: Path,
    fetched_at: str,
    sleeper_index: dict[Any, str],
    espn_id_to_player_id: dict[str, str],
    sleeper_error: str | None = None,
    espn_payload: dict[str, Any] | None = None,
    espn_payload_error: str | None = None,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], dict[str, Any]]:
    """Committed, deployed, display-only multi-provider projections artifact.
    Runs after the coverage gate so a gate failure preserves the previous
    artifact untouched. Each provider fails open independently (its own
    try/except, sanitized diagnostic, `[warn]` line, never a non-zero exit);
    Sleeper reuses the projection rows already fetched for ADP — zero new HTTP.
    Reading the previous artifact is the only filesystem IO here (carry-forward
    is the pure provider_projections.merge_and_assemble policy)."""
    artifact_path = out_dir / "projections-providers.json"
    previous: dict[str, Any] | None = None
    if artifact_path.exists():
        try:
            previous = json.loads(artifact_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            print(f"[warn] provider projections: could not read previous artifact: {_sanitized_diagnostic(error)}")

    # A malformed optional artifact must not break the core refresh.
    if not isinstance(previous, dict):
        previous = None
    elif (
        not isinstance(previous.get('providers'), list)
        or not all(isinstance(block, dict) and isinstance(block.get('key'), str) for block in previous['providers'])
        or not isinstance(previous.get('players'), dict)
    ):
        previous = None

    results: list[provider_projections.ProviderResult] = []
    source_entries: dict[str, dict[str, Any]] = {}

    # --- Sleeper (zero new HTTP: rows already fetched for ADP) ---
    sleeper_url = f"{sources.SLEEPER_BASE}/projections/nfl/{season}"
    try:
        if sleeper_error is not None:
            raise RuntimeError(sleeper_error)
        sleeper_result = provider_projections.sleeper_provider_result(
            sleeper_adp_rows, valid_player_ids, fetched_at=fetched_at,
        )
        results.append(sleeper_result)
        source_entries["sleeper_projections"] = _source_entry(
            sleeper_url, sleeper_result.block["rows"], fetched_at,
        )
    except Exception as error:
        diagnostic = _sanitized_diagnostic(error)
        print(f"[warn] sleeper projections: {diagnostic}")
        results.append(
            provider_projections.error_provider_result("sleeper", "Sleeper (Rotowire)", diagnostic=diagnostic)
        )
        source_entries["sleeper_projections"] = {
            **_source_entry(sleeper_url, 0, fetched_at, status="error"),
            "diagnostic": diagnostic,
        }

    # --- ESPN (payload fetched once in main(), shared with the ADP board;
    # DEF expected in positionsExcluded until the tiered scoring is mapped) ---
    espn_url = espn_projections.ESPN_DEFAULTS_URL.format(season=season)
    espn_error = espn_payload_error
    espn_result = None
    if espn_error is None:
        try:
            espn_result = espn_projections.espn_provider_result(
                espn_payload,
                season=int(season),
                sleeper_index=sleeper_index,
                espn_id_to_player_id=espn_id_to_player_id,
                valid_player_ids=valid_player_ids,
                fetched_at=fetched_at,
            )
        except Exception as error:
            espn_error = _sanitized_diagnostic(error)
    if espn_result is not None:
        results.append(espn_result)
        source_entries["espn_projections"] = _source_entry(
            espn_url, espn_result.block["rows"], fetched_at,
        )
    else:
        diagnostic = espn_error
        print(f"[warn] espn projections: {diagnostic}")
        results.append(
            provider_projections.error_provider_result("espn", "ESPN", diagnostic=diagnostic)
        )
        source_entries["espn_projections"] = {
            **_source_entry(espn_url, 0, fetched_at, status="error"),
            "diagnostic": diagnostic,
        }

    # --- CBS (one unauthenticated GET per position; DST expected excluded by
    # the reconciliation gate until the tiered points/yards scoring is mapped) ---
    cbs_url = cbs_projections.CBS_STATS_BASE.format(position="QB", season=season)
    try:
        cbs_pages = {
            position: cbs_projections.fetch_cbs_position_page(position, season)
            for position in cbs_projections.POSITIONS
        }
        cbs_result = cbs_projections.cbs_provider_result(
            cbs_pages,
            season=int(season),
            sleeper_index=sleeper_index,
            valid_player_ids=valid_player_ids,
            fetched_at=fetched_at,
        )
        results.append(cbs_result)
        source_entries["cbs_projections"] = _source_entry(
            cbs_url, cbs_result.block["rows"], fetched_at,
        )
    except Exception as error:
        diagnostic = _sanitized_diagnostic(error)
        print(f"[warn] cbs projections: {diagnostic}")
        results.append(
            provider_projections.error_provider_result("cbs", "CBS", diagnostic=diagnostic)
        )
        source_entries["cbs_projections"] = {
            **_source_entry(cbs_url, 0, fetched_at, status="error"),
            "diagnostic": diagnostic,
        }

    artifact = provider_projections.merge_and_assemble(
        previous,
        results,
        season=int(season),
        generated_at=fetched_at,
        now_iso=fetched_at,
    )
    _write_json(artifact_path, artifact)

    summary: dict[str, Any] = {
        "updatedAt": fetched_at,
        "providers": {
            block["key"]: {
                "status": block["status"],
                "rows": block["rows"],
                "staleSinceDays": block.get("staleSinceDays"),
                "diagnostic": block.get("diagnostic"),
            }
            for block in artifact["providers"]
        },
    }
    return artifact, source_entries, summary


def _build_espn_adp_board(
    espn_payload: dict[str, Any] | None,
    espn_payload_error: str | None,
    *,
    cv_bands: tuple[tuple[float, float], ...],
    espn_id_to_player_id: dict[str, str],
    sleeper_index: dict[Any, str],
    valid_player_ids: set[str],
    fallback_entries: list[transform.AdpEntry],
    ffc_cv_index: dict[str, tuple[float, int]] | None = None,
) -> tuple[list[transform.AdpEntry] | None, dict[str, Any]]:
    """Build the ESPN default-PPR ADP board, or fail open with (None, diagnostics).

    Never raises: fetch error, schema drift, a degenerate censor cutoff, or a
    board with fewer than ESPN_ADP_MIN_ROWS honest head rows all return None so
    the caller leaves adp-ppr.json untouched and records an error manifest
    entry. On success returns (entries, diagnostics) where diagnostics carries
    censorCutoff/espnRows/tailRows for the manifest.
    """
    if espn_payload_error is not None:
        return None, {"diagnostic": espn_payload_error, "censorCutoff": None, "espnRows": 0, "tailRows": 0}
    try:
        rows = espn_adp.parse_espn_adp_rows(espn_payload)
        entries, diagnostics = espn_adp.build_espn_adp_entries(
            rows,
            cv_bands=cv_bands,
            espn_id_to_player_id=espn_id_to_player_id,
            sleeper_index=sleeper_index,
            valid_player_ids=valid_player_ids,
            fallback_entries=fallback_entries,
            ffc_cv_index=ffc_cv_index,
        )
    except ValueError as error:
        return None, {"diagnostic": f"ValueError: {error}", "censorCutoff": None, "espnRows": 0, "tailRows": 0}
    if diagnostics["espnRows"] < ESPN_ADP_MIN_ROWS:
        return None, {
            **diagnostics,
            "diagnostic": f"espnRows {diagnostics['espnRows']} < ESPN_ADP_MIN_ROWS {ESPN_ADP_MIN_ROWS}",
        }
    return entries, diagnostics


def _build_yahoo_adp_board(
    rendered_html: str | None,
    render_error: str | None,
    *,
    cv_bands: tuple[tuple[float, float], ...],
    yahoo_id_to_player_id: dict[str, str],
    sleeper_index: dict[Any, str],
    valid_player_ids: set[str],
    fallback_entries: list[transform.AdpEntry],
    ffc_cv_index: dict[str, tuple[float, int]] | None = None,
) -> tuple[list[transform.AdpEntry] | None, dict[str, Any]]:
    """Build one Yahoo draft-analysis ADP board (per format), or fail open.

    Mirror of `_build_espn_adp_board`: never raises. Fetch error (Playwright
    missing, Chromium missing, page timeout), schema drift, degenerate
    censor cutoff, or fewer than YAHOO_ADP_MIN_ROWS honest head rows all
    return None so the caller leaves the relevant `adp-yahoo-<fmt>.json`
    untouched and records an error manifest entry. `rendered_html` is the
    table HTML the Playwright fetcher returned; `yahoo_adp.parse_yahoo_adp_rows`
    turns it into the same `ParsedYahooAdpRow` list the live fixture produces.
    """
    if render_error is not None:
        return None, {"diagnostic": render_error, "censorCutoff": None, "yahooRows": 0, "tailRows": 0}
    if rendered_html is None:
        return None, {"diagnostic": "Yahoo rendered_html is None", "censorCutoff": None, "yahooRows": 0, "tailRows": 0}
    try:
        rows = yahoo_adp.parse_yahoo_adp_rows(rendered_html)
        entries, diagnostics = yahoo_adp.build_yahoo_adp_entries(
            rows,
            cv_bands=cv_bands,
            yahoo_id_to_player_id=yahoo_id_to_player_id,
            sleeper_index=sleeper_index,
            valid_player_ids=valid_player_ids,
            fallback_entries=fallback_entries,
            ffc_cv_index=ffc_cv_index,
        )
    except ValueError as error:
        return None, {"diagnostic": f"ValueError: {error}", "censorCutoff": None, "yahooRows": 0, "tailRows": 0}
    if diagnostics["yahooRows"] < YAHOO_ADP_MIN_ROWS:
        return None, {
            **diagnostics,
            "diagnostic": f"yahooRows {diagnostics['yahooRows']} < YAHOO_ADP_MIN_ROWS {YAHOO_ADP_MIN_ROWS}",
        }
    return entries, diagnostics


def _fetch_underdog_adp(url: str = UNDERDOG_ADP_URL) -> str:
    """CLI-boundary fetch for the Underdog best-ball ADP page HTML.

    Lives here (not in sources.py) because this is the only consumer, the
    page is a third-party republication with no API contract, and keeping the
    URL next to the gate that polices it makes the fragility explicit. One
    GET, no retries — the strict fail-open below is cheaper than hammering a
    site we don't pay for.
    """
    resp = requests.get(url, headers={"User-Agent": sources.USER_AGENT}, timeout=sources.TIMEOUT)
    resp.raise_for_status()
    return resp.text


def _build_underdog_adp_board(
    page_html: str | None,
    payload_error: str | None,
    *,
    sleeper_index: dict[Any, str],
    valid_player_ids: set[str],
    cv_bands: tuple[tuple[float, float], ...],
) -> tuple[list[transform.AdpEntry] | None, dict[str, Any]]:
    """Build the Underdog best-ball ADP board, or fail open with (None, diagnostics).

    Never raises: fetch error, schema drift, or fewer than
    UNDERDOG_ADP_MIN_ROWS crosswalk-matched rows all return None so the caller
    leaves any prior data/adp-underdog-bestball.json BYTE-IDENTICAL. Unlike
    the ESPN lane (which deletes its stale board), nothing downstream treats
    the Underdog board as current-by-default — it is display/decoration and
    market-spread raw material only — so retaining the last good snapshot
    beats leaving consumers with no disclosure at all.

    On success returns (entries, diagnostics); diagnostics always carries
    `upstreamUpdatedAt` (None when the page publishes no freshness stamp).
    """
    if payload_error is not None:
        return None, {
            "diagnostic": payload_error,
            "upstreamUpdatedAt": None,
            "rawRows": 0,
            "matchedRows": 0,
        }
    try:
        rows = underdog_adp.parse_underdog_adp_rows(page_html)
        upstream_updated_at = underdog_adp.extract_upstream_updated_at(page_html)
        entries, diagnostics = underdog_adp.build_underdog_adp_entries(
            rows,
            sleeper_index=sleeper_index,
            valid_player_ids=valid_player_ids,
            cv_bands=cv_bands,
        )
    except ValueError as error:
        return None, {
            "diagnostic": f"ValueError: {error}",
            "upstreamUpdatedAt": None,
            "rawRows": 0,
            "matchedRows": 0,
        }
    if diagnostics["matchedRows"] < UNDERDOG_ADP_MIN_ROWS:
        return None, {
            **diagnostics,
            "upstreamUpdatedAt": upstream_updated_at,
            "diagnostic": (
                f"matchedRows {diagnostics['matchedRows']} < UNDERDOG_ADP_MIN_ROWS {UNDERDOG_ADP_MIN_ROWS}"
            ),
        }
    return entries, {**diagnostics, "upstreamUpdatedAt": upstream_updated_at}


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

    print(f"[1/9] Fetching Sleeper player pool (season {args.season})...")
    sleeper_players = sources.fetch_sleeper_players()
    manifest_sources["sleeper_players"] = _source_entry(
        f"{sources.SLEEPER_BASE}/v1/players/nfl", len(sleeper_players), fetched_at
    )

    print("[2/9] Fetching DynastyProcess player ID crosswalk...")
    dp_rows = sources.fetch_dynastyprocess_crosswalk()
    manifest_sources["dynastyprocess_playerids"] = _source_entry(
        sources.DYNASTYPROCESS_PLAYERIDS_URL, len(dp_rows), fetched_at
    )

    print("[3/9] Fetching FFC ADP for", ", ".join(sources.ADP_FORMATS))
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
                # FFC's ADP is a rolling pooled average over this window (e.g. "Aug 24-31"), which
                # under-reacts to same-day news by construction — surfaced so the UI can label the
                # number honestly instead of implying it's live. See DataHealth's freshness panel.
                "startDate": meta.get("start_date"),
                "endDate": meta.get("end_date"),
            },
        }

    # Sleeper's ADP is the new canonical board (see PLAN.md's ADP-switch
    # writeup: FFC's mock-only lobby diverges from Sleeper's real draft-lobby
    # population by 15-20+ picks at TE). One GET returns every format's ADP
    # mean at once (unlike FFC, which needs one call per format), so a failure
    # here is caught once and degrades every format to its FFC fallback rather
    # than crashing the whole build — FFC stays the hard-gated safety net.
    print(f"[4/9] Fetching Sleeper draft-lobby ADP (season {args.season})...")
    sleeper_adp_url = f"{sources.SLEEPER_BASE}/projections/nfl/{args.season}"
    try:
        sleeper_adp_rows = sources.fetch_sleeper_adp(args.season)
        sleeper_adp_error: str | None = None
    except Exception as error:
        sleeper_adp_rows = []
        sleeper_adp_error = _sanitized_diagnostic(error)

    print("[5/9] Transforming core data + season projections...")
    players = transform.build_player_meta(sleeper_players, dp_rows)
    try:
        draft_applied = transform.apply_nflverse_draft(players, nflverse_source.load_player_table())
        print(f"    nflverse draft bio applied to {draft_applied} players")
    except Exception as error:
        print(f"    nflverse draft bio skipped: {_sanitized_diagnostic(error)}")

    status_overrides = _load_status_overrides()
    override_warnings = transform.apply_status_overrides(players, status_overrides, fetched_at[:10])
    for warning in override_warnings:
        print(f"    [warn] {warning}")
    if status_overrides:
        print(f"    {len(status_overrides)} player-status override(s) applied")

    # Built once and reused across every ADP format below: the index depends
    # only on sleeper_players, which doesn't change between formats, so
    # rebuilding it per format was pure repeated work over the ~12k-14k
    # player pool.
    sleeper_index = match.build_sleeper_match_index(sleeper_players)

    # ESPN's kona payload is fetched exactly once and shared by both consumers:
    # the ESPN ADP board (below) and the provider-projections step (step 8).
    # Hoisted because espn_payload used to be a local inside
    # _run_provider_projections and unreachable from here — this keeps one GET
    # and one mock seam for the whole run. espn_id_to_player_id is needed by
    # the ADP board before step 8 runs, so it is hoisted alongside.
    espn_id_to_player_id = {
        str(meta.ids["espn"]): player_id
        for player_id, meta in players.items()
        if "espn" in (meta.ids or {})
    }
    try:
        espn_payload = espn_projections.fetch_espn_projections(args.season)
        espn_payload_error: str | None = None
    except Exception as error:
        espn_payload = None
        espn_payload_error = _sanitized_diagnostic(error)

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
        # Phase 2c H2 (build_ffc_cv_index / fitted_stdev_for_player) was implemented and
        # gate-checked against the pinned FFC snapshot and the two held-out ESPN human
        # drafts: it improved the bot cohort but *regressed* human Brier on both the
        # analytic (+0.000272) and all-seat (+0.000025) metrics, failing its own
        # pre-declared "human Brier must strictly improve" gate. Per the Phase 2c
        # decision rule, it does not ship — the flat band CV (`fitted_stdev`) stays
        # production. The tested mechanism remains available in transform.py for a
        # future attempt (more human data, a different shrinkage prior, or paired
        # with an H1 fix) — see the 2026-08-21 correction in
        # benchmarks/reports/2026-08-20-ffc-survival-diagnosis-interpretation.md.
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
            # Explicit `None`, not an absent key: Sleeper's draft-lobby ADP publishes no freshness
            # window at all (unlike FFC's start/end dates below) — "we looked and there isn't one",
            # not "we didn't check". Lets the freshness panel render "window unpublished" honestly.
            "upstreamUpdatedAt": None,
            **({"diagnostic": sleeper_adp_error} if sleeper_adp_error else {}),
        }

        chosen, active_source = select_active_adp(
            sleeper_entries,
            ffc_entries_by_format[fmt],
            sleeper_error=sleeper_adp_error,
        )
        adp_by_format[fmt] = chosen
        active_url = sleeper_adp_url if active_source == "sleeper" else f"{sources.FFC_BASE}/adp/{fmt}?teams={args.teams}&year={args.season}"
        active_ffc_meta = ffc_meta_by_format.get(fmt) or {}
        manifest_sources[f"adp_active_{fmt}"] = {
            **_source_entry(active_url, len(chosen), fetched_at),
            "activeAdpSource": active_source,
            # Neither winner publishes a single "updated at" timestamp — Sleeper publishes no
            # freshness signal at all, FFC publishes a pooled date *range* instead (below). Explicit
            # `None`, not an absent key, so the UI can say "unpublished" rather than "unknown".
            "upstreamUpdatedAt": None,
            # Whichever board actually won carries its real freshness window so the UI never has to
            # cross-reference the sibling `sleeper_adp_<fmt>` / `ffc_adp_<fmt>` entries to answer
            # "how fresh is this?". `None` when the winner (Sleeper) has no window to report.
            "freshnessWindow": None if active_source == "sleeper" else {
                "mockDrafts": active_ffc_meta.get("total_drafts"),
                "startDate": active_ffc_meta.get("start_date"),
                "endDate": active_ffc_meta.get("end_date"),
            },
        }

    # ESPN default-PPR board (additive — adp-ppr.json stays the Sleeper path).
    # Fail-open: fetch error, schema drift, degenerate censor cutoff, or too
    # few honest head rows all keep adp-ppr.json untouched, record an error
    # manifest entry, and remove any stale ESPN board so it can't look current.
    espn_url = espn_projections.ESPN_DEFAULTS_URL.format(season=args.season)
    # ffc_cv_index intentionally omitted (defaults to None): Phase 2c H2 failed its
    # own gate against the held-out human drafts (see the note above the Sleeper ADP
    # loop) and does not ship. `_build_espn_adp_board` keeps the parameter so a future
    # attempt can wire it back in without touching this call site's other arguments.
    espn_entries, espn_adp_diag = _build_espn_adp_board(
        espn_payload,
        espn_payload_error,
        cv_bands=transform.fit_adp_cv_bands(ffc_entries_by_format["ppr"]),
        espn_id_to_player_id=espn_id_to_player_id,
        sleeper_index=sleeper_index,
        valid_player_ids=set(players),
        fallback_entries=adp_by_format["ppr"],
    )
    if espn_entries is not None:
        adp_by_format["espn-ppr"] = espn_entries
        manifest_sources["espn_adp_ppr"] = {
            **_source_entry(espn_url, len(espn_entries), fetched_at),
            # ESPN's leaguedefaults endpoint publishes no freshness stamp — explicit `None`, not an
            # absent key, so the UI can say "unpublished" rather than "unknown" (see the matching
            # Sleeper ADP comment above).
            "upstreamUpdatedAt": None,
            **espn_adp_diag,
        }
        manifest_sources["adp_active_espn_ppr"] = {
            **_source_entry(espn_url, len(espn_entries), fetched_at),
            "activeAdpSource": "espn",
            "upstreamUpdatedAt": None,
        }
    else:
        print(f"[warn] espn adp: {espn_adp_diag['diagnostic']}")
        manifest_sources["espn_adp_ppr"] = {
            **_source_entry(espn_url, 0, fetched_at, status="error"),
            **espn_adp_diag,
        }
        stale = out_dir / "adp-espn-ppr.json"
        if stale.exists():
            stale.unlink()

    # Underdog best-ball ADP — the separate best-ball lane. Parsed into its
    # own artifact / board key and deliberately NEVER added to adp_by_format,
    # so it cannot leak into the redraft composites, the coverage-gate ADP
    # sample below, or history.append_snapshot. Fail-open with a byte-identical
    # prior artifact (see _build_underdog_adp_board).
    try:
        underdog_payload = _fetch_underdog_adp()
        underdog_payload_error: str | None = None
    except Exception as error:
        underdog_payload = None
        underdog_payload_error = _sanitized_diagnostic(error)
    underdog_entries, underdog_diag = _build_underdog_adp_board(
        underdog_payload,
        underdog_payload_error,
        sleeper_index=sleeper_index,
        valid_player_ids=set(players),
        cv_bands=transform.fit_adp_cv_bands(ffc_entries_by_format["half-ppr"]),
    )
    if underdog_entries is not None:
        transform.apply_player_bye_weeks_to_adp(underdog_entries, players)
        manifest_sources["underdog_bestball"] = {
            **_source_entry(UNDERDOG_ADP_URL, len(underdog_entries), fetched_at),
            "sourceUrls": [UNDERDOG_ADP_URL],
            **underdog_diag,
        }
    else:
        print(f"[warn] underdog adp: {underdog_diag['diagnostic']}")
        manifest_sources["underdog_bestball"] = {
            **_source_entry(UNDERDOG_ADP_URL, 0, fetched_at, status="error"),
            "sourceUrls": [UNDERDOG_ADP_URL],
            **underdog_diag,
        }

    # Yahoo draft-analysis ADP (2026-09-XX, Phase 2): one additive board per
    # format Yahoo actually serves (standard/half-ppr/ppr, NOT 2qb). Same
    # fail-open pattern as the ESPN block: fetch error, schema drift, or
    # degenerate censor cutoff all keep the relevant adp-yahoo-<fmt>.json
    # untouched, record an error manifest entry, and remove any stale board so
    # it can't look current. Yahoo id crosswalk: ids.yahoo (mirrors espn's
    # ids.espn). Note: yahoo_id_to_player_id is computed once and reused across
    # all three formats (the same set of Sleeper players has Yahoo ids).
    yahoo_id_to_player_id = {
        str(meta.ids["yahoo"]): player_id
        for player_id, meta in players.items()
        if "yahoo" in (meta.ids or {})
    }
    for fmt in YAHOO_ADP_FORMATS:
        yahoo_url = sources.YAHOO_DRAFT_ANALYSIS_URL
        yahoo_rendered_html: str | None = None
        yahoo_render_error: str | None = None
        try:
            yahoo_rendered_html = sources.fetch_yahoo_draft_analysis_html(fmt)
        except Exception as error:
            yahoo_render_error = _sanitized_diagnostic(error)
        # Per-format fallback: the active Sleeper (or FFC) board for this format.
        # We must read it AFTER the per-format loop above so adp_by_format[fmt]
        # is populated. (It's safe: the FFC/Sleeper loop completes before this
        # block runs.)
        per_format_fallback = adp_by_format.get(fmt, [])
        # ffc_cv_index intentionally omitted (defaults to None): Phase 2c H2
        # failed its own gate against the held-out human drafts (see the note
        # above the Sleeper ADP loop) and does not ship. The parameter is kept
        # so a future attempt can wire it back in without touching this call
        # site's other arguments.
        yahoo_entries, yahoo_diag = _build_yahoo_adp_board(
            yahoo_rendered_html,
            yahoo_render_error,
            cv_bands=transform.fit_adp_cv_bands(ffc_entries_by_format[fmt]),
            yahoo_id_to_player_id=yahoo_id_to_player_id,
            sleeper_index=sleeper_index,
            valid_player_ids=set(players),
            fallback_entries=per_format_fallback,
        )
        if yahoo_entries is not None:
            transform.apply_player_bye_weeks_to_adp(yahoo_entries, players)
            adp_by_format[f"yahoo-{fmt}"] = yahoo_entries
            manifest_sources[f"yahoo_adp_{fmt}"] = {
                **_source_entry(yahoo_url, len(yahoo_entries), fetched_at),
                # Yahoo publishes no freshness stamp — explicit None, not an
                # absent key, so the UI can say "unpublished" rather than
                # "unknown" (mirrors the ESPN block's same caveat).
                "upstreamUpdatedAt": None,
                **yahoo_diag,
            }
            manifest_sources[f"adp_active_yahoo_{fmt}"] = {
                **_source_entry(yahoo_url, len(yahoo_entries), fetched_at),
                "activeAdpSource": "yahoo",
                "upstreamUpdatedAt": None,
            }
        else:
            print(f"[warn] yahoo adp [{fmt}]: {yahoo_diag['diagnostic']}")
            manifest_sources[f"yahoo_adp_{fmt}"] = {
                **_source_entry(yahoo_url, 0, fetched_at, status="error"),
                **yahoo_diag,
            }
            stale = out_dir / YAHOO_ADP_BOARD_FILENAME_TEMPLATE.format(fmt=fmt)
            if stale.exists():
                stale.unlink()

    # Coverage-gate ADP entries double as the projection provider's top-ADP
    # sample, so a rookie/traded player who is highly drafted but silently
    # unmatched by FFToday fails loudly instead of just vanishing from boards.
    top_adp_ids = [entry.playerId for entry in adp_by_format[COVERAGE_GATE_FORMAT][:300] if entry.playerId]
    projection_result = FFTodayProjectionProvider(sleeper_players).load(args.season, top_adp_ids=top_adp_ids)
    projections = projection_result.projections
    availability_scaled = transform.apply_availability_to_projections(projections, players)
    if availability_scaled:
        print(f"    availability-derated projections applied to {availability_scaled} players")
    # FFC covers the mock-lobby cohort; FFToday's Bye column covers the deeper
    # Sleeper lobby board that FFC never drafted. FFC wins on conflict (already
    # applied above) so a source disagreement doesn't thrash week-to-week.
    transform.backfill_bye_weeks_from_ids(players, projection_result.bye_weeks)
    for entries in adp_by_format.values():
        transform.apply_player_bye_weeks_to_adp(entries, players)
    manifest_sources['fftoday_projections'] = {
        'url': projection_result.source_url,
        'rows': len(projections),
        'fetchedAt': projection_result.fetched_at,
        'upstreamUpdatedAt': projection_result.upstream_updated_at,
        'schemaVersion': SOURCE_SCHEMA_VERSION,
        'status': 'ok',
    }

    # Undocumented, no schema contract -- weeks are fetched sequentially (not
    # in parallel) out of politeness, with a short per-week retry. A week that
    # still fails after retrying is recorded (not fabricated as an empty week)
    # so the client can tell "not fetched" apart from "fetched, no data".
    usage_season = int(args.season) - 1
    assert usage_season < int(args.season), "weekly stats must never target the draft season itself"
    print(f"[6/9] Fetching Sleeper weekly stats (season {usage_season}, {WEEKLY_STATS_FETCH_ATTEMPTS}x retry/week)...")
    weekly_payloads: dict[int, dict[str, dict[str, Any]]] = {}
    weeks_failed: dict[str, str] = {}
    for week in range(1, WEEKLY_STATS_WEEK_COUNT + 1):
        week_error: str | None = None
        for _attempt in range(WEEKLY_STATS_FETCH_ATTEMPTS):
            try:
                weekly_payloads[week] = sources.fetch_sleeper_weekly_stats(str(usage_season), week)
                week_error = None
                break
            except Exception as error:
                week_error = _sanitized_diagnostic(error)
        if week_error is not None:
            weeks_failed[str(week)] = week_error

    weeks_fetched = sorted(weekly_payloads.keys())
    if len(weeks_fetched) == WEEKLY_STATS_WEEK_COUNT:
        weekly_stats_status = "ok"
    elif weeks_fetched:
        weekly_stats_status = "partial"
    else:
        weekly_stats_status = "error"
    manifest_sources["sleeper_weekly_stats"] = {
        **_source_entry(
            f"{sources.SLEEPER_BASE}{sources.SLEEPER_WEEKLY_STATS_PATH.format(season=usage_season, week='<week>')}",
            sum(len(payload) for payload in weekly_payloads.values()),
            fetched_at,
            status=weekly_stats_status,
        ),
        "weeksFetched": weeks_fetched,
        "weeksFailed": weeks_failed,
    }
    if weeks_failed:
        print(f"  [warn] {len(weeks_failed)} of {WEEKLY_STATS_WEEK_COUNT} weeks failed: {sorted(weeks_failed)}")

    print("[7/9] Building fail-open player context...")
    active_diagnostics = active_projection_diagnostics(adp_by_format[COVERAGE_GATE_FORMAT], projections)
    context_artifacts = _build_context_artifact(
        players,
        adp_by_format[COVERAGE_GATE_FORMAT],
        int(args.season),
        fetched_at,
        weekly_payloads,
        weeks_fetched,
    )
    player_usage = context_artifacts.usage
    context_manifest = context_artifacts.manifest
    manifest_sources.update(context_artifacts.sources)

    # Numeric sleeper_ids sort numerically; DEF entries (team abbreviations
    # like "DEN") sort alphabetically after them.
    def _player_sort_key(pid: str) -> tuple[int, int | str]:
        return (0, int(pid)) if pid.isdigit() else (1, pid)

    players_sorted = [players[pid] for pid in sorted(players.keys(), key=_player_sort_key)]

    # All source and coverage validation happens before the first artifact is
    # written, so a failed refresh leaves the last successful snapshot intact.
    # Gate metric is FFC→Sleeper identity match (gate_diagnostics), NOT active-
    # board projection coverage (active_diagnostics / manifest.projection).
    if gate_diagnostics['top300MatchRate'] < args.coverage_threshold:
        print(
            "COVERAGE GATE FAILED: "
            f"FFC top-{gate_diagnostics['sampleSize']} match rate "
            f"{gate_diagnostics['top300MatchRate']:.1%} < {args.coverage_threshold:.1%}. "
            f"Unmatched: {gate_diagnostics['unmatchedTop300']}. "
            "Preserving the last successful artifact."
        )
        return 1

    # Committed, deployed, display-only. After the gate so a gate failure
    # (return above) preserves the previous projections-providers.json untouched.
    print("[8/9] Building multi-provider projections (Sleeper, ESPN, CBS)...")
    provider_artifact, provider_sources, provider_summary = _run_provider_projections(
        sleeper_adp_rows, set(players), season=args.season, out_dir=out_dir, fetched_at=fetched_at,
        sleeper_index=sleeper_index, espn_id_to_player_id=espn_id_to_player_id,
        sleeper_error=sleeper_adp_error,
        espn_payload=espn_payload, espn_payload_error=espn_payload_error,
    )
    manifest_sources.update(provider_sources)

    print("[9/9] Writing artifacts and ADP history...")
    sizes = {
        "players.json": _write_json(out_dir / "players.json", players_sorted),
        "projections-season.json": _write_json(out_dir / "projections-season.json", projections),
        "player-usage.json": _write_json(out_dir / "player-usage.json", player_usage),
        "projections-providers.json": (out_dir / "projections-providers.json").stat().st_size,
        # Superseded by weekly-stats.json (full per-week component stats, every
        # position). Kept for one release so a stale CDN-cached deploy still
        # hitting the old artifact doesn't 404 mid-transition -- see the PR
        # description's retirement plan. The frontend no longer reads this.
        "weekly-ppr.json": _write_json(out_dir / "weekly-ppr.json", {
            "schemaVersion": context.WEEKLY_SCORING_SCHEMA_VERSION,
            "season": int(args.season) - 1,
            "players": context_artifacts.weekly,
        }),
        "weekly-stats.json": _write_json(out_dir / "weekly-stats.json", context_artifacts.weeklyStats),
    }
    for fmt, entries in adp_by_format.items():
        sizes[f"adp-{fmt}.json"] = _write_json(out_dir / f"adp-{fmt}.json", entries)

    # Underdog best-ball lane: written OUTSIDE the redraft loop above. Only a
    # successful build touches the file — on any failure path the prior
    # committed artifact stays byte-identical (no write, no delete).
    if underdog_entries is not None:
        sizes[UNDERDOG_BOARD_FILENAME] = _write_json(out_dir / UNDERDOG_BOARD_FILENAME, underdog_entries)

    # FFC display lane: the per-format FFC-derived boards are already built every run
    # (ffc_entries_by_format feeds select_active_adp's fallback and the CV-band fitting);
    # ship them as their own display-only artifacts so the drawer's Market ADP section can
    # show every provider the pipeline actually talks to. Display-only like Underdog —
    # never an engine input: the redraft engine board stays adp-<fmt>.json
    # (Sleeper head, or FFC wholesale only when Sleeper's endpoint fails).
    for fmt, ffc_display_entries in ffc_entries_by_format.items():
        if ffc_display_entries:
            sizes[f"adp-ffc-{fmt}.json"] = _write_json(
                out_dir / f"adp-ffc-{fmt}.json", ffc_display_entries
            )

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
            "top300MatchRate": gate_diagnostics["top300MatchRate"],
            "unmatchedTop300": gate_diagnostics["unmatchedTop300"],
        },
        "projection": {
            "source": "fftoday",
            "updatedAt": projection_result.upstream_updated_at,
            "positionRows": projection_result.position_rows,
            "top300MatchRate": active_diagnostics["top300MatchRate"],
            "unmatchedTop300": active_diagnostics["unmatchedTop300"],
            "diagnostics": projection_result.diagnostics,
        },
        # Display-only multi-provider projections summary — lets DataHealth disclose
        # provider status without fetching the ~200 KB artifact.
        "projectionProviders": provider_summary,
        "context": context_manifest,
        "playerStatusOverrides": {
            "count": len(status_overrides),
            "warnings": override_warnings,
        },
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
        f"FFC crosswalk gate (top {gate_diagnostics['sampleSize']}): "
        f"{gate_diagnostics['top300MatchRate']:.1%}"
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
