"""Coverage for pipeline/provider_projections.py — the pure artifact assembly +
merge/staleness logic for the multi-provider projections artifact. No HTTP or
filesystem here; build_data wiring is covered by test_build_data_providers.py.
"""

from provider_projections import (
    PROVIDER_PROJECTIONS_SCHEMA_VERSION,
    STALE_AFTER_DAYS,
    ProviderResult,
    error_provider_result,
    merge_and_assemble,
    sleeper_provider_result,
)

_FETCHED = "2026-08-01T00:00:00Z"


def _raw_rows():
    return [
        {
            "player_id": "1",
            "player": {"first_name": "Josh", "last_name": "Allen", "position": "QB"},
            "company": "rotowire",
            "stats": {"adp_ppr": 14.5, "gp": 17, "pts_ppr": 380, "pass_yd": 4400, "pass_td": 34},
        },
        {
            "player_id": "2",
            "player": {"first_name": "Derrick", "last_name": "Henry", "position": "RB"},
            "company": "rotowire",
            "stats": {"adp_ppr": 22.0, "pts_half_ppr": 250, "rush_yd": 1200, "rush_td": 11},
        },
        {
            "player_id": "999",
            "player": {"first_name": "Pool", "last_name": "Miss", "position": "RB"},
            "company": "rotowire",
            "stats": {"rush_yd": 500},
        },
    ]


def test_sleeper_provider_result_builds_block_and_drops_non_stat_keys():
    result = sleeper_provider_result(_raw_rows(), {"1", "2"}, fetched_at=_FETCHED)
    assert result.key == "sleeper"
    assert result.block["status"] == "ok"
    assert result.block["rows"] == 2
    assert result.block["positionRows"] == {"QB": 1, "RB": 1}
    assert result.block["positionsExcluded"] == []
    assert result.block["staleSinceDays"] == 0
    # Pool miss 999 is dropped; adp_ppr/gp/pts_ppr are not box-score components.
    assert set(result.stats_by_player) == {"1", "2"}
    assert result.stats_by_player["1"] == {"pass_yd": 4400, "pass_td": 34}
    assert result.stats_by_player["2"] == {"rush_yd": 1200, "rush_td": 11}


def test_error_provider_result_carries_no_rows():
    result = error_provider_result("espn", "ESPN", diagnostic="offline")
    assert result.block["status"] == "error"
    assert result.block["rows"] == 0
    assert result.block["diagnostic"] == "offline"
    assert result.stats_by_player == {}


def _ok_result():
    return sleeper_provider_result(_raw_rows(), {"1", "2"}, fetched_at=_FETCHED)


def test_merge_and_assemble_combines_providers_into_players_map():
    sleeper = _ok_result()
    espn_ok = ProviderResult(
        key="espn",
        label="ESPN",
        block={
            "key": "espn",
            "label": "ESPN",
            "attribution": "ESPN",
            "status": "ok",
            "fetchedAt": _FETCHED,
            "upstreamUpdatedAt": None,
            "rows": 2,
            "positionRows": {"QB": 1, "RB": 1},
            "positionsExcluded": [],
        },
        stats_by_player={"1": {"pass_yd": 4300, "pass_td": 33}},
    )

    artifact = merge_and_assemble(None, [sleeper, espn_ok], season=2026, generated_at=_FETCHED, now_iso=_FETCHED)
    assert artifact["schemaVersion"] == PROVIDER_PROJECTIONS_SCHEMA_VERSION
    assert artifact["displayOnly"] is True
    assert {block["key"] for block in artifact["providers"]} == {"sleeper", "espn"}
    assert artifact["players"]["1"]["sleeper"] == {"pass_yd": 4400, "pass_td": 34}
    assert artifact["players"]["1"]["espn"] == {"pass_yd": 4300, "pass_td": 33}


def test_merge_carries_previous_rows_forward_as_stale_when_fresh():
    previous = merge_and_assemble(None, [_ok_result()], season=2026, generated_at=_FETCHED, now_iso=_FETCHED)
    failed = error_provider_result("sleeper", "Sleeper (Rotowire)", diagnostic="boom")
    now = "2026-08-03T00:00:00Z"  # 2 days later -> within the 14-day window

    artifact = merge_and_assemble(previous, [failed], season=2026, generated_at=now, now_iso=now)
    block = artifact["providers"][0]
    assert block["status"] == "stale"
    assert block["rows"] == 2
    assert block["fetchedAt"] == _FETCHED  # original fetch time preserved
    assert block["staleSinceDays"] == 2
    assert block["diagnostic"] == "boom"
    # The carried-forward rows are still present.
    assert artifact["players"]["1"]["sleeper"] == {"pass_yd": 4400, "pass_td": 34}


def test_merge_drops_rows_after_hard_expiry():
    previous = merge_and_assemble(None, [_ok_result()], season=2026, generated_at=_FETCHED, now_iso=_FETCHED)
    failed = error_provider_result("sleeper", "Sleeper (Rotowire)", diagnostic="still down")
    now = "2026-08-20T00:00:00Z"  # 19 days later -> past STALE_AFTER_DAYS

    artifact = merge_and_assemble(previous, [failed], season=2026, generated_at=now, now_iso=now)
    block = artifact["providers"][0]
    assert block["status"] == "error"
    assert block["rows"] == 0
    assert block["staleSinceDays"] > STALE_AFTER_DAYS
    # No stale sleeper rows in the players map anymore.
    assert "sleeper" not in (artifact["players"].get("1") or {})


def test_merge_without_previous_keeps_error_block():
    failed = error_provider_result("espn", "ESPN", diagnostic="offline")
    artifact = merge_and_assemble(None, [failed], season=2026, generated_at=_FETCHED, now_iso=_FETCHED)
    assert artifact["providers"][0]["status"] == "error"
    assert artifact["players"] == {}


def test_merge_treats_unparseable_previous_fetch_date_as_stale():
    previous = {
        "providers": [
            {"key": "sleeper", "label": "Sleeper (Rotowire)", "status": "ok", "fetchedAt": "not-a-date", "rows": 2},
        ],
        "players": {"1": {"sleeper": {"rush_yd": 100}}},
    }
    failed = error_provider_result("sleeper", "Sleeper (Rotowire)", diagnostic="boom")
    artifact = merge_and_assemble(previous, [failed], season=2026, generated_at=_FETCHED, now_iso=_FETCHED)
    # Unparseable fetchedAt is treated as hard-expired: rows dropped, error status.
    assert artifact["providers"][0]["status"] == "error"
    assert artifact["providers"][0]["rows"] == 0
