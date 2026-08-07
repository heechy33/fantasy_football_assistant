from pathlib import Path

import pytest

from fftoday import parse_fftoday_page, validate_projection_gates
from transform import SeasonProjection


FIXTURE = '''<!doctype html><html><body><p>Updated: 8/6/2026</p><table>
<tr><th>Chg</th><th>Player Sort First: Last:</th><th>Tm</th><th>Bye</th><th>Cmp</th><th>Att</th><th>Yds</th><th>TD</th><th>INT</th><th>Att</th><th>Yds</th><th>TD</th><th>FPts</th></tr>
<tr><td></td><td>Test QB</td><td>BUF</td><td>7</td><td>300</td><td>500</td><td>4,000</td><td>30</td><td>10</td><td>40</td><td>200</td><td>2</td><td>300</td></tr>
</table></body></html>'''


def test_qb_schema_and_components_are_normalized():
    rows, update, _ = parse_fftoday_page(FIXTURE, 'QB')
    assert update == '8/6/2026'
    assert rows[0]['stats'] == {
        'pass_cmp': 300.0, 'pass_att': 500.0, 'pass_yd': 4000.0,
        'pass_td': 30.0, 'pass_int': 10.0, 'rush_att': 40.0,
        'rush_yd': 200.0, 'rush_td': 2.0,
    }


def test_projection_gate_fails_empty_and_duplicates():
    row = SeasonProjection('1', 'fftoday', {'pass_yd': 1})
    issues = validate_projection_gates([row, row], {'QB': 1})
    assert any('duplicate' in issue for issue in issues)
    assert any('RB projection rows' in issue for issue in issues)
