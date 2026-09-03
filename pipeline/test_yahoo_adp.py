"""Coverage for pipeline/yahoo_adp.py -- the Yahoo draft-analysis ADP adapter.

Fixture-driven (no live HTTP by default; the recorded `half-ppr-12-rows.html`
fixture in `fixtures/yahoo/` was rendered once via Playwright on 2026-09-01
and saved). The fixture covers the realistic Yahoo render shape: mixed-case
team tokens (Det, Atl, Cin), an all-caps 3-letter team (SF for McCaffrey),
a 2-letter team (NY), injury-flagged positions (Q-suffix), and the upsell
placeholder cells that are blank after a "+" paywall link.

Live-Playwright tests are gated behind a `YAHOO_LIVE` env var so the fast
default suite stays offline; run them with `YAHOO_LIVE=1 pytest -k yahoo_live`.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest

import transform
from transform import AdpEntry, fitted_stdev

import yahoo_adp
from yahoo_adp import (
    ParsedYahooAdpRow,
    _TEAM_POSITION_RE,
    _split_player_and_team_position,
    build_yahoo_adp_entries,
    detect_censor_cutoff,
    parse_yahoo_adp_rows,
)

# Empty-band fit returns the default FFC CV curve -- matches the espn_adp test.
_DEFAULT_CV_BANDS = transform.fit_adp_cv_bands([])


_FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "yahoo"


def _load_fixture(name: str) -> str:
    return (_FIXTURE_DIR / name).read_text(encoding="utf-8")


# ---- Cell-text helpers ---------------------------------------------------

def test_team_position_regex_matches_yahoos_three_team_shapes():
    # Mixed-case 3-letter: "Det"
    assert _TEAM_POSITION_RE.search("Det - RB").group(1) == "Det"
    # All-caps 2-letter: "SF"
    assert _TEAM_POSITION_RE.search("SF - RB").group(1) == "SF"
    # All-caps 3-letter: "BUF"
    assert _TEAM_POSITION_RE.search("BUF - RB").group(1) == "BUF"
    # Mixed-case 2-letter: "KC"
    assert _TEAM_POSITION_RE.search("KC - QB").group(1) == "KC"
    # Position with injury flag (Q-suffix)
    assert _TEAM_POSITION_RE.search("Cin - WRQ").group(2) == "WR"
    # No match when position is not a fantasy slot
    assert _TEAM_POSITION_RE.search("Det - OL") is None


def test_split_player_and_team_position_handles_concatenated_cell():
    name, composite = _split_player_and_team_position("Jahmyr GibbsDet - RB")
    assert name == "Jahmyr Gibbs"
    assert composite == "Det - RB"


def test_split_player_and_team_position_handles_trailing_player_letter():
    # Christian McCaffrey ends in 'y'; the team token is 'SF' (all-caps 3).
    name, composite = _split_player_and_team_position("Christian McCaffreySF - RB")
    assert name == "Christian McCaffrey"
    assert composite == "SF - RB"


def test_split_player_and_team_position_handles_injury_tag():
    name, composite = _split_player_and_team_position("Ja'Marr ChaseCin - WRQ")
    assert name == "Ja'Marr Chase"
    assert composite == "Cin - WRQ"


def test_split_player_and_team_position_no_match_returns_unchanged():
    name, composite = _split_player_and_team_position("Just a player name")
    assert name == "Just a player name"
    assert composite is None


# ---- yahoo_id extraction from player anchor href ---------------------------

def test_coerce_yahoo_id_from_link_matches_modern_sports_yahoo_com_url():
    from yahoo_adp import _coerce_yahoo_id_from_link
    assert _coerce_yahoo_id_from_link("https://sports.yahoo.com/nfl/players/40059/news/") == "40059"
    assert _coerce_yahoo_id_from_link("https://sports.yahoo.com/nfl/players/4881/overview") == "4881"


def test_coerce_yahoo_id_from_link_matches_legacy_f1_url():
    from yahoo_adp import _coerce_yahoo_id_from_link
    assert _coerce_yahoo_id_from_link("https://football.fantasysports.yahoo.com/f1/4881/overview") == "4881"


def test_coerce_yahoo_id_from_link_returns_none_for_unrelated_href():
    from yahoo_adp import _coerce_yahoo_id_from_link
    assert _coerce_yahoo_id_from_link("https://fantasysports.yahoo.com/lp/plus?ncid=dcm_315") is None
    assert _coerce_yahoo_id_from_link("") is None
    assert _coerce_yahoo_id_from_link(None) is None


# ---- parse_yahoo_adp_rows with the recorded half-ppr fixture -------------

def test_parse_yahoo_adp_rows_handles_recorded_half_ppr_fixture():
    """The recorded fixture is a real Yahoo render captured 2026-09-01."""
    rows = parse_yahoo_adp_rows(_load_fixture("half-ppr-12-rows.html"))
    assert len(rows) == 12
    by_name = {r.name: r for r in rows}
    assert by_name["Jahmyr Gibbs"].team == "DET"
    assert by_name["Jahmyr Gibbs"].position == "RB"
    assert by_name["Jahmyr Gibbs"].yahoo_id == "40059"
    assert by_name["Bijan Robinson"].team == "ATL"
    assert by_name["Ja'Marr Chase"].position == "WR"  # 'Q' suffix stripped
    assert by_name["Christian McCaffrey"].team == "SF"  # 'ySF' substring skipped
    assert by_name["Puka Nacua"].team == "LAR"
    assert all(r.adp > 0 for r in rows)
    assert all(r.yahoo_id is None or r.yahoo_id.isdigit() for r in rows)


def test_parse_yahoo_adp_rows_rejects_no_table():
    with pytest.raises(ValueError, match="contained no table rows"):
        parse_yahoo_adp_rows("<html><body>no table here</body></html>")


def test_parse_yahoo_adp_rows_rejects_too_few_rows():
    with pytest.raises(ValueError, match="fewer than 3 rows"):
        parse_yahoo_adp_rows("<table><tr><td>x</td></tr></table>")


def test_parse_yahoo_adp_rows_rejects_wrong_header():
    html = (
        "<table>"
        "<tr><th>foo</th><th>bar</th><th>baz</th></tr>"
        "<tr><td>x</td><td>y</td><td>z</td></tr>"
        "<tr><td>a</td><td>b</td><td>c</td></tr>"
        "</table>"
    )
    with pytest.raises(ValueError, match="header does not start with"):
        parse_yahoo_adp_rows(html)


def test_parse_yahoo_adp_rows_rejects_missing_columns():
    # Header starts right ('player rank pos rank') but is missing the
    # 'all drafts' column that we use as the primary ADP source.
    html = (
        "<table>"
        # Column-group header (mirrors real Yahoo's colspan=5 row).
        "<tr><th colspan='5'>Fantasy</th><th colspan='3'>Basic ADP</th></tr>"
        # Actual column-header row.
        "<tr><th>Player</th><th>Rank</th><th>Pos Rank</th><th>CER</th><th>%Drafted</th><th>Preseason</th><th>Last 7 Days</th></tr>"
        # One data row.
        "<tr><td>Jahmyr GibbsDet - RB</td><td>1</td><td>1</td><td></td><td>100%</td><td>1.4</td><td>1.4</td></tr>"
        "</table>"
    )
    with pytest.raises(ValueError, match="missing rank or all-drafts column"):
        parse_yahoo_adp_rows(html)


def test_parse_yahoo_adp_rows_skips_non_fantasy_position():
    # Yahoo occasionally surfaces a non-fantasy position (OL, LS, P, ...).
    # The position is in the same cell as the team (Yahoo's render shape).
    html = (
        "<table>"
        "<tr><th colspan='5'>Fantasy</th><th colspan='3'>Basic ADP</th></tr>"
        "<tr><th>Player</th><th>Rank</th><th>Pos Rank</th><th>CER</th><th>%Drafted</th><th>Preseason</th><th>All Drafts</th><th>Last 7 Days</th></tr>"
        "<tr><td>Some OLBuf - OL</td><td>1</td><td>1</td><td></td><td>50%</td><td></td><td>200</td><td>200</td></tr>"
        "<tr><td>A Real PlayerBuf - RB</td><td>2</td><td>2</td><td></td><td>100%</td><td></td><td>5</td><td>5</td></tr>"
        "</table>"
    )
    rows = parse_yahoo_adp_rows(html)
    assert len(rows) == 1
    assert rows[0].name == "A Real Player"
    assert rows[0].position == "RB"


# ---- detect_censor_cutoff -----------------------------------------------

def test_detect_censor_cutoff_finds_sentinel_spike():
    adps = [float(pick) for pick in range(1, 165)]
    adps.extend(168.0 + (i % 4) * 0.3 for i in range(400))
    assert detect_censor_cutoff(adps) == 165.0


def test_detect_censor_cutoff_none_on_clean_distribution():
    adps = [float(pick) for pick in range(1, 201)]
    assert detect_censor_cutoff(adps) is None


def test_detect_censor_cutoff_raises_on_degenerate_early_spike():
    adps = [float(pick) for pick in range(1, 165)]
    adps.extend(50.0 for _ in range(60))
    with pytest.raises(ValueError, match="censor spike detected below"):
        detect_censor_cutoff(adps)


def test_detect_censor_cutoff_returns_none_for_empty_input():
    assert detect_censor_cutoff([]) is None


# ---- build_yahoo_adp_entries (head + tail splice) -------------------------

def test_build_yahoo_adp_entries_head_matches_yahoo_id_first_def_by_team():
    rows = [
        ParsedYahooAdpRow(name="Jahmyr Gibbs", team="DET", position="RB",
                          yahoo_id="40059", adp=1.0, percent_drafted=1.0),
        ParsedYahooAdpRow(name="Bijan Robinson", team="ATL", position="RB",
                          yahoo_id="40055", adp=2.0, percent_drafted=1.0),
        ParsedYahooAdpRow(name="Ravens D/ST", team="BAL", position="DEF",
                          yahoo_id="-16033", adp=15.0, percent_drafted=0.95),
        ParsedYahooAdpRow(name="Unmatched Yahoo", team="KC", position="WR",
                          yahoo_id="99999", adp=12.0, percent_drafted=1.0),
    ]
    entries, _ = build_yahoo_adp_entries(
        rows,
        cv_bands=_DEFAULT_CV_BANDS,
        yahoo_id_to_player_id={"40059": "gibbs", "40055": "robinson"},
        sleeper_index={("BAL", "DEF"): "BAL"},
        valid_player_ids={"gibbs", "robinson", "BAL"},
        fallback_entries=[],
    )
    ids = [entry.playerId for entry in entries]
    assert sorted(ids) == ["BAL", "gibbs", "robinson"]
    assert all(entry.adpSource == "yahoo" for entry in entries)
    assert all(entry.stdevSource == "fitted" for entry in entries)
    assert all(entry.high is None and entry.low is None and entry.timesDrafted is None for entry in entries)


def test_build_yahoo_adp_entries_head_stdev_is_plain_fitted():
    rows = [ParsedYahooAdpRow(name="Jahmyr Gibbs", team="DET", position="RB",
                              yahoo_id="40059", adp=18.0, percent_drafted=1.0)]
    entries, _ = build_yahoo_adp_entries(
        rows,
        cv_bands=_DEFAULT_CV_BANDS,
        yahoo_id_to_player_id={"40059": "gibbs"},
        sleeper_index={("jahmyr gibbs", "RB"): "gibbs"},
        valid_player_ids={"gibbs"},
        fallback_entries=[],
    )
    assert entries[0].stdev == fitted_stdev(18.0, _DEFAULT_CV_BANDS)


def test_build_yahoo_adp_entries_head_uses_ffc_cv_index_when_provided():
    rows = [ParsedYahooAdpRow(name="Jahmyr Gibbs", team="DET", position="RB",
                              yahoo_id="40059", adp=18.0, percent_drafted=1.0)]
    ffc_cv_index = {"gibbs": (0.4, 5000)}
    entries, _ = build_yahoo_adp_entries(
        rows,
        cv_bands=_DEFAULT_CV_BANDS,
        yahoo_id_to_player_id={"40059": "gibbs"},
        sleeper_index={("jahmyr gibbs", "RB"): "gibbs"},
        valid_player_ids={"gibbs"},
        fallback_entries=[],
        ffc_cv_index=ffc_cv_index,
    )
    assert entries[0].stdev > fitted_stdev(18.0, _DEFAULT_CV_BANDS)
    assert entries[0].stdev == transform.fitted_stdev_for_player(18.0, "gibbs", ffc_cv_index, _DEFAULT_CV_BANDS)


def test_build_yahoo_adp_entries_no_censor_when_no_spike():
    rows = [
        ParsedYahooAdpRow(name="Player " + str(i), team="BUF", position="RB",
                          yahoo_id="", adp=float(i + 1), percent_drafted=0.5)
        for i in range(50)
    ]
    entries, diag = build_yahoo_adp_entries(
        rows,
        cv_bands=_DEFAULT_CV_BANDS,
        yahoo_id_to_player_id={},
        sleeper_index={},
        valid_player_ids=set(),
        fallback_entries=[],
    )
    assert diag == {"censorCutoff": None, "yahooRows": 0, "tailRows": 0}
    assert entries == []


# ---- live Playwright tests (gated) --------------------------------------

LIVE_REQUIRED = "YAHOO_LIVE must be set to run live Yahoo draft-analysis tests"


@pytest.mark.skipif(
    not os.environ.get("YAHOO_LIVE"),
    reason=LIVE_REQUIRED,
)
def test_yahoo_live_render_all_three_formats(tmp_path):
    """Render each Yahoo game_type with Playwright; assert it returns >=400 rows.
    Saves the captured HTML to `pipeline/fixtures/yahoo/<game_type>-live-fixture.html`
    so future tests can use it as an offline fixture (re-record with
    YAHOO_LIVE=1 if Yahoo changes layout).
    """
    from playwright.sync_api import sync_playwright
    for game_type in ("half-ppr", "ppr", "standard"):
        url = f"https://football.fantasysports.yahoo.com/f1/draftanalysis?type={game_type}&count=2000"
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.set_default_timeout(60000)
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(12000)
            html = page.locator("table").first.evaluate("el => el.outerHTML")
            browser.close()
        out = tmp_path / f"{game_type}-live-fixture.html"
        out.write_text(html, encoding="utf-8")
        rows = parse_yahoo_adp_rows(html)
        assert len(rows) >= 400, f"expected at least 400 parsed rows for {game_type}, got {len(rows)}"
        assert all(r.adp > 0 for r in rows)
