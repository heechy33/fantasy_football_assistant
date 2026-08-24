"""Build the blend-ladder's derived inputs (gates-blend-addendum.md steps A2/B).

Consumes ONLY frozen bytes:
- fixtures/projection-freeze/2025-retrievable/ (Sleeper/ESPN 2025 projections, weekly outcomes)
- fixtures/backtest/2025/projections.json (FFToday fixture — leakage-gated preseason)
- data/players.json (canonical pool + identity crosswalk)

Emits fixtures/backtest/2025-blend/:
- projections-sleeper.json / projections-espn.json / projections-pavg.json
    SeasonProjection-shaped ({playerId, source, stats}) with stats restricted to the exact
    BACKTEST_SCORING key set (frontend/src/engine/backtest.ts) so no derived value
    (pts_ppr, adp_*, bonus_rec_te) can ever leak into a score. pavg = key-level equal-weight
    mean over sources covering player AND key (amended addendum section 3).
- outcomes-weekly-full.json   {playerId: {week: pts_ppr}} weeks 1-18, full frozen feed
- provenance-blend.json       input/output SHA-256 pins, coverage gates, zero-outcome audit

Fail-closed gates: ESPN identity match-rate >= 97%; every emitted playerId exists in players.json;
pavg sources must agree on nothing (position always taken from players.json). No network.

Usage: python pipeline/build_blend_inputs.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FREEZE = REPO / "fixtures" / "projection-freeze" / "2025-retrievable"
FFTODAY_FIXTURE = REPO / "fixtures" / "backtest" / "2025" / "projections.json"
PLAYERS_JSON = REPO / "data" / "players.json"
OUT_DIR = REPO / "fixtures" / "backtest" / "2025-blend"

# Exact BACKTEST_SCORING key set (frontend/src/engine/backtest.ts::BACKTEST_SCORING).
SCORING_KEYS = (
    "pass_yd", "pass_td", "pass_int", "pass_2pt",
    "rush_yd", "rush_td", "rush_2pt",
    "rec", "rec_yd", "rec_td", "rec_2pt",
    "fum_lost",
    "fgm", "xpm", "sack", "int", "fum_rec", "def_td", "def_kr_td",
)
IDENTITY_GATE_MIN_RATE = 0.97

# ESPN stat-id -> Sleeper-vocab key (pipeline/espn_projections.py::_STAT_ID_MAP), restricted to
# the scoring keys above. Verified in that module against appliedTotal.
ESPN_STAT_MAP = {
    "3": "pass_yd", "4": "pass_td", "20": "pass_int", "19": "pass_2pt",
    "24": "rush_yd", "25": "rush_td", "26": "rush_2pt",
    "53": "rec", "42": "rec_yd", "43": "rec_td", "44": "rec_2pt",
    "72": "fum_lost",
    "83": "fgm", "86": "xpm",
    "99": "sack", "95": "int", "96": "fum_rec", "94": "def_td", "101": "def_kr_td",
}
ESPN_DEFAULT_POSITION = {"1": "QB", "2": "RB", "3": "WR", "4": "TE", "5": "K", "16": "DEF"}
ESPN_PRO_TEAM_ABBR = {
    1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
    9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
    17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
    25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
}

def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def restrict(stats: dict, mapping: dict | None = None) -> dict:
    """Keep only scoring keys (optionally renaming through `mapping`); drop everything derived."""
    out = {}
    for key, value in stats.items():
        mapped = mapping.get(str(key), key) if mapping else key
        if mapped in SCORING_KEYS and isinstance(value, (int, float)):
            out[mapped] = float(value)
    return out


def normalize_sleeper(players_by_id: dict) -> list[dict]:
    rows = load_json(FREEZE / "sleeper-projections-2025.raw.json")
    out, skipped_not_in_pool = [], []
    for row in rows:
        pid = row.get("player_id")
        if pid is None or pid not in players_by_id:
            # DEF rows key by team abbreviation and ARE players.json members; anything else
            # outside the canonical pool cannot be drafted and would be dead weight.
            if pid is not None:
                skipped_not_in_pool.append(pid)
            continue
        meta = players_by_id[pid]
        stats = restrict(row.get("stats") or {})
        if not stats:
            continue
        out.append({"playerId": pid, "source": "sleeper-frozen-2025", "stats": stats,
                    "_position": meta["position"], "_name": meta["name"]})
    print(f"[sleeper] rows kept: {len(out)}, skipped-not-in-pool: {len(skipped_not_in_pool)}")
    return out


def select_espn_entry(player: dict) -> dict | None:
    for entry in player.get("stats") or []:
        if (entry.get("seasonId") == 2025 and entry.get("statSourceId") == 1
                and entry.get("statSplitTypeId") == 0 and entry.get("scoringPeriodId") == 0):
            return entry
    return None


def normalize_espn(players_by_id: dict, espn_id_index: dict) -> tuple[list[dict], dict]:
    payload = load_json(FREEZE / "espn-leaguedefaults-2025.raw.json")
    out, matched, unmatched = [], 0, []
    empty_projection_entries = 0
    for row in payload.get("players", []) or []:
        player = row.get("player") if isinstance(row, dict) else None
        if not isinstance(player, dict):
            continue
        entry = select_espn_entry(player)
        position = ESPN_DEFAULT_POSITION.get(str(player.get("defaultPositionId")))
        if entry is None or position is None:
            continue
        raw_stats_all = {str(k): float(v) for k, v in (entry.get("stats") or {}).items()}
        if not raw_stats_all:
            # ESPN carries many deep-bench players as named rows with an empty stats map and
            # appliedTotal 0 — no projection content exists for them. They are outside the
            # blend's universe AND outside the identity-gate denominator (recorded, not hidden).
            empty_projection_entries += 1
            continue
        if position == "DEF":
            pid = ESPN_PRO_TEAM_ABBR.get(player.get("proTeamId"))
        else:
            pid = espn_id_index.get(str(player.get("id")))
        if pid is None or pid not in players_by_id:
            unmatched.append(f"{player.get('fullName')} ({position})")
            continue
        stats = restrict(raw_stats_all, ESPN_STAT_MAP)
        if not stats:
            unmatched.append(f"{player.get('fullName')} ({position}) [no scoring keys]")
            continue
        matched += 1
        out.append({"playerId": pid, "source": "espn-frozen-2025", "stats": stats,
                    "_position": position, "_name": players_by_id[pid]["name"]})
    informative = matched + len(unmatched)
    rate = matched / informative if informative else 0.0
    gate = {"matched": matched, "unmatchedCount": len(unmatched), "rate": round(rate, 4),
            "threshold": IDENTITY_GATE_MIN_RATE, "ok": rate >= IDENTITY_GATE_MIN_RATE,
            "unmatchedSample": sorted(unmatched)[:25],
            "emptyProjectionEntriesExcluded": empty_projection_entries,
            "gateDenominatorNote": ("identity gate measures crosswalk success among entries that "
                                    "carry any stat content; empty-projection rows are recorded "
                                    "separately and excluded from both numerator and denominator")}
    print(f"[espn] matched {matched}, unmatched {len(unmatched)}, rate {rate:.3f} "
          f"({'OK' if gate['ok'] else 'FAIL'}), empty-projection entries excluded: "
          f"{empty_projection_entries}")
    return out, gate

def build_pavg(source_rows: dict[str, list[dict]], players_by_id: dict) -> list[dict]:
    """Key-level equal-weight mean (addendum section 3, amended wording). Position always comes
    from players.json — a source's own position claim is never trusted for eligibility."""
    per_player: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for source, rows in source_rows.items():
        for row in rows:
            for key, value in row["stats"].items():
                per_player[row["playerId"]][key].append(float(value))
    out = []
    for pid in sorted(per_player, key=lambda x: (len(x), x)):
        meta = players_by_id.get(pid)
        if meta is None:
            raise ValueError(f"pavg player {pid} missing from players.json")
        stats = {key: sum(values) / len(values) for key, values in per_player[pid].items()}
        out.append({"playerId": pid, "source": "pavg-2025", "stats": stats,
                    "_position": meta["position"], "_name": meta["name"]})
    print(f"[pavg] players: {len(out)}")
    return out


def build_outcomes() -> tuple[dict, int]:
    """Full-feed weekly outcomes: {playerId: {week: pts_ppr}} from the frozen weekly bytes."""
    points: dict[str, dict[str, float]] = {}
    total_rows = 0
    for week in range(1, 19):
        feed = load_json(FREEZE / f"sleeper-weekly-stats-2025-week-{week:02d}.raw.json")
        total_rows += len(feed)
        for pid, row in feed.items():
            pts = row.get("pts_ppr")
            if isinstance(pts, (int, float)):
                points.setdefault(pid, {})[str(week)] = float(pts)
    print(f"[outcomes] players with any weekly points: {len(points)} (feed rows {total_rows})")
    return points, total_rows


def key_coverage(rows: list[dict]) -> dict:
    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        for key in row["stats"]:
            counts[key] += 1
    return {k: counts[k] for k in sorted(counts)}


def main() -> int:
    started = datetime.now(timezone.utc).isoformat()
    players = load_json(PLAYERS_JSON)
    players_by_id = {p["playerId"]: p for p in players if p.get("position") in
                     {"QB", "RB", "WR", "TE", "K", "DEF"}}
    espn_id_index = {}
    for p in players:
        espn_id = (p.get("ids") or {}).get("espn")
        if espn_id:
            espn_id_index[str(espn_id)] = p["playerId"]

    fftoday_artifact = load_json(FFTODAY_FIXTURE)
    fftoday = [{"playerId": r["playerId"], "source": "fftoday-fixture-2025",
                "stats": restrict(r["stats"]),
                "_position": players_by_id[r["playerId"]]["position"],
                "_name": players_by_id[r["playerId"]]["name"]}
               for r in fftoday_artifact["projections"] if r["playerId"] in players_by_id]
    sleeper = normalize_sleeper(players_by_id)
    espn, espn_gate = normalize_espn(players_by_id, espn_id_index)
    if not espn_gate["ok"]:
        print("[abort] ESPN identity gate failed:", json.dumps(espn_gate, indent=1))
        return 2

    pavg = build_pavg({"fftoday": fftoday, "sleeper": sleeper, "espn": espn}, players_by_id)
    outcomes, feed_rows = build_outcomes()

    pool = sorted({r["playerId"] for rows in (fftoday, sleeper, espn, pavg) for r in rows})
    zero_outcome = [pid for pid in pool if pid not in outcomes]
    print(f"[audit] candidate pool {len(pool)}; zero-outcome (verified absent, full feed): "
          f"{len(zero_outcome)}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    artifacts = {
        "projections-sleeper.json": sleeper,
        "projections-espn.json": espn,
        "projections-pavg.json": pavg,
    }
    outputs: dict[str, dict] = {}
    for name, rows in artifacts.items():
        artifact = {
            "schemaVersion": 1,
            "season": "2025",
            "source": rows[0]["source"] if rows else name,
            "scoringKeys": list(SCORING_KEYS),
            "builtAt": started,
            "note": ("Derived from frozen bytes only (fixtures/projection-freeze/2025-retrievable/). "
                     "Stats restricted to BACKTEST_SCORING keys; scoring happens in TS via the real "
                     "scoreProjection — this file carries raw stat values only."),
            "keyCoverage": key_coverage(rows),
            "projections": [{k: r[k] for k in ("playerId", "source", "stats")} for r in rows],
        }
        path = OUT_DIR / name
        path.write_text(json.dumps(artifact, indent=1) + "\n", encoding="utf-8")
        outputs[name] = {"sha256": sha256_of(path), "rows": len(rows)}

    outcomes_artifact = {
        "schemaVersion": 1,
        "season": "2025",
        "weeks": list(range(1, 19)),
        "note": ("Full frozen Sleeper weekly feed, pts_ppr per player-week. Week 18 included for "
                 "completeness but excluded from the backtest metric (starter-rest risk). "
                 "Zero-outcome pool members are verified absent from this full feed."),
        "points": outcomes,
    }
    path = OUT_DIR / "outcomes-weekly-full.json"
    path.write_text(json.dumps(outcomes_artifact) + "\n", encoding="utf-8")
    outputs["outcomes-weekly-full.json"] = {"sha256": sha256_of(path), "players": len(outcomes)}

    inputs_pinned = {
        "sleeper-projections-2025.raw.json": sha256_of(FREEZE / "sleeper-projections-2025.raw.json"),
        "espn-leaguedefaults-2025.raw.json": sha256_of(FREEZE / "espn-leaguedefaults-2025.raw.json"),
        "fftoday-fixture": sha256_of(FFTODAY_FIXTURE),
        "players.json": sha256_of(PLAYERS_JSON),
    }

    provenance = {
        "schemaVersion": 1,
        "builtAt": started,
        "addendum": "fixtures/backtest/2025/gates-blend-addendum.md",
        "inputsSha256": inputs_pinned,
        "outputs": outputs,
        "gates": {
            "espnIdentity": espn_gate,
            "zeroOutcomeVerified": {
                "poolSize": len(pool),
                "count": len(zero_outcome),
                "verification": ("full frozen weekly feed weeks 1-18 contains no pts_ppr row for "
                                 "these ids — genuine absence by construction of the freeze"),
                "sample": zero_outcome[:25],
            },
        },
    }
    prov_path = OUT_DIR / "provenance-blend.json"
    prov_path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")

    print(f"[done] {OUT_DIR}")
    for name, meta in outputs.items():
        extra = meta.get("rows", meta.get("players"))
        print(f"  {name}: {extra} rows, sha256 {meta['sha256'][:16]}...")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())



