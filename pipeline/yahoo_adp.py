"""Yahoo draft-analysis ADP adapter (the engine board for Yahoo drafts).

Yahoo's unauthenticated, public-facing draft-analysis page is at
`football.fantasysports.yahoo.com/f1/draftanalysis?type=<standard|half-ppr|ppr>`.
The page itself is a JS-rendered React shell -- the data hydrates from
Yahoo's own internal `publicDraftAnalysis` API after the page loads, so a
plain `requests.get` returns an 887 KB shell with zero player rows. To
extract the data we render the page in headless Chromium via Playwright
(verified 2026-09-01: 1197 rows for `type=half-ppr&count=2000`), then
parse the rendered HTML table.

The same renderer pattern is used by Sharp Football Analysis's
Underdog-best-ball republication (pipeline/underdog_adp.py) -- different
source, same shape. The fallback behavior is also identical: fetch error,
schema drift, or too few head rows all fail open with a `[warn]` line and
the manifest records the source as `'error'`; the caller leaves
`adp-yahoo-<fmt>.json` untouched. Yahoo publishes no freshness stamp on
the page so `upstreamUpdatedAt` is explicit `None`.

This module is pure (no HTTP); the CLI boundary in build_data.py owns
the Playwright render + the fail-open wiring.

The DEF row identity rule mirrors espn_adp.py: never match on Yahoo's
negative synthetic DEF ids (Yahoo publishes the same `*-16033`-shape
synthetics for DST), resolve `editorial_team_abbr` -> Sleeper DEF id.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any

from match import MatchKey, match_named_row
from transform import AdpEntry, fitted_stdev_for_player

# Yahoo's draft-analysis page is 25-30 rows by default; we ask for 2000 to
# get the full board in one render. Verified 2026-09-01: count=2000 returns
# 1197 rows for half-ppr, ~1500 for ppr/standard, well above YAHOO_ADP_MIN_ROWS.
YAHOO_PAGE_COUNT = 2000

# Yahoo's draft-analysis endpoint and the three game_types it actually serves
# (NOT 2qb -- Yahoo's public draft_analysis never offers superflex/2qb).
YAHOO_DRAFT_ANALYSIS_URL = "https://football.fantasysports.yahoo.com/f1/draftanalysis"
YAHOO_GAME_TYPE_TO_PARAM = {
    "standard": "standard",
    "half-ppr": "half-ppr",
    "ppr": "ppr",
}

# Yahoo publishes an `Editorial Team Abbr` token in the same cell as the
# position (e.g. "Det - RB"). The team is 2-3 mixed-case letters
# (Det, Atl, SF, KC, JAC, ...); the position is one of {QB, RB, WR, TE, K,
# DEF}. Anchoring on a known position prevents matching inside the player
# name -- e.g. "McCaffreySF" would otherwise match `ySF` as a "team".
# The team must be at the start of the cell OR preceded by a space
# (the player name ends in a lowercase letter, but there's a
# ` ` between the player name and the team in the rendered HTML even
# though the post-TableParser text collapse erases it). Wait, actually
# post-collapse there's no space -- the player name and team are
# literally concatenated. The only correct anchor is: the team must be
# the LAST `[A-Z][a-z]*[A-Z]`-prefixed run before ` - POS`. We approximate
# that with a right-anchored regex: the match must end at the position
# group. We try three team shapes: all-caps 3-letter (LAR, SFO),
# mixed-case 3-letter (Det, Atl), and mixed-case 2-letter (KC, JAC).
# The position is a known fantasy slot optionally followed by a single
# letter injury tag (Q = questionable, D = doubtful, O = out, etc).
# The greedy `finditer` returns the LAST match, which is the real one.
_TEAM_POSITION_RE = re.compile(r"([A-Z]{3}|[A-Z][a-z]{1,2}|[A-Z]{2})\s*-\s*(QB|RB|WR|TE|K|DEF)[A-Z]?")

# The six fantasy-relevant positions. Yahoo occasionally publishes a
# non-fantasy position (OL, LS, P, ...) which we have no use for and
# match_named_row can't resolve. Same filter as parse_yahoo_adp_rows (the
# superseded JSON-based parser this module replaces) had.
_YAHOO_FANTASY_POSITIONS = frozenset({"QB", "RB", "WR", "TE", "K", "DEF"})

# Bin width (in picks) used to density-bin the ADP curve for the censor-cliff
# detector. The Yahoo feed's honest head is roughly one row per pick, the
# saturation tail is denser at the cliff, so 5-pick bins give a clean
# signal-to-noise ratio.
_CENSOR_BIN = 5.0
# Region whose per-pick density is "normal" -- no real draft's head saturates
# this band (the head is roughly 1 row per pick, i.e. density 0.2/bin), so it
# is the baseline for what honest density looks like.
_CENSOR_BASELINE_RANGE = (24.0, 100.0)
# A bin must exceed the baseline median by this many times to count as the
# sentinel cliff. The measured live spike is ~8-15x baseline (Yahoo's
# undrafted saturation tail is denser than ESPN's), so 4x is a wide margin
# against ordinary density noise.
_CENSOR_SPIKE_FACTOR = 4.0
# A cutoff below this means the payload is degenerate (Yahoo drafts don't
# saturate at pick 100) -- raise rather than ship a mangled board.
_CENSOR_MIN_CUTOFF = 100.0


@dataclass(frozen=True)
class ParsedYahooAdpRow:
    name: str
    team: str | None
    position: str
    yahoo_id: str | None
    adp: float
    percent_drafted: float | None


def _coerce_adp(cell: str) -> float | None:
    """Parse an ADP cell; None for anything unusable (skipped, never raised)."""
    if cell is None:
        return None
    s = cell.strip()
    if not s or s == "-":
        return None
    try:
        value = float(s)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    return value


def _coerce_percent(cell: str) -> float | None:
    """Parse a `%Drafted` cell like '100%' or '-' into a 0..1 float, or None."""
    if cell is None:
        return None
    s = cell.strip().rstrip("%").strip()
    if not s or s == "-":
        return None
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    if v < 0 or v > 100:
        return None
    return v / 100.0


def _coerce_yahoo_id_from_link(href: str) -> str | None:
    """Yahoo player rows link to `https://sports.yahoo.com/nfl/players/<id>/news/`.

    The integer id is the second-to-last path component. The legacy
    `football.fantasysports.yahoo.com/f1/<id>/...` form is also matched
    for any older rendered page; whichever shape survives is fine.
    """
    if not href:
        return None
    m = re.search(r"/(?:nfl/players|f1)/(\d+)(?:/|$)", href)
    return m.group(1) if m else None


class _YahooTableParser(HTMLParser):
    """Yahoo-specific table reader that preserves `<a href>` per cell.

    The shared html_table.TableParser flattens all child nodes into a single
    text string, which loses the yahoo_id encoded in the player row's
    anchor href and the team-position cell's text boundary. This parser
    keeps each cell as `(text, href)` so the row assembler can split
    `"Jahmyr GibbsDet - RB"` into player/team/position correctly via
    regex, and grab the integer id off the href.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[tuple[str, str | None]]] = []
        self._in_table = False
        self._in_row = False
        self._in_cell = False
        self._in_anchor = False
        self._row: list[tuple[str, str | None]] | None = None
        self._cell_text: list[str] = []
        self._cell_href: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "table" and self._in_table is False:
            self._in_table = True
        elif tag == "tr" and self._in_table:
            self._in_row = True
            self._row = []
        elif tag in {"th", "td"} and self._in_row:
            self._in_cell = True
            self._cell_text = []
            self._cell_href = None
        elif tag == "a" and self._in_cell:
            self._in_anchor = True
            for k, v in attrs:
                if k == "href" and v:
                    self._cell_href = v

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"th", "td"} and self._in_cell:
            text = " ".join("".join(self._cell_text).split())
            if self._row is not None:
                self._row.append((text, self._cell_href))
            self._in_cell = False
        elif tag == "a" and self._in_anchor:
            self._in_anchor = False
        elif tag == "tr" and self._in_row:
            if self._row:
                self.rows.append(self._row)
            self._in_row = False
            self._row = None
        elif tag == "table" and self._in_table:
            self._in_table = False

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell_text.append(data)


# Yahoo's player cell is rendered as `<a href=".../players/<id>/news/">NAME</a><div>TEAM - POS</div>`,
# with an optional trailing `Q`/`D`/`OUT` injury tag on the same div. After
# TableParser text-flattening, the cell reads like `"Jahmyr GibbsDet - RB"`
# (no separator) or `"Ja'Marr ChaseCin - WRQ"`. We split on the LAST
# match of the team-position pattern to recover the player name.
def _split_player_and_team_position(cell_text: str) -> tuple[str, str | None]:
    """Split a Yahoo player cell like 'Jahmyr GibbsDet - RB' into (name, 'Det - RB')."""
    matches = list(_TEAM_POSITION_RE.finditer(cell_text))
    if not matches:
        return cell_text, None
    last = matches[-1]
    name = cell_text[: last.start()].strip()
    composite = cell_text[last.start():].strip()
    return name, composite


def parse_yahoo_adp_rows(rendered_html: str) -> list[ParsedYahooAdpRow]:
    """Normalize the rendered draft-analysis HTML table into Sleeper-vocab rows.

    Raises ValueError on structural drift (no table whose header row matches
    the documented Yahoo column layout), same contract as parse_underdog_adp_rows.
    Rows with no usable adp (missing, '<= 0', '-'), no name, or a position
    outside `_YAHOO_FANTASY_POSITIONS` are skipped, not raised.
    """
    parser = _YahooTableParser()
    parser.feed(rendered_html)
    if not parser.rows:
        raise ValueError("Yahoo draft-analysis HTML contained no table rows")
    if len(parser.rows) < 3:
        raise ValueError("Yahoo draft-analysis table has fewer than 3 rows (header + col + 1 data)")

    # First row is a column-group header; second is the actual column-header row.
    header = tuple(cell[0].strip().lower() for cell in parser.rows[1])
    expected_first_cells = ("player", "rank", "pos rank")
    if header[: len(expected_first_cells)] != expected_first_cells:
        raise ValueError(
            f"Yahoo draft-analysis table header does not start with {expected_first_cells}: got {header[:5]}"
        )

    # Resolve column indices from the second row's keywords. Match is
    # case-insensitive (Yahoo renders the header in title case, sometimes
    # "Rank" / "ALL DRAFTS"). "all drafts" is matched exactly to avoid the
    # Plus / premium variant "all drafts 💎" (different cell entirely).
    rank_idx = pos_rank_idx = drafted_idx = all_drafts_idx = None
    for i, (txt, _) in enumerate(parser.rows[1]):
        c = txt.strip().lower()
        if c == "rank":
            rank_idx = i
        elif c == "pos rank":
            pos_rank_idx = i
        elif c in ("%drafted", "percentdrafted"):
            drafted_idx = i
        elif c == "all drafts":
            all_drafts_idx = i
    if rank_idx is None or all_drafts_idx is None:
        raise ValueError(
            f"Yahoo draft-analysis table missing rank or all-drafts column: header={header}"
        )

    rows: list[ParsedYahooAdpRow] = []
    for raw in parser.rows[2:]:
        needed_max = max(rank_idx, all_drafts_idx) + 1
        if len(raw) < needed_max:
            continue

        player_cell_text, player_href = raw[0]
        name, composite = _split_player_and_team_position(player_cell_text)
        if not name:
            continue
        yahoo_id = _coerce_yahoo_id_from_link(player_href)

        # Team + position live in the team-position cell (cell index 1 in
        # the standard column layout, but Yahoo occasionally omits Pos Rank
        # so the composite can shift to cell 2). Probe both.
        team: str | None = None
        position: str | None = None
        if composite is not None:
            m = _TEAM_POSITION_RE.match(composite)
            if m:
                team = m.group(1).upper()
                position = m.group(2).upper()
        if position is None:
            for i in (1, 2):
                if i >= len(raw):
                    continue
                cell_text = raw[i][0]
                m2 = _TEAM_POSITION_RE.search(cell_text)
                if m2:
                    team = m2.group(1).upper()
                    position = m2.group(2).upper()
                    break
        if position is None:
            continue
        # Yahoo appends a one-letter injury tag (Q/D/OUT/IR/...) to the
        # position token. Strip trailing single letters so the position
        # matches one of `_YAHOO_FANTASY_POSITIONS`. Multi-letter positions
        # (none currently) would not match the stripped form; that's fine
        # because no Yahoo-served position is currently multi-letter.
        if position[-1] not in _YAHOO_FANTASY_POSITIONS and len(position) > 2:
            position = position[:-1]
        if position not in _YAHOO_FANTASY_POSITIONS:
            continue

        # Use rank as the primary ADP; fall back to all_drafts if rank is blank.
        rank_cell = raw[rank_idx][0] if rank_idx is not None else ""
        adp = _coerce_adp(rank_cell)
        if adp is None:
            adp = _coerce_adp(raw[all_drafts_idx][0])
        if adp is None:
            continue

        percent_drafted = (
            _coerce_percent(raw[drafted_idx][0])
            if drafted_idx is not None and drafted_idx < len(raw)
            else None
        )

        rows.append(
            ParsedYahooAdpRow(
                name=name,
                team=team,
                position=position,
                yahoo_id=yahoo_id,
                adp=adp,
                percent_drafted=percent_drafted,
            )
        )
    return rows


def detect_censor_cutoff(adps: list[float]) -> float | None:
    """Lower edge of the first density spike, or None when the board is honest.

    Mirrors espn_adp.detect_censor_cutoff with a Yahoo-tuned spike factor
    (4x vs ESPN's 8x -- Yahoo's saturation tail is denser than ESPN's, so
    the same threshold would over-trigger on honest mid-board density).
    """
    if not adps:
        return None
    densities: dict[float, float] = {}
    for adp in adps:
        lower = math.floor(adp / _CENSOR_BIN) * _CENSOR_BIN
        densities[lower] = densities.get(lower, 0.0) + 1.0 / _CENSOR_BIN
    baseline_densities = [
        density
        for lower, density in densities.items()
        if _CENSOR_BASELINE_RANGE[0] <= lower < _CENSOR_BASELINE_RANGE[1]
    ]
    if not baseline_densities:
        return None
    ordered = sorted(baseline_densities)
    mid = len(ordered) // 2
    baseline = ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2
    for lower in sorted(densities):
        if densities[lower] > baseline * _CENSOR_SPIKE_FACTOR:
            if lower < _CENSOR_MIN_CUTOFF:
                raise ValueError(f"Yahoo ADP censor spike detected below {_CENSOR_MIN_CUTOFF}: {lower}")
            return lower
    return None


def build_yahoo_adp_entries(
    rows: list[ParsedYahooAdpRow],
    *,
    cv_bands: tuple[tuple[float, float], ...],
    yahoo_id_to_player_id: dict[str, str],
    sleeper_index: dict[MatchKey, str],
    valid_player_ids: set[str],
    fallback_entries: list[AdpEntry],
    ffc_cv_index: dict[str, tuple[float, int]] | None = None,
) -> tuple[list[AdpEntry], dict[str, Any]]:
    """Compose the committed Yahoo draft-analysis board.

    Head: every row with adp below the detected censor cutoff, matched by
    ids.yahoo first (never for DEF -- Yahoo DEF ids are negative synthetics)
    then match_named_row(name/position/team). Unmatched rows stay out of the
    artifact. stdev is fitted_stdev_for_player (per-player FFC CV when
    ffc_cv_index has a crosswalked match, else the flat band constant).
    high/low/timesDrafted are null (Yahoo publishes no range or sample size,
    same honesty caveat as Sleeper/ESPN).

    Tail: every fallback_entries player not already in the head, carried over
    unchanged except their adp is clamped up to the cutoff. Only a clamped
    row's stdev is recomputed; everything else keeps its own
    adpSource/stdevSource so the artifact is honestly mixed at the row level.
    """
    cutoff = detect_censor_cutoff([row.adp for row in rows])
    head_rows = rows if cutoff is None else [row for row in rows if row.adp < cutoff]

    entries: list[AdpEntry] = []
    for row in head_rows:
        player_id: str | None = None
        if row.position != "DEF" and row.yahoo_id:
            player_id = yahoo_id_to_player_id.get(row.yahoo_id)
        if player_id is None:
            player_id = match_named_row(row.name, row.position, row.team, sleeper_index)
        if player_id is None or player_id not in valid_player_ids:
            continue
        entries.append(
            AdpEntry(
                playerId=player_id,
                name=row.name,
                position=row.position,
                team=row.team,
                adp=row.adp,
                stdev=fitted_stdev_for_player(row.adp, player_id, ffc_cv_index, cv_bands),
                high=None,
                low=None,
                timesDrafted=None,
                byeWeek=None,
                adpSource="yahoo",
                stdevSource="fitted",
            )
        )

    head_ids = {entry.playerId for entry in entries if entry.playerId}
    tail_rows = 0
    if cutoff is not None:
        for fallback in fallback_entries:
            if fallback.playerId is None or fallback.playerId in head_ids:
                continue
            adp = max(fallback.adp, cutoff)
            entries.append(
                AdpEntry(
                    playerId=fallback.playerId,
                    name=fallback.name,
                    position=fallback.position,
                    team=fallback.team,
                    adp=adp,
                    stdev=fallback.stdev if adp == fallback.adp else fitted_stdev_for_player(cutoff, fallback.playerId, ffc_cv_index, cv_bands),
                    high=fallback.high,
                    low=fallback.low,
                    timesDrafted=fallback.timesDrafted,
                    byeWeek=fallback.byeWeek,
                    adpSource=fallback.adpSource,
                    stdevSource=fallback.stdevSource,
                )
            )
            tail_rows += 1

    entries.sort(key=lambda entry: entry.adp)
    diagnostics = {
        "censorCutoff": cutoff,
        "yahooRows": len(entries) - tail_rows,
        "tailRows": tail_rows,
    }
    return entries, diagnostics
