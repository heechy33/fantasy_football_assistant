"""Coverage for pipeline/fantasypros_adp.py — the local-only, display-only
per-site ADP decoration artifact. Exercises the pure parser/assembler directly
(no filesystem, no CLI boundary); build_data wiring is covered by
test_build_data_providers.py.
"""

import pytest

from fantasypros_adp import (
    FANTASYPROS_ADP_SCHEMA_VERSION,
    build_adp_artifact,
    parse_adp_csv,
)
from match import build_sleeper_match_index

_HEADER = "Rank,Player (Bye),POS,ESPN,Sleeper,CBS,NFL,RTSports,Fantrax,AVG,Real-Time"


def _csv(*rows: str) -> str:
    return "\n".join((_HEADER, *rows)) + "\n"


def _row(rank, cell, pos, *, espn="", sleeper="", cbs="", rtsports="", fantrax="", avg="", real_time=""):
    # Built from an explicit list so every fixture has exactly the 11 header
    # columns — hand-counting commas in string literals is how columns drift.
    return ",".join(
        [str(rank), cell, pos, espn, sleeper, cbs, "", rtsports, fantrax, avg, real_time]
    )


def _index():
    return build_sleeper_match_index(
        {
            "1": {"full_name": "Jahmyr Gibbs", "position": "RB", "team": "DET"},
            "2": {"full_name": "Amon-Ra St. Brown", "position": "WR", "team": "DET"},
            "3": {"full_name": "Tyreek Hill", "position": "WR", "team": None},
            "HOU": {"position": "DEF", "team": "HOU"},
        }
    )


def _valid_ids():
    return {"1", "2", "3", "HOU"}


def _build(*rows: str, valid_ids=None):
    parsed, empty_columns = parse_adp_csv(_csv(*rows))
    return build_adp_artifact(
        parsed,
        _index(),
        valid_player_ids=_valid_ids() if valid_ids is None else valid_ids,
        season=2026,
        source_file="/tmp/local/FantasyPros_2026_Overall_ADP_Rankings.csv",
        generated_at="2026-08-12T00:00:00Z",
        empty_columns=empty_columns,
    )


# --- parse_adp_csv -----------------------------------------------------------


def test_parse_adp_csv_rejects_header_drift():
    with pytest.raises(ValueError, match="header drift"):
        parse_adp_csv("Rank,Player (Bye),POS,ESPN,Yahoo\n1,X,RB1,1,\n")


def test_parse_adp_csv_keeps_multiword_names_via_two_plus_space_split():
    # Splitting on the last space would break every one of these (suffix names
    # and franchise names alike). The 2+ space run is the anchor.
    rows, _ = parse_adp_csv(
        _csv(
            _row(1, "Amon-Ra St. Brown   DET (8)", "WR1", espn="21.0", avg="21.0"),
            _row(2, "James Cook III   JAC (12)", "RB2", espn="30.0", avg="30.0"),
            _row(3, "Odell Beckham Jr.   FA (7)", "WR9", espn="50.0", avg="50.0"),
        )
    )
    assert rows[0].name == "Amon-Ra St. Brown"
    assert rows[0].team == "DET"
    assert rows[0].bye == 8
    assert rows[1].name == "James Cook III"
    assert rows[1].team == "JAX"  # JAC folds via normalize_team
    assert rows[1].bye == 12
    assert rows[2].name == "Odell Beckham Jr."
    assert rows[2].team is None  # FA is unsigned, but the name+position key still matches


def test_parse_adp_csv_def_uses_franchise_name_map():
    rows, _ = parse_adp_csv(_csv(_row(3, "Houston Texans DST   (8)", "DST1", espn="125.0", avg="124.0")))
    assert rows[0].position == "DEF"
    assert rows[0].name == "Houston Texans DST"
    assert rows[0].team == "HOU"
    assert rows[0].bye == 8


def test_parse_adp_csv_bare_free_agent_rows_have_no_team_or_bye():
    rows, _ = parse_adp_csv(_csv(_row(4, "Tyreek Hill", "WR12", espn="30.0", avg="30.0", real_time="30  +1")))
    assert rows[0].name == "Tyreek Hill"
    assert rows[0].team is None
    assert rows[0].bye is None


def test_parse_adp_csv_unknown_def_franchise_raises():
    with pytest.raises(ValueError, match="unknown defense franchise name"):
        parse_adp_csv(_csv("3,London Silly Nannies DST   (8),DST1,,,,,,,,,"))


def test_parse_adp_csv_real_time_rank_and_delta():
    rows, _ = parse_adp_csv(_csv(_row(1, "X   DET (6)", "RB1", espn="1", avg="1.0", real_time="8  -1")))
    assert rows[0].real_time == {"rank": 8, "delta": -1}
    rows2, _ = parse_adp_csv(_csv(_row(1, "X   DET (6)", "RB1", espn="1", avg="1.0", real_time="224  +76")))
    assert rows2[0].real_time == {"rank": 224, "delta": 76}


def test_parse_adp_csv_blank_cells_are_absent_never_null():
    # ESPN filled, Sleeper/CBS/etc blank: the adp map holds only espn, and AVG
    # blank stays absent rather than becoming null.
    rows, empty = parse_adp_csv(_csv(_row(4, "Tyreek Hill", "WR12", espn="30.0")))
    assert rows[0].adp == {"espn": 30.0}
    assert rows[0].avg is None
    assert rows[0].real_time is None
    # Only ESPN has any cells in this file — every other provider column is empty
    # and recorded, so the omission (including NFL) is visible rather than silent.
    assert empty == ["Sleeper", "CBS", "NFL", "RTSports", "Fantrax"]


# --- build_adp_artifact ------------------------------------------------------


def test_build_adp_artifact_shapes_counts_and_namespaces():
    artifact = _build(
        _row(1, "Jahmyr Gibbs   DET (6)", "RB1", espn="14.5", sleeper="15.2", cbs="13.8", rtsports="14.0", fantrax="14.2", avg="14.1", real_time="14  -1"),
        _row(2, "Amon-Ra St. Brown   DET (8)", "WR1", espn="22.0", sleeper="21.5", cbs="20.8", rtsports="21.9", fantrax="21.7", avg="21.6", real_time="21  +2"),
        _row(3, "Houston Texans DST   (8)", "DST1", espn="125.0", sleeper="121.0", cbs="128.0", rtsports="122.0", fantrax="123.0", avg="124.0", real_time="122  -3"),
        _row(4, "Tyreek Hill", "WR12", espn="30.0", real_time="30  +1"),
        _row(5, "Ben VanSumeren   BUF (6)", "LB1"),
        _row(6, "Nobody Special   NYG (5)", "WR42", espn="40.0", avg="40.5"),
        _row(7, "Jahmyr Gibbs   DET (6)", "RB2", espn="44.0", avg="44.0"),
    )

    assert artifact["schemaVersion"] == FANTASYPROS_ADP_SCHEMA_VERSION
    assert artifact["source"]["file"] == "FantasyPros_2026_Overall_ADP_Rankings.csv"
    assert artifact["source"]["rows"] == 7
    assert artifact["source"]["matched"] == 4
    assert artifact["source"]["unmatched"] == 3
    assert artifact["source"]["emptyColumns"] == ["NFL"]
    assert artifact["source"]["status"] == "ok"
    assert artifact["source"]["matched"] + artifact["source"]["unmatched"] == artifact["source"]["rows"]
    assert artifact["source"]["matched"] == len(artifact["players"])

    assert artifact["providers"] == [
        {"key": "espn", "label": "ESPN", "rows": 6, "matchedRows": 4},
        {"key": "sleeper", "label": "Sleeper", "rows": 3, "matchedRows": 3},
        {"key": "cbs", "label": "CBS", "rows": 3, "matchedRows": 3},
        {"key": "rtsports", "label": "RTSports", "rows": 3, "matchedRows": 3},
        {"key": "fantrax", "label": "Fantrax", "rows": 3, "matchedRows": 3},
    ]
    assert artifact["consensus"] == {"key": "avg", "label": "FantasyPros AVG", "rows": 7}
    assert artifact["realTime"] == {"key": "realTime", "label": "FantasyPros Real-Time", "rows": 4}

    gibbs = artifact["players"]["1"]
    assert gibbs == {
        "rank": 1,
        "positionRank": "RB1",
        "avg": 14.1,
        "realTime": {"rank": 14, "delta": -1},
        "adp": {"espn": 14.5, "sleeper": 15.2, "cbs": 13.8, "rtsports": 14.0, "fantrax": 14.2},
    }

    texans = artifact["players"]["HOU"]
    assert texans["positionRank"] == "DST1"
    assert texans["adp"]["sleeper"] == 121.0
    assert texans["realTime"] == {"rank": 122, "delta": -3}

    hill = artifact["players"]["3"]
    assert hill["adp"] == {"espn": 30.0}
    assert hill["realTime"] == {"rank": 30, "delta": 1}

    reasons = {entry["rank"]: entry["reason"] for entry in artifact["unmatched"]}
    assert reasons == {5: "non-fantasy-position", 6: "not-in-player-pool", 7: "duplicate-match"}
    assert artifact["unmatched"][0]["position"] == "LB"


def test_build_adp_artifact_routes_unmatched_pool_misses():
    # A fantasy-position row that matches the index but is absent from the
    # players.json population must land in unmatched, not ship a dead key.
    row = _row(1, "Jahmyr Gibbs   DET (6)", "RB1", espn="14.5", avg="14.1")
    artifact = _build(row, valid_ids={"1"})
    assert artifact["source"]["matched"] == 1
    assert artifact["unmatched"] == []
    # Swap the pool: the same row is now an unmatched not-in-player-pool miss.
    artifact2 = _build(row, valid_ids={"2"})
    assert artifact2["source"]["matched"] == 0
    assert artifact2["source"]["unmatched"] == 1
    assert artifact2["unmatched"][0]["reason"] == "not-in-player-pool"

