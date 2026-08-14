"""Pure artifact assembly + merge/staleness for the multi-provider projections
artifact (`data/projections-providers.json`). No HTTP, no environment reads, no
filesystem reads or writes — build_data.py owns fetching (reusing the Sleeper
projection rows it already fetched for ADP) and reading/writing the previous
artifact, then hands plain data to this module.

Display-only, same contract as the stars/ADP decorations: the per-provider stat
maps must never be adapted into `SeasonProjection[]` or reach
buildRecommendationBoard / availability / simulation / ranking
comparators. The artifact is an object keyed by playerId with no row-level
source field, so a value of this shape structurally cannot type-check as
`SeasonProjection[]` — that is the enforcement, stronger than a comment.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import transform

PROVIDER_PROJECTIONS_SCHEMA_VERSION = 1

# Past which a carried-forward provider block's rows are dropped outright
# instead of being served as stale. Matches the CLAUDE.md "never switch sources
# silently" rule: a shrunken artifact must never look like a real data drop.
STALE_AFTER_DAYS = 14

# Stat keys Sleeper embeds in projection rows that aren't real box-score
# components but also aren't stripped by transform._clean_stats (which only drops
# `adp*` / `pos_adp*` prefixes). Dropped provider-module-locally rather than
# widening transform.py's shared prefixes, so the canonical FFToday path is
# untouched and the canonical projections stay FFToday's.
SLEEPER_STAT_DROP_KEYS = frozenset({"gp", "pts_ppr", "pts_half_ppr", "pts_std", "pts_2qb"})


@dataclass(frozen=True)
class ProviderResult:
    """One provider's outcome before merge/staleness is applied. `block` carries
    status/rows/diagnostic; `stats_by_player` maps playerId -> Sleeper-vocab stat
    map and is empty when the provider failed."""

    key: str
    label: str
    block: dict[str, Any]
    stats_by_player: dict[str, dict[str, float]]


def _drop_sleeper_non_stat_keys(stats: dict[str, Any]) -> dict[str, float]:
    return {k: v for k, v in stats.items() if k not in SLEEPER_STAT_DROP_KEYS}


def _days_between(start_iso: str, end_iso: str) -> float:
    """Whole-or-fractional days from `start_iso` to `end_iso`. An unparseable
    date is treated as stale (> STALE_AFTER_DAYS) rather than accidentally
    fresh, so a corrupted previous artifact can never pin a provider open."""
    try:
        start = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        end = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
    except (TypeError, ValueError, OverflowError):
        return STALE_AFTER_DAYS + 1
    return max(0.0, (end - start).total_seconds() / 86400)


def sleeper_provider_result(
    raw_rows: list[dict[str, Any]],
    valid_player_ids: set[str],
    *,
    fetched_at: str,
) -> ProviderResult:
    """Build the Sleeper provider block + per-player stat map from the projection
    rows already fetched for ADP (zero new HTTP). `build_season_projections` sets
    SeasonProjection.source to the company field — "rotowire" for Sleeper — which
    is deliberately not changed: the provider stays keyed `sleeper` and the label
    carries the attribution instead."""
    filtered = [
        {**row, "stats": _drop_sleeper_non_stat_keys(row.get("stats") or {})}
        for row in raw_rows
    ]
    projections = transform.build_season_projections(filtered, valid_player_ids)
    # Provider artifacts need one extra finite-value guard beyond the shared
    # canonical transform: malformed NaN/Infinity must not poison browser JSON.
    stats_by_player = {
        projection.playerId: {
            key: value
            for key, value in projection.stats.items()
            if math.isfinite(value)
        }
        for projection in projections
    }
    stats_by_player = {
        player_id: stats
        for player_id, stats in stats_by_player.items()
        if stats
    }

    # build_season_projections returns no position, so count positionRows from the
    # raw rows' player.position for the provider summary.
    position_by_id: dict[str, str | None] = {}
    for row in filtered:
        player = row.get("player") or {}
        pid = str(player.get("player_id") or row.get("player_id"))
        if pid and pid in valid_player_ids:
            position_by_id.setdefault(pid, player.get("position"))
    position_rows: dict[str, int] = {}
    for pid, stats in stats_by_player.items():
        position = position_by_id.get(pid)
        if position in transform.FANTASY_POSITIONS:
            position_rows[position] = position_rows.get(position, 0) + 1

    block: dict[str, Any] = {
        "key": "sleeper",
        "label": "Sleeper (Rotowire)",
        "attribution": "Projections via Sleeper's projections endpoint (company: rotowire).",
        "status": "ok",
        "fetchedAt": fetched_at,
        "upstreamUpdatedAt": None,
        "rows": len(stats_by_player),
        "positionRows": position_rows,
        "positionsExcluded": [],
        "staleSinceDays": 0,
        "diagnostic": None,
    }
    return ProviderResult(key="sleeper", label="Sleeper (Rotowire)", block=block, stats_by_player=stats_by_player)


def error_provider_result(
    key: str,
    label: str,
    *,
    diagnostic: str,
) -> ProviderResult:
    """A provider that threw: no rows this run. Merge/staleness decides whether
    the previous block is carried forward, so the failure itself only records the
    diagnostic here."""
    block: dict[str, Any] = {
        "key": key,
        "label": label,
        "status": "error",
        "fetchedAt": None,
        "upstreamUpdatedAt": None,
        "rows": 0,
        "positionRows": {},
        "positionsExcluded": [],
        "staleSinceDays": None,
        "diagnostic": diagnostic,
    }
    return ProviderResult(key=key, label=label, block=block, stats_by_player={})


def merge_and_assemble(
    previous: dict[str, Any] | None,
    results: list[ProviderResult],
    *,
    season: int,
    generated_at: str,
    now_iso: str,
) -> dict[str, Any]:
    """Apply the per-provider failure policy against the previous artifact and
    assemble the new one. A failed provider either carries its previous rows
    forward as `status: 'stale'` (with the original fetchedAt and the new
    diagnostic) while `staleSinceDays <= STALE_AFTER_DAYS`, or drops them and
    flips to `status: 'error'` once hard-expired. Succeeded providers replace
    their block and stats wholesale."""
    previous_blocks = {block["key"]: block for block in (previous or {}).get("providers", [])}
    previous_players = (previous or {}).get("players", {})

    final_blocks: list[dict[str, Any]] = []
    final_stats: dict[str, dict[str, dict[str, float]]] = {}

    for result in results:
        key = result.key
        block = result.block
        if block["status"] == "ok":
            final_blocks.append({**block, "staleSinceDays": 0, "diagnostic": None})
            final_stats[key] = result.stats_by_player
            continue

        diagnostic = block.get("diagnostic")
        previous_block = previous_blocks.get(key)
        if previous_block is None or previous_block.get("status") not in ("ok", "stale"):
            # Nothing usable to carry forward — the provider is just gone this run.
            final_blocks.append({**block, "staleSinceDays": None})
            continue

        previous_fetched = previous_block.get("fetchedAt")
        stale_days = _days_between(str(previous_fetched), now_iso) if previous_fetched else None
        if stale_days is not None and stale_days > STALE_AFTER_DAYS:
            # Hard-expired: drop the rows so the deployed app can't silently
            # serve a shrunken column. The block records the measured age.
            final_blocks.append({
                **block,
                "fetchedAt": previous_fetched,
                "staleSinceDays": stale_days,
            })
            continue

        # Keep last-known-good, marked stale with the new diagnostic.
        carried = {**previous_block, "status": "stale", "diagnostic": diagnostic, "staleSinceDays": stale_days}
        final_blocks.append(carried)
        carried_stats: dict[str, dict[str, float]] = {}
        for player_id, provider_map in previous_players.items():
            if isinstance(provider_map, dict) and key in provider_map:
                carried_stats[player_id] = provider_map[key]
        final_stats[key] = carried_stats

    players: dict[str, dict[str, dict[str, float]]] = {}
    for provider_key, stats_by_player in final_stats.items():
        for player_id, stats in stats_by_player.items():
            players.setdefault(player_id, {})[provider_key] = stats

    return {
        "schemaVersion": PROVIDER_PROJECTIONS_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "season": season,
        "displayOnly": True,
        "providers": final_blocks,
        "players": players,
    }
