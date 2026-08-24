import math

import measure_sos as m


def week_row(player_id, position, week, pts, opp):
    return {"playerId": player_id, "position": position, "week": week, "pts": pts, "opponent": opp}


def player_meta(position, weeks):
    """Artifact-shaped player entry: `weeks` is a list of (week, pts, opp) tuples."""
    return {"p": position, "bye": None, "w": [[week, pts, opp] for week, pts, opp in weeks]}


# ---------------------------------------------------------------------------
# Artifact flattening
# ---------------------------------------------------------------------------

def test_load_player_weeks_strips_away_marker_and_skips_def_k_and_nulls():
    artifact = {
        "players": {
            "1": player_meta("WR", [(1, 10.0, "@DAL"), (2, None, "DAL"), (3, 5.0, None)]),
            "2": player_meta("DEF", [(1, 8.0, "NYG")]),
            "3": player_meta("K", [(1, 7.0, "CHI")]),
        }
    }
    rows = m.load_player_weeks(artifact)
    assert rows == [week_row("1", "WR", 1, 10.0, "DAL")]


def test_compute_fpa_means_points_allowed_per_defense_position_week():
    rows = [
        week_row("a", "WR", 1, 10.0, "DAL"),
        week_row("b", "WR", 1, 20.0, "DAL"),
        week_row("c", "RB", 1, 30.0, "DAL"),  # load_player_weeks already stripped '@'
    ]
    fpa, counts = m.compute_fpa(rows)
    assert fpa[("DAL", "WR", 1)] == 15.0
    assert fpa[("DAL", "RB", 1)] == 30.0
    assert counts[("DAL", "WR", 1)] == 2


def test_build_prediction_rows_computes_form_from_trailing_window_only():
    # Player scores weeks 1-3; prediction row exists for week 4 (and later weeks).
    weeks = [(1, 6.0, "DAL"), (2, 12.0, "DAL"), (3, 18.0, "DAL"), (4, 99.0, "DAL")]
    artifact = {"players": {"1": player_meta("WR", weeks)}}
    rows = {row["week"]: row for row in m.build_prediction_rows(artifact)}
    assert set(rows) == {3, 4}  # weeks 1-2 lack >= FORM_MIN_OBS prior games
    assert rows[4]["form"] == (6.0 + 12.0 + 18.0) / 3
    assert rows[4]["pts"] == 99.0  # outcome kept separate from the signal window
    assert rows[3]["form"] == (6.0 + 12.0) / 2


def test_build_prediction_rows_signal_needs_min_obs_and_reads_past_weeks():
    # DAL/WR FPA observed in weeks 1 and 2 (mean 20 and 30); b predicts from week 3.
    artifact = {
        "players": {
            "a1": player_meta("WR", [(1, 10.0, "DAL"), (2, 20.0, "DAL"), (4, 4.0, "DAL")]),
            "a2": player_meta("WR", [(1, 30.0, "DAL"), (2, 40.0, "DAL"), (4, 4.0, "DAL")]),
            "b": player_meta("WR", [(1, 5.0, "NYG"), (2, 6.0, "NYG"), (3, 7.0, "DAL")]),
        }
    }
    rows = {(row["playerId"], row["week"]): row for row in m.build_prediction_rows(artifact)}
    week3 = rows[("b", 3)]
    assert week3["sos_1w"] == 30.0  # DAL allowed 30 WR pts in week 2
    assert week3["sos_3w"] == 25.0  # mean(20, 30); week 3 itself never enters
    # sos_5w needs 3 observed DAL games; only weeks 1-2 exist -> suppressed, not faked.
    assert week3["sos_5w"] is None
    # Week 4 for a1: the trailing window covers weeks 1-3 of DAL WR FPA
    # (20, 30, and b's own week-3 game vs DAL at 7) -> mean = 19.
    assert rows[("a1", 4)]["sos_3w"] == 19.0


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------

def test_pearson_perfect_and_degenerate():
    assert math.isclose(m.pearson([1, 2, 3], [2, 4, 6]), 1.0)
    assert m.pearson([1, 2, 3], [3, 3, 3]) is None  # zero variance


def test_spearman_handles_ties_with_average_ranks():
    # x ties on its first two values -> ranks (1.5, 1.5, 3)
    expected = m.pearson([1.5, 1.5, 3.0], [1, 2, 3])
    assert math.isclose(m.spearman([1, 1, 2], [1, 2, 3]), expected)


def test_partial_pearson_matches_residual_correlation():
    control = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    y = [2 * c + noise for c, noise in zip(control, [1, -1, 1, -1, 1, -1])]
    x = [5.0, 4.0, 6.0, 3.0, 7.0, 2.0]

    def residuals(values, z):
        mean_v, mean_z = m._mean(values), m._mean(z)
        beta = sum((v - mean_v) * (zi - mean_z) for v, zi in zip(values, z)) / sum(
            (zi - mean_z) ** 2 for zi in z
        )
        return [v - (mean_v + beta * (zi - mean_z)) for v, zi in zip(values, z)]

    expected = m.pearson(residuals(x, control), residuals(y, control))
    assert math.isclose(m.partial_pearson(x, y, control), expected)


def test_bootstrap_ci_is_deterministic_for_fixed_seed():
    rows = [
        {**week_row(str(i), "WR", (i % 4) + 1, float(i) % 7, "DAL")} for i in range(40)
    ]

    def statistic(subset):
        return m.pearson([row["pts"] for row in subset], [float(row["week"]) for row in subset])

    ci_a = m.week_cluster_bootstrap_ci(rows, statistic, iterations=50, seed=7)
    ci_b = m.week_cluster_bootstrap_ci(rows, statistic, iterations=50, seed=7)
    assert ci_a == ci_b and ci_a[0] <= ci_a[1]


# ---------------------------------------------------------------------------
# Rank utility
# ---------------------------------------------------------------------------

def _rank_pool(pts_signal_pairs):
    """24 WRs in one week whose matchup signal exactly reveals the outcome."""
    return [
        {
            "playerId": str(i),
            "position": "WR",
            "week": 5,
            "pts": pts,
            "opponent": "DAL",
            "form": 10.0,  # constant: baseline ranking is pure ties, zero information
            "sos_3w": signal,
        }
        for i, (pts, signal) in enumerate(pts_signal_pairs)
    ]


def test_rank_utility_perfect_signal_beats_constant_form_baseline():
    result = m.rank_utility_test(_rank_pool([(float(i), float(i)) for i in range(24)]), "sos_3w")
    assert result["pairs"] == 1
    assert result["baselineMeanSpearman"] is None  # constant form cannot rank
    assert result["treatmentMeanSpearman"] > 0.99
    assert result["sharePairsPositive"] == 1.0
    assert result["meanHitRateDelta"] > 0


def test_rank_utility_inverted_signal_can_only_hurt():
    result = m.rank_utility_test(_rank_pool([(float(i), float(23 - i)) for i in range(24)]), "sos_3w")
    assert result["sharePairsPositive"] == 0.0
    assert result["treatmentMeanSpearman"] < 0


# ---------------------------------------------------------------------------
# Gate + stars audit + report
# ---------------------------------------------------------------------------

CORRELATION_PASS = {
    "partialPearsonGivenForm": 0.08,
    "partialPearsonCI95": [0.02, 0.14],
}
RANK_PASS = {"meanHitRateDelta": 0.01, "sharePairsPositive": 0.7}


def test_passes_gate_requires_both_halves():
    assert m.passes_gate(CORRELATION_PASS, RANK_PASS)
    weak_r = {**CORRELATION_PASS, "partialPearsonGivenForm": 0.04}
    assert not m.passes_gate(weak_r, RANK_PASS)
    crossing_ci = {**CORRELATION_PASS, "partialPearsonCI95": [-0.01, 0.14]}
    assert not m.passes_gate(crossing_ci, RANK_PASS)
    negative_delta = {**RANK_PASS, "meanHitRateDelta": -0.005}
    assert not m.passes_gate(CORRELATION_PASS, negative_delta)
    inconsistent = {**RANK_PASS, "sharePairsPositive": 0.5}
    assert not m.passes_gate(CORRELATION_PASS, inconsistent)


def test_decide_verdict_keys_off_the_primary_signal_only():
    keep = {"signal": "sos_3w", **CORRELATION_PASS, "rankUtility": RANK_PASS}
    cut = {
        "signal": "sos_3w",
        **{**CORRELATION_PASS, "partialPearsonGivenForm": 0.01},
        "rankUtility": RANK_PASS,
    }
    passing_secondary = {"signal": "sos_1w", **CORRELATION_PASS, "rankUtility": RANK_PASS}
    assert m.decide_verdict([passing_secondary, keep]) == "KEEP"
    assert m.decide_verdict([passing_secondary, cut]) == "CUT"


def test_stars_audit_joins_on_sleeper_id_and_controls_for_rank():
    weekly = {
        "players": {
            "10": player_meta("QB", [(1, 30.0, "DAL")]),
            "20": player_meta("RB", [(1, 8.0, "DAL")]),
            "30": player_meta("WR", [(1, 5.0, "DAL")]),
            "50": player_meta("WR", [(1, 15.0, "NYG")]),
        }
    }
    stars = {
        "players": {
            "10": {"rank": 1, "sos": 1},
            "20": {"rank": 50, "sos": 5},
            "30": {"rank": 100, "sos": None},  # excluded: no stars
            "40": {"rank": 10, "sos": 2},      # excluded: no outcomes
            "50": {"rank": 30, "sos": 3},
        }
    }
    result = m.stars_audit(stars, weekly)
    assert result["n"] == 3
    assert isinstance(result["rawPearsonVsPpg"], float)


def test_write_report_embeds_pre_declared_rule_and_verdict():
    import json
    import tempfile
    from pathlib import Path

    results = [
        {
            "signal": "sos_3w",
            "n": 10,
            "rawPearson": 0.01,
            "partialPearsonGivenForm": 0.005,
            "partialPearsonCI95": [-0.03, 0.04],
            "rankUtility": {
                "pairs": 3,
                "topN": 12,
                "minPool": 24,
                "meanHitRateDelta": -0.001,
                "sharePairsPositive": 0.33,
                "baselineMeanSpearman": 0.2,
                "treatmentMeanSpearman": 0.19,
            },
        }
    ]
    stars = {"n": 400, "rawPearsonVsPpg": -0.02, "partialPearsonVsPpgGivenRank": -0.015}
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        json_path = tmp_path / "report.json"
        md_path = tmp_path / "report.md"
        m.write_report(results, stars, "CUT", json_path, md_path)

        payload = json.loads(json_path.read_text())
        assert payload["verdict"] == "CUT"
        assert payload["preDeclaredRule"]["keepOnlyIfBothPass"] is True
        text = md_path.read_text()
        assert "|partial r| < 0.05" in text
        assert "**CUT**" in text
