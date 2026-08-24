import json

import pytest

from datetime import date
from pathlib import Path

import retrieve_vintage as rv


# ---------------------------------------------------------------------------
# Tag naming / parsing round trip
# ---------------------------------------------------------------------------

def test_snapshot_tag_name_formats_iso_date():
    assert rv.snapshot_tag_name(date(2026, 9, 7)) == "data-snapshots/2026-09-07"


def test_parse_snapshot_tag_round_trips_and_rejects_foreign_tags():
    tag = rv.snapshot_tag_name(date(2026, 8, 24))
    assert rv.parse_snapshot_tag(tag) == date(2026, 8, 24)
    # Not a vintage tag / malformed dates -> None, never an exception.
    assert rv.parse_snapshot_tag("v1.2.3") is None
    assert rv.parse_snapshot_tag("data-snapshots/") is None
    assert rv.parse_snapshot_tag("data-snapshots/2026-13-99") is None
    assert rv.parse_snapshot_tag("data-snapshots/not-a-date") is None


# ---------------------------------------------------------------------------
# Manifest summarization (fixture-shaped)
# ---------------------------------------------------------------------------

def test_summarize_manifest_counts_statuses_and_rows():
    manifest = {
        "builtAt": "2026-08-22T09:23:24Z",
        "season": "2026",
        "week": None,
        "sources": {
            "ffc_adp_ppr": {"rows": 266, "status": "ok", "fetchedAt": "t1"},
            "fftoday_projections": {"rows": 414, "status": "ok", "fetchedAt": "t2"},
            "sleeper_players": {"rows": None, "status": "degraded", "fetchedAt": "t3"},
        },
    }
    summary = rv.summarize_manifest(manifest)
    assert summary["builtAt"] == "2026-08-22T09:23:24Z"
    assert summary["season"] == "2026"
    assert summary["sourceCount"] == 3
    assert summary["sourceStatuses"] == {"ok": 2, "degraded": 1}
    # Non-int rows contribute nothing instead of crashing the sum.
    assert summary["totalSourceRows"] == 680
    assert summary["sources"]["sleeper_players"]["rows"] is None


def test_summarize_manifest_handles_empty_and_null_sources():
    empty = rv.summarize_manifest({"builtAt": "x"})
    assert empty["sourceCount"] == 0
    assert empty["totalSourceRows"] == 0
    null_sources = rv.summarize_manifest({"sources": None})
    assert null_sources["sourceCount"] == 0


# ---------------------------------------------------------------------------
# Real committed data (repo testing convention: no mocks)
# ---------------------------------------------------------------------------

MANIFEST_PATH = Path(__file__).resolve().parent.parent / "data" / "manifest.json"


@pytest.mark.skipif(not MANIFEST_PATH.exists(), reason="data/manifest.json not committed")
def test_summarize_manifest_on_real_committed_artifact():
    summary = rv.summarize_manifest(json.loads(MANIFEST_PATH.read_text("utf-8")))
    # The real artifact has many sources; every one must be accounted for.
    assert summary["sourceCount"] >= 5
    assert sum(summary["sourceStatuses"].values()) == summary["sourceCount"]
    assert summary["totalSourceRows"] > 0
