"""ESPN default-league ADP adapter (the engine board for ESPN drafts).

Parses `player.ownership.averageDraftPosition` off the same kona_player_info
payload espn_projections.py already GETs — this module is pure (no HTTP); the
CLI boundary in build_data.py owns the single fetch and the fail-open wiring.

Unlike parse_espn_payload, ADP parsing is INDEPENDENT of the season-projection
stats[] entry: a player can appear on the ADP board without a projection row,
so this walk must not reuse `_select_projection_entry` (which would silently
drop more than half the board).

ESPN's averageDraftPosition saturates at ~171 picks for every undrafted
player, so detect_censor_cutoff truncates the honest head and
build_espn_adp_entries splices the remaining draftable players from the
active Sleeper board (clamped to the cutoff so censored noise never leaks
into the honest region). Row-level adpSource/stdevSource stay honest: only
the ESPN head is labeled 'espn'.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from espn_projections import POSITION_BY_DEFAULT_ID, PRO_TEAM_ABBR
from match import MatchKey, match_named_row
from transform import AdpEntry, fitted_stdev_for_player

# kona_player_info wraps every row under a nested `player` object.
_ROW_PLAYER_KEY = "player"

# Pick-width of the density histogram used to locate the censor cliff.
_CENSOR_BIN = 5.0
# Region whose per-pick density is "normal" — no real team's draft saturates
# here, so it is the baseline for what honest density looks like.
_CENSOR_BASELINE_RANGE = (24.0, 100.0)
# A bin must exceed the baseline median by this many times to count as the
# sentinel cliff. The measured live spike is ~50-70x baseline, so 8x is a
# wide margin against ordinary density noise.
_CENSOR_SPIKE_FACTOR = 8.0
# A cutoff below this means the payload is degenerate (drafts don't saturate
# at pick 100) — raise rather than ship a mangled board.
_CENSOR_MIN_CUTOFF = 100.0


@dataclass(frozen=True)
class ParsedEspnAdpRow:
    name: str
    team: str | None
    position: str
    espn_id: str | None
    adp: float


def parse_espn_adp_rows(payload: dict[str, Any]) -> list[ParsedEspnAdpRow]:
    """Normalize the kona payload's ownership ADP into Sleeper-vocab rows.

    Raises ValueError on schema drift (missing players array / nested player
    objects), same contract as parse_espn_payload. Rows with no usable
    averageDraftPosition (missing, <= 0, non-finite) are skipped, not raised.
    """
    raw_rows = payload.get("players")
    if not isinstance(raw_rows, list):
        raise ValueError("ESPN payload has no players array")
    rows: list[ParsedEspnAdpRow] = []
    for raw in raw_rows:
        player = raw.get(_ROW_PLAYER_KEY) if isinstance(raw, dict) else None
        if not isinstance(player, dict):
            raise ValueError("ESPN player row missing nested player object")
        ownership = player.get("ownership")
        adp = ownership.get("averageDraftPosition") if isinstance(ownership, dict) else None
        if not isinstance(adp, (int, float)) or not math.isfinite(adp) or adp <= 0:
            continue
        position = POSITION_BY_DEFAULT_ID.get(player.get("defaultPositionId"))
        if position is None:
            continue
        pro_team_id = player.get("proTeamId")
        team = PRO_TEAM_ABBR.get(pro_team_id) if isinstance(pro_team_id, int) else None
        espn_id = player.get("id")
        rows.append(
            ParsedEspnAdpRow(
                name=str(player.get("fullName") or "").strip(),
                team=team,
                position=position,
                espn_id=str(espn_id) if espn_id is not None else None,
                adp=float(adp),
            )
        )
    return rows


def detect_censor_cutoff(adps: list[float]) -> float | None:
    """Lower edge of the first density spike, or None when the board is honest.

    Baseline is the median per-pick density over _CENSOR_BASELINE_RANGE; bins
    are walked upward and the cutoff is the lower edge of the first bin whose
    density exceeds baseline * _CENSOR_SPIKE_FACTOR. A spike found below
    _CENSOR_MIN_CUTOFF is a degenerate payload and raises. No spike (or no
    baseline to measure) means the whole board is honest -> None.
    """
    if not adps:
        return None
    densities: dict[float, float] = {}
    for adp in adps:
        lower = math.floor(adp / _CENSOR_BIN) * _CENSOR_BIN
        densities[lower] = densities.get(lower, 0.0) + 1.0 / _CENSOR_BIN
    baseline_densities = [
        density
        for lower, density in densities.items()
        if _CENSOR_BASELINE_RANGE[0] <= lower < _CENSOR_BASELINE_RANGE[1]
    ]
    if not baseline_densities:
        return None
    ordered = sorted(baseline_densities)
    mid = len(ordered) // 2
    baseline = ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2
    for lower in sorted(densities):
        if densities[lower] > baseline * _CENSOR_SPIKE_FACTOR:
            if lower < _CENSOR_MIN_CUTOFF:
                raise ValueError(f"ESPN ADP censor spike detected below {_CENSOR_MIN_CUTOFF}: {lower}")
            return lower
    return None


def build_espn_adp_entries(
    rows: list[ParsedEspnAdpRow],
    *,
    cv_bands: tuple[tuple[float, float], ...],
    espn_id_to_player_id: dict[str, str],
    sleeper_index: dict[MatchKey, str],
    valid_player_ids: set[str],
    fallback_entries: list[AdpEntry],
    ffc_cv_index: dict[str, tuple[float, int]] | None = None,
) -> tuple[list[AdpEntry], dict[str, Any]]:
    """Compose the committed ESPN default-PPR board.

    Head: every row with adp below the detected censor cutoff, matched by
    ids.espn first (never for DEF — ESPN DEF ids are negative synthetics) then
    match_named_row(name/position/team). Unmatched rows stay out of the
    artifact, same as espn_provider_result. stdev is `fitted_stdev_for_player`
    (Phase 2c H2: per-player FFC CV when `ffc_cv_index` has a crosswalked
    match, else the flat band constant — the source population's disagreement
    with Sleeper is bias, not spread, so there is still no disagreement
    floor); high/low/timesDrafted are genuinely unknown.

    Tail: every fallback_entries player not already in the head, carried over
    unchanged except their adp is clamped up to the cutoff (a censored ESPN
    player with a deep Sleeper rank must not sort into the honest head region
    — e.g. Oronde Gadsden II, Sleeper 107 / ESPN ~239). Only a clamped row's
    stdev is recomputed to fitted_stdev_for_player(cutoff, ...); everything else keeps its own
    adpSource/stdevSource so the artifact is honestly mixed at the row level.
    """
    cutoff = detect_censor_cutoff([row.adp for row in rows])
    head_rows = rows if cutoff is None else [row for row in rows if row.adp < cutoff]

    entries: list[AdpEntry] = []
    for row in head_rows:
        player_id: str | None = None
        if row.position != "DEF" and row.espn_id:
            player_id = espn_id_to_player_id.get(row.espn_id)
        if player_id is None:
            player_id = match_named_row(row.name, row.position, row.team, sleeper_index)
        if player_id is None or player_id not in valid_player_ids:
            continue
        entries.append(
            AdpEntry(
                playerId=player_id,
                name=row.name,
                position=row.position,
                team=row.team,
                adp=row.adp,
                stdev=fitted_stdev_for_player(row.adp, player_id, ffc_cv_index, cv_bands),
                high=None,
                low=None,
                timesDrafted=None,
                byeWeek=None,  # backfilled from players.json by the caller
                adpSource="espn",
                stdevSource="fitted",
            )
        )

    head_ids = {entry.playerId for entry in entries if entry.playerId}
    tail_rows = 0
    if cutoff is not None:
        for fallback in fallback_entries:
            if fallback.playerId is None or fallback.playerId in head_ids:
                continue
            adp = max(fallback.adp, cutoff)
            entries.append(
                AdpEntry(
                    playerId=fallback.playerId,
                    name=fallback.name,
                    position=fallback.position,
                    team=fallback.team,
                    adp=adp,
                    stdev=fallback.stdev if adp == fallback.adp else fitted_stdev_for_player(cutoff, fallback.playerId, ffc_cv_index, cv_bands),
                    high=fallback.high,
                    low=fallback.low,
                    timesDrafted=fallback.timesDrafted,
                    byeWeek=fallback.byeWeek,
                    adpSource=fallback.adpSource,
                    stdevSource=fallback.stdevSource,
                )
            )
            tail_rows += 1

    entries.sort(key=lambda entry: entry.adp)
    diagnostics = {
        "censorCutoff": cutoff,
        "espnRows": len(entries) - tail_rows,
        "tailRows": tail_rows,
    }
    return entries, diagnostics

