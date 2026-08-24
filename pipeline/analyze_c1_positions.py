"""C1-attribution diagnostics analysis (DECISIONS.md 2026-08-24 pre-declared rules).

Input: the instrumented diagnostics rerun report
(`2026-08-24-historical-backtest-2025-pilot-c1-diagnostics.json`, produced by
`BACKTEST_DIAGNOSTICS=1 npm run backtest` at pilot size, FFToday context) plus the committed
240-draft pilot JSON for the integrity gate.

Pre-declared rules implemented here (fixed before the rerun ran — see DECISIONS.md):
1. FLIP RULE: paired c1-engine diff recomputed on QB+RB+WR starter buckets only; sign flip vs
   inclusive, or CI crossing zero while the inclusive CI excludes it => cap-slot artifact => cut.
2. SHIPPABILITY RULE: an edge living entirely inside K+TE+DEF is not promotable (no waiver wire).
3. TIMING READ: first-pick round per position, c1 vs engine.
4. INTEGRITY: b1/b2/b3 perDraftMeanWeekly cells must byte-match the committed pilot JSON;
   engine/c1 drift disclosed.

Usage: python pipeline/analyze_c1_positions.py
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REPORTS = REPO / "benchmarks" / "reports"
DIAG_PATH = REPORTS / "2026-08-24-historical-backtest-2025-pilot-c1-diagnostics.json"
COMMITTED_PILOT_PATH = REPORTS / "2026-08-24-historical-backtest-2025-pilot.json"
POSITIONS = ("QB", "RB", "WR", "TE", "K", "DEF")
CAP1 = ("TE", "K", "DEF")
SKILL = ("QB", "RB", "WR")


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


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


def main() -> int:
    if not DIAG_PATH.exists():
        print(f"[abort] missing {DIAG_PATH.name} — run BACKTEST_DIAGNOSTICS='1' npm run backtest first")
        return 2
    diag = load(DIAG_PATH)
    committed = load(COMMITTED_PILOT_PATH) if COMMITTED_PILOT_PATH.exists() else None

    out: dict = {
        "report": "c1-attribution-analysis",
        "source": DIAG_PATH.name,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "integrity": {},
        "pairedByPosition": {},
        "flipRule": {},
        "timing": {},
        "verdict": None,
    }

    # ---- Rule 4: integrity ----
    drift = []
    if committed is None:
        print("[integrity] committed pilot JSON not found — skipping cell comparison")
        out["integrity"]["cellComparison"] = "skipped (committed pilot JSON absent)"
    else:
        for arm in ("b1", "b2", "b3"):
            a = committed["perDraftMeanWeekly"][arm]
            b = diag["perDraftMeanWeekly"][arm]
            ok = len(a) == len(b) and all(x == y for x, y in zip(a, b))
            print(f"[integrity] {arm}: {'byte-identical' if ok else 'DRIFT'}")
            if not ok:
                drift.append(arm)
        for arm in ("engine", "c1", "b4"):
            a = committed["perDraftMeanWeekly"][arm]
            b = diag["perDraftMeanWeekly"][arm]
            same = len(a) == len(b) and all(x == y for x, y in zip(a, b))
            print(f"[integrity] {arm}: {'byte-identical' if same else 'drift (disclosed, see DECISIONS.md)'}")
            if not same:
                drift.append(arm)
        out["integrity"]["cellComparison"] = "pass" if not drift else f"drift arms: {sorted(set(drift))}"
    if any(arm in ("b1", "b2", "b3") for arm in drift):
        print("[abort] deterministic baseline arms drifted — harness inputs changed; aborting")
        return 2

    spbp = diag["starterPointsByPosition"]
    arms = list(spbp.keys())
    n = len(spbp[arms[0]]["QB"])

    def bucket_diffs(arm_a: str, arm_b: str, positions: tuple[str, ...]) -> list[float]:
        return [sum(spbp[arm_b][pos][i] for pos in positions) - sum(spbp[arm_a][pos][i] for pos in positions)
                for i in range(n)]

    # ---- Paired per-position diffs (c1 - engine), inclusive composites ----
    print("\n[c1 - engine] paired mean diff by position bucket (pts/wk):")
    comparisons = {
        **{pos: (pos,) for pos in POSITIONS},
        "K+TE+DEF": CAP1,
        "skill-only(QB+RB+WR)": SKILL,
        "all(inclusive)": POSITIONS,
    }
    for label, positions in comparisons.items():
        # arm_b - arm_a => c1 - engine (negative = c1 worse at that bucket)
        stats = paired(bucket_diffs("engine", "c1", positions))
        out["pairedByPosition"][label] = stats
        star = "*" if stats["significantAt95"] else " "
        print(f"  {label:<22} {stats['meanDiff']:+7.3f}  "
              f"[{stats['ciLower']:+7.3f}, {stats['ciUpper']:+7.3f}] {star}")

    # ---- Rule 1: flip test ----
    inclusive = out["pairedByPosition"]["all(inclusive)"]
    skill_only = out["pairedByPosition"]["skill-only(QB+RB+WR)"]
    flipped = (skill_only["meanDiff"] < 0) != (inclusive["meanDiff"] < 0)
    crosses = not skill_only["significantAt95"]
    artifact = (flipped or crosses) and inclusive["significantAt95"]
    cap1_stats = out["pairedByPosition"]["K+TE+DEF"]
    entirely_cap1 = (cap1_stats["significantAt95"] and cap1_stats["meanDiff"] > 0
                     and skill_only["ciLower"] <= 0 and not artifact)
    if artifact:
        verdict = ("ARTIFACT -> C1's edge lives in cap-1 K/TE/DEF starter points; "
                   "cut from consideration on 2025 data (pre-declared flip rule)")
    elif entirely_cap1:
        verdict = ("CAP-SLOT-ONLY -> significant but resides in K+TE+DEF; NOT promotable "
                   "(pre-declared shippability rule: no-waiver backtest inflation)")
    elif skill_only["significantAt95"] and skill_only["meanDiff"] > 0:
        verdict = ("SKILL-COMPONENT -> positive, significant skill-position gap survives; "
                   "eligible to scope a real promotion gate (vs engine AND vs B1, downside band)")
    else:
        verdict = ("UNRESOLVED -> no decisive attribution at this N; escalate seeds only if a "
                   "verdict-relevant CI is borderline")
    out["flipRule"] = {"skillOnlyMeanDiff": skill_only["meanDiff"],
                       "skillOnlyCI": [skill_only["ciLower"], skill_only["ciUpper"]],
                       "signFlipped": flipped,
                       "skillOnlyCrossesZero": crosses,
                       "entirelyCap1": entirely_cap1}
    print(f"\n[flip-rule] skill-only diff {skill_only['meanDiff']:+.3f} "
          f"[{skill_only['ciLower']:+.3f}, {skill_only['ciUpper']:+.3f}] vs inclusive "
          f"{inclusive['meanDiff']:+.3f}; sign flip: {flipped}")
    print(f"[verdict] {verdict}")
    out["verdict"] = verdict

    # ---- Rule 3: timing read ----
    fprp = diag["firstPickRoundByPosition"]

    def median(vs: list[float]) -> float:
        s = sorted(v for v in vs if v > 0)
        if not s:
            return 0.0
        mid = len(s) // 2
        return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2

    print("\n[timing] first-pick round by position (mean / median; 0 = never drafted):")
    for pos in POSITIONS:
        c1v, engv = fprp["c1"][pos], fprp["engine"][pos]
        # c1 - engine; negative = c1 picks that position EARLIER
        stats = paired([a - b for a, b in zip(c1v, engv)])
        out["timing"][pos] = {
            "c1Mean": sum(c1v) / len(c1v), "engineMean": sum(engv) / len(engv),
            "c1Median": median(c1v), "engineMedian": median(engv),
            "pairedDiff": stats,
            "neverDraftedC1": sum(1 for v in c1v if v == 0),
            "neverDraftedEngine": sum(1 for v in engv if v == 0),
        }
        t = out["timing"][pos]
        print(f"  {pos}: c1 {t['c1Mean']:5.2f}/{t['c1Median']:4.1f}  "
              f"engine {t['engineMean']:5.2f}/{t['engineMedian']:4.1f}  "
              f"diff {stats['meanDiff']:+5.2f} [{stats['ciLower']:+5.2f}, {stats['ciUpper']:+5.2f}]"
              f"{'*' if stats['significantAt95'] else ' '}")

    dest = REPORTS / "2026-08-24-c1-attribution-analysis.json"
    dest.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"\n[written] {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


