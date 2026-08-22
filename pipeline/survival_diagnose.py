"""Phase 2a survival-curve diagnostics over FFC's observed ADP distribution.

The production availability model (frontend/src/engine/availability.ts) is a
normal-CDF survival: P(available at pick) = 1 - Phi((pick - adp) / stdev). For
Sleeper/ESPN boards, `stdev` is synthesized by transform.fitted_stdev from FFC
coefficient-of-variation bands, because those sources publish no dispersion.
FFC's per-player ADP feed is the only observed human draft-position
distribution obtainable pre-draft, so it is the place to check the two
load-bearing assumptions behind that synthesis:

H1 (kernel skew): under a normal model, the sample min/max are symmetric about
the mean, so (adp - high) and (low - adp) are equal in expectation. A
systematic asymmetry by ADP band means the normal CDF is the wrong kernel. The
same fields also expose a range-consistency check: for n = times_drafted
normal samples, E[max - min] = d2(n) * stdev, where d2 is the unbiasing
constant for the sample range.

H2 (heterogeneity): fitted_stdev assigns every player in an ADP band the same
CV. If observed per-player CV varies a lot within a band, the band average is
flattening real structure and the fix is to carry each player's observed CV
ratio onto non-FFC (Sleeper/ESPN) adp means instead of a band constant.

Right-censoring check (added after the first pass of this diagnosis flagged a
false positive): FFC's feed is drawn from a fixed-length mock (`meta.teams *
meta.rounds` picks, e.g. 180 for a 12-team/15-round board). A player's `low`
(latest pick observed) cannot exceed that ceiling even if the player would
realistically go later in an unlimited draft, and a player rarely drafted at
all (small `times_drafted`) has its `low` set by whichever few mocks happened
to draft it, biasing it toward the edge of the observed window. Both effects
shrink the *reported* right tail for deep-ADP players without reflecting any
real drafting behavior. Verified on the live 2026 PPR feed: naively pooling
H1's tail asymmetry over the deep-ADP band showed the *left* tail longer
("reaches dominate"), but restricting to players whose `low` sits comfortably
below the ceiling flips that back to right-tail-longer (or roughly
symmetric), consistent with every shallower band. `right_censoring` and
`h1_tail_asymmetry_excluding_censored` exist to make that check part of the
report instead of a one-off finding, so H1's eventual kernel choice is fit
against the corrected picture, not the ceiling artifact.

FFC field semantics (verified against the live 2026 feed, all 264 rows):
`high` is the earliest pick number observed (smallest number), `low` is the
latest (largest number), and high <= adp <= low on every row. So the left tail
length = adp - high and the right tail length = low - adp. FFC labels the
earliest pick "high" because it is the highest draft *position*.

Pure functions only (no I/O), following transform.py's convention; the CLI
main() at the bottom owns file I/O. Tests live in test_survival_diagnose.py.
"""

from __future__ import annotations

import json
import math
import statistics
import sys
from pathlib import Path
from typing import Any

from transform import _DEFAULT_ADP_CV_BANDS, fitted_stdev

# Standard normal object used for exact range expectations (Wichura's AS241
# via statistics.NormalDist - stdlib, no numpy dependency).
_ND = statistics.NormalDist()

# n above which (1 - Phi(x)) ** n underflows to 0.0, which is harmless for the
# range integral below (the integrand is ~1 - Phi(x)^n over the support).
_BIG_N = 2000


def expected_range_factor(n: int) -> float | None:
    """E[(max - min) / sigma] for n iid standard normals; None when n < 2.

    Uses the identity E[range] = 2 * int_0^inf (1 - Phi(x)^n - (1-Phi(x))^n) dx
    integrated with Simpson's rule over an n-dependent support (the integrand
    is concentrated near x ~ sqrt(2 ln n), decaying rapidly beyond).
    """
    if not isinstance(n, int) or n < 2:
        return None
    upper = 8.0 + 1.2 * math.sqrt(2.0 * math.log(float(n)))
    step = 0.02
    total = 0.0
    x = 0.0
    while x < upper:
        total += _range_integrand(x, n) + 4.0 * _range_integrand(x + step / 2.0, n) + _range_integrand(x + step, n)
        x += step
    return (total * step / 6.0) * 2.0


def _range_integrand(x: float, n: int) -> float:
    c = _ND.cdf(x)
    c_n = c ** n if n <= _BIG_N else 0.0 if c < 1.0 else 1.0
    one_minus = (1.0 - c) ** n if n <= _BIG_N else 0.0
    return 1.0 - c_n - one_minus


def band_of(adp: float, cv_bands: tuple[tuple[float, float], ...] = _DEFAULT_ADP_CV_BANDS) -> float:
    """Upper edge of the band `adp` falls in, per transform.fitted_stdev's lookup."""
    for upper, _cv in cv_bands:
        if adp < upper:
            return upper
    return float("inf")


def band_label(upper: float) -> str:
    return f"<={upper:g}" if math.isfinite(upper) else "deep tail"


def _usable(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Players whose four dispersion fields are present and coherent."""
    out: list[dict[str, Any]] = []
    for p in players:
        try:
            adp = float(p.get("adp"))
            stdev = float(p.get("stdev", 0.0))
            high = float(p.get("high"))
            low = float(p.get("low"))
            n = int(p.get("times_drafted", 0))
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(adp) and math.isfinite(stdev) and math.isfinite(high) and math.isfinite(low)):
            continue
        if not (adp > 0 and stdev > 0 and high <= adp <= low and n >= 2):
            continue
        out.append({**p, "_adp": adp, "_stdev": stdev, "_high": high, "_low": low, "_n": n})
    return out


def _percentile(values: list[float], q: float) -> float:
    """Linear-interpolation percentile on a sorted copy."""
    vals = sorted(values)
    if not vals:
        return 0.0
    if len(vals) == 1:
        return vals[0]
    idx = (len(vals) - 1) * q
    lo = int(idx)
    hi = min(lo + 1, len(vals) - 1)
    frac = idx - lo
    return vals[lo] * (1.0 - frac) + vals[hi] * frac


def _summarize_band(group: list[dict[str, Any]], band_cv: float | None) -> dict[str, Any]:
    """Roll one band's rows into report stats. Fields present depend on which
    test produced the rows (H1 asymmetry vs H1 range vs H2 CV)."""
    summary: dict[str, Any] = {"n": len(group)}
    if "left" in group[0]:
        left = [g["left"] for g in group]
        right = [g["right"] for g in group]
        asym = [l - r for l, r in zip(left, right)]
        summary.update(
            {
                "meanLeftTail": round(statistics.mean(left), 2),
                "meanRightTail": round(statistics.mean(right), 2),
                "meanAsymmetryLeftMinusRight": round(statistics.mean(asym), 2),
                "leftLongerFraction": round(sum(1 for a in asym if a > 0) / len(asym), 3),
            }
        )
        if "high" in group[0]:
            summary["leftTailCappedAtPickOneFraction"] = round(sum(1 for g in group if g["high"] == 1) / len(group), 3)
    if "ratio" in group[0]:
        ratios = [g["ratio"] for g in group]
        summary["medianRatio"] = round(statistics.median(ratios), 3)
        summary["meanRatio"] = round(statistics.mean(ratios), 3)
        summary["fractionBelow0.8"] = round(sum(1 for r in ratios if r < 0.8) / len(ratios), 3)
        summary["fractionAbove1.2"] = round(sum(1 for r in ratios if r > 1.2) / len(ratios), 3)
    if "cv" in group[0]:
        cvs = [g["cv"] for g in group]
        p10, p90 = _percentile(cvs, 0.10), _percentile(cvs, 0.90)
        summary["medianObservedCv"] = round(statistics.median(cvs), 3)
        summary["p10ObservedCv"] = round(p10, 3)
        summary["p90ObservedCv"] = round(p90, 3)
        summary["spreadP90OverP10"] = round(p90 / p10, 2) if p10 > 0 else None
        summary["bandCvIsRepresentative"] = bool(band_cv is not None and p10 <= band_cv <= p90)
        if band_cv is not None:
            summary["farFromBandCvFraction"] = round(
                sum(1 for g in group if g["cv"] < 0.5 * band_cv or g["cv"] > 2.0 * band_cv) / len(group), 3
            )
            summary["bandCv"] = round(band_cv, 4)
        fitted = [g["stdev"] / g["fittedStdev"] for g in group if g.get("fittedStdev", 0) > 0]
        if fitted:
            summary["meanObservedOverFittedStdev"] = round(statistics.mean(fitted), 3)
    return summary


def h1_tail_asymmetry(players: list[dict[str, Any]], cv_bands: tuple[tuple[float, float], ...] = _DEFAULT_ADP_CV_BANDS) -> dict[str, Any]:
    """(adp - high) vs (low - adp) by ADP band - kernel-skew test."""
    grouped: dict[float, list[dict[str, Any]]] = {}
    for p in _usable(players):
        left = p["_adp"] - p["_high"]
        right = p["_low"] - p["_adp"]
        grouped.setdefault(band_of(p["_adp"], cv_bands), []).append(
            {"left": left, "right": right, "high": p["_high"], "adp": p["_adp"]}
        )
    bands = {band_label(u): _summarize_band(v, None) for u, v in sorted(grouped.items(), key=lambda kv: kv[0])}
    pooled = _summarize_band([g for v in grouped.values() for g in v], None)
    return {"pooled": pooled, "byBand": bands}


def right_censoring(
    players: list[dict[str, Any]],
    max_pick: int,
    ceiling_margin: int = 10,
    cv_bands: tuple[tuple[float, float], ...] = _DEFAULT_ADP_CV_BANDS,
) -> dict[str, Any]:
    """Per-ADP-band count/fraction of players whose observed `low` sits at or
    near the mock's fixed length (`max_pick`) - the right-tail-censoring
    signal that can masquerade as real left-skew in H1. `atCeiling` uses
    margin 0 (`low >= max_pick`, mechanically impossible to have been
    observed falling further); `nearCeiling` allows `ceiling_margin` picks
    of slack, since a handful of drafts short of the exact ceiling is still
    evidence the true right tail wasn't fully observed.
    """
    grouped: dict[float, list[dict[str, Any]]] = {}
    for p in _usable(players):
        grouped.setdefault(band_of(p["_adp"], cv_bands), []).append(p)

    def _band_stats(group: list[dict[str, Any]]) -> dict[str, Any]:
        n = len(group)
        at = sum(1 for p in group if p["_low"] >= max_pick)
        near = sum(1 for p in group if p["_low"] >= max_pick - ceiling_margin)
        return {
            "n": n,
            "atCeilingCount": at,
            "atCeilingFraction": round(at / n, 3) if n else None,
            "nearCeilingCount": near,
            "nearCeilingFraction": round(near / n, 3) if n else None,
        }

    bands = {band_label(u): _band_stats(v) for u, v in sorted(grouped.items(), key=lambda kv: kv[0])}
    pooled = _band_stats([g for v in grouped.values() for g in v])
    return {"maxPick": max_pick, "ceilingMargin": ceiling_margin, "pooled": pooled, "byBand": bands}


def h1_tail_asymmetry_excluding_censored(
    players: list[dict[str, Any]],
    max_pick: int,
    ceiling_margin: int = 10,
    cv_bands: tuple[tuple[float, float], ...] = _DEFAULT_ADP_CV_BANDS,
) -> dict[str, Any]:
    """Same test as `h1_tail_asymmetry`, but drops any player whose `low`
    sits within `ceiling_margin` picks of the mock's length first - the
    direct check of whether a band's skew direction survives once the
    fixed-mock-length artifact is removed, rather than assuming it does."""
    kept = [p for p in _usable(players) if p["_low"] < max_pick - ceiling_margin]
    return h1_tail_asymmetry(kept, cv_bands)


def h1_range_consistency(players: list[dict[str, Any]], cv_bands: tuple[tuple[float, float], ...] = _DEFAULT_ADP_CV_BANDS) -> dict[str, Any]:
    """(low - high) vs d2(times_drafted) * stdev by ADP band - extremes test."""
    grouped: dict[float, list[dict[str, Any]]] = {}
    for p in _usable(players):
        d2 = expected_range_factor(p["_n"])
        if d2 is None:
            continue
        expected = d2 * p["_stdev"]
        if expected <= 0:
            continue
        ratio = (p["_low"] - p["_high"]) / expected
        grouped.setdefault(band_of(p["_adp"], cv_bands), []).append(
            {"ratio": ratio, "n": p["_n"], "observed": p["_low"] - p["_high"], "expected": expected}
        )
    bands = {band_label(u): _summarize_band(v, None) for u, v in sorted(grouped.items(), key=lambda kv: kv[0])}
    pooled = _summarize_band([g for v in grouped.values() for g in v], None)
    return {"pooled": pooled, "byBand": bands}


def h2_heterogeneity(players: list[dict[str, Any]], cv_bands: tuple[tuple[float, float], ...] = _DEFAULT_ADP_CV_BANDS) -> dict[str, Any]:
    """Observed per-player CV (stdev/adp) vs the band constant - flattening test."""
    grouped: dict[float, list[dict[str, Any]]] = {}
    for p in _usable(players):
        cv = p["_stdev"] / p["_adp"]
        grouped.setdefault(band_of(p["_adp"], cv_bands), []).append(
            {
                "cv": cv,
                "stdev": p["_stdev"],
                "fittedStdev": fitted_stdev(p["_adp"], cv_bands),
                "name": p.get("name"),
                "adp": p["_adp"],
            }
        )
    cv_by_band = dict(cv_bands)
    bands = {
        band_label(u): _summarize_band(v, cv_by_band.get(u))
        for u, v in sorted(grouped.items(), key=lambda kv: kv[0])
    }
    return {"byBand": bands}


def _censoring_artifact_bands(
    all_bands: dict[str, dict[str, Any]],
    excl_bands: dict[str, dict[str, Any]],
    censoring_bands: dict[str, dict[str, Any]],
    near_ceiling_threshold: float = 0.3,
) -> list[str]:
    """Bands where >= `near_ceiling_threshold` of players sit near the mock's
    length ceiling AND excluding them flips the asymmetry sign away from
    left-longer (or collapses it toward zero) - the direct signature of a
    censoring artifact rather than a real skew reversal."""
    flagged: list[str] = []
    for label, all_b in all_bands.items():
        near_frac = censoring_bands.get(label, {}).get("nearCeilingFraction")
        excl_b = excl_bands.get(label)
        if near_frac is None or near_frac < near_ceiling_threshold or excl_b is None:
            continue
        before = all_b.get("meanAsymmetryLeftMinusRight", 0.0)
        after = excl_b.get("meanAsymmetryLeftMinusRight", 0.0)
        if before > 1.0 and after <= 0.5:
            flagged.append(label)
    return flagged


def diagnose(
    players: list[dict[str, Any]],
    cv_bands: tuple[tuple[float, float], ...] = _DEFAULT_ADP_CV_BANDS,
    max_pick: int | None = None,
    ceiling_margin: int = 10,
) -> dict[str, Any]:
    """Run H1 + H2 and attach rule-based verdict flags (numbers only - the
    human-readable interpretation lives in the generated report). `max_pick`
    (the mock's teams * rounds) enables the right-censoring check that guards
    H1's deep-ADP verdict against the fixed-mock-length artifact documented
    at the top of this file; omit it only when the source's max pick is
    unknown, in which case that check is skipped rather than guessed at."""
    usable = _usable(players)
    report: dict[str, Any] = {
        "inputPlayers": len(players),
        "usablePlayers": len(usable),
        "h1TailAsymmetry": h1_tail_asymmetry(usable, cv_bands),
        "h1RangeConsistency": h1_range_consistency(usable, cv_bands),
        "h2Heterogeneity": h2_heterogeneity(usable, cv_bands),
    }
    h1 = report["h1TailAsymmetry"]["pooled"]
    rng = report["h1RangeConsistency"]["pooled"]
    verdicts: dict[str, Any] = {
        "h1Skew": bool(abs(h1["meanAsymmetryLeftMinusRight"]) > 1.0 or h1["leftLongerFraction"] < 0.45 or h1["leftLongerFraction"] > 0.55),
        "h1RangeInconsistentWithNormal": bool(rng.get("medianRatio") is not None and (rng["medianRatio"] < 0.8 or rng["medianRatio"] > 1.2)),
        "h2WithinBandHeterogeneity": any(
            b.get("spreadP90OverP10") is not None and b["spreadP90OverP10"] > 2.0
            for b in report["h2Heterogeneity"]["byBand"].values()
        ),
        "h2BandCvRepresentativeEverywhere": all(
            b.get("bandCvIsRepresentative", True) for b in report["h2Heterogeneity"]["byBand"].values()
        ),
    }

    if max_pick is not None:
        censoring = right_censoring(usable, max_pick, ceiling_margin, cv_bands)
        excl = h1_tail_asymmetry_excluding_censored(usable, max_pick, ceiling_margin, cv_bands)
        report["rightCensoring"] = censoring
        report["h1TailAsymmetryExcludingCensored"] = excl
        flagged_bands = _censoring_artifact_bands(
            report["h1TailAsymmetry"]["byBand"], excl["byBand"], censoring["byBand"]
        )
        verdicts["h1CensoringArtifactBands"] = flagged_bands
        verdicts["h1SkewSurvivesCensoringCheck"] = bool(verdicts["h1Skew"] and not flagged_bands)

    report["verdicts"] = verdicts
    return report


def format_markdown(report: dict[str, Any], meta: dict[str, Any] | None = None) -> str:
    lines: list[str] = []
    lines.append("# FFC observed-ADP survival-curve diagnosis (Phase 2a)")
    lines.append("")
    if meta:
        lines.append(f"- FFC PPR window: {meta.get('start_date')} -> {meta.get('end_date')} · "
                     f"{meta.get('total_drafts')} twelve-team mocks · {meta.get('rounds')} rounds")
    lines.append(f"- Players scored: {report['inputPlayers']} fetched, {report['usablePlayers']} with complete "
                 f"high/adp/low/stdev/times_drafted (n>=2).")
    lines.append("")

    lines.append("## H1 - tail skew by ADP band (normal => (adp-high) ~= (low-adp))")
    lines.append("")
    lines.append("| Band | n | mean (adp-high) | mean (low-adp) | mean asym (L-R) | L>R frac | high==1 frac |")
    lines.append("|---|---|---|---|---|---|---|")
    for label, b in [("pooled", report["h1TailAsymmetry"]["pooled"]), *report["h1TailAsymmetry"]["byBand"].items()]:
        lines.append(f"| {label} | {b['n']} | {b['meanLeftTail']} | {b['meanRightTail']} | "
                     f"{b['meanAsymmetryLeftMinusRight']} | {b['leftLongerFraction']} | "
                     f"{b.get('leftTailCappedAtPickOneFraction', 'n/a')} |")
    lines.append("")

    lines.append("## H1 - range vs normality (observed (low-high) vs d2(times_drafted)*stdev)")
    lines.append("")
    lines.append("| Band | n | median ratio | mean ratio | frac <0.8 | frac >1.2 |")
    lines.append("|---|---|---|---|---|---|")
    for label, b in [("pooled", report["h1RangeConsistency"]["pooled"]), *report["h1RangeConsistency"]["byBand"].items()]:
        lines.append(f"| {label} | {b['n']} | {b['medianRatio']} | {b['meanRatio']} | "
                     f"{b['fractionBelow0.8']} | {b['fractionAbove1.2']} |")
    lines.append("")

    lines.append("## H2 - per-player CV vs fitted_stdev band constant")
    lines.append("")
    lines.append("| Band | n | band CV | median obs CV | p10 | p90 | p90/p10 | band CV in [p10,p90] | far from band CV | mean obs/fitted stdev |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|")
    for label, b in report["h2Heterogeneity"]["byBand"].items():
        lines.append(f"| {label} | {b['n']} | {b.get('bandCv', 'n/a')} | {b['medianObservedCv']} | "
                     f"{b['p10ObservedCv']} | {b['p90ObservedCv']} | {b.get('spreadP90OverP10', 'n/a')} | "
                     f"{'yes' if b.get('bandCvIsRepresentative') else 'NO'} | {b.get('farFromBandCvFraction', 'n/a')} | "
                     f"{b.get('meanObservedOverFittedStdev', 'n/a')} |")
    lines.append("")

    if "rightCensoring" in report:
        rc = report["rightCensoring"]
        lines.append(f"## Right-censoring check (mock length ceiling = {rc['maxPick']} picks, "
                     f"near-ceiling margin = {rc['ceilingMargin']} picks)")
        lines.append("")
        lines.append("A player's `low` cannot exceed the mock's fixed length even if the true right "
                     "tail extends further, and a rarely-drafted player's `low` is a max over a small, "
                     "biased sample. Both artificially shrink the observed right tail for deep-ADP "
                     "players. This section checks whether H1's asymmetry survives once those rows "
                     "are excluded, rather than assuming it does.")
        lines.append("")
        lines.append("| Band | n | at ceiling | near ceiling | asym incl. censored | asym excl. censored |")
        lines.append("|---|---|---|---|---|---|")
        excl_bands = report.get("h1TailAsymmetryExcludingCensored", {}).get("byBand", {})
        all_bands = report["h1TailAsymmetry"]["byBand"]
        for label, cb in [("pooled", rc["pooled"]), *rc["byBand"].items()]:
            all_asym = (report["h1TailAsymmetry"]["pooled"] if label == "pooled" else all_bands.get(label, {})).get("meanAsymmetryLeftMinusRight", "n/a")
            excl_entry = report.get("h1TailAsymmetryExcludingCensored", {}).get("pooled") if label == "pooled" else excl_bands.get(label)
            excl_asym = excl_entry.get("meanAsymmetryLeftMinusRight", "n/a") if excl_entry else "n/a (all censored)"
            lines.append(f"| {label} | {cb['n']} | {cb['atCeilingFraction']} | {cb['nearCeilingFraction']} | "
                         f"{all_asym} | {excl_asym} |")
        lines.append("")
        flagged = report["verdicts"].get("h1CensoringArtifactBands", [])
        if flagged:
            lines.append(f"**Flagged as a likely censoring artifact:** {', '.join(flagged)} — a large "
                         "fraction of these players sit near the mock's length ceiling, and excluding "
                         "them collapses or reverses the left-longer asymmetry. Do not encode this "
                         "band's raw asymmetry into a band-flipping H1 kernel without the exclusion.")
        else:
            lines.append("No band flagged as a censoring artifact under the current threshold.")
        lines.append("")

    v = report["verdicts"]
    lines.append("## Rule-based verdicts")
    lines.append("")
    lines.append(f"- H1 skew flagged: **{v['h1Skew']}**")
    if "h1SkewSurvivesCensoringCheck" in v:
        lines.append(f"- H1 skew survives the right-censoring check (not solely a mock-length artifact): "
                     f"**{v['h1SkewSurvivesCensoringCheck']}**")
        lines.append(f"- Bands flagged as censoring artifacts: **{v['h1CensoringArtifactBands'] or 'none'}**")
    lines.append(f"- H1 range inconsistent with normal extremes: **{v['h1RangeInconsistentWithNormal']}**")
    lines.append(f"- H2 within-band CV heterogeneity flagged: **{v['h2WithinBandHeterogeneity']}**")
    lines.append(f"- H2 band CV representative in every band: **{v['h2BandCvRepresentativeEverywhere']}**")
    lines.append("")
    lines.append("*Caveats: the top band's left tail is mechanically bounded by pick 1 "
                "(see `high==1 frac`); FFC `high/low` semantics are earliest/latest pick "
                "(verified on the live feed), so a range ratio well below 1.0 means either the "
                "reported extremes are not true min/max or the tails are thinner than normal. The "
                "right-censoring check above guards the *deep-ADP* band specifically — see the top of "
                "this file for why a fixed-length mock corrupts that band's apparent skew direction.*")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    fixture = Path(argv[0]) if argv else Path("fixtures/ffc/adp-ppr-observed.json")
    out_dir = Path(argv[1]) if len(argv) > 1 else None
    payload = json.loads(fixture.read_text(encoding="utf-8"))
    meta = payload.get("meta") if isinstance(payload, dict) else None
    players = payload["players"] if isinstance(payload, dict) else payload
    max_pick = None
    if meta and isinstance(meta.get("teams"), int) and isinstance(meta.get("rounds"), int):
        max_pick = meta["teams"] * meta["rounds"]
    report = diagnose(players, max_pick=max_pick)
    report["meta"] = meta
    md = format_markdown(report, meta)
    print(md)
    if out_dir:
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "2026-08-20-ffc-survival-diagnosis.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
        (out_dir / "2026-08-20-ffc-survival-diagnosis.md").write_text(md, encoding="utf-8")
        print(f"\nWrote JSON + MD to {out_dir}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())




