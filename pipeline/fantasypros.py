"""
Parses the local-only FantasyPros draft-rankings CSV into the gitignored
`fantasypros-stars.json` decoration artifact (see
FRONTEND_OVERHAUL_PHASE_1_REVISED_PLAN.md, sections 3 and 5). Pure — no HTTP,
environment reads, filesystem reads, or writes; the CLI boundary in
build_data.py owns reading the CSV file and writing the resulting artifact.

FantasyPros-derived fields (upside/bust/SOS stars, ECR-vs-ADP) are display-only
decoration for the player card. They must never reach buildRecommendationBoard,
availability, simulation, or ranking comparators — see PLAN.md
and the phase plan's "Non-negotiable behavior" section. The overall ADP file
(`FantasyPros_2026_Overall_ADP_Rankings.csv`) is parsed only into the
local-only, display-only `fantasypros-adp.json` (see fantasypros_adp.py);
Sleeper lobby ADP plus the FFC fallback remains the only ADP provenance the
engine consumes.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from match import MatchKey, match_named_row, normalize_position, normalize_team

FANTASYPROS_STARS_SCHEMA_VERSION = 1

# Exact header the current (2026) FantasyPros export uses, including the
# trailing spaces on "UPSIDE " and "BUST " and the renamed "SOS SEASON" /
# "ECR VS. ADP" columns (the 2025-era export used "SOS" and "ECR VS ADP").
# Verified against the 41628-byte 2026-08-15 export. A renamed/reordered
# header is schema drift, not something to silently tolerate.
_REQUIRED_HEADERS = (
    "RK",
    "TIERS",
    "PLAYER NAME",
    "TEAM",
    "POS",
    "UPSIDE ",
    "BUST ",
    "SOS SEASON",
    "ECR VS. ADP",
)

_STAR_WORDS = {
    "1": 1, "2": 2, "3": 3, "4": 4, "5": 5,
    "0": 0,
}


@dataclass
class FantasyProsRow:
    rank: int
    tier: int | None
    name: str
    team: str | None
    position: str
    position_rank: str
    upside: int | None
    bust: int | None
    sos: int | None
    ecr_vs_adp: int | None


def parse_star(value: object, *, allow_zero: bool = False) -> int | None:
    """Parse a `"N out of 5"` / `"N out of 5 stars"` cell into an int 0-5,
    or None for missing (`None`, blank, `-`). Zero is only a legal *value*
    when `allow_zero=True` (SOS permits a genuine zero-star row; Upside/Bust
    do not per the phase plan's evidence section). Anything else malformed
    raises ValueError — a source-quality issue must surface, not silently
    become null.
    """
    if value is None:
        return None
    text = str(value).strip()
    if text in ("", "-"):
        return None

    lowered = text.lower()
    parts = lowered.split(" ", 1)
    if len(parts) != 2 or parts[0] not in _STAR_WORDS:
        raise ValueError(f"Malformed star value: {value!r}")
    head, rest = parts[0], parts[1].strip()
    if rest not in ("out of 5", "out of 5 stars"):
        raise ValueError(f"Malformed star value: {value!r}")

    stars = _STAR_WORDS[head]
    if stars == 0 and not allow_zero:
        raise ValueError(f"Zero stars not permitted for this field: {value!r}")
    return stars


def parse_signed_int(value: object) -> int | None:
    """Parse a signed integer cell (`"+2"`, `"0"`, `"-163"`). A bare `"-"` (or
    blank/None) means missing and must return None *before* any int()
    conversion is attempted — int("-") raises ValueError, which would
    otherwise misreport a legitimate "missing" sentinel as a parse failure.
    """
    if value is None:
        return None
    text = str(value).strip()
    if text in ("", "-"):
        return None
    return int(text)


def _dropped_junk_row(row: dict[str, str]) -> bool:
    return (row.get("RK") or "").strip() == "AD"


def parse_rankings_csv(text: str) -> tuple[list[FantasyProsRow], dict[str, Any]]:
    """Parse already-decoded FantasyPros draft-rankings CSV text.

    Returns (rows, diagnostics). Diagnostics carries counts the caller (or
    build_stars_artifact) needs to reconcile against matching results:
    `rowsScanned`, `droppedNonRankRows`, `rows` (ranked rows kept).
    """
    reader = csv.DictReader(io.StringIO(text))
    fieldnames = reader.fieldnames or []
    missing = [h for h in _REQUIRED_HEADERS if h not in fieldnames]
    if missing:
        raise ValueError(f"FantasyPros CSV missing required header(s): {missing}")

    rows: list[FantasyProsRow] = []
    rows_scanned = 0
    dropped_non_rank_rows = 0

    for raw in reader:
        rows_scanned += 1
        if _dropped_junk_row(raw):
            dropped_non_rank_rows += 1
            continue

        rank_text = (raw.get("RK") or "").strip()
        try:
            rank = int(rank_text)
        except ValueError as exc:
            raise ValueError(f"FantasyPros CSV row has non-integer RK: {raw.get('RK')!r}") from exc

        tier_text = (raw.get("TIERS") or "").strip()
        tier = int(tier_text) if tier_text else None

        name = (raw.get("PLAYER NAME") or "").strip()
        raw_position = (raw.get("POS") or "").strip()
        position_rank = raw_position
        position = normalize_position(raw_position)
        team = normalize_team(raw.get("TEAM"))

        rows.append(
            FantasyProsRow(
                rank=rank,
                tier=tier,
                name=name,
                team=team,
                position=position,
                position_rank=position_rank,
                upside=parse_star(raw.get("UPSIDE ")),
                bust=parse_star(raw.get("BUST ")),
                sos=parse_star(raw.get("SOS SEASON"), allow_zero=True),
                ecr_vs_adp=parse_signed_int(raw.get("ECR VS. ADP")),
            )
        )

    diagnostics = {
        "rowsScanned": rows_scanned,
        "droppedNonRankRows": dropped_non_rank_rows,
        "rows": len(rows),
    }
    return rows, diagnostics


def build_stars_artifact(
    rows: list[FantasyProsRow],
    sleeper_index: dict[MatchKey, str],
    season: int,
    source_file: str,
    generated_at: str,
    dropped_non_rank_rows: int = 0,
) -> dict[str, Any]:
    """Match parsed rows against the Sleeper identity index and assemble the
    self-describing local artifact. Every row appears exactly once — matched
    in `players` or unmatched in `unmatched`; a match failure is a real,
    surfaced miss, never silently dropped (same rule as match_ffc_entry).

    `dropped_non_rank_rows` comes from parse_rankings_csv diagnostics: ranked
    `rows` no longer contain the `RK == AD` junk lines, so the count must be
    supplied explicitly rather than reconstructed here.
    """
    players: dict[str, dict[str, Any]] = {}
    unmatched: list[dict[str, Any]] = []

    def _unmatched_entry(row: FantasyProsRow) -> dict[str, Any]:
        return {
            "rank": row.rank,
            "name": row.name,
            "team": row.team,
            "position": row.position,
        }

    for row in rows:
        player_id = match_named_row(row.name, row.position, row.team, sleeper_index)
        if player_id is None:
            unmatched.append(_unmatched_entry(row))
            continue
        # Two ranked rows resolving to the same sleeper_id cannot both occupy
        # players[id]. Keep the first match and surface the duplicate in
        # unmatched so matched + unmatched == rows still holds.
        if player_id in players:
            unmatched.append(_unmatched_entry(row))
            continue
        players[player_id] = {
            "rank": row.rank,
            "tier": row.tier,
            "upside": row.upside,
            "bust": row.bust,
            "sos": row.sos,
            "ecrVsAdp": row.ecr_vs_adp,
            "positionRank": row.position_rank,
        }

    return {
        "schemaVersion": FANTASYPROS_STARS_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "season": season,
        "source": {
            "name": "fantasypros-draft-rankings-csv",
            "file": Path(source_file).name,
            "rows": len(rows),
            "droppedNonRankRows": dropped_non_rank_rows,
            "matched": len(players),
            "unmatched": len(unmatched),
            "status": "ok",
        },
        "players": players,
        "unmatched": unmatched,
    }
