"""Pure transforms for prior-season usage, availability, and injury history."""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from statistics import median
from typing import Any, Iterable

from match import normalize_team
from transform import PlayerMeta

WEEKLY_SCORING_SCHEMA_VERSION = 1
_PPR_FIELD = "fantasy_points_ppr"

ELIGIBLE_ROSTER_STATUSES = {"ACT", "INA", "PUP", "RES", "RSN"}
KNOWN_ROSTER_STATUSES = ELIGIBLE_ROSTER_STATUSES | {
    "EXE", "DEV", "CUT", "E14", "NWT", "RET", "RFA", "RSR",
    "SUS", "TRC", "TRD", "TRL", "TRT", "UFA",
}
INJURY_ALIASES = {
    "hamstring strain": "hamstring",
    "strained hamstring": "hamstring",
    "concussion protocol": "concussion",
    "achilles tendon": "achilles",
}
_SPACE_RE = re.compile(r"\s+")


@dataclass
class ContextResult:
    usage: dict[str, dict[str, Any]]
    weekly: dict[str, list[dict[str, Any]]]
    diagnostics: dict[str, Any]


def _value(row: dict[str, Any], *names: str) -> Any:
    for name in names:
        value = row.get(name)
        if value is not None:
            return value
    return None


def _number(value: Any) -> float:
    return float(value) if isinstance(value, (int, float)) else 0.0


def _finite_ppr(row: dict[str, Any]) -> float | None:
    raw = row.get(_PPR_FIELD)
    try:
        points = float(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None
    if points is None or not math.isfinite(points):
        return None
    return points


def _season(row: dict[str, Any]) -> int | None:
    value = row.get("season")
    return int(value) if isinstance(value, (int, float)) else None


def _week(row: dict[str, Any]) -> int | None:
    value = row.get("week")
    return int(value) if isinstance(value, (int, float)) else None


def _is_regular(row: dict[str, Any]) -> bool:
    value = str(_value(row, "season_type", "game_type") or "REG").strip().upper()
    return value in {"REG", "REGULAR"}


def assert_no_season_leakage(rows: Iterable[dict[str, Any]], draft_season: int, source: str) -> None:
    seasons = {_season(row) for row in rows}
    if None in seasons:
        raise ValueError(f"{source} is missing a season value")
    leaked = sorted(value for value in seasons if value is not None and value >= draft_season)
    if leaked:
        raise ValueError(f"{source} contains draft/future season rows: {leaked}")


def normalize_injury_label(label: Any) -> str | None:
    if not isinstance(label, str):
        return None
    normalized = _SPACE_RE.sub(" ", label.strip().lower())
    if not normalized or normalized == "rest" or normalized.startswith((
        "rest ", "veteran rest", "not injury related", "not injury-related",
    )):
        return None
    return INJURY_ALIASES.get(normalized, normalized)


def current_issue_has_prior_history(
    current_body_part: str | None, injury_history: list[dict[str, Any]],
) -> bool:
    normalized = normalize_injury_label(current_body_part)
    return normalized is not None and any(
        item["normalizedBodyPart"] == normalized for item in injury_history
    )


def _durability_band(score: int) -> str:
    if score >= 90:
        return "low concern"
    if score >= 75:
        return "mild concern"
    if score >= 60:
        return "moderate concern"
    if score >= 45:
        return "elevated concern"
    return "high concern"


def _durability_score(
    meta: PlayerMeta,
    seasons: list[dict[str, Any]],
    injury_history: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """A descriptive display index, deliberately not a future probability."""
    if len(seasons) < 2:
        return None
    latest = max(seasons, key=lambda row: row["season"])
    recent_missed = max(0, latest["teamGamesWhileRostered"] - latest["gamesWithAnySnap"])
    recent_games_missed_penalty = min(25.0, recent_missed * 1.5)
    recurring_parts = [item for item in injury_history if item["recurring"]]
    recurring_injury_penalty = min(15.0, len(recurring_parts) * 5.0)
    same_body_part_penalty = min(
        10.0,
        sum(max(0, item["episodes"] - 2) * 3.0 for item in recurring_parts),
    )
    recent_injury_penalty = min(
        15.0,
        latest["injuryReportWeeks"] * 0.5 + latest["outWeeks"] * 1.5,
    )
    high_exposure_adjustment = min(5.0, latest["gamesWithAnySnap"] / 3.0)
    position_penalty = {"RB": 3.0, "TE": 1.0, "WR": 1.0, "QB": 0.0}.get(meta.position or "", 0.0)
    age_penalty = max(0.0, min(8.0, ((meta.age or 26) - 29) * 1.5))
    age_position_adjustment = -(position_penalty + age_penalty)
    components = {
        "baseline": 100.0,
        "recentGamesMissedPenalty": -round(recent_games_missed_penalty, 2),
        "recurringInjuryPenalty": -round(recurring_injury_penalty, 2),
        "sameBodyPartPenalty": -round(same_body_part_penalty, 2),
        "recentInjuryPenalty": -round(recent_injury_penalty, 2),
        "highExposureAdjustment": round(high_exposure_adjustment, 2),
        "agePositionBaselineAdjustment": round(age_position_adjustment, 2),
    }
    component_total = sum(components.values())
    if component_total > 100.0:
        components["highExposureAdjustment"] = round(
            components["highExposureAdjustment"] - (component_total - 100.0), 2,
        )
    raw_total = sum(components.values())
    score = round(max(0.0, min(100.0, raw_total)), 2)
    # Keep the published score auditable from components even after clamping.
    clamp_delta = score - round(raw_total, 2)
    if abs(clamp_delta) > 1e-9:
        components["baseline"] = round(components["baseline"] + clamp_delta, 2)
    return {"score": score, "band": _durability_band(score), "components": components}


def _team_week(row: dict[str, Any]) -> tuple[int, int, str] | None:
    season, week = _season(row), _week(row)
    team = normalize_team(_value(row, "team", "recent_team", "posteam"))
    if season is None or week is None or team is None or not _is_regular(row):
        return None
    return season, week, team


def _player_id(row: dict[str, Any], id_map: dict[str, str], *fields: str) -> str | None:
    value = _value(row, *fields)
    if value in (None, ""):
        return None
    # Strip so padded DynastyProcess gsis keys still match clean nflverse ids.
    return id_map.get(str(value).strip())


def _team_snap_totals(snap_rows: list[dict[str, Any]]) -> dict[tuple[int, int, str], float]:
    estimates: dict[tuple[int, int, str], list[float]] = defaultdict(list)
    max_snaps: dict[tuple[int, int, str], float] = defaultdict(float)
    for row in snap_rows:
        key = _team_week(row)
        if key is None:
            continue
        snaps = _number(row.get("offense_snaps"))
        max_snaps[key] = max(max_snaps[key], snaps)
        pct = _number(row.get("offense_pct"))
        if snaps > 0 and pct > 0:
            fraction = pct / 100 if pct > 1 else pct
            if 0 < fraction <= 1:
                estimates[key].append(snaps / fraction)
    return {
        key: float(round(median(estimates[key]))) if estimates[key] else maximum
        for key, maximum in max_snaps.items()
    }


def _pbp_opportunity(
    pbp_rows: list[dict[str, Any]] | None,
    gsis_to_player: dict[str, str],
) -> dict[str, Counter[tuple[str, tuple[int, int, str]]]]:
    metrics = {
        "redZoneTargets": Counter(),
        "endZoneTargets": Counter(),
        "goalLineCarries": Counter(),
    }
    if pbp_rows is None:
        return metrics
    for row in pbp_rows:
        key = _team_week(row)
        if key is None:
            continue
        yardline = _number(row.get("yardline_100"))
        if yardline <= 0:
            continue
        receiver = _value(row, "receiver_player_id")
        rusher = _value(row, "rusher_player_id")
        pass_attempt = _number(row.get("pass_attempt"))
        rush_attempt = _number(row.get("rush_attempt"))
        if receiver not in (None, "") and pass_attempt > 0 and yardline <= 20:
            pid = gsis_to_player.get(str(receiver))
            if pid:
                metrics["redZoneTargets"][(pid, key)] += 1
                # End-zone target: throw travels to/beyond the goal line.
                if _number(row.get("air_yards")) >= yardline:
                    metrics["endZoneTargets"][(pid, key)] += 1
        if rusher not in (None, "") and rush_attempt > 0 and yardline <= 5:
            pid = gsis_to_player.get(str(rusher))
            if pid:
                metrics["goalLineCarries"][(pid, key)] += 1
    return metrics


def _opportunity_period(
    pid: str,
    season: int,
    keys: set[tuple[int, int, str]],
    player_targets: Counter[tuple[str, tuple[int, int, str]]],
    player_carries: Counter[tuple[str, tuple[int, int, str]]],
    player_air_yards: Counter[tuple[str, tuple[int, int, str]]],
    player_yac: Counter[tuple[str, tuple[int, int, str]]],
    team_targets: Counter[tuple[int, int, str]],
    team_carries: Counter[tuple[int, int, str]],
    team_air_yards: Counter[tuple[int, int, str]],
    team_snap_totals: dict[tuple[int, int, str], float],
    offensive_snaps: Counter[tuple[str, tuple[int, int, str]]],
    pbp_metrics: dict[str, Counter[tuple[str, tuple[int, int, str]]]],
    pbp_available: bool,
    position: str | None = None,
) -> dict[str, Any]:
    games = len(keys)
    targets = sum(player_targets[(pid, key)] for key in keys)
    carries = sum(player_carries[(pid, key)] for key in keys)
    air_yards = sum(player_air_yards[(pid, key)] for key in keys)
    yac = sum(player_yac[(pid, key)] for key in keys)
    target_denominator = sum(team_targets[key] for key in keys)
    carry_denominator = sum(team_carries[key] for key in keys)
    air_yards_denominator = sum(team_air_yards[key] for key in keys)
    snap_denominator = sum(team_snap_totals.get(key, 0) for key in keys)
    snap_numerator = sum(offensive_snaps[(pid, key)] for key in keys)
    summary = {
        "season": season,
        "games": games,
        "targets": targets,
        "carries": carries,
        "touches": targets + carries,
        "targetsPerGame": targets / games if games else None,
        "carriesPerGame": carries / games if games else None,
        "touchesPerGame": (targets + carries) / games if games else None,
        "targetShare": (
            targets / target_denominator
            if position != "QB" and target_denominator > 0
            else None
        ),
        "carryShare": carries / carry_denominator if carry_denominator > 0 else None,
        "airYards": air_yards if air_yards_denominator_exists(air_yards_denominator) else None,
        "airYardsPerGame": air_yards / games if games and air_yards_denominator_exists(air_yards_denominator) else None,
        "airYardsShare": air_yards / air_yards_denominator if air_yards_denominator_exists(air_yards_denominator) else None,
        "receivingYardsAfterCatch": yac,
        "redZoneTargets": sum(pbp_metrics["redZoneTargets"][(pid, key)] for key in keys) if pbp_available else None,
        "endZoneTargets": sum(pbp_metrics["endZoneTargets"][(pid, key)] for key in keys) if pbp_available else None,
        "goalLineCarries": sum(pbp_metrics["goalLineCarries"][(pid, key)] for key in keys) if pbp_available else None,
        "snapPct": snap_numerator / snap_denominator if snap_denominator > 0 else None,
    }
    for field in ("targetShare", "carryShare", "airYardsShare", "snapPct"):
        value = summary[field]
        if value is not None and not 0 <= value <= 1:
            summary[field] = None
    return summary


def air_yards_denominator_exists(value: float) -> bool:
    return value > 0


def _production_summary(
    pid: str,
    keys: set[tuple[int, int, str]],
    player_ppr: Counter[tuple[str, tuple[int, int, str]]],
    player_receptions: Counter[tuple[str, tuple[int, int, str]]],
    player_rec_yards: Counter[tuple[str, tuple[int, int, str]]],
    player_rec_tds: Counter[tuple[str, tuple[int, int, str]]],
    player_rush_yards: Counter[tuple[str, tuple[int, int, str]]],
    player_rush_tds: Counter[tuple[str, tuple[int, int, str]]],
) -> dict[str, Any]:
    """Season PPR production over the same appearance weeks as opportunity. Display-only."""
    games = len(keys)
    points = sum(player_ppr[(pid, key)] for key in keys)
    return {
        "games": games,
        "pointsPpr": points,
        "pointsPprPerGame": points / games if games else None,
        "receptions": sum(player_receptions[(pid, key)] for key in keys),
        "receivingYards": sum(player_rec_yards[(pid, key)] for key in keys),
        "receivingTds": sum(player_rec_tds[(pid, key)] for key in keys),
        "rushingYards": sum(player_rush_yards[(pid, key)] for key in keys),
        "rushingTds": sum(player_rush_tds[(pid, key)] for key in keys),
    }


def build_weekly_scoring(
    player_stats: list[dict[str, Any]],
    gsis_to_player: dict[str, str],
    usage_season: int,
    players: dict[str, PlayerMeta],
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    """One pass over already-loaded `player_stats`; no extra nflreadpy request.

    Deliberately does not use `_team_week`: that helper rejects a missing team,
    but a stats row can carry a valid `fantasy_points_ppr` with a null team.
    """
    rows_scanned = 0
    rows_in_usage_season = 0
    rows_missing_ppr_field = 0
    had_usable_observation = False
    totals: dict[tuple[str, int], float] = defaultdict(float)

    for row in player_stats:
        rows_scanned += 1
        season = _season(row)
        week = _week(row)
        if not _is_regular(row) or season != usage_season or week is None or not 1 <= week <= 22:
            continue
        rows_in_usage_season += 1

        raw = row.get(_PPR_FIELD)
        points: float | None
        try:
            points = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            points = None
        if points is None or not math.isfinite(points):
            rows_missing_ppr_field += 1
            continue
        had_usable_observation = True

        pid = _player_id(row, gsis_to_player, "player_id", "gsis_id")
        if pid is None:
            continue
        totals[(pid, week)] += points

    if rows_in_usage_season > 0 and not had_usable_observation:
        raise ValueError(
            f"No usable '{_PPR_FIELD}' observations found among usage-season player stats rows",
        )

    weekly: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for (pid, week), points in totals.items():
        # Round after aggregation so binary float noise (e.g. 23.200000000000003)
        # does not ship in the committed chart artifact; fantasy PPR is 2dp.
        weekly[pid].append({"week": week, "pointsPpr": round(points, 2)})
    for series in weekly.values():
        series.sort(key=lambda entry: entry["week"])
    weekly_sorted = dict(sorted(weekly.items()))

    by_position: Counter[str] = Counter()
    for pid in weekly_sorted:
        meta = players.get(pid)
        position = meta.position if meta and meta.position else "unknown"
        by_position[position] += 1

    diagnostics = {
        "rowsScanned": rows_scanned,
        "rowsInUsageSeason": rows_in_usage_season,
        "rowsMissingPprField": rows_missing_ppr_field,
        "playersWithSeries": len(weekly_sorted),
        "weeksObserved": len(totals),
        "byPosition": dict(sorted(by_position.items())),
    }
    return weekly_sorted, diagnostics


def build_player_context(
    players: dict[str, PlayerMeta],
    player_stats: list[dict[str, Any]],
    snap_counts: list[dict[str, Any]],
    weekly_rosters: list[dict[str, Any]],
    injuries: list[dict[str, Any]],
    draft_season: int,
    pbp_rows: list[dict[str, Any]] | None = None,
) -> ContextResult:
    for name, rows in (
        ("player stats", player_stats),
        ("snap counts", snap_counts),
        ("weekly rosters", weekly_rosters),
        ("injury reports", injuries),
    ):
        assert_no_season_leakage(rows, draft_season, name)

    history_seasons = list(range(draft_season - 3, draft_season))
    usage_season = draft_season - 1
    # Strip id values: committed players.json can still carry padded
    # DynastyProcess gsis/pfr strings until the next full refresh rewrites them.
    gsis_to_player = {
        meta.ids["gsis"].strip(): pid
        for pid, meta in players.items()
        if meta.ids.get("gsis") and meta.ids["gsis"].strip()
    }
    pfr_to_player = {
        meta.ids["pfr"].strip(): pid
        for pid, meta in players.items()
        if meta.ids.get("pfr") and meta.ids["pfr"].strip()
    }
    weekly, weekly_diagnostics = build_weekly_scoring(
        player_stats, gsis_to_player, usage_season, players,
    )

    team_games = {_team_week(row) for row in snap_counts}
    team_games.discard(None)
    team_snap_totals = _team_snap_totals(snap_counts)

    eligible_games: dict[str, set[tuple[int, int, str]]] = defaultdict(set)
    unknown_statuses: Counter[str] = Counter()
    for row in weekly_rosters:
        key = _team_week(row)
        pid = _player_id(row, gsis_to_player, "gsis_id", "player_id")
        if key is None or key not in team_games or pid is None:
            continue
        status = str(row.get("status") or "").strip().upper()
        if status in ELIGIBLE_ROSTER_STATUSES:
            eligible_games[pid].add(key)
        elif status not in KNOWN_ROSTER_STATUSES:
            unknown_statuses[status or "<blank>"] += 1

    snap_games: dict[str, set[tuple[int, int, str]]] = defaultdict(set)
    offensive_snaps: Counter[tuple[str, tuple[int, int, str]]] = Counter()
    for row in snap_counts:
        key = _team_week(row)
        pid = _player_id(row, pfr_to_player, "pfr_player_id")
        if key is None or pid is None:
            continue
        offense = _number(row.get("offense_snaps"))
        any_snaps = offense + _number(row.get("defense_snaps")) + _number(row.get("st_snaps"))
        if any_snaps > 0:
            snap_games[pid].add(key)
        offensive_snaps[(pid, key)] += offense

    team_targets: Counter[tuple[int, int, str]] = Counter()
    team_carries: Counter[tuple[int, int, str]] = Counter()
    team_air_yards: Counter[tuple[int, int, str]] = Counter()
    player_targets: Counter[tuple[str, tuple[int, int, str]]] = Counter()
    player_carries: Counter[tuple[str, tuple[int, int, str]]] = Counter()
    player_air_yards: Counter[tuple[str, tuple[int, int, str]]] = Counter()
    player_yac: Counter[tuple[str, tuple[int, int, str]]] = Counter()
    player_ppr: Counter[tuple[str, tuple[int, int, str]]] = Counter()
    player_receptions: Counter[tuple[str, tuple[int, int, str]]] = Counter()
    player_rec_yards: Counter[tuple[str, tuple[int, int, str]]] = Counter()
    player_rec_tds: Counter[tuple[str, tuple[int, int, str]]] = Counter()
    player_rush_yards: Counter[tuple[str, tuple[int, int, str]]] = Counter()
    player_rush_tds: Counter[tuple[str, tuple[int, int, str]]] = Counter()
    player_pass_completions: Counter[tuple[str, tuple[int, int, str]]] = Counter()
    player_pass_attempts: Counter[tuple[str, tuple[int, int, str]]] = Counter()
    for row in player_stats:
        key = _team_week(row)
        if key is None:
            continue
        targets, carries = _number(row.get("targets")), _number(row.get("carries"))
        air_yards = _number(row.get("receiving_air_yards"))
        yac = _number(row.get("receiving_yards_after_catch"))
        team_targets[key] += targets
        team_carries[key] += carries
        team_air_yards[key] += air_yards
        pid = _player_id(row, gsis_to_player, "player_id", "gsis_id")
        if pid is not None:
            player_targets[(pid, key)] += targets
            player_carries[(pid, key)] += carries
            player_air_yards[(pid, key)] += air_yards
            player_yac[(pid, key)] += yac
            player_receptions[(pid, key)] += _number(row.get("receptions"))
            player_rec_yards[(pid, key)] += _number(row.get("receiving_yards"))
            player_rec_tds[(pid, key)] += _number(row.get("receiving_tds"))
            player_rush_yards[(pid, key)] += _number(row.get("rushing_yards"))
            player_rush_tds[(pid, key)] += _number(row.get("rushing_tds"))
            player_pass_completions[(pid, key)] += _number(_value(row, "completions", "passing_completions", "pass_cmp"))
            player_pass_attempts[(pid, key)] += _number(_value(row, "attempts", "passing_attempts", "pass_att"))
            ppr = _finite_ppr(row)
            if ppr is not None:
                player_ppr[(pid, key)] += ppr

    injury_by_week: dict[tuple[str, int, int], list[tuple[str, str]]] = defaultdict(list)
    injury_report_weeks: dict[str, set[tuple[int, int]]] = defaultdict(set)
    out_weeks: dict[str, set[tuple[int, int]]] = defaultdict(set)
    for row in injuries:
        if not _is_regular(row):
            continue
        pid = _player_id(row, gsis_to_player, "gsis_id", "player_id")
        season, week = _season(row), _week(row)
        if pid is None or season is None or week is None:
            continue
        labels: list[tuple[str, str]] = []
        for field in (
            "report_primary_injury", "report_secondary_injury",
            "practice_primary_injury", "practice_secondary_injury",
        ):
            raw = row.get(field)
            normalized = normalize_injury_label(raw)
            if normalized is not None:
                labels.append((str(raw).strip(), normalized))
        if not labels:
            continue
        injury_report_weeks[pid].add((season, week))
        if str(row.get("report_status") or "").strip().lower() == "out":
            out_weeks[pid].add((season, week))
        existing = injury_by_week[(pid, season, week)]
        for label in labels:
            if label not in existing:
                existing.append(label)

    usage: dict[str, dict[str, Any]] = {}
    pbp_available = pbp_rows is not None
    pbp_metrics = _pbp_opportunity(pbp_rows, gsis_to_player)
    for pid in sorted(set(eligible_games) | set(snap_games)):
        meta = players.get(pid)
        if meta is None:
            continue
        season_rows: list[dict[str, Any]] = []
        for season in history_seasons:
            possible = {key for key in eligible_games.get(pid, set()) if key[0] == season}
            if not possible:
                continue
            appeared = snap_games.get(pid, set()) & possible
            season_rows.append({
                "season": season,
                "teamGamesWhileRostered": len(possible),
                "gamesWithAnySnap": len(appeared),
                "availabilityRate": len(appeared) / len(possible),
                "injuryReportWeeks": len({
                    value for value in injury_report_weeks.get(pid, set()) if value[0] == season
                }),
                "outWeeks": len({
                    value for value in out_weeks.get(pid, set()) if value[0] == season
                }),
            })

        possible_total = sum(row["teamGamesWhileRostered"] for row in season_rows)
        appeared_total = sum(row["gamesWithAnySnap"] for row in season_rows)
        prior_games = {key for key in eligible_games.get(pid, set()) if key[0] == usage_season}
        prior_snap_games = {key for key in snap_games.get(pid, set()) if key[0] == usage_season}
        usage_season_observed = bool(prior_games or prior_snap_games)
        known_absent = bool(prior_games) and not prior_snap_games

        # Shares are opportunity-weighted over appearance weeks only. Rostered
        # DNP weeks belong in availabilityRate, not snap/target/carry share.
        snap_pct: float | None = None
        target_share: float | None = None
        carry_share: float | None = None
        completion_pct: float | None = None
        if prior_snap_games:
            team_snap_sum = sum(team_snap_totals.get(key, 0) for key in prior_snap_games)
            player_snap_sum = sum(offensive_snaps[(pid, key)] for key in prior_snap_games)
            snap_pct = player_snap_sum / team_snap_sum if team_snap_sum > 0 else None
            target_denominator = sum(team_targets[key] for key in prior_snap_games)
            carry_denominator = sum(team_carries[key] for key in prior_snap_games)
            target_numerator = sum(player_targets[(pid, key)] for key in prior_snap_games)
            carry_numerator = sum(player_carries[(pid, key)] for key in prior_snap_games)
            if meta.position != "QB" and target_denominator > 0:
                target_share = target_numerator / target_denominator
            if carry_denominator > 0:
                carry_share = carry_numerator / carry_denominator
            pass_attempts = sum(player_pass_attempts[(pid, key)] for key in prior_snap_games)
            pass_completions = sum(player_pass_completions[(pid, key)] for key in prior_snap_games)
            if meta.position == "QB" and pass_attempts > 0:
                completion_pct = pass_completions / pass_attempts

        appearances = sorted(prior_snap_games, key=lambda key: (key[0], key[1], key[2]))
        recent_team = appearances[-1][2] if appearances else None
        player_injuries = {
            (season, week): labels
            for (injury_pid, season, week), labels in injury_by_week.items()
            if injury_pid == pid
        }
        history: list[dict[str, Any]] = []
        normalized_parts = sorted({
            normalized for labels in player_injuries.values() for _, normalized in labels
        })
        for part in normalized_parts:
            report_week_set = {
                season_week for season_week, labels in player_injuries.items()
                if any(normalized == part for _, normalized in labels)
            }
            reports: list[dict[str, Any]] = []
            episodes = 0
            previous: tuple[int, int] | None = None
            for season, week in sorted(report_week_set):
                game_gap = previous is not None and season == previous[0] and any(
                    previous[1] < game_week < week and (season, game_week) not in report_week_set
                    for game_season, game_week, _ in eligible_games.get(pid, set())
                    if game_season == season
                )
                if previous is None or season != previous[0] or game_gap:
                    episodes += 1
                reports.append({
                    "season": season,
                    "week": week,
                    "labels": sorted({
                        raw for raw, normalized in player_injuries[(season, week)]
                        if normalized == part
                    }),
                })
                previous = (season, week)
            history.append({
                "normalizedBodyPart": part,
                "episodes": episodes,
                "recurring": episodes >= 2,
                "reports": reports,
            })

        opportunity: dict[str, Any] | None = None
        if prior_snap_games:
            season_period = _opportunity_period(
                pid, usage_season, prior_snap_games, player_targets, player_carries,
                player_air_yards, player_yac, team_targets, team_carries, team_air_yards,
                team_snap_totals, offensive_snaps, pbp_metrics, pbp_available,
                meta.position,
            )
            final_keys = set(sorted(
                prior_snap_games, key=lambda key: (key[1], key[2]),
            )[-5:])
            final_period = _opportunity_period(
                pid, usage_season, final_keys, player_targets, player_carries,
                player_air_yards, player_yac, team_targets, team_carries, team_air_yards,
                team_snap_totals, offensive_snaps, pbp_metrics, pbp_available,
                meta.position,
            ) if final_keys else None

            def delta(field: str) -> float | None:
                if final_period is None or final_period[field] is None or season_period[field] is None:
                    return None
                return final_period[field] - season_period[field]

            opportunity = {
                "season": season_period,
                "finalFive": final_period,
                "roleEvolution": {
                    "targetsPerGameDelta": delta("targetsPerGame"),
                    "targetShareDelta": delta("targetShare"),
                    "airYardsShareDelta": delta("airYardsShare"),
                    "touchesPerGameDelta": delta("touchesPerGame"),
                },
            }

        production = (
            _production_summary(
                pid, prior_snap_games, player_ppr, player_receptions, player_rec_yards,
                player_rec_tds, player_rush_yards, player_rush_tds,
            )
            if prior_snap_games else None
        )

        if not season_rows and not usage_season_observed:
            continue
        current_team = normalize_team(meta.team)
        usage[pid] = {
            "season": usage_season,
            "usageSeasonObserved": usage_season_observed,
            "snapPct": snap_pct,
            **({"completionPct": completion_pct} if meta.position == "QB" else {}),
            "targetShare": target_share,
            "carryShare": carry_share,
            "gamesWithAnySnap": len(prior_snap_games),
            "recentTeam": recent_team,
            "teamChanged": current_team != recent_team if current_team and recent_team else None,
            "knownAbsent": known_absent,
            "availabilityRate": appeared_total / possible_total if possible_total else None,
            "seasons": season_rows,
            "injuryHistory": history,
            "durabilityScore": _durability_score(meta, season_rows, history),
            "opportunity": opportunity,
            "production": production,
        }

    return ContextResult(
        usage=usage,
        weekly=weekly,
        diagnostics={
            "unknownRosterStatuses": dict(sorted(unknown_statuses.items())),
            "historySeasons": history_seasons,
            "usageSeason": usage_season,
            "weeklyScoring": weekly_diagnostics,
        },
    )


def coverage_report(
    players: dict[str, PlayerMeta],
    adp_entries: list[Any],
    usage: dict[str, dict[str, Any]],
    limit: int = 200,
) -> dict[str, Any]:
    cohort: list[str] = []
    for entry in adp_entries:
        if len(cohort) >= limit:
            break
        pid = entry.playerId
        meta = players.get(pid) if pid else None
        if meta and meta.position in {"QB", "RB", "WR", "TE"} and (meta.yearsExp or 0) > 0:
            cohort.append(pid)
    known_absent = [pid for pid in cohort if usage.get(pid, {}).get("knownAbsent")]
    observed = [pid for pid in cohort if usage.get(pid, {}).get("gamesWithAnySnap", 0) > 0]
    covered_set = set(known_absent) | set(observed)
    covered = [pid for pid in cohort if pid in covered_set]
    missing = [pid for pid in cohort if pid not in covered_set]
    return {
        "total": len(cohort),
        "covered": len(covered),
        "knownAbsent": len(known_absent),
        "missing": len(missing),
        "matchRate": len(covered) / len(cohort) if cohort else 0,
        "missingPlayerIds": missing,
    }

