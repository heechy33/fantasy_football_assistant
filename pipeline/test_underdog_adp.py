"""Coverage for pipeline/underdog_adp.py — the Underdog best-ball ADP adapter.

Fixture-driven (no HTTP): parsing reads the community payload's flat rows
(first_name/last_name/adp), schema drift fails closed like espn_adp.py,
per-row junk is skipped rather than fatal, crosswalk matching accounts for
matched/unmatched exactly, and the freshness stamp never fabricates a date.
The build_data fail-open wrapper (fetch error / drift / min-rows gate) is
covered directly so the byte-identical-prior-artifact contract can't regress.
"""

from __future__ import annotations

import pytest

import transform
from build_data import (
    UNDERDOG_ADP_MIN_ROWS,
    _build_underdog_adp_board,
)
from match import normalize_name
from underdog_adp import (
    ParsedUnderdogRow,
    build_underdog_adp_entries,
    extract_upstream_updated_at,
    parse_underdog_adp_rows,
)

# Empty-band fit returns the default FFC CV curve.
_DEFAULT_CV_BANDS = transform.fit_adp_cv_bands([])


def _row(player_id, first, last, position, team, adp):
    row = {
        "id": player_id,
        "first_name": first,
        "last_name": last,
        "position": position,
        "adp": adp,
    }
    if team is not None:
        row["team"] = team
    return row


def _payload(*rows, **extra):
    payload = {"players": list(rows)}
    payload.update(extra)
    return payload


def _index(*pairs):
    return dict(pairs)


def test_parse_reads_flat_rows_into_sleeper_vocab():
    payload = _payload(
        _row(8151, "Kenneth", "Walker", "RB", "SEA", 12.5),
        _row(4034, "Christian", "McCaffrey", "RB", None, 6.9),
    )
    assert parse_underdog_adp_rows(payload) == [
        ParsedUnderdogRow(name="Kenneth Walker", team="SEA", position="RB", underdog_id="8151", adp=12.5),
        ParsedUnderdogRow(name="Christian McCaffrey", team=None, position="RB", underdog_id="4034", adp=6.9),
    ]


def test_parse_skips_unusable_rows_without_raising():
    payload = _payload(
        _row(1, "Zero", "Adp", "QB", "BUF", 0.0),
        _row(2, "Negative", "Adp", "QB", "BUF", -3.0),
        _row(3, "Missing", "Adp", "QB", "BUF", None),
        {"id": 4, "first_name": "", "last_name": "", "position": "QB", "adp": 10.0},  # no name
        _row(5, "Kicker", "Only", "K", "KC", 100.0),     # best-ball drafts no kickers
        _row(6, "Team", "Defense", "DEF", "BAL", 90.0),  # ...or defenses
        # bool is an int subtype — must not parse as adp=True
        {**_row(7, "Bool", "Adp", "QB", "BUF", True)},
    )
    assert parse_underdog_adp_rows(payload) == []


def test_parse_rejects_schema_drift():
    with pytest.raises(ValueError, match="no players array"):
        parse_underdog_adp_rows({"drafted_players": "nope"})
    with pytest.raises(ValueError, match="player row is not an object"):
        parse_underdog_adp_rows({"players": ["flat string"]})


def test_extract_upstream_updated_at_is_shallow_and_typed():
    assert extract_upstream_updated_at(_payload(updated_at="2026-08-20T05:00:00Z")) == "2026-08-20T05:00:00Z"
    assert extract_upstream_updated_at(_payload(last_updated=" 2026-08-20 ")) == "2026-08-20"
    # Absent / wrong-typed stamps stay unknown — no epoch laundering.
    assert extract_upstream_updated_at(_payload()) is None
    assert extract_upstream_updated_at(_payload(updated_at=1755657600)) is None
    assert extract_upstream_updated_at(_payload(updated_at={"iso": "x"})) is None


def test_build_entries_matches_via_crosswalk_and_accounts_exactly():
    rows = [
        ParsedUnderdogRow(name="James Cook III", team="BUF", position="RB", underdog_id="1", adp=12.0),
        ParsedUnderdogRow(name="Rashee Rice", team=None, position="WR", underdog_id="2", adp=22.0),
        ParsedUnderdogRow(name="Ghost Player", team="FA", position="TE", underdog_id="3", adp=200.0),
    ]
    entries, diag = build_underdog_adp_entries(
        rows,
        sleeper_index=_index((("james cook", "RB"), "8138"), (("rashee rice", "WR"), "10229")),
        valid_player_ids={"8138"},
        cv_bands=_DEFAULT_CV_BANDS,
    )
    # Name suffix folding matches Cook; Rice matches but is filtered by
    # valid_player_ids (untracked); Ghost Player misses entirely. Both count
    # as unmatched in diagnostics — surfaced, never silently dropped.
    assert [entry.playerId for entry in entries] == ["8138"]
    cook = entries[0]
    assert cook.name == "James Cook III"
    assert cook.adp == 12.0
    assert cook.stdev == transform.fitted_stdev(12.0, _DEFAULT_CV_BANDS)
    assert cook.adpSource == "underdog"
    assert cook.stdevSource == "fitted"
    assert cook.high is None and cook.low is None and cook.timesDrafted is None
    assert diag["rawRows"] == 3
    assert diag["matchedRows"] == 1
    assert diag["unmatchedCount"] == 2
    assert diag["unmatched"] == ["Rashee Rice (WR)", "Ghost Player (TE)"]
    # Board is ascending by adp even when input isn't.
    shuffled = list(reversed(rows))
    entries2, _ = build_underdog_adp_entries(
        shuffled,
        sleeper_index=_index(
            (("james cook", "RB"), "a"), (("rashee rice", "WR"), "b"), (("ghost player", "TE"), "c")
        ),
        valid_player_ids={"a", "b", "c"},
    )
    assert [entry.adp for entry in entries2] == sorted(entry.adp for entry in entries2)


def _board_payload(row_count):
    """A synthetic payload + matching sleeper index of `row_count` RB rows."""
    rows = [_row(i, f"Player{i}", "Name", "RB", "BUF", float(i + 1)) for i in range(row_count)]
    index = {(normalize_name(f"Player{i} Name"), "RB"): str(i) for i in range(row_count)}
    return _payload(*rows), index


def test_build_board_ok_path_carries_provenance_fields():
    payload, index = _board_payload(UNDERDOG_ADP_MIN_ROWS)
    payload["updated_at"] = "2026-08-21T04:00:00Z"
    entries, diag = _build_underdog_adp_board(
        payload,
        None,
        sleeper_index=index,
        valid_player_ids=set(index.values()),
        cv_bands=_DEFAULT_CV_BANDS,
    )
    assert entries is not None
    assert len(entries) == UNDERDOG_ADP_MIN_ROWS
    assert diag["upstreamUpdatedAt"] == "2026-08-21T04:00:00Z"
    assert diag["matchedRows"] == UNDERDOG_ADP_MIN_ROWS
    assert diag["rawRows"] == UNDERDOG_ADP_MIN_ROWS


def test_build_board_fails_open_on_fetch_error():
    entries, diag = _build_underdog_adp_board(
        None, "HTTPError: 403 [url]", sleeper_index={}, valid_player_ids=set(), cv_bands=_DEFAULT_CV_BANDS
    )
    assert entries is None
    assert diag["diagnostic"] == "HTTPError: 403 [url]"
    assert diag["upstreamUpdatedAt"] is None
    assert diag["matchedRows"] == 0


def test_build_board_fails_open_on_schema_drift():
    entries, diag = _build_underdog_adp_board(
        {"oops": []}, None, sleeper_index={}, valid_player_ids=set(), cv_bands=_DEFAULT_CV_BANDS
    )
    assert entries is None
    assert "ValueError: Underdog payload has no players array" in diag["diagnostic"]
    assert diag["upstreamUpdatedAt"] is None


def test_build_board_fails_open_below_min_rows_gate():
    payload, index = _board_payload(UNDERDOG_ADP_MIN_ROWS - 1)
    entries, diag = _build_underdog_adp_board(
        payload,
        None,
        sleeper_index=index,
        valid_player_ids=set(index.values()),
        cv_bands=_DEFAULT_CV_BANDS,
    )
    assert entries is None
    assert diag["diagnostic"] == (
        f"matchedRows {UNDERDOG_ADP_MIN_ROWS - 1} < UNDERDOG_ADP_MIN_ROWS {UNDERDOG_ADP_MIN_ROWS}"
    )
