import json
from pathlib import Path
from types import SimpleNamespace

import pytest

import build_data
import context
import espn_projections
import nflverse_source
import sources
import transform


def player(
    player_id: str,
    *,
    team: str = "BUF",
    position: str = "RB",
    gsis: str | None = None,
    pfr: str | None = None,
    years_exp: int = 3,
) -> transform.PlayerMeta:
    ids = {}
    if gsis:
        ids["gsis"] = gsis
    if pfr:
        ids["pfr"] = pfr
    return transform.PlayerMeta(
        playerId=player_id, name=player_id, position=position,
        eligiblePositions=[position], team=team, byeWeek=None, age=25,
        yearsExp=years_exp, injuryStatus=None, depthChartPosition=None,
        depthChartOrder=None, injuryBodyPart=None, practiceParticipation=None, ids=ids,
    )


def snap(season, week, team, pfr_id, offense, pct, defense=0, special=0):
    return {
        "season": season, "week": week, "game_type": "REG", "team": team,
        "pfr_player_id": pfr_id, "offense_snaps": offense, "offense_pct": pct,
        "defense_snaps": defense, "st_snaps": special,
    }


def roster(season, week, team, gsis_id, status):
    return {
        "season": season, "week": week, "team": team,
        "gsis_id": gsis_id, "status": status,
    }


def stat(season, week, team, gsis_id, targets, carries, points_ppr=0.0, **extra):
    row = {
        "season": season, "week": week, "season_type": "REG", "recent_team": team,
        "player_id": gsis_id, "targets": targets, "carries": carries,
    }
    if points_ppr is not None:
        row["fantasy_points_ppr"] = points_ppr
    row.update(extra)
    return row


def test_player_metadata_preserves_sleeper_context_nulls_and_adds_pfr():
    result = transform.build_player_meta(
        {
            "1": {
                "full_name": "Test Player", "position": "RB", "fantasy_positions": ["RB"],
                "team": "BUF", "depth_chart_position": "RB", "depth_chart_order": 2,
                "injury_status": "Questionable", "injury_body_part": "Hamstring",
                "practice_participation": None,
            }
        },
        [{"sleeper_id": "1", "pfr_id": "TestPl00", "gsis_id": "00-0000001"}],
    )["1"]
    assert result.depthChartPosition == "RB"
    assert result.depthChartOrder == 2
    assert result.injuryBodyPart == "Hamstring"
    assert result.practiceParticipation is None
    assert result.ids["pfr"] == "TestPl00"


def test_usage_handles_team_changes_weighted_shares_zeros_and_known_absence():
    players = {
        "1": player("1", team="BUF", gsis="g1", pfr="p1"),
        "3": player("3", team="DAL", gsis="g3", pfr="p3"),
        "4": player("4", team="NYJ", gsis="g4", pfr="p4", years_exp=0),
    }
    snaps = [
        snap(2025, 1, "BUF", "p1", 30, .5),
        snap(2025, 1, "BUF", "team-a", 60, 1),
        snap(2025, 2, "KC", "p1", 20, .2),
        snap(2025, 2, "KC", "team-b", 100, 1),
        snap(2025, 1, "DAL", "team-c", 70, 1),
    ]
    stats = [
        stat(2025, 1, "BUF", "g1", 2, 0), stat(2025, 1, "BUF", "other", 8, 5),
        stat(2025, 2, "KC", "g1", 6, 0), stat(2025, 2, "KC", "other", 14, 15),
    ]
    rosters = [
        roster(2025, 1, "BUF", "g1", "ACT"), roster(2025, 2, "KC", "g1", "ACT"),
        roster(2025, 1, "DAL", "g3", "INA"),
    ]
    result = context.build_player_context(players, stats, snaps, rosters, [], 2026).usage
    assert result["1"]["snapPct"] == 50 / 160
    assert result["1"]["targetShare"] == 8 / 30
    assert result["1"]["carryShare"] == 0
    assert result["1"]["gamesWithAnySnap"] == 2
    assert result["1"]["usageSeasonObserved"] is True
    assert result["1"]["recentTeam"] == "KC"
    assert result["1"]["teamChanged"] is True
    assert result["3"]["knownAbsent"] is True
    assert result["3"]["usageSeasonObserved"] is True
    assert result["3"]["snapPct"] is None
    assert "4" not in result
    opportunity = result["1"]["opportunity"]
    assert opportunity["season"]["targets"] == 8
    assert opportunity["season"]["targetShare"] == 8 / 30
    assert opportunity["season"]["games"] == 2
    assert opportunity["finalFive"]["games"] == 2
    assert opportunity["roleEvolution"]["targetsPerGameDelta"] == 0


def test_epa_sums_when_present_and_nulls_rather_than_zeros_when_absent():
    players = {"1": player("1", team="BUF", gsis="g1", pfr="p1")}
    snaps = [snap(2025, 1, "BUF", "p1", 30, .5), snap(2025, 2, "BUF", "p1", 30, .5)]
    rosters = [roster(2025, 1, "BUF", "g1", "ACT"), roster(2025, 2, "BUF", "g1", "ACT")]

    # Source rows carry rushing_epa/receiving_epa: the fields sum and average normally.
    stats_with_epa = [
        stat(2025, 1, "BUF", "g1", 2, 3, rushing_epa=1.5, receiving_epa=0.5),
        stat(2025, 2, "BUF", "g1", 2, 3, rushing_epa=2.5, receiving_epa=-0.5),
    ]
    usage = context.build_player_context(players, stats_with_epa, snaps, rosters, [], 2026).usage
    season = usage["1"]["opportunity"]["season"]
    assert season["rushingEpa"] == 4.0
    assert season["rushingEpaPerGame"] == 2.0
    assert season["receivingEpa"] == 0.0
    assert season["receivingEpaPerGame"] == 0.0

    # Source rows lack the EPA columns entirely: fields must be None, never a coerced 0.0 that
    # would read as an observed (replacement-level) EPA.
    stats_without_epa = [
        stat(2025, 1, "BUF", "g1", 2, 3),
        stat(2025, 2, "BUF", "g1", 2, 3),
    ]
    usage = context.build_player_context(players, stats_without_epa, snaps, rosters, [], 2026).usage
    season = usage["1"]["opportunity"]["season"]
    assert season["rushingEpa"] is None
    assert season["rushingEpaPerGame"] is None
    assert season["receivingEpa"] is None
    assert season["receivingEpaPerGame"] is None


def test_qb_completion_pct_aggregates_completions_over_attempts():
    players = {"qb": player("qb", position="QB", gsis="gqb", pfr="pqb")}
    snaps = [
        snap(2025, 1, "BUF", "pqb", 60, .6),
        snap(2025, 1, "BUF", "team-a", 100, 1),
        snap(2025, 2, "BUF", "pqb", 60, .6),
        snap(2025, 2, "BUF", "team-a", 100, 1),
    ]
    stats = [
        stat(2025, 1, "BUF", "gqb", 0, 0, completions=22, attempts=30),
        stat(2025, 2, "BUF", "gqb", 0, 0, completions=18, attempts=25),
    ]
    rosters = [
        roster(2025, 1, "BUF", "gqb", "ACT"),
        roster(2025, 2, "BUF", "gqb", "ACT"),
    ]

    usage = context.build_player_context(players, stats, snaps, rosters, [], 2026).usage["qb"]

    assert usage["completionPct"] == 40 / 55

def test_production_aggregates_ppr_and_skill_stats_over_appearance_weeks():
    players = {"1": player("1", gsis="g1", pfr="p1")}
    snaps = [
        snap(2025, 1, "BUF", "p1", 50, .5),
        snap(2025, 1, "BUF", "team-a", 100, 1),
        snap(2025, 2, "BUF", "p1", 40, .4),
        snap(2025, 2, "BUF", "team-a", 100, 1),
        snap(2025, 3, "BUF", "team-a", 100, 1),
    ]
    stats = [
        stat(2025, 1, "BUF", "g1", 4, 12, points_ppr=18.4,
             receptions=3, receiving_yards=24, receiving_tds=0, rushing_yards=55, rushing_tds=1),
        stat(2025, 2, "BUF", "g1", 2, 8, points_ppr=9.6,
             receptions=1, receiving_yards=12, receiving_tds=0, rushing_yards=34, rushing_tds=0),
        # Rostered DNP week Ã¢â‚¬â€ must not enter production denominators.
        stat(2025, 3, "BUF", "other", 6, 10, points_ppr=12.0,
             receptions=4, receiving_yards=40, receiving_tds=1, rushing_yards=20, rushing_tds=0),
    ]
    rosters = [
        roster(2025, 1, "BUF", "g1", "ACT"),
        roster(2025, 2, "BUF", "g1", "ACT"),
        roster(2025, 3, "BUF", "g1", "INA"),
    ]
    production = context.build_player_context(players, stats, snaps, rosters, [], 2026).usage["1"]["production"]
    assert production["games"] == 2
    assert production["pointsPpr"] == 28.0
    assert production["pointsPprPerGame"] == 14.0
    assert production["receptions"] == 4
    assert production["receivingYards"] == 36
    assert production["receivingTds"] == 0
    assert production["rushingYards"] == 89
    assert production["rushingTds"] == 1


def test_production_is_absent_without_usage_season_snaps():
    players = {
        "1": player("1", gsis="g1", pfr="p1"),
        "3": player("3", team="DAL", gsis="g3", pfr="p3"),
    }
    snaps = [
        snap(2023, 1, "BUF", "p1", 20, .2),
        snap(2023, 1, "BUF", "team-a", 100, 1),
        snap(2025, 1, "DAL", "team-c", 70, 1),
    ]
    stats = [stat(2023, 1, "BUF", "g1", 4, 8, points_ppr=12.0, receptions=3, receiving_yards=30, receiving_tds=0, rushing_yards=40, rushing_tds=0)]
    rosters = [
        roster(2023, 1, "BUF", "g1", "ACT"),
        roster(2025, 1, "DAL", "g3", "INA"),
    ]
    result = context.build_player_context(players, stats, snaps, rosters, [], 2026).usage
    assert result["1"]["usageSeasonObserved"] is False
    assert result["1"]["production"] is None
    assert result["3"]["knownAbsent"] is True
    assert result["3"]["production"] is None


def test_usage_shares_exclude_rostered_dnp_weeks_from_denominators():
    players = {"1": player("1", gsis="g1", pfr="p1")}
    snaps = [
        snap(2025, 1, "BUF", "p1", 50, .5),
        snap(2025, 1, "BUF", "team-a", 100, 1),
        snap(2025, 2, "BUF", "team-b", 100, 1),
    ]
    stats = [
        stat(2025, 1, "BUF", "g1", 5, 10),
        stat(2025, 1, "BUF", "other", 5, 0),
        stat(2025, 2, "BUF", "other", 10, 20),
    ]
    rosters = [
        roster(2025, 1, "BUF", "g1", "ACT"),
        roster(2025, 2, "BUF", "g1", "INA"),
    ]
    result = context.build_player_context(players, stats, snaps, rosters, [], 2026).usage["1"]
    assert result["snapPct"] == 0.5
    assert result["targetShare"] == 0.5
    assert result["carryShare"] == 1.0
    assert result["gamesWithAnySnap"] == 1
    assert result["seasons"][0]["teamGamesWhileRostered"] == 2
    assert result["seasons"][0]["gamesWithAnySnap"] == 1


def test_older_history_without_usage_season_is_not_fake_zero_usage():
    players = {"1": player("1", gsis="g1", pfr="p1")}
    snaps = [
        snap(2023, 1, "BUF", "p1", 20, .2),
        snap(2023, 1, "BUF", "team-a", 100, 1),
    ]
    rosters = [roster(2023, 1, "BUF", "g1", "ACT")]
    result = context.build_player_context(players, [], snaps, rosters, [], 2026).usage["1"]
    assert result["usageSeasonObserved"] is False
    assert result["knownAbsent"] is False
    assert result["gamesWithAnySnap"] == 0
    assert result["snapPct"] is None
    assert result["seasons"][0]["season"] == 2023


def test_durability_excludes_byes_and_ineligible_statuses_and_reports_unknowns():
    players = {"1": player("1", gsis="g1", pfr="p1")}
    team_weeks = [1, 2, 4, 5, 6, 7, 8, 9, 10]
    snaps = [snap(2025, week, "BUF", f"team-{week}", 60, 1) for week in team_weeks]
    snaps += [snap(2025, week, "BUF", "p1", 10, .2) for week in [1, 2, 4, 5]]
    rosters = [
        roster(2025, 1, "BUF", "g1", "ACT"),
        roster(2025, 2, "BUF", "g1", "INA"),
        roster(2025, 3, "BUF", "g1", "PUP"),
        roster(2025, 4, "BUF", "g1", "RES"),
        roster(2025, 5, "BUF", "g1", "RSN"),
        roster(2025, 6, "BUF", "g1", "SUS"),
        roster(2025, 7, "BUF", "g1", "DEV"),
        roster(2025, 8, "BUF", "g1", "CUT"),
        roster(2025, 9, "BUF", "g1", "PUP"),
        roster(2025, 10, "BUF", "g1", "MYSTERY"),
    ]
    result = context.build_player_context(players, [], snaps, rosters, [], 2026)
    season = result.usage["1"]["seasons"][0]
    assert season["teamGamesWhileRostered"] == 5
    assert season["gamesWithAnySnap"] == 4
    assert season["availabilityRate"] == 4 / 5
    assert result.diagnostics["unknownRosterStatuses"] == {"MYSTERY": 1}


def test_injury_episodes_use_eligible_game_gaps_and_season_boundaries():
    players = {"1": player("1", gsis="g1", pfr="p1")}
    snaps = []
    rosters = []
    for season, weeks in ((2023, [1, 2, 3, 4]), (2024, [1])):
        for week in weeks:
            snaps.append(snap(season, week, "BUF", f"team-{season}-{week}", 60, 1))
            snaps.append(snap(season, week, "BUF", "p1", 10, .2))
            rosters.append(roster(season, week, "BUF", "g1", "ACT"))
    injuries = [
        {"season": 2023, "week": 1, "season_type": "REG", "gsis_id": "g1", "report_primary_injury": "Hamstring", "report_status": "Questionable"},
        {"season": 2023, "week": 2, "season_type": "REG", "gsis_id": "g1", "practice_primary_injury": "Hamstring Strain", "report_status": "Out"},
        {"season": 2023, "week": 4, "season_type": "REG", "gsis_id": "g1", "report_primary_injury": "HAMSTRING", "report_status": "Questionable"},
        {"season": 2024, "week": 1, "season_type": "REG", "gsis_id": "g1", "report_primary_injury": "Hamstring", "report_status": "Questionable"},
        {"season": 2024, "week": 1, "season_type": "REG", "gsis_id": "g1", "report_secondary_injury": "Knee", "report_status": "Questionable"},
        {"season": 2024, "week": 1, "season_type": "REG", "gsis_id": "g1", "practice_primary_injury": "Rest", "report_status": "Questionable"},
        {"season": 2024, "week": 1, "season_type": "REG", "gsis_id": "g1", "practice_primary_injury": "Not Injury Related - Suspension", "report_status": "Questionable"},
    ]
    usage = context.build_player_context(players, [], snaps, rosters, injuries, 2026).usage["1"]
    hamstring = next(item for item in usage["injuryHistory"] if item["normalizedBodyPart"] == "hamstring")
    knee = next(item for item in usage["injuryHistory"] if item["normalizedBodyPart"] == "knee")
    assert hamstring["episodes"] == 3
    assert hamstring["recurring"] is True
    assert knee["episodes"] == 1
    assert knee["recurring"] is False
    assert not any(item["normalizedBodyPart"] == "rest" for item in usage["injuryHistory"])
    assert context.current_issue_has_prior_history("Hamstring Strain", usage["injuryHistory"])
    score = usage["durabilityScore"]
    # Two seasons; latest=2024 with 0 missed games, 1 recurring part (3 episodes),
    # 1 report week / 0 out weeks, 1 snap-game exposure credit, RB age 25.
    assert score == {
        "score": 88.83,
        "band": "mild concern",
        "components": {
            "baseline": 100.0,
            "recentGamesMissedPenalty": -0.0,
            "recurringInjuryPenalty": -5.0,
            "sameBodyPartPenalty": -3.0,
            "recentInjuryPenalty": -0.5,
            "highExposureAdjustment": 0.33,
            "agePositionBaselineAdjustment": -3.0,
        },
    }
    assert sum(score["components"].values()) == score["score"]


def test_pbp_derives_red_zone_end_zone_and_goal_line_opportunity():
    players = {"1": player("1", gsis="g1", pfr="p1")}
    snaps = [
        snap(2025, 1, "BUF", "p1", 50, .5),
        snap(2025, 1, "BUF", "team-a", 100, 1),
    ]
    stats = [stat(2025, 1, "BUF", "g1", 4, 8)]
    rosters = [roster(2025, 1, "BUF", "g1", "ACT")]
    pbp = [
        # Red-zone only: from the 18, air yards short of the goal line.
        {"season": 2025, "week": 1, "season_type": "REG", "posteam": "BUF", "yardline_100": 18, "air_yards": 12, "pass_attempt": 1, "receiver_player_id": "g1"},
        # Inside the 10 but still short of the end zone Ã¢â‚¬â€ not an end-zone target.
        {"season": 2025, "week": 1, "season_type": "REG", "posteam": "BUF", "yardline_100": 8, "air_yards": 5, "pass_attempt": 1, "receiver_player_id": "g1"},
        # True end-zone target: air yards reach/beyond the goal line.
        {"season": 2025, "week": 1, "season_type": "REG", "posteam": "BUF", "yardline_100": 8, "air_yards": 8, "pass_attempt": 1, "receiver_player_id": "g1"},
        {"season": 2025, "week": 1, "season_type": "REG", "posteam": "BUF", "yardline_100": 4, "rush_attempt": 1, "rusher_player_id": "g1"},
    ]
    opportunity = context.build_player_context(
        players, stats, snaps, rosters, [], 2026, pbp_rows=pbp,
    ).usage["1"]["opportunity"]["season"]
    assert opportunity["redZoneTargets"] == 3
    assert opportunity["endZoneTargets"] == 1
    assert opportunity["goalLineCarries"] == 1


def test_role_evolution_uses_final_five_observed_games():
    players = {"1": player("1", gsis="g1", pfr="p1", position="WR")}
    snaps = []
    rosters = []
    stats = []
    for week in range(1, 11):
        snaps.append(snap(2025, week, "BUF", "team-a", 100, 1))
        snaps.append(snap(2025, week, "BUF", "p1", 50, .5))
        rosters.append(roster(2025, week, "BUF", "g1", "ACT"))
        player_targets = 2 if week <= 5 else 8
        player_air = 20 if week <= 5 else 60
        stats.append({
            "season": 2025, "week": week, "season_type": "REG", "recent_team": "BUF",
            "player_id": "g1", "targets": player_targets, "carries": 0,
            "receiving_air_yards": player_air, "receiving_yards_after_catch": 10,
            "fantasy_points_ppr": 0.0,
        })
        stats.append({
            "season": 2025, "week": week, "season_type": "REG", "recent_team": "BUF",
            "player_id": "other", "targets": 8, "carries": 0,
            "receiving_air_yards": 80, "receiving_yards_after_catch": 0,
            "fantasy_points_ppr": 0.0,
        })
    opportunity = context.build_player_context(
        players, stats, snaps, rosters, [], 2026,
    ).usage["1"]["opportunity"]
    assert opportunity["season"]["targetsPerGame"] == 5.0
    assert opportunity["finalFive"]["games"] == 5
    assert opportunity["finalFive"]["targetsPerGame"] == 8.0
    assert opportunity["roleEvolution"]["targetsPerGameDelta"] == 3.0
    assert opportunity["roleEvolution"]["targetShareDelta"] == pytest.approx(0.11538461538461536)
    assert opportunity["roleEvolution"]["airYardsShareDelta"] == pytest.approx(0.09523809523809523)


def test_qb_opportunity_suppresses_target_share():
    players = {"1": player("1", gsis="g1", pfr="p1", position="QB")}
    snaps = [
        snap(2025, 1, "BUF", "p1", 60, 1),
        snap(2025, 1, "BUF", "team-a", 60, 1),
    ]
    stats = [
        stat(2025, 1, "BUF", "g1", 0, 3),
        stat(2025, 1, "BUF", "other", 10, 5),
    ]
    rosters = [roster(2025, 1, "BUF", "g1", "ACT")]
    usage = context.build_player_context(players, stats, snaps, rosters, [], 2026).usage["1"]
    assert usage["targetShare"] is None
    assert usage["opportunity"]["season"]["targetShare"] is None
    assert usage["opportunity"]["roleEvolution"]["targetShareDelta"] is None


def _weekly_row(season, week, gsis_id, points_ppr, *, team="BUF", season_type="REG"):
    return {
        "season": season, "week": week, "season_type": season_type, "recent_team": team,
        "player_id": gsis_id, "fantasy_points_ppr": points_ppr,
    }


def test_weekly_scoring_filters_to_usage_season_and_sorts_ascending():
    gsis_to_player = {"g1": "1"}
    rows = [
        _weekly_row(2024, 1, "g1", 5.0),
        _weekly_row(2025, 3, "g1", 12.0),
        _weekly_row(2025, 1, "g1", 8.0),
        _weekly_row(2026, 1, "g1", 99.0),
    ]
    weekly, diagnostics = context.build_weekly_scoring(rows, gsis_to_player, 2025, {})
    assert weekly["1"] == [
        {"week": 1, "pointsPpr": 8.0}, {"week": 3, "pointsPpr": 12.0},
    ]
    assert diagnostics["rowsInUsageSeason"] == 2
    assert diagnostics["rowsScanned"] == 4


def test_weekly_scoring_sums_split_team_rows_for_one_week():
    gsis_to_player = {"g1": "1"}
    rows = [
        _weekly_row(2025, 1, "g1", 5.0, team="BUF"),
        _weekly_row(2025, 1, "g1", 3.5, team="KC"),
    ]
    weekly, _ = context.build_weekly_scoring(rows, gsis_to_player, 2025, {})
    assert weekly["1"] == [{"week": 1, "pointsPpr": 8.5}]


def test_weekly_scoring_keeps_zero_and_omits_unplayed_weeks():
    gsis_to_player = {"g1": "1"}
    rows = [_weekly_row(2025, 1, "g1", 0.0)]
    weekly, _ = context.build_weekly_scoring(rows, gsis_to_player, 2025, {})
    assert weekly["1"] == [{"week": 1, "pointsPpr": 0.0}]
    assert [entry["week"] for entry in weekly["1"]] == [1]


def test_weekly_scoring_preserves_negative_points():
    gsis_to_player = {"g1": "1"}
    rows = [_weekly_row(2025, 1, "g1", -2.5)]
    weekly, _ = context.build_weekly_scoring(rows, gsis_to_player, 2025, {})
    assert weekly["1"] == [{"week": 1, "pointsPpr": -2.5}]


def test_weekly_scoring_includes_row_with_no_team():
    gsis_to_player = {"g1": "1"}
    row = _weekly_row(2025, 1, "g1", 4.0)
    row["recent_team"] = None
    weekly, _ = context.build_weekly_scoring([row], gsis_to_player, 2025, {})
    assert weekly["1"] == [{"week": 1, "pointsPpr": 4.0}]


def test_weekly_scoring_ignores_postseason_rows():
    gsis_to_player = {"g1": "1"}
    rows = [_weekly_row(2025, 1, "g1", 10.0, season_type="POST")]
    weekly, diagnostics = context.build_weekly_scoring(rows, gsis_to_player, 2025, {})
    assert weekly == {}
    assert diagnostics["rowsInUsageSeason"] == 0


def test_weekly_scoring_raises_on_schema_drift():
    gsis_to_player = {"g1": "1"}
    rows = [{
        "season": 2025, "week": 1, "season_type": "REG", "recent_team": "BUF",
        "player_id": "g1", "targets": 4,
    }]
    with pytest.raises(ValueError, match="fantasy_points_ppr"):
        context.build_weekly_scoring(rows, gsis_to_player, 2025, {})


def test_weekly_scoring_counts_missing_and_malformed_ppr_without_raising():
    gsis_to_player = {"g1": "1", "g2": "2"}
    rows = [
        _weekly_row(2025, 1, "g1", None),
        _weekly_row(2025, 2, "g1", float("nan")),
        _weekly_row(2025, 1, "g2", 9.0),
    ]
    weekly, diagnostics = context.build_weekly_scoring(rows, gsis_to_player, 2025, {})
    assert weekly == {"2": [{"week": 1, "pointsPpr": 9.0}]}
    assert diagnostics["rowsMissingPprField"] == 2
    assert diagnostics["rowsInUsageSeason"] == 3


def test_weekly_scoring_by_position_uses_canonical_metadata_position():
    gsis_to_player = {"g1": "1", "g2": "2"}
    players = {
        "1": player("1", position="WR", gsis="g1"),
        "2": player("2", position="RB", gsis="g2"),
    }
    rows = [_weekly_row(2025, 1, "g1", 10.0), _weekly_row(2025, 1, "g2", 5.0)]
    _, diagnostics = context.build_weekly_scoring(rows, gsis_to_player, 2025, players)
    assert diagnostics["byPosition"] == {"RB": 1, "WR": 1}
    assert diagnostics["playersWithSeries"] == 2
    assert diagnostics["weeksObserved"] == 2


def test_weekly_scoring_by_position_falls_back_to_unknown_without_metadata():
    gsis_to_player = {"g1": "1"}
    rows = [_weekly_row(2025, 1, "g1", 10.0)]
    _, diagnostics = context.build_weekly_scoring(rows, gsis_to_player, 2025, {})
    assert diagnostics["byPosition"] == {"unknown": 1}


def test_build_player_context_matches_padded_gsis_ids_for_weekly():
    # DynastyProcess has historically padded some gsis values with a leading
    # space; weekly scoring must still resolve those players to sleeper ids.
    players = {"5859": player("5859", gsis=" 00-0035676", pfr="p1", position="WR")}
    snaps = [snap(2025, 1, "PHI", "p1", 50, 0.5)]
    rosters = [roster(2025, 1, "PHI", "00-0035676", "ACT")]
    stats = [_weekly_row(2025, 1, "00-0035676", 18.4)]
    stats[0]["targets"] = 8
    stats[0]["carries"] = 0
    result = context.build_player_context(players, stats, snaps, rosters, [], 2026)
    assert result.weekly["5859"] == [{"week": 1, "pointsPpr": 18.4}]


def test_build_player_context_writes_empty_weekly_and_raises_on_usage_season_drift():
    players = {"1": player("1", gsis="g1", pfr="p1")}
    snaps = [snap(2025, 1, "BUF", "p1", 50, 0.5)]
    rosters = [roster(2025, 1, "BUF", "g1", "ACT")]
    stats = [{
        "season": 2025, "week": 1, "season_type": "REG", "recent_team": "BUF",
        "player_id": "g1", "targets": 4, "carries": 0,
    }]
    with pytest.raises(ValueError, match="fantasy_points_ppr"):
        context.build_player_context(players, stats, snaps, rosters, [], 2026)


def test_context_loader_init_failure_fail_open_clears_weekly(monkeypatch):
    """loaders() itself throwing is the first ContextArtifacts early return."""
    players = {"1": player("1", gsis="g1", pfr="p1")}
    adp = [SimpleNamespace(playerId="1")]
    monkeypatch.setattr(
        nflverse_source, "loaders",
        lambda: (_ for _ in ()).throw(RuntimeError("nflreadpy unavailable")),
    )
    monkeypatch.setattr(nflverse_source, "optional_loaders", lambda: {})
    context_artifacts = build_data._build_context_artifact(players, adp, 2026, "now", {}, [])
    assert context_artifacts.usage == {}
    assert context_artifacts.weekly == {}
    assert context_artifacts.weeklyStats == {}
    assert context_artifacts.sources["nflverse_player_stats"]["status"] == "error"
    assert "nflreadpy unavailable" in context_artifacts.sources["nflverse_player_stats"]["diagnostic"]


def test_context_transform_failure_fail_open_clears_weekly(monkeypatch):
    """Schema-drift / transform errors must clear weekly via ContextArtifacts."""
    players = {"1": player("1", gsis="g1", pfr="p1")}
    adp = [SimpleNamespace(playerId="1")]
    snaps = [snap(2025, 1, "BUF", "p1", 50, 0.5), snap(2025, 1, "BUF", "team-a", 100, 1)]
    # Usage-season rows with no usable fantasy_points_ppr Ã¢â€ â€™ ValueError inside
    # build_player_context, which _build_context_artifact must fail open on.
    stats = [{
        "season": 2025, "week": 1, "season_type": "REG", "recent_team": "BUF",
        "player_id": "g1", "targets": 4, "carries": 0,
    }]
    rosters = [roster(2025, 1, "BUF", "g1", "ACT")]
    monkeypatch.setattr(nflverse_source, "optional_loaders", lambda: {})
    monkeypatch.setattr(nflverse_source, "loaders", lambda: {
        "nflverse_player_stats": lambda _: Frame(stats),
        "nflverse_snap_counts": lambda _: Frame(snaps),
        "nflverse_weekly_rosters": lambda _: Frame(rosters),
        "nflverse_injuries": lambda _: Frame([]),
    })
    context_artifacts = build_data._build_context_artifact(players, adp, 2026, "now", {}, [])
    assert context_artifacts.usage == {}
    assert context_artifacts.weekly == {}
    assert context_artifacts.weeklyStats == {}
    assert context_artifacts.sources["nflverse_player_stats"]["status"] == "error"
    assert "fantasy_points_ppr" in context_artifacts.sources["nflverse_player_stats"]["diagnostic"]


def test_optional_pbp_failure_keeps_core_context(monkeypatch):
    players = {"1": player("1", gsis="g1", pfr="p1")}
    adp = [SimpleNamespace(playerId="1")]
    snaps = [
        snap(2025, 1, "BUF", "p1", 50, .5),
        snap(2025, 1, "BUF", "team-a", 100, 1),
    ]
    stats = [stat(2025, 1, "BUF", "g1", 4, 8)]
    rosters = [roster(2025, 1, "BUF", "g1", "ACT")]

    monkeypatch.setattr(nflverse_source, "loaders", lambda: {
        "nflverse_player_stats": lambda _: Frame(stats),
        "nflverse_snap_counts": lambda _: Frame(snaps),
        "nflverse_weekly_rosters": lambda _: Frame(rosters),
        "nflverse_injuries": lambda _: Frame([]),
    })

    def broken_pbp(_):
        raise RuntimeError("pbp offline")

    monkeypatch.setattr(nflverse_source, "optional_loaders", lambda: {
        "nflverse_pbp": broken_pbp,
    })
    context_artifacts = build_data._build_context_artifact(players, adp, 2026, "now", {}, [])
    usage, source_entries = context_artifacts.usage, context_artifacts.sources
    assert "1" in usage
    assert usage["1"]["opportunity"]["season"]["targets"] == 4
    assert usage["1"]["opportunity"]["season"]["redZoneTargets"] is None
    assert usage["1"]["opportunity"]["season"]["endZoneTargets"] is None
    assert usage["1"]["opportunity"]["season"]["goalLineCarries"] is None
    assert source_entries["nflverse_player_stats"]["status"] == "ok"
    assert source_entries["nflverse_pbp"]["status"] == "error"
    assert "1" in context_artifacts.weekly


class Frame:
    def __init__(self, rows):
        self.rows = rows

    def to_dicts(self):
        return self.rows


def test_context_loader_errors_and_season_leakage_fail_open(monkeypatch):
    players = {"1": player("1", gsis="g1", pfr="p1")}
    adp = [SimpleNamespace(playerId="1")]
    monkeypatch.setattr(nflverse_source, "optional_loaders", lambda: {})

    def broken(_):
        raise RuntimeError("secret https://example.invalid/source")

    monkeypatch.setattr(nflverse_source, "loaders", lambda: {
        "nflverse_player_stats": broken,
        "nflverse_snap_counts": lambda _: Frame([]),
        "nflverse_weekly_rosters": lambda _: Frame([]),
        "nflverse_injuries": lambda _: Frame([]),
    })
    context_artifacts = build_data._build_context_artifact(
        players, adp, 2026, "now", {}, [],
    )
    usage, manifest, source_entries = (
        context_artifacts.usage, context_artifacts.manifest, context_artifacts.sources,
    )
    assert usage == {}
    assert context_artifacts.weekly == {}
    assert context_artifacts.weeklyStats == {}
    assert manifest["coverage"]["covered"] == 0
    assert source_entries["nflverse_player_stats"]["status"] == "error"
    assert "example.invalid" not in source_entries["nflverse_player_stats"]["diagnostic"]

    monkeypatch.setattr(nflverse_source, "loaders", lambda: {
        name: (lambda _, name=name: Frame([{"season": 2026}]) if name == "nflverse_injuries" else Frame([]))
        for name in (
            "nflverse_player_stats",
            "nflverse_snap_counts",
            "nflverse_weekly_rosters",
            "nflverse_injuries",
        )
    })
    context_artifacts = build_data._build_context_artifact(players, adp, 2026, "now", {}, [])
    assert context_artifacts.usage == {}
    assert context_artifacts.weekly == {}
    assert context_artifacts.weeklyStats == {}
    assert context_artifacts.sources["nflverse_injuries"]["status"] == "error"


# ---------------------------------------------------------------------------
# Weekly Sleeper game-log integration (build_data._build_context_artifact /
# build_data.main() seam) -- see weekly_stats.py's own test_weekly_stats.py
# for the pure-transformer tests.
# ---------------------------------------------------------------------------

def _minimal_required_loaders(stats=None, snaps=None, rosters=None):
    return {
        "nflverse_player_stats": lambda _: Frame(stats or []),
        "nflverse_snap_counts": lambda _: Frame(snaps or []),
        "nflverse_weekly_rosters": lambda _: Frame(rosters or []),
        "nflverse_injuries": lambda _: Frame([]),
    }


def test_optional_loaders_import_failure_gives_pbp_and_schedules_both_an_error_entry(monkeypatch):
    """Regression for the generalization at build_data.py: a bare except that
    only wrote nflverse_pbp's manifest entry would silently leave a later-added
    optional source (schedules) with no manifest entry at all on this path."""
    players = {"1": player("1", gsis="g1", pfr="p1")}
    adp = [SimpleNamespace(playerId="1")]
    monkeypatch.setattr(nflverse_source, "loaders", lambda: _minimal_required_loaders())
    monkeypatch.setattr(
        nflverse_source, "optional_loaders",
        lambda: (_ for _ in ()).throw(RuntimeError("nflreadpy unavailable")),
    )
    context_artifacts = build_data._build_context_artifact(players, adp, 2026, "now", {}, [])
    assert context_artifacts.sources["nflverse_pbp"]["status"] == "error"
    assert context_artifacts.sources["nflverse_schedules"]["status"] == "error"
    assert "nflreadpy unavailable" in context_artifacts.sources["nflverse_pbp"]["diagnostic"]
    assert "nflreadpy unavailable" in context_artifacts.sources["nflverse_schedules"]["diagnostic"]
    # This path never touches loaders() itself, so the required sources are
    # unaffected (empty fixtures here just mean nobody has usage rows).
    assert context_artifacts.sources["nflverse_player_stats"]["status"] == "ok"


def test_schedules_loader_failure_leaves_usage_intact_and_only_nulls_opponent(monkeypatch):
    """A schedules failure must cost only the OPP/BYE columns of the weekly
    artifact, not clear usage/weekly the way a REQUIRED-loader failure does."""
    players = {"1": player("1", position="WR", gsis="g1", pfr="p1")}
    adp = [SimpleNamespace(playerId="1")]
    snaps = [snap(2025, 1, "BUF", "p1", 50, 0.5), snap(2025, 1, "BUF", "team-a", 100, 1)]
    stats = [stat(2025, 1, "BUF", "g1", 4, 0, points_ppr=8.0)]
    rosters = [roster(2025, 1, "BUF", "g1", "ACT")]
    monkeypatch.setattr(nflverse_source, "loaders", lambda: _minimal_required_loaders(stats, snaps, rosters))

    def broken_schedules(_):
        raise RuntimeError("schedules offline")

    monkeypatch.setattr(nflverse_source, "optional_loaders", lambda: {"nflverse_schedules": broken_schedules})

    weekly_payloads = {1: {"1": {"pts_ppr": 8.0, "rec_tgt": 4}}}
    context_artifacts = build_data._build_context_artifact(
        players, adp, 2026, "now", weekly_payloads, [1],
    )
    assert "1" in context_artifacts.usage  # required sources unaffected
    assert context_artifacts.sources["nflverse_schedules"]["status"] == "error"
    weekly_row = context_artifacts.weeklyStats["players"]["1"]["w"][0]
    opp_index = context_artifacts.weeklyStats["columns"]["WR"].index("opp") + 1
    assert weekly_row[opp_index] is None  # nulled, not fabricated
    assert context_artifacts.weeklyStats["players"]["1"]["bye"] is None


def test_optional_loaders_schedules_pinned_to_usage_season(monkeypatch):
    """load_schedules should be called with only the single usage season, not
    the full multi-season history_seasons list every other loader receives."""
    import nflreadpy

    calls: list[list[int]] = []
    monkeypatch.setattr(nflreadpy, "load_schedules", lambda seasons: calls.append(list(seasons)) or SimpleNamespace())
    loader = nflverse_source.optional_loaders()["nflverse_schedules"]
    loader([2023, 2024, 2025])
    assert calls == [[2025]]


def test_weekly_stats_fetch_retries_once_before_recording_failure(monkeypatch, tmp_path):
    """WEEKLY_STATS_FETCH_ATTEMPTS is 2: a week that fails once then succeeds
    on retry must land in the artifact, not in weeksFailed."""
    call_counts: dict[int, int] = {}

    def flaky(_season, week):
        call_counts[week] = call_counts.get(week, 0) + 1
        if week == 3 and call_counts[week] == 1:
            raise RuntimeError("transient")
        return {}

    monkeypatch.setattr(sources, "fetch_sleeper_weekly_stats", flaky)
    monkeypatch.setattr(nflverse_source, "loaders", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    monkeypatch.setattr(nflverse_source, "optional_loaders", lambda: {})
    _patch_main_sources_for_offline_nflverse(monkeypatch, tmp_path)
    assert build_data.main() == 0
    assert call_counts[3] == 2  # failed once, retried once, succeeded
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert "3" not in manifest["sources"]["sleeper_weekly_stats"]["weeksFailed"]
    assert manifest["sources"]["sleeper_weekly_stats"]["status"] == "ok"


def test_weekly_stats_status_partial_when_some_weeks_fail(monkeypatch, tmp_path):
    def half_fail(_season, week):
        if week > 12:
            raise RuntimeError("offline")
        return {}

    monkeypatch.setattr(sources, "fetch_sleeper_weekly_stats", half_fail)
    monkeypatch.setattr(nflverse_source, "loaders", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    monkeypatch.setattr(nflverse_source, "optional_loaders", lambda: {})
    _patch_main_sources_for_offline_nflverse(monkeypatch, tmp_path)
    assert build_data.main() == 0
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    entry = manifest["sources"]["sleeper_weekly_stats"]
    assert entry["status"] == "partial"
    assert entry["weeksFetched"] == list(range(1, 13))
    assert sorted(int(w) for w in entry["weeksFailed"]) == list(range(13, 19))


def test_weekly_stats_status_error_when_every_week_fails(monkeypatch, tmp_path):
    def always_fail(_season, _week):
        raise RuntimeError("offline")

    monkeypatch.setattr(sources, "fetch_sleeper_weekly_stats", always_fail)
    monkeypatch.setattr(nflverse_source, "loaders", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    monkeypatch.setattr(nflverse_source, "optional_loaders", lambda: {})
    _patch_main_sources_for_offline_nflverse(monkeypatch, tmp_path)
    assert build_data.main() == 0
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["sources"]["sleeper_weekly_stats"]["status"] == "error"
    assert json.loads((tmp_path / "weekly-stats.json").read_text()) == {}


def _patch_main_sources_for_offline_nflverse(monkeypatch, tmp_path) -> None:
    """Shared minimal main() fixture for the weekly-stats-fetch tests above --
    only the weekly-stats fetch behavior differs between them; everything else
    (players/ADP/projections) is the same minimal happy path."""
    sleeper = {
        "1": {
            "full_name": "Test Player", "position": "RB", "fantasy_positions": ["RB"],
            "team": "BUF", "years_exp": 3,
        }
    }
    ffc_player = {
        "name": "Test Player", "position": "RB", "team": "BUF", "adp": 1.0,
        "stdev": 1.0, "high": 1, "low": 2, "times_drafted": 10, "bye": 7,
    }
    monkeypatch.setattr(sources, "fetch_sleeper_players", lambda: sleeper)
    monkeypatch.setattr(sources, "fetch_dynastyprocess_crosswalk", lambda: [
        {"sleeper_id": "1", "gsis_id": "g1", "pfr_id": "p1"}
    ])
    monkeypatch.setattr(sources, "fetch_ffc_adp_payload", lambda *args, **kwargs: {
        "players": [ffc_player],
        "meta": {"total_drafts": 10, "start_date": "2026-08-02", "end_date": "2026-08-09"},
    })
    monkeypatch.setattr(sources, "fetch_sleeper_adp", lambda _season: [])

    # The provider-projections step fetches ESPN in main(); keep these tests
    # network-free (fail-open is fine Ã¢â‚¬â€ the block just records an error).
    monkeypatch.setattr(espn_projections, "fetch_espn_projections", lambda _season: {"players": []})

    class ProjectionProvider:
        def __init__(self, _):
            pass

        def load(self, *_args, **_kwargs):
            return SimpleNamespace(
                projections=[], source_url="projection-source", fetched_at="now",
                upstream_updated_at="today", position_rows={}, diagnostics={}, bye_weeks={},
            )

    monkeypatch.setattr(build_data, "FFTodayProjectionProvider", ProjectionProvider)
    monkeypatch.setattr("sys.argv", [
        "build_data.py", "--out-dir", str(tmp_path), "--coverage-threshold", "0",
    ])


def test_coverage_requires_observed_usage_or_verified_known_absence():
    players = {
        "observed": player("observed"),
        "absent": player("absent"),
        "old-only": player("old-only"),
    }
    adp = [SimpleNamespace(playerId=pid) for pid in players]
    usage = {
        "observed": {"gamesWithAnySnap": 2, "knownAbsent": False},
        "absent": {"gamesWithAnySnap": 0, "knownAbsent": True},
        "old-only": {"gamesWithAnySnap": 0, "knownAbsent": False},
    }
    report = context.coverage_report(players, adp, usage)
    assert report["covered"] == 2
    assert report["knownAbsent"] == 1
    assert report["missing"] == 1
    assert report["missingPlayerIds"] == ["old-only"]


def test_main_writes_fresh_core_and_empty_context_when_nflverse_fails(monkeypatch, tmp_path):
    sleeper = {
        "1": {
            "full_name": "Test Player", "position": "RB", "fantasy_positions": ["RB"],
            "team": "BUF", "years_exp": 3,
        }
    }
    ffc_player = {
        "name": "Test Player", "position": "RB", "team": "BUF", "adp": 1.0,
        "stdev": 1.0, "high": 1, "low": 2, "times_drafted": 10, "bye": 7,
    }
    # Enough post-sentinel rows that Sleeper wins the active board (not FFC fallback).
    sleeper_adp_rows = [
        {
            "player_id": str(i),
            "updated_at": 1_700_000_000_000 + i,
            "player": {"first_name": "P", "last_name": str(i), "position": "RB", "team": "BUF"},
            "stats": {"adp_ppr": float(i + 1), "adp_std": float(i + 1), "adp_half_ppr": float(i + 1), "adp_2qb": float(i + 1)},
        }
        for i in range(build_data.SLEEPER_ADP_MIN_ROWS)
    ]
    sleeper_adp_rows[0]["player_id"] = "1"
    sleeper_adp_rows[0]["player"] = {"first_name": "Test", "last_name": "Player", "position": "RB", "team": "BUF"}

    monkeypatch.setattr(sources, "fetch_sleeper_players", lambda: sleeper)
    monkeypatch.setattr(sources, "fetch_dynastyprocess_crosswalk", lambda: [
        {"sleeper_id": "1", "gsis_id": "g1", "pfr_id": "p1"}
    ])
    monkeypatch.setattr(sources, "fetch_ffc_adp_payload", lambda *args, **kwargs: {
        "players": [ffc_player],
        "meta": {"total_drafts": 10, "start_date": "2026-08-02", "end_date": "2026-08-09"},
    })
    monkeypatch.setattr(sources, "fetch_sleeper_adp", lambda _season: sleeper_adp_rows)

    monkeypatch.setattr(espn_projections, "fetch_espn_projections", lambda _season: {"players": []})

    class ProjectionProvider:
        def __init__(self, _):
            pass

        def load(self, *_args, **_kwargs):
            return SimpleNamespace(
                projections=[transform.SeasonProjection("1", "test", {"rush_yd": 100})],
                source_url="projection-source",
                fetched_at="now",
                upstream_updated_at="today",
                position_rows={"RB": 1},
                diagnostics={"matchedRows": 1},
                bye_weeks={"1": 7},
            )

    monkeypatch.setattr(build_data, "FFTodayProjectionProvider", ProjectionProvider)
    monkeypatch.setattr(nflverse_source, "loaders", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    monkeypatch.setattr(nflverse_source, "optional_loaders", lambda: {})

    def weekly_stats_offline(*_args, **_kwargs):
        raise RuntimeError("weekly stats offline")

    monkeypatch.setattr(sources, "fetch_sleeper_weekly_stats", weekly_stats_offline)
    monkeypatch.setattr("sys.argv", [
        "build_data.py", "--out-dir", str(tmp_path), "--coverage-threshold", "0",
    ])
    assert build_data.main() == 0
    assert json.loads((tmp_path / "player-usage.json").read_text()) == {}
    weekly_ppr = json.loads((tmp_path / "weekly-ppr.json").read_text())
    assert weekly_ppr == {
        "schemaVersion": context.WEEKLY_SCORING_SCHEMA_VERSION,
        "season": 2025,
        "players": {},
    }
    assert json.loads((tmp_path / "weekly-stats.json").read_text()) == {}
    manifest_weekly_stats_precheck = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest_weekly_stats_precheck["sources"]["sleeper_weekly_stats"]["status"] == "error"
    assert manifest_weekly_stats_precheck["sources"]["sleeper_weekly_stats"]["weeksFetched"] == []
    assert len(manifest_weekly_stats_precheck["sources"]["sleeper_weekly_stats"]["weeksFailed"]) == 18
    players_out = json.loads((tmp_path / "players.json").read_text())
    assert players_out[0]["name"] == "Test Player"
    assert players_out[0]["byeWeek"] == 7
    assert json.loads((tmp_path / "projections-season.json").read_text())[0]["stats"]["rush_yd"] == 100
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["sources"]["nflverse_player_stats"]["status"] == "error"
    assert manifest["sources"]["adp_active_ppr"]["activeAdpSource"] == "sleeper"
    # crosswalk = FFC identity gate; projection = active-board coverage Ã¢â‚¬â€ never swapped.
    assert manifest["crosswalk"]["top300MatchRate"] == 1.0
    assert manifest["crosswalk"]["unmatchedTop300"] == []
    assert manifest["projection"]["source"] == "fftoday"
    # Sleeper board has SLEEPER_ADP_MIN_ROWS rows; mock projects only id "1", which
    # appears twice in the synthetic ADP list (index 0 overwritten + i==1).
    assert manifest["projection"]["top300MatchRate"] == pytest.approx(
        2 / build_data.SLEEPER_ADP_MIN_ROWS, rel=1e-4,
    )
    assert "Test Player" not in manifest["projection"]["unmatchedTop300"]
    assert len(manifest["projection"]["unmatchedTop300"]) == build_data.SLEEPER_ADP_MIN_ROWS - 2
    adp = json.loads((tmp_path / "adp-ppr.json").read_text())
    assert adp[0]["adpSource"] == "sleeper"
    assert adp[0]["stdevSource"] == "fitted"
    assert adp[0]["byeWeek"] == 7
    history_lines = (tmp_path / "history" / "adp-ppr.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(history_lines) == build_data.SLEEPER_ADP_MIN_ROWS + 1  # sleeper rows + one FFC row
    sleeper_hist = json.loads(history_lines[0])
    assert sleeper_hist["source"] == "sleeper"
    assert sleeper_hist["upstreamUpdatedAt"] is not None
    assert sleeper_hist["window"] is None


def test_main_falls_back_to_ffc_when_sleeper_adp_fetch_fails(monkeypatch, tmp_path):
    sleeper = {
        "1": {
            "full_name": "Test Player", "position": "RB", "fantasy_positions": ["RB"],
            "team": "BUF", "years_exp": 3,
        }
    }
    ffc_player = {
        "name": "Test Player", "position": "RB", "team": "BUF", "adp": 1.0,
        "stdev": 1.0, "high": 1, "low": 2, "times_drafted": 10, "bye": 7,
    }
    monkeypatch.setattr(sources, "fetch_sleeper_players", lambda: sleeper)
    monkeypatch.setattr(sources, "fetch_dynastyprocess_crosswalk", lambda: [
        {"sleeper_id": "1", "gsis_id": "g1", "pfr_id": "p1"}
    ])
    monkeypatch.setattr(sources, "fetch_ffc_adp_payload", lambda *args, **kwargs: {
        "players": [ffc_player],
        "meta": {"total_drafts": 10, "start_date": "2026-08-02", "end_date": "2026-08-09"},
    })

    def boom(_season):
        raise RuntimeError("sleeper adp down")

    monkeypatch.setattr(sources, "fetch_sleeper_adp", boom)

    monkeypatch.setattr(espn_projections, "fetch_espn_projections", lambda _season: {"players": []})

    class ProjectionProvider:
        def __init__(self, _):
            pass

        def load(self, *_args, **_kwargs):
            return SimpleNamespace(
                projections=[transform.SeasonProjection("1", "test", {"rush_yd": 100})],
                source_url="projection-source",
                fetched_at="now",
                upstream_updated_at="today",
                position_rows={"RB": 1},
                diagnostics={"matchedRows": 1},
                bye_weeks={},
            )

    monkeypatch.setattr(build_data, "FFTodayProjectionProvider", ProjectionProvider)
    monkeypatch.setattr(nflverse_source, "loaders", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    monkeypatch.setattr(nflverse_source, "optional_loaders", lambda: {})

    def weekly_stats_offline(*_args, **_kwargs):
        raise RuntimeError("weekly stats offline")

    monkeypatch.setattr(sources, "fetch_sleeper_weekly_stats", weekly_stats_offline)
    monkeypatch.setattr("sys.argv", [
        "build_data.py", "--out-dir", str(tmp_path), "--coverage-threshold", "0",
    ])
    assert build_data.main() == 0
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["sources"]["adp_active_ppr"]["activeAdpSource"] == "ffc-fallback"
    assert manifest["sources"]["sleeper_adp_ppr"]["status"] == "error"
    weekly_ppr = json.loads((tmp_path / "weekly-ppr.json").read_text())
    assert weekly_ppr == {
        "schemaVersion": context.WEEKLY_SCORING_SCHEMA_VERSION,
        "season": 2025,
        "players": {},
    }
    adp = json.loads((tmp_path / "adp-ppr.json").read_text())
    assert len(adp) == 1
    assert adp[0]["adpSource"] == "ffc"
    assert adp[0]["stdevSource"] == "observed"
    assert adp[0]["byeWeek"] == 7
    assert json.loads((tmp_path / "players.json").read_text())[0]["byeWeek"] == 7


def test_main_coverage_gate_failure_preserves_prior_artifacts(monkeypatch, tmp_path):
    prior = {"keep": True}
    (tmp_path / "players.json").write_text(json.dumps(prior), encoding="utf-8")
    (tmp_path / "manifest.json").write_text(json.dumps(prior), encoding="utf-8")

    sleeper = {
        "1": {
            "full_name": "Test Player", "position": "RB", "fantasy_positions": ["RB"],
            "team": "BUF", "years_exp": 3,
        }
    }
    # Unmatched FFC name Ã¢â€ â€™ gate rate 0.0 under default threshold.
    ffc_player = {
        "name": "Nobody Matching", "position": "RB", "team": "BUF", "adp": 1.0,
        "stdev": 1.0, "high": 1, "low": 2, "times_drafted": 10, "bye": 7,
    }
    monkeypatch.setattr(sources, "fetch_sleeper_players", lambda: sleeper)
    monkeypatch.setattr(sources, "fetch_dynastyprocess_crosswalk", lambda: [])
    monkeypatch.setattr(sources, "fetch_ffc_adp_payload", lambda *args, **kwargs: {
        "players": [ffc_player],
        "meta": {"total_drafts": 10, "start_date": "2026-08-02", "end_date": "2026-08-09"},
    })
    monkeypatch.setattr(sources, "fetch_sleeper_adp", lambda _season: [])

    class ProjectionProvider:
        def __init__(self, _):
            pass

        def load(self, *_args, **_kwargs):
            return SimpleNamespace(
                projections=[],
                source_url="projection-source",
                fetched_at="now",
                upstream_updated_at="today",
                position_rows={},
                diagnostics={},
                bye_weeks={},
            )

    monkeypatch.setattr(build_data, "FFTodayProjectionProvider", ProjectionProvider)
    monkeypatch.setattr(nflverse_source, "loaders", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    monkeypatch.setattr(nflverse_source, "optional_loaders", lambda: {})

    def weekly_stats_offline(*_args, **_kwargs):
        raise RuntimeError("weekly stats offline")

    monkeypatch.setattr(sources, "fetch_sleeper_weekly_stats", weekly_stats_offline)
    monkeypatch.setattr("sys.argv", [
        "build_data.py", "--out-dir", str(tmp_path),
        "--coverage-threshold", str(build_data.COVERAGE_GATE_THRESHOLD),
    ])
    assert build_data.main() == 1
    assert json.loads((tmp_path / "players.json").read_text()) == prior
    assert json.loads((tmp_path / "manifest.json").read_text()) == prior
