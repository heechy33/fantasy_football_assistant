import pytest

from transform import (
    AdpEntry,
    build_adp_entries,
    build_sleeper_adp_entries,
    fitted_stdev,
    fit_adp_cv_bands,
    SLEEPER_ADP_SENTINEL,
)


def test_fitted_stdev_matches_calibrated_bands():
    # Values measured live against the 2026 FFC PPR board (mean(sd/adp) per
    # band) -- see transform.py's _ADP_CV_BANDS docstring. Pin the boundary
    # behavior so a future edit can't silently drift the curve.
    assert fitted_stdev(6) == pytest.approx(6 * 0.247)
    assert fitted_stdev(18) == pytest.approx(18 * 0.169)
    assert fitted_stdev(36) == pytest.approx(36 * 0.124)
    assert fitted_stdev(100) == pytest.approx(100 * 0.112)


def test_fitted_stdev_floor_applies_at_the_very_top_of_the_board():
    # adp=1 * 0.247 = 0.247, well under the observed floor -- the floor must win.
    assert fitted_stdev(1) == pytest.approx(0.7)


def test_fitted_stdev_is_monotonic_increasing_in_adp():
    values = [fitted_stdev(a) for a in (1, 5, 12, 24, 48, 100, 250)]
    assert values == sorted(values)


def _row(player_id, first, last, position, team, adp_ppr=999.0, adp_std=999.0, adp_half_ppr=999.0, adp_2qb=999.0):

    return {
        "player_id": player_id,
        "player": {"first_name": first, "last_name": last, "position": position, "team": team},
        "stats": {
            "adp_ppr": adp_ppr,
            "adp_std": adp_std,
            "adp_half_ppr": adp_half_ppr,
            "adp_2qb": adp_2qb,
        },
    }


def test_build_sleeper_adp_entries_filters_the_999_sentinel():
    rows = [
        _row("1", "Real", "Player", "RB", "DAL", adp_ppr=12.5),
        _row("2", "No", "Sample", "WR", "SF", adp_ppr=999.0),  # sentinel -- must be dropped
    ]
    entries, diagnostics = build_sleeper_adp_entries(rows, "ppr")
    assert [e.playerId for e in entries] == ["1"]
    assert diagnostics["sampleSize"] == 1
    assert SLEEPER_ADP_SENTINEL == 900.0


def test_build_sleeper_adp_entries_native_player_id_and_fitted_stdev():
    rows = [_row("9221", "Jahmyr", "Gibbs", "RB", "DET", adp_ppr=1.6)]
    entries, _ = build_sleeper_adp_entries(rows, "ppr")
    entry = entries[0]
    assert isinstance(entry, AdpEntry)
    assert entry.playerId == "9221"  # native sleeper_id, no crosswalk needed
    assert entry.name == "Jahmyr Gibbs"
    assert entry.adpSource == "sleeper"
    assert entry.stdevSource == "fitted"
    assert entry.stdev == pytest.approx(fitted_stdev(1.6))
    # Sleeper's lobby carries no dispersion/sample-size fields -- these are
    # genuinely unknown (None), not zero.
    assert entry.high is None
    assert entry.low is None
    assert entry.timesDrafted is None
    assert entry.byeWeek is None


def test_build_sleeper_adp_entries_def_name_from_split_team_fields():
    # DEF rows split the team name across first_name/last_name (verified live:
    # {"first_name": "Los Angeles", "last_name": "Rams", "position": "DEF",
    # "player_id": "LAR"}), the same convention build_player_meta uses.
    rows = [_row("LAR", "Los Angeles", "Rams", "DEF", "LAR", adp_ppr=115.5)]
    entries, _ = build_sleeper_adp_entries(rows, "ppr")
    assert entries[0].playerId == "LAR"
    assert entries[0].name == "Los Angeles Rams"
    assert entries[0].position == "DEF"


def test_build_sleeper_adp_entries_sorts_ascending_by_adp():
    rows = [
        _row("2", "Second", "Overall", "WR", "SF", adp_ppr=5.0),
        _row("1", "First", "Overall", "RB", "DET", adp_ppr=1.0),
    ]
    entries, _ = build_sleeper_adp_entries(rows, "ppr")
    assert [e.playerId for e in entries] == ["1", "2"]


def test_build_sleeper_adp_entries_reads_the_requested_format_key():
    rows = [_row("1", "Only", "Std", "RB", "DAL", adp_ppr=999.0, adp_std=42.0)]
    ppr_entries, _ = build_sleeper_adp_entries(rows, "ppr")
    std_entries, _ = build_sleeper_adp_entries(rows, "standard")
    assert ppr_entries == []
    assert len(std_entries) == 1
    assert std_entries[0].adp == 42.0


def test_build_adp_entries_ffc_path_still_marks_observed_provenance():
    ffc_players = [
        {"name": "Test Player", "position": "RB", "team": "DAL", "adp": 10.0, "stdev": 2.0, "high": 5, "low": 15, "times_drafted": 100, "bye": 7},
    ]
    sleeper_index = {("test player", "RB"): "abc123"}
    entries, diagnostics = build_adp_entries(ffc_players, sleeper_index)
    assert entries[0].adpSource == "ffc"
    assert entries[0].stdevSource == "observed"
    assert entries[0].high == 5
    assert entries[0].low == 15
    assert entries[0].timesDrafted == 100
    assert diagnostics["sampleSize"] == 1

def test_fit_adp_cv_bands_uses_observed_ffc_spread_per_band_and_defaults_when_empty():
    entries = [
        AdpEntry("1", "Top", "RB", "BUF", 6, 1.5, 1, 8, 100, 7),
        AdpEntry("2", "Middle", "WR", "BUF", 18, 3.6, 10, 25, 100, 7),
    ]
    bands = fit_adp_cv_bands(entries)
    assert bands[0] == pytest.approx((12, 0.25))
    assert bands[1] == pytest.approx((24, 0.2))
    assert bands[2][1] == pytest.approx(0.124)

