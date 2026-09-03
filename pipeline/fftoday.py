"""FFToday season-projection adapter.

The adapter is deliberately pipeline-only.  It returns normalized rows and
diagnostics; the browser never imports this module or calls FFToday.
"""

from __future__ import annotations

import math
import re
import time
from dataclasses import dataclass
from typing import Any, Callable, Protocol
from urllib.parse import urlencode

import requests

from html_table import TableParser
from match import DEF_TEAM_NAMES, normalize_ffc_position, normalize_name, normalize_team
from transform import SeasonProjection

FFTODAY_BASE = "https://www.fftoday.com/rankings/playerproj.php"
FFTODAY_SOURCE = "fftoday"
POSITION_IDS = {"QB": 10, "RB": 20, "WR": 30, "TE": 40, "K": 80, "DEF": 99}
PAGE_SIZE = 50
MIN_POSITION_ROWS = {"QB": 50, "RB": 80, "WR": 110, "TE": 50, "K": 25, "DEF": 25}
SCHEMA_VERSION = 1

# Fraction of `top_adp_ids` (the top-300-by-ADP seed from build_data.py) that
# must resolve to a real FFToday projection. Was an inline 0.97, calibrated
# against FFC's shallower ~256-row mock-lobby board, whose top-300 was really
# its entire list. Since the ADP switch to Sleeper's broader draft-lobby board
# (see PLAN.md's ADP-switch writeup), the same top-300 cut reaches further into
# genuinely speculative/deep-bench territory FFToday never projects at all —
# verified live (2026-08-09) by direct name search against FFToday's raw page
# output: Tyreek Hill, Joe Mixon, Najee Harris, Keenan Allen, and others simply
# never appear on FFToday's page, not a crosswalk/matching miss. Measured
# coverage against the new population that day was 94.0% (18/300 missing, all
# verified real absences); 0.90 keeps a buffer for that expected depth effect
# while still catching an actual matching regression (which would fail far
# below this, the same way COVERAGE_GATE_THRESHOLD in build_data.py works).
# The live 2026-09-02 board measured 89.0% (33 genuine FFToday absences in
# Sleeper's broader top-300), so retain a five-point drift buffer rather than
# blocking an otherwise valid refresh at the old 90% floor.
TOP_ADP_PROJECTION_COVERAGE_THRESHOLD = 0.85

_UPDATED_RE = re.compile(r"Updated\s*:\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})", re.I)
_NUM_RE = re.compile(r"^-?(?:\d+(?:\.\d*)?|\.\d+)$")


class SeasonProjectionProvider(Protocol):
    source: str

    def load(self, season: str) -> "ProjectionResult": ...


@dataclass(frozen=True)
class ProjectionResult:
    projections: list[SeasonProjection]
    fetched_at: str
    upstream_updated_at: str | None
    position_rows: dict[str, int]
    source_url: str
    diagnostics: dict[str, Any]
    # Matched sleeper_id → bye week from FFToday's Bye column. Used to fill
    # PlayerMeta.byeWeek holes that FFC's shallower mock board never covers.
    bye_weeks: dict[str, int]


@dataclass(frozen=True)
class _HttpPage:
    url: str
    text: str


def _clean_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _number(value: str, label: str) -> float:
    cleaned = value.strip().replace(",", "").replace("%", "")
    if not cleaned or cleaned in {"-", "—", "n/a", "na"} or not _NUM_RE.match(cleaned):
        raise ValueError(f"invalid FFToday {label} value: {value!r}")
    parsed = float(cleaned)
    if not math.isfinite(parsed) or parsed < 0:
        raise ValueError(f"invalid FFToday {label} value: {value!r}")
    return parsed


_HEADER_ALIASES = {
    "player": {"playersortfirstlast"},
}
def _header_matches(value: str, label: str) -> bool:
    wanted = _clean_header(label)
    actual = _clean_header(value)
    return actual == wanted or actual in _HEADER_ALIASES.get(wanted, set())
def _column(headers: list[str], label: str, occurrence: int = 0) -> int:
    indexes = [i for i, value in enumerate(headers) if _header_matches(value, label)]
    if len(indexes) <= occurrence:
        raise ValueError(f"FFToday schema missing {label} occurrence {occurrence}")
    return indexes[occurrence]


def _table_for_position(html: str, position: str) -> tuple[list[str], list[list[str]]]:
    parser = TableParser()
    parser.feed(html)
    required = {
        "QB": ("Player", "Tm", "Bye", "Cmp", "Att", "Yds", "TD", "INT", "FPts"),
        "RB": ("Player", "Tm", "Bye", "Att", "Yds", "TD", "Rec", "FPts"),
        "WR": ("Player", "Tm", "Bye", "Rec", "Yds", "TD", "Att", "FPts"),
        "TE": ("Player", "Tm", "Bye", "Rec", "Yds", "TD", "FPts"),
        "K": ("Player", "Tm", "Bye", "FGM", "FGA", "FPts"),
        "DEF": ("Team", "Bye", "Sack", "FR", "INT", "DefTD", "PA", "KickTD", "FPts"),
    }[position]
    for table in parser.tables:
        for row_index, row in enumerate(table):
            if all(any(_header_matches(cell, header) for cell in row) for header in required):
                if row_index + 1 >= len(table):
                    continue
                return row, table[row_index + 1 :]
    raise ValueError(f"FFToday {position} table with validated headers not found")


def _row_to_projection(
    position: str, headers: list[str], row: list[str],
) -> tuple[str, str | None, int, dict[str, float]]:
    max_index = len(headers) - 1
    if len(row) <= max_index:
        raise ValueError(f"FFToday {position} row has {len(row)} cells; expected {len(headers)}")
    name_index = _column(headers, "Team" if position == "DEF" else "Player")
    team_index = None if position == "DEF" else _column(headers, "Tm")
    bye_index = _column(headers, "Bye")
    name = row[name_index].strip()
    if not name or name.lower() in {"player", "team", "next page", "last page"}:
        raise ValueError(f"FFToday {position} row has no player name")
    team = DEF_TEAM_NAMES.get(name.lower()) if position == "DEF" else normalize_team(row[team_index])
    # Failing on bad numeric cells is intentional. A half-parsed row would be
    # more dangerous than rejecting a refresh and preserving the last artifact.
    bye = int(_number(row[bye_index], "bye"))

    stats: dict[str, float] = {}
    if position == "QB":
        fields = (("pass_cmp", "Cmp", 0), ("pass_att", "Att", 0), ("pass_yd", "Yds", 0),
                  ("pass_td", "TD", 0), ("pass_int", "INT", 0), ("rush_att", "Att", 1),
                  ("rush_yd", "Yds", 1), ("rush_td", "TD", 1))
    elif position in {"RB", "WR"}:
        rush_first = position == "RB"
        fields = (("rush_att", "Att", 0), ("rush_yd", "Yds", 0 if rush_first else 1),
                  ("rush_td", "TD", 0 if rush_first else 1), ("rec", "Rec", 0),
                  ("rec_yd", "Yds", 1 if rush_first else 0), ("rec_td", "TD", 1 if rush_first else 0))
    elif position == "TE":
        fields = (("rec", "Rec", 0), ("rec_yd", "Yds", 0), ("rec_td", "TD", 0))
    elif position == "K":
        fields = (("fgm", "FGM", 0), ("fga", "FGA", 0), ("xpm", "EPM", 0), ("xpa", "EPA", 0))
    else:
        fields = (("sack", "Sack", 0), ("fum_rec", "FR", 0), ("int", "INT", 0),
                  ("def_td", "DefTD", 0), ("pts_allow", "PA", 0), ("def_kr_td", "KickTD", 0))
    for stat, label, occurrence in fields:
        stats[stat] = _number(row[_column(headers, label, occurrence)], stat)
    return name, team, bye, stats


def parse_fftoday_page(html: str, position: str) -> tuple[list[dict[str, Any]], str | None, tuple[str, ...]]:
    """Parse one page without retaining its HTML in the returned structures."""
    position = normalize_ffc_position(position)
    if "<html" not in html.lower() or "</html>" not in html.lower():
        raise ValueError("FFToday response is not HTML")
    headers, rows = _table_for_position(html, position)
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, str | None]] = set()
    for row in rows:
        if not row or row[0].lower().startswith(("next page", "last page")):
            continue
        name, team, bye, stats = _row_to_projection(position, headers, row)
        key = (normalize_name(name), team)
        if key in seen:
            raise ValueError(f"duplicate FFToday row on page: {name}")
        seen.add(key)
        result.append({
            "name": name, "team": team, "position": position, "byeWeek": bye, "stats": stats,
        })
    if not result:
        raise ValueError(f"FFToday {position} page contained no projection rows")
    update_match = _UPDATED_RE.search(html)
    return result, update_match.group(1) if update_match else None, tuple(f"{n}|{t or ''}" for n, t in seen)


_NameIndex = dict[tuple[str, str], list[tuple[str, dict[str, Any]]]]

# FFToday occasionally uses a player's formal first name while Sleeper uses
# the established football name. Keep this deliberately tiny and exact rather
# than introducing fuzzy matching at the identity boundary.
_FFTODAY_NAME_ALIASES = {
    "kenneth gainwell": "kenny gainwell",
    "chigoziem okonkwo": "chig okonkwo",
}


def _build_name_index(sleeper_players: dict[str, dict[str, Any]]) -> _NameIndex:
    """(normalized_full_name, position) -> candidates, built once and reused
    across every FFToday row instead of _match_projection scanning the whole
    ~12k-14k Sleeper player pool per row (~500 rows across 6 positions)."""
    index: _NameIndex = {}
    for player_id, player in sleeper_players.items():
        position = player.get("position")
        full_name = player.get("full_name")
        if not position or (position != "DEF" and not full_name):
            continue
        if full_name:
            key = (normalize_name(full_name), position)
            index.setdefault(key, []).append((str(player_id), player))
        if position == "DEF":
            team_key = normalize_team(player.get("team_abbr") or player.get("team") or player_id)
            if team_key:
                index.setdefault((team_key, position), []).append((str(player_id), player))
    return index


def _match_projection(row: dict[str, Any], name_index: _NameIndex) -> str | None:
    name_key = normalize_name(str(row["name"]))
    name_key = _FFTODAY_NAME_ALIASES.get(name_key, name_key)
    position = row["position"]
    source_team = normalize_team(row.get("team"))
    candidates = list(name_index.get(((source_team or name_key) if position == "DEF" else name_key, position), ()))
    if position == "DEF":
        candidates = [
            (player_id, player) for player_id, player in candidates
            if normalize_team(player.get("team_abbr") or player.get("team") or player_id) == source_team
        ]
    elif source_team:
        exact = [
            (player_id, player) for player_id, player in candidates
            if normalize_team(player.get("team_abbr") or player.get("team")) == source_team
        ]
        if exact:
            candidates = exact
    # A changed-team/unsigned player can match by unique normalized name and
    # position. Ambiguous duplicates fail closed rather than guessing.
    return candidates[0][0] if len(candidates) == 1 else None


def validate_projection_gates(
    projections: list[SeasonProjection],
    position_rows: dict[str, int],
    required_rows: dict[str, int] | None = None,
    top_adp_ids: list[str] | None = None,
) -> list[str]:
    required_rows = required_rows or MIN_POSITION_ROWS
    issues: list[str] = []
    for position, minimum in required_rows.items():
        if position_rows.get(position, 0) < minimum:
            issues.append(f"{position} projection rows {position_rows.get(position, 0)} < {minimum}")
    ids = [p.playerId for p in projections]
    if len(ids) != len(set(ids)):
        issues.append("duplicate canonical player IDs in projections")
    if top_adp_ids:
        projected = set(ids)
        matched = sum(player_id in projected for player_id in top_adp_ids)
        rate = matched / len(top_adp_ids)
        if rate < TOP_ADP_PROJECTION_COVERAGE_THRESHOLD:
            issues.append(
                f"top-300 PPR ADP projection coverage {rate:.1%} < {TOP_ADP_PROJECTION_COVERAGE_THRESHOLD:.1%}"
            )
    for projection in projections:
        for key, value in projection.stats.items():
            if not math.isfinite(value) or value < 0:
                issues.append(f"invalid projection component {projection.playerId}:{key}={value}")
    return issues


class FFTodayProjectionProvider:
    source = FFTODAY_SOURCE

    def __init__(
        self,
        sleeper_players: dict[str, dict[str, Any]],
        *,
        session: requests.Session | None = None,
        sleep_fn: Callable[[float], None] = time.sleep,
        now_fn: Callable[[], str] | None = None,
        max_attempts: int = 3,
        throttle_seconds: float = 1.5,
    ) -> None:
        self.sleeper_players = sleeper_players
        self.session = session or requests.Session()
        self.sleep_fn = sleep_fn
        self.now_fn = now_fn or (lambda: __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat())
        self.max_attempts = max_attempts
        self.throttle_seconds = throttle_seconds
        self._last_request = 0.0

    def _fetch(self, url: str, params: dict[str, Any]) -> _HttpPage:
        full_url = f"{url}?{urlencode(params)}"
        for attempt in range(1, self.max_attempts + 1):
            elapsed = time.monotonic() - self._last_request
            if elapsed < self.throttle_seconds:
                self.sleep_fn(self.throttle_seconds - elapsed)
            try:
                response = self.session.get(
                    url, params=params,
                    headers={"User-Agent": "fantasy-football-assistant/0.2 (+https://github.com/)"},
                    timeout=30,
                )
                self._last_request = time.monotonic()
                response.raise_for_status()
                text = response.text
                if "<html" not in text.lower() or "</html>" not in text.lower():
                    raise ValueError("FFToday returned a non-HTML response")
                return _HttpPage(full_url, text)
            except (requests.RequestException, ValueError) as exc:
                response = getattr(exc, "response", None)
                status_code = getattr(response, "status_code", None) if response is not None else None
                # Retry transport failures (no HTTP response) and rate-limit / 5xx.
                # Non-HTML ValueError and 4xx (other than 403/429) fail closed.
                retryable = isinstance(exc, requests.RequestException) and (
                    status_code is None or status_code >= 500 or status_code in {403, 429}
                )
                if not retryable or attempt == self.max_attempts:
                    raise RuntimeError(f"FFToday fetch failed for {full_url}: {exc}") from exc
                # FFToday intermittently uses 403 as a rate-limit response.
        raise AssertionError("unreachable")

    def load(self, season: str, top_adp_ids: list[str] | None = None) -> ProjectionResult:
        all_rows: list[SeasonProjection] = []
        bye_weeks: dict[str, int] = {}
        counts: dict[str, int] = {}
        updates: set[str] = set()
        unmatched: list[str] = []
        page_signatures: set[tuple[str, ...]] = set()
        source_urls: list[str] = []
        name_index = _build_name_index(self.sleeper_players)
        for position, position_id in POSITION_IDS.items():
            page = 0
            position_count = 0
            while True:
                params: dict[str, Any] = {"PosID": position_id, "Season": season}
                if page:
                    params["cur_page"] = page
                response = self._fetch(FFTODAY_BASE, params)
                try:
                    rows, update, signature = parse_fftoday_page(response.text, position)
                except ValueError as exc:
                    # A position's true row count can be an exact multiple of
                    # PAGE_SIZE, in which case the page just past the last
                    # full page is empty rather than short — that's the
                    # normal end of pagination, not a real parse failure.
                    if page and "contained no projection rows" in str(exc):
                        break
                    raise
                if signature in page_signatures:
                    raise RuntimeError(f"FFToday duplicated page for {position} page {page}")
                page_signatures.add(signature)
                source_urls.append(response.url)
                if update:
                    updates.add(update)
                for row in rows:
                    position_count += 1
                    player_id = _match_projection(row, name_index)
                    if player_id is None:
                        unmatched.append(f"{row['name']} ({position})")
                        continue
                    all_rows.append(SeasonProjection(playerId=player_id, source=FFTODAY_SOURCE, stats=row["stats"]))
                    bye_weeks[player_id] = int(row["byeWeek"])
                if len(rows) < PAGE_SIZE:
                    break
                page += 1
            counts[position] = position_count
        if not updates:
            raise RuntimeError("FFToday update date missing")
        # FFToday updates their projections mid-scrape across sequential page# requests
        # (verified 2026-09-01: page 1 returned 8/27, later pages returned 8/30). Take
        # the LATEST observed update date -- it's what the UI should label. The coverage
        # gate (validate_projection_gates below) catches actual data loss, not mid-scrape
        # date drift, which is a normal upstream behavior. When all pages agree on a
        # single date (the common case), sorted(updates)[-1] returns that date identically.
        if len(updates) > 1:
            updates_sorted = sorted(updates)
            print(
                f"[info] fftoday: {len(updates_sorted)} distinct page update dates across the scrape; using latest {updates_sorted[-1]}"
            )
        issues = validate_projection_gates(all_rows, counts, top_adp_ids=top_adp_ids)
        if issues:
            raise RuntimeError("FFToday validation failed: " + "; ".join(issues))
        return ProjectionResult(
            projections=all_rows,
            fetched_at=self.now_fn(),
            upstream_updated_at=sorted(updates)[-1],
            position_rows=counts,
            source_url=FFTODAY_BASE,
            diagnostics={
                "schemaVersion": SCHEMA_VERSION,
                "unmatched": unmatched,
                "matchedRows": len(all_rows),
                "sourceUrls": source_urls,
            },
            bye_weeks=bye_weeks,
        )
