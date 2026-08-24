#!/usr/bin/env python
"""Layer D vintage retrieval: materialize a dated `data/` snapshot from git tags.

Layer D (PLAN.md "Evaluation layers") needs dated projection/ADP snapshots for
the 2026 season so engine recommendations can later be scored against actual
outcomes without hindsight contamination. The retention side is already covered
by `.github/workflows/refresh-data.yml`: every daily refresh commits the full
`data/` directory (with provenance manifests), and successful Monday refreshes
(or manual dispatches) are additionally marked with an annotated
``data-snapshots/YYYY-MM-DD`` tag. Git history is therefore the archive — this
script is the *retrieval* half: turn a tag back into a usable directory and a
human-readable summary of what it contains.

Design notes:
- No database. Snapshots are append-only JSON blobs in git; any future DB can
  ingest them trivially (`DECISIONS.md`, 2026-08-24).
- All git access goes through subprocess calls to the `git` binary; every pure
  function here (tag naming, manifest summarization) is tested against
  fixtures and the real committed `data/manifest.json` (test_retrieve_vintage.py).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
TAG_PREFIX = "data-snapshots/"
TREE_PATH = "data"
MANIFEST_RELPATH = "data/manifest.json"

_SNAPSHOT_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ---------------------------------------------------------------------------
# Pure helpers (no git, no network)
# ---------------------------------------------------------------------------

def snapshot_tag_name(d: date) -> str:
    """The annotated-tag name for a vintage dated `d`."""
    return f"{TAG_PREFIX}{d.isoformat()}"


def parse_snapshot_tag(tag: str) -> date | None:
    """Inverse of `snapshot_tag_name`. Returns None for non-vintage tags."""
    if not tag.startswith(TAG_PREFIX):
        return None
    rest = tag[len(TAG_PREFIX):]
    if not _SNAPSHOT_DATE_RE.match(rest):
        return None
    try:
        return date.fromisoformat(rest)
    except ValueError:
        return None


def summarize_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    """Reduce a build_data.py manifest.json to its vintage-relevant summary."""
    sources = manifest.get("sources", {}) or {}
    statuses: dict[str, int] = {}
    total_rows = 0
    per_source: dict[str, dict[str, Any]] = {}
    for name, src in sorted(sources.items()):
        src = src or {}
        status = str(src.get("status", "unknown"))
        statuses[status] = statuses.get(status, 0) + 1
        rows = src.get("rows")
        row_count = rows if isinstance(rows, int) else None
        if row_count is not None:
            total_rows += row_count
        per_source[name] = {
            "status": status,
            "rows": row_count,
            "fetchedAt": src.get("fetchedAt"),
        }
    return {
        "builtAt": manifest.get("builtAt"),
        "season": manifest.get("season"),
        "week": manifest.get("week"),
        "sourceCount": len(sources),
        "sourceStatuses": statuses,
        "totalSourceRows": total_rows,
        "sources": per_source,
    }


# ---------------------------------------------------------------------------
# Git-backed operations (thin, subprocess-only)
# ---------------------------------------------------------------------------

def _run_git(*args: str, binary_output: bool = False) -> Any:
    result = subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    )
    return result.stdout if binary_output else result.stdout.decode("utf-8")


def list_snapshot_tags() -> list[str]:
    """All existing vintage tags, oldest first."""
    out = _run_git(
        "tag", "--list", f"{TAG_PREFIX}*", "--sort=version:refname"
    ).splitlines()
    return [line.strip() for line in out if line.strip()]


def tagged_files(tag: str) -> list[str]:
    """Relative paths under data/ recorded at `tag`."""
    out = _run_git(
        "ls-tree", "-r", "--name-only", tag, "--", TREE_PATH
    ).splitlines()
    return [line.strip() for line in out if line.strip()]


def read_tagged_file(tag: str, relpath: str) -> bytes:
    """A single file's exact bytes as committed at `tag`."""
    return _run_git("show", f"{tag}:{relpath}", binary_output=True)


def materialize_vintage(tag: str, dest_dir: Path) -> tuple[list[str], str]:
    """Write every data/ file from `tag` into `dest_dir`.

    Returns (relative paths written, sha256 of the retrieved manifest.json).
    Never touches the working tree's own data/ directory.
    """
    relpaths = tagged_files(tag)
    if not relpaths:
        raise SystemExit(f"No {TREE_PATH}/ files found at tag '{tag}'.")
    manifest_sha256 = ""
    written: list[str] = []
    for relpath in relpaths:
        blob = read_tagged_file(tag, relpath)
        target = dest_dir / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(blob)
        written.append(relpath)
        if relpath == MANIFEST_RELPATH:
            manifest_sha256 = hashlib.sha256(blob).hexdigest()
    return written, manifest_sha256


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Retrieve a dated data/ vintage from a data-snapshots/<date> git "
            "tag (layer D retention; see DECISIONS.md 2026-08-24)."
        )
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="list available data-snapshots/* tags and exit",
    )
    parser.add_argument(
        "--date",
        help="vintage date (YYYY-MM-DD); resolves to data-snapshots/<date>",
    )
    parser.add_argument(
        "--dest",
        help="directory to write the vintage into (default: a fresh temp dir)",
    )
    args = parser.parse_args(argv)

    if args.list:
        tags = list_snapshot_tags()
        if not tags:
            print("No data-snapshots/* tags exist yet.")
            return 0
        for tag in tags:
            stamp = parse_snapshot_tag(tag)
            suffix = "" if stamp else "  (unparseable date)"
            print(f"{tag}{suffix}")
        return 0

    if not args.date:
        parser.error("either --list or --date YYYY-MM-DD is required")

    try:
        wanted = date.fromisoformat(args.date)
    except ValueError:
        parser.error("--date must be YYYY-MM-DD")

    tag = snapshot_tag_name(wanted)
    if not any(existing == tag for existing in list_snapshot_tags()):
        available = ", ".join(list_snapshot_tags()[-5:]) or "(none)"
        raise SystemExit(
            f"Tag '{tag}' does not exist. Most recent tags: {available}"
        )

    if args.dest:
        dest_dir = Path(args.dest)
        if dest_dir.exists():
            raise SystemExit(f"--dest '{dest_dir}' already exists; refusing.")
    else:
        dest_dir = Path(tempfile.mkdtemp(prefix="ffa-vintage-"))
    dest_dir.mkdir(parents=True, exist_ok=True)

    written, manifest_sha256 = materialize_vintage(tag, dest_dir)
    summary: dict[str, Any] | None = None
    manifest_path = dest_dir / MANIFEST_RELPATH
    if manifest_path.exists():
        summary = summarize_manifest(
            json.loads(manifest_path.read_text("utf-8"))
        )

    print(f"Vintage '{tag}' -> {dest_dir}")
    print(f"Files written: {len(written)} (manifest sha256 {manifest_sha256})")
    if summary:
        print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
