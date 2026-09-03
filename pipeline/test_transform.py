import pytest

from transform import (
    AdpEntry,
    PlayerMeta,
    SeasonProjection,
    apply_availability_to_projections,
    apply_nflverse_draft,
    apply_player_bye_weeks_to_adp,
    apply_status_overrides,
    backfill_bye_weeks_from_ids,
    build_adp_entries,
    build_ffc_cv_index,
    build_player_meta,
    build_season_projections,
    build_sleeper_adp_entries,
    fitted_stdev,
    fitted_stdev_for_player,
    fit_adp_cv_bands,
    parse_college,
    parse_height_inches,
    parse_jersey_number,
    parse_weight_lbs,
    per_player_cv,
    resolve_availability,
    SLEEPER_ADP_SENTINEL,
)


def test_fitted_stdev_matches_calibrated_bands():
    # Values measured live against the 2026 FFC PPR board (mean(sd/adp) per
    # band) -- see transform.py's _ADP_CV_BANDS docstring. Pin the boundary
    # behavior so a future edit can't silently drift the curve.
    assert fitted_stdev(6) == pytest.approx(6 * 0.247)
    assert fitted_stdev(18) == pytest.approx(18 * 0.169)
    assert fitted_stdev(36) == pytest.approx(36 * 0.124)
    assert fitted_stdev(100) == pytest.approx(100 * 0.112)


def test_first_non_empty_strips_padded_dynastyprocess_ids():
    from transform import _first_non_empty
    assert _first_non_empty(" 00-0035676") == "00-0035676"
    assert _first_non_empty(None, "  NA  ", " 00-0035640") == "00-0035640"
    assert _first_non_empty("  ", "NA") is None


def test_fitted_stdev_floor_applies_at_the_very_top_of_the_board():
    # adp=1 * 0.247 = 0.247, well under the observed floor -- the floor must win.
    assert fitted_stdev(1) == pytest.approx(0.7)


def test_fitted_stdev_is_monotonic_increasing_in_adp():
    values = [fitted_stdev(a) for a in (1, 5, 12, 24, 48, 100, 250)]
    assert values == sorted(values)


# ---------------------------------------------------------------------------
# Phase 2c H2: per-player FFC CV transfer (build_ffc_cv_index / per_player_cv
# / fitted_stdev_for_player), replacing the flat band constant for players
# FFC has actually observed. See benchmarks/reports/2026-08-20-ffc-survival-
# diagnosis-interpretation.md's H2 section for the finding this implements.
# ---------------------------------------------------------------------------


def _ffc_entry(player_id, adp, stdev, times_drafted=100):
    return AdpEntry(
        playerId=player_id, name="X", position="RB", team="XX",
        adp=adp, stdev=stdev, high=None, low=None, timesDrafted=times_drafted,
        byeWeek=None, adpSource="ffc", stdevSource="observed",
    )


def test_build_ffc_cv_index_keys_by_player_id_and_skips_unmatched_or_degenerate():
    entries = [
        _ffc_entry("a", adp=10.0, stdev=2.0, times_drafted=150),  # cv = 0.2
        _ffc_entry(None, adp=20.0, stdev=3.0),                     # no crosswalk match
        _ffc_entry("b", adp=0.0, stdev=3.0),                       # degenerate adp
        _ffc_entry("c", adp=30.0, stdev=0.0),                      # degenerate stdev
    ]
    index = build_ffc_cv_index(entries)
    assert set(index) == {"a"}
    cv, n = index["a"]
    assert cv == pytest.approx(0.2)
    assert n == 150


def test_per_player_cv_falls_back_to_band_when_no_ffc_match():
    # adp=6 -> top band, cv=0.247 (see test_fitted_stdev_matches_calibrated_bands)
    assert per_player_cv(6, "unmatched", {}) == pytest.approx(0.247)
    assert per_player_cv(6, None, {"other": (0.5, 200)}) == pytest.approx(0.247)


def test_per_player_cv_shrinks_toward_band_by_sample_size():
    # Top band constant is 0.247; observed cv 0.4 for this player.
    index = {"lightly_sampled": (0.4, 5), "heavily_sampled": (0.4, 5000)}
    light = per_player_cv(6, "lightly_sampled", index)
    heavy = per_player_cv(6, "heavily_sampled", index)
    # Both pulled toward 0.4 from the 0.247 band, but the heavily-sampled
    # player should sit much closer to the observed value.
    assert 0.247 < light < heavy < 0.4 + 1e-9
    assert heavy == pytest.approx(0.4, abs=0.01)
    assert light == pytest.approx(0.247, abs=0.03)


def test_per_player_cv_clamped_to_tolerance_band():
    # Band constant 0.247 (adp=6); an extreme, heavily-sampled observed cv of
    # 2.0 would shrink to ~2.0 with prior_n=50 and n=5000, but must clamp to
    # 2x the band constant (0.494) per the tolerance guard.
    index = {"extreme": (2.0, 5000)}
    assert per_player_cv(6, "extreme", index) == pytest.approx(0.247 * 2.0, abs=0.01)
    # Symmetric low-side clamp.
    index_low = {"extreme_low": (0.01, 5000)}
    assert per_player_cv(6, "extreme_low", index_low) == pytest.approx(0.247 * 0.5, abs=0.01)


def test_fitted_stdev_for_player_matches_fitted_stdev_when_no_index():
    # ffc_cv_index=None (or an index missing this player) must reproduce
    # fitted_stdev's original band-only output exactly -- a strict extension.
    for adp in (1, 6, 18, 36, 100, 250):
        assert fitted_stdev_for_player(adp, "some-player", None) == pytest.approx(fitted_stdev(adp))
        assert fitted_stdev_for_player(adp, "some-player", {}) == pytest.approx(fitted_stdev(adp))
        assert fitted_stdev_for_player(adp, None, {"other": (0.9, 500)}) == pytest.approx(fitted_stdev(adp))


def test_fitted_stdev_for_player_uses_per_player_cv_when_matched():
    index = {"p": (0.4, 5000)}  # heavily sampled, well above the 0.247 top-band constant
    result = fitted_stdev_for_player(6, "p", index)
    assert result > fitted_stdev(6)  # must diverge from the flat-band value
    assert result == pytest.approx(6 * per_player_cv(6, "p", index), abs=0.01)


def test_build_sleeper_adp_entries_uses_ffc_cv_index_when_provided():
    # adp=20 is well clear of the stdev floor, so the CV difference actually shows up.
    rows = [_row("9221", "Jahmyr", "Gibbs", "RB", "DET", adp_ppr=20.0)]
    ffc_cv_index = {"9221": (0.4, 5000)}  # well above the <=24 band's 0.169 constant
    entries, _ = build_sleeper_adp_entries(rows, "ppr", ffc_cv_index=ffc_cv_index)
    entry = entries[0]
    assert entry.stdev > fitted_stdev(20.0)
    assert entry.stdev == pytest.approx(fitted_stdev_for_player(20.0, "9221", ffc_cv_index), abs=1e-4)


def _row(player_id, first, last, position, team, adp_ppr=999.0, adp_std=999.0, adp_half_ppr=999.0, adp_2qb=999.0):

    return {
        "player_id": player_id,
        "player": {"first_name": first, "last_name": last, "position": position, "team": team},
        "stats": {
            "adp_ppr": adp_ppr,
            "adp_std": adp_std,
            "adp_half_ppr": adp_half_ppr,
            "adp_2qb": adp_2qb,
        },
    }


def test_build_sleeper_adp_entries_filters_the_999_sentinel():
    rows = [
        _row("1", "Real", "Player", "RB", "DAL", adp_ppr=12.5),
        _row("2", "No", "Sample", "WR", "SF", adp_ppr=999.0),  # sentinel -- must be dropped
    ]
    entries, diagnostics = build_sleeper_adp_entries(rows, "ppr")
    assert [e.playerId for e in entries] == ["1"]
    assert diagnostics["sampleSize"] == 1
    assert SLEEPER_ADP_SENTINEL == 900.0


def test_build_sleeper_adp_entries_native_player_id_and_fitted_stdev():
    rows = [_row("9221", "Jahmyr", "Gibbs", "RB", "DET", adp_ppr=1.6)]
    entries, _ = build_sleeper_adp_entries(rows, "ppr")
    entry = entries[0]
    assert isinstance(entry, AdpEntry)
    assert entry.playerId == "9221"  # native sleeper_id, no crosswalk needed
    assert entry.name == "Jahmyr Gibbs"
    assert entry.adpSource == "sleeper"
    assert entry.stdevSource == "fitted"
    assert entry.stdev == pytest.approx(fitted_stdev(1.6))
    # Sleeper's lobby carries no dispersion/sample-size fields -- these are
    # genuinely unknown (None), not zero.
    assert entry.high is None
    assert entry.low is None
    assert entry.timesDrafted is None
    assert entry.byeWeek is None


def test_build_sleeper_adp_entries_def_name_from_split_team_fields():
    # DEF rows split the team name across first_name/last_name (verified live:
    # {"first_name": "Los Angeles", "last_name": "Rams", "position": "DEF",
    # "player_id": "LAR"}), the same convention build_player_meta uses.
    rows = [_row("LAR", "Los Angeles", "Rams", "DEF", "LAR", adp_ppr=115.5)]
    entries, _ = build_sleeper_adp_entries(rows, "ppr")
    assert entries[0].playerId == "LAR"
    assert entries[0].name == "Los Angeles Rams"
    assert entries[0].position == "DEF"


def test_build_sleeper_adp_entries_sorts_ascending_by_adp():
    rows = [
        _row("2", "Second", "Overall", "WR", "SF", adp_ppr=5.0),
        _row("1", "First", "Overall", "RB", "DET", adp_ppr=1.0),
    ]
    entries, _ = build_sleeper_adp_entries(rows, "ppr")
    assert [e.playerId for e in entries] == ["1", "2"]


def test_build_sleeper_adp_entries_reads_the_requested_format_key():
    rows = [_row("1", "Only", "Std", "RB", "DAL", adp_ppr=999.0, adp_std=42.0)]
    ppr_entries, _ = build_sleeper_adp_entries(rows, "ppr")
    std_entries, _ = build_sleeper_adp_entries(rows, "standard")
    assert ppr_entries == []
    assert len(std_entries) == 1
    assert std_entries[0].adp == 42.0


def test_build_adp_entries_ffc_path_still_marks_observed_provenance():
    ffc_players = [
        {"name": "Test Player", "position": "RB", "team": "DAL", "adp": 10.0, "stdev": 2.0, "high": 5, "low": 15, "times_drafted": 100, "bye": 7},
    ]
    sleeper_index = {("test player", "RB"): "abc123"}
    entries, diagnostics = build_adp_entries(ffc_players, sleeper_index)
    assert entries[0].adpSource == "ffc"
    assert entries[0].stdevSource == "observed"
    assert entries[0].high == 5
    assert entries[0].low == 15
    assert entries[0].timesDrafted == 100
    assert diagnostics["sampleSize"] == 1

def test_fit_adp_cv_bands_uses_observed_ffc_spread_per_band_and_defaults_when_empty():
    entries = [
        AdpEntry("1", "Top", "RB", "BUF", 6, 1.5, 1, 8, 100, 7),
        AdpEntry("2", "Middle", "WR", "BUF", 18, 3.6, 10, 25, 100, 7),
    ]
    bands = fit_adp_cv_bands(entries)
    assert bands[0] == pytest.approx((12, 0.25))
    assert bands[1] == pytest.approx((24, 0.2))
    assert bands[2][1] == pytest.approx(0.124)


def _meta(player_id: str, *, bye: int | None) -> PlayerMeta:
    return PlayerMeta(
        playerId=player_id,
        name=player_id,
        position="RB",
        eligiblePositions=["RB"],
        team="BUF",
        byeWeek=bye,
        age=25,
        yearsExp=3,
        injuryStatus=None,
        depthChartPosition=None,
        depthChartOrder=None,
        injuryBodyPart=None,
        practiceParticipation=None,
        ids={},
    )


def test_bye_weeks_from_ids_fill_players_and_propagate_to_sleeper_adp():
    players = {"1": _meta("1", bye=None), "2": _meta("2", bye=9)}
    backfill_bye_weeks_from_ids(players, {"1": 7, "2": 5})
    # Existing FFC bye must win over a later FFToday value.
    assert players["1"].byeWeek == 7
    assert players["2"].byeWeek == 9

    entries = [
        AdpEntry(
            playerId="1", name="A", position="RB", team="BUF", adp=1.0, stdev=0.7,
            high=None, low=None, timesDrafted=None, byeWeek=None,
            adpSource="sleeper", stdevSource="fitted",
        ),
        AdpEntry(
            playerId="2", name="B", position="WR", team="DAL", adp=2.0, stdev=0.7,
            high=None, low=None, timesDrafted=None, byeWeek=None,
            adpSource="sleeper", stdevSource="fitted",
        ),
    ]
    apply_player_bye_weeks_to_adp(entries, players)
    assert entries[0].byeWeek == 7
    assert entries[1].byeWeek == 9


def test_parse_height_inches_accepts_inches_and_feet_strings():
    assert parse_height_inches("77") == 77
    assert parse_height_inches(77) == 77
    assert parse_height_inches("6'5\"") == 77
    assert parse_height_inches("6-5") == 77
    assert parse_height_inches("NA") is None
    assert parse_height_inches("") is None
    assert parse_weight_lbs("237") == 237
    assert parse_weight_lbs(90) is None
    assert parse_jersey_number("17") == 17
    assert parse_college("  Wyoming  ") == "Wyoming"
    assert parse_college("NA") is None


def test_build_player_meta_maps_sleeper_bio_fields():
    result = build_player_meta(
        {
            "4984": {
                "full_name": "Josh Allen",
                "position": "QB",
                "fantasy_positions": ["QB"],
                "team": "BUF",
                "age": 30,
                "years_exp": 8,
                "height": "77",
                "weight": "237",
                "college": "Wyoming",
                "number": 17,
            }
        },
        [],
    )["4984"]
    assert result.heightInches == 77
    assert result.weightLbs == 237
    assert result.college == "Wyoming"
    assert result.jerseyNumber == 17
    assert result.draftYear is None


def test_build_player_meta_maps_status_and_derates_exempt_availability():
    # The Josh Jacobs case: Sleeper's `status` field (roster status), not
    # `injury_status` (weekly game-day tag), is what carries "Exempt".
    result = build_player_meta(
        {
            "5850": {
                "full_name": "Josh Jacobs",
                "position": "RB",
                "fantasy_positions": ["RB"],
                "team": "GB",
                "status": "Exempt",
                "active": False,
                "injury_status": "Questionable",
            },
            "4984": {
                "full_name": "Josh Allen",
                "position": "QB",
                "fantasy_positions": ["QB"],
                "team": "BUF",
                "status": "Active",
                "active": True,
            },
        },
        [],
    )
    jacobs = result["5850"]
    assert jacobs.status == "Exempt"
    assert jacobs.active is False
    assert jacobs.availability == 0.0
    assert jacobs.availabilityReason == "Sleeper roster status: Exempt"

    allen = result["4984"]
    assert allen.status == "Active"
    assert allen.availability == 1.0
    assert allen.availabilityReason is None


def test_resolve_availability_only_derates_known_season_long_statuses():
    assert resolve_availability("Exempt") == (0.0, "Sleeper roster status: Exempt")
    assert resolve_availability("Suspended") == (0.0, "Sleeper roster status: Suspended")
    assert resolve_availability("Injured Reserve") == (0.0, "Sleeper roster status: Injured Reserve")
    # Day-to-day / ambiguous statuses are left alone — this is not a
    # second-guess of Questionable/Doubtful, and "Inactive" just means not
    # currently on any NFL roster, not injured.
    assert resolve_availability("Active") == (1.0, None)
    assert resolve_availability("Inactive") == (1.0, None)
    assert resolve_availability(None) == (1.0, None)
    assert resolve_availability("Some Future Status") == (1.0, None)


def test_apply_status_overrides_wins_over_feed_and_flags_stale_reviewby():
    players = {
        "5850": PlayerMeta(
            playerId="5850", name="Josh Jacobs", position="RB", eligiblePositions=["RB"],
            team="GB", byeWeek=11, age=28, yearsExp=7, injuryStatus="Questionable",
            depthChartPosition="RB", depthChartOrder=1, injuryBodyPart="Groin",
            practiceParticipation=None, ids={}, status="Active", active=True,
        ),
    }
    warnings = apply_status_overrides(
        players,
        [
            {
                "playerId": "5850",
                "status": "Exempt",
                "availability": 0,
                "reason": "Commissioner's Exempt List",
                "reviewBy": "2020-01-01",  # deliberately in the past
            },
            {"playerId": "unknown-id", "status": "Exempt", "availability": 0},
        ],
        today="2026-08-31",
    )
    jacobs = players["5850"]
    assert jacobs.status == "Exempt"
    assert jacobs.availability == 0.0
    assert jacobs.availabilityReason == "Commissioner's Exempt List"
    assert len(warnings) == 2
    assert "reviewBy date" in warnings[0]
    assert "unknown playerId" in warnings[1]


def test_apply_availability_to_projections_scales_stats_and_skips_full_availability():
    players = {
        "5850": PlayerMeta(
            playerId="5850", name="Derated", position="RB", eligiblePositions=["RB"],
            team="GB", byeWeek=None, age=28, yearsExp=7, injuryStatus=None,
            depthChartPosition=None, depthChartOrder=None, injuryBodyPart=None,
            practiceParticipation=None, ids={}, availability=0.0,
        ),
        "9999": PlayerMeta(
            playerId="9999", name="Healthy", position="RB", eligiblePositions=["RB"],
            team="DAL", byeWeek=None, age=25, yearsExp=3, injuryStatus=None,
            depthChartPosition=None, depthChartOrder=None, injuryBodyPart=None,
            practiceParticipation=None, ids={}, availability=1.0,
        ),
    }
    projections = [
        SeasonProjection(playerId="5850", source="fftoday", stats={"rush_yd": 1000.0, "rush_td": 10.0}),
        SeasonProjection(playerId="9999", source="fftoday", stats={"rush_yd": 500.0}),
    ]
    scaled = apply_availability_to_projections(projections, players)
    assert scaled == 1
    assert projections[0].stats == {"rush_yd": 0.0, "rush_td": 0.0}
    assert projections[1].stats == {"rush_yd": 500.0}


def test_apply_nflverse_draft_joins_on_gsis_and_skips_misses():
    players = {
        "1": PlayerMeta(
            playerId="1", name="Has Gsis", position="QB", eligiblePositions=["QB"],
            team="BUF", byeWeek=None, age=30, yearsExp=8, injuryStatus=None,
            depthChartPosition=None, depthChartOrder=None, injuryBodyPart=None,
            practiceParticipation=None, ids={"gsis": "00-0034857"},
        ),
        "2": PlayerMeta(
            playerId="2", name="No Gsis", position="RB", eligiblePositions=["RB"],
            team="DAL", byeWeek=None, age=24, yearsExp=2, injuryStatus=None,
            depthChartPosition=None, depthChartOrder=None, injuryBodyPart=None,
            practiceParticipation=None, ids={},
        ),
    }
    applied = apply_nflverse_draft(players, [
        {"gsis_id": " 00-0034857", "draft_year": 2018, "draft_round": 1, "draft_pick": 7},
        {"gsis_id": "00-other", "draft_year": 2020, "draft_round": 2, "draft_pick": 40},
    ])
    assert applied == 1
    assert players["1"].draftYear == 2018
    assert players["1"].draftRound == 1
    assert players["1"].draftPick == 7
    assert players["2"].draftYear is None


# --- build_season_projections --------------------------------------------------


def _proj_row(player_id, position="RB", company="rotowire", stats=None):
    return {
        "player_id": player_id,
        "player": {"first_name": "Test", "last_name": "Player", "position": position},
        "company": company,
        "stats": stats or {},
    }


def test_build_season_projections_filters_pool_and_strips_adp_keys():
    rows = [
        _proj_row("1", stats={"adp_ppr": 14.5, "rush_yd": 900, "rush_td": 8}),
        _proj_row("2", stats={"rush_yd": 700}),
        _proj_row("3", stats={"rush_yd": 300}),
        _proj_row("999", stats={"rush_yd": 999}),  # not in the valid pool
    ]
    projections = build_season_projections(rows, valid_player_ids={"1", "2", "3"})
    assert [p.playerId for p in projections] == ["1", "2", "3"]
    # adp_* keys are stripped; source is the company field ("rotowire" for Sleeper).
    assert projections[0].stats == {"rush_yd": 900, "rush_td": 8}
    assert projections[0].source == "rotowire"


def test_build_season_projections_drops_rows_without_meaningful_stats():
    rows = [
        _proj_row("1", stats={"rush_yd": 900}),
        _proj_row("2", stats={"adp_ppr": 5.0}),  # cleans to {} after adp* stripping
        _proj_row("3", stats={"rush_yd": 0}),     # all-zero is not a projection
    ]
    projections = build_season_projections(rows, valid_player_ids={"1", "2", "3"})
    assert [p.playerId for p in projections] == ["1"]


def test_build_season_projections_coerces_int_player_ids():
    projections = build_season_projections(
        [{"player_id": 1, "stats": {"rush_yd": 100}}],
        valid_player_ids={"1"},
    )
    assert [p.playerId for p in projections] == ["1"]

