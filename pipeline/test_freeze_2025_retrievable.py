"""Tests for pipeline/freeze_2025_retrievable.py — no HTTP; fetchers are monkeypatched.

The freezer is the blend-ladder's step A/A2 input freezer (gates-blend-addendum.md sections 1-2).
These tests pin the fail-closed guard, the all-or-nothing write order, and provenance SHA-256
truthfulness, mirroring test_backtest_snapshot.py's no-network discipline."""

from __future__ import annotations

import hashlib
import json

import pytest

import freeze_2025_retrievable as fz


@pytest.fixture()
def patched_fetches(monkeypatch):
    """Deterministic in-memory stand-ins for the three network boundaries."""
    sleeper = json.dumps([{"player_id": "5849", "stats": {"pts_ppr": 300.0}}]).encode()
    espn = json.dumps({"players": [{"player": {"id": 1, "stats": []}}]}).encode()

    def fake_weekly(week: int) -> tuple[bytes, int]:
        return json.dumps({f"p{week}": {"pts_ppr": float(week)}}).encode(), 1

    monkeypatch.setattr(fz, "fetch_sleeper_projections_raw", lambda: (sleeper, 1))
    monkeypatch.setattr(fz, "fetch_espn_defaults_raw", lambda: (espn, 1, 0))
    monkeypatch.setattr(fz, "fetch_weekly_raw", fake_weekly)
    return sleeper, espn


def _sha(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_freeze_writes_files_and_truthful_provenance(tmp_path, monkeypatch, patched_fetches):
    sleeper, espn = patched_fetches
    monkeypatch.setattr(fz, "TARGET_DIR", tmp_path)

    assert fz.main([]) == 0

    assert (tmp_path / "sleeper-projections-2025.raw.json").read_bytes() == sleeper
    assert (tmp_path / "espn-leaguedefaults-2025.raw.json").read_bytes() == espn
    week1 = tmp_path / "sleeper-weekly-stats-2025-week-01.raw.json"
    assert json.loads(week1.read_bytes()) == {"p1": {"pts_ppr": 1.0}}
    assert len(list(tmp_path.glob("sleeper-weekly-stats-2025-week-*.raw.json"))) == len(fz.WEEKS)

    prov = json.loads((tmp_path / "provenance.json").read_text(encoding="utf-8"))
    assert "UNVERIFIED" in prov["vintageStatus"]  # vintage caveat is carried, not laundered
    inputs = prov["inputs"]
    assert inputs["sleeperProjections"]["rows"] == 1
    assert inputs["espnLeaguedefaults"]["entriesWithSeasonProjection"] == 0
    for entry in [inputs["sleeperProjections"], inputs["espnLeaguedefaults"],
                  *inputs["weeklyStats"]["files"]]:
        assert entry["sha256"] == _sha(tmp_path / entry["file"])  # pins are truthful
    assert len(inputs["weeklyStats"]["files"]) == len(fz.WEEKS)


def test_freeze_fails_closed_on_fetch_error(tmp_path, monkeypatch):
    monkeypatch.setattr(fz, "TARGET_DIR", tmp_path)
    monkeypatch.setattr(fz, "fetch_sleeper_projections_raw", lambda: (_ for _ in ()).throw(RuntimeError("offline")))

    with pytest.raises(RuntimeError):
        fz.main([])
    assert not any(tmp_path.iterdir())  # nothing written when any fetch fails


def test_freeze_aborts_on_existing_freeze_without_force(tmp_path, monkeypatch, patched_fetches):
    monkeypatch.setattr(fz, "TARGET_DIR", tmp_path)
    (tmp_path / "existing.txt").write_text("sentinel")

    assert fz.main([]) == 2  # refuse without --force
    assert (tmp_path / "existing.txt").read_text() == "sentinel"
