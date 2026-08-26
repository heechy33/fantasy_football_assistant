"""Coverage for pipeline/underdog_adp.py — the Underdog best-ball ADP adapter.

Fixture-driven (no HTTP): parsing reads the Sharp Football Analysis page's
server-rendered ADP table (recorded HTML fixture; see fixtures/underdog/),
structural drift fails closed like espn_adp.py, per-row junk is skipped rather
than fatal, crosswalk matching accounts for matched/unmatched exactly, and the
freshness stamp never invents a year the publisher didn't print. The
build_data fail-open wrapper (fetch error / drift / min-rows gate) is covered
directly so the byte-identical-prior-artifact contract can't regress.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import transform
from build_data import (
    UNDERDOG_ADP_MIN_ROWS,
    _build_underdog_adp_board,
)
from match import normalize_name
from underdog_adp import (
    ParsedUnderdogRow,
    build_underdog_adp_entries,
    extract_upstream_updated_at,
    parse_underdog_adp_rows,
)

# Empty-band fit returns the default FFC CV curve.
_DEFAULT_CV_BANDS = transform.fit_adp_cv_bands([])

_FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "underdog" / "adp-half-ppr-sharpfootballanalysis.html"

_HEADER = ("Player", "POS", "Team", "POS ADP", "ADP", "Prev ADP", "\u0394")


def _table(*rows: tuple[str, ...], header: tuple[str, ...] = _HEADER) -> str:
    """A minimal server-rendered table in the republication's column layout."""
    head = "<table><thead><tr>" + "".join(f"<th>{cell}</th>" for cell in header) + "</tr></thead><tbody>"
    body = "".join(
        "<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows
    )
    return f"<html><body>{head}{body}</tbody></table></body></html>"


def _row(name, position, pos_adp, adp, team="Detroit Lions", prev="-"):
    return (name, position, team, pos_adp, adp, prev)


def _index(*pairs):
    return dict(pairs)


def test_parse_reads_recorded_fixture_into_sleeper_vocab():
    rows = parse_underdog_adp_rows(_FIXTURE.read_text(encoding="utf-8"))
    # The live board is ~250 distinct skill players — comfortably above the gate.
    assert len(rows) >= UNDERDOG_ADP_MIN_ROWS
    first = rows[0]
    assert (first.name, first.position, first.adp) == ("Jahmyr Gibbs", "RB", 1.1)
    # The republication publishes no provider ids and only full team names we
    # deliberately do not map (no DEF lane needs them).
    assert all(row.team is None and row.underdog_id is None for row in rows)
    assert {row.position for row in rows} <= {"QB", "RB", "WR", "TE"}
    # Page order is ascending overall ADP.
    assert [row.adp for row in rows] == sorted(row.adp for row in rows)


def test_parse_skips_unusable_rows_without_raising():
    html = _table(
        _row("Zero Adp", "QB", "QB30", "0.0"),        # adp <= 0
        _row("Negative Adp", "QB", "QB31", "-3.0"),   # adp <= 0
        _row("", "QB", "QB32", "10.0"),               # no name
        _row("Kicker Only", "K", "K1", "100.0"),      # best-ball drafts no kickers
        _row("Team Defense", "DEF", "DST1", "90.0"),  # ...or defenses
        ("Garbage Row", "WR"),                        # malformed row shape
        _row("Jahmyr Gibbs", "RB", "RB1", "1.1"),
    )
    assert parse_underdog_adp_rows(html) == [
        ParsedUnderdogRow(name="Jahmyr Gibbs", team=None, position="RB", underdog_id=None, adp=1.1)
    ]


def test_parse_rejects_schema_drift():
    with pytest.raises(ValueError, match="no ADP table with the expected Player/POS/Team header"):
        parse_underdog_adp_rows("<html><body><p>paywall stub</p></body></html>")
    with pytest.raises(ValueError, match="no ADP table with the expected Player/POS/Team header"):
        parse_underdog_adp_rows(_table(_row("X", "RB", "RB1", "1.0"), header=("Name", "Pos")))


@pytest.fixture()
def fixture_html() -> str:
    return _FIXTURE.read_text(encoding="utf-8")


def test_extract_upstream_updated_at_is_verbatim_and_honest(fixture_html: str):
    assert extract_upstream_updated_at(fixture_html) == "August 21"
    # Absent / differently-worded stamps stay unknown — no date fabrication.
    assert extract_upstream_updated_at("<html><body>No stamp here</body></html>") is None


def test_build_entries_matches_via_crosswalk_and_accounts_exactly():
    rows = [
        ParsedUnderdogRow(name="James Cook III", team=None, position="RB", underdog_id=None, adp=12.0),
        ParsedUnderdogRow(name="Rashee Rice", team=None, position="WR", underdog_id=None, adp=26.6),
        ParsedUnderdogRow(name="Ghost Player", team=None, position="TE", underdog_id=None, adp=229.0),
    ]
    entries, diag = build_underdog_adp_entries(
        rows,
        sleeper_index=_index(
            (("james cook", "RB"), "8138"),
            (("rashee rice", "WR"), "16346"),
            (("ghost player", "TE"), "229"),
        ),
        valid_player_ids={"8138"},
        cv_bands=_DEFAULT_CV_BANDS,
    )
    # Name-suffix folding matches Cook; Rice matches but is filtered by
    # valid_player_ids (untracked); Ghost Player misses entirely. Both count
    # as unmatched in diagnostics — surfaced, never silently dropped.
    assert [entry.playerId for entry in entries] == ["8138"]
    cook = entries[0]
    assert cook.name == "James Cook III"
    assert cook.adp == 12.0
    assert cook.stdev == transform.fitted_stdev(12.0, _DEFAULT_CV_BANDS)
    assert cook.adpSource == "underdog"
    assert cook.stdevSource == "fitted"
    assert cook.high is None and cook.low is None and cook.timesDrafted is None
    assert diag["rawRows"] == 3
    assert diag["matchedRows"] == 1
    assert diag["unmatchedCount"] == 2
    assert diag["unmatched"] == ["Rashee Rice (WR)", "Ghost Player (TE)"]
    # Board is ascending by adp even when input isn't.
    shuffled = list(reversed(rows))
    entries2, _ = build_underdog_adp_entries(
        shuffled,
        sleeper_index=_index(
            (("james cook", "RB"), "a"), (("rashee rice", "WR"), "b"), (("ghost player", "TE"), "c")
        ),
        valid_player_ids={"a", "b", "c"},
    )
    assert [entry.adp for entry in entries2] == sorted(entry.adp for entry in entries2)


def _board_html(row_count):
    """A synthetic page + matching sleeper index of `row_count` RB rows."""
    html = _table(*(_row(f"Player{i} Name", "RB", f"RB{i + 1}", f"{i + 1}.0") for i in range(row_count)))
    index = {(normalize_name(f"Player{i} Name"), "RB"): str(i) for i in range(row_count)}
    return html, index


def test_build_board_ok_path_carries_provenance_fields():
    html, index = _board_html(UNDERDOG_ADP_MIN_ROWS)
    html = html.replace("</body>", "Underdog Fantasy ADP \u2014 Updated August 21</body>")
    entries, diag = _build_underdog_adp_board(
        html,
        None,
        sleeper_index=index,
        valid_player_ids=set(index.values()),
        cv_bands=_DEFAULT_CV_BANDS,
    )
    assert entries is not None
    assert len(entries) == UNDERDOG_ADP_MIN_ROWS
    # Verbatim off the page prose — the publisher prints no year, none invented.
    assert diag["upstreamUpdatedAt"] == "August 21"
    assert diag["matchedRows"] == UNDERDOG_ADP_MIN_ROWS
    assert diag["rawRows"] == UNDERDOG_ADP_MIN_ROWS


def test_build_board_fails_open_on_fetch_error():
    entries, diag = _build_underdog_adp_board(
        None, "HTTPError: 403 [url]", sleeper_index={}, valid_player_ids=set(), cv_bands=_DEFAULT_CV_BANDS
    )
    assert entries is None
    assert diag["diagnostic"] == "HTTPError: 403 [url]"
    assert diag["upstreamUpdatedAt"] is None
    assert diag["matchedRows"] == 0


def test_build_board_fails_open_on_schema_drift():
    entries, diag = _build_underdog_adp_board(
        "<html><body>page redesigned</body></html>", None, sleeper_index={}, valid_player_ids=set(), cv_bands=_DEFAULT_CV_BANDS
    )
    assert entries is None
    assert "ValueError: Underdog page has no ADP table" in diag["diagnostic"]
    assert diag["upstreamUpdatedAt"] is None


def test_build_board_fails_open_below_min_rows_gate():
    html, index = _board_html(UNDERDOG_ADP_MIN_ROWS - 1)
    entries, diag = _build_underdog_adp_board(
        html,
        None,
        sleeper_index=index,
        valid_player_ids=set(index.values()),
        cv_bands=_DEFAULT_CV_BANDS,
    )
    assert entries is None
    assert diag["diagnostic"] == (
        f"matchedRows {UNDERDOG_ADP_MIN_ROWS - 1} < UNDERDOG_ADP_MIN_ROWS {UNDERDOG_ADP_MIN_ROWS}"
    )