"""Pure transforms for the weekly Sleeper game-log artifact (data/weekly-stats.json).

Network-free, like match.py: `sources.fetch_sleeper_weekly_stats` and the nflverse
loaders in `nflverse_source.py` do the fetching; this module only shapes
already-fetched payloads. Testable against fixtures without mocking HTTP.

Column semantics, load-bearing for every function below:
  - A player having a row this week means they were active. A missing Sleeper
    stat key on that row means the value is 0 (Sleeper omits zeros), never
    "unknown".
  - `null` is reserved for genuinely not-computable values: `fin` when the
    999.0 sentinel can't be re-derived, `snp` when the snap-share denominator
    is null/0, `opp` when the schedule join failed.
  - On a DEF row, Sleeper's `td` key is touchdowns ALLOWED, not scored -- the
    defensive score is the separate `def_td` key. `POSITION_COLUMNS["DEF"]`
    deliberately omits `td`.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from match import normalize_team
from transform import PlayerMeta

WEEKLY_STATS_SCHEMA_VERSION = 1

_PTS_FIELD = "pts_ppr"
_RANK_SENTINEL = 999.0
_MIN_HEAT_SAMPLE = 40
_HEAT_PERCENTILES = (20, 40, 60, 80)

# Startable-cohort size per position for heat percentiles: the top N players by
# season PPR total. Percentiling over every observed player-week (deep bench
# included) drags p80 low enough that an elite player's grid reads as solid
# green -- restrict to who a startable lineup would actually roster.
HEAT_COHORT_SIZE = {"QB": 32, "RB": 60, "WR": 84, "TE": 32, "K": 32, "DEF": 32}

# The only column keys that are NOT raw Sleeper stat keys -- computed here from
# other sources (schedule join, snap-share denominators, position rank). Every
# other declared column must appear verbatim in some week's raw Sleeper
# payload, or `missingExpectedColumns` diagnostics flags it as a likely typo.
DERIVED_COLUMNS = frozenset({"opp", "snp", "fin"})

# Rate/ratio columns rendered to 1 decimal place. Every other non-derived
# column is a discrete count and rounds to a whole number. `sack` (DEF) is
# included defensively -- shared/half sacks are a real (if rare) NFL stat that
# did not occur in the 2025 season sample but could in a future one.
_ONE_DECIMAL_COLUMNS = frozenset({"cmp_pct", "pass_ypa", "pass_rtg", "rec_ypr", "fgm_pct", "sack"})

# Columns where a lower raw value is the better outcome. Used only by the
# frontend's heat-bucket inversion; the pipeline stores raw breakpoints either
# way and does not itself invert anything.
LOWER_BETTER_COLUMNS = frozenset({"pass_int", "pass_sack", "pts_allow", "yds_allow"})

# Column order per position. Every key was verified present in Sleeper's raw
# weekly payload across all 18 fetched weeks of the 2025 season before being
# hardcoded here (Sleeper omits zero-valued keys, so a single week's sample
# cannot confirm a column list -- see sources.fetch_sleeper_weekly_stats).
POSITION_COLUMNS: dict[str, list[str]] = {
    "QB": [
        "pts", "opp", "snp", "fin",
        "pass_cmp", "pass_att", "cmp_pct", "pass_yd", "pass_ypa", "pass_td", "pass_int",
        "pass_air_yd", "pass_sack", "pass_rtg",
        "rush_att", "rush_yd", "rush_td",
    ],
    "RB": [
        "pts", "opp", "snp", "fin",
        "rush_att", "rush_yd", "rush_ypa", "rush_td",
        "rec_tgt", "rec", "rec_yd", "rec_td", "fum_lost",
    ],
    "WR": [
        "pts", "opp", "snp", "fin",
        "rec_tgt", "rec", "rec_yd", "rec_ypr", "rec_air_yd", "rec_td",
        "rush_att", "rush_yd", "rush_td",
    ],
    "TE": [
        "pts", "opp", "snp", "fin",
        "rec_tgt", "rec", "rec_yd", "rec_ypr", "rec_air_yd", "rec_td",
    ],
    "K": [
        "pts", "opp", "snp", "fin",
        "fgm", "fga", "fgm_pct", "fgm_lng", "fgm_50p", "fgm_yds", "xpm", "xpa",
    ],
    "DEF": [
        "pts", "opp", "fin",
        "sack", "int", "fum_rec", "ff", "def_td", "blk_kick", "safe",
        "qb_hit", "def_pass_def", "pts_allow", "yds_allow",
    ],
}

# Every declared column that is not itself derived must be one of these raw
# Sleeper keys somewhere in POSITION_COLUMNS. Kept as a flat set so
# `missingExpectedColumns` can be computed once across all positions.
_ALL_RAW_COLUMNS = frozenset(
    key
    for columns in POSITION_COLUMNS.values()
    for key in columns
    if key not in DERIVED_COLUMNS
)


def _round(value: Any, digits: int) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return round(number, digits)


def _snap_pct(row: dict[str, Any], position: str) -> int | None:
    if position == "DEF":
        return None
    if position == "K":
        played, team = row.get("st_snp"), row.get("tm_st_snp")
    else:
        played, team = row.get("off_snp"), row.get("tm_off_snp")
    if played is None or team is None:
        return None
    try:
        team_f = float(team)
    except (TypeError, ValueError):
        return None
    if team_f <= 0:
        return None
    return round(100 * float(played) / team_f)


def build_opponent_map(schedule_rows: list[dict[str, Any]], season: int) -> dict[tuple[str, int], str]:
    """(team, week) -> opponent string with home/away marker, e.g. "KC" or "@KC"."""
    opponent_map: dict[tuple[str, int], str] = {}
    for row in schedule_rows:
        if row.get("season") != season or str(row.get("game_type") or "REG").upper() != "REG":
            continue
        week = row.get("week")
        home, away = normalize_team(row.get("home_team")), normalize_team(row.get("away_team"))
        if week is None or home is None or away is None:
            continue
        opponent_map[(home, int(week))] = away
        opponent_map[(away, int(week))] = f"@{home}"
    return opponent_map


def bye_weeks_by_team(schedule_rows: list[dict[str, Any]], season: int) -> dict[str, int]:
    """team -> its bye week, inferred as the one REG week in the league's played-week
    range that a team has no game in. Ambiguous (0 or >1 missing weeks) -> omitted."""
    played_weeks: dict[str, set[int]] = defaultdict(set)
    all_weeks: set[int] = set()
    for row in schedule_rows:
        if row.get("season") != season or str(row.get("game_type") or "REG").upper() != "REG":
            continue
        week = row.get("week")
        if week is None:
            continue
        all_weeks.add(int(week))
        for side in ("home_team", "away_team"):
            team = normalize_team(row.get(side))
            if team:
                played_weeks[team].add(int(week))

    byes: dict[str, int] = {}
    for team, weeks in played_weeks.items():
        missing = sorted(all_weeks - weeks)
        if len(missing) == 1:
            byes[team] = missing[0]
    return byes


def player_team_by_week(
    roster_rows: list[dict[str, Any]],
    gsis_to_player: dict[str, str],
    season: int,
) -> dict[tuple[str, int], str]:
    """(playerId, week) -> team, from nflverse weekly rosters. This is what
    correctly resolves a mid-season trade week by week, unlike a single
    season-level team field."""
    result: dict[tuple[str, int], str] = {}
    for row in roster_rows:
        if row.get("season") != season:
            continue
        gsis = row.get("gsis_id")
        week = row.get("week")
        if not gsis or week is None:
            continue
        pid = gsis_to_player.get(str(gsis).strip())
        if pid is None:
            continue
        team = normalize_team(row.get("team"))
        if team:
            result[(pid, int(week))] = team
    return result


def player_stats_team_by_week(
    player_stats_rows: list[dict[str, Any]],
    gsis_to_player: dict[str, str],
    season: int,
) -> dict[tuple[str, int], str]:
    """(playerId, week) -> team, fallback #3 in the resolution order: the
    per-player-week team already on the nflverse player_stats frame."""
    result: dict[tuple[str, int], str] = {}
    for row in player_stats_rows:
        if row.get("season") != season:
            continue
        gsis = row.get("player_id") or row.get("gsis_id")
        week = row.get("week")
        if not gsis or week is None:
            continue
        pid = gsis_to_player.get(str(gsis).strip())
        if pid is None:
            continue
        team = normalize_team(row.get("team") or row.get("recent_team"))
        if team:
            result[(pid, int(week))] = team
    return result


def compute_position_ranks(
    weekly_payloads: dict[int, dict[str, dict[str, Any]]],
    position_of: dict[str, str],
) -> dict[tuple[str, int], int]:
    """(playerId, week) -> finish rank within that week's K/DEF field, descending
    by pts_ppr, standard competition ranking (ties share the lower rank number).
    Sleeper's own `pos_rank_ppr` is the 999.0 "no sample" sentinel for K/DEF, so
    it must be recomputed here from the week's own scoring distribution."""
    ranks: dict[tuple[str, int], int] = {}
    for week, payload in weekly_payloads.items():
        by_position: dict[str, list[tuple[str, float]]] = defaultdict(list)
        for pid, row in payload.items():
            if not isinstance(row, dict):
                continue
            position = position_of.get(pid)
            if position not in ("K", "DEF"):
                continue
            pts = row.get(_PTS_FIELD)
            if pts is None:
                continue
            try:
                by_position[position].append((pid, float(pts)))
            except (TypeError, ValueError):
                continue
        for entries in by_position.values():
            entries.sort(key=lambda item: item[1], reverse=True)
            rank = 0
            previous_pts: float | None = None
            for index, (pid, pts) in enumerate(entries, start=1):
                if pts != previous_pts:
                    rank = index
                    previous_pts = pts
                ranks[(pid, week)] = rank
    return ranks


def _percentile(sorted_values: list[float], pct: float) -> float:
    if not sorted_values:
        raise ValueError("empty sample")
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (pct / 100) * (len(sorted_values) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(sorted_values) - 1)
    fraction = rank - lower
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * fraction


def compute_heat_breakpoints(
    players_out: dict[str, dict[str, Any]],
) -> tuple[dict[str, dict[str, list[float] | None]], dict[str, Any]]:
    """Per position, per shaded column: [p20, p40, p60, p80] over the
    startable-cohort's played weeks. `opp` and `fin` are never shaded (a rank
    is already a percentile). Below `_MIN_HEAT_SAMPLE` observations -> null,
    and the client renders that column unshaded rather than on a thin sample.
    """
    season_totals: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for pid, series in players_out.items():
        position = series["p"]
        total = sum(row[1] for row in series["w"] if row[1] is not None)
        season_totals[position].append((pid, total))

    cohort_by_position: dict[str, set[str]] = {}
    cohort_sizes: dict[str, int] = {}
    for position, totals in season_totals.items():
        n = HEAT_COHORT_SIZE.get(position, len(totals))
        totals.sort(key=lambda item: item[1], reverse=True)
        cohort = {pid for pid, _ in totals[:n]}
        cohort_by_position[position] = cohort
        cohort_sizes[position] = len(cohort)

    breakpoints: dict[str, dict[str, list[float] | None]] = {}
    observation_counts: dict[str, dict[str, int]] = {}
    for position, columns in POSITION_COLUMNS.items():
        cohort = cohort_by_position.get(position, set())
        shaded_columns = [c for c in columns if c not in ("opp", "fin")]
        col_index = {key: idx + 1 for idx, key in enumerate(columns)}  # +1: row[0] is week
        values_by_col: dict[str, list[float]] = defaultdict(list)
        for pid in cohort:
            series = players_out.get(pid)
            if series is None:
                continue
            for row in series["w"]:
                for col in shaded_columns:
                    value = row[col_index[col]]
                    if isinstance(value, (int, float)):
                        values_by_col[col].append(float(value))

        breakpoints[position] = {}
        observation_counts[position] = {}
        for col in shaded_columns:
            values = sorted(values_by_col.get(col, []))
            observation_counts[position][col] = len(values)
            if len(values) < _MIN_HEAT_SAMPLE:
                breakpoints[position][col] = None
                continue
            breakpoints[position][col] = [
                round(_percentile(values, pct), 2) for pct in _HEAT_PERCENTILES
            ]

    diagnostics = {"heatCohortSizes": cohort_sizes, "heatObservationCounts": observation_counts}
    return breakpoints, diagnostics


def build_weekly_stats(
    weekly_payloads: dict[int, dict[str, dict[str, Any]]],
    weeks_fetched: list[int],
    players: dict[str, PlayerMeta],
    gsis_to_player: dict[str, str],
    schedule_rows: list[dict[str, Any]] | None,
    roster_rows: list[dict[str, Any]] | None,
    player_stats_rows: list[dict[str, Any]],
    season: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build the committed data/weekly-stats.json artifact plus its diagnostics.

    `weekly_payloads` is week -> raw Sleeper payload for weeks that fetched
    successfully; a week absent from `weeks_fetched` is never treated as a bye
    or an inactive week downstream -- it must read as "not fetched".
    """
    position_of = {pid: meta.position for pid, meta in players.items()}

    opponent_map = build_opponent_map(schedule_rows or [], season)
    bye_by_team = bye_weeks_by_team(schedule_rows or [], season)
    roster_team_by_week = player_team_by_week(roster_rows or [], gsis_to_player, season)
    stats_team_by_week = player_stats_team_by_week(player_stats_rows, gsis_to_player, season)
    kdef_ranks = compute_position_ranks(weekly_payloads, position_of)

    stat_keys_observed: set[str] = set()
    player_rows: dict[str, list[tuple[int, list[Any]]]] = defaultdict(list)
    player_teams_used: dict[str, Counter[str]] = defaultdict(Counter)
    opponent_resolved = 0
    opponent_missing = 0

    for week in sorted(weekly_payloads):
        payload = weekly_payloads[week]
        for pid, row in payload.items():
            if not isinstance(row, dict):
                continue
            position = position_of.get(pid)
            if position not in POSITION_COLUMNS:
                continue
            pts = row.get(_PTS_FIELD)
            if pts is None:
                continue
            try:
                pts_value = float(pts)
            except (TypeError, ValueError):
                continue

            stat_keys_observed.update(k for k, v in row.items() if v is not None)
            # `pts` is our column name for Sleeper's `pts_ppr` key -- record it
            # under our name too, or it would always read as "missing" (the raw
            # key scan above never sees a key literally spelled "pts").
            stat_keys_observed.add("pts")

            if position == "DEF":
                team = pid
            else:
                team = (
                    roster_team_by_week.get((pid, week))
                    or stats_team_by_week.get((pid, week))
                )
            if team:
                player_teams_used[pid][team] += 1
                opp = opponent_map.get((team, week))
            else:
                opp = None
            if opp is not None:
                opponent_resolved += 1
            else:
                opponent_missing += 1

            if position in ("K", "DEF"):
                fin = kdef_ranks.get((pid, week))
            else:
                raw_rank = row.get("pos_rank_ppr")
                fin = None if raw_rank is None or float(raw_rank) == _RANK_SENTINEL else int(raw_rank)

            snp = _snap_pct(row, position)

            values: list[Any] = []
            for key in POSITION_COLUMNS[position]:
                if key == "pts":
                    values.append(_round(pts_value, 2))
                elif key == "opp":
                    values.append(opp)
                elif key == "snp":
                    values.append(snp)
                elif key == "fin":
                    values.append(fin)
                else:
                    raw_value = row.get(key)
                    raw_value = 0 if raw_value is None else raw_value
                    digits = 1 if key in _ONE_DECIMAL_COLUMNS else 0
                    rounded = _round(raw_value, digits)
                    values.append(int(rounded) if digits == 0 and rounded is not None else rounded)

            player_rows[pid].append((week, values))

    players_out: dict[str, dict[str, Any]] = {}
    by_position: Counter[str] = Counter()
    for pid, rows in player_rows.items():
        position = position_of[pid]
        rows.sort(key=lambda item: item[0])
        modal_team = player_teams_used[pid].most_common(1)
        bye = bye_by_team.get(modal_team[0][0]) if modal_team else None
        players_out[pid] = {
            "p": position,
            "bye": bye,
            "w": [[week, *values] for week, values in rows],
        }
        by_position[position] += 1

    heat, heat_diagnostics = compute_heat_breakpoints(players_out)

    missing_expected_columns = sorted(_ALL_RAW_COLUMNS - stat_keys_observed)

    artifact = {
        "schemaVersion": WEEKLY_STATS_SCHEMA_VERSION,
        "season": season,
        "weeksFetched": sorted(weeks_fetched),
        "columns": {pos: list(cols) for pos, cols in POSITION_COLUMNS.items()},
        "players": dict(sorted(players_out.items())),
        "heat": heat,
    }

    diagnostics = {
        "weeksFetched": sorted(weeks_fetched),
        "playersWithSeries": len(players_out),
        "playerWeeks": sum(len(v["w"]) for v in players_out.values()),
        "byPosition": dict(sorted(by_position.items())),
        "statKeysObserved": sorted(stat_keys_observed),
        "missingExpectedColumns": missing_expected_columns,
        "finComputedForPositions": ["K", "DEF"],
        "opponentResolved": opponent_resolved,
        "opponentMissing": opponent_missing,
        **heat_diagnostics,
    }
    return artifact, diagnostics
