"""Underdog best-ball ADP adapter (the separate best-ball lane).

Parses the server-rendered ADP table that Sharp Football Analysis republishes
(https://www.sharpfootballanalysis.com/fantasy/fantasy-football-adp-half-ppr-underdog-best-ball/).
This is a THIRD-PARTY REPUBLICATION of Underdog ADP, not Underdog's own feed:
the api.underdogfantasy.com best-ball draft boards sit behind login and their
pick'em API exposes no ADP path (verified 2026-08: every candidate endpoint
404s while over_under_lines 200s). The frontend tile and attribution string
label the lane accordingly. This module is pure (no HTTP); the CLI boundary in
build_data.py owns the single fetch and the fail-open wiring, same split as
espn_adp.py.

Format separation IS the design: Underdog drafts are best-ball half-PPR
TE-premium, a different market from every redraft format this repo serves.
Its output lands in its own artifact / board key
(data/adp-underdog-bestball.json) and is used for display, decoration, and
as raw material for market-spread analysis — it is NEVER blended into the
redraft ADP composites and NEVER fed to the recommendation engine.

Fragility expectation: the page is a third-party WordPress-table render with
no published schema. Like parse_espn_adp_rows, structural drift (no table
with the expected Player/POS/Team header row) raises ValueError so the caller
fails closed; per-row problems (missing/unusable ADP, unmapped positions)
skip the row, not the board. The caller additionally enforces a minimum
matched-row count before the artifact ships.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any

import html_table
import match
import transform
from match import match_named_row
from transform import AdpEntry, fitted_stdev

# Positions Underdog best-ball actually drafts (no K, no DEF — verified
# against recorded fixtures; if that ever changes the rows simply start
# matching again once the position normalizes into Sleeper's vocabulary).
_UNDERDOG_POSITIONS = frozenset({"QB", "RB", "WR", "TE"})

# The republication's column layout: Player | POS | Team | POS ADP | ADP |
# Prev ADP | Δ. Matched on the first six headers (lowercased); Δ and any
# trailing columns the publisher adds later are ignored. Column 4 ("ADP",
# overall — not the POS ADP in column 3) is the number this lane ships.
_EXPECTED_HEADER = ("player", "pos", "team", "pos adp", "adp", "prev adp")
_AD_COLUMN = 4

# Freshness lives in page prose, not metadata: "Underdog Fantasy ADP — Updated
# August 21". The dash reaches us variously as a literal em/en/ascii dash or an
# HTML entity (&#8212;) depending on how far upstream of the parser this runs.
# The publisher prints no year, so none is invented.
_UPDATED_AT_PATTERN = re.compile(
    r"Underdog Fantasy ADP\s*(?:&#\d+;|&#x[0-9a-fA-F]+;|[—–-])\s*Updated\s+([A-Z][a-z]+ \d{1,2}(?:, \d{4})?)"
)


@dataclass(frozen=True)
class ParsedUnderdogRow:
    name: str
    team: str | None
    position: str
    underdog_id: str | None
    adp: float


def _coerce_adp(cell: str) -> float | None:
    """Parse an ADP cell; None for anything unusable (skipped, never raised)."""
    try:
        value = float(cell.strip())
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value) or value <= 0:
        return None
    return value


def parse_underdog_adp_rows(page_html: str) -> list[ParsedUnderdogRow]:
    """Normalize the republication's ADP table into Sleeper-vocab rows.

    Raises ValueError on structural drift (no table whose header row matches
    _EXPECTED_HEADER), same contract as parse_espn_adp_rows. Rows with no
    usable adp (missing, <= 0, non-finite), no name, or a position outside
    _UNDERDOG_POSITIONS are skipped, not raised.

    team is deliberately None on every row: match_named_row uses team only
    for DEF-by-team resolution, Underdog drafts no DEF (_UNDERDOG_POSITIONS),
    and the page publishes full team names ("Detroit Lions") that would need
    an abbreviation mapping nobody consumes.
    """
    parser = html_table.TableParser()
    parser.feed(page_html)
    for table in parser.tables:
        if not table or len(table[0]) <= _AD_COLUMN:
            continue
        header = tuple(cell.strip().lower() for cell in table[0][: len(_EXPECTED_HEADER)])
        if header != _EXPECTED_HEADER:
            continue
        rows: list[ParsedUnderdogRow] = []
        for raw in table[1:]:
            if len(raw) <= _AD_COLUMN:
                continue  # malformed row shape — skip the row, not the board
            name = raw[0].strip()
            if not name:
                continue
            adp = _coerce_adp(raw[_AD_COLUMN])
            if adp is None:
                continue
            try:
                position = match.normalize_position(raw[1])
            except ValueError:
                continue
            if position not in _UNDERDOG_POSITIONS:
                continue
            rows.append(
                ParsedUnderdogRow(
                    name=name,
                    team=None,
                    position=position,
                    underdog_id=None,  # the republication publishes no provider ids
                    adp=adp,
                )
            )
        return rows
    raise ValueError("Underdog page has no ADP table with the expected Player/POS/Team header")


def extract_upstream_updated_at(page_html: str) -> str | None:
    """Best-effort freshness stamp off the page prose; None when absent.

    The republication prints "*Underdog Fantasy ADP — Updated August 21"
    above the table. Deliberately verbatim: the publisher prints no year, so
    none is invented — unknown stays unknown, same honesty rule as
    history.upstream_updated_at (an unparsable date is NOT laundered into a
    fabricated ISO string).
    """
    found = _UPDATED_AT_PATTERN.search(page_html)
    return found.group(1) if found else None


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
