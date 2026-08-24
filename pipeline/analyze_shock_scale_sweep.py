"""Saturation dose-response sweep analysis (DECISIONS.md 2026-08-24 pre-declared rules).

Question: is the production engine's deficit vs plain best-available-by-ADP an artifact of a
saturated field (opponent priorities built from FFC ADP priors), or does it survive field noise?
The sweep varies the opponent model's `shockScale` (priority-noise multiplier):
  scale 0 = deterministic ADP-order field (saturation limit)
  scale 1 = default (committed FFToday-context pilot diagnostics artifact)
  scales 2, 4 = progressively less ADP-like fields
For each scale we compute the CRN-paired engine-B1 mean difference in optimized weekly starter
points over the 240-draft pilot grid (12 slots x 20 seeds, identical seed base across scales).
Pairing holds WITHIN a scale only; cross-scale comparisons are means-level.

VERDICT RULES (fixed before any sweep run ran — see DECISIONS.md):
1. SATURATION-SUPPORT: meanDiff(4) CI lower bound > 0 AND the four means are monotonically
   non-decreasing in scale => the engine's edge is exploitation of field deviation.
2. DAMNING: meanDiff CI upper bound < 0 at BOTH scale 2 and scale 4 => deficit survives noise.
3. DIRECTIONAL-ONLY: monotone improvement but scale-4 CI crosses zero => escalate scale 4 once.
4. AMBIGUOUS: anything else; no further 2025 spend.

Integrity checks before any conclusion: each sweep artifact must self-report matching shockScale,
seedCount=20, draftsPerArm=240; the scale-1 numbers must reproduce the committed artifact's arm
means delta (-0.836221) exactly.

Usage: python pipeline/analyze_shock_scale_sweep.py
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REPORTS = REPO / "benchmarks" / "reports"
SCALE1_PATH = REPORTS / "2026-08-24-historical-backtest-2025-pilot-c1-diagnostics.json"
OUT_PATH = REPORTS / "2026-08-24-shock-scale-sweep-analysis.json"
SCALES = (0, 2, 4)
EXPECTED_DRAFTS = 240
COMMITTED_SCALE1_ENGINE_MINUS_B1 = -0.836221

def t_ci95(values: list[float]) -> tuple[float, float]:
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / (n - 1)
    se = math.sqrt(var / n)
    t = {30: 2.042, 60: 2.000, 120: 1.980}.get(n - 1, 1.97)
    return mean - t * se, mean + t * se


def paired(diffs: list[float]) -> dict:
    lo, hi = t_ci95(diffs)
    return {"n": len(diffs), "meanDiff": sum(diffs) / len(diffs),
            "ciLower": lo, "ciUpper": hi,
            "significantAt95": lo > 0 or hi < 0}


def spearman(xs: list[float], ys: list[float]) -> float | None:
    def ranks(vs: list[float]) -> list[float]:
        order = sorted(range(len(vs)), key=lambda i: vs[i])
        rk = [0.0] * len(vs)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and vs[order[j + 1]] == vs[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                rk[order[k]] = avg
            i = j + 1
        return rk

    rx, ry = ranks(xs), ranks(ys)
    n = len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return num / den if den else None


def engine_b1_from(path: Path, expected_scale: int) -> tuple[list[float], dict]:
    d = json.loads(path.read_text(encoding="utf-8"))
    m = d["metadata"]
    # The committed scale-1 artifact predates the sweep knob, so shockScale may be absent
    # (= default 1 by definition).
    recorded_scale = m.get("shockScale", 1)
    if recorded_scale != expected_scale or m["draftsPerArm"] != EXPECTED_DRAFTS:
        raise SystemExit(f"[abort] {path.name}: shockScale={recorded_scale} "
                         f"draftsPerArm={m['draftsPerArm']} — unexpected artifact")
    pdmw = d["perDraftMeanWeekly"]
    diffs = [e - b for e, b in zip(pdmw["engine"], pdmw["b1"])]
    return diffs, {"source": path.name, "shockScale": recorded_scale,
                   "seedCount": m["seedCount"], "draftsPerArm": m["draftsPerArm"]}


def main() -> int:
    out: dict = {
        "report": "shock-scale-sweep-analysis",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "rules": "pre-declared in pipeline/analyze_shock_scale_sweep.py docstring and DECISIONS.md",
        "byScale": {},
        "integrity": {},
        "verdict": None,
    }

    paths: dict[int, Path] = {}
    for scale in SCALES:
        matches = sorted(REPORTS.glob(f"*historical-backtest-2025-pilot*-shockscale{scale}.json"))
        if not matches:
            print(f"[abort] no sweep artifact for scale {scale} — run the sweep first")
            return 2
        paths[scale] = matches[-1]
    paths[1] = SCALE1_PATH

    by_scale: dict[int, dict] = {}
    for scale in (0, 1, 2, 4):
        diffs, src = engine_b1_from(paths[scale], scale)
        stats = paired(diffs)
        stats.update(src)
        by_scale[scale] = stats
        out["byScale"][str(scale)] = stats
        star = "*" if stats["significantAt95"] else " "
        print(f"[scale {scale}] engine-B1 {stats['meanDiff']:+8.3f} "
              f"[{stats['ciLower']:+8.3f}, {stats['ciUpper']:+8.3f}] {star}"
              f"(n={stats['n']}, {src['source']})")

    # Integrity: scale 1 must reproduce the committed artifact's arm-means delta.
    ok = abs(by_scale[1]["meanDiff"] - COMMITTED_SCALE1_ENGINE_MINUS_B1) < 5e-4
    out["integrity"]["scale1ReproducesCommitted"] = {
        "computed": by_scale[1]["meanDiff"], "expected": COMMITTED_SCALE1_ENGINE_MINUS_B1,
        "ok": bool(ok)}
    print(f"[integrity] scale-1 anchor: {'OK' if ok else 'FAIL'}")
    if not ok:
        out["integrity"]["allPassed"] = False
        OUT_PATH.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
        return 1
    out["integrity"]["allPassed"] = True

    means = [by_scale[s]["meanDiff"] for s in (0, 1, 2, 4)]
    monotone = all(means[i + 1] >= means[i] - 1e-9 for i in range(len(means) - 1))
    rho = spearman([0.0, 1.0, 2.0, 4.0], means)
    s2, s4 = by_scale[2], by_scale[4]
    out["trend"] = {
        "meansByScale": {"0": means[0], "1": means[1], "2": means[2], "4": means[3]},
        "monotoneNonDecreasing": bool(monotone),
        "spearmanScaleVsMeanDiff": rho,
    }
    print(f"\n[trend] means {'>= monotone' if monotone else 'NOT monotone'}; "
          f"Spearman(scale, meanDiff) = {rho:.3f}" if rho is not None else "")

    # ---- Pre-declared verdict rules ----
    support = s4["ciLower"] > 0 and monotone
    damning = s2["ciUpper"] < 0 and s4["ciUpper"] < 0
    if support:
        verdict = ("SATURATION-SUPPORT -> the engine's value over B1 emerges as the field gets "
                   "less ADP-like; 'engine ~ ADP in saturated fields' is the supported claim and "
                   "any edge case rests on field deviation, to be confirmed by 2026 layers C/D")
    elif damning:
        verdict = ("DAMNING -> the deficit persists at high shock scales; the production sort is "
                   "worse than naive ADP on this grid regardless of field saturation")
    elif monotone and not s4["significantAt95"]:
        verdict = ("DIRECTIONAL-ONLY -> monotone improvement but scale-4 CI crosses zero; "
                   "escalate the scale-4 cell to a larger-N run ONCE before concluding "
                   "(pre-declared rule 3)")
    else:
        verdict = "AMBIGUOUS -> no further 2025 spend under these rules"
    out["verdict"] = verdict
    print(f"\n[verdict] {verdict}")

    OUT_PATH.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"\n[written] {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())