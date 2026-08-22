"""
Turns raw upstream payloads (sources.py) into the JSON artifacts committed to
data/, shaped to match shared/types.d.ts exactly (PlayerMeta, SeasonProjection,
AdpEntry, DataManifest). No I/O here — everything takes already-fetched data
in and returns plain dicts ready to json.dump, so it's testable on fixtures.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any
import re

from match import MatchKey, match_ffc_entry, normalize_ffc_position

# Stat keys Sleeper embeds in projection rows that aren't real box-score
# components (its own ADP figures, games-played bookkeeping). Dropped so the
# stats payload passed to build_season_projections only contains things
# scoring.ts should ever multiply by a league's scoring settings — canonical
# projections stay FFToday's, never Sleeper/Rotowire's. This does NOT apply to
# the ADP path: build_sleeper_adp_entries (below) reads these same `adp_*` keys
# directly off the raw row, before/independent of this stripping, since (unlike
# projections) Sleeper's own ADP figures are exactly what's wanted there.
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
    # DynastyProcess occasionally pads ids with leading spaces (e.g. gsis
    # " 00-0035676"). Strip so crosswalk keys match nflverse/Sleeper ids.
    for v in values:
        if not v:
            continue
        cleaned = str(v).strip()
        if cleaned and cleaned != "NA":
            return cleaned
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
    depthChartPosition: str | None
    depthChartOrder: int | None
    injuryBodyPart: str | None
    practiceParticipation: str | None
    ids: dict[str, str] = field(default_factory=dict)
    heightInches: int | None = None
    weightLbs: int | None = None
    college: str | None = None
    jerseyNumber: int | None = None
    draftYear: int | None = None
    draftRound: int | None = None
    draftPick: int | None = None


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
    high: int | None
    low: int | None
    timesDrafted: int | None
    byeWeek: int | None
    adpSource: str = "ffc"  # 'sleeper' | 'ffc'
    stdevSource: str = "observed"  # 'observed' | 'fitted'


_HEIGHT_FT_IN = re.compile(r"^(\d)\s*['’\-]\s*(\d{1,2})")


def _optional_int(value: Any, *, minimum: int | None = None, maximum: int | None = None) -> int | None:
    if value is None or value == "":
        return None
    try:
        number = int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None
    if minimum is not None and number < minimum:
        return None
    if maximum is not None and number > maximum:
        return None
    return number


def parse_height_inches(value: Any) -> int | None:
    """Normalize Sleeper's mixed height encodings (`77`, `6'5"`, `6-5`) to inches."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return _optional_int(value, minimum=48, maximum=90)
    text = str(value).strip()
    if not text or text.upper() == "NA":
        return None
    as_int = _optional_int(text, minimum=48, maximum=90)
    if as_int is not None:
        return as_int
    match = _HEIGHT_FT_IN.match(text)
    if not match:
        return None
    inches = int(match.group(1)) * 12 + int(match.group(2))
    return inches if 48 <= inches <= 90 else None


def parse_weight_lbs(value: Any) -> int | None:
    return _optional_int(value, minimum=120, maximum=450)


def parse_jersey_number(value: Any) -> int | None:
    return _optional_int(value, minimum=0, maximum=99)


def parse_college(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned if cleaned and cleaned.upper() != "NA" else None


def sleeper_bio_fields(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "heightInches": parse_height_inches(raw.get("height")),
        "weightLbs": parse_weight_lbs(raw.get("weight")),
        "college": parse_college(raw.get("college")),
        "jerseyNumber": parse_jersey_number(raw.get("number")),
    }


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
            ("pfr", None, "pfr_id"),
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
            depthChartPosition=p.get("depth_chart_position"),
            depthChartOrder=p.get("depth_chart_order"),
            injuryBodyPart=p.get("injury_body_part"),
            practiceParticipation=p.get("practice_participation"),
            ids=ids,
            **sleeper_bio_fields(p),
        )
    return out


def apply_nflverse_draft(players: dict[str, PlayerMeta], rows: list[dict[str, Any]]) -> int:
    """Join nflverse player-table draft year/round/pick onto PlayerMeta by GSIS.

    Missing joins stay None — never invent a pick. Returns how many players
    received a draft year.
    """
    by_gsis: dict[str, dict[str, Any]] = {}
    for row in rows:
        gsis = _first_non_empty(
            str(row["gsis_id"]).strip() if row.get("gsis_id") is not None else None,
            str(row["gsis"]).strip() if row.get("gsis") is not None else None,
        )
        if gsis:
            by_gsis[gsis] = row

    applied = 0
    for player in players.values():
        gsis = player.ids.get("gsis")
        if not gsis:
            continue
        row = by_gsis.get(gsis)
        if row is None:
            continue
        year = _optional_int(row.get("draft_year"), minimum=1960, maximum=2100)
        if year is None:
            continue
        player.draftYear = year
        round_ = _optional_int(row.get("draft_round"), minimum=1, maximum=20)
        pick = _optional_int(
            row.get("draft_pick") if row.get("draft_pick") is not None else (
                row.get("draft_number") if row.get("draft_number") is not None else row.get("draft_ovr")
            ),
            minimum=1,
            maximum=500,
        )
        player.draftRound = round_
        player.draftPick = pick
        applied += 1
    return applied


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
                adpSource="ffc",
                stdevSource="observed",
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


# Sleeper's per-player ADP is a mean with no dispersion field at all. Rather than
# importing FFC's per-player stdev outright (the two sources disagree on the mean
# by up to 20 picks at TE, so pairing FFC's spread-at-pick-41 onto a Sleeper mean
# of pick-20 would be internally inconsistent), a spread is synthesized from
# FFC's dispersion shape, which is close to a constant coefficient of variation
# (stdev/adp) that decays with draft depth. Bands below are mean(sd/adp) measured
# on the live 2026 FFC PPR board; deliberately mean-of-ratios (the per-player
# quantity being fitted), not ratio-of-means, which gives a materially different
# number at the top of the board (0.206 vs 0.247).
_DEFAULT_ADP_CV_BANDS: tuple[tuple[float, float], ...] = (
    (12, 0.247),
    (24, 0.169),
    (48, 0.124),
    (float("inf"), 0.112),
)
# Observed floor at the very top of the board (FFC's own stdev bottoms out
# around 0.7-0.8 for the consensus #1 overall pick) — without a floor, the CV
# curve would let stdev shrink toward 0 as adp -> 0 and make the very top of
# the board falsely look like a point mass.
_ADP_STDEV_FLOOR = 0.7


def fit_adp_cv_bands(entries: list[AdpEntry]) -> tuple[tuple[float, float], ...]:
    lower = 0.0
    fitted: list[tuple[float, float]] = []
    for upper, fallback_cv in _DEFAULT_ADP_CV_BANDS:
        ratios = [entry.stdev / entry.adp for entry in entries if lower <= entry.adp < upper and entry.adp > 0 and entry.stdev > 0]
        fitted.append((upper, sum(ratios) / len(ratios) if ratios else fallback_cv))
        lower = upper
    return tuple(fitted)


def fitted_stdev(
    adp: float,
    cv_bands: tuple[tuple[float, float], ...] = _DEFAULT_ADP_CV_BANDS,
) -> float:
    """Synthesize a plausible draft-position spread for an ADP mean that has none
    of its own (Sleeper's lobby ADP). This is a labeled assumption
    (`AdpEntry.stdevSource == 'fitted'`), not a measurement of Sleeper's actual
    draft-position spread — treat as experimental until calibrated against
    captured ADP history (PLAN.md's Edge Validation Gate, availability
    calibration). Feeds both `availability.ts`'s survival CDF and, once wired up,
    S3's VONA opponent-pick rollouts (`opponentModel.ts`), so an uncalibrated
    curve here distorts more than just the displayed availability percentage.
    """
    for upper, cv in cv_bands:
        if adp < upper:
            return round(max(_ADP_STDEV_FLOOR, adp * cv), 4)
    return round(max(_ADP_STDEV_FLOOR, adp * cv_bands[-1][1]), 4)


def _band_cv(adp: float, cv_bands: tuple[tuple[float, float], ...]) -> float:
    for upper, cv in cv_bands:
        if adp < upper:
            return cv
    return cv_bands[-1][1]


def build_ffc_cv_index(ffc_entries: list[AdpEntry]) -> dict[str, tuple[float, int]]:
    """Per-player (observed coefficient of variation, times_drafted) keyed by
    sleeper playerId, built from FFC's own crosswalked entries
    (`build_adp_entries`'s output). This is the H2 per-player CV-transfer
    input for `fitted_stdev_for_player` — see `survival_diagnose.py`'s H2
    check (`benchmarks/reports/2026-08-20-ffc-survival-diagnosis-
    interpretation.md`): the flat band CV is a good central estimate but
    flattens real per-player structure (2.1x p90/p10 spread in the top
    band), so a player FFC has actually observed should use its own ratio,
    shrunk toward the band per `fitted_stdev_for_player`, rather than the
    band average outright. A player with no FFC row, no crosswalk match, or
    a degenerate FFC stdev/adp is simply absent, and callers fall back to
    the flat band CV for that player.
    """
    index: dict[str, tuple[float, int]] = {}
    for entry in ffc_entries:
        if entry.playerId is None or entry.adp <= 0 or entry.stdev <= 0:
            continue
        index[entry.playerId] = (entry.stdev / entry.adp, entry.timesDrafted or 0)
    return index


# Pseudo-count weight given to the band CV when blending it with an
# FFC-observed per-player CV (empirical-Bayes shrinkage): weight on the
# observed ratio is `times_drafted / (times_drafted + prior_n)`. Chosen so a
# lightly-sampled player (single digits to tens of times_drafted) stays close
# to the band average, while a well-sampled one (FFC's deep-ADP median is
# ~193 times_drafted, elite players are in the thousands) is dominated by its
# own observed ratio rather than a flat band constant.
_CV_SHRINKAGE_PRIOR_N = 50

# A per-player CV is only trusted within this multiplicative band around the
# ADP band's own constant — the same far-from-band tolerance
# `survival_diagnose.py`'s H2 check already flags (`farFromBandCvFraction`
# uses the identical 0.5x/2x bounds), so one noisy or misattributed FFC row
# can't send a single player's synthesized dispersion wildly off structure.
_CV_TOLERANCE_LOW = 0.5
_CV_TOLERANCE_HIGH = 2.0


def per_player_cv(
    adp: float,
    player_id: str | None,
    ffc_cv_index: dict[str, tuple[float, int]],
    cv_bands: tuple[tuple[float, float], ...] = _DEFAULT_ADP_CV_BANDS,
    prior_n: int = _CV_SHRINKAGE_PRIOR_N,
) -> float:
    """Resolve the coefficient of variation to use for one player's stdev
    synthesis: the flat band constant when no FFC-observed ratio exists for
    this player, else an empirical-Bayes shrinkage of the FFC-observed CV
    toward the band constant, clamped to the tolerance band above.
    """
    band_cv = _band_cv(adp, cv_bands)
    entry = ffc_cv_index.get(player_id) if player_id else None
    if entry is None:
        return band_cv
    observed_cv, times_drafted = entry
    weight = times_drafted / (times_drafted + prior_n) if times_drafted > 0 else 0.0
    shrunk = weight * observed_cv + (1.0 - weight) * band_cv
    return min(max(shrunk, _CV_TOLERANCE_LOW * band_cv), _CV_TOLERANCE_HIGH * band_cv)


def fitted_stdev_for_player(
    adp: float,
    player_id: str | None,
    ffc_cv_index: dict[str, tuple[float, int]] | None,
    cv_bands: tuple[tuple[float, float], ...] = _DEFAULT_ADP_CV_BANDS,
    prior_n: int = _CV_SHRINKAGE_PRIOR_N,
) -> float:
    """Phase 2c H2 fix: same synthesis as `fitted_stdev`, but resolves the CV
    per-player via `per_player_cv` when `ffc_cv_index` is given (Sleeper/ESPN
    boards) instead of always using the flat band constant. Passing
    `ffc_cv_index=None` (or omitting a player from it) reproduces
    `fitted_stdev`'s original band-only behavior exactly, so this is a
    strict extension, not a behavior change for unmatched players.
    """
    cv = per_player_cv(adp, player_id, ffc_cv_index or {}, cv_bands, prior_n)
    return round(max(_ADP_STDEV_FLOOR, adp * cv), 4)


# Sleeper's projections payload nests every format's ADP mean under `stats`
# alongside real box-score stats; transform._clean_stats strips `adp*` keys back
# out of that same payload before it's used as a season projection (canonical
# projections stay FFToday, never Sleeper/Rotowire), so this mapping is read
# before that stripping ever applies.
SLEEPER_ADP_STAT_KEYS = {
    "ppr": "adp_ppr",
    "half-ppr": "adp_half_ppr",
    "standard": "adp_std",
    "2qb": "adp_2qb",
}

# Sleeper's "no ADP sample for this player/format" sentinel is 999.0, not a
# missing key or null — verified live: ~90% of rows in the projections payload
# carry this sentinel on adp_dynasty/adp_rookie/etc., and any given format has it
# on the vast majority of rows too. >= 900 comfortably clears real ADP values
# (which top out well under 300 picks) without risking a false-positive filter.
SLEEPER_ADP_SENTINEL = 900.0


def build_sleeper_adp_entries(
    sleeper_rows: list[dict[str, Any]],
    fmt: str,
    cv_bands: tuple[tuple[float, float], ...] = _DEFAULT_ADP_CV_BANDS,
    ffc_cv_index: dict[str, tuple[float, int]] | None = None,
) -> tuple[list[AdpEntry], dict[str, Any]]:
    """Sleeper's own draft-lobby ADP for one format. `player_id` is already a
    sleeper_id (a team abbreviation for DEF, e.g. "LAR" — same convention as
    /v1/players/nfl), so unlike FFC's rows this needs no crosswalk at all.

    The payload carries no dispersion field, so `stdev` is synthesized —
    per-player via `fitted_stdev_for_player` when `ffc_cv_index` is given
    (Phase 2c H2: `build_ffc_cv_index` on this format's own FFC board), else
    the flat-band `fitted_stdev` — and `high`/`low`/`timesDrafted` are
    genuinely unknown (None), not zero — a 0 there would misleadingly read as
    "always this exact pick" or "zero recorded drafts" instead of "this
    source doesn't expose that."
    """
    stat_key = SLEEPER_ADP_STAT_KEYS[fmt]
    usable: list[tuple[float, dict[str, Any]]] = []
    for row in sleeper_rows:
        stats = row.get("stats") or {}
        adp = stats.get(stat_key)
        if not isinstance(adp, (int, float)) or adp >= SLEEPER_ADP_SENTINEL or adp < 0:
            continue
        usable.append((float(adp), row))
    usable.sort(key=lambda pair: pair[0])

    entries: list[AdpEntry] = []
    for adp, row in usable:
        player_id = row.get("player_id")
        player = row.get("player") or {}
        position = player.get("position")
        # DEF rows split the team name across first_name/last_name (e.g.
        # "Los Angeles" / "Rams") the same way build_player_meta constructs a
        # DEF's display name from Sleeper's raw player object, so the two stay
        # consistent with each other and with players.json.
        name = f"{player.get('first_name') or ''} {player.get('last_name') or ''}".strip()
        if not player_id or not position or not name:
            continue
        entries.append(
            AdpEntry(
                playerId=str(player_id),
                name=name,
                position=position,
                team=player.get("team"),
                adp=adp,
                stdev=fitted_stdev_for_player(adp, str(player_id), ffc_cv_index, cv_bands),
                high=None,
                low=None,
                timesDrafted=None,
                byeWeek=None,  # backfilled separately from the retained FFC board
                adpSource="sleeper",
                stdevSource="fitted",
            )
        )

    diagnostics = {"sampleSize": len(entries)}
    return entries, diagnostics


def backfill_bye_weeks(players: dict[str, PlayerMeta], adp_entries: list[AdpEntry]) -> None:
    """Bye weeks aren't in Sleeper's player object; FFC's ADP rows carry them.
    Only covers players who showed up in a mock draft — Sleeper's broader lobby
    board is backfilled separately from FFToday (see backfill_bye_weeks_from_ids).
    """
    for entry in adp_entries:
        if entry.playerId and entry.byeWeek is not None:
            meta = players.get(entry.playerId)
            if meta and meta.byeWeek is None:
                meta.byeWeek = entry.byeWeek


def backfill_bye_weeks_from_ids(
    players: dict[str, PlayerMeta],
    bye_by_player: dict[str, int],
) -> None:
    """Fill remaining PlayerMeta.byeWeek holes from an id→bye map (FFToday)."""
    for player_id, bye in bye_by_player.items():
        meta = players.get(player_id)
        if meta is not None and meta.byeWeek is None:
            meta.byeWeek = bye


def apply_player_bye_weeks_to_adp(
    entries: list[AdpEntry],
    players: dict[str, PlayerMeta],
) -> None:
    """Copy PlayerMeta.byeWeek onto AdpEntry rows that still have byeWeek=None.

    Sleeper's lobby ADP carries no bye field, so committed adp-*.json would
    otherwise ship every row with null bye even when players.json knows it.
    """
    for entry in entries:
        if entry.byeWeek is not None or not entry.playerId:
            continue
        meta = players.get(entry.playerId)
        if meta is not None and meta.byeWeek is not None:
            entry.byeWeek = meta.byeWeek


def to_json_ready(obj: Any) -> Any:
    return asdict(obj) if hasattr(obj, "__dataclass_fields__") else obj
