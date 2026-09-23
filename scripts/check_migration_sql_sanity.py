#!/usr/bin/env python3
"""Reject known SQL-export corruption tokens in local migrations."""

from pathlib import Path
import argparse


FORBIDDEN_TOKENS = ("PKRPKR",)

REQUIRED_SNIPPETS = {
    "20260824220000_0004_coa_foundation.sql": (
        "ALTER TABLE public.journal_entries\n  ADD COLUMN IF NOT EXISTS payment_mode",
        "ADD COLUMN IF NOT EXISTS payment_mode text DEFAULT 'Cash'",
        "ALTER TABLE public.journal_lines\n  ADD COLUMN IF NOT EXISTS party_name text",
        "ADD COLUMN IF NOT EXISTS party_type text",
        "ADD COLUMN IF NOT EXISTS party_id uuid",
        "ALTER TABLE public.sales_orders\n  ADD COLUMN IF NOT EXISTS customer_account_id uuid",
        "ADD COLUMN IF NOT EXISTS customer_account_id uuid",
        "ADD COLUMN IF NOT EXISTS sales_person_account_id uuid",
        "ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'Credit'",
        "ADD COLUMN IF NOT EXISTS payment_account_id uuid",
    ),
}


def inspect(directory: Path) -> list[str]:
    findings: list[str] = []
    for path in sorted(directory.glob("*.sql")):
        text = path.read_text(errors="replace")
        for token in FORBIDDEN_TOKENS:
            if token in text:
                findings.append(f"{path.name}: contains export-corruption token {token}")
    for filename, snippets in REQUIRED_SNIPPETS.items():
        path = directory / filename
        if not path.exists():
            continue
        text = path.read_text(errors="replace")
        for snippet in snippets:
            if snippet not in text:
                findings.append(f"{filename}: missing required legacy foundation: {snippet}")
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
