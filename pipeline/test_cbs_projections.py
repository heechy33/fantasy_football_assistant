"""Coverage for pipeline/cbs_projections.py — the CBS Sports projection adapter.
Fixture-driven (no HTTP): the stat-column mapping, group-colspan header parsing,
name/team extraction, the fpts reconciliation gate, and Sleeper-vocab output
are pinned here so a future drift in CBS's table shape fails loudly instead of
silently shifting columns.
"""

from __future__ import annotations

import cbs_projections as cbs


def _skill_row(name, pid, team, cells):
    slug = name.lower().replace(" ", "-")
    return (
        f'<tr class="js-tr-game-select"><td><span class="CellPlayerName--long">'
        f'<span><a href="/nfl/players/{pid}/{slug}/fantasy/">'
        f"{name}</a><span class=\"CellPlayerName-position\">QB</span>"
        f'<span class="CellPlayerName-team">{team}</span></span></span></td>'
        + "".join(f"<td>{c}</td>" for c in cells)
        + "</tr>"
    )


def _qb_page(rows):
    rows_html = "".join(rows)
    return f"""<div id="TableBase"><div><table class="TableBase-table"><thead>
<tr class="TableBase-headGroupTr"><th class="TableBase-headGroupTh" colspan=""><span></span></th><th class="TableBase-headGroupTh" colspan=""><span></span></th><th class="TableBase-headGroupTh" colspan="7"><span>Passing</span></th><th class="TableBase-headGroupTh" colspan="4"><span>Rushing</span></th><th class="TableBase-headGroupTh" colspan="3"><span>Misc</span></th></tr>
<tr class="TableBase-headTr"><th>Player</th><th>gp Games Played</th><th>att Pass Attempts</th><th>cmp Pass Completions</th><th>yds Passing Yards</th><th>yds/g Passing Yards Per Game</th><th>td Touchdowns Passes</th><th>int Interceptions Thrown</th><th>rate Passer Rating</th><th>att Rushing Attempts</th><th>yds Rushing Yards</th><th>avg Average Yards Per Rush</th><th>td Rushing Touchdowns</th><th>fl Fumbles Lost</th><th>fpts Fantasy Points</th><th>fppg Fantasy Points Per Game</th></tr>
</thead><tbody>{rows_html}</tbody></table></div></div>"""


def _qb_row(name, pid, team, att, cmp_, yds, td, int_, ratt, ryds, rtd, fl):
    fpts = round(0.04 * yds + 4 * td - 2 * int_ + 0.1 * ryds + 6 * rtd - 2 * fl, 1)
    cells = [17, att, cmp_, yds, round(yds / 17, 1), td, int_, 95.0, ratt, ryds, round(ryds / ratt, 1), rtd, fl, fpts, round(fpts / 17, 1)]
    return _skill_row(name, pid, team, cells)


_QBS = [
    _qb_row("Josh Allen", "1", "BUF", 487, 334, 3715, 30, 13, 125, 609, 11, 4),
    _qb_row("Lamar Jackson", "2", "BAL", 406, 269, 3375, 33, 11, 107, 604, 3, 4),
    _qb_row("Drake Maye", "3", "NE", 487, 335, 3954, 29, 11, 104, 552, 4, 6),
    _qb_row("Joe Burrow", "4", "CIN", 590, 395, 4175, 33, 12, 48, 179, 1, 2),
    _qb_row("Brock Purdy", "5", "SF", 548, 370, 4154, 28, 14, 71, 304, 4, 4),
    _qb_row("Dak Prescott", "6", "DAL", 582, 384, 4293, 31, 11, 49, 174, 2, 3),
    _qb_row("Caleb Williams", "7", "CHI", 548, 327, 3830, 27, 9, 79, 431, 2, 3),
    _qb_row("Jaxson Dart", "8", "NYG", 510, 325, 3595, 23, 11, 101, 549, 7, 3),
    _qb_row("Patrick Mahomes II", "9", "KC", 540, 370, 4100, 29, 12, 70, 320, 5, 4),
    _qb_row("Jalen Hurts", "10", "PHI", 488, 317, 3573, 24, 7, 112, 461, 8, 4),
    _qb_row("Kyler Murray", "11", "ARI", 545, 360, 3750, 24, 10, 85, 480, 5, 3),
    _qb_row("Tua Tagovailoa", "12", "MIA", 530, 380, 4100, 27, 10, 30, 90, 2, 3),
    _qb_row("Justin Herbert", "13", "LAC", 560, 375, 4000, 28, 11, 45, 200, 3, 2),
    _qb_row("C.J. Stroud", "14", "HOU", 555, 365, 3900, 26, 12, 60, 250, 2, 4),
    _qb_row("Jordan Love", "15", "GB", 530, 350, 3750, 27, 13, 40, 180, 2, 5),
    _qb_row("Anthony Richardson", "16", "IND", 420, 260, 2900, 20, 12, 130, 700, 8, 5),
    _qb_row("Trevor Lawrence", "17", "JAX", 545, 360, 3700, 23, 13, 65, 280, 4, 3),
    _qb_row("Matthew Stafford", "18", "LAR", 560, 385, 4100, 27, 11, 25, 60, 1, 3),
    _qb_row("Sam Darnold", "19", "NE", 520, 340, 3600, 25, 14, 55, 240, 3, 4),
]


def test_parse_qb_page_maps_columns_and_extracts_identity():
    rows = cbs.parse_cbs_page(_qb_page(_QBS), "QB")
    assert len(rows) == len(_QBS)
    allen = rows[0]
    assert allen.name == "Josh Allen"
    assert allen.team == "BUF"
    assert allen.stats == {
        "pass_att": 487.0, "pass_cmp": 334.0, "pass_yd": 3715.0,
        "pass_td": 30.0, "pass_int": 13.0,
        "rush_att": 125.0, "rush_yd": 609.0, "rush_td": 11.0,
        "fum_lost": 4.0,
    }
    assert allen.fpts == round(0.04 * 3715 + 4 * 30 - 2 * 13 + 0.1 * 609 + 6 * 11 - 2 * 4, 1)


def test_reconciliation_fit_passes_for_correctly_mapped_columns():
    rows = cbs.parse_cbs_page(_qb_page(_QBS), "QB")
    r2, median_error = cbs._fit_quality(rows, "QB")
    assert r2 >= cbs.MIN_R2
    assert median_error <= cbs.MAX_MEDIAN_REL_ERROR


def test_reconciliation_fit_degrades_when_a_column_is_not_linear_in_fpts():
    # Rotate the pass_yd column across rows: fpts is a function of each row's
    # own passing yards, so a mis-read pass_yd is no longer linear in fpts and
    # the gate must collapse below threshold instead of shipping the rows.
    rows = cbs.parse_cbs_page(_qb_page(_QBS), "QB")
    values = [row.stats["pass_yd"] for row in rows][::-1]
    for row, value in zip(rows, values):
        row.stats["pass_yd"] = value
    fit = cbs._fit_quality(rows, "QB")
    assert fit is not None
    assert fit[0] < cbs.MIN_R2


def test_cbs_provider_result_matches_and_reports_excluded_positions():
    sleeper_index = {("josh allen", "QB"): "allen", ("lamar jackson", "QB"): "lamar"}
    result = cbs.cbs_provider_result(
        {"QB": _qb_page(_QBS)},
        season=2026,
        sleeper_index=sleeper_index,
        valid_player_ids={"allen", "lamar"},
        fetched_at="2026-08-13T00:00:00Z",
    )
    assert result.block["rows"] == 2
    assert result.block["positionRows"] == {"QB": 2}
    assert result.stats_by_player["allen"]["pass_yd"] == 3715.0
    # Positions with no page are recorded as excluded, never shipped.
    excluded = {entry["position"] for entry in result.block["positionsExcluded"]}
    assert excluded == {"RB", "WR", "TE", "K", "DST"}


def test_dst_rows_resolve_team_abbreviation_and_map_stats():
    dst_page = """<div id="TableBase"><div><table class="TableBase-table"><thead>
<tr class="TableBase-headGroupTr"><th colspan=""></th><th colspan=""></th><th colspan=""></th><th colspan=""></th><th colspan=""></th><th colspan=""></th><th colspan=""></th><th colspan=""></th><th colspan=""></th><th colspan=""></th><th colspan="3"><span>Yards Allowed</span></th><th colspan=""></th><th colspan=""></th><th colspan=""></th></tr>
<tr class="TableBase-headTr"><th>Team</th><th>int Interceptions</th><th>sfty Safeties</th><th>sck Sacks</th><th>tk Tackles</th><th>frec Defensive Fumbles Recovered</th><th>fum Forced Fumbles</th><th>dtd Defensive Touchdowns</th><th>pts Points Allowed</th><th>ppg Points Allowed Per Game</th><th>pass Net Passing Yards Allowed</th><th>rush Rushing Yards Allowed</th><th>total Total Yards Allowed</th><th>avg Yards Against Per Game</th><th>fpts Fantasy Points</th><th>fppg Fantasy Points Per Game</th></tr>
</thead><tbody>
<tr class="js-tr-game-select"><td><span class="CellLogoNameLockup"><div class="TeamLogoNameLockup"><div class="TeamLogoNameLockup-nameContainer"><div class="TeamLogoNameLockup-name"><span class="TeamName"><a href="/nfl/teams/DEN/denver-broncos/">Denver</a></span></div></div></div></span></td><td>15</td><td>0</td><td>72.6</td><td>649</td><td>10</td><td>14</td><td>2.9</td><td>315</td><td>18.5</td><td>0</td><td>1763</td><td>4243</td><td>249.6</td><td>276</td><td>16.2</td></tr>
</tbody></table></div></div>"""
    rows = cbs.parse_cbs_page(dst_page, "DST")
    assert len(rows) == 1
    row = rows[0]
    assert row.name is None
    assert row.team == "DEN"
    assert row.stats == {
        "int": 15.0, "safe": 0.0, "sack": 72.6, "fum_rec": 10.0,
        "ff": 14.0, "def_td": 2.9, "pts_allow": 315.0, "yds_allow": 4243.0,
    }
    assert row.fpts == 276.0


def test_number_parser_treats_garbage_as_missing():
    assert cbs._number("4,243") == 4243.0
    assert cbs._number("—") is None
    assert cbs._number("ù") is None
    assert cbs._number("") is None
    assert cbs._number("0") == 0.0

