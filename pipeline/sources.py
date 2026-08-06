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


def fetch_sleeper_season_projections(season: str) -> list[dict[str, Any]]:
    """One call for every position — Sleeper accepts repeated `position[]` params.

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


def fetch_ffc_adp(fmt: str, teams: int = 12, year: int = 2026) -> list[dict[str, Any]]:
    """`fmt` is one of ADP_FORMATS. Returns FFC's raw `players` array."""
    resp = _get(f"{FFC_BASE}/adp/{fmt}", teams=teams, year=year)
    return resp.json().get("players", [])


def fetch_dynastyprocess_crosswalk() -> list[dict[str, str]]:
    """DynastyProcess's weekly-rebuilt ID crosswalk. 'NA' strings mean missing, not '0'."""
    resp = _get(DYNASTYPROCESS_PLAYERIDS_URL)
    resp.encoding = "utf-8"
    return list(csv.DictReader(io.StringIO(resp.text)))
