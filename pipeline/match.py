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

# FFC's own position vocabulary diverges from Sleeper's in exactly one place.
FFC_POSITION_ALIAS = {"PK": "K"}

TEAM_ALIASES = {
    "ARZ": "ARI", "BLT": "BAL", "CLV": "CLE", "HST": "HOU",
    "JAC": "JAX", "KAN": "KC", "LA": "LAR", "STL": "LAR",
    "SD": "LAC", "OAK": "LV", "NWE": "NE", "NOR": "NO",
    "SFO": "SF", "TAM": "TB", "OTI": "TEN", "WSH": "WAS",
}


def normalize_ffc_position(position: str) -> str:
    """Translate an FFC position string into Sleeper's vocabulary.

    Single source of truth for the PK->K alias: used both to build the
    matching key (so a kicker still resolves to a sleeper_id) and by
    transform.py when writing AdpEntry.position, so the alias can't be
    applied in one place and silently skipped in the other.
    """
    return FFC_POSITION_ALIAS.get(position, position)


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
            key: MatchKey = (p.get("team") or sleeper_id, "DEF")
        else:
            full_name = p.get("full_name")
            if not full_name or not position:
                continue
            key = (normalize_name(full_name), position)
        index.setdefault(key, sleeper_id)
    return index


def match_ffc_entry(entry: dict[str, Any], sleeper_index: dict[MatchKey, str]) -> str | None:
    """Resolve one FFC ADP row to a sleeper_id, or None if no match is found.

    A None here is a real, surfaced miss (see AdpEntry.playerId in
    shared/types.d.ts) — never silently dropped, since a silently-missing
    player corrupts every downstream recommendation that assumes it's just
    not draftable rather than untracked.
    """
    position = normalize_ffc_position(entry["position"])
    if position == "DEF":
        key: MatchKey = (entry.get("team") or "", "DEF")
    else:
        key = (normalize_name(entry["name"]), position)
    return sleeper_index.get(key)
