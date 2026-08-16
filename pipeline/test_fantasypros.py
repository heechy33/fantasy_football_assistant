import pytest

from fantasypros import (
    FANTASYPROS_STARS_SCHEMA_VERSION,
    build_stars_artifact,
    parse_rankings_csv,
    parse_signed_int,
    parse_star,
)
from match import build_sleeper_match_index

_HEADER = "RK,TIERS,PLAYER NAME,TEAM,POS,UPSIDE ,BUST ,SOS SEASON,ECR VS. ADP"


def _csv(*rows: str) -> str:
    return "\n".join((_HEADER, *rows)) + "\n"


def _index():
    return build_sleeper_match_index(
        {
            "1": {"full_name": "Ja'Marr Chase", "position": "WR", "team": "CIN"},
            "2": {"full_name": "Free Agent Guy", "position": "RB", "team": None},
            "JAX": {"position": "DEF", "team": "JAX"},
        }
    )


# --- parse_star ------------------------------------------------------------


def test_parse_star_accepts_all_shapes():
    assert parse_star("1 out of 5") == 1
    assert parse_star("5 out of 5") == 5
    assert parse_star("3 out of 5 stars") == 3
    assert parse_star("0 out of 5 stars", allow_zero=True) == 0


def test_parse_star_null_blank_and_dash_are_missing():
    assert parse_star(None) is None
    assert parse_star("") is None
    assert parse_star("-") is None


def test_parse_star_rejects_invalid_syntax_and_range():
    with pytest.raises(ValueError):
        parse_star("6 out of 5")
    with pytest.raises(ValueError):
        parse_star("great")
    with pytest.raises(ValueError):
        parse_star("5/5")


def test_parse_star_zero_only_permitted_when_allowed():
    with pytest.raises(ValueError):
        parse_star("0 out of 5")
    assert parse_star("0 out of 5 stars", allow_zero=True) == 0


# --- parse_signed_int --------------------------------------------------------


def test_parse_signed_int_handles_signed_values_and_dash_trap():
    assert parse_signed_int("+2") == 2
    assert parse_signed_int("-163") == -163
    assert parse_signed_int("0") == 0
    assert parse_signed_int("-") is None
    assert parse_signed_int(None) is None
    assert parse_signed_int("") is None


# --- parse_rankings_csv -------------------------------------------------------


def test_parse_rankings_csv_accepts_trailing_space_headers_after_utf8_sig_decode():
    # BOM stripping belongs at the CLI/file boundary (`utf-8-sig`); this test only
    # proves the decoded text still matches the exact trailing-space headers.
    raw_bytes = _csv(
        "1,1,Ja'Marr Chase,CIN,WR1,5 out of 5,1 out of 5,4 out of 5 stars,+2",
    ).encode("utf-8-sig")
    text = raw_bytes.decode("utf-8-sig")
    rows, diagnostics = parse_rankings_csv(text)
    assert len(rows) == 1
    assert diagnostics["rows"] == 1
    assert rows[0].position_rank == "WR1"
    assert rows[0].position == "WR"


def test_parse_rankings_csv_accepts_current_export_header_with_bye_week():
    # The real 2026-08-15 export carries a "BYE WEEK" column between POS and
    # UPSIDE that the parser tolerates (BYE isn't a required/read column).
    current_header = "RK,TIERS,PLAYER NAME,TEAM,POS,BYE WEEK,UPSIDE ,BUST ,SOS SEASON,ECR VS. ADP"
    text = "\n".join((
        current_header,
        "1,1,Ja'Marr Chase,CIN,WR1,6,5 out of 5,1 out of 5,4 out of 5 stars,+2",
        "AD,,Sponsored,,,-,-,-,-,-",
    )) + "\n"
    rows, diagnostics = parse_rankings_csv(text)
    assert len(rows) == 1
    assert diagnostics["droppedNonRankRows"] == 1
    assert rows[0].position_rank == "WR1"
    assert rows[0].upside == 5
    assert rows[0].bust == 1
    assert rows[0].sos == 4
    assert rows[0].ecr_vs_adp == 2


def test_parse_rankings_csv_rejects_header_drift():
    bad_header = _HEADER.replace("UPSIDE ", "UPSIDE")
    with pytest.raises(ValueError):
        parse_rankings_csv(bad_header + "\n1,1,X,CIN,WR,-,-,-,-\n")


def test_parse_rankings_csv_drops_and_counts_ad_junk_rows():
    text = _csv(
        "AD,,Sponsored,,,-,-,-,-",
        "1,1,Ja'Marr Chase,CIN,WR1,5 out of 5,1 out of 5,4 out of 5 stars,+2",
        "AD,,Sponsored 2,,,-,-,-,-",
    )
    rows, diagnostics = parse_rankings_csv(text)
    assert len(rows) == 1
    assert diagnostics["droppedNonRankRows"] == 2
    assert diagnostics["rowsScanned"] == 3


def test_parse_rankings_csv_normalizes_rank_suffixed_and_dst_positions():
    text = _csv(
        "1,1,Ja'Marr Chase,CIN,WR1,5 out of 5,1 out of 5,4 out of 5 stars,+2",
        "2,3,Jaguars,JAC,DST23,-,-,3 out of 5 stars,-",
    )
    rows, _ = parse_rankings_csv(text)
    assert rows[0].position == "WR"
    assert rows[1].position == "DEF"
    assert rows[1].position_rank == "DST23"
    assert rows[1].team == "JAX"


def test_parse_rankings_csv_rejects_non_integer_rank():
    with pytest.raises(ValueError, match="non-integer RK"):
        parse_rankings_csv(_csv("AD,,Sponsored,,,-,-,-,-", "nope,1,X,CIN,WR,-,-,-,-"))


def test_parse_rankings_csv_blank_tier_becomes_none():
    rows, _ = parse_rankings_csv(
        _csv("1,,Ja'Marr Chase,CIN,WR1,5 out of 5,1 out of 5,4 out of 5 stars,+2")
    )
    assert rows[0].tier is None


def test_parse_rankings_csv_handles_fa_rows():
    text = _csv("3,4,Free Agent Guy,FA,RB12,-,-,2 out of 5 stars,-")
    rows, _ = parse_rankings_csv(text)
    assert rows[0].team is None
    assert rows[0].position == "RB"


# --- build_stars_artifact ---------------------------------------------------


def test_build_stars_artifact_matches_and_retains_unmatched():
    text = _csv(
        "AD,,Sponsored,,,-,-,-,-",
        "1,1,Ja'Marr Chase,CIN,WR1,5 out of 5,1 out of 5,4 out of 5 stars,+2",
        "2,3,Jaguars,JAC,DST23,-,-,3 out of 5 stars,-",
        "3,4,Free Agent Guy,FA,RB12,-,-,2 out of 5 stars,-",
        "4,4,Nobody Special,NYG,WR9,1 out of 5,3 out of 5,2 out of 5 stars,-5",
    )
    rows, diagnostics = parse_rankings_csv(text)
    artifact = build_stars_artifact(
        rows,
        _index(),
        season=2026,
        source_file="/tmp/local/FantasyPros_2026_Draft_ALL_Rankings.csv",
        generated_at="2026-08-12T00:00:00Z",
        dropped_non_rank_rows=diagnostics["droppedNonRankRows"],
    )

    assert artifact["schemaVersion"] == FANTASYPROS_STARS_SCHEMA_VERSION
    assert artifact["source"]["file"] == "FantasyPros_2026_Draft_ALL_Rankings.csv"
    assert artifact["source"]["droppedNonRankRows"] == 1
    assert artifact["source"]["rows"] == diagnostics["rows"] == 4
    assert artifact["source"]["matched"] == 3
    assert artifact["source"]["unmatched"] == 1
    assert artifact["source"]["matched"] + artifact["source"]["unmatched"] == artifact["source"]["rows"]
    assert artifact["source"]["matched"] == len(artifact["players"])
    assert len(artifact["unmatched"]) == 1
    assert artifact["unmatched"][0]["name"] == "Nobody Special"

    chase = artifact["players"]["1"]
    assert chase["upside"] == 5
    assert chase["bust"] == 1
    assert chase["sos"] == 4
    assert chase["ecrVsAdp"] == 2
    assert chase["positionRank"] == "WR1"

    jaguars = artifact["players"]["JAX"]
    assert jaguars["sos"] == 3


def test_build_stars_artifact_duplicate_sleeper_match_goes_to_unmatched():
    # Two ranked rows that resolve to the same sleeper id must not overwrite
    # each other out of the artifact — that would break matched+unmatched==rows.
    text = _csv(
        "1,1,Ja'Marr Chase,CIN,WR1,5 out of 5,1 out of 5,4 out of 5 stars,+2",
        "2,1,Ja'Marr Chase,CIN,WR2,4 out of 5,2 out of 5,3 out of 5 stars,+1",
    )
    rows, _ = parse_rankings_csv(text)
    artifact = build_stars_artifact(
        rows,
        _index(),
        season=2026,
        source_file="FantasyPros_2026_Draft_ALL_Rankings.csv",
        generated_at="2026-08-12T00:00:00Z",
    )

    assert artifact["source"]["matched"] == 1
    assert artifact["source"]["unmatched"] == 1
    assert artifact["source"]["matched"] + artifact["source"]["unmatched"] == artifact["source"]["rows"]
    assert artifact["players"]["1"]["rank"] == 1
    assert artifact["unmatched"][0]["rank"] == 2
    assert artifact["unmatched"][0]["name"] == "Ja'Marr Chase"