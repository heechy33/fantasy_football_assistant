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
    "nflverse_schedules": "https://github.com/nflverse/nflverse-data/releases/tag/schedules",
}

# Names loaders() and optional_loaders() may return. Used to give every optional
# source an error manifest entry even when optional_loaders() itself fails to
# import (see build_data._build_context_artifact) — a bare `except: only mark
# pbp` would silently leave later-added optional sources (e.g. schedules) with
# no manifest entry at all on that failure path.
OPTIONAL_SOURCE_NAMES = ("nflverse_pbp", "nflverse_schedules")


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
        # Schedules only need the single usage season (opponent/bye lookups for
        # the weekly game log), not the full multi-season `history_seasons` list
        # every other loader here receives — pin it explicitly rather than
        # loading (and discarding) two extra seasons.
        "nflverse_schedules": lambda seasons: nfl.load_schedules([max(seasons)]),
    }


def to_rows(frame: Any) -> list[dict[str, Any]]:
    if not hasattr(frame, "to_dicts"):
        raise TypeError("nflreadpy loader did not return a Polars DataFrame")
    return frame.to_dicts()


def load_player_table() -> list[dict[str, Any]]:
    """Static nflverse players table (draft year/round/pick). Independent of season list."""
    import nflreadpy as nfl

    return to_rows(nfl.load_players())
