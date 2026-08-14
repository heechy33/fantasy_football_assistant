"""Parses the local-only FantasyPros Overall ADP CSV
(`FantasyPros_<season>_Overall_ADP_Rankings.csv`) into the gitignored
`fantasypros-adp.json` decoration artifact. Pure — no HTTP, environment reads,
filesystem reads, or writes; the CLI boundary in build_data.py owns reading the
CSV and writing the artifact (via the shared `_run_optional_local_csv_artifact`
skeleton).

Display-only, same contract as the stars artifact: these per-site ADP numbers
must never reach buildRecommendationBoard, availability,
simulation, or any ranking comparator. Sleeper lobby ADP plus the FFC fallback
remains the only ADP provenance the engine consumes.

Matching uses match_named_row (normalized name/position, team-keyed DEF), NOT
ids.fantasypros: the CSV has no FantasyPros id column, and all 32 DEF rows in
players.json carry empty `ids: {}` (Sleeper DEF player ids are team
abbreviations, e.g. "ARI"), so a DEF needs only its team. Do not "optimize"
this onto the id crosswalk later.
"""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from match import MatchKey, match_named_row, normalize_def_team_name, normalize_position, normalize_team
from transform import FANTASY_POSITIONS

FANTASYPROS_ADP_SCHEMA_VERSION = 1

# Exact ordered header the supplied file uses — verified against the real
# 592-row export. A subset check would let a newly added Yahoo column vanish
# silently; a renamed/reordered header is schema drift and the right outcome is
# a ValueError (skipped local artifact), never a silent reshape.
_REQUIRED_HEADERS = (
    "Rank",
    "Player (Bye)",
    "POS",
    "ESPN",
    "Sleeper",
    "CBS",
    "NFL",
    "RTSports",
    "Fantrax",
    "AVG",
    "Real-Time",
)

# Real per-site ADP columns, in header order. NFL is present in the header but
# carries zero non-blank cells in the real file — it is recorded in
# source.emptyColumns (so the omission is visible) rather than silently dropped.
_ADP_PROVIDER_COLUMNS = ("ESPN", "Sleeper", "CBS", "RTSports", "Fantrax")

# Every per-site ADP column including NFL, used only for the emptiness scan —
# an all-blank NFL must be recorded in emptyColumns, never silently dropped.
_ADP_COLUMNS_INCLUDING_EMPTY = ("ESPN", "Sleeper", "CBS", "NFL", "RTSports", "Fantrax")

_PROVIDER_LABELS = {
    "ESPN": "ESPN",
    "Sleeper": "Sleeper",
    "CBS": "CBS",
    "RTSports": "RTSports",
    "Fantrax": "Fantrax",
}

# The 2+ space run separates the player from the trailing "TEAM (bye)" (or just
# "(bye)" on DEF rows). Splitting on the last space instead would break any name
# containing spaces plus a generational suffix ("Amon-Ra St. Brown", "James Cook III").
_SPLIT_RE = re.compile(r"\s{2,}")
_TEAM_BYE_RE = re.compile(r"^([A-Z.]{2,4})\s*\((\d{1,2})\)$")
_BYE_ONLY_RE = re.compile(r"^\((\d{1,2})\)$")
_DST_SUFFIX_RE = re.compile(r"\s+(?:DST|D/ST|D)$", re.IGNORECASE)

# Allows the optional '+' sign too: Real-Time deltas are signed integers ("224  +76").
_NUM_RE = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$")


@dataclass
class FantasyProsAdpRow:
    rank: int
    name: str
    team: str | None
    position: str
    position_rank: str
    bye: int | None
    adp: dict[str, float]
    avg: float | None
    real_time: dict[str, int | None] | None


def _optional_float(value: object, label: str) -> float | None:
    """Blank/`-`/`—` mean the provider carries no value → the key is absent,
    never null. Anything else non-numeric is a source-quality failure and must
    surface (skips the local artifact) rather than silently becoming nothing."""
    text = str(value).strip() if value is not None else ""
    if not text or text in {"-", "—", "n/a", "N/A"}:
        return None
    if not _NUM_RE.match(text):
        raise ValueError(f"FantasyPros ADP malformed numeric cell ({label}): {value!r}")
    parsed = float(text)
    if not math.isfinite(parsed) or parsed < 0:
        raise ValueError(f"FantasyPros ADP non-finite/negative cell ({label}): {value!r}")
    return parsed


def _parse_team_bye(text: str, rank: int, cell: str) -> tuple[str | None, int | None]:
    """`DET (6)` → ("DET", 6). JAC folds to JAX via normalize_team. An unsigned
    team (FA) still yields its bye; the name+position key is what non-DEF rows
    actually match on, so a free-agent team here is not an identity failure."""
    match = _TEAM_BYE_RE.match(text)
    if not match:
        raise ValueError(f"FantasyPros ADP rank {rank} malformed Player (Bye) team cell: {cell!r}")
    return normalize_team(match.group(1)), int(match.group(2))


def _parse_bye(text: str | None, rank: int, cell: str) -> int | None:
    if text is None:
        return None
    match = _BYE_ONLY_RE.match(text.strip())
    if not match:
        raise ValueError(f"FantasyPros ADP rank {rank} malformed DEF bye cell: {cell!r}")
    return int(match.group(1))


def _parse_real_time(value: object, rank: int) -> dict[str, int | None] | None:
    """`224  +76` → {"rank": 224, "delta": 76}. Real-Time is an integer rank plus
    a movement delta — never a fractional ADP and never mixed into the adp{}
    numeric namespace. Blank → absent. Rank-only cells keep delta: null."""
    text = str(value).strip() if value is not None else ""
    if not text or text in {"-", "—"}:
        return None
    pieces = text.split()
    if not pieces or len(pieces) > 2 or any("." in piece or not _NUM_RE.match(piece) for piece in pieces):
        raise ValueError(f"FantasyPros ADP rank {rank} malformed Real-Time cell: {value!r}")
    return {
        "rank": int(pieces[0]),
        "delta": int(pieces[1]) if len(pieces) == 2 else None,
    }


def parse_adp_csv(text: str) -> tuple[list[FantasyProsAdpRow], list[str]]:
    """Parse the whole CSV into normalized rows plus the list of provider columns
    that were entirely blank (their omission must be visible in the artifact, not
    silent). Raises ValueError on header drift or any malformed cell."""
    reader = csv.DictReader(io.StringIO(text))
    headers = tuple((header or "").strip() for header in reader.fieldnames or ())
    if headers != _REQUIRED_HEADERS:
        raise ValueError(
            "FantasyPros ADP header drift: expected {0}, got {1}".format(
                ", ".join(_REQUIRED_HEADERS), ", ".join(headers)
            )
        )
    raw_rows = list(reader)
    empty_columns = [
        column for column in _ADP_COLUMNS_INCLUDING_EMPTY
        if not any((row.get(column) or "").strip() for row in raw_rows)
    ]

    rows: list[FantasyProsAdpRow] = []
    for raw in raw_rows:
        rank_text = (raw.get("Rank") or "").strip()
        if not _NUM_RE.match(rank_text) or "." in rank_text:
            raise ValueError(f"FantasyPros ADP row has invalid Rank: {rank_text!r}")
        rank = int(rank_text)

        cell = (raw.get("Player (Bye)") or "").strip()
        if not cell:
            raise ValueError(f"FantasyPros ADP rank {rank} has an empty Player (Bye) cell")
        raw_position = (raw.get("POS") or "").strip()
        if not raw_position:
            raise ValueError(f"FantasyPros ADP rank {rank} has an empty POS cell")

        position_rank = raw_position
        position = normalize_position(raw_position)
        parts = _SPLIT_RE.split(cell)

        if position == "DEF":
            # Shape b: "Houston Texans DST   (8)" — full franchise name, no
            # abbreviation. The DST suffix is stripped and the franchise resolved
            # through DEF_TEAM_NAMES; an unknown franchise raises.
            name = parts[0].strip()
            franchise = _DST_SUFFIX_RE.sub("", name).strip()
            if not franchise:
                raise ValueError(f"FantasyPros ADP rank {rank} DEF cell has no franchise name: {cell!r}")
            team = normalize_def_team_name(franchise)
            bye = _parse_bye(parts[1] if len(parts) > 1 else None, rank, cell)
            if len(parts) > 2:
                raise ValueError(f"FantasyPros ADP rank {rank} has an unexpected DEF Player (Bye) shape: {cell!r}")
        else:
            # Shape a: "Jahmyr Gibbs   DET (6)". Shape c: bare "Tyreek Hill" —
            # free agents / retired still match by (name, position).
            name = parts[0].strip()
            team: str | None = None
            bye: int | None = None
            if len(parts) > 1:
                team, bye = _parse_team_bye(parts[1], rank, cell)
            if len(parts) > 2:
                raise ValueError(f"FantasyPros ADP rank {rank} has an unexpected Player (Bye) shape: {cell!r}")

        adp: dict[str, float] = {}
        for column in _ADP_PROVIDER_COLUMNS:
            if column in empty_columns:
                continue
            value = _optional_float(raw.get(column), f"rank {rank} {column}")
            if value is not None:
                adp[column.lower()] = value

        rows.append(
            FantasyProsAdpRow(
                rank=rank,
                name=name,
                team=team,
                position=position,
                position_rank=position_rank,
                bye=bye,
                adp=adp,
                avg=_optional_float(raw.get("AVG"), f"rank {rank} AVG"),
                real_time=_parse_real_time(raw.get("Real-Time"), rank),
            )
        )
    return rows, empty_columns


def _unmatched_entry(row: FantasyProsAdpRow, reason: str) -> dict[str, Any]:
    return {
        "rank": row.rank,
        "name": row.name,
        "team": row.team,
        "position": row.position,
        "reason": reason,
    }


def build_adp_artifact(
    rows: list[FantasyProsAdpRow],
    sleeper_index: dict[MatchKey, str],
    *,
    valid_player_ids: set[str],
    season: int,
    source_file: str,
    generated_at: str,
    empty_columns: list[str],
) -> dict[str, Any]:
    """Match every parsed row onto the Sleeper identity index and assemble the
    self-describing local artifact. Every row lands exactly once — in `players`
    or in `unmatched` — with `matched + len(unmatched) == len(rows)` (the same
    never-silently-drop rule as the stars artifact and match_ffc_entry).

    Positions outside FANTASY_POSITIONS (the stray LB row, rank 549) are rejected
    before matching: build_sleeper_match_index indexes the whole ~14k Sleeper
    pool including IDP, so ("ben vansumeren", "LB") would resolve a sleeper_id
    that build_player_meta filtered out of players.json — a key the frontend can
    never resolve. `valid_player_ids` (the players.json population) then routes
    anything else missing from the pool to unmatched rather than leaving a hole.
    """
    players: dict[str, dict[str, Any]] = {}
    unmatched: list[dict[str, Any]] = []
    provider_keys = [column.lower() for column in _ADP_PROVIDER_COLUMNS if column not in empty_columns]
    provider_counts: dict[str, int] = {key: 0 for key in provider_keys}
    provider_matched: dict[str, int] = {key: 0 for key in provider_keys}
    consensus_rows = 0
    real_time_rows = 0
    matched = 0

    for row in rows:
        consensus_rows += 1
        for key in provider_keys:
            if key in row.adp:
                provider_counts[key] += 1
        if row.real_time is not None:
            real_time_rows += 1

        if row.position not in FANTASY_POSITIONS:
            unmatched.append(_unmatched_entry(row, "non-fantasy-position"))
            continue
        player_id = match_named_row(row.name, row.position, row.team, sleeper_index)
        if player_id is None or player_id not in valid_player_ids:
            unmatched.append(_unmatched_entry(row, "not-in-player-pool"))
            continue
        if player_id in players:
            # Two ranked rows resolving to the same sleeper_id cannot both occupy
            # players[id]. Keep the first and surface the duplicate in unmatched
            # so matched + len(unmatched) == len(rows) still holds.
            unmatched.append(_unmatched_entry(row, "duplicate-match"))
            continue

        entry: dict[str, Any] = {
            "rank": row.rank,
            "positionRank": row.position_rank,
        }
        if row.avg is not None:
            entry["avg"] = row.avg
        if row.real_time is not None:
            entry["realTime"] = row.real_time
        if row.adp:
            entry["adp"] = row.adp
        players[player_id] = entry
        matched += 1
        for key in provider_keys:
            if key in row.adp:
                provider_matched[key] += 1

    assert matched + len(unmatched) == len(rows), "FantasyPros ADP row accounting mismatch"
    assert matched == len(players), "FantasyPros ADP matched/players mismatch"

    return {
        "schemaVersion": FANTASYPROS_ADP_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "season": season,
        "source": {
            "name": "fantasypros-overall-adp-csv",
            "file": Path(source_file).name,
            "rows": len(rows),
            "matched": matched,
            "unmatched": len(unmatched),
            "emptyColumns": empty_columns,
            "status": "ok",
        },
        "providers": [
            {"key": column.lower(), "label": _PROVIDER_LABELS[column], "rows": provider_counts[column.lower()], "matchedRows": provider_matched[column.lower()]}
            for column in _ADP_PROVIDER_COLUMNS
            if column not in empty_columns
        ],
        # AVG is FantasyPros' consensus figure, not a site — it gets its own
        # namespace. Real-Time is a rank+delta, likewise never an ADP.
        "consensus": {"key": "avg", "label": "FantasyPros AVG", "rows": consensus_rows},
        "realTime": {"key": "realTime", "label": "FantasyPros Real-Time", "rows": real_time_rows},
        "players": players,
        "unmatched": unmatched,
    }


