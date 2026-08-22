"""Coverage for pipeline/espn_adp.py — the ESPN default-league ADP adapter.

Fixture-driven (no HTTP): ADP parsing is independent of the season-projection
stats[] entry, DEF resolution uses proTeamId (never ESPN's negative synthetic
ids), censor-cutoff detection is pinned (spike / clean / degenerate), and the
Sleeper tail splice is accounted for exactly.
"""

from __future__ import annotations

import pytest

import transform
from espn_adp import (
    ParsedEspnAdpRow,
    build_espn_adp_entries,
    detect_censor_cutoff,
    parse_espn_adp_rows,
)
from transform import AdpEntry, fitted_stdev

# Empty-band fit returns the default FFC CV curve.
_DEFAULT_CV_BANDS = transform.fit_adp_cv_bands([])


def _player(full_name, default_position_id, pro_team_id, espn_id, adp):
    return {
        "player": {
            "fullName": full_name,
            "defaultPositionId": default_position_id,
            "proTeamId": pro_team_id,
            "id": espn_id,
            # No stats[] on purpose: ADP must parse without a projection row.
            "ownership": {"averageDraftPosition": adp},
        }
    }


def _payload(*players):
    return {"players": list(players)}


def _adp_row(name, position, team, espn_id, adp):
    return ParsedEspnAdpRow(name=name, team=team, position=position, espn_id=espn_id, adp=adp)


def test_parse_espn_adp_rows_reads_ownership_without_projection_entry():
    payload = _payload(
        _player("Josh Allen", 1, 2, "15830", 18.0),
        _player("Ravens D/ST", 16, 33, "-16033", 15.0),  # DEF: negative synthetic id
    )
    assert parse_espn_adp_rows(payload) == [
        ParsedEspnAdpRow(name="Josh Allen", team="BUF", position="QB", espn_id="15830", adp=18.0),
        ParsedEspnAdpRow(name="Ravens D/ST", team="BAL", position="DEF", espn_id="-16033", adp=15.0),
    ]


def test_parse_espn_adp_rows_skips_missing_non_finite_and_nonpositive_adp():
    payload = _payload(
        _player("No Ownership", 2, 1, "1", None),
        _player("Zero", 2, 1, "2", 0.0),
        _player("Negative", 2, 1, "3", -5.0),
        {"player": {"fullName": "NaN", "defaultPositionId": 2, "proTeamId": 1, "id": "4",
                    "ownership": {"averageDraftPosition": float("nan")}}},
        {"player": {"fullName": "Unmapped", "defaultPositionId": 9, "proTeamId": 1, "id": "5",
                    "ownership": {"averageDraftPosition": 30.0}}},
    )
    assert parse_espn_adp_rows(payload) == []


def test_parse_espn_adp_rows_rejects_schema_drift():
    with pytest.raises(ValueError, match="no players array"):
        parse_espn_adp_rows({"players": "nope"})
    with pytest.raises(ValueError, match="missing nested player object"):
        parse_espn_adp_rows({"players": [{"player": "nope"}]})


def test_detect_censor_cutoff_finds_sentinel_spike():
    # One row per pick through 164 (honest region), then a dense sentinel
    # cluster in [165, 170) — mirrors the live payload's censor cliff.
    adps = [float(pick) for pick in range(1, 165)]
    adps.extend(168.0 + (i % 4) * 0.3 for i in range(400))
    assert detect_censor_cutoff(adps) == 165.0


def test_detect_censor_cutoff_none_on_clean_distribution():
    adps = [float(pick) for pick in range(1, 201)]
    assert detect_censor_cutoff(adps) is None


def test_detect_censor_cutoff_raises_on_degenerate_early_spike():
    adps = []
    for pick in range(1, 101):
        adps.extend([float(pick)] * 5)
    adps.extend([41.0] * 500)  # dense cluster at 41 < _CENSOR_MIN_CUTOFF
    with pytest.raises(ValueError, match="censor"):
        detect_censor_cutoff(adps)


def test_build_espn_adp_entries_head_matches_ids_first_def_by_pro_team():
    rows = [
        _adp_row("Josh Allen", "QB", "BUF", "15830", 18.0),
        _adp_row("Ravens D/ST", "DEF", "BAL", "-16033", 15.0),
        _adp_row("Unmatched Guy", "WR", None, "777", 12.0),
    ]
    entries, diag = build_espn_adp_entries(
        rows,
        cv_bands=_DEFAULT_CV_BANDS,
        espn_id_to_player_id={"15830": "allen"},
        sleeper_index={("josh allen", "QB"): "allen", ("BAL", "DEF"): "BAL"},
        valid_player_ids={"allen", "BAL"},
        fallback_entries=[],
    )
    assert {entry.playerId for entry in entries} == {"allen", "BAL"}
    allen = next(entry for entry in entries if entry.playerId == "allen")
    assert allen.adpSource == "espn"
    assert allen.stdevSource == "fitted"
    assert allen.high is None and allen.low is None and allen.timesDrafted is None
    assert allen.team == "BUF"
    bal = next(entry for entry in entries if entry.playerId == "BAL")
    assert bal.position == "DEF"
    assert bal.team == "BAL"
    assert diag == {"censorCutoff": None, "espnRows": 2, "tailRows": 0}


def test_build_espn_adp_entries_head_stdev_is_plain_fitted_no_disagreement_floor():
    rows = [_adp_row("Josh Allen", "QB", "BUF", "15830", 18.0)]
    entries, _ = build_espn_adp_entries(
        rows,
        cv_bands=_DEFAULT_CV_BANDS,
        espn_id_to_player_id={"15830": "allen"},
        sleeper_index={("josh allen", "QB"): "allen"},
        valid_player_ids={"allen"},
        fallback_entries=[],
    )
    assert entries[0].stdev == fitted_stdev(18.0, _DEFAULT_CV_BANDS)


def test_build_espn_adp_entries_head_uses_ffc_cv_index_when_provided():
    # Phase 2c H2: a per-player FFC-observed CV, once matched, should diverge
    # the ESPN board's synthesized stdev from the flat band constant exactly
    # like it does for the Sleeper board (transform.fitted_stdev_for_player).
    rows = [_adp_row("Josh Allen", "QB", "BUF", "15830", 18.0)]
    ffc_cv_index = {"allen": (0.4, 5000)}  # well above the <=24 band's constant
    entries, _ = build_espn_adp_entries(
        rows,
        cv_bands=_DEFAULT_CV_BANDS,
        espn_id_to_player_id={"15830": "allen"},
        sleeper_index={("josh allen", "QB"): "allen"},
        valid_player_ids={"allen"},
        fallback_entries=[],
        ffc_cv_index=ffc_cv_index,
    )
    assert entries[0].stdev > fitted_stdev(18.0, _DEFAULT_CV_BANDS)
    assert entries[0].stdev == transform.fitted_stdev_for_player(18.0, "allen", ffc_cv_index, _DEFAULT_CV_BANDS)


def test_build_espn_adp_entries_tail_splice_accounting_and_clamp():
    # Head rows in [5, 45) plus a sentinel cluster at 160 so the censor cutoff
    # is detected at 160; four unmatched rows populate the 24-100 baseline
    # range so the median density is well defined.
    rows = [
        _adp_row("Josh Allen", "QB", "BUF", "15830", 5.0),
        _adp_row("Tyreek Hill", "WR", None, "123", 10.0),
        _adp_row("Ravens D/ST", "DEF", "BAL", "-16033", 15.0),
        _adp_row("Deep ESPN Guy", "RB", "BUF", "456", 20.0),
        _adp_row("Baseline A", "RB", "BUF", "9001", 30.0),   # unmatched
        _adp_row("Baseline B", "RB", "BUF", "9002", 35.0),   # unmatched
        _adp_row("Baseline C", "RB", "BUF", "9003", 40.0),   # unmatched
        _adp_row("Baseline D", "RB", "BUF", "9004", 45.0),   # unmatched
    ]
    for _ in range(30):
        rows.append(_adp_row("Sentinel", "RB", "BUF", "999", 160.0))

    fallback = [
        AdpEntry(playerId="allen", name="Josh Allen", position="QB", team="BUF", adp=4.0, stdev=2.0,
                 high=None, low=None, timesDrafted=None, byeWeek=7, adpSource="sleeper", stdevSource="fitted"),
        AdpEntry(playerId="gadsden", name="Oronde Gadsden II", position="TE", team=None, adp=107.0, stdev=12.0,
                 high=None, low=None, timesDrafted=None, byeWeek=None, adpSource="sleeper", stdevSource="fitted"),
        AdpEntry(playerId="deep", name="Deep Sleeper Guy", position="RB", team="BUF", adp=210.0, stdev=24.0,
                 high=None, low=None, timesDrafted=None, byeWeek=None, adpSource="sleeper", stdevSource="fitted"),
    ]
    entries, diag = build_espn_adp_entries(
        rows,
        cv_bands=_DEFAULT_CV_BANDS,
        espn_id_to_player_id={"15830": "allen", "123": "tyreek"},
        sleeper_index={("josh allen", "QB"): "allen", ("tyreek hill", "WR"): "tyreek",
                       ("BAL", "DEF"): "BAL", ("deep espn guy", "RB"): "deep-espn"},
        valid_player_ids={"allen", "tyreek", "BAL", "deep-espn", "gadsden", "deep"},
        fallback_entries=fallback,
    )

    assert diag == {"censorCutoff": 160.0, "espnRows": 4, "tailRows": 2}
    assert len(entries) == 6
    by_id = {entry.playerId: entry for entry in entries}

    # allen is already in the head -> not re-spliced as a tail row.
    assert by_id["allen"].adp == 5.0
    # The censored-region Sleeper player is clamped to the cutoff and its stdev
    # recomputed to the boundary; the source labels stay honest.
    gadsden = by_id["gadsden"]
    assert gadsden.adp == 160.0
    assert gadsden.stdev == fitted_stdev(160.0, _DEFAULT_CV_BANDS)
    assert gadsden.adpSource == "sleeper"
    assert gadsden.stdevSource == "fitted"
    # A deep tail player keeps adp and stdev untouched.
    deep = by_id["deep"]
    assert deep.adp == 210.0
    assert deep.stdev == 24.0
    # The board is ascending by adp.
    adps = [entry.adp for entry in entries]
    assert adps == sorted(adps)

