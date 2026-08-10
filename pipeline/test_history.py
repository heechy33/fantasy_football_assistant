"""Tests for ADP history capture and the Sleeper→FFC active-board selector."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import build_data
import history
from transform import AdpEntry, SeasonProjection


def _entry(player_id: str, adp: float, *, source: str = "sleeper") -> AdpEntry:
    return AdpEntry(
        playerId=player_id,
        name=player_id,
        position="RB",
        team="BUF",
        adp=adp,
        stdev=1.0,
        high=None if source == "sleeper" else 1,
        low=None if source == "sleeper" else 10,
        timesDrafted=None if source == "sleeper" else 100,
        byeWeek=None if source == "sleeper" else 7,
        adpSource=source,
        stdevSource="fitted" if source == "sleeper" else "observed",
    )


def test_select_active_adp_prefers_sleeper_when_healthy():
    sleeper = [_entry(str(i), float(i)) for i in range(build_data.SLEEPER_ADP_MIN_ROWS)]
    ffc = [_entry("ffc", 1.0, source="ffc")]
    chosen, active = build_data.select_active_adp(sleeper, ffc, sleeper_error=None)
    assert active == "sleeper"
    assert chosen is sleeper


def test_select_active_adp_falls_back_when_sleeper_is_sparse():
    sleeper = [_entry(str(i), float(i)) for i in range(build_data.SLEEPER_ADP_MIN_ROWS - 1)]
    ffc = [_entry("ffc", 1.0, source="ffc")]
    chosen, active = build_data.select_active_adp(sleeper, ffc, sleeper_error=None)
    assert active == "ffc-fallback"
    assert chosen is ffc


def test_select_active_adp_falls_back_on_fetch_error_even_with_rows():
    sleeper = [_entry(str(i), float(i)) for i in range(build_data.SLEEPER_ADP_MIN_ROWS)]
    ffc = [_entry("ffc", 1.0, source="ffc")]
    chosen, active = build_data.select_active_adp(
        sleeper, ffc, sleeper_error="RequestException: boom",
    )
    assert active == "ffc-fallback"
    assert chosen is ffc


def test_sleeper_upstream_updated_at_uses_max_epoch_ms():
    rows = [
        {"updated_at": 1_700_000_000_000, "last_modified": 1_600_000_000_000},
        {"updated_at": 1_710_000_000_000},
    ]
    stamp = history.sleeper_upstream_updated_at(rows)
    assert stamp == datetime.fromtimestamp(1_710_000_000_000 / 1000.0, tz=timezone.utc).isoformat()


def test_sleeper_upstream_updated_at_none_when_missing():
    assert history.sleeper_upstream_updated_at([{"player_id": "1"}]) is None
    assert history.sleeper_upstream_updated_at([]) is None


def test_append_snapshot_writes_both_sources_with_upstream_and_window(tmp_path):
    sleeper = [_entry("9221", 1.6)]
    ffc = [_entry("9221", 1.5, source="ffc")]
    window = {"startDate": "2026-08-02", "endDate": "2026-08-09", "totalDrafts": 5417}
    nbytes = history.append_snapshot(
        tmp_path,
        "ppr",
        "2026-08-09T12:00:00+00:00",
        sleeper_entries=sleeper,
        ffc_entries=ffc,
        ffc_window=window,
        sleeper_upstream_updated_at="2026-08-09T11:00:00+00:00",
    )
    assert nbytes > 0
    path = tmp_path / "history" / "adp-ppr.jsonl"
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 2
    by_source = {row["source"]: row for row in rows}
    assert by_source["sleeper"]["upstreamUpdatedAt"] == "2026-08-09T11:00:00+00:00"
    assert by_source["sleeper"]["window"] is None
    assert by_source["sleeper"]["adp"] == 1.6
    assert by_source["ffc"]["upstreamUpdatedAt"] == "2026-08-09"
    assert by_source["ffc"]["window"] == window
    assert by_source["ffc"]["stdevSource"] == "observed"


def test_append_snapshot_is_append_only_and_writes_nothing_when_empty(tmp_path):
    assert history.append_snapshot(
        tmp_path, "ppr", "t0", sleeper_entries=None, ffc_entries=None, ffc_window=None,
    ) == 0
    assert not (tmp_path / "history" / "adp-ppr.jsonl").exists()

    history.append_snapshot(
        tmp_path, "ppr", "t1",
        sleeper_entries=[_entry("1", 1.0)],
        ffc_entries=None,
        ffc_window=None,
        sleeper_upstream_updated_at=None,
    )
    history.append_snapshot(
        tmp_path, "ppr", "t2",
        sleeper_entries=[_entry("1", 1.1)],
        ffc_entries=None,
        ffc_window=None,
        sleeper_upstream_updated_at=None,
    )
    lines = (tmp_path / "history" / "adp-ppr.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["capturedAt"] == "t1"
    assert json.loads(lines[1])["capturedAt"] == "t2"
    assert json.loads(lines[0])["upstreamUpdatedAt"] is None

def test_active_projection_diagnostics_uses_the_committed_board():
    entries = [_entry("projected", 1.0), _entry("missing", 2.0)]
    projections = [SeasonProjection("projected", "fftoday", {"rush_yd": 1})]
    diagnostics = build_data.active_projection_diagnostics(entries, projections)
    assert diagnostics == {
        "top300MatchRate": 0.5,
        "unmatchedTop300": ["missing"],
        "sampleSize": 2,
    }
