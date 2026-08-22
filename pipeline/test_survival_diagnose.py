import pytest

from survival_diagnose import (
    band_of,
    diagnose,
    expected_range_factor,
    h1_range_consistency,
    h1_tail_asymmetry,
    h1_tail_asymmetry_excluding_censored,
    h2_heterogeneity,
    right_censoring,
)


def _player(name, adp, stdev, high, low, times_drafted=50):
    return {
        "name": name,
        "position": "RB",
        "team": "XX",
        "adp": adp,
        "high": high,
        "low": low,
        "stdev": stdev,
        "times_drafted": times_drafted,
        "bye": 7,
    }


def test_expected_range_factor_matches_known_d2_constants():
    # Standard SPC unbiasing constants for the normal sample range.
    assert expected_range_factor(2) == pytest.approx(1.128, abs=0.02)
    assert expected_range_factor(10) == pytest.approx(3.078, abs=0.05)
    assert expected_range_factor(20) == pytest.approx(3.735, abs=0.08)
    # Monotone increasing, and undefined below n=2.
    values = [expected_range_factor(n) for n in (2, 10, 50, 500, 2551)]
    assert values == sorted(values)
    assert expected_range_factor(1) is None
    assert expected_range_factor(0) is None


def test_h1_tail_asymmetry_is_symmetric_under_balanced_tails():
    players = [_player(f"p{i}", 35 + i, 2, 35 + i - 2, 35 + i + 2) for i in range(6)]
    report = h1_tail_asymmetry(players)
    pooled = report["pooled"]
    assert pooled["meanLeftTail"] == pytest.approx(2.0)
    assert pooled["meanRightTail"] == pytest.approx(2.0)
    assert pooled["meanAsymmetryLeftMinusRight"] == pytest.approx(0.0, abs=1e-9)


def test_h1_tail_asymmetry_detects_right_skew():
    # Long right tail (players can fall far) -> (low - adp) >> (adp - high).
    players = [_player(f"p{i}", 35, 2, 34, 41) for i in range(6)]
    pooled = h1_tail_asymmetry(players)["pooled"]
    assert pooled["meanLeftTail"] == pytest.approx(1.0)
    assert pooled["meanRightTail"] == pytest.approx(6.0)
    assert pooled["meanAsymmetryLeftMinusRight"] == pytest.approx(-5.0)
    assert pooled["leftLongerFraction"] == 0.0


def test_h1_uses_ffc_field_semantics_high_is_earliest():
    # FFC's `high` is the earliest pick (smallest number): Bijan-like row.
    players = [_player("Bijan", 1.7, 0.8, 1, 6, times_drafted=1154)]
    pooled = h1_tail_asymmetry(players)["pooled"]
    assert pooled["meanLeftTail"] == pytest.approx(0.7)
    assert pooled["meanRightTail"] == pytest.approx(4.3)


def test_h1_range_consistency_uses_d2_and_stdev():
    d2 = expected_range_factor(10)
    half = d2 * 3.0 / 2.0
    players = [_player("p", 40, 3, 40 - half, 40 + half, times_drafted=10)]
    pooled = h1_range_consistency(players)["pooled"]
    assert pooled["medianRatio"] == pytest.approx(1.0, abs=0.02)


def test_h2_heterogeneity_detects_within_band_spread():
    # Same <=12 band: one low-CV, one high-CV player. Band constant is 0.247.
    players = [
        _player("tight", 10, 1.2, 9, 12, times_drafted=200),   # cv 0.12
        _player("wide", 10, 5.0, 6, 15, times_drafted=200),    # cv 0.50
    ]
    report = h2_heterogeneity(players)
    band = report["byBand"]["<=12"]
    assert band["n"] == 2
    assert band["spreadP90OverP10"] > 2.0
    assert band["farFromBandCvFraction"] == 1.0


def test_h2_homogeneous_band_is_representative():
    players = [_player(f"p{i}", 10, 2.47, 8, 12, times_drafted=200) for i in range(4)]  # cv = 0.247
    report = h2_heterogeneity(players)
    band = report["byBand"]["<=12"]
    assert band["medianObservedCv"] == pytest.approx(0.247, abs=0.01)
    assert band["farFromBandCvFraction"] == 0.0
    assert band["bandCvIsRepresentative"] is True


def test_diagnose_skips_missing_and_degenerate_fields():
    good = _player("ok", 30, 3, 28, 34, times_drafted=50)
    missing_stdev = {**good, "stdev": None}
    bad_order = {**good, "high": 34, "low": 28}  # high > low
    one_sample = {**good, "times_drafted": 1}
    report = diagnose([good, missing_stdev, bad_order, one_sample])
    assert report["inputPlayers"] == 4
    assert report["usablePlayers"] == 1
    # Every table is populated for the one usable player without crashing.
    assert report["h1TailAsymmetry"]["pooled"]["n"] == 1
    assert report["h1RangeConsistency"]["pooled"]["n"] == 1


def test_band_of_matches_fitted_stdev_boundaries():
    assert band_of(6) == 12
    assert band_of(23.9) == 24
    assert band_of(24) == 48
    assert band_of(100) == float("inf")


# ---------------------------------------------------------------------------
# Right-censoring check (guards H1's deep-ADP verdict against the fixed mock
# length artifact found on the live 2026 FFC feed - see the module docstring).
# ---------------------------------------------------------------------------


def test_right_censoring_flags_near_and_at_ceiling():
    players = [
        _player("at", 90, 3, 85, 100),   # low == max_pick -> at ceiling
        _player("near", 90, 3, 85, 95),  # within margin -> near ceiling, not at
        _player("clear", 50, 3, 45, 60), # well below -> neither
    ]
    report = right_censoring(players, max_pick=100, ceiling_margin=10)
    pooled = report["pooled"]
    assert pooled["n"] == 3
    assert pooled["atCeilingCount"] == 1
    assert pooled["nearCeilingCount"] == 2
    assert pooled["atCeilingFraction"] == pytest.approx(1 / 3, abs=0.01)
    assert pooled["nearCeilingFraction"] == pytest.approx(2 / 3, abs=0.01)


def test_h1_tail_asymmetry_excluding_censored_drops_near_ceiling_rows():
    kept = _player("kept", 60, 3, 55, 75)     # low=75, well clear of a 100-pick ceiling
    dropped = _player("dropped", 60, 3, 55, 95)  # low=95, within 10 of a 100-pick ceiling
    report = h1_tail_asymmetry_excluding_censored([kept, dropped], max_pick=100, ceiling_margin=10)
    assert report["pooled"]["n"] == 1
    assert report["pooled"]["meanRightTail"] == pytest.approx(15.0)  # kept player's (low - adp)


def test_diagnose_flags_censoring_artifact_when_exclusion_flips_the_sign():
    # One band (adp >= 48, "deep tail"): 4 honest players well clear of the ceiling show the
    # true right-longer skew; 6 players parked near a max_pick=100 ceiling report an inflated
    # left tail purely because their room to fall is mechanically small. Pooling both naively
    # makes the band look left-longer; excluding the near-ceiling six should recover the truth.
    honest = [_player(f"honest{i}", 60, 3, 55, 75) for i in range(4)]   # asym = 5-15 = -10
    censored = [_player(f"censored{i}", 85, 3, 65, 95) for i in range(6)]  # asym = 20-10 = +10, low=95 near ceiling(100,margin10)
    report = diagnose(honest + censored, max_pick=100, ceiling_margin=10)

    all_deep = report["h1TailAsymmetry"]["byBand"]["deep tail"]
    excl_deep = report["h1TailAsymmetryExcludingCensored"]["byBand"]["deep tail"]
    assert all_deep["meanAsymmetryLeftMinusRight"] > 1.0        # naive read: left-longer
    assert excl_deep["meanAsymmetryLeftMinusRight"] <= 0.5      # corrected read: not left-longer
    assert excl_deep["n"] == 4

    v = report["verdicts"]
    assert v["h1Skew"] is True
    assert "deep tail" in v["h1CensoringArtifactBands"]
    assert v["h1SkewSurvivesCensoringCheck"] is False  # flagged as likely a censoring artifact


def test_diagnose_without_max_pick_skips_censoring_check():
    players = [_player("p", 60, 3, 55, 75, times_drafted=50)]
    report = diagnose(players)
    assert "rightCensoring" not in report
    assert "h1CensoringArtifactBands" not in report["verdicts"]
