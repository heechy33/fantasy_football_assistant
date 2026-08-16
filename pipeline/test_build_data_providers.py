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

    with mock.patch('cbs_projections.fetch_cbs_position_page', side_effect=RuntimeError('offline')):
        artifact, _, summary = build_data._run_provider_projections(
            [], {'1'}, season='2026', out_dir=tmp_path, fetched_at='2026-08-13T00:00:00Z',
            sleeper_index={}, espn_id_to_player_id={}, sleeper_error='Sleeper unavailable',
            espn_payload_error='RuntimeError: offline',
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
    with mock.patch('cbs_projections.fetch_cbs_position_page', side_effect=RuntimeError('offline')):
        artifact, _, _ = build_data._run_provider_projections(
            [], set(), season='2026', out_dir=tmp_path, fetched_at='2026-08-13T00:00:00Z',
            sleeper_index={}, espn_id_to_player_id={}, sleeper_error='Sleeper unavailable',
            espn_payload_error='RuntimeError: offline',
        )

    assert {block['key'] for block in artifact['providers']} == {'sleeper', 'espn', 'cbs'}
    assert all(block['status'] == 'error' for block in artifact['providers'])


def test_provider_projections_step_is_isolated_from_canonical_artifact(tmp_path):
    """The strongest anti-corruption check: the provider-projections step must
    never touch projections-season.json, and each provider fails open
    independently without changing main()'s exit code."""
    from unittest import mock

    import build_data

    canonical = tmp_path / "projections-season.json"
    canonical.write_bytes(b'["unchanged"]')

    with mock.patch("cbs_projections.fetch_cbs_position_page", side_effect=RuntimeError("offline")):
        artifact, source_entries, summary = build_data._run_provider_projections(
            [], set(), season="2026", out_dir=tmp_path, fetched_at="2026-08-13T00:00:00Z",
            sleeper_index={}, espn_id_to_player_id={},
            espn_payload_error="RuntimeError: offline",
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
    with mock.patch('cbs_projections.fetch_cbs_position_page', return_value=_cbs_qb_page()):
        artifact, source_entries, summary = build_data._run_provider_projections(
            [], {'qb0'}, season='2026', out_dir=tmp_path, fetched_at='2026-08-13T00:00:00Z',
            sleeper_index=sleeper_index, espn_id_to_player_id={},
            espn_payload_error='RuntimeError: offline',
        )

    cbs_block = next(block for block in artifact['providers'] if block['key'] == 'cbs')
    assert cbs_block['status'] == 'ok'
    assert cbs_block['rows'] == 1
    assert cbs_block['positionRows'] == {'QB': 1}
    assert artifact['players']['qb0']['cbs']['pass_yd'] == 3000.0
    assert summary['providers']['cbs']['status'] == 'ok'
    assert source_entries['cbs_projections']['rows'] == 1


def _espn_kona_row(full_name, default_position_id, pro_team_id, espn_id, adp):
    return {
        "player": {
            "fullName": full_name,
            "defaultPositionId": default_position_id,
            "proTeamId": pro_team_id,
            "id": espn_id,
            # No stats[]: ADP lives on ownership, independent of projections.
            "ownership": {"averageDraftPosition": adp},
        }
    }


def _espn_kona_payload(head_rows=130):
    players = [
        _espn_kona_row(f"Player {i}", 2, 2, str(5000 + i), float(i + 1))
        for i in range(head_rows)
    ]
    # Censored sentinel tail (dense cluster past the honest region).
    players.extend(
        _espn_kona_row(f"Sentinel {i}", 2, 2, str(9000 + i), 168.0 + (i % 4) * 0.3)
        for i in range(400)
    )
    return {"players": players}


def _mock_main_sources(monkeypatch, tmp_path, fetch_espn):
    """Minimal main() harness: every upstream except the ESPN fetch (injected)
    is patched so main() completes and writes artifacts into tmp_path."""
    from types import SimpleNamespace

    import espn_projections
    import nflverse_source
    import sources

    sleeper = {
        "1": {"full_name": "Test Player", "position": "RB", "fantasy_positions": ["RB"], "team": "BUF", "years_exp": 3},
        **{
            str(1000 + i): {
                "full_name": f"Player {i}", "position": "RB", "fantasy_positions": ["RB"],
                "team": "BUF", "years_exp": 3, "espn_id": str(5000 + i),
            }
            for i in range(130)
        },
    }
    ffc_player = {
        "name": "Test Player", "position": "RB", "team": "BUF", "adp": 1.0,
        "stdev": 1.0, "high": 1, "low": 2, "times_drafted": 10, "bye": 7,
    }
    monkeypatch.setattr(sources, "fetch_sleeper_players", lambda: sleeper)
    monkeypatch.setattr(sources, "fetch_dynastyprocess_crosswalk", lambda: [])
    monkeypatch.setattr(sources, "fetch_ffc_adp_payload", lambda *a, **k: {
        "players": [ffc_player],
        "meta": {"total_drafts": 10, "start_date": "2026-08-02", "end_date": "2026-08-09"},
    })
    monkeypatch.setattr(sources, "fetch_sleeper_adp", lambda _season: [])
    monkeypatch.setattr(sources, "fetch_sleeper_weekly_stats", lambda _season, week: {})
    monkeypatch.setattr(espn_projections, "fetch_espn_projections", fetch_espn)

    class ProjectionProvider:
        def __init__(self, _):
            pass

        def load(self, *_args, **_kwargs):
            return SimpleNamespace(
                projections=[], source_url="projection-source", fetched_at="now",
                upstream_updated_at="today", position_rows={}, diagnostics={}, bye_weeks={},
            )

    monkeypatch.setattr(build_data, "FFTodayProjectionProvider", ProjectionProvider)
    monkeypatch.setattr(nflverse_source, "loaders", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    monkeypatch.setattr(nflverse_source, "optional_loaders", lambda: {})
    monkeypatch.setattr("sys.argv", [
        "build_data.py", "--out-dir", str(tmp_path), "--coverage-threshold", "0",
    ])


def test_build_espn_adp_board_returns_entries_for_kona_payload(tmp_path):
    import transform

    entries, diag = build_data._build_espn_adp_board(
        _espn_kona_payload(), None,
        cv_bands=transform.fit_adp_cv_bands([]),
        espn_id_to_player_id={str(5000 + i): str(1000 + i) for i in range(130)},
        sleeper_index={},
        valid_player_ids={str(1000 + i) for i in range(130)} | {"1"},
        fallback_entries=[transform.AdpEntry("1", "Test Player", "RB", "BUF", 1.0, 1.0, 1, 2, 10, 7)],
    )
    assert entries is not None
    assert diag == {"censorCutoff": 165.0, "espnRows": 130, "tailRows": 1}
    assert len(entries) == 131


def test_build_espn_adp_board_fails_open_below_min_rows(tmp_path):
    import transform

    payload = {"players": [
        _espn_kona_row("Player 0", 2, 2, "5000", 5.0),
        _espn_kona_row("Player 1", 2, 2, "5001", 10.0),
    ]}
    entries, diag = build_data._build_espn_adp_board(
        payload, None,
        cv_bands=transform.fit_adp_cv_bands([]),
        espn_id_to_player_id={"5000": "1000", "5001": "1001"},
        sleeper_index={},
        valid_player_ids={"1000", "1001"},
        fallback_entries=[],
    )
    assert entries is None
    assert "espnRows 2 < ESPN_ADP_MIN_ROWS 120" in diag["diagnostic"]


def test_build_espn_adp_board_fetch_error_and_schema_drift_fail_open(tmp_path):
    import transform

    entries, diag = build_data._build_espn_adp_board(
        None, "RuntimeError: offline",
        cv_bands=transform.fit_adp_cv_bands([]),
        espn_id_to_player_id={}, sleeper_index={}, valid_player_ids=set(), fallback_entries=[],
    )
    assert entries is None
    assert diag["diagnostic"] == "RuntimeError: offline"

    entries, diag = build_data._build_espn_adp_board(
        {"players": "nope"}, None,
        cv_bands=transform.fit_adp_cv_bands([]),
        espn_id_to_player_id={}, sleeper_index={}, valid_player_ids=set(), fallback_entries=[],
    )
    assert entries is None
    assert "no players array" in diag["diagnostic"]


def test_build_espn_adp_board_swallows_degenerate_cutoff(tmp_path):
    import transform

    players = []
    for pick in range(1, 101):
        for _ in range(5):
            players.append(_espn_kona_row(f"P{pick}", 2, 2, f"id{pick}", float(pick)))
    for _ in range(500):
        players.append(_espn_kona_row("Spike", 2, 2, "spike", 41.0))
    entries, diag = build_data._build_espn_adp_board(
        {"players": players}, None,
        cv_bands=transform.fit_adp_cv_bands([]),
        espn_id_to_player_id={}, sleeper_index={}, valid_player_ids=set(), fallback_entries=[],
    )
    assert entries is None
    assert "censor" in diag["diagnostic"].lower()


def test_main_single_kona_fetch_yields_espn_board_and_provider_block(monkeypatch, tmp_path):
    from unittest import mock

    fetch_espn = mock.Mock(return_value=_espn_kona_payload())
    _mock_main_sources(monkeypatch, tmp_path, fetch_espn)
    assert build_data.main() == 0

    # One GET serves both the ADP board and the provider-projections block.
    assert fetch_espn.call_count == 1

    board = json.loads((tmp_path / "adp-espn-ppr.json").read_text(encoding="utf-8"))
    assert len(board) == 131  # 130 ESPN head rows + the single FFC tail row
    assert board[0]["adpSource"] == "espn"
    assert board[0]["stdevSource"] == "fitted"
    adps = [entry["adp"] for entry in board]
    assert adps == sorted(adps)
    # The censored-region FFC fallback row is clamped to the cutoff (165) and
    # keeps its own source label — the artifact is honestly mixed.
    assert board[-1]["adp"] == 165.0
    assert board[-1]["adpSource"] == "ffc"

    providers = json.loads((tmp_path / "projections-providers.json").read_text(encoding="utf-8"))
    espn_block = next(block for block in providers["providers"] if block["key"] == "espn")
    assert espn_block["status"] == "ok"

    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["sources"]["espn_adp_ppr"]["status"] == "ok"
    assert manifest["sources"]["espn_adp_ppr"]["espnRows"] == 130
    assert manifest["sources"]["espn_adp_ppr"]["tailRows"] == 1
    assert manifest["sources"]["espn_adp_ppr"]["censorCutoff"] == 165.0
    assert manifest["sources"]["adp_active_espn_ppr"]["activeAdpSource"] == "espn"


def test_main_espn_fetch_failure_leaves_adp_ppr_byte_identical(monkeypatch, tmp_path):
    from unittest import mock

    import espn_projections

    _mock_main_sources(monkeypatch, tmp_path, mock.Mock(return_value=_espn_kona_payload()))
    assert build_data.main() == 0
    baseline = (tmp_path / "adp-ppr.json").read_bytes()
    assert (tmp_path / "adp-espn-ppr.json").exists()

    # Second run: the ESPN fetch fails -> the Sleeper board is byte-identical
    # and the stale ESPN board is removed, not left looking current.
    monkeypatch.setattr(espn_projections, "fetch_espn_projections", mock.Mock(side_effect=RuntimeError("offline")))
    assert build_data.main() == 0
    assert (tmp_path / "adp-ppr.json").read_bytes() == baseline
    assert not (tmp_path / "adp-espn-ppr.json").exists()
    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["sources"]["espn_adp_ppr"]["status"] == "error"
    assert "RuntimeError" in manifest["sources"]["espn_adp_ppr"]["diagnostic"]



