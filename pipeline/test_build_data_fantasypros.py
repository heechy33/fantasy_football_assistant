"""Coverage for build_data.py's optional, local-only FantasyPros stars step
(FRONTEND_OVERHAUL_PHASE_1_REVISED_PLAN.md section 5). Exercises the
CLI/helper boundary directly (`_run_optional_fantasypros_stars`) rather than
the full `main()` pipeline, since none of this branch touches core data
selection, coverage metrics, or manifest source provenance.
"""

from __future__ import annotations

import json
from pathlib import Path

import build_data

_HEADER = "RK,TIERS,PLAYER NAME,TEAM,POS,UPSIDE ,BUST ,SOS,ECR VS ADP"

_SLEEPER_PLAYERS = {
    "1": {"full_name": "Ja'Marr Chase", "position": "WR", "team": "CIN"},
}


def _write_csv(path: Path, *rows: str) -> None:
    path.write_text("\n".join((_HEADER, *rows)) + "\n", encoding="utf-8")


def test_unset_dir_skips_and_does_not_write(tmp_path, capsys):
    build_data._run_optional_fantasypros_stars(
        None, "2026", _SLEEPER_PLAYERS, tmp_path, "2026-08-12T00:00:00Z",
    )
    assert not (tmp_path / "fantasypros-stars.json").exists()
    assert "[skip] FantasyPros stars: no --fantasypros-dir" in capsys.readouterr().out


def test_unset_dir_leaves_existing_local_artifact_alone(tmp_path, capsys):
    # Flag unset means "don't produce a new artifact this run", not "delete
    # the developer's previous local decoration file".
    stale = {"schemaVersion": 1, "keep": True}
    stars_path = tmp_path / "fantasypros-stars.json"
    stars_path.write_text(json.dumps(stale), encoding="utf-8")

    build_data._run_optional_fantasypros_stars(
        None, "2026", _SLEEPER_PLAYERS, tmp_path, "2026-08-12T00:00:00Z",
    )

    assert json.loads(stars_path.read_text(encoding="utf-8")) == stale
    assert "[skip]" in capsys.readouterr().out


def test_missing_directory_warns_and_suppresses_stale_artifact(tmp_path, capsys):
    stale = {"schemaVersion": 1}
    (tmp_path / "fantasypros-stars.json").write_text(json.dumps(stale), encoding="utf-8")
    missing_dir = tmp_path / "does-not-exist"

    build_data._run_optional_fantasypros_stars(
        str(missing_dir), "2026", _SLEEPER_PLAYERS, tmp_path, "2026-08-12T00:00:00Z",
    )

    assert not (tmp_path / "fantasypros-stars.json").exists()
    out = capsys.readouterr().out
    assert "[warn]" in out
    assert str(missing_dir.resolve()) not in out
    assert "[fantasypros-dir]" in out


def test_missing_file_in_existing_directory_warns_and_suppresses_stale(tmp_path, capsys):
    fp_dir = tmp_path / "fp"
    fp_dir.mkdir()
    stale = {"schemaVersion": 1}
    (tmp_path / "fantasypros-stars.json").write_text(json.dumps(stale), encoding="utf-8")

    build_data._run_optional_fantasypros_stars(
        str(fp_dir), "2026", _SLEEPER_PLAYERS, tmp_path, "2026-08-12T00:00:00Z",
    )

    assert not (tmp_path / "fantasypros-stars.json").exists()
    out = capsys.readouterr().out
    assert "[warn]" in out
    assert str(fp_dir.resolve()) not in out


def test_malformed_csv_warns_and_suppresses_stale_artifact(tmp_path, capsys):
    fp_dir = tmp_path / "fp"
    fp_dir.mkdir()
    _write_csv(fp_dir / "FantasyPros_2026_Draft_ALL_Rankings.csv", "1,1,X,CIN,WR,not-a-star,-,-,-")
    stale = {"schemaVersion": 1}
    (tmp_path / "fantasypros-stars.json").write_text(json.dumps(stale), encoding="utf-8")

    build_data._run_optional_fantasypros_stars(
        str(fp_dir), "2026", _SLEEPER_PLAYERS, tmp_path, "2026-08-12T00:00:00Z",
    )

    assert not (tmp_path / "fantasypros-stars.json").exists()
    assert "[warn]" in capsys.readouterr().out


def test_utf8_bom_csv_is_decoded_at_cli_boundary(tmp_path, capsys):
    fp_dir = tmp_path / "fp"
    fp_dir.mkdir()
    csv_path = fp_dir / "FantasyPros_2026_Draft_ALL_Rankings.csv"
    payload = "\n".join(
        (
            _HEADER,
            "1,1,Ja'Marr Chase,CIN,WR1,5 out of 5,1 out of 5,4 out of 5 stars,+2",
        )
    ) + "\n"
    csv_path.write_bytes(payload.encode("utf-8-sig"))

    build_data._run_optional_fantasypros_stars(
        str(fp_dir), "2026", _SLEEPER_PLAYERS, tmp_path, "2026-08-12T00:00:00Z",
    )

    artifact = json.loads((tmp_path / "fantasypros-stars.json").read_text(encoding="utf-8"))
    assert artifact["players"]["1"]["upside"] == 5
    assert "[ok]" in capsys.readouterr().out


def test_valid_csv_writes_artifact_with_reconciled_counts(tmp_path, capsys):
    fp_dir = tmp_path / "fp"
    fp_dir.mkdir()
    _write_csv(
        fp_dir / "FantasyPros_2026_Draft_ALL_Rankings.csv",
        "AD,,Sponsored,,,-,-,-,-",
        "1,1,Ja'Marr Chase,CIN,WR1,5 out of 5,1 out of 5,4 out of 5 stars,+2",
        "2,4,Nobody Special,NYG,WR9,1 out of 5,3 out of 5,2 out of 5 stars,-5",
    )

    build_data._run_optional_fantasypros_stars(
        str(fp_dir), "2026", _SLEEPER_PLAYERS, tmp_path, "2026-08-12T00:00:00Z",
    )

    out = capsys.readouterr().out
    assert "[ok] FantasyPros stars: matched 1, unmatched 1 (of 2 rows)" in out

    artifact = json.loads((tmp_path / "fantasypros-stars.json").read_text(encoding="utf-8"))
    assert artifact["source"]["file"] == "FantasyPros_2026_Draft_ALL_Rankings.csv"
    assert artifact["source"]["droppedNonRankRows"] == 1
    assert artifact["source"]["rows"] == 2
    assert artifact["source"]["matched"] == 1
    assert artifact["source"]["unmatched"] == 1
    assert artifact["players"]["1"]["upside"] == 5
    assert artifact["unmatched"][0]["name"] == "Nobody Special"


def test_gitignore_excludes_the_local_stars_artifact():
    repo_root = Path(__file__).resolve().parent.parent
    gitignore = (repo_root / ".gitignore").read_text(encoding="utf-8")
    assert "data/fantasypros-stars.json" in gitignore
