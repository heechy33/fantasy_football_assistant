"""Tests for build_data's own helpers (not already covered by test_history.py's
select_active_adp coverage or test_underdog_adp.py's board-builder coverage)."""

from __future__ import annotations

import json

import build_data


def test_load_status_overrides_missing_file_returns_empty(tmp_path):
    assert build_data._load_status_overrides(tmp_path / "does-not-exist.json") == []


def test_load_status_overrides_reads_committed_shape(tmp_path):
    path = tmp_path / "overrides.json"
    path.write_text(
        json.dumps([{"playerId": "5850", "status": "Exempt", "availability": 0}]),
        encoding="utf-8",
    )
    rows = build_data._load_status_overrides(path)
    assert rows == [{"playerId": "5850", "status": "Exempt", "availability": 0}]


def test_load_status_overrides_fails_open_on_malformed_json(tmp_path):
    path = tmp_path / "overrides.json"
    path.write_text("{not valid json", encoding="utf-8")
    assert build_data._load_status_overrides(path) == []


def test_load_status_overrides_fails_open_when_not_a_list(tmp_path):
    path = tmp_path / "overrides.json"
    path.write_text(json.dumps({"playerId": "5850"}), encoding="utf-8")
    assert build_data._load_status_overrides(path) == []
