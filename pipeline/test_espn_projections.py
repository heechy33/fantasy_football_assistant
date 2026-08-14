"""Coverage for pipeline/espn_projections.py — the ESPN projection adapter.
Fixture-driven (no HTTP): the stat-id map, projection-entry selection, DEF
exclusion, and the Sleeper-vocab output are pinned here so a future drift in
ESPN's payload fails loudly instead of silently shifting columns.
"""

import pytest

from espn_projections import (
    ParsedEspnRow,
    _reconcile,
    espn_provider_result,
    parse_espn_payload,
)


def _player(full_name, default_position_id, pro_team_id, espn_id, stats=None, applied_total=100.0):
    return {
        "player": {
            "fullName": full_name,
            "defaultPositionId": default_position_id,
            "proTeamId": pro_team_id,
            "id": espn_id,
            "stats": [
                {
                    "seasonId": 2026,
                    "statSourceId": 1,
                    "statSplitTypeId": 0,
                    "scoringPeriodId": 0,
                    "appliedTotal": applied_total,
                    "stats": stats or {},
                },
                # A decoy weekly row that must be ignored.
                {"seasonId": 2026, "statSourceId": 1, "statSplitTypeId": 0, "scoringPeriodId": 4, "appliedTotal": 9.0, "stats": {"3": 100}},
            ],
        }
    }


def _payload(*players):
    return {"players": list(players)}


def test_parse_espn_payload_selects_season_projection_entry_and_maps_stats():
    # Josh Allen-style QB: stat 3=pass_yd, 4=pass_td, 20=pass_int, 24=rush_yd.
    payload = _payload(
        _player(
            "Josh Allen", 1, 2, "15830",
            stats={"0": 508, "3": 3944, "4": 26, "20": 11, "24": 579},
        )
    )
    rows = parse_espn_payload(payload, 2026)
    assert len(rows) == 1
    row = rows[0]
    assert row.position == "QB"
    assert row.team == "BUF"
    assert row.espn_id == "15830"
    assert row.stats == {"pass_att": 508, "pass_yd": 3944, "pass_td": 26, "pass_int": 11, "rush_yd": 579}


def test_parse_espn_payload_uses_stat_53_for_receptions():
    payload = _payload(
        _player(
            "Amon-Ra St. Brown", 3, 8, "123",
            stats={"42": 1426, "43": 10, "53": 118},
        )
    )
    rows = parse_espn_payload(payload, 2026)
    assert rows[0].stats["rec"] == 118
    assert rows[0].stats["rec_yd"] == 1426


def test_parse_espn_payload_ignores_weekly_and_prior_season_rows():
    # A player with only a weekly entry (scoringPeriodId != 0) is not a projection.
    payload = _payload(
        {"player": {"fullName": "Only Weekly", "defaultPositionId": 2, "proTeamId": 1, "id": "9",
                    "stats": [{"seasonId": 2026, "statSourceId": 1, "statSplitTypeId": 0, "scoringPeriodId": 4, "stats": {}}]}}
    )
    assert parse_espn_payload(payload, 2026) == []


def test_parse_espn_payload_rejects_missing_players_array():
    with pytest.raises(ValueError, match="no players array"):
        parse_espn_payload({"players": "nope"}, 2026)


def test_reconcile_passes_qb_and_fails_def():
    # Josh Allen-style raw: pass 3944yd/26td/2pt2/11int + rush 579yd/12td.
    # 3944*.04 + 26*4 + 2*2 + 11*-2 + 579*.1 + 12*6 = 373.66 — appliedTotal that
    # matches means the mapping is correct (error 0).
    qb_raw = {"3": 3944, "4": 26, "19": 2, "20": 11, "24": 579, "25": 12}
    ok, error = _reconcile("QB", qb_raw, 373.66)
    assert ok
    assert error < 0.01
    # DEF with a plausible-looking line fails the gate until the map is derived.
    def_raw = {"99": 45, "95": 12, "120": 320}
    ok_def, error_def = _reconcile("DEF", def_raw, 80.0)
    assert not ok_def
    assert error_def > 0.01


def test_espn_provider_result_excludes_def_and_matches_via_espn_id():
    payload = _payload(
        _player("Josh Allen", 1, 2, "15830", stats={"3": 3944, "4": 26, "19": 2, "20": 11, "24": 579, "25": 12}, applied_total=373.66),
        _player("Ravens D/ST", 16, 33, "-16033", stats={"99": 45, "95": 12, "120": 320}, applied_total=80.0),
    )
    sleeper_index = {("josh allen", "QB"): "sleeper-qb"}
    result = espn_provider_result(
        payload,
        season=2026,
        sleeper_index=sleeper_index,
        espn_id_to_player_id={"15830": "allen"},
        valid_player_ids={"allen", "BAL"},
        fetched_at="2026-08-13T00:00:00Z",
    )
    assert result.block["rows"] == 1
    assert result.block["positionRows"] == {"QB": 1}
    assert result.block["positionsExcluded"][0]["position"] == "DEF"
    assert "allen" in result.stats_by_player
    assert "BAL" not in result.stats_by_player
