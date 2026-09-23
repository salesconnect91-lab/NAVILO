#!/usr/bin/env python3
"""Reject known SQL-export corruption tokens in local migrations."""

from pathlib import Path
import argparse
import re


FORBIDDEN_TOKENS = ("PKRPKR",)
PATCH_MARKER_STATEMENT = re.compile(
    r"^[+-](?:create|alter|drop|grant|revoke|do|insert|update|delete|comment)\b",
    re.IGNORECASE | re.MULTILINE,
)
MALFORMED_SINGLE_DOLLAR_OPEN = re.compile(
    r"\bas\s+\$(?!\$|[A-Za-z_][A-Za-z0-9_]*\$)", re.IGNORECASE
)
MALFORMED_SINGLE_DOLLAR_CLOSE = re.compile(r"^\s*\$;\s*$", re.MULTILINE)
UNTERMINATED_DOLLAR_BODY_BEFORE_SQL = re.compile(
    r"^\s*(?:\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$)\s*$\n"
    r"\s*(?=(?:revoke|grant|alter|create|drop|comment)\b)",
    re.IGNORECASE | re.MULTILINE,
)

REQUIRED_SNIPPETS = {
    "20260821170557_0002_steel_mill_extension.sql": (
        "ALTER TABLE public.items\n  ADD COLUMN IF NOT EXISTS warehouse_id uuid",
        "ALTER TABLE public.stock_movements\n  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE RESTRICT",
        "ADD COLUMN IF NOT EXISTS godown_id uuid REFERENCES public.godowns(id) ON DELETE RESTRICT",
        "warehouse_id uuid REFERENCES warehouses(id) ON DELETE RESTRICT",
        "godown_id uuid REFERENCES godowns(id) ON DELETE RESTRICT",
    ),
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
    "20260831010000_0026_harden_stock_engine.sql": (
        "apply_stock_movement is created and secured by the next migration (0027)",
    ),
    "20260831011500_0027_preserve_stock_return_types.sql": (
        "create or replace function public.apply_stock_movement(",
        "revoke all on function public.apply_stock_movement(",
        "grant execute on function public.apply_stock_movement(",
    ),
}


def inspect(directory: Path) -> list[str]:
    findings: list[str] = []
    for path in sorted(directory.glob("*.sql")):
        text = path.read_text(errors="replace")
        for token in FORBIDDEN_TOKENS:
            if token in text:
                findings.append(f"{path.name}: contains export-corruption token {token}")
        marker = PATCH_MARKER_STATEMENT.search(text)
        if marker:
            line = text.count("\n", 0, marker.start()) + 1
            findings.append(
                f"{path.name}:{line}: contains a stray diff marker before a SQL statement"
            )
        malformed_open = MALFORMED_SINGLE_DOLLAR_OPEN.search(text)
        malformed_close = MALFORMED_SINGLE_DOLLAR_CLOSE.search(text)
        if malformed_open or malformed_close:
            marker = malformed_open or malformed_close
            line = text.count("\n", 0, marker.start()) + 1
            findings.append(
                f"{path.name}:{line}: contains a malformed single-dollar function delimiter"
            )
        unterminated = UNTERMINATED_DOLLAR_BODY_BEFORE_SQL.search(text)
        if unterminated:
            line = text.count("\n", 0, unterminated.start()) + 1
            findings.append(
                f"{path.name}:{line}: dollar-quoted body is missing its statement semicolon"
            )
    for filename, snippets in REQUIRED_SNIPPETS.items():
        path = directory / filename
        if not path.exists():
            continue
        text = path.read_text(errors="replace")
        for snippet in snippets:
            if snippet not in text:
                findings.append(f"{filename}: missing required legacy foundation: {snippet}")
    early_acl = directory / "20260831010000_0026_harden_stock_engine.sql"
    if early_acl.exists() and "revoke all on function public.apply_stock_movement(" in early_acl.read_text(errors="replace"):
        findings.append(f"{early_acl.name}: ACL precedes apply_stock_movement creator in 0027")
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
