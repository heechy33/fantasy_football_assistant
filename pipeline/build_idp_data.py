import json
import os
import re
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

REPO_ROOT = Path("C:/Projects/fantasy_football_assistant")
IDP_JSON_PATH = REPO_ROOT / "frontend" / "src" / "data" / "idpProjections.json"
WEEKLY_FIXTURES_DIR = REPO_ROOT / "fixtures" / "projection-freeze" / "2025-retrievable"
WEEKLY_STATS_PATH = REPO_ROOT / "data" / "weekly-stats.json"
PLAYERS_PATH = REPO_ROOT / "data" / "players.json"

NAME_ALIASES = {
    "kamrencurl": "kamcurl",
    "chaunceygardnerjohnson": "cjgardnerjohnson",
    "patricksurtain": "patsurtain",
    "andruphillips": "druphillips",
    "daxtonhill": "daxhill",
    "joshmetellus": "joshuametellus",
    "camrynbynum": "cambynum",
    "michaeljackson": "mikejackson",
}

def clean_name(name: str | None) -> str:
    s = (name or "").lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"[^a-z0-9]", "", s)

def format_height(inches: Any) -> str | None:
    if inches is None:
        return None
    try:
        val = int(float(str(inches).strip()))
        if 48 <= val <= 90:
            feet = val // 12
            rem = val % 12
            return f"{feet}'{rem}\""
    except (ValueError, TypeError):
        pass
    text = str(inches).strip()
    m = re.match(r"^(\d)['-](\d{1,2})\"?$", text)
    if m:
        return f"{m.group(1)}'{m.group(2)}\""
    return None

def format_draft_pick(round_val: Any, pick_val: Any, year_val: Any) -> str | None:
    try:
        r = int(round_val) if round_val is not None else None
        p = int(pick_val) if pick_val is not None else None
        y = int(year_val) if year_val is not None else None
    except (ValueError, TypeError):
        return None

    if r is not None and p is not None:
        core = f"Rd {r} · Pk {p}"
        return f"{core} ({y})" if y else core
    if y:
        return f"{y} NFL Draft"
    return None

def fetch_sleeper_players() -> dict[str, dict[str, Any]]:
    print("Fetching Sleeper NFL players...")
    req = urllib.request.Request(
        "https://api.sleeper.app/v1/players/nfl",
        headers={"User-Agent": "fantasy-football-assistant-pipeline/1.0"},
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        return json.loads(resp.read().decode("utf-8"))

def load_schedule_opponents() -> dict[tuple[str, int], str]:
    schedule: dict[tuple[str, int], str] = {}
    if not WEEKLY_STATS_PATH.exists() or not PLAYERS_PATH.exists():
        print("WARN: weekly-stats.json or players.json missing, schedule opponent map empty.")
        return schedule

    with open(WEEKLY_STATS_PATH, "r", encoding="utf-8") as f:
        ws = json.load(f)
    with open(PLAYERS_PATH, "r", encoding="utf-8") as f:
        players = {p["playerId"]: p for p in json.load(f)}

    for pid, pdata in ws.get("players", {}).items():
        meta = players.get(pid)
        team = meta.get("team") if meta else (pid if pdata.get("p") == "DEF" else None)
        if not team:
            continue
        for row in pdata.get("w", []):
            week = row[0]
            opp = row[2]
            if opp:
                schedule[(team, week)] = opp
    return schedule

def load_weekly_payloads() -> dict[int, dict[str, dict[str, Any]]]:
    weekly_payloads: dict[int, dict[str, dict[str, Any]]] = {}
    for w in range(1, 19):
        fn = WEEKLY_FIXTURES_DIR / f"sleeper-weekly-stats-2025-week-{w:02d}.raw.json"
        if fn.exists():
            with open(fn, "r", encoding="utf-8") as f:
                weekly_payloads[w] = json.load(f)
    return weekly_payloads

def calculate_yahoo_fpts(st: dict[str, Any]) -> float:
    solo = float(st.get("idp_tkl_solo") or 0.0)
    ast = float(st.get("idp_tkl_ast") or 0.0)
    sack = float(st.get("idp_sack") or 0.0)
    pd = float(st.get("idp_pass_def") or 0.0)
    int_cnt = float(st.get("idp_int") or 0.0)
    ff = float(st.get("idp_ff") or 0.0)
    fr = float(st.get("idp_fum_rec") or 0.0)
    def_td = float(st.get("def_td") or 0.0)
    safe = float(st.get("idp_safe") or 0.0)
    blk = float(st.get("idp_blk_kick") or 0.0)

    fpts = (
        solo * 1.0
        + ast * 0.5
        + sack * 2.0
        + pd * 1.0
        + int_cnt * 3.0
        + ff * 2.0
        + fr * 2.0
        + def_td * 6.0
        + safe * 2.0
        + blk * 2.0
    )
    return round(fpts, 1)

def build_player_role_summary(weekly_games: list[dict[str, Any]]) -> dict[str, Any]:
    played = [g for g in weekly_games if g["kind"] == "played" and g["pts"] is not None]
    if not played:
        return {
            "gamesPlayed": 0,
            "gamesStarted": 0,
            "snapPct": None,
            "snapsPerGame": None,
            "tacklesPerGame": None,
            "soloPerGame": None,
            "astPerGame": None,
            "sacksPerGame": None,
            "totalSacks": 0.0,
            "tflPerGame": None,
            "qbHitsPerGame": None,
            "pdPerGame": None,
            "intPerGame": None,
            "totalInt": 0,
            "forcedFumbles": 0,
            "fumbleRecoveries": 0,
            "fptsPerGame": None,
            "last5FptsPerGame": None,
            "formRating": "Unavailable",
            "ceiling": None,
            "floor": None,
        }

    gp = len(played)
    gs = sum(1 for g in played if g.get("gs", 0) > 0)
    total_snaps = sum(g.get("defSnaps") or 0 for g in played)
    valid_snaps = [g["snapPct"] for g in played if g.get("snapPct") is not None]
    avg_snap_pct = round(sum(valid_snaps) / len(valid_snaps)) if valid_snaps else None
    snaps_per_g = round(total_snaps / gp, 1) if gp > 0 else None

    tot_tkl = sum(g["tkl"] for g in played)
    tot_solo = sum(g["solo"] for g in played)
    tot_ast = sum(g["ast"] for g in played)
    tot_sack = sum(g["sack"] for g in played)
    tot_tfl = sum(g["tfl"] for g in played)
    tot_qbh = sum(g["qbHit"] for g in played)
    tot_pd = sum(g["pd"] for g in played)
    tot_int = sum(g["int"] for g in played)
    tot_ff = sum(g["ff"] for g in played)
    tot_fr = sum(g["fr"] for g in played)

    pts_list = [g["pts"] for g in played]
    avg_fpts = round(sum(pts_list) / gp, 1)
    recent_played = played[-5:]
    recent_pts = [g["pts"] for g in recent_played]
    last5_avg = round(sum(recent_pts) / len(recent_pts), 1) if recent_pts else None

    if last5_avg is not None and len(recent_pts) >= 3:
        delta = last5_avg - avg_fpts
        form_rating = "Rising" if delta >= 1.5 else "Falling" if delta <= -1.5 else "Steady"
    else:
        form_rating = "Steady"

    ceiling = max(pts_list) if pts_list else None
    floor = min(pts_list) if pts_list else None

    return {
        "gamesPlayed": gp,
        "gamesStarted": gs,
        "snapPct": avg_snap_pct,
        "snapsPerGame": snaps_per_g,
        "tacklesPerGame": round(tot_tkl / gp, 1),
        "soloPerGame": round(tot_solo / gp, 1),
        "astPerGame": round(tot_ast / gp, 1),
        "sacksPerGame": round(tot_sack / gp, 2),
        "totalSacks": round(tot_sack, 1),
        "tflPerGame": round(tot_tfl / gp, 1),
        "qbHitsPerGame": round(tot_qbh / gp, 1),
        "pdPerGame": round(tot_pd / gp, 1),
        "intPerGame": round(tot_int / gp, 2),
        "totalInt": tot_int,
        "forcedFumbles": tot_ff,
        "fumbleRecoveries": tot_fr,
        "fptsPerGame": avg_fpts,
        "last5FptsPerGame": last5_avg,
        "formRating": form_rating,
        "ceiling": ceiling,
        "floor": floor,
    }

def enrich_idp_data() -> None:
    print(f"Loading {IDP_JSON_PATH}...")
    with open(IDP_JSON_PATH, "r", encoding="utf-8") as f:
        idp_data = json.load(f)

    sleeper_players = fetch_sleeper_players()
    schedule_opponents = load_schedule_opponents()
    weekly_payloads = load_weekly_payloads()
    print(f"Loaded {len(weekly_payloads)} weeks of raw 2025 Sleeper weekly data.")
    print(f"Loaded {len(schedule_opponents)} team-week opponent pairs.")

    sleeper_by_norm: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    for pid, p in sleeper_players.items():
        fn = p.get("full_name")
        if fn:
            sleeper_by_norm[clean_name(fn)].append((pid, p))

    for slot in ["D", "S"]:
        players_list = idp_data.get(slot, [])
        print(f"Enriching slot {slot} ({len(players_list)} players)...")

        for p in players_list:
            name = p["name"]
            cname = clean_name(name)
            if cname in NAME_ALIASES:
                cname = NAME_ALIASES[cname]

            candidates = sleeper_by_norm.get(cname, [])
            matched_pid = None
            matched_sp: dict[str, Any] = {}

            if len(candidates) == 1:
                matched_pid, matched_sp = candidates[0]
            elif len(candidates) > 1:
                team_match = [c for c in candidates if (c[1].get("team") or "").upper() == p["team"].upper()]
                if team_match:
                    matched_pid, matched_sp = team_match[0]
                else:
                    matched_pid, matched_sp = candidates[0]

            if matched_pid:
                p["sleeperId"] = matched_pid
                height_inches = matched_sp.get("height")
                try:
                    height_inches = int(float(height_inches)) if height_inches is not None else None
                except (ValueError, TypeError):
                    height_inches = None

                weight_lbs = matched_sp.get("weight")
                try:
                    weight_lbs = int(float(weight_lbs)) if weight_lbs is not None else None
                except (ValueError, TypeError):
                    weight_lbs = None

                years_exp = matched_sp.get("years_exp")
                try:
                    years_exp = int(float(years_exp)) if years_exp is not None else None
                except (ValueError, TypeError):
                    years_exp = None

                draft_year = matched_sp.get("metadata", {}).get("draft_year") or matched_sp.get("draft_year")
                draft_round = matched_sp.get("metadata", {}).get("draft_round") or matched_sp.get("draft_round")
                draft_pick = matched_sp.get("metadata", {}).get("draft_pick") or matched_sp.get("draft_pick")
                jersey_num = matched_sp.get("number")
                try:
                    jersey_num = int(jersey_num) if jersey_num is not None else None
                except (ValueError, TypeError):
                    jersey_num = None

                p["bio"] = {
                    "age": matched_sp.get("age"),
                    "height": format_height(height_inches),
                    "heightInches": height_inches,
                    "weight": weight_lbs,
                    "yearsExp": years_exp,
                    "college": matched_sp.get("college"),
                    "jerseyNumber": jersey_num,
                    "draftPick": format_draft_pick(draft_round, draft_pick, draft_year),
                    "draftYear": int(draft_year) if draft_year else None,
                    "draftRound": int(draft_round) if draft_round else None,
                    "status": matched_sp.get("status") or "Active",
                }

                weekly_games: list[dict[str, Any]] = []
                player_bye_week = p.get("bye")

                for w in range(1, 19):
                    payload = weekly_payloads.get(w, {})
                    st = payload.get(matched_pid)
                    opp = schedule_opponents.get((p["team"], w))

                    if w == player_bye_week and st is None:
                        weekly_games.append({
                            "week": w,
                            "kind": "bye",
                            "opponent": None,
                            "pts": None,
                            "defSnaps": None,
                            "teamDefSnaps": None,
                            "snapPct": None,
                            "solo": 0,
                            "ast": 0,
                            "tkl": 0,
                            "sack": 0.0,
                            "tfl": 0.0,
                            "qbHit": 0,
                            "int": 0,
                            "pd": 0,
                            "ff": 0,
                            "fr": 0,
                        })
                    elif st is None or (st.get("def_snp") is None and st.get("pts_idp") is None and not st.get("gp")):
                        weekly_games.append({
                            "week": w,
                            "kind": "inactive",
                            "opponent": opp,
                            "pts": None,
                            "defSnaps": None,
                            "teamDefSnaps": None,
                            "snapPct": None,
                            "solo": 0,
                            "ast": 0,
                            "tkl": 0,
                            "sack": 0.0,
                            "tfl": 0.0,
                            "qbHit": 0,
                            "int": 0,
                            "pd": 0,
                            "ff": 0,
                            "fr": 0,
                        })
                    else:
                        solo = int(float(st.get("idp_tkl_solo") or 0.0))
                        ast = int(float(st.get("idp_tkl_ast") or 0.0))
                        tkl = int(float(st.get("idp_tkl") or (solo + ast)))
                        sack = round(float(st.get("idp_sack") or 0.0), 1)
                        tfl = round(float(st.get("idp_tkl_loss") or 0.0), 1)
                        qbh = int(float(st.get("idp_qb_hit") or 0.0))
                        int_cnt = int(float(st.get("idp_int") or 0.0))
                        pd = int(float(st.get("idp_pass_def") or 0.0))
                        ff = int(float(st.get("idp_ff") or 0.0))
                        fr = int(float(st.get("idp_fum_rec") or 0.0))
                        def_snaps = int(float(st.get("def_snp") or 0.0)) if st.get("def_snp") is not None else None
                        tm_snaps = int(float(st.get("tm_def_snp") or 0.0)) if st.get("tm_def_snp") is not None else None
                        snap_pct = round(100.0 * def_snaps / tm_snaps) if def_snaps and tm_snaps and tm_snaps > 0 else None
                        gs_flag = int(float(st.get("gs") or 0.0))

                        fpts = calculate_yahoo_fpts(st)

                        weekly_games.append({
                            "week": w,
                            "kind": "played",
                            "opponent": opp,
                            "pts": fpts,
                            "defSnaps": def_snaps,
                            "teamDefSnaps": tm_snaps,
                            "snapPct": snap_pct,
                            "solo": solo,
                            "ast": ast,
                            "tkl": tkl,
                            "sack": sack,
                            "tfl": tfl,
                            "qbHit": qbh,
                            "int": int_cnt,
                            "pd": pd,
                            "ff": ff,
                            "fr": fr,
                            "gs": gs_flag,
                        })

                p["weekly"] = weekly_games
                p["role"] = build_player_role_summary(weekly_games)

    print(f"Writing enriched data to {IDP_JSON_PATH}...")
    with open(IDP_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(idp_data, f, indent=2)
    print("Done! IDP player data successfully enriched.")

if __name__ == "__main__":
    enrich_idp_data()
