import transform
import weekly_stats
from weekly_stats import (
    POSITION_COLUMNS,
    build_opponent_map,
    build_weekly_stats,
    bye_weeks_by_team,
    compute_heat_breakpoints,
    compute_position_ranks,
    player_team_by_week,
)


def player(player_id, position, gsis=None):
    ids = {"gsis": gsis} if gsis else {}
    return transform.PlayerMeta(
        playerId=player_id, name=player_id, position=position,
        eligiblePositions=[position], team=None, byeWeek=None, age=25,
        yearsExp=3, injuryStatus=None, depthChartPosition=None,
        depthChartOrder=None, injuryBodyPart=None, practiceParticipation=None, ids=ids,
    )


def sched(season, week, home, away, game_type="REG"):
    return {"season": season, "week": week, "game_type": game_type, "home_team": home, "away_team": away}


def roster_row(season, week, team, gsis_id):
    return {"season": season, "week": week, "team": team, "gsis_id": gsis_id}


# ---------------------------------------------------------------------------
# Row shaping: zero-omission and row existence
# ---------------------------------------------------------------------------

def test_missing_sleeper_key_becomes_zero_not_null():
    """Sleeper omits zero-valued keys entirely; a row that exists must still
    produce 0 (not null) for a key it didn't carry."""
    players = {"1": player("1", "QB", gsis="G1")}
    payload = {3: {"1": {"pts_ppr": 20.0, "pass_yd": 250}}}  # no rush_td key at all
    artifact, _ = build_weekly_stats(
        payload, [3], players, {"G1": "1"}, [], [], [], season=2025,
    )
    row = artifact["players"]["1"]["w"][0]
    col_index = {k: i + 1 for i, k in enumerate(artifact["columns"]["QB"])}
    assert row[col_index["rush_td"]] == 0
    assert row[col_index["pass_yd"]] == 250


def test_player_with_no_row_that_week_produces_no_tuple():
    players = {"1": player("1", "WR", gsis="G1")}
    payload = {
        1: {"1": {"pts_ppr": 10.0, "rec": 4}},
        2: {},  # player absent entirely this week
    }
    artifact, _ = build_weekly_stats(payload, [1, 2], players, {"G1": "1"}, [], [], [], season=2025)
    weeks = [row[0] for row in artifact["players"]["1"]["w"]]
    assert weeks == [1]


def test_row_width_matches_declared_columns_for_every_position():
    players = {
        "q": player("q", "QB", gsis="GQ"), "r": player("r", "RB", gsis="GR"),
        "w": player("w", "WR", gsis="GW"), "t": player("t", "TE", gsis="GT"),
        "k": player("k", "K", gsis="GK"), "SF": player("SF", "DEF"),
    }
    payload = {
        1: {
            "q": {"pts_ppr": 20.0}, "r": {"pts_ppr": 15.0}, "w": {"pts_ppr": 12.0},
            "t": {"pts_ppr": 8.0}, "k": {"pts_ppr": 7.0}, "SF": {"pts_ppr": 5.0},
        },
    }
    artifact, _ = build_weekly_stats(payload, [1], players, {}, [], [], [], season=2025)
    for pid, series in artifact["players"].items():
        expected_len = len(POSITION_COLUMNS[series["p"]]) + 1  # +1 for the week itself
        for row in series["w"]:
            assert len(row) == expected_len, (pid, row)


# ---------------------------------------------------------------------------
# FIN: 999 sentinel and K/DEF recomputed ranks
# ---------------------------------------------------------------------------

def test_pos_rank_999_sentinel_becomes_null_for_offense():
    players = {"1": player("1", "WR", gsis="G1")}
    payload = {1: {"1": {"pts_ppr": 10.0, "pos_rank_ppr": 999.0}}}
    artifact, _ = build_weekly_stats(payload, [1], players, {"G1": "1"}, [], [], [], season=2025)
    col_index = {k: i + 1 for i, k in enumerate(artifact["columns"]["WR"])}
    assert artifact["players"]["1"]["w"][0][col_index["fin"]] is None


def test_kdef_fin_recomputed_from_that_weeks_distribution_with_shared_ties():
    """Sleeper's own pos_rank_ppr is always 999 for K/DEF; ranks must be derived
    from that week's own pts_ppr field, descending, ties sharing a rank."""
    players = {"k1": player("k1", "K"), "k2": player("k2", "K"), "k3": player("k3", "K")}
    payload = {
        1: {
            "k1": {"pts_ppr": 10.0, "pos_rank_ppr": 999.0},
            "k2": {"pts_ppr": 10.0, "pos_rank_ppr": 999.0},  # tie with k1
            "k3": {"pts_ppr": 6.0, "pos_rank_ppr": 999.0},
        },
    }
    artifact, _ = build_weekly_stats(payload, [1], players, {}, [], [], [], season=2025)
    col_index = {k: i + 1 for i, k in enumerate(artifact["columns"]["K"])}
    fin = {pid: series["w"][0][col_index["fin"]] for pid, series in artifact["players"].items()}
    assert fin["k1"] == 1
    assert fin["k2"] == 1
    assert fin["k3"] == 3  # standard competition ranking: 1, 1, 3 (not 1, 1, 2)


def test_compute_position_ranks_ignores_offense_positions():
    position_of = {"q": "QB", "k": "K"}
    payload = {1: {"q": {"pts_ppr": 30.0}, "k": {"pts_ppr": 8.0}}}
    ranks = compute_position_ranks(payload, position_of)
    assert ("q", 1) not in ranks
    assert ("k", 1) == list(ranks)[0]


# ---------------------------------------------------------------------------
# DEF team join and the td-vs-def_td trap
# ---------------------------------------------------------------------------

def test_def_joins_by_team_abbreviation_with_empty_ids():
    """DEF playerIds ARE team abbreviations; no crosswalk entry is needed."""
    players = {"SF": player("SF", "DEF")}  # empty ids{}, matching the real players.json shape
    payload = {1: {"SF": {"pts_ppr": 6.0, "sack": 1.0}}}
    artifact, _ = build_weekly_stats(payload, [1], players, {}, [], [], [], season=2025)
    assert "SF" in artifact["players"]
    assert artifact["players"]["SF"]["p"] == "DEF"


def test_def_td_column_reads_def_td_not_td():
    """Regression test for the touchdowns-ALLOWED trap: Sleeper's `td` key on a
    DEF row is touchdowns allowed, not scored. `def_td` is the real defensive
    score. The `td` key must never leak into the `def_td` column."""
    players = {"CHI": player("CHI", "DEF")}
    # Real observed shape: td=6 (allowed) alongside a genuine def_td=1 (scored).
    payload = {9: {"CHI": {"pts_ppr": 11.0, "td": 6.0, "def_td": 1.0, "pts_allow": 42.0}}}
    artifact, _ = build_weekly_stats(payload, [9], players, {}, [], [], [], season=2025)
    assert "td" not in artifact["columns"]["DEF"]
    col_index = {k: i + 1 for i, k in enumerate(artifact["columns"]["DEF"])}
    row = artifact["players"]["CHI"]["w"][0]
    assert row[col_index["def_td"]] == 1
    assert row[col_index["pts_allow"]] == 42


# ---------------------------------------------------------------------------
# Opponent / bye / mid-season trade
# ---------------------------------------------------------------------------

def test_opponent_map_marks_home_and_away():
    rows = [sched(2025, 1, "PHI", "DAL")]
    opp = build_opponent_map(rows, 2025)
    assert opp[("PHI", 1)] == "DAL"
    assert opp[("DAL", 1)] == "@PHI"


def test_bye_week_is_the_one_missing_week_in_range():
    rows = [
        sched(2025, 1, "PHI", "DAL"), sched(2025, 2, "PHI", "NYG"),
        sched(2025, 1, "DAL", "PHI"), sched(2025, 2, "DAL", "WAS"),
        sched(2025, 3, "NYG", "WAS"),  # PHI, DAL play weeks 1-2 only in this fixture
    ]
    byes = bye_weeks_by_team(rows, 2025)
    assert byes["PHI"] == 3
    assert byes["DAL"] == 3


def test_traded_player_gets_pre_trade_opponent_for_pre_trade_weeks():
    players = {"1": player("1", "WR", gsis="G1")}
    roster_rows = [
        roster_row(2025, 1, "NYJ", "G1"),
        roster_row(2025, 2, "NYJ", "G1"),
        roster_row(2025, 3, "KC", "G1"),  # traded before week 3
    ]
    schedule_rows = [
        sched(2025, 1, "NYJ", "MIA"), sched(2025, 2, "BUF", "NYJ"),
        sched(2025, 3, "KC", "DEN"),
    ]
    payload = {
        1: {"1": {"pts_ppr": 8.0}}, 2: {"1": {"pts_ppr": 6.0}}, 3: {"1": {"pts_ppr": 14.0}},
    }
    artifact, diag = build_weekly_stats(
        payload, [1, 2, 3], players, {"G1": "1"}, schedule_rows, roster_rows, [], season=2025,
    )
    col_index = {k: i + 1 for i, k in enumerate(artifact["columns"]["WR"])}
    rows = {row[0]: row for row in artifact["players"]["1"]["w"]}
    assert rows[1][col_index["opp"]] == "MIA"
    assert rows[2][col_index["opp"]] == "@BUF"
    assert rows[3][col_index["opp"]] == "DEN"
    assert diag["opponentMissing"] == 0


def test_player_team_by_week_resolves_mid_season_change():
    roster_rows = [roster_row(2025, 1, "NYJ", "G1"), roster_row(2025, 3, "KC", "G1")]
    team_by_week = player_team_by_week(roster_rows, {"G1": "1"}, 2025)
    assert team_by_week[("1", 1)] == "NYJ"
    assert team_by_week[("1", 3)] == "KC"


# ---------------------------------------------------------------------------
# weeksFetched: partial fetch never fabricates byes
# ---------------------------------------------------------------------------

def test_unfetched_week_produces_no_fabricated_row():
    """weeksFetched=[1] (week 2 never fetched) must not read the same as a
    week-2 bye downstream -- the artifact simply has no week-2 tuple, and the
    client is responsible for treating an unfetched week as "no data", not
    "bye". This test only asserts the pipeline's half of that contract: no
    tuple is fabricated for an unfetched week."""
    players = {"1": player("1", "RB", gsis="G1")}
    payload = {1: {"1": {"pts_ppr": 10.0}}}  # week 2 never in weekly_payloads at all
    artifact, _ = build_weekly_stats(payload, [1], players, {"G1": "1"}, [], [], [], season=2025)
    assert artifact["weeksFetched"] == [1]
    weeks = [row[0] for row in artifact["players"]["1"]["w"]]
    assert 2 not in weeks


# ---------------------------------------------------------------------------
# Heat breakpoints
# ---------------------------------------------------------------------------

def _kdef_row(week, pts):
    # [pts, opp, snp, fin, fgm, fga, fgm_pct, fgm_lng, fgm_50p, fgm_yds, xpm, xpa]
    return [week, pts, None, None, None, 0, 0, 0, 0, 0, 0, 0, 0]


def test_heat_breakpoints_null_below_minimum_sample():
    players_out = {"1": {"p": "K", "bye": None, "w": [_kdef_row(wk, 5.0) for wk in range(1, 4)]}}
    # Fewer than 40 observations for the 'pts' column -> null, not a degenerate ramp.
    breakpoints, _ = compute_heat_breakpoints(players_out)
    assert breakpoints["K"]["pts"] is None


def test_heat_breakpoints_non_decreasing_and_populated_above_minimum():
    weeks = [_kdef_row(wk, float(wk)) for wk in range(1, 45)]
    players_out = {"1": {"p": "K", "bye": None, "w": weeks}}
    breakpoints, diag = compute_heat_breakpoints(players_out)
    values = breakpoints["K"]["pts"]
    assert values is not None
    assert values == sorted(values)
    assert diag["heatObservationCounts"]["K"]["pts"] == 44


def test_heat_never_computed_for_opp_or_fin():
    # [pts, opp, snp, fin, rec_tgt, rec, rec_yd, rec_ypr, rec_air_yd, rec_td, rush_att, rush_yd, rush_td]
    rows = [[wk, 10.0, "KC", 80, 5] + [0] * 9 for wk in range(1, 45)]
    players_out = {"1": {"p": "WR", "bye": None, "w": rows}}
    breakpoints, _ = compute_heat_breakpoints(players_out)
    assert "opp" not in breakpoints["WR"]
    assert "fin" not in breakpoints["WR"]


# ---------------------------------------------------------------------------
# Diagnostics: missingExpectedColumns
# ---------------------------------------------------------------------------

def test_missing_expected_columns_flags_a_column_never_observed_all_season():
    players = {"1": player("1", "QB", gsis="G1")}
    # `rush_td` never appears as a real (non-null) key across the whole season.
    payload = {wk: {"1": {"pts_ppr": 15.0, "pass_yd": 200}} for wk in range(1, 4)}
    artifact, diag = build_weekly_stats(payload, [1, 2, 3], players, {"G1": "1"}, [], [], [], season=2025)
    assert "rush_td" in diag["missingExpectedColumns"]


def test_pts_column_never_flagged_missing_even_though_raw_key_is_pts_ppr():
    """Regression: `pts` is our column name for Sleeper's raw `pts_ppr` key. A
    naive raw-key scan would never see a key literally spelled "pts" and would
    always flag it missing."""
    players = {"1": player("1", "QB", gsis="G1")}
    payload = {1: {"1": {"pts_ppr": 15.0}}}
    _, diag = build_weekly_stats(payload, [1], players, {"G1": "1"}, [], [], [], season=2025)
    assert "pts" not in diag["missingExpectedColumns"]


def test_derived_columns_never_flagged_missing():
    players = {"1": player("1", "QB", gsis="G1")}
    payload = {1: {"1": {"pts_ppr": 15.0}}}
    _, diag = build_weekly_stats(payload, [1], players, {"G1": "1"}, [], [], [], season=2025)
    assert "opp" not in diag["missingExpectedColumns"]
    assert "snp" not in diag["missingExpectedColumns"]
    assert "fin" not in diag["missingExpectedColumns"]
