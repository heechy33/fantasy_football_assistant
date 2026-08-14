"""CBS Sports season-projection adapter (display-only decoration, committed artifact).

One server-rendered GET per position to CBS's Fantasy projections table:

    https://www.cbssports.com/fantasy/football/stats/{POS}/{season}/restofseason/projections/nonppr/

The URL shape is the one the ffanalytics R package's CBS scraper uses; verified
live for the 2026 season (Aug 2026): the page renders the full projections
table server-side with one player row per `tr.js-tr-game-select`, a player cell
carrying full name / position / team / CBS player id (and, for DST rows, the
canonical team abbreviation in the `/nfl/teams/{ABBR}/` href), and stat columns
whose group + label are stable per position.

Display-only, same contract as every other provider decoration: the stat maps
here must never reach buildRecommendationBoard / availability /
simulation / ranking comparators. The artifact stores Sleeper-vocabulary stat
keys so all providers score through one code path (`scoreStats`).

CBS's own fantasy-points column can't be reproduced without their private
scoring weights, so the reconciliation gate is a least-squares fit of the
page's own `fpts` on the mapped stat columns: if the column mapping is right,
`fpts` is (nearly) linear in those stats and R² ≈ 1. A position whose fit is
poor (R² < 0.95) or whose median relative error exceeds 5% is excluded and
recorded in `positionsExcluded` — the same fail-safe policy ESPN's adapter
uses, because a mis-assigned stat column must never ship as a plausible
number.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any

import requests

from match import MatchKey, match_named_row
from provider_projections import ProviderResult

CBS_STATS_BASE = "https://www.cbssports.com/fantasy/football/stats/{position}/{season}/restofseason/projections/nonppr/"
USER_AGENT = "fantasy-football-assistant-pipeline/1.0 (+https://github.com/)"
TIMEOUT = 60

# CBS table is one page per position, all rows server-rendered.
POSITIONS = ("QB", "RB", "WR", "TE", "K", "DST")

# Minimum sample and fit quality a position must clear to ship rows. A genuine
# positional table is ~30+ rows and fits near-perfectly, so these are loose.
MIN_FIT_ROWS = 8
MIN_R2 = 0.95
MAX_MEDIAN_REL_ERROR = 0.05

# Sleeper stat vocabulary for kickers — the frontend's scoreStats only scores
# keys the user's league actually weights, so fgm/fga/xpm/xpa are enough.
_K_STAT_BY_LABEL = {
    "fgm": "fgm",
    "fga": "fga",
    "xpm": "xpm",
    "xpa": "xpa",
    "fpts": "fpts",
}

# CBS DST columns carry no group header, so they're keyed by label alone.
_DST_STAT_BY_LABEL = {
    "int": "int",
    "sfty": "safe",
    "sck": "sack",
    "frec": "fum_rec",
    "fum": "ff",
    "dtd": "def_td",
    "pts": "pts_allow",
    "total": "yds_allow",
    "fpts": "fpts",
}

# Skill-position columns keyed by (group heading, stat label). The group key is
# what disambiguates CBS's repeated "att"/"yds"/"td" labels (Passing vs
# Rushing), and unlisted columns (yds/g, avg, rate, fppg, per-distance FG
# buckets, longest FG, tackles) are deliberately ignored.
_SKILL_STAT_BY_GROUP_LABEL = {
    ("Passing", "att"): "pass_att",
    ("Passing", "cmp"): "pass_cmp",
    ("Passing", "yds"): "pass_yd",
    ("Passing", "td"): "pass_td",
    ("Passing", "int"): "pass_int",
    ("Rushing", "att"): "rush_att",
    ("Rushing", "yds"): "rush_yd",
    ("Rushing", "td"): "rush_td",
    ("Receiving", "tgt"): "rec_tgt",
    ("Receiving", "rec"): "rec",
    ("Receiving", "yds"): "rec_yd",
    ("Receiving", "td"): "rec_td",
    ("Misc", "fl"): "fum_lost",
    ("Misc", "fpts"): "fpts",
}

# CBS player links: `/nfl/players/{id}/{name}/fantasy/`; DST team links:
# `/nfl/teams/{ABBR}/{slug}/` — the abbreviation is the Sleeper DEF player id.
_TEAM_URL_RE = re.compile(r"/nfl/teams/([A-Z]{2,3})/")


@dataclass(frozen=True)
class CbsRow:
    """One parsed CBS projection row, pre-matching."""

    name: str
    team: str | None
    stats: dict[str, float]
    fpts: float | None


def fetch_cbs_position_page(position: str, season: str) -> str:
    """One unauthenticated GET to CBS's Fantasy projections table for a position."""
    resp = requests.get(
        CBS_STATS_BASE.format(position=position, season=season),
        headers={"User-Agent": USER_AGENT},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return resp.text


def _number(text: str) -> float | None:
    """Parse a CBS stat cell. `—`/`-`/blank/garbage (e.g. CBS's `lng` unicode)
    are missing, never zero — a missing component must not silently read as 0."""
    cleaned = text.strip().replace(",", "").replace("%", "")
    if not cleaned or cleaned in {"-", "—", "n/a", "na"}:
        return None
    try:
        value = float(cleaned)
    except ValueError:
        return None
    if value != value:  # NaN is missing, never 0
        return None
    return value


def _label_key(label: str) -> str:
    """CBS stat labels are `key tooltip...` (e.g. `yds Passing Yards`); the
    first token is the stable column key the maps above are written against."""
    return label.split()[0] if label.strip() else ""


class _CbsTableParser(HTMLParser):
    """Stateful reader for the `#TableBase` projections table.

    Captures, in order: the group-heading row's per-column group labels
    (colspan-aware), the second header row's per-column stat labels, and every
    tbody player row as a list of cell "bundles" — each bundle keeps the cell
    text plus the href/text of the last `<a>` inside it (the player link, or
    the DST team link) and any `CellPlayerName-position`/`CellPlayerName-team`
    span text. Cell-text flattening is the same approach as `html_table.py`.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.groups: list[str] = []
        self.labels: list[str] = []
        self.cell_bundles: list[list[dict[str, Any]]] = []
        self._in_target_table = False
        self._in_head = False
        self._in_body = False
        self._row: list[dict[str, Any]] | None = None
        self._cell: dict[str, Any] | None = None
        self._group_row = False
        self._link_href: str | None = None
        self._link_text: list[str] = []
        self._mode: str | None = None  # None | "pos" | "team" span capture

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attr = dict(attrs)
        classes = (attr.get("class") or "").split()
        if tag == "table" and ("TableBase-table" in classes or attr.get("id") == "TableBase"):
            self._in_target_table = True
        if not self._in_target_table:
            return
        if tag == "thead":
            self._in_head = True
        elif tag == "tbody" and not self._in_head:
            self._in_body = True
        elif tag == "tr" and (self._in_head or self._in_body):
            if "TableBase-headGroupTr" in classes:
                self._group_row = True
            self._row = []
        elif tag in {"th", "td"} and self._row is not None:
            self._cell = {
                "text": [], "href": None, "link_text": [], "pos": [], "team": [],
                "colspan": 1,
            }
            try:
                self._cell["colspan"] = max(1, int(attr.get("colspan") or 1))
            except (TypeError, ValueError):
                self._cell["colspan"] = 1
            self._mode = None
        elif tag == "span" and self._cell is not None:
            if "CellPlayerName-position" in classes:
                self._mode = "pos"
            elif "CellPlayerName-team" in classes:
                self._mode = "team"
        elif tag == "a" and self._cell is not None:
            self._link_href = attr.get("href")
            self._link_text = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "a" and self._cell is not None:
            if self._link_href:
                self._cell["href"] = self._link_href
                self._cell["link_text"] = self._link_text
            self._link_href = None
            self._link_text = []
        elif tag == "span" and self._cell is not None and self._mode in ("pos", "team"):
            self._mode = None
        elif tag in {"th", "td"} and self._cell is not None and self._row is not None:
            self._cell["text"] = " ".join("".join(self._cell["text"]).split())
            if self._cell["pos"]:
                self._cell["pos"] = " ".join("".join(self._cell["pos"]).split())
            if self._cell["team"]:
                self._cell["team"] = " ".join("".join(self._cell["team"]).split())
            self._row.append(self._cell)
            self._cell = None
            self._mode = None
        elif tag == "tr" and self._row is not None:
            if self._group_row:
                self.groups = self._expand_groups(self._row)
                self._group_row = False
            elif self._in_head:
                self.labels = [cell["text"] for cell in self._row]
            elif self._in_body:
                self.cell_bundles.append(self._row)
            self._row = None
        elif tag == "thead":
            self._in_head = False
        elif tag == "tbody":
            self._in_body = False
        elif tag == "table" and self._in_target_table:
            self._in_target_table = False

    @staticmethod
    def _expand_groups(row: list[dict[str, Any]]) -> list[str]:
        expanded: list[str] = []
        for cell in row:
            label = cell["text"].strip()
            for _ in range(cell["colspan"]):
                expanded.append(label)
        return expanded

    def handle_data(self, data: str) -> None:
        if self._cell is None:
            return
        if self._mode == "pos":
            self._cell["pos"].append(data)
        elif self._mode == "team":
            self._cell["team"].append(data)
        else:
            self._cell["text"].append(data)
        if self._link_href is not None:
            self._link_text.append(data)


def parse_cbs_page(html: str, position: str) -> list[CbsRow]:
    """Pure parse of one CBS projections page into pre-match rows.

    `position` must be one of `POSITIONS`; it is the authoritative position for
    every row (CBS tables are one position per page) and is also the fallback
    when the player cell's own position span is empty. DST rows use the team
    abbreviation from the `/nfl/teams/{ABBR}/` href — that is the value matched
    against the Sleeper DEF pool later.
    """
    parser = _CbsTableParser()
    parser.feed(html)
    if not parser.labels or not parser.cell_bundles:
        raise ValueError(f"CBS {position} page contained no projection rows")

    stat_by_label: dict[str, str] | None = None
    if position == "K":
        stat_by_label = _K_STAT_BY_LABEL
    elif position == "DST":
        stat_by_label = _DST_STAT_BY_LABEL

    if stat_by_label is not None:
        column_keys = [stat_by_label.get(_label_key(label)) for label in parser.labels]
    else:
        group_count = len(parser.groups)
        column_keys = [
            _SKILL_STAT_BY_GROUP_LABEL.get(
                (parser.groups[index] if index < group_count else "", _label_key(label))
            )
            for index, label in enumerate(parser.labels)
        ]

    rows: list[CbsRow] = []
    for bundle in parser.cell_bundles:
        if not bundle:
            continue
        player_cell = bundle[0]
        name, team = _player_identity(player_cell, position)
        if name is None and team is None:
            continue  # not a player row (e.g. a banner/spacer row)
        stats: dict[str, float] = {}
        fpts: float | None = None
        for index, key in enumerate(column_keys):
            if key is None or index >= len(bundle):
                continue
            value = _number(bundle[index]["text"])
            if value is None:
                continue
            if key == "fpts":
                fpts = value
            else:
                stats[key] = value
        if not stats:
            continue
        rows.append(CbsRow(name=name, team=team, stats=stats, fpts=fpts))
    return rows


def _player_identity(
    cell: dict[str, Any],
    position: str,
) -> tuple[str | None, str | None]:
    """Full name + team from the player cell.

    Skill players: the long-form `<a>` (the last link in the cell) carries the
    full name; position/team come from the dedicated spans. DST rows: the
    `/nfl/teams/{ABBR}/` href is the canonical team abbreviation, used directly
    as the match key.
    """
    href = cell.get("href") or ""
    if position == "DST":
        match = _TEAM_URL_RE.search(href)
        if match:
            return None, match.group(1)
        return None, _first_word(cell.get("team"))
    link_text = " ".join("".join(cell.get("link_text") or []).split())
    return (link_text or None), _first_word(cell.get("team"))


def _first_word(text: object) -> str | None:
    """The pos/team spans repeat for the short and long name blocks (e.g.
    `BUF BUF`); the first token is the real value."""
    if not isinstance(text, str) or not text.strip():
        return None
    return text.split()[0]


# Columns that fantasy scoring actually weights, per position. The fit uses
# ONLY these: the unscored-but-collinear columns (pass_att/pass_cmp, targets,
# rush_avg, …) are decoys that let a mis-assigned money column slip through —
# with only the scored columns in the model, a wrong pass_yd can't be masked by
# a correlated pass_cmp.
_FIT_KEYS_BY_POSITION = {
    "QB": ("pass_yd", "pass_td", "pass_int", "rush_yd", "rush_td", "fum_lost"),
    "RB": ("rush_yd", "rush_td", "rec", "rec_yd", "rec_td", "fum_lost"),
    "WR": ("rec", "rec_yd", "rec_td", "rush_yd", "rush_td", "fum_lost"),
    "TE": ("rec", "rec_yd", "rec_td", "fum_lost"),
    "K": ("fgm", "fga", "xpm", "xpa"),
    "DST": ("int", "safe", "sack", "fum_rec", "ff", "def_td", "pts_allow", "yds_allow"),
}


def _fit_quality(rows: list[CbsRow], position: str) -> tuple[float, float] | None:
    """Least-squares fit of the page's own fpts on the mapped *scored* stats.

    Returns (r2, median_relative_error) or None when the fit is degenerate
    (too few rows, a singular normal matrix, or constant fpts). CBS's fpts is
    linear in the true scored columns, so a correct mapping fits near-perfectly
    and a mis-assigned/mis-read column collapses the R² — that is the gate.
    """
    fit_keys = _FIT_KEYS_BY_POSITION.get(position, ())
    samples: list[tuple[float, dict[str, float]]] = []
    for row in rows:
        if row.fpts is None or row.fpts <= 0 or not row.stats:
            continue
        samples.append((row.fpts, row.stats))
    if len(samples) < MIN_FIT_ROWS:
        return None

    y = [sample[0] for sample in samples]
    if max(y) - min(y) == 0:
        return None
    # Only feature columns that actually vary on this position's rows — columns
    # that are uniformly absent/zero (e.g. receiving stats on a QB page) would
    # make the normal matrix singular and the solve fail outright.
    keys = [k for k in fit_keys if _has_variance(k, samples)]
    if not keys:
        return None
    x = [[sample[1].get(k, 0.0) for k in keys] for sample in samples]
    dim = len(keys) + 1  # + intercept
    normal = [[0.0] * (dim + 1) for _ in range(dim)]
    for yi, xi in zip(y, x):
        row = [1.0, *xi]
        for i in range(dim):
            for j in range(dim):
                normal[i][j] += row[i] * row[j]
            normal[i][dim] += row[i] * yi
    # A tiny ridge keeps the fit solvable when stat columns are collinear
    # (pass_att/pass_cmp nearly so); the bias it introduces is negligible at
    # this scale and the R² gate is what carries the correctness signal.
    for i in range(dim):
        normal[i][i] += 1e-6
    beta = _solve(normal)
    if beta is None:
        return None

    n = len(y)
    mean_y = sum(y) / n
    ss_res = 0.0
    ss_tot = 0.0
    relative_errors: list[float] = []
    for yi, xi in zip(y, x):
        predicted = beta[0] + sum(b * v for b, v in zip(beta[1:], xi))
        ss_res += (yi - predicted) ** 2
        ss_tot += (yi - mean_y) ** 2
        if abs(yi) > 1e-9:
            relative_errors.append(abs(yi - predicted) / abs(yi))
    if ss_tot == 0:
        return None
    r2 = 1.0 - ss_res / ss_tot
    ordered = sorted(relative_errors)
    median = ordered[len(ordered) // 2] if ordered else 1.0
    return r2, median


def _has_variance(key: str, samples: list[tuple[float, dict[str, float]]]) -> bool:
    values = [sample[1].get(key, 0.0) for sample in samples]
    return max(values) - min(values) > 0


def _solve(matrix: list[list[float]]) -> list[float] | None:
    """Gaussian elimination with partial pivoting on [A|b]; None if singular."""
    n = len(matrix)
    a = [row[:] for row in matrix]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(a[r][col]))
        if abs(a[pivot][col]) < 1e-9:
            return None
        if pivot != col:
            a[col], a[pivot] = a[pivot], a[col]
        for r in range(col + 1, n):
            factor = a[r][col] / a[col][col]
            for c in range(col, n + 1):
                a[r][c] -= factor * a[col][c]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        total = a[r][n] - sum(a[r][c] * x[c] for c in range(r + 1, n))
        x[r] = total / a[r][r]
    return x


def cbs_provider_result(
    pages: dict[str, str],
    *,
    season: int,
    sleeper_index: dict[MatchKey, str],
    valid_player_ids: set[str],
    fetched_at: str,
) -> ProviderResult:
    """Parse + reconcile + match every CBS position page into a provider block.

    Matching is name/position/team via `match_named_row` (the same rule ESPN
    and FFC use); DEF rows resolve the `/nfl/teams/{ABBR}/` abbreviation, which
    is the Sleeper DEF player id. Positions whose reconciliation fit fails are
    excluded and recorded with the measured median relative error, so a
    mis-assigned stat column can never ship as a plausible number.
    """
    excluded: dict[str, float] = {}
    stats_by_player: dict[str, dict[str, float]] = {}
    position_rows: dict[str, int] = {}

    for position in POSITIONS:
        html = pages.get(position)
        if not html:
            excluded[position] = 1.0
            continue
        rows = parse_cbs_page(html, position)
        fit = _fit_quality(rows, position)
        if fit is None or fit[0] < MIN_R2 or fit[1] > MAX_MEDIAN_REL_ERROR:
            excluded[position] = round(1.0 if fit is None else fit[1], 4)
            continue
        for row in rows:
            if position == "DST":
                player_id = match_named_row("", "DEF", row.team, sleeper_index)
            else:
                player_id = match_named_row(row.name, position, row.team, sleeper_index)
            if player_id is None or player_id not in valid_player_ids:
                continue
            stats_by_player[player_id] = row.stats
            position_rows[position] = position_rows.get(position, 0) + 1

    block: dict[str, Any] = {
        "key": "cbs",
        "label": "CBS",
        "attribution": "Projections via CBS Sports' public fantasy projections table.",
        "status": "ok",
        "fetchedAt": fetched_at,
        "upstreamUpdatedAt": None,
        "rows": len(stats_by_player),
        "positionRows": position_rows,
        "positionsExcluded": [
            {"position": position, "medianError": error}
            for position, error in sorted(excluded.items())
        ],
        "staleSinceDays": 0,
        "diagnostic": None,
    }
    return ProviderResult(key="cbs", label="CBS", block=block, stats_by_player=stats_by_player)
