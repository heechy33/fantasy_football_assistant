"""Underdog best-ball ADP adapter (the separate best-ball lane).

Parses the draft-board payload from Underdog's *undocumented* community
endpoint — this module is pure (no HTTP); the CLI boundary in build_data.py
owns the single fetch and the fail-open wiring, same split as espn_adp.py.

Format separation IS the design: Underdog drafts are best-ball half-PPR
TE-premium, a different market from every redraft format this repo serves.
Its output lands in its own artifact / board key
(data/adp-underdog-bestball.json) and is used for display, decoration, and
as raw material for market-spread analysis — it is NEVER blended into the
redraft ADP composites and NEVER fed to the recommendation engine.

Fragility expectation: the endpoint is community-discovered with no published
schema. Like parse_espn_adp_rows, structural drift (missing players array /
non-object rows) raises ValueError so the caller fails closed; per-row
problems (missing/unusable ADP, unmapped positions) skip the row, not the
board. The caller additionally enforces a minimum matched-row count before
the artifact ships.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import match
import transform
from match import match_named_row
from transform import AdpEntry, fitted_stdev

# Positions Underdog best-ball actually drafts (no K, no DEF — verified
# against recorded fixtures; if that ever changes the rows simply start
# matching again once the position normalizes into Sleeper's vocabulary).
_UNDERDOG_POSITIONS = frozenset({"QB", "RB", "WR", "TE"})

# Top-level freshness keys seen across community endpoint revisions, checked
# in order; none present -> upstreamUpdatedAt stays None (honest unknown).
_UPDATED_AT_KEYS = ("updated_at", "updatedAt", "last_updated")


@dataclass(frozen=True)
class ParsedUnderdogRow:
    name: str
    team: str | None
    position: str
    underdog_id: str | None
    adp: float


def parse_underdog_adp_rows(payload: dict[str, Any]) -> list[ParsedUnderdogRow]:
    """Normalize Underdog's draft-board payload into Sleeper-vocab rows.

    Raises ValueError on schema drift (missing players array / non-object
    rows), same contract as parse_espn_adp_rows. Rows with no usable adp
    (missing, <= 0, non-finite), no name, or a position outside
    _UNDERDOG_POSITIONS are skipped, not raised.
    """
    raw_rows = payload.get("players")
    if not isinstance(raw_rows, list):
        raise ValueError("Underdog payload has no players array")
    rows: list[ParsedUnderdogRow] = []
    for raw in raw_rows:
        # Community payloads have historically been flat objects (unlike
        # ESPN's nested kona shape); anything else is drift worth failing on.
        if not isinstance(raw, dict):
            raise ValueError("Underdog player row is not an object")
        first = raw.get("first_name") or ""
        last = raw.get("last_name") or ""
        name = f"{first} {last}".strip()
        adp = raw.get("adp")
        if not name:
            continue
        if isinstance(adp, bool) or not isinstance(adp, (int, float)) or not math.isfinite(adp) or adp <= 0:
            continue
        try:
            position = match.normalize_position(str(raw.get("position") or ""))
        except ValueError:
            continue
        if position not in _UNDERDOG_POSITIONS:
            continue
        team = match.normalize_team(str(raw.get("team"))) if raw.get("team") else None
        underdog_id = str(raw["id"]) if raw.get("id") is not None else None
        rows.append(
            ParsedUnderdogRow(
                name=name,
                team=team,
                position=position,
                underdog_id=underdog_id,
                adp=float(adp),
            )
        )
    return rows


def extract_upstream_updated_at(payload: dict[str, Any]) -> str | None:
    """Best-effort freshness stamp off the payload; None when absent.

    Deliberately shallow (top-level keys only) and type-checked: an int epoch
    or nested object is NOT laundered into a fake ISO date — unknown stays
    unknown, same honesty rule as history.upstream_updated_at.
    """
    for key in _UPDATED_AT_KEYS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def build_underdog_adp_entries(
    rows: list[ParsedUnderdogRow],
    *,
    sleeper_index: dict[match.MatchKey, str],
    valid_player_ids: set[str],
    cv_bands: tuple[tuple[float, float], ...] = transform._DEFAULT_ADP_CV_BANDS,
) -> tuple[list[AdpEntry], dict[str, Any]]:
    """Crosswalk-match parsed rows onto the Sleeper pool.

    Identity goes through match_named_row (name/position, DEF-by-team) —
    the same provider-general rule FFC uses; Underdog publishes no Sleeper/
    ESPN ids, so there is no id fast path. Unmatched rows stay out of the
    artifact but are counted and sampled in diagnostics so a crosswalk
    regression is visible instead of silent. stdev is fitted_stdev over the
    redraft CV bands (Underdog publishes no dispersion field; half-PPR
    best-ball spread is close enough for decoration, and the artifact is
    never an engine input where the difference could matter).

    Returns `(entries sorted ascending by adp, diagnostics)` where
    diagnostics carries rawRows/matchedRows/unmatched for the manifest.
    """
    entries: list[AdpEntry] = []
    unmatched: list[str] = []
    for row in rows:
        player_id = match_named_row(row.name, row.position, row.team, sleeper_index)
        if player_id is None or player_id not in valid_player_ids:
            unmatched.append(f"{row.name} ({row.position})")
            continue
        entries.append(
            AdpEntry(
                playerId=player_id,
                name=row.name,
                position=row.position,
                team=row.team,
                adp=row.adp,
                stdev=fitted_stdev(row.adp, cv_bands),
                high=None,
                low=None,
                timesDrafted=None,
                byeWeek=None,  # backfilled from players.json by the caller
                adpSource="underdog",
                stdevSource="fitted",
            )
        )
    entries.sort(key=lambda entry: entry.adp)
    diagnostics = {
        "rawRows": len(rows),
        "matchedRows": len(entries),
        "unmatchedCount": len(unmatched),
        "unmatched": unmatched[:20],  # sample only — keep the manifest small
    }
    return entries, diagnostics
