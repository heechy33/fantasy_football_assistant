"""
Player identity matching: FFC's ADP rows (keyed by name/position/team) onto
Sleeper's player pool (keyed by sleeper_id, our canonical PlayerId).

Pure functions, no I/O — verified by hand against live data before writing this
(see PLAN.md): naive exact-string matching only hit 68% of the top 300 ADP
players. The gap was never missing data, just four normalization issues: name
suffixes ("James Cook III" vs "James Cook"), FFC spelling kickers "PK" where
Sleeper uses "K", defenses needing a team-abbreviation match instead of a name
match ("Denver Defense" has no name-shaped equivalent in Sleeper), and accented
characters where one source has them and the other doesn't ("Piñeiro" vs
"Pineiro" — naively *stripping* non-ASCII characters as punctuation deletes the
"n" entirely instead of folding "ñ" to it, which silently breaks the match).
Fixing all four brought it to 100% on the verified sample.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from typing import Any

_SUFFIX_RE = re.compile(r"\b(jr|sr|ii|iii|iv|v)\.?$", re.IGNORECASE)
_NON_ALNUM_RE = re.compile(r"[^a-z0-9 ]")
_WHITESPACE_RE = re.compile(r"\s+")

# Position alias table shared by every named-row source (FFC's own vocabulary
# only ever diverges from Sleeper's at "PK" -> "K"; FantasyPros additionally
# uses DST/D-ST/DEFENSE spellings and rank-suffixed tokens like "WR1").
POSITION_ALIASES = {
    "PK": "K",
    "DST": "DEF",
    "D/ST": "DEF",
    "DEFENSE": "DEF",
}

_RANK_SUFFIX_RE = re.compile(r"\d+$")

TEAM_ALIASES = {
    "ARZ": "ARI", "BLT": "BAL", "CLV": "CLE", "HST": "HOU",
    "JAC": "JAX", "KAN": "KC", "LA": "LAR", "STL": "LAR",
    "SD": "LAC", "OAK": "LV", "NWE": "NE", "NOR": "NO",
    "SFO": "SF", "TAM": "TB", "OTI": "TEN", "WSH": "WAS",
}

# Full franchise names (lowercased) -> Sleeper-style abbreviation, used whenever a
# source spells a defense by its whole team name rather than a three-letter code
# (FFToday's DEF rows, FantasyPros' "Houston Texans DST" rows, CBS's "Denver" rows
# use their own map). All 32 franchises, no exceptions — an unknown name is a real
# identity problem and must raise, never guess.
DEF_TEAM_NAMES = {
    "arizona cardinals": "ARI", "atlanta falcons": "ATL", "baltimore ravens": "BAL",
    "buffalo bills": "BUF", "carolina panthers": "CAR", "chicago bears": "CHI",
    "cincinnati bengals": "CIN", "cleveland browns": "CLE", "dallas cowboys": "DAL",
    "denver broncos": "DEN", "detroit lions": "DET", "green bay packers": "GB",
    "houston texans": "HOU", "indianapolis colts": "IND", "jacksonville jaguars": "JAX",
    "kansas city chiefs": "KC", "las vegas raiders": "LV", "los angeles chargers": "LAC",
    "los angeles rams": "LAR", "miami dolphins": "MIA", "minnesota vikings": "MIN",
    "new england patriots": "NE", "new orleans saints": "NO", "new york giants": "NYG",
    "new york jets": "NYJ", "philadelphia eagles": "PHI", "pittsburgh steelers": "PIT",
    "san francisco 49ers": "SF", "seattle seahawks": "SEA", "tampa bay buccaneers": "TB",
    "tennessee titans": "TEN", "washington commanders": "WAS",
}


def normalize_position(raw: str) -> str:
    """Translate any named-row source's position token into Sleeper's
    vocabulary: trim/uppercase, strip a terminal rank suffix (FantasyPros'
    `WR1` -> `WR`, `DST23` -> `DST`), then apply POSITION_ALIASES.

    Digits are stripped only from this position token, never from a player
    name — `_RANK_SUFFIX_RE` is applied here and nowhere near normalize_name.
    """
    value = raw.strip().upper()
    value = _RANK_SUFFIX_RE.sub("", value)
    return POSITION_ALIASES.get(value, value)


def normalize_ffc_position(position: str) -> str:
    """Translate an FFC position string into Sleeper's vocabulary.

    Delegates to the general normalize_position(): FFC never sends
    rank-suffixed positions, and POSITION_ALIASES is a superset of the old
    FFC-only FFC_POSITION_ALIAS ({"PK": "K"}), so this is behaviorally
    identical to the previous direct lookup. Kept as its own function (rather
    than calling normalize_position directly everywhere) so build_adp_entries
    and transform.py keep a name that documents which source's positions it's
    normalizing.
    """
    return normalize_position(position)


# Letters with no canonical NFKD decomposition into base-letter + combining
# mark, so unicodedata.normalize("NFKD", ...).encode("ascii", "ignore") would
# otherwise delete them outright instead of folding them (e.g. 'ø' has no
# decomposition, unlike 'ñ' = 'n' + combining tilde). Folded explicitly first.
_EXTRA_FOLD_MAP = str.maketrans(
    {
        "ø": "o", "Ø": "O",
        "ł": "l", "Ł": "L",
        "đ": "d", "Đ": "D",
        "æ": "ae", "Æ": "AE",
        "œ": "oe", "Œ": "OE",
    }
)


def _fold_to_ascii(s: str) -> str:
    """'ñ' -> 'n', 'é' -> 'e', etc. NFKD decomposes a character into its base
    letter plus a combining accent mark; encoding to ASCII with 'ignore' then
    drops just the accent, leaving the underlying letter intact instead of
    deleting the whole character. Letters with no such decomposition (ø, ł,
    đ, æ, œ, ...) are folded via an explicit table first."""
    s = s.translate(_EXTRA_FOLD_MAP)
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")


def normalize_name(name: str) -> str:
    """Lowercase, fold accents to ASCII, drop generational suffixes, strip
    punctuation, collapse whitespace."""
    s = _fold_to_ascii(name.lower().strip())
    s = _SUFFIX_RE.sub("", s).strip()
    s = _NON_ALNUM_RE.sub("", s)
    s = _WHITESPACE_RE.sub(" ", s).strip()
    return s


def normalize_team(team: str | None) -> str | None:
    """Return a Sleeper-style abbreviation; unsigned states become None."""
    if not team:
        return None
    value = team.strip().upper().replace(".", "")
    if value in {"FA", "UFA", "N/A", "NA", "-", ""}:
        return None
    return TEAM_ALIASES.get(value, value)


def normalize_def_team_name(name: str) -> str:
    """Full franchise name (`Houston Texans`) → Sleeper-style abbreviation (`HOU`).

    Raises ValueError for an unrecognized franchise rather than guessing — a DEF
    row that can't be mapped to a real team is an identity failure, and the
    caller decides whether that's fatal (FantasyPros parser) or a tolerant miss
    (FFToday defers to `.get()` and sends the row to unmatched).
    """
    abbr = DEF_TEAM_NAMES.get(name.strip().lower())
    if abbr is None:
        raise ValueError(f"unknown defense franchise name: {name!r}")
    return abbr


MatchKey = tuple[str, str]


def build_sleeper_match_index(sleeper_players: dict[str, dict[str, Any]]) -> dict[MatchKey, str]:
    """(normalized_name_or_team, position) -> sleeper_id.

    Defenses are keyed by team abbreviation (Sleeper's own player_id for a
    DEF *is* the team abbreviation, e.g. "DEN"), everyone else by normalized
    full name. Collisions (rare same-name players at the same position) keep
    the first one seen — Sleeper's dict ordering isn't meaningful either way,
    and a true collision is a manual-fixup edge case, not worth resolving
    automatically.
    """
    index: dict[MatchKey, str] = {}
    for sleeper_id, p in sleeper_players.items():
        position = p.get("position")
        if position == "DEF":
            # Same TEAM_ALIASES fold used on the FFC side — without it, JAC/KAN/…
            # defenses silently miss even though the alias table exists for them.
            team = normalize_team(p.get("team") or sleeper_id)
            if not team:
                continue
            key: MatchKey = (team, "DEF")
        else:
            full_name = p.get("full_name")
            if not full_name or not position:
                continue
            key = (normalize_name(full_name), position)
        index.setdefault(key, sleeper_id)
    return index


def match_named_row(
    name: str,
    position: str,
    team: str | None,
    index: dict[MatchKey, str],
) -> str | None:
    """Resolve one name/position/team row (already position-normalized by the
    caller) to a sleeper_id, or None if no match is found. This is the
    provider-general matching rule both match_ffc_entry and the FantasyPros
    parser key off of: defense is team keyed, everyone else is
    normalized-name-and-position keyed. Team is otherwise not part of the key
    for non-defense rows, so a free-agent row (no team) still resolves by
    name and position.
    """
    if position == "DEF":
        normalized_team = normalize_team(team)
        if not normalized_team:
            return None
        key: MatchKey = (normalized_team, "DEF")
    else:
        key = (normalize_name(name), position)
    return index.get(key)


def match_ffc_entry(entry: dict[str, Any], sleeper_index: dict[MatchKey, str]) -> str | None:
    """Resolve one FFC ADP row to a sleeper_id, or None if no match is found.

    A None here is a real, surfaced miss (see AdpEntry.playerId in
    shared/types.d.ts) — never silently dropped, since a silently-missing
    player corrupts every downstream recommendation that assumes it's just
    not draftable rather than untracked.
    """
    position = normalize_ffc_position(entry["position"])
    return match_named_row(entry["name"], position, entry.get("team"), sleeper_index)
