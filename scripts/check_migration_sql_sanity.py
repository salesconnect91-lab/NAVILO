#!/usr/bin/env python3
"""Reject known SQL-export corruption tokens in local migrations."""

from pathlib import Path
import argparse


FORBIDDEN_TOKENS = ("PKRPKR",)


def inspect(directory: Path) -> list[str]:
    findings: list[str] = []
    for path in sorted(directory.glob("*.sql")):
        text = path.read_text(errors="replace")
        for token in FORBIDDEN_TOKENS:
            if token in text:
                findings.append(f"{path.name}: contains export-corruption token {token}")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=Path("supabase/migrations"))
    args = parser.parse_args()
    findings = inspect(args.directory)
    for finding in findings:
        print(f"CORRUPT {finding}")
    print(f"SUMMARY {len(findings)} SQL export-corruption findings")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
