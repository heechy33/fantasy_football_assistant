"""
Thin, unauthenticated HTTP fetches for every upstream data source.

Deliberately dumb: each function does one GET and returns parsed JSON/CSV rows.
All the actual logic (normalizing, matching, deciding what's fantasy-relevant)
lives in match.py / transform.py, which take these raw payloads as plain
Python data and never touch the network themselves. That split is what makes
match.py testable against fixtures without mocking HTTP.
"""

from __future__ import annotations

import csv
import io
from typing import Any

import requests

USER_AGENT = "fantasy-football-assistant-pipeline/1.0 (+https://github.com/)"
TIMEOUT = 30

SLEEPER_BASE = "https://api.sleeper.app"
FFC_BASE = "https://fantasyfootballcalculator.com/api/v1"
DYNASTYPROCESS_PLAYERIDS_URL = (
    "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv"
)

# Sleeper's projections endpoint returns extra non-fantasy positions (FB, P,
# CB, ...) mixed in; ADP formats FFC actually serves (dynasty/rookie return
# empty, verified against the live API).
FANTASY_POSITIONS = ("QB", "RB", "WR", "TE", "K", "DEF")
ADP_FORMATS = ("standard", "half-ppr", "ppr", "2qb")


def _get(url: str, **params: Any) -> requests.Response:
    resp = requests.get(url, params=params or None, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp


def fetch_sleeper_players() -> dict[str, dict[str, Any]]:
    """Full player pool, keyed by Sleeper's player_id (our canonical PlayerId). ~14MB."""
    return _get(f"{SLEEPER_BASE}/v1/players/nfl").json()


def fetch_sleeper_adp(season: str) -> list[dict[str, Any]]:
    """Sleeper's own draft-lobby ADP, read off its undocumented projections endpoint.

    Undocumented (not in Sleeper's published /v1 docs), but verified live: each
    row embeds `stats.adp_ppr` / `adp_half_ppr` / `adp_std` / `adp_2qb`, and
    `player_id` is already a sleeper_id (a team abbreviation for DEF rows, same
    as /v1/players/nfl) — no crosswalk needed downstream. A player with no ADP
    sample carries the sentinel 999.0 rather than omitting the key, so callers
    must filter it (see transform.build_sleeper_adp_entries). This is the
    population real Sleeper drafts (and this product) draw from, unlike FFC's
    self-selected mock-only lobby — verified to diverge by 15-20+ picks at TE
    between the two. No dispersion field exists here, unlike FFC's stdev.

    Uses a list of tuples (not `_get`'s dict-of-kwargs) because a dict can't
    hold the same query key (`position[]`) six times.
    """
    resp = requests.get(
        f"{SLEEPER_BASE}/projections/nfl/{season}",
        params=[("season_type", "regular"), *[("position[]", p) for p in FANTASY_POSITIONS]],
        headers={"User-Agent": USER_AGENT},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def fetch_sleeper_season_projections(season: str) -> list[dict[str, Any]]:
    """Compatibility alias — same undocumented projections payload as ADP."""
    return fetch_sleeper_adp(season)


def fetch_ffc_adp_payload(fmt: str, teams: int = 12, year: int = 2026) -> dict[str, Any]:
    """Return FFC's full response so population metadata is not discarded."""
    resp = _get(f"{FFC_BASE}/adp/{fmt}", teams=teams, year=year)
    return resp.json()


def fetch_ffc_adp(fmt: str, teams: int = 12, year: int = 2026) -> list[dict[str, Any]]:
    """Compatibility helper returning only FFC's raw players array."""
    return fetch_ffc_adp_payload(fmt, teams=teams, year=year).get("players", [])


def fetch_dynastyprocess_crosswalk() -> list[dict[str, str]]:
    """DynastyProcess's weekly-rebuilt ID crosswalk. 'NA' strings mean missing, not '0'."""
    resp = _get(DYNASTYPROCESS_PLAYERIDS_URL)
    resp.encoding = "utf-8"
    return list(csv.DictReader(io.StringIO(resp.text)))


SLEEPER_WEEKLY_STATS_PATH = "/v1/stats/nfl/regular/{season}/{week}"


def fetch_sleeper_weekly_stats(season: str, week: int) -> dict[str, dict[str, Any]]:
    """Undocumented but verified live against every week of the 2025 season.

    Object keyed by sleeper_id; DEF rows are keyed by team abbreviation, which
    matches our DEF playerIds directly (empty `ids{}` on those records is fine —
    no crosswalk is needed for this source, for any position).

    Zero-valued stats are OMITTED from a row entirely, not written as 0 — for a
    row that exists (the player was active that week), a missing key means 0,
    never "unknown". `pos_rank_ppr` uses the same 999.0 "no sample" sentinel
    documented on `fetch_sleeper_adp`; it is 999.0 for every K/DEF row, so
    finish-rank must be computed downstream for those two positions.

    On a DEF row, `td` is touchdowns ALLOWED (verified: e.g. a week with
    `td: 6` alongside `pts_allow: 42`) — the defensive score is the separate
    `def_td` key. Do not read `td` as "defensive touchdowns".
    """
    return _get(f"{SLEEPER_BASE}{SLEEPER_WEEKLY_STATS_PATH.format(season=season, week=week)}").json()


# Yahoo's draft-analysis page is a public, unauthenticated JS-rendered
# React shell at `football.fantasysports.yahoo.com/f1/draftanalysis?type=...`.
# The page itself does NOT return the data table in its initial HTML response;
# the data hydrates from Yahoo's internal `publicDraftAnalysis` API after the
# page loads, so a plain `requests.get` returns an 887 KB shell with zero
# player rows. To extract the data we render the page in headless Chromium
# via Playwright and return the rendered HTML. The pure parser lives in
# `yahoo_adp.py`; this module owns the HTTP/Playwright boundary.
#
# Yahoo serves three game_types (standard, half-ppr, ppr -- NEVER 2qb). The
# URL takes a `count` param that defaults to ~25; we always pass `count=2000`
# to get the full board in one render (verified 2026-09-01: 1163 parsed
# rows for `type=half-ppr&count=2000`).
YAHOO_DRAFT_ANALYSIS_URL = "https://football.fantasysports.yahoo.com/f1/draftanalysis"
YAHOO_DRAFT_ANALYSIS_COUNT = 2000
YAHOO_DRAFT_ANALYSIS_GAME_TYPES = ("standard", "half-ppr", "ppr")
YAHOO_DRAFT_ANALYSIS_RENDER_WAIT_MS = 12000  # empirical: time for the React table to hydrate


def fetch_yahoo_draft_analysis_html(game_type: str) -> str:
    """Render Yahoo's draft-analysis page for one game_type in headless Chromium
    and return the rendered HTML of the data table.

    Fail-open: any error (Playwright missing, Chromium missing, network
    timeout, page timeout, selector not found) raises a `RuntimeError` that
    `build_data.py` catches and converts into a `[warn]` line + a manifest
    `status: "error"` entry. The artifact is then left untouched.

    Imports Playwright lazily so a pipeline run on a machine without
    Playwright installed (or without the Chromium binary) fails with a clear
    `ImportError` at this call site, not at module-import time when the
    pipeline is only doing Sleeper/ESPN/Underdog work.
    """
    if game_type not in YAHOO_DRAFT_ANALYSIS_GAME_TYPES:
        raise ValueError(
            f"Yahoo draft-analysis: unsupported game_type {game_type!r}; expected one of {YAHOO_DRAFT_ANALYSIS_GAME_TYPES}"
        )
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError(
            "Yahoo draft-analysis: Playwright is not installed. Run `pip install playwright` and `playwright install chromium`."
        ) from exc
    url = f"{YAHOO_DRAFT_ANALYSIS_URL}?type={game_type}&count={YAHOO_DRAFT_ANALYSIS_COUNT}"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.set_default_timeout(60000)
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            # The React table hydrates after the initial HTML response. The
            # exact wait is empirical; 12s is enough for the headless
            # browser on a fast network.
            page.wait_for_timeout(YAHOO_DRAFT_ANALYSIS_RENDER_WAIT_MS)
            html = page.locator("table").first.evaluate("el => el.outerHTML")
        finally:
            browser.close()
    return html
