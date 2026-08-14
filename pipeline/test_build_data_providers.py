"""Coverage for build_data.py's optional, local-only FantasyPros per-site ADP step.
Exercises the CLI/helper boundary directly (`_run_optional_fantasypros_adp`) rather
than the full `main()` pipeline — same approach as test_build_data_fantasypros.py,
and proof the shared `_run_optional_local_csv_artifact` skeleton serves both steps.
"""

from __future__ import annotations

import json
from pathlib import Path

import build_data

_HEADER = "Rank,Player (Bye),POS,ESPN,Sleeper,CBS,NFL,RTSports,Fantrax,AVG,Real-Time"

_SLEEPER_PLAYERS = {
    "1": {"full_name": "Jahmyr Gibbs", "position": "RB", "team": "DET"},
    "2": {"full_name": "Tyreek Hill", "position": "WR", "team": None},
    "HOU": {"position": "DEF", "team": "HOU"},
}

_VALID_IDS = {"1", "2", "HOU"}


def _write_csv(path: Path, *rows: str) -> None:
    path.write_text("\n".join((_HEADER, *rows)) + "\n", encoding="utf-8")


def _row(rank, cell, pos, *, espn="", sleeper="", cbs="", rtsports="", fantrax="", avg="", real_time=""):
    # Explicit 11-column rows — hand-counted commas are how fixtures drift.
    return ",".join(
        [str(rank), cell, pos, espn, sleeper, cbs, "", rtsports, fantrax, avg, real_time]
    )


def test_unset_dir_skips_and_does_not_write(tmp_path, capsys):
    build_data._run_optional_fantasypros_adp(
        None, "2026", _SLEEPER_PLAYERS, _VALID_IDS, tmp_path, "2026-08-12T00:00:00Z",
    )
    assert not (tmp_path / "fantasypros-adp.json").exists()
    assert "[skip] FantasyPros ADP: no --fantasypros-dir" in capsys.readouterr().out


def test_valid_csv_writes_artifact(tmp_path, capsys):
    fp_dir = tmp_path / "fp"
    fp_dir.mkdir()
    _write_csv(
        fp_dir / "FantasyPros_2026_Overall_ADP_Rankings.csv",
        _row(1, "Jahmyr Gibbs   DET (6)", "RB1", espn="14.5", sleeper="15.2", cbs="13.8", rtsports="14.0", fantrax="14.2", avg="14.1", real_time="14  -1"),
        _row(4, "Tyreek Hill", "WR12", espn="30.0", real_time="30  +1"),
    )
    build_data._run_optional_fantasypros_adp(
        str(fp_dir), "2026", _SLEEPER_PLAYERS, _VALID_IDS, tmp_path, "2026-08-12T00:00:00Z",
    )
    out = capsys.readouterr().out
    assert "[ok] FantasyPros ADP: matched 2, unmatched 0 (of 2 rows)" in out
    artifact = json.loads((tmp_path / "fantasypros-adp.json").read_text(encoding="utf-8"))
    assert artifact["source"]["emptyColumns"] == ["NFL"]
    assert artifact["players"]["1"]["adp"]["espn"] == 14.5


def test_malformed_csv_warns_and_suppresses_stale_artifact(tmp_path, capsys):
    fp_dir = tmp_path / "fp"
    fp_dir.mkdir()
    _write_csv(
        fp_dir / "FantasyPros_2026_Overall_ADP_Rankings.csv",
        _row(1, "Jahmyr Gibbs   DET (6)", "RB1", espn="not-a-number"),
    )
    stale = {"schemaVersion": 1}
    (tmp_path / "fantasypros-adp.json").write_text(json.dumps(stale), encoding="utf-8")

    build_data._run_optional_fantasypros_adp(
        str(fp_dir), "2026", _SLEEPER_PLAYERS, _VALID_IDS, tmp_path, "2026-08-12T00:00:00Z",
    )

    assert not (tmp_path / "fantasypros-adp.json").exists()
    assert "[warn]" in capsys.readouterr().out


def test_gitignore_excludes_the_local_adp_artifact():
    repo_root = Path(__file__).resolve().parent.parent
    gitignore = (repo_root / ".gitignore").read_text(encoding="utf-8")
    assert "data/fantasypros-adp.json" in gitignore


def test_sleeper_fetch_error_carries_previous_provider_rows_as_stale(tmp_path):
    from unittest import mock

    import provider_projections

    previous = provider_projections.merge_and_assemble(
        None,
        [provider_projections.sleeper_provider_result(
            [{'player_id': '1', 'stats': {'rush_yd': 100}}],
            {'1'},
            fetched_at='2026-08-12T00:00:00Z',
        )],
        season=2026,
        generated_at='2026-08-12T00:00:00Z',
        now_iso='2026-08-12T00:00:00Z',
    )
    (tmp_path / 'projections-providers.json').write_text(json.dumps(previous), encoding='utf-8')

    with mock.patch('espn_projections.fetch_espn_projections', side_effect=RuntimeError('offline')), \
            mock.patch('cbs_projections.fetch_cbs_position_page', side_effect=RuntimeError('offline')):
        artifact, _, summary = build_data._run_provider_projections(
            [], {'1'}, season='2026', out_dir=tmp_path, fetched_at='2026-08-13T00:00:00Z',
            sleeper_index={}, espn_id_to_player_id={}, sleeper_error='Sleeper unavailable',
        )

    sleeper = next(block for block in artifact['providers'] if block['key'] == 'sleeper')
    assert sleeper['status'] == 'stale'
    assert sleeper['rows'] == 1
    assert artifact['players']['1']['sleeper'] == {'rush_yd': 100}
    assert summary['providers']['sleeper']['diagnostic'] == 'RuntimeError: Sleeper unavailable'


def test_malformed_previous_provider_artifact_does_not_break_step(tmp_path):
    from unittest import mock

    (tmp_path / 'projections-providers.json').write_text(
        json.dumps({'providers': 'not-a-list', 'players': []}), encoding='utf-8',
    )
    with mock.patch('espn_projections.fetch_espn_projections', side_effect=RuntimeError('offline')), \
            mock.patch('cbs_projections.fetch_cbs_position_page', side_effect=RuntimeError('offline')):
        artifact, _, _ = build_data._run_provider_projections(
            [], set(), season='2026', out_dir=tmp_path, fetched_at='2026-08-13T00:00:00Z',
            sleeper_index={}, espn_id_to_player_id={}, sleeper_error='Sleeper unavailable',
        )

    assert {block['key'] for block in artifact['providers']} == {'sleeper', 'espn', 'cbs'}
    assert all(block['status'] == 'error' for block in artifact['providers'])


def test_provider_projections_step_is_isolated_from_canonical_artifact(tmp_path):
    """The strongest anti-corruption check: the provider-projections step must
    never touch projections-season.json, and each provider fails open
    independently without changing main()'s exit code."""
    from unittest import mock

    import build_data
    import espn_projections

    canonical = tmp_path / "projections-season.json"
    canonical.write_bytes(b'["unchanged"]')

    with mock.patch.object(espn_projections, "fetch_espn_projections", side_effect=RuntimeError("offline")), \
            mock.patch("cbs_projections.fetch_cbs_position_page", side_effect=RuntimeError("offline")):
        artifact, source_entries, summary = build_data._run_provider_projections(
            [], set(), season="2026", out_dir=tmp_path, fetched_at="2026-08-13T00:00:00Z",
            sleeper_index={}, espn_id_to_player_id={},
        )

    # The canonical FFToday artifact is byte-identical; only the provider file was written.
    assert canonical.read_bytes() == b'["unchanged"]'
    assert (tmp_path / "projections-providers.json").exists()
    # Sleeper with zero rows is still 'ok' (empty, not failed); ESPN's fetch error is recorded.
    assert artifact["providers"][0]["key"] == "sleeper"
    assert artifact["providers"][0]["status"] == "ok"
    assert artifact["providers"][0]["rows"] == 0
    assert summary["providers"]["espn"]["status"] == "error"
    assert summary["providers"]["espn"]["diagnostic"] == "RuntimeError: offline"
def test_cbs_provider_step_writes_block_and_merges_stats(tmp_path):
    """End-to-end wiring check: `_run_provider_projections` fetches CBS, the
    reconciliation gate passes a correctly-mapped fixture, and the block +
    per-player stats land in the committed artifact."""
    from unittest import mock

    def _cbs_qb_page():
        def _row(i):
            yds = 3000 + i * 150
            td = 20 + i
            inte = 8 + i % 4
            ryds = 200 + i * 60
            rtd = 2 + i % 3
            fl = 2 + i % 3
            fpts = round(0.04 * yds + 4 * td - 2 * inte + 0.1 * ryds + 6 * rtd - 2 * fl, 1)
            cells = [17, 400 + i * 20, 260 + i * 10, yds, round(yds / 17, 1), td, inte, 95.0,
                     60 + i * 5, ryds, round(ryds / (60 + i * 5), 1), rtd, fl, fpts, round(fpts / 17, 1)]
            cell_html = "".join(f"<td>{c}</td>" for c in cells)
            return (
                f'<tr class="js-tr-game-select"><td><span class="CellPlayerName--long">'
                f'<span><a href="/nfl/players/{100 + i}/x/fantasy/">QB {i}</a>'
                f'<span class="CellPlayerName-position">QB</span>'
                f'<span class="CellPlayerName-team">BUF</span></span></span></td>'
                + cell_html + "</tr>"
            )

        header = (
            '<tr class="TableBase-headGroupTr"><th colspan=""></th><th colspan=""></th>'
            '<th colspan="7"><span>Passing</span></th><th colspan="4"><span>Rushing</span></th>'
            '<th colspan="3"><span>Misc</span></th></tr>'
            '<tr class="TableBase-headTr"><th>Player</th><th>gp Games Played</th>'
            '<th>att Pass Attempts</th><th>cmp Pass Completions</th><th>yds Passing Yards</th>'
            '<th>yds/g Passing Yards Per Game</th><th>td Touchdowns Passes</th>'
            '<th>int Interceptions Thrown</th><th>rate Passer Rating</th>'
            '<th>att Rushing Attempts</th><th>yds Rushing Yards</th><th>avg Average Yards Per Rush</th>'
            '<th>td Rushing Touchdowns</th><th>fl Fumbles Lost</th><th>fpts Fantasy Points</th>'
            '<th>fppg Fantasy Points Per Game</th></tr>'
        )
        body = "".join(_row(i) for i in range(8))
        return f'<div id="TableBase"><div><table class="TableBase-table"><thead>{header}</thead><tbody>{body}</tbody></table></div></div>'

    sleeper_index = {("qb 0", "QB"): "qb0"}
    with mock.patch('espn_projections.fetch_espn_projections', side_effect=RuntimeError('offline')), \
            mock.patch('cbs_projections.fetch_cbs_position_page', return_value=_cbs_qb_page()):
        artifact, source_entries, summary = build_data._run_provider_projections(
            [], {'qb0'}, season='2026', out_dir=tmp_path, fetched_at='2026-08-13T00:00:00Z',
            sleeper_index=sleeper_index, espn_id_to_player_id={},
        )

    cbs_block = next(block for block in artifact['providers'] if block['key'] == 'cbs')
    assert cbs_block['status'] == 'ok'
    assert cbs_block['rows'] == 1
    assert cbs_block['positionRows'] == {'QB': 1}
    assert artifact['players']['qb0']['cbs']['pass_yd'] == 3000.0
    assert summary['providers']['cbs']['status'] == 'ok'
    assert source_entries['cbs_projections']['rows'] == 1

