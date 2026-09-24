#!/usr/bin/env python3
"""Read-only local migration filename integrity check.

Run before any isolated migration rehearsal. This intentionally never connects
to a database or rewrites migration history.
"""

from collections import defaultdict
from pathlib import Path
import argparse
import re


MISVERSIONED_FILENAMES = {
    "20260913103500_complete_transaction_branch_isolation.sql":
        "20260913073121_complete_transaction_branch_isolation_v2.sql",
    "20260913110500_enforce_operating_location_write_scope_globally.sql":
        "20260913073519_enforce_operating_location_write_scope_globally.sql",
    "20260913082000_index_branch_scoped_foreign_keys.sql":
        "20260913081611_index_branch_scoped_foreign_keys.sql",
}


def inspect(directory: Path) -> tuple[list[Path], dict[str, list[Path]]]:
    empty = []
    versions: dict[str, list[Path]] = defaultdict(list)
    for path in sorted(directory.glob("*.sql")):
        match = re.fullmatch(r"(\d{14})_(.+)\.sql", path.name)
        if match is None:
            raise ValueError(f"Unexpected migration filename: {path.name}")
        versions[match.group(1)].append(path)
        if path.stat().st_size == 0:
            empty.append(path)
    return empty, {key: paths for key, paths in versions.items() if len(paths) > 1}


def misversioned(directory: Path) -> list[tuple[str, str]]:
    """Reject the three branch-isolation filenames disproved by live history."""
    return [
        (old, correct)
        for old, correct in MISVERSIONED_FILENAMES.items()
        if (directory / old).exists()
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, nargs="?", default=Path("supabase/migrations"))
    args = parser.parse_args()
    empty, duplicates = inspect(args.directory)
    wrong_versions = misversioned(args.directory)
    for path in empty:
        print(f"EMPTY {path.name}")
    for version, paths in sorted(duplicates.items()):
        print(f"DUPLICATE {version}: {', '.join(path.name for path in paths)}")
    for old, correct in wrong_versions:
        print(f"MISVERSIONED {old}: exact live version is {correct}")
    print(
        f"SUMMARY {len(empty)} empty files; {len(duplicates)} duplicate version IDs; "
        f"{len(wrong_versions)} known misversioned files"
    )
    return 1 if empty or duplicates or wrong_versions else 0


if __name__ == "__main__":
    raise SystemExit(main())
