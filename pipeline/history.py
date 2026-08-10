"""
Append-only ADP history capture: one JSONL row per player per pipeline run,
per format, capturing both the Sleeper board and the retained FFC board so the
two populations stay comparable over time.

Capture only. Nothing reads this yet — no derived trend artifact, no UI. It
exists ahead of PLAN.md's Edge Validation Gate, which needs dated ADP for
availability calibration (Brier scoring) and out-of-sample backtesting, and
because preseason ADP only exists in August and can't be back-filled later.

Written to data/history/adp-<fmt>.jsonl, which frontend/scripts/stage-data.mjs
never stages into the deployed frontend/public/data/ (it filters `readdirSync`
non-recursively on `.endsWith('.json')`, so this subdirectory and its `.jsonl`
files are excluded automatically) — no change needed there, but
scripts/verify-artifact.mjs asserts the exclusion explicitly.

Each row carries the metadata that makes a delta interpretable. FFC's own
sampling window is a short trailing one whose *length* varies release to
release (2026: 2026-08-02 to 2026-08-09, 8 days; other seasons have been as
short as 2-3 days) — a bare adp delta between two days would otherwise be
uninterpretable, since a window-length change can shift ADP with no real
market move at all. Sleeper's lobby has no such window (it's a continuously
live signal, not a dated batch sample), so its rows carry `window: null` and
instead record `upstreamUpdatedAt` from the payload's epoch-ms freshness
stamps when available.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from transform import AdpEntry


def sleeper_upstream_updated_at(rows: list[dict[str, Any]]) -> str | None:
    """Max `updated_at` / `last_modified` across Sleeper projection rows, as ISO-UTC.

    Sleeper stamps these as epoch milliseconds. Returns None when no usable
    stamp is present (schema change / empty payload) rather than inventing a
    freshness claim.
    """
    stamps: list[int] = []
    for row in rows:
        for key in ("updated_at", "last_modified"):
            value = row.get(key)
            if isinstance(value, (int, float)) and value > 0:
                stamps.append(int(value))
    if not stamps:
        return None
    return datetime.fromtimestamp(max(stamps) / 1000.0, tz=timezone.utc).isoformat()


def _entry_row(
    entry: AdpEntry,
    captured_at: str,
    source: str,
    window: dict[str, Any] | None,
    upstream_updated_at: str | None,
) -> dict[str, Any]:
    return {
        "capturedAt": captured_at,
        "source": source,  # 'sleeper' | 'ffc'
        "upstreamUpdatedAt": upstream_updated_at,
        "playerId": entry.playerId,
        "name": entry.name,
        "position": entry.position,
        "adp": entry.adp,
        "stdev": entry.stdev,
        "stdevSource": entry.stdevSource,
        "window": window,
    }


def append_snapshot(
    out_dir: Path,
    fmt: str,
    captured_at: str,
    sleeper_entries: list[AdpEntry] | None,
    ffc_entries: list[AdpEntry] | None,
    ffc_window: dict[str, Any] | None,
    sleeper_upstream_updated_at: str | None = None,
) -> int:
    """Appends one line per player per source to data/history/adp-<fmt>.jsonl.
    Returns bytes appended (0 if there was nothing to write). Creates
    data/history/ if it doesn't exist yet.

    FFC's upstream freshness is the window end date when present (the trailing
    sample's right edge); Sleeper's is the max payload stamp passed in.
    """
    history_dir = out_dir / "history"
    history_dir.mkdir(parents=True, exist_ok=True)
    path = history_dir / f"adp-{fmt}.jsonl"

    ffc_upstream = None
    if ffc_window:
        end = ffc_window.get("endDate")
        if isinstance(end, str) and end.strip():
            ffc_upstream = end.strip()

    lines: list[str] = []
    for entries, source, window, upstream in (
        (sleeper_entries or [], "sleeper", None, sleeper_upstream_updated_at),
        (ffc_entries or [], "ffc", ffc_window, ffc_upstream),
    ):
        for entry in entries:
            lines.append(
                json.dumps(
                    _entry_row(entry, captured_at, source, window, upstream),
                    separators=(",", ":"),
                )
            )

    if not lines:
        return 0
    payload = "\n".join(lines) + "\n"
    with path.open("a", encoding="utf-8") as f:
        f.write(payload)
    return len(payload.encode("utf-8"))
