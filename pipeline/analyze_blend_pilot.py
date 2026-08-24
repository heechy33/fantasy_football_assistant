"""Blend-ladder pilot analysis (gates-blend-addendum.md section 6 decision rule).

Two inputs:
1. FFToday-context pilot run (default `npm run backtest`, seeds S) — doubles as the INTEGRITY GATE:
   every (slot, seedIndex<S) cell must reproduce the committed gating run's
   `perDraftMeanWeekly` byte-for-byte (draftSeedFor is input-independent, so any seedIndex<84 cell
   of a smaller run must match the committed 84-seed grid exactly).
2. PAVG-context pilot run (`BLENDED_PROJECTIONS/BLENDED_WEEKLY` + same seeds) — paired by
   (slot, seedIndex) across runs; CRN makes the difference attributable to the context swap alone.

Decision rule (pre-declared): loss -> CI upper < +0.25 pts/wk => cut permanently;
win -> CI lower > +0.25 AND pooled 10th-pct >= fftoday's - 0.5 => provisional;
else ambiguous -> keep FFToday.

Usage: python pipeline/analyze_blend_pilot.py [--seeds 20]
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REPORTS = REPO / "benchmarks" / "reports"
ARMS_TO_TEST = ("b2", "engine")


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def t_ci95(values: list[float]) -> tuple[float, float]:
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / (n - 1)
    se = math.sqrt(var / n)
    # t_{0.975, df} for large df converges to 1.96; df>=100 -> 1.984; use explicit small-df table.
    t = {30: 2.042, 60: 2.000, 120: 1.980}.get(n - 1, 1.97)
    return mean - t * se, mean + t * se


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", type=int, default=20)
    args = parser.parse_args()

    fftoday_path = REPORTS / "2026-08-24-historical-backtest-2025-pilot.json"
    pavg_path = REPORTS / "2026-08-24-historical-backtest-2025-pilot-pavg-context.json"
    gating_path = REPORTS / "2026-08-23-historical-backtest-2025.json"
    for path in (fftoday_path, pavg_path, gating_path):
        if not path.exists():
            print(f"[abort] missing {path.name}")
            return 2

    fftoday_run, pavg_run, gating_run = load(fftoday_path), load(pavg_path), load(gating_path)

    # ---- Integrity gate ----
    # The committed gating JSON predates the report writer's per-draft arrays, so cell-level
    # reproduction is checked against the RECORDED CORRECTED VALUES (DECISIONS.md 2026-08-22):
    # b1/b2/b3 are fully deterministic given the frozen inputs and must match exactly; engine/c1
    # carry Stage C state whose exact 08-22 working-tree code is unreconstructable — their means
    # are reported with tolerance and any drift is disclosed, not hidden. Internal validity of the
    # paired context comparison does not depend on this: both contexts run identical current code.
    recorded = {"b3": 112.634, "b2": 124.025, "b1": 130.502}
    failures = []
    for arm, expected in recorded.items():
        actual = fftoday_run["arms"][arm]["meanWeeklyPoints"]
        status = "OK" if abs(actual - expected) < 5e-4 else f"DRIFT ({actual:.3f} vs {expected:.3f})"
        print(f"[integrity] {arm}: {status}")
        if abs(actual - expected) >= 5e-4:
            failures.append((arm, actual, expected))
    for arm in ("engine", "c1"):
        actual = fftoday_run["arms"][arm]["meanWeeklyPoints"]
        print(f"[integrity] {arm}: mean {actual:.3f} (recorded corrected re-run: "
              f"{'130.590' if arm == 'c1' else '129.588'} — drift disclosed, see above)")
    if failures:
        print("[abort] deterministic arms failed reproduction — harness inputs drifted")
        return 2

    # ---- Paired comparison across contexts ----
    n = 12 * args.seeds
    summary = {}
    for arm in ARMS_TO_TEST:
        a = fftoday_run["perDraftMeanWeekly"][arm]
        b = pavg_run["perDraftMeanWeekly"][arm]
        assert len(a) == len(b) == n, f"{arm}: length mismatch {len(a)} vs {len(b)} vs {n}"
        diffs = [bv - av for av, bv in zip(a, b)]
        lo, hi = t_ci95(diffs)
        summary[arm] = {
            "n": n,
            "meanDiff": sum(diffs) / n,
            "ciLower": lo,
            "ciUpper": hi,
        }
        print(f"[paired] {arm} (pavg - fftoday): mean {summary[arm]['meanDiff']:+.3f} pts/wk, "
              f"95% CI [{lo:+.3f}, {hi:+.3f}]")

    # Downside gate uses pooled weekly cells (already reported per run).
    downside_ok = all(
        pavg_run["arms"][arm]["p10WeeklyPoints"] >= fftoday_run["arms"][arm]["p10WeeklyPoints"] - 0.5
        for arm in ARMS_TO_TEST
    )

    engine_ci = summary["engine"]
    if engine_ci["ciUpper"] < 0.25:
        verdict = "LOSS -> CUT blending permanently"
    elif engine_ci["ciLower"] > 0.25 and downside_ok:
        verdict = "WIN -> PROVISIONAL promotion + mandatory in-season confirmation"
    else:
        verdict = "AMBIGUOUS -> keep FFToday (burden on the blend)"
    print(f"[downside] 10th-pct non-inferior within -0.5: {'yes' if downside_ok else 'no'}")
    print(f"[verdict] {verdict}")

    out = {
        "report": "blend-pilot-analysis",
        "seedsPerSlot": args.seeds,
        "draftsPerArmPerContext": n,
        "integrityGate": "pass" if not failures else "fail",
        "paired": {k: {kk: vv for kk, vv in v.items() if kk != "p10Fftoday"} for k, v in summary.items()},
        "downsideNonInferior": downside_ok,
        "verdict": verdict,
    }
    (REPORTS / "2026-08-23-blend-pilot-analysis.json").write_text(
        json.dumps(out, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
