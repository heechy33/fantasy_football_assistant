"""C1 gating-run stratification diagnostics (follow-up to the 2026-08-22 sim-sort/c1 entries).

Question: is C1's informational edge over the production engine uniform across draft
slots, or concentrated? The committed gating run's `perDraftMeanWeekly` arrays are
slot-major (`backtest.ts`: outer loop over slots 1..12, inner over seedIndex 0..83),
so per-slot paired differences are recoverable offline without a rerun.

Computed here:
1. Overall paired diffs: c1-engine, engine-b1, c1-b1 (reproduces the report's CIs as
   a self-check).
2. Per-slot c1-engine paired mean diff + 95% t-CI (n=84 per slot).
3. Monotonicity check: per-slot means vs slot number.
4. Per-slot engine-b1 (the "engine worse than plain ADP" finding, stratified).

Not computed here (needs per-pick data, not committed): position-level (K/TE/DEF)
attribution of C1's coverage gain. That requires an instrumented rerun.

Usage: python pipeline/analyze_c1_gating.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REPORTS = REPO / "benchmarks" / "reports"
GATING_PATH = REPORTS / "2026-08-23-historical-backtest-2025.json"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def t_ci95(values: list[float]) -> tuple[float, float]:
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / (n - 1)
    se = math.sqrt(var / n)
    # t_{0.975, df}: df>=100 -> 1.984; explicit small-df table like analyze_blend_pilot.
    t = {30: 2.042, 60: 2.000, 120: 1.980}.get(n - 1, 1.97)
    return mean - t * se, mean + t * se


def spearman(xs: list[float], ys: list[float]) -> float:
    def ranks(vs: list[float]) -> list[float]:
        order = sorted(range(len(vs)), key=lambda i: vs[i])
        r = [0.0] * len(vs)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and vs[order[j + 1]] == vs[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r

    rx, ry = ranks(xs), ranks(ys)
    n = len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return num / den if den else float("nan")


def main() -> int:
    if not GATING_PATH.exists():
        print(f"[abort] missing {GATING_PATH.name}")
        return 2
    run = load(GATING_PATH)
    meta = run["metadata"]
    slots, seeds = meta["slots"], meta["seedCount"]
    pdmw = run["perDraftMeanWeekly"]
    for arm in ("engine", "c1", "b1"):
        assert len(pdmw[arm]) == slots * seeds, f"{arm}: unexpected length"

    def cell(arm: str, slot: int, seed_index: int) -> float:
        return pdmw[arm][(slot - 1) * seeds + seed_index]

    out: dict = {
        "report": "c1-gating-stratification",
        "source": GATING_PATH.name,
        "slots": slots,
        "seedsPerSlot": seeds,
        "pairedOverall": {},
        "perSlotC1MinusEngine": [],
        "perSlotEngineMinusB1": [],
    }

    def overall(a: str, b: str) -> dict:
        diffs = [cell(a, s, i) - cell(b, s, i)
                 for s in range(1, slots + 1) for i in range(seeds)]
        lo, hi = t_ci95(diffs)
        d = {"comparison": f"{a}-{b}", "n": len(diffs), "meanDiff": sum(diffs) / len(diffs),
             "ciLower": lo, "ciUpper": hi}
        out["pairedOverall"][f"{a}-vs-{b}"] = d
        print(f"[overall] {a}-{b}: mean {d['meanDiff']:+.3f}, "
              f"95% CI [{lo:+.3f}, {hi:+.3f}] (n={len(diffs)})")
        return d

    # Self-check: must reproduce the committed gating report's c1-engine mean exactly;
    # otherwise the slot-major ordering assumption is broken and everything below is void.
    c1_engine = overall("c1", "engine")
    assert abs(c1_engine["meanDiff"] - 0.768) < 5e-4, \
        "c1-engine mean does not reproduce the gating report — array ordering assumption broken"
    overall("engine", "b1")  # recomputed here; the gating report md carries no engine-vs-b1 CI
    overall("c1", "b1")

    for label, a, b, key in (("c1-engine", "c1", "engine", "perSlotC1MinusEngine"),
                             ("engine-b1", "engine", "b1", "perSlotEngineMinusB1")):
        rows = []
        for s in range(1, slots + 1):
            diffs = [cell(a, s, i) - cell(b, s, i) for i in range(seeds)]
            lo, hi = t_ci95(diffs)
            rows.append({"slot": s, "n": seeds, "meanDiff": sum(diffs) / seeds,
                         "ciLower": lo, "ciUpper": hi,
                         "significantAt95": lo > 0 or hi < 0})
        out[key] = rows
        sig = [r["slot"] for r in rows if r["significantAt95"]]
        pos = [r["slot"] for r in rows if r["meanDiff"] > 0]
        print(f"\n[{label}] per-slot mean diff (pts/wk), n={seeds}/slot:")
        for r in rows:
            star = "*" if r["significantAt95"] else " "
            print(f"  slot {r['slot']:>2}: {r['meanDiff']:+7.3f}  "
                  f"[{r['ciLower']:+7.3f}, {r['ciUpper']:+7.3f}] {star}")
        means = [r["meanDiff"] for r in rows]
        rho = spearman([float(s) for s in range(1, slots + 1)], means)
        runs_down = sum(1 for i in range(len(means) - 1) if means[i + 1] < means[i])
        print(f"  positive slots: {len(pos)}/{slots}; individually significant at 95%: {sig or 'none'}")
        print(f"  Spearman(slot, meanDiff)={rho:+.3f}; "
              f"downward steps in slot sequence: {runs_down}/{slots - 1}")

    out["monotonicityC1MinusEngine"] = {
        "spearmanSlotVsMeanDiff": spearman(
            [float(s) for s in range(1, slots + 1)],
            [r["meanDiff"] for r in out["perSlotC1MinusEngine"]]),
        "downwardSteps": sum(1 for i in range(slots - 1)
                             if out["perSlotC1MinusEngine"][i + 1]["meanDiff"]
                             < out["perSlotC1MinusEngine"][i]["meanDiff"]),
    }
    dest = REPORTS / "2026-08-24-c1-gating-stratification.json"
    dest.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"[written] {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

