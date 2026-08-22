"""Transcribe the two real ESPN human-draft recaps into raw-Sleeper-shaped
fixtures for the availability/VONA benchmark harness (Phase 2b).

- espn_draft1.txt : 10-team x 14-round snake recap (pick-order, 140 picks)
- espn_draft2.txt : 10-team x 16-round snake roster export (team-ordered, 160 picks)

Both drafts are all-human (no bots), 1-QB PPR with deep benches. The output is
raw-Sleeper API shape so frontend/src/adapters/sleeper.ts consumes it unchanged:

  fixtures/real-drafts/<dir>/draft.json     (RawDraft)
  fixtures/real-drafts/<dir>/picks.json     (RawPick[], sorted by pick_no)
  fixtures/real-drafts/<dir>/metadata.json  (Phase 2b/2d harness descriptor)

Player names are resolved to data/players.json Sleeper playerIds with the same
normalization transform.py uses (case, punctuation, Jr./Sr./II/III/IV) plus a
position/team disambiguator. DEF rows key by team abbreviation (playerId "SEA"),
which is exactly how players.json keys defenses. Any unresolved pick exits
non-zero: the harness's ground truth is corrupted by a silent crosswalk miss,
so the transcription must be total.

Usage:  python scripts/transcribe-espn-draft.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLAYERS_JSON = ROOT / "data" / "players.json"
OUT_ROOT = ROOT / "fixtures" / "real-drafts"

_TEAMS = 10


def _norm_name(name: str) -> str:
    s = name.lower()
    s = re.sub(r"[^a-z]", "", s)
    s = re.sub(r"(jr|sr|iii|ii|iv)$", "", s)
    return s


def build_index(players: list[dict]) -> dict[str, list[dict]]:
    index: dict[str, list[dict]] = {}
    for p in players:
        index.setdefault(_norm_name(p["name"] or ""), []).append(p)
    return index


def resolve(
    index: dict[str, list[dict]],
    name: str,
    team: str | None,
    position: str,
) -> tuple[str | None, str | None]:
    """Returns (playerId, error). DEF resolves by team abbreviation."""
    if position and position.upper() in ("DEF", "D/ST"):
        pid = (team or "").upper()
        if pid:
            return pid, None
        return None, f"DEF row missing team: {name}"
    key = _norm_name(name)
    cands = index.get(key, [])
    if not cands:
        return None, f"no name match for {name}"
    matches = [p for p in cands if (p.get("position") or "").upper() == position.upper()]
    if team:
        team_matches = [p for p in matches if (p.get("team") or "").upper() == team.upper()]
        if team_matches:
            matches = team_matches
    if len(matches) == 1:
        return matches[0]["playerId"], None
    if not matches:
        return None, f"no {position} match for {name} ({team})"
    return None, f"ambiguous {name} {position} {team}: {[m['playerId'] for m in matches]}"


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

_ROUND_RE = re.compile(r"^Round\s+(\d+)$", re.IGNORECASE)
_DRAFT1_HEADERS = {"NO.", "PLAYER", "TEAM", "NO"}
_PLAYER_LINE_RE = re.compile(r"^(?P<name>.+?)\s+(?P<team>[A-Z]{2,3})\s*,\s*(?P<pos>.+?)\s*$")
_PICK_RE = re.compile(r"^(\d+)\.(\d+)$")


def parse_draft1(text: str) -> list[dict]:
    """pick-order recap: 'Round N' then triples (no, '<name> <TEAM>, <POS>', team name)."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    out: list[dict] = []
    cur_round: int | None = None
    i = 0
    while i < len(lines):
        s = lines[i]
        m = _ROUND_RE.match(s)
        if m:
            cur_round = int(m.group(1))
            i += 1
            continue
        if s in _DRAFT1_HEADERS:
            i += 1
            continue
        if cur_round is not None and s.isdigit() and i + 2 < len(lines):
            no = int(s)
            pl = _PLAYER_LINE_RE.match(lines[i + 1])
            if pl:
                overall = (cur_round - 1) * _TEAMS + no
                slot = no if cur_round % 2 == 1 else _TEAMS - no + 1
                out.append(
                    {
                        "overall": overall,
                        "round": cur_round,
                        "slot": slot,
                        "name": pl.group("name").strip(),
                        "team": pl.group("team").upper(),
                        "position": pl.group("pos").strip().upper(),
                        "fantasyTeam": lines[i + 2],
                    }
                )
            i += 3
            continue
        i += 1
    return out


def parse_draft2(text: str) -> list[dict]:
    """team-ordered roster export: 6-line blocks 'r.p / first / last / team / pos / (bye)'."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    out: list[dict] = []
    i = 0
    while i + 5 < len(lines):
        m = _PICK_RE.match(lines[i])
        if not m:
            i += 1
            continue
        r, p = int(m.group(1)), int(m.group(2))
        overall = (r - 1) * _TEAMS + p
        slot = p if r % 2 == 1 else _TEAMS - p + 1
        out.append(
            {
                "overall": overall,
                "round": r,
                "slot": slot,
                "name": f"{lines[i + 1]} {lines[i + 2]}".strip(),
                "team": lines[i + 3].upper(),
                "position": lines[i + 4].upper(),
            }
        )
        i += 6
    return out


# ---------------------------------------------------------------------------
# Fixture writing
# ---------------------------------------------------------------------------


def write_fixture(
    tag: str,
    dir_name: str,
    draft_name: str,
    source_file: str,
    parsed: list[dict],
    index: dict[str, list[dict]],
    rounds: int,
) -> int:
    """Resolve and write one draft. Returns the number of unresolved picks."""
    unresolved: list[str] = []
    resolved: list[dict] = []
    for pk in parsed:
        pid, err = resolve(index, pk["name"], pk.get("team"), pk["position"])
        if pid is None:
            unresolved.append(f"  overall {pk['overall']} {pk['name']} {pk.get('team')} {pk['position']}: {err}")
            continue
        resolved.append({**pk, "playerId": pid})

    out_dir = OUT_ROOT / dir_name
    out_dir.mkdir(parents=True, exist_ok=True)

    draft_order = {f"espn-{tag}-t{slot}": slot for slot in range(1, _TEAMS + 1)}
    slot_to_roster_id = {str(slot): slot for slot in range(1, _TEAMS + 1)}

    draft = {
        "draft_id": dir_name,
        "league_id": None,
        "type": "snake",
        "status": "complete",
        "season": "2026",
        "metadata": {
            "name": draft_name,
            "scoring_type": "ppr",
            "source": source_file,
            "transcribed": True,
        },
        "settings": {
            "teams": _TEAMS,
            "rounds": rounds,
            "slots_qb": 1,
            "slots_rb": 2,
            "slots_wr": 2,
            "slots_te": 1,
            "slots_flex": 1,
            "slots_super_flex": 0,
            "slots_k": 1,
            "slots_def": 1,
        },
        "draft_order": draft_order,
        "slot_to_roster_id": slot_to_roster_id,
    }

    def _split_name(name: str) -> tuple[str, str]:
        parts = name.split(" ", 1)
        return (parts[0], parts[1]) if len(parts) == 2 else (name, "")

    picks = []
    for pk in sorted(resolved, key=lambda x: x["overall"]):
        first, last = _split_name(pk["name"])
        picks.append(
            {
                "player_id": pk["playerId"],
                "picked_by": f"espn-{tag}-t{pk['slot']}",
                "roster_id": pk["slot"],
                "round": pk["round"],
                "draft_slot": pk["slot"],
                "pick_no": pk["overall"],
                "metadata": {"first_name": first, "last_name": last},
            }
        )

    metadata = {
        "provider": "espn",
        "transcribed": True,
        "source": source_file,
        "humanSeats": _TEAMS,
        "autodraftShare": 0,
        "marketShare": 0,
        "adpFile": "adp-espn-ppr.json",
        "scoringType": "ppr",
        "qbFormat": "one-qb",
        "rounds": rounds,
        "replayUserId": f"espn-{tag}-t1",
        "rosterAssumption": "1QB 2RB 2WR 1TE 1FLEX 1K 1DEF (9 starters); bench = rounds - 9. "
        "Regenerate if the real roster slots differ.",
        "fantasyTeamNamesBySlot": {
            slot: next((p.get("fantasyTeam") for p in parsed if p.get("slot") == slot), None)
            for slot in range(1, _TEAMS + 1)
        },
    }
    (out_dir / "draft.json").write_text(json.dumps(draft, indent=2), encoding="utf-8")
    (out_dir / "picks.json").write_text(json.dumps(picks, indent=2), encoding="utf-8")
    (out_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"{dir_name}: parsed {len(parsed)}, resolved {len(resolved)}, unresolved {len(unresolved)}")
    for u in unresolved:
        print(u)
    return len(unresolved)


def main() -> int:
    players = json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))
    index = build_index(players)

    draft1 = (ROOT / "espn_draft1.txt").read_text(encoding="utf-8")
    draft2 = (ROOT / "espn_draft2.txt").read_text(encoding="utf-8")

    total_unresolved = 0
    total_unresolved += write_fixture(
        tag="d1",
        dir_name="2026-08-15-espn-10team",
        draft_name="ESPN 10-team PPR (draft 1)",
        source_file="espn_draft1.txt",
        parsed=parse_draft1(draft1),
        index=index,
        rounds=14,
    )
    total_unresolved += write_fixture(
        tag="d2",
        dir_name="espn-draft2-10team-16round",
        draft_name="ESPN 10-team PPR (draft 2)",
        source_file="espn_draft2.txt",
        parsed=parse_draft2(draft2),
        index=index,
        rounds=16,
    )
    if total_unresolved:
        print(f"\nFAILED: {total_unresolved} picks did not resolve — fix before using these fixtures.")
        return 1
    print("\nAll picks resolved. Fixtures written under fixtures/real-drafts/.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

