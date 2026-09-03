from unittest.mock import MagicMock

import pytest
import requests

from fftoday import (
    TOP_ADP_PROJECTION_COVERAGE_THRESHOLD,
    FFTodayProjectionProvider,
    _build_name_index,
    _match_projection,
    parse_fftoday_page,
    validate_projection_gates,
)
from transform import SeasonProjection


FIXTURE = '''<!doctype html><html><body><p>Updated: 8/6/2026</p><table>
<tr><th>Chg</th><th>Player Sort First: Last:</th><th>Tm</th><th>Bye</th><th>Cmp</th><th>Att</th><th>Yds</th><th>TD</th><th>INT</th><th>Att</th><th>Yds</th><th>TD</th><th>FPts</th></tr>
<tr><td></td><td>Test QB</td><td>BUF</td><td>7</td><td>300</td><td>500</td><td>4,000</td><td>30</td><td>10</td><td>40</td><td>200</td><td>2</td><td>300</td></tr>
</table></body></html>'''

RB_FIXTURE = '''<!doctype html><html><body><p>Updated: 8/6/2026</p><table>
<tr><th>Chg</th><th>Player Sort First: Last:</th><th>Tm</th><th>Bye</th><th>Att</th><th>Yds</th><th>TD</th><th>Rec</th><th>Yds</th><th>TD</th><th>FPts</th></tr>
<tr><td></td><td>Test RB</td><td>DET</td><td>8</td><td>250</td><td>1200</td><td>10</td><td>40</td><td>300</td><td>2</td><td>200</td></tr>
</table></body></html>'''

K_FIXTURE = '''<!doctype html><html><body><p>Updated: 8/6/2026</p><table>
<tr><th>Chg</th><th>Player Sort First: Last:</th><th>Tm</th><th>Bye</th><th>FGM</th><th>FGA</th><th>EPM</th><th>EPA</th><th>FPts</th></tr>
<tr><td></td><td>Test K</td><td>DAL</td><td>10</td><td>30</td><td>33</td><td>40</td><td>41</td><td>130</td></tr>
</table></body></html>'''


def test_qb_schema_and_components_are_normalized():
    rows, update, _ = parse_fftoday_page(FIXTURE, 'QB')
    assert update == '8/6/2026'
    assert rows[0]['byeWeek'] == 7
    assert rows[0]['stats'] == {
        'pass_cmp': 300.0, 'pass_att': 500.0, 'pass_yd': 4000.0,
        'pass_td': 30.0, 'pass_int': 10.0, 'rush_att': 40.0,
        'rush_yd': 200.0, 'rush_td': 2.0,
    }


def test_rb_and_k_column_occurrences_and_bye_are_parsed():
    rb_rows, _, _ = parse_fftoday_page(RB_FIXTURE, 'RB')
    assert rb_rows[0]['byeWeek'] == 8
    assert rb_rows[0]['stats'] == {
        'rush_att': 250.0, 'rush_yd': 1200.0, 'rush_td': 10.0,
        'rec': 40.0, 'rec_yd': 300.0, 'rec_td': 2.0,
    }
    k_rows, _, _ = parse_fftoday_page(K_FIXTURE, 'K')
    assert k_rows[0]['byeWeek'] == 10
    assert k_rows[0]['stats'] == {
        'fgm': 30.0, 'fga': 33.0, 'xpm': 40.0, 'xpa': 41.0,
    }


def test_fetch_retries_transport_errors_but_not_client_4xx():
    sleeps: list[float] = []
    session = MagicMock()
    session.get.side_effect = [
        requests.ConnectionError("blip"),
        MagicMock(text=FIXTURE, raise_for_status=lambda: None),
    ]
    provider = FFTodayProjectionProvider(
        {}, session=session, sleep_fn=sleeps.append, throttle_seconds=0.0, max_attempts=3,
    )
    page = provider._fetch("https://example.test/proj", {"PosID": 10, "Season": "2026"})
    assert "Test QB" in page.text
    assert session.get.call_count == 2

    not_found = requests.HTTPError("404 Client Error")
    not_found.response = MagicMock(status_code=404)
    session.get.side_effect = [not_found]
    with pytest.raises(RuntimeError, match="FFToday fetch failed"):
        provider._fetch("https://example.test/proj", {"PosID": 10, "Season": "2026"})
    assert session.get.call_count == 3  # prior 2 + one non-retryable 404


def test_fetch_retries_timeout_as_a_transport_failure():
    session = MagicMock()
    session.get.side_effect = [
        requests.Timeout("slow upstream"),
        MagicMock(text=FIXTURE, raise_for_status=lambda: None),
    ]
    provider = FFTodayProjectionProvider(
        {}, session=session, sleep_fn=lambda _: None, throttle_seconds=0.0, max_attempts=3,
    )

    page = provider._fetch("https://example.test/proj", {"PosID": 10, "Season": "2026"})

    assert "Test QB" in page.text
    assert session.get.call_count == 2


def test_projection_gate_fails_empty_and_duplicates():
    row = SeasonProjection('1', 'fftoday', {'pass_yd': 1})
    issues = validate_projection_gates([row, row], {'QB': 1})
    assert any('duplicate' in issue for issue in issues)
    assert any('RB projection rows' in issue for issue in issues)


def test_top_adp_projection_coverage_gate_passes_above_threshold_and_fails_below():
    # Was an inline 0.97 calibrated against FFC's shallower mock-lobby board;
    # lowered (see fftoday.py's constant docstring) once the ADP switch to
    # Sleeper's broader draft-lobby board pushed genuinely un-projected deep
    # fliers into the top-300 seed. Still must catch a real regression, e.g. a
    # crosswalk/matching bug that drops coverage far below the new floor.
    assert TOP_ADP_PROJECTION_COVERAGE_THRESHOLD == pytest.approx(0.85)

    row = SeasonProjection('1', 'fftoday', {'pass_yd': 1})
    # Exactly at the floor must pass; one more miss must fail.
    at_floor = ['1'] * 85 + ['missing'] * 15
    assert not any(
        'projection coverage' in issue
        for issue in validate_projection_gates([row], {}, required_rows={}, top_adp_ids=at_floor)
    )
    below_floor = ['1'] * 84 + ['missing'] * 16
    assert any(
        'projection coverage' in issue
        for issue in validate_projection_gates([row], {}, required_rows={}, top_adp_ids=below_floor)
    )

    # A real regression (almost nothing matches) must still fail regardless of
    # where the threshold is set.
    mostly_missing = ['1'] + ['missing'] * 299
    issues = validate_projection_gates([row], {}, required_rows={}, top_adp_ids=mostly_missing)
    assert any('projection coverage' in issue for issue in issues)


def test_formal_first_name_aliases_are_narrow_and_auditable():
    index = _build_name_index({
        '1': {'full_name': 'Kenny Gainwell', 'position': 'RB', 'team': 'TB'},
        '2': {'full_name': 'Chig Okonkwo', 'position': 'TE', 'team': 'WAS'},
    })
    assert _match_projection(
        {'name': 'Kenneth Gainwell', 'position': 'RB', 'team': 'TB'}, index,
    ) == '1'
    assert _match_projection(
        {'name': 'Chigoziem Okonkwo', 'position': 'TE', 'team': 'WAS'}, index,
    ) == '2'
    assert _match_projection(
        {'name': 'Andres Borregales', 'position': 'K', 'team': 'NE'}, index,
    ) is None
