"""Thin nflreadpy loader boundary for historical context data."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

SOURCE_URLS = {
    "nflverse_player_stats": "https://github.com/nflverse/nflverse-data/releases/tag/player_stats",
    "nflverse_snap_counts": "https://github.com/nflverse/nflverse-data/releases/tag/snap_counts",
    "nflverse_weekly_rosters": "https://github.com/nflverse/nflverse-data/releases/tag/weekly_rosters",
    "nflverse_injuries": "https://github.com/nflverse/nflverse-data/releases/tag/injuries",
    "nflverse_pbp": "https://github.com/nflverse/nflverse-data/releases/tag/pbp",
}


def loaders() -> dict[str, Callable[[list[int]], Any]]:
    """Import lazily so an unavailable context dependency cannot block core refresh."""
    import nflreadpy as nfl

    return {
        "nflverse_player_stats": lambda seasons: nfl.load_player_stats(seasons, summary_level="week"),
        "nflverse_snap_counts": nfl.load_snap_counts,
        "nflverse_weekly_rosters": nfl.load_rosters_weekly,
        "nflverse_injuries": nfl.load_injuries,
    }


def optional_loaders() -> dict[str, Callable[[list[int]], Any]]:
    """Optional, larger context sources. Their failure does not clear core context."""
    import nflreadpy as nfl

    return {
        "nflverse_pbp": nfl.load_pbp,
    }


def to_rows(frame: Any) -> list[dict[str, Any]]:
    if not hasattr(frame, "to_dicts"):
        raise TypeError("nflreadpy loader did not return a Polars DataFrame")
    return frame.to_dicts()
