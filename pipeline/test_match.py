"""Identity-matching coverage for the historically fragile FFC→Sleeper path."""

from __future__ import annotations

from match import (
    build_sleeper_match_index,
    match_ffc_entry,
    match_named_row,
    normalize_ffc_position,
    normalize_name,
    normalize_position,
    normalize_team,
)


def test_normalize_name_folds_suffixes_accents_and_punctuation():
    assert normalize_name("James Cook III") == "james cook"
    assert normalize_name("Piñeiro") == "pineiro"
    assert normalize_name("A.J. Brown") == "aj brown"
    assert normalize_name("Kenneth Walker Jr.") == "kenneth walker"


def test_normalize_ffc_position_aliases_pk_to_k():
    assert normalize_ffc_position("PK") == "K"
    assert normalize_ffc_position("RB") == "RB"


def test_match_ffc_entry_resolves_name_suffix_and_kicker_alias():
    index = build_sleeper_match_index({
        "1": {"full_name": "James Cook", "position": "RB", "team": "BUF"},
        "2": {"full_name": "Tyler Bass", "position": "K", "team": "BUF"},
    })
    assert match_ffc_entry(
        {"name": "James Cook III", "position": "RB", "team": "BUF"}, index,
    ) == "1"
    assert match_ffc_entry(
        {"name": "Tyler Bass", "position": "PK", "team": "BUF"}, index,
    ) == "2"


def test_def_matching_applies_team_aliases_on_both_sides():
    # Sleeper DEF ids are canonical abbreviations (JAX); FFC historically uses JAC.
    index = build_sleeper_match_index({
        "JAX": {"position": "DEF", "team": "JAX"},
        "KC": {"position": "DEF", "team": "KC"},
    })
    assert normalize_team("JAC") == "JAX"
    assert match_ffc_entry(
        {"name": "Jaguars", "position": "DEF", "team": "JAC"}, index,
    ) == "JAX"
    assert match_ffc_entry(
        {"name": "Chiefs", "position": "DEF", "team": "KAN"}, index,
    ) == "KC"
    assert match_ffc_entry(
        {"name": "Jaguars", "position": "DEF", "team": "FA"}, index,
    ) is None


def test_normalize_position_strips_terminal_rank_suffix():
    assert normalize_position("WR1") == "WR"
    assert normalize_position("RB12") == "RB"
    assert normalize_position("QB") == "QB"


def test_normalize_position_applies_aliases_after_stripping_rank_suffix():
    assert normalize_position("DST23") == "DEF"
    assert normalize_position("PK") == "K"
    assert normalize_position("D/ST") == "DEF"
    assert normalize_position("DEFENSE") == "DEF"


def test_normalize_position_trims_and_uppercases():
    assert normalize_position(" wr1 ") == "WR"
    assert normalize_position("k") == "K"


def test_match_named_row_fa_resolves_by_name_and_position_without_team():
    index = build_sleeper_match_index({
        "2": {"full_name": "Free Agent Guy", "position": "RB", "team": None},
    })
    assert match_named_row("Free Agent Guy", "RB", None, index) == "2"


def test_normalize_ffc_position_delegates_without_changing_plain_ffc_tokens():
    # FFC never sends rank suffixes; plain tokens must stay byte-compatible
    # with the pre-generalization alias table for the ADP write path.
    assert normalize_ffc_position("PK") == "K"
    assert normalize_ffc_position("RB") == "RB"
    assert normalize_ffc_position("DEF") == "DEF"
