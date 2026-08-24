"""Measure whether early-window opponent FPA ("SOS") predicts weekly fantasy output.

One-off validation harness behind `npm run measure:sos`, network-free: it reads only
data/weekly-stats.json (real 2025 weekly outcomes incl. the schedule-derived `opp`
column) and data/fantasypros-stars.json (the currently displayed preseason SOS stars).

Motivation: a proposed 3-week trailing opponent-FPA signal was pitched as a draft/waiver
tie-breaker on the plausible-sounding claim that it is "less stale than season SOS".
Published research finds SOS ≈ no predictive value, and nothing says that improves at
shorter windows. Rather than redesign the feature, this measures it and lets a
pre-declared gate decide keep-vs-cut.

PRE-DECLARED DECISION RULE (written before any result was computed, gates.md style):
  Primary signal = trailing 3-week positional FPA, evaluated weeks 4-18, skill positions.
  CUT the SOS idea if EITHER fails:
    1. Correlation: partial Pearson between the signal and next-week PPR points,
       controlling for the player's own trailing-3-week form, has |r| < 0.05 or a
       95% week-cluster-bootstrap CI crossing zero.
    2. Rank utility: adding the signal to a form-only ranking does not improve the
       next-week top-12 hit rate (mean paired delta > 0 AND >= 60% of position-week
       pairs positive).
  KEEP only if BOTH pass. Secondary windows (1w, 5w, season-to-date) and the
  FantasyPros-stars audit are reported for context, not gating.

Known limitations: one season (2025), ~14 independent prediction weeks, FPA computed
from the same feed it predicts (trailing windows prevent leakage but not shared-source
bias). A null here cannot prove universal uselessness -- combined with the literature,
it is sufficient justification to cut, since the burden of proof is on SOS.
"""

from __future__ import annotations

import json
import math
import random
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Skill positions only: K and DEF "points" are their own scoring rules, and a
# defense's FPA grid would just re-measure its own fantasy scoring.
SKILL_POSITIONS = frozenset({"QB", "RB", "WR", "TE"})

FORM_WINDOW = 3
FORM_MIN_OBS = 2

# name -> (lookback weeks, min observed defense games in the window)
WINDOWED_SIGNALS = {"sos_1w": (1, 1), "sos_3w": (3, 2), "sos_5w": (5, 3)}
SEASON_SIGNAL = "sos_std"
SEASON_MIN_OBS = 3

BOOTSTRAP_ITERS = 1000
BOOTSTRAP_SEED = 20250823

CUT_ABS_PARTIAL_R = 0.05
RANK_UTILITY_TOP_N = 12
RANK_UTILITY_MIN_POOL = 24
RANK_UTILITY_MIN_SHARE_POSITIVE = 0.6


# ---------------------------------------------------------------------------
# Artifact flattening
# ---------------------------------------------------------------------------

def load_player_weeks(artifact):
    """Flatten the weekly artifact into skill-position rows with usable outcomes.

    A row survives only with a non-null `pts` (played and scored) and a non-null
    `opp` (schedule join succeeded); away games are normalized by stripping '@'.
    """
    rows = []
    for player_id, meta in artifact["players"].items():
        position = meta["p"]
        if position not in SKILL_POSITIONS:
            continue
        for tup in meta["w"]:
            week, pts, opp = tup[0], tup[1], tup[2]
            if pts is None or opp is None:
                continue
            rows.append(
                {
                    "playerId": player_id,
                    "position": position,
                    "week": int(week),
                    "pts": float(pts),
                    "opponent": str(opp).lstrip("@").upper(),
                }
            )
    return rows


def compute_fpa(player_weeks):
    """Mean PPR points allowed per (defense, position, week) plus observation counts.

    Derived entirely from the outcomes feed itself: every player-row facing defense D
    at position P in week W contributes its points to D's FPA grid cell.
    """
    buckets = defaultdict(list)
    for row in player_weeks:
        buckets[(row["opponent"], row["position"], row["week"])].append(row["pts"])
    fpa = {key: sum(values) / len(values) for key, values in buckets.items()}
    counts = {key: len(values) for key, values in buckets.items()}
    return fpa, counts


def _window_mean(series_by_week, end_week_exclusive, lookback, min_obs):
    values = [
        series_by_week[week]
        for week in range(max(1, end_week_exclusive - lookback), end_week_exclusive)
        if week in series_by_week
    ]
    if len(values) < min_obs:
        return None
    return sum(values) / len(values)


def build_prediction_rows(artifact):
    """Assemble one row per (player, week t) with form, all SOS signals, and outcome.

    Form = the player's own mean PPR points over the trailing FORM_WINDOW weeks
    (>= FORM_MIN_OBS games required). Each SOS signal is the opponent defense's
    positional FPA mean over its own trailing window; a signal is None when the
    defense lacks enough observed games in that window. Trailing windows only ever
    read weeks < t, so nothing leaks the future into the signal.
    """
    player_weeks = load_player_weeks(artifact)
    fpa, _counts = compute_fpa(player_weeks)
    fpa_series = defaultdict(dict)
    for (team, position, week), value in fpa.items():
        fpa_series[(team, position)][week] = value

    points_by_player_week = {(row["playerId"], row["week"]): row["pts"] for row in player_weeks}

    rows = []
    for current in player_weeks:
        week_t = current["week"]
        prior_points = [
            points_by_player_week.get((current["playerId"], week))
            for week in range(max(1, week_t - FORM_WINDOW), week_t)
        ]
        prior_points = [value for value in prior_points if value is not None]
        if len(prior_points) < FORM_MIN_OBS:
            continue

        series = fpa_series.get((current["opponent"], current["position"]), {})
        signals = {
            name: _window_mean(series, week_t, lookback, min_obs)
            for name, (lookback, min_obs) in WINDOWED_SIGNALS.items()
        }
        signals[SEASON_SIGNAL] = _window_mean(series, week_t, week_t - 1, SEASON_MIN_OBS)

        row = dict(current)
        row["form"] = sum(prior_points) / len(prior_points)
        row.update(signals)
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Statistics (stdlib only)
# ---------------------------------------------------------------------------

def _mean(values):
    return sum(values) / len(values)


def pearson(x, y):
    if len(x) != len(y) or len(x) < 3:
        return None
    mx, my = _mean(x), _mean(y)
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    if sxx == 0 or syy == 0:
        return None
    return sxy / math.sqrt(sxx * syy)


def _average_ranks(values):
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        average = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = average
        i = j + 1
    return ranks


def spearman(x, y):
    return pearson(_average_ranks(x), _average_ranks(y))


def partial_pearson(x, y, control):
    """Correlation between x and y after removing the linear influence of `control`."""
    r_xy = pearson(x, y)
    r_xz = pearson(x, control)
    r_yz = pearson(y, control)
    if None in (r_xy, r_xz, r_yz):
        return None
    denominator = (1 - r_xz**2) * (1 - r_yz**2)
    if denominator <= 0:
        return None
    return (r_xy - r_xz * r_yz) / math.sqrt(denominator)


def week_cluster_bootstrap_ci(rows, statistic, iterations=BOOTSTRAP_ITERS, seed=BOOTSTRAP_SEED):
    """Percentile CI for `statistic(row_subset)` via resampling whole prediction weeks.

    Weeks are the exchangeable unit (player-weeks within a week share slate-level
    noise), so clusters are weeks, not individual rows.
    """
    by_week = defaultdict(list)
    for row in rows:
        by_week[row["week"]].append(row)
    weeks = sorted(by_week)
    if len(weeks) < 3:
        return None
    rng = random.Random(seed)
    stats = []
    for _ in range(iterations):
        sample = [row for week in rng.choices(weeks, k=len(weeks)) for row in by_week[week]]
        value = statistic(sample)
        if value is not None:
            stats.append(value)
    if len(stats) < iterations * 0.8:
        return None
    stats.sort()
    low = stats[max(0, int(0.025 * len(stats)) - 1)]
    high = stats[min(len(stats) - 1, int(0.975 * len(stats)))]
    return [low, high]


# ---------------------------------------------------------------------------
# Analyses
# ---------------------------------------------------------------------------

def _zscores(values):
    mu = _mean(values)
    variance = sum((v - mu) ** 2 for v in values) / len(values)
    sd = math.sqrt(variance)
    if sd == 0:
        return [0.0] * len(values)
    return [(v - mu) / sd for v in values]


def correlation_test(rows, signal):
    """Raw and form-controlled correlations of `signal` vs next-week points."""
    usable = [row for row in rows if row.get(signal) is not None]
    x = [row[signal] for row in usable]
    y = [row["pts"] for row in usable]
    z = [row["form"] for row in usable]
    ci = week_cluster_bootstrap_ci(
        usable,
        lambda subset: partial_pearson(
            [row[signal] for row in subset],
            [row["pts"] for row in subset],
            [row["form"] for row in subset],
        ),
    )
    return {
        "n": len(usable),
        "rawPearson": pearson(x, y),
        "partialPearsonGivenForm": partial_pearson(x, y, z),
        "partialPearsonCI95": ci,
    }


def rank_utility_test(rows, signal):
    """Does SOS improve next-week rankings over form alone?

    Paired per (position, week): baseline ranks by form; treatment ranks by
    z(form) + z(signal) (higher FPA = friendlier matchup = boost). Reports the
    top-N hit rate against the actual top N for both rankings plus within-pool
    Spearman.
    """
    groups = defaultdict(list)
    for row in rows:
        if row.get(signal) is not None:
            groups[(row["position"], row["week"])].append(row)

    deltas = []
    positive_pairs = 0
    baseline_spearmans = []
    treatment_spearmans = []
    for _key, members in sorted(groups.items(), key=lambda item: str(item[0])):
        if len(members) < RANK_UTILITY_MIN_POOL:
            continue
        form_z = _zscores([member["form"] for member in members])
        signal_z = _zscores([member[signal] for member in members])
        treatment_scores = [f + s for f, s in zip(form_z, signal_z)]
        actual_top = {
            id(member) for member in sorted(members, key=lambda member: -member["pts"])[:RANK_UTILITY_TOP_N]
        }

        def top_hit(scores):
            ranked = sorted(zip(scores, members), key=lambda pair: -pair[0])
            hits = sum(1 for score, member in ranked[:RANK_UTILITY_TOP_N] if id(member) in actual_top)
            return hits / RANK_UTILITY_TOP_N

        baseline_hit = top_hit([member["form"] for member in members])
        treatment_hit = top_hit(treatment_scores)
        deltas.append(treatment_hit - baseline_hit)
        positive_pairs += treatment_hit > baseline_hit
        baseline_sp = spearman([member["form"] for member in members], [member["pts"] for member in members])
        treatment_sp = spearman(treatment_scores, [member["pts"] for member in members])
        # Tracked independently: a degenerate baseline (e.g. constant form) must not
        # erase the treatment's information.
        if baseline_sp is not None:
            baseline_spearmans.append(baseline_sp)
        if treatment_sp is not None:
            treatment_spearmans.append(treatment_sp)

    pairs = len(deltas)
    return {
        "pairs": pairs,
        "topN": RANK_UTILITY_TOP_N,
        "minPool": RANK_UTILITY_MIN_POOL,
        "meanHitRateDelta": _mean(deltas) if deltas else None,
        "sharePairsPositive": (positive_pairs / pairs) if pairs else None,
        "baselineMeanSpearman": _mean(baseline_spearmans) if baseline_spearmans else None,
        "treatmentMeanSpearman": _mean(treatment_spearmans) if treatment_spearmans else None,
    }


def stars_audit(stars_artifact, weekly_artifact):
    """Audit the currently displayed preseason FantasyPros SOS stars.

    Season-level stars, so the outcome is realized 2025 PPR points per game rather
    than next-week points. Quality is controlled with FantasyPros' own overall
    `rank` (lower = better player), entered as its negative so "better" points the
    same way along both variables. Star direction is not assumed a priori: the sign
    of the reported coefficient IS the discovered direction.
    """
    points_by_player = defaultdict(list)
    for row in load_player_weeks(weekly_artifact):
        points_by_player[row["playerId"]].append(row["pts"])

    sos_values, ppg_values, rank_values = [], [], []
    for player_id, entry in stars_artifact["players"].items():
        sos = entry.get("sos")
        overall_rank = entry.get("rank")
        if sos is None or overall_rank is None or player_id not in points_by_player:
            continue
        sos_values.append(sos)
        ppg_values.append(_mean(points_by_player[player_id]))
        rank_values.append(-overall_rank)

    return {
        "n": len(sos_values),
        "rawPearsonVsPpg": pearson(sos_values, ppg_values),
        "partialPearsonVsPpgGivenRank": partial_pearson(sos_values, ppg_values, rank_values),
    }


def evaluate_signal(rows, signal):
    result = {"signal": signal}
    result.update(correlation_test(rows, signal))
    result["rankUtility"] = rank_utility_test(rows, signal)
    return result


def passes_gate(correlation, rank_utility):
    """The pre-declared keep rule: both the correlation gate and the rank-utility
    gate must pass; anything else cuts."""
    partial_r = correlation["partialPearsonGivenForm"]
    ci = correlation["partialPearsonCI95"]
    if partial_r is None or abs(partial_r) < CUT_ABS_PARTIAL_R:
        return False
    if ci is None or ci[0] <= 0 <= ci[1]:
        return False
    delta = rank_utility["meanHitRateDelta"]
    share = rank_utility["sharePairsPositive"]
    if delta is None or share is None:
        return False
    return delta > 0 and share >= RANK_UTILITY_MIN_SHARE_POSITIVE


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def _fmt(value, digits=4):
    if isinstance(value, (list, tuple)):
        return ", ".join(_fmt(item, digits) for item in value)
    return "n/a" if value is None else f"{value:.{digits}f}"


def write_report(results, stars, verdict, report_json_path, report_md_path):
    payload = {
        "preDeclaredRule": {
            "cutIf": "|partial r| < 0.05 OR 95% week-cluster bootstrap CI crosses 0",
            "rankUtilityCutIf": "not (mean top-12 hit-rate delta > 0 AND share of positive pairs >= 0.6)",
            "keepOnlyIfBothPass": True,
        },
        "signals": results,
        "fantasyprosStarsAudit": stars,
        "verdict": verdict,
    }
    report_json_path.parent.mkdir(parents=True, exist_ok=True)
    report_json_path.write_text(json.dumps(payload, indent=2) + "\n")

    lines = [
        "# Early-window SOS validation (2025 outcomes)",
        "",
        "**Pre-declared rule:** cut if |partial r| < 0.05 or the 95% week-cluster bootstrap CI "
        "crosses 0; cut unless the top-12 hit-rate delta is positive with >= 60% of "
        "position-week pairs positive. KEEP only if both pass.",
        "",
        "## Windowed opponent-FPA signals (next-week PPR points, form-controlled)",
        "",
        "| Signal | n | raw r | partial r (given form) | 95% CI | top-12 hit-rate delta | share pairs positive |",
        "|---|---|---|---|---|---|---|",
    ]
    for result in results:
        ru = result["rankUtility"]
        lines.append(
            f"| {result['signal']} | {result['n']} | {_fmt(result['rawPearson'])} | "
            f"{_fmt(result['partialPearsonGivenForm'])} | {_fmt(result['partialPearsonCI95'])} | "
            f"{_fmt(ru['meanHitRateDelta'])} | {_fmt(ru['sharePairsPositive'])} |"
        )
    baseline_sp = results[0]["rankUtility"]["baselineMeanSpearman"]
    best_treatment = max(
        (result["rankUtility"]["treatmentMeanSpearman"] or float("-inf")) for result in results
    )
    lines += [
        "",
        f"Baseline mean within-pool Spearman (form only): {_fmt(baseline_sp)}; "
        f"best treatment: {_fmt(best_treatment)}.",
        "",
        "## FantasyPros SOS stars (currently displayed)",
        "",
        f"- n = {stars['n']}",
        f"- raw r vs season PPG: {_fmt(stars['rawPearsonVsPpg'])}",
        f"- partial r vs season PPG (given overall rank): {_fmt(stars['partialPearsonVsPpgGivenRank'])}",
        "- Sign reveals direction; magnitude judged against the same 0.05 bar.",
        "",
        f"## Verdict: **{verdict}**",
        "",
        "Limitations: single season (2025), ~14 independent prediction weeks, FPA derived from "
        "the same feed it predicts (trailing windows prevent leakage, not shared-source bias). "
        "A null here justifies cutting because the burden of proof is on SOS.",
        "",
    ]
    report_md_path.write_text("\n".join(lines))


def decide_verdict(results):
    """KEEP only when the pre-declared primary gate (sos_3w) passes both halves."""
    primary = next(result for result in results if result["signal"] == "sos_3w")
    return "KEEP" if passes_gate(primary, primary["rankUtility"]) else "CUT"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    weekly_artifact = json.loads((REPO_ROOT / "data" / "weekly-stats.json").read_text())
    stars_artifact = json.loads((REPO_ROOT / "data" / "fantasypros-stars.json").read_text())

    rows = build_prediction_rows(weekly_artifact)
    results = [
        evaluate_signal(rows, signal)
        for signal in ["sos_1w", "sos_3w", "sos_5w", SEASON_SIGNAL]
    ]
    stars = stars_audit(stars_artifact, weekly_artifact)
    verdict = decide_verdict(results)

    stamp = "2026-08-23"
    reports_dir = REPO_ROOT / "benchmarks" / "reports"
    write_report(
        results,
        stars,
        verdict,
        reports_dir / f"{stamp}-sos-validation.json",
        reports_dir / f"{stamp}-sos-validation.md",
    )

    print(f"sos validation verdict: {verdict}")
    for result in results:
        print(
            f"  {result['signal']}: n={result['n']} partial_r={_fmt(result['partialPearsonGivenForm'])}"
            f" ci=[{_fmt(result['partialPearsonCI95'])}]"
            f" rank_delta={_fmt(result['rankUtility']['meanHitRateDelta'])}"
            f" share_pos={_fmt(result['rankUtility']['sharePairsPositive'], 3)}"
        )
    print(f"  fantasypros stars: n={stars['n']} partial_r={_fmt(stars['partialPearsonVsPpgGivenRank'])}")


if __name__ == "__main__":
    main()
