"""ESPN season-projection adapter (display-only decoration, committed artifact).

One unauthenticated GET to ESPN's public leaguedefaults endpoint, verified live:
`lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/<season>/segments/0/
leaguedefaults/3?view=kona_player_info` with an `x-fantasy-filter` header. The
payload is dense with weekly and prior-season rows — the single season-projection
entry is `stats[]` where `seasonId == season && statSourceId == 1 &&
statSplitTypeId == 0 && scoringPeriodId == 0`.

Display-only, same contract as every other provider decoration: the stat maps
here must never reach buildRecommendationBoard / availability /
simulation / ranking comparators. The artifact stores Sleeper-vocabulary stat
keys so all providers score through one code path (`scoreStats`).

The ESPN stat-id map is reconciliation-verified live for QB/RB/WR/TE/K: mapping
the stat ids to Sleeper keys and scoring the RAW ids with ESPN's default weights
reproduces ESPN's own `appliedTotal` (Josh Allen -> 369.0 vs 369.23; Brandon
Aubrey -> 171.6 vs 171.56). DEF does NOT reconcile yet, so the `_reconcile` gate
excludes it and records the measured error rather than shipping a plausible-
looking but unverified number.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any

import requests

from match import MatchKey, match_named_row
from provider_projections import ProviderResult

ESPN_DEFAULTS_URL = (
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leaguedefaults/3"
)
ESPN_SOURCE = "espn"
USER_AGENT = "fantasy-football-assistant-pipeline/1.0 (+https://github.com/)"
TIMEOUT = 60

# kona_player_info wraps every row under a nested `player` object.
_ROW_PLAYER_KEY = "player"

# ESPN defaultPositionId -> Sleeper position vocabulary. Verified live against
# this leaguedefaults payload: 1=QB (Josh Allen), 2=RB (Saquon), 3=WR (Amon-Ra),
# 4=TE (Kelce), 5=K (Aubrey), 16=D/ST — a different encoding than the espn-api
# library's generic POSITION_MAP.
POSITION_BY_DEFAULT_ID = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF"}

# ESPN proTeamId -> Sleeper-style abbreviation (the espn-api library's verified
# map; WAS is 28, SF is 25). Used for DEF rows, which must NOT use ids.espn
# (ESPN DEF ids are negative synthetics — players.json DEF rows carry empty
# ids{}), and as the name/team/position fallback for everyone else.
PRO_TEAM_ABBR = {
    1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
    8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
    15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
    22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH",
    29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
}

# ESPN stat id -> Sleeper stat key. Live-verified: mapping these and scoring the
# RAW ids with ESPN default weights reproduces appliedTotal for QB/RB/WR/TE/K.
# ESPN's stat 80 is a single made-FG 0-39 bucket that cannot be split into
# Sleeper's tiered fg_* keys, so kickers store the canonical fgm/fga/xpm/xpa.
_STAT_ID_MAP = {
    # Passing
    0: "pass_att",
    1: "pass_cmp",
    3: "pass_yd",
    4: "pass_td",
    19: "pass_2pt",
    20: "pass_int",
    # Rushing
    23: "rush_att",
    24: "rush_yd",
    25: "rush_td",
    26: "rush_2pt",
    # Receiving (53, not 41, is the receptions bucket in this payload — verified)
    53: "rec",
    42: "rec_yd",
    43: "rec_td",
    44: "rec_2pt",
    # Fumbles
    68: "fum",
    72: "fum_lost",
    # Kicking
    83: "fgm",
    84: "fga",
    86: "xpm",
    87: "xpa",
    # Defense
    99: "sack",
    96: "fum_rec",
    95: "int",
    94: "def_td",
    101: "def_kr_td",
    97: "blk_kick",
    98: "safe",
    120: "pts_allow",
}

# ESPN default (PPR) scoring on RAW stat ids — used ONLY by the reconciliation
# gate to verify the stat-id mapping against appliedTotal. Tiered FGs (3/4/5),
# XP 1, and a missed-FG penalty are required for kickers to reconcile.
_RAW_STAT_WEIGHTS: dict[int, float] = {
    # Passing
    3: 0.04, 4: 4.0, 19: 2.0, 20: -2.0,
    # Rushing
    24: 0.1, 25: 6.0, 26: 2.0,
    # Receiving
    53: 1.0, 42: 0.1, 43: 6.0, 44: 2.0,
    # Fumbles
    72: -2.0,
    # Kicking
    80: 3.0, 77: 4.0, 74: 5.0, 86: 1.0, 85: -1.0,
    # Defense
    99: 1.0, 96: 2.0, 95: 2.0, 94: 6.0, 101: 6.0, 97: 2.0, 98: 2.0,
}

# ESPN default D/ST points-allowed tier bonus applied to the season total
# (stat 120). Best-effort: DEF is expected to fail the gate until derived.
_DEF_PA_TIERS = ((0, 10), (7, 7), (14, 4), (18, 1), (22, 0), (28, -1), (35, -3), (46, -5), (math.inf, -7))
def _def_points_allowed_bonus(points_allowed: float) -> float:
    for threshold, bonus in _DEF_PA_TIERS:
        if points_allowed < threshold:
            return bonus
    return -7.0


def _reconcile(position: str, raw_stats: dict[str, float], applied_total: float | None) -> tuple[bool, float]:
    """Verify the stat-id mapping for one player: score the RAW ESPN ids with
    ESPN's default weights (DEF adds the points-allowed tier) and compare to
    ESPN's own appliedTotal. A position whose median relative error exceeds the
    gate is excluded — a mis-assigned stat id must never ship as a plausible
    number."""
    if not applied_total or applied_total <= 0:
        return False, float("inf")
    total = sum(raw_stats.get(str(sid), 0.0) * weight for sid, weight in _RAW_STAT_WEIGHTS.items())
    if position == "DEF":
        total += _def_points_allowed_bonus(raw_stats.get("120", 0.0))
    error = abs(total - applied_total) / applied_total
    return error <= 0.01, error


@dataclass(frozen=True)
class ParsedEspnRow:
    name: str
    team: str | None
    position: str
    espn_id: str | None
    stats: dict[str, float]
    raw_stats: dict[str, float]
    applied_total: float | None


def _select_projection_entry(player: dict[str, Any], season: int) -> dict[str, Any] | None:
    for entry in player.get("stats") or []:
        if (
            entry.get("seasonId") == season
            and entry.get("statSourceId") == 1
            and entry.get("statSplitTypeId") == 0
            and entry.get("scoringPeriodId") == 0
        ):
            return entry
    return None


def parse_espn_payload(payload: dict[str, Any], season: int) -> list[ParsedEspnRow]:
    """Normalize the kona_player_info payload into Sleeper-vocab rows. Raises
    ValueError on schema drift (missing players array / nested player objects)."""
    raw_rows = payload.get("players")
    if not isinstance(raw_rows, list):
        raise ValueError("ESPN payload has no players array")
    rows: list[ParsedEspnRow] = []
    for raw in raw_rows:
        player = raw.get(_ROW_PLAYER_KEY) if isinstance(raw, dict) else None
        if not isinstance(player, dict):
            raise ValueError("ESPN player row missing nested player object")
        entry = _select_projection_entry(player, season)
        if not entry:
            continue
        position = POSITION_BY_DEFAULT_ID.get(player.get("defaultPositionId"))
        if position is None:
            continue
        pro_team_id = player.get("proTeamId")
        team = PRO_TEAM_ABBR.get(pro_team_id) if isinstance(pro_team_id, int) else None
        raw_stats = {str(k): float(v) for k, v in (entry.get("stats") or {}).items()}
        if any(not math.isfinite(value) for value in raw_stats.values()):
            raise ValueError('ESPN projection contains a non-finite stat')
        mapped: dict[str, float] = {}
        for sid, value in raw_stats.items():
            key = _STAT_ID_MAP.get(int(sid))
            if key:
                mapped[key] = mapped.get(key, 0) + value
        espn_id = player.get("id")
        rows.append(
            ParsedEspnRow(
                name=str(player.get("fullName") or "").strip(),
                team=team,
                position=position,
                espn_id=str(espn_id) if espn_id is not None else None,
                stats=mapped,
                raw_stats=raw_stats,
                applied_total=entry.get("appliedTotal"),
            )
        )
    return rows
def fetch_espn_projections(season: str) -> dict[str, Any]:
    """One unauthenticated GET to ESPN's public leaguedefaults projection feed.
    Verified live: the slot filter + sort returns 1026 players, 521 with a
    season projection. Owns its own GET (precedent: fftoday.py owns its fetch;
    sources.py stays one-GET-thin for the core feeds)."""
    filter_obj = {
        "players": {
            "filterSlotIds": {"value": [0, 2, 4, 6, 17, 16]},
            "limit": 1500,
            "sortPercOwned": {"sortAsc": False, "sortPriority": 100},
        }
    }
    resp = requests.get(
        ESPN_DEFAULTS_URL.format(season=season),
        params={"view": "kona_player_info"},
        headers={
            "x-fantasy-filter": json.dumps(filter_obj, separators=(",", ":")),
            "User-Agent": USER_AGENT,
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def espn_provider_result(
    payload: dict[str, Any],
    *,
    season: int,
    sleeper_index: dict[MatchKey, str],
    espn_id_to_player_id: dict[str, str],
    valid_player_ids: set[str],
    fetched_at: str,
) -> ProviderResult:
    """Parse + reconcile + match the ESPN payload into a provider block.

    Matching is ids.espn first (players.json carries 3361 espn ids), then
    match_named_row(name/position/team). DEF rows never use ids.espn — ESPN DEF
    ids are negative synthetics, so DEF resolves proTeamId -> abbr, which is the
    Sleeper DEF player id.

    The reconciliation gate excludes any position whose median relative error
    against ESPN's own appliedTotal exceeds ~1% (expected for DEF initially),
    so a mis-assigned stat id can never ship as a plausible number.
    """
    rows = parse_espn_payload(payload, season)

    position_errors: dict[str, list[float]] = {}
    for row in rows:
        _, error = _reconcile(row.position, row.raw_stats, row.applied_total)
        if math.isfinite(error):
            position_errors.setdefault(row.position, []).append(error)

    excluded: dict[str, float] = {}
    for position, errors in position_errors.items():
        median_error = _median(errors)
        if median_error > 0.01:
            excluded[position] = median_error

    stats_by_player: dict[str, dict[str, float]] = {}
    position_rows: dict[str, int] = {}
    for row in rows:
        if row.position in excluded:
            continue
        player_id: str | None = None
        if row.position != "DEF" and row.espn_id:
            player_id = espn_id_to_player_id.get(row.espn_id)
        if player_id is None:
            player_id = match_named_row(row.name, row.position, row.team, sleeper_index)
        if player_id is None or player_id not in valid_player_ids:
            continue
        stats_by_player[player_id] = row.stats
        position_rows[row.position] = position_rows.get(row.position, 0) + 1

    block: dict[str, Any] = {
        "key": "espn",
        "label": "ESPN",
        "attribution": "Projections via ESPN's public leaguedefaults endpoint.",
        "status": "ok",
        "fetchedAt": fetched_at,
        "upstreamUpdatedAt": None,
        "rows": len(stats_by_player),
        "positionRows": position_rows,
        "positionsExcluded": [
            {"position": position, "medianError": round(error, 4)}
            for position, error in sorted(excluded.items())
        ],
        "staleSinceDays": 0,
        "diagnostic": None,
    }
    return ProviderResult(key="espn", label="ESPN", block=block, stats_by_player=stats_by_player)

