"""
Turns raw upstream payloads (sources.py) into the JSON artifacts committed to
data/, shaped to match shared/types.d.ts exactly (PlayerMeta, SeasonProjection,
AdpEntry, DataManifest). No I/O here — everything takes already-fetched data
in and returns plain dicts ready to json.dump, so it's testable on fixtures.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from match import MatchKey, match_ffc_entry, normalize_ffc_position

# Stat keys Sleeper embeds in projection rows that aren't real box-score
# components (its own ADP figures, games-played bookkeeping). Dropped so the
# stats payload only contains things scoring.ts should ever multiply by a
# league's scoring settings — canonical ADP comes from FFC (has stdev, FFC
# has it; Sleeper's doesn't), not from here.
_NON_STAT_KEY_PREFIXES = ("adp", "pos_adp")


def _is_real_stat_key(key: str) -> bool:
    return not any(key.startswith(p) for p in _NON_STAT_KEY_PREFIXES)


def _clean_stats(raw_stats: dict[str, Any]) -> dict[str, float]:
    out: dict[str, float] = {}
    for k, v in raw_stats.items():
        if _is_real_stat_key(k) and isinstance(v, (int, float)):
            out[k] = v
    return out


def _has_meaningful_projection(stats: dict[str, float]) -> bool:
    return any(v for v in stats.values())


def _first_non_empty(*values: str | None) -> str | None:
    for v in values:
        if v and v != "NA":
            return str(v)
    return None


@dataclass
class PlayerMeta:
    playerId: str
    name: str
    position: str | None
    eligiblePositions: list[str]
    team: str | None
    byeWeek: int | None
    age: int | None
    yearsExp: int | None
    injuryStatus: str | None
    ids: dict[str, str] = field(default_factory=dict)


@dataclass
class SeasonProjection:
    playerId: str
    source: str
    stats: dict[str, float]


@dataclass
class AdpEntry:
    playerId: str | None
    name: str
    position: str
    team: str | None
    adp: float
    stdev: float
    high: int
    low: int
    timesDrafted: int
    byeWeek: int | None


FANTASY_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DEF"}


def build_player_meta(
    sleeper_players: dict[str, dict[str, Any]],
    dp_rows: list[dict[str, str]],
) -> dict[str, PlayerMeta]:
    """Returns PlayerMeta keyed by sleeper_id, filtered to fantasy-relevant players."""
    dp_by_sleeper = {r["sleeper_id"]: r for r in dp_rows if r.get("sleeper_id") not in (None, "", "NA")}

    out: dict[str, PlayerMeta] = {}
    for sleeper_id, p in sleeper_players.items():
        position = p.get("position")
        eligible = [pos for pos in (p.get("fantasy_positions") or []) if pos in FANTASY_POSITIONS]
        if position not in FANTASY_POSITIONS and not eligible:
            continue

        if position == "DEF":
            # `.get(key, '')` only supplies the default when the key is
            # absent; Sleeper sometimes sends first_name/last_name as an
            # explicit JSON null, which `.get` would pass through as None
            # and stringify into a literal "None None" name. `or ''` covers
            # both the missing-key and explicit-null cases.
            name = p.get("full_name") or f"{p.get('first_name') or ''} {p.get('last_name') or ''}".strip()
        else:
            name = p.get("full_name")
        if not name:
            continue

        dp = dp_by_sleeper.get(sleeper_id, {})
        ids: dict[str, str] = {}
        for key, sleeper_field, dp_field in (
            ("espn", "espn_id", "espn_id"),
            ("yahoo", "yahoo_id", "yahoo_id"),
            ("gsis", "gsis_id", "gsis_id"),
            ("fantasypros", None, "fantasypros_id"),
            ("mfl", None, "mfl_id"),
        ):
            # `p.get(sleeper_field)` alone would treat a legitimate id of 0
            # as missing; check presence via `is not None` instead of
            # truthiness so a real (if unusual) 0 id isn't discarded.
            sleeper_value = p.get(sleeper_field) if sleeper_field else None
            value = _first_non_empty(
                str(sleeper_value) if sleeper_value is not None else None,
                dp.get(dp_field) if dp_field else None,
            )
            if value:
                ids[key] = value

        out[sleeper_id] = PlayerMeta(
            playerId=sleeper_id,
            name=name,
            position=position if position in FANTASY_POSITIONS else (eligible[0] if eligible else None),
            eligiblePositions=eligible or ([position] if position in FANTASY_POSITIONS else []),
            team=p.get("team_abbr") or p.get("team"),
            byeWeek=None,  # backfilled from matched ADP rows in build_data.py
            age=p.get("age"),
            yearsExp=p.get("years_exp"),
            injuryStatus=p.get("injury_status"),
            ids=ids,
        )
    return out


def build_season_projections(
    raw_projections: list[dict[str, Any]],
    valid_player_ids: set[str],
) -> list[SeasonProjection]:
    out: list[SeasonProjection] = []
    for row in raw_projections:
        player = row.get("player") or {}
        raw_player_id = player.get("player_id") or row.get("player_id")
        if not raw_player_id:
            continue
        # Coerce before the membership check: valid_player_ids is a set of
        # sleeper_id strings (players.json's keys), but Sleeper's projections
        # payload isn't guaranteed to type player_id as a string the way
        # /players/nfl's dict keys are — an int here would silently fail the
        # `in` check and drop a real match, or leak a non-string PlayerId.
        player_id = str(raw_player_id)
        if player_id not in valid_player_ids:
            continue
        stats = _clean_stats(row.get("stats") or {})
        if not _has_meaningful_projection(stats):
            continue
        out.append(SeasonProjection(playerId=player_id, source=row.get("company") or "unknown", stats=stats))
    return out


def build_adp_entries(
    ffc_players: list[dict[str, Any]],
    sleeper_index: dict[MatchKey, str],
) -> tuple[list[AdpEntry], dict[str, Any]]:
    """Returns (entries, match_diagnostics). Diagnostics feed DataManifest.crosswalk.

    Takes a prebuilt `sleeper_index` (see match.build_sleeper_match_index)
    rather than the raw player pool: the index depends only on
    sleeper_players, which is identical across every ADP format build_data.py
    calls this for, so the caller builds it once and reuses it instead of
    this function rebuilding it from scratch on every call.
    """
    entries: list[AdpEntry] = []
    for p in sorted(ffc_players, key=lambda x: x["adp"]):
        player_id = match_ffc_entry(p, sleeper_index)
        entries.append(
            AdpEntry(
                playerId=player_id,
                name=p["name"],
                # Same alias match_ffc_entry uses internally to find
                # player_id — applied here too so the committed artifact's
                # position vocabulary matches Sleeper's ("K"), not FFC's
                # raw ("PK"). Applying it in only one of the two places
                # left the matching correct but the stored value wrong.
                position=normalize_ffc_position(p["position"]),
                team=p.get("team"),
                adp=p["adp"],
                stdev=p.get("stdev", 0.0),
                high=p.get("high", 0),
                low=p.get("low", 0),
                timesDrafted=p.get("times_drafted", 0),
                byeWeek=p.get("bye"),
            )
        )

    top_n = entries[:300]
    unmatched = [e.name for e in top_n if e.playerId is None]
    # An empty top_n means FFC returned no rows to sample at all (bad
    # response, schema change, outage) — that's a failure of the gate's
    # precondition, not 100% success. Failing closed (0.0) here means the
    # coverage gate in build_data.py rejects the run instead of vacuously
    # passing and letting degraded/empty ADP data get committed.
    match_rate = (len(top_n) - len(unmatched)) / len(top_n) if top_n else 0.0
    diagnostics = {
        "top300MatchRate": round(match_rate, 4),
        "unmatchedTop300": unmatched,
        "sampleSize": len(top_n),
    }
    return entries, diagnostics


def backfill_bye_weeks(players: dict[str, PlayerMeta], adp_entries: list[AdpEntry]) -> None:
    """Bye weeks aren't in Sleeper's player object; FFC's ADP rows carry them.
    Only covers players who showed up in a mock draft, which is exactly the
    set relevant to bye-conflict warnings anyway."""
    for entry in adp_entries:
        if entry.playerId and entry.byeWeek is not None:
            meta = players.get(entry.playerId)
            if meta and meta.byeWeek is None:
                meta.byeWeek = entry.byeWeek


def to_json_ready(obj: Any) -> Any:
    return asdict(obj) if hasattr(obj, "__dataclass_fields__") else obj
