"""Coverage for pipeline/backtest_snapshot.py.

The snapshot script is the Edge Validation Gate's evaluation-layer-A input
freezer (2025 preseason FFC ADP + FFToday projections). These tests pin the
leakage/identity/outcome gates and the fail-closed behavior of ``main()`` with
monkeypatched network boundaries — no HTTP, mirroring test_build_data_providers.py.
"""

from __future__ import annotations

import json
from datetime import date
from types import SimpleNamespace

import backtest_snapshot as bs
import match
from transform import SeasonProjection

# ---------------------------------------------------------------------------
# Small identity fixtures
# ---------------------------------------------------------------------------

_SLEEPER_POOL = {
    "1": {"full_name": "Jahmyr Gibbs", "position": "RB", "team": "DET"},
    "2": {"full_name": "Tyreek Hill", "position": "WR", "team": "MIA"},
}

_FFC_ROW_GIBBS = {
    "player_id": 5671, "name": "Jahmyr Gibbs", "position": "RB", "team": "DET",
    "adp": 2.0, "adp_formatted": "1.02", "times_drafted": 1474,
    "high": 1, "low": 4, "stdev": 0.7, "bye": 6,
}
_FFC_ROW_HILL = {
    "player_id": 5177, "name": "Tyreek Hill", "position": "WR", "team": "MIA",
    "adp": 8.0, "adp_formatted": "1.08", "times_drafted": 1000,
    "high": 3, "low": 15, "stdev": 2.1, "bye": 7,
}


def _ffc_payload(*rows):
    return {"status": "Success", "meta": {"type": "PPR", "teams": 12, "rounds": 15,
                                         "total_drafts": 8470,
                                         "start_date": "2025-08-25", "end_date": "2025-09-01"},
            "players": list(rows)}


class _StubProjectionProvider:
    def __init__(self, sleeper_players):
        self.sleeper_players = sleeper_players

    def load(self, season, top_adp_ids=None):
        return SimpleNamespace(
            projections=[SeasonProjection(playerId="1", source="fftoday", stats={"rush_yd": 100.0})],
            source_url="https://www.fftoday.com/rankings/playerproj.php",
            fetched_at="2026-08-21T00:00:00Z",
            upstream_updated_at="8/31/2025",
            position_rows={"QB": 1, "RB": 1, "WR": 1, "TE": 1, "K": 1, "DEF": 1},
            diagnostics={
                "sourceUrls": ["https://www.fftoday.com/rankings/playerproj.php?PosID=10&Season=2025"],
                "unmatched": [],
                "matchedRows": 1,
                "schemaVersion": 1,
            },
            bye_weeks={"1": 7},
        )


# ---------------------------------------------------------------------------
# FFToday leakage date gate
# ---------------------------------------------------------------------------


def test_parse_fftoday_updated_parses_and_rejects_garbage():
    assert bs.parse_fftoday_updated("8/31/2025") == date(2025, 8, 31)
    assert bs.parse_fftoday_updated("9/4/2025") == date(2025, 9, 4)
    assert bs.parse_fftoday_updated("13/40/2025") is None  # invalid month/day
    assert bs.parse_fftoday_updated("2025-08-31") is None  # wrong format
    assert bs.parse_fftoday_updated("") is None


def test_fftoday_leakage_verdict_accepts_preseason_only():
    first_game = date(2025, 9, 4)
    ok = bs.fftoday_leakage_verdict("8/31/2025", first_game)
    assert ok["ok"] is True and ok["parsedDate"] == "2025-08-31"

    in_season = bs.fftoday_leakage_verdict("9/15/2025", first_game)
    assert in_season["ok"] is False
    assert "refreshed in-season" in in_season["reason"]

    # Fail closed on an unparseable stamp rather than letting a contaminated
    # page through.
    garbage = bs.fftoday_leakage_verdict("soon", first_game)
    assert garbage["ok"] is False
    assert "unparseable" in garbage["reason"]


# ---------------------------------------------------------------------------
# Identity resolution + gates
# ---------------------------------------------------------------------------


def test_resolve_ffc_rows_adds_sleeper_id_and_lists_unmatched():
    index = match.build_sleeper_match_index(_SLEEPER_POOL)
    rows, unmatched = bs.resolve_ffc_rows([_FFC_ROW_GIBBS, _FFC_ROW_HILL], index)
    assert [r["sleeperId"] for r in rows] == ["1", "2"]
    assert unmatched == []
    # Verbatim FFC fields survive next to the resolved id.
    assert rows[0]["player_id"] == 5671 and rows[0]["adp"] == 2.0


def test_identity_gate_fails_below_threshold_and_never_drops_silently():
    index = match.build_sleeper_match_index(_SLEEPER_POOL)
    unknown = {
        "player_id": 999, "name": "Nobody Knows", "position": "QB", "team": None,
        "adp": 200.0,
    }
    rows, unmatched = bs.resolve_ffc_rows([_FFC_ROW_GIBBS, unknown], index)
    result = bs.identity_gate_result(rows, unmatched, bs.IDENTITY_GATE_THRESHOLD)
    assert result["ok"] is False
    assert result["rate"] == 0.5
    assert result["unmatched"] == ["Nobody Knows (QB)"]


def test_outcome_coverage_is_diagnostic_not_a_failure():
    coverage = bs.outcome_coverage_result(["1", "2"], {"1": {"p": "RB", "bye": 6, "w": []}})
    assert coverage["withOutcomes"] == 1
    assert coverage["withoutOutcomes"] == 1
    assert coverage["withoutOutcomesPlayers"] == ["2"]


# ---------------------------------------------------------------------------
# main() gate ordering and fail-closed behavior (monkeypatched network)
# ---------------------------------------------------------------------------


def _patch_network(monkeypatch, ffc_payload, tmp_path):
    monkeypatch.setattr(bs.sources, "fetch_sleeper_players", lambda: dict(_SLEEPER_POOL))
    monkeypatch.setattr(bs.sources, "fetch_dynastyprocess_crosswalk", lambda: [])
    monkeypatch.setattr(bs.sources, "fetch_ffc_adp_payload",
                        lambda *a, **k: _ffc_payload() if ffc_payload is None else ffc_payload)
    monkeypatch.setattr(bs, "FFTodayProjectionProvider", _StubProjectionProvider)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "weekly-stats.json").write_text(
        json.dumps({"schemaVersion": 1, "season": 2025, "weeksFetched": [1],
                    "players": {"1": {"p": "RB", "bye": 6, "w": [[1, 20.0]]}}}),
        encoding="utf-8",
    )
    (data_dir / "players.json").write_text("[]", encoding="utf-8")
    return data_dir


def test_main_writes_snapshot_when_gates_pass(monkeypatch, tmp_path):
    data_dir = _patch_network(monkeypatch, _ffc_payload(_FFC_ROW_GIBBS, _FFC_ROW_HILL), tmp_path)
    out_dir = tmp_path / "snap"
    code = bs.main(["--season", "2025", "--out-dir", str(out_dir), "--data-dir", str(data_dir)])
    assert code == 0

    adp = json.loads((out_dir / "adp-ppr.json").read_text(encoding="utf-8"))
    assert adp["meta"]["total_drafts"] == 8470  # verbatim FFC meta
    assert [p["sleeperId"] for p in adp["players"]] == ["1", "2"]  # resolved ids persisted

    projections = json.loads((out_dir / "projections.json").read_text(encoding="utf-8"))
    assert projections["source"] == "fftoday"
    assert projections["upstreamUpdatedAt"] == "8/31/2025"
    assert projections["byeWeeks"] == {"1": 7}
    assert projections["projections"][0]["playerId"] == "1"

    provenance = json.loads((out_dir / "provenance.json").read_text(encoding="utf-8"))
    assert provenance["gates"]["snapshotState"] == "ok"
    assert provenance["gates"]["identity"]["rate"] == 1.0
    assert provenance["gates"]["fftodayLeakage"]["ok"] is True
    assert provenance["gates"]["outcomeCoverage"]["withoutOutcomesPlayers"] == ["2"]
    assert provenance["inputs"]["weeklyStats"]["sha256"]  # outcome set pinned
    assert provenance["inputs"]["playersJson"]["sha256"]


def test_main_step0_gate_fails_closed_on_empty_ffc(monkeypatch, tmp_path):
    data_dir = _patch_network(monkeypatch, {"players": []}, tmp_path)
    out_dir = tmp_path / "snap"
    code = bs.main(["--season", "2025", "--out-dir", str(out_dir), "--data-dir", str(data_dir)])
    assert code == 1
    provenance = json.loads((out_dir / "provenance.json").read_text(encoding="utf-8"))
    assert provenance["gates"]["snapshotState"] == "failed-ffc-step0"
    assert not (out_dir / "adp-ppr.json").exists()


def test_main_identity_gate_fails_closed_and_records_misses(monkeypatch, tmp_path):
    unknown = {
        "player_id": 999, "name": "Nobody Knows", "position": "QB", "team": None, "adp": 200.0,
    }
    data_dir = _patch_network(monkeypatch, _ffc_payload(unknown), tmp_path)
    out_dir = tmp_path / "snap"
    code = bs.main(["--season", "2025", "--out-dir", str(out_dir), "--data-dir", str(data_dir)])
    assert code == 2
    provenance = json.loads((out_dir / "provenance.json").read_text(encoding="utf-8"))
    assert provenance["gates"]["snapshotState"] == "failed-identity-gate"
    assert provenance["gates"]["identity"]["unmatched"] == ["Nobody Knows (QB)"]
    assert not (out_dir / "adp-ppr.json").exists()
    assert not (out_dir / "projections.json").exists()


def test_main_rejects_unregistered_season_without_cutoff(tmp_path):
    # No network is touched: the cutoff check runs first.
    code = bs.main(["--season", "1999", "--out-dir", str(tmp_path / "snap")])
    assert code == 4

