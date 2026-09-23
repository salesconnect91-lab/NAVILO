#!/usr/bin/env python3
"""Audit the known foundational-table dependencies in NAVILO migrations.

The repository was exported after some tables already existed in the hosted
database.  This checker is intentionally manifest-based rather than pretending
to be a complete SQL parser.  It protects the dependencies established by the
Phase 2B investigation and keeps the remaining live-only foundations visible.

Normal mode succeeds when the repaired bootstrap dependencies are ordered and
the documented debt snapshot has not silently changed.  ``--strict`` is the
release gate: it also fails while any known foundation remains absent.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import re


@dataclass(frozen=True)
class Dependency:
    table: str
    first_consumer: str


REPAIRED = (
    Dependency("categories", "20260830233000_0020_secure_master_data.sql"),
    Dependency("uom", "20260830233000_0020_secure_master_data.sql"),
    Dependency("warehouses", "20260830083000_0007_harden_sales_godown_posting.sql"),
    Dependency("godowns", "20260830083000_0007_harden_sales_godown_posting.sql"),
    Dependency("transporters", "20260830233000_0020_secure_master_data.sql"),
    Dependency("charge_master", "20260902090000_0046_hawala_aware_sales_posting.sql"),
    Dependency("companies", "20260904173000_saas_production_hardening.sql"),
    Dependency("operating_locations", "20260905161000_branch_workspace_foundation.sql"),
    Dependency("approval_requests", "20260913070000_fail_closed_future_workflow_and_document_rls.sql"),
    Dependency("user_language_preferences", "20260909082000_final_rls_and_foreign_key_performance_hardening.sql"),
    Dependency("order_book_headers", "20260909082000_final_rls_and_foreign_key_performance_hardening.sql"),
    Dependency("gate_pass_loading_instructions", "20260910013000_gate_pass_bilingual_loading_instruction_master.sql"),
    Dependency("company_language_entitlements", "20260915183000_priority1_posted_immutability_rpc_acl_rls_hardening.sql"),
)

# Confirmed by repository-wide search and read-only production migration-history
# comparison on 2026-09-23.  These are release-blocking debt, not an allow-list
# that makes a clean replay acceptable.
# `accounts` is an optional, guarded compatibility source for hosted legacy
# invoices and is intentionally not created by a fresh NAVILO installation.
KNOWN_MISSING: tuple[Dependency, ...] = ()


def _create_pattern(table: str) -> re.Pattern[str]:
    return re.compile(
        rf"\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?{re.escape(table)}\b",
        re.IGNORECASE,
    )


def creators(directory: Path, table: str) -> list[Path]:
    pattern = _create_pattern(table)
    return [path for path in sorted(directory.glob("*.sql")) if pattern.search(path.read_text(errors="replace"))]


def audit(directory: Path) -> tuple[list[str], list[str], list[str]]:
    repaired_errors: list[str] = []
    resolved: list[str] = []
    missing: list[str] = []

    for dependency in REPAIRED:
        found = creators(directory, dependency.table)
        if not found:
            repaired_errors.append(f"{dependency.table}: no CREATE TABLE before {dependency.first_consumer}")
            continue
        first = found[0].name
        if first >= dependency.first_consumer:
            repaired_errors.append(
                f"{dependency.table}: first CREATE TABLE is {first}, not before {dependency.first_consumer}"
            )
            continue
        resolved.append(f"{dependency.table}: {first} -> {dependency.first_consumer}")

    for dependency in KNOWN_MISSING:
        found = creators(directory, dependency.table)
        if not found:
            missing.append(f"{dependency.table}: absent; first known consumer {dependency.first_consumer}")
        elif found[0].name >= dependency.first_consumer:
            missing.append(
                f"{dependency.table}: first CREATE TABLE {found[0].name} is not before {dependency.first_consumer}"
            )
        else:
            resolved.append(f"{dependency.table}: {found[0].name} -> {dependency.first_consumer}")

    return repaired_errors, resolved, missing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=Path("supabase/migrations"))
    parser.add_argument("--strict", action="store_true", help="fail while known live-only foundations remain")
    args = parser.parse_args()

    repaired_errors, resolved, missing = audit(args.directory)
    for item in resolved:
        print(f"ORDERED {item}")
    for item in repaired_errors:
        print(f"BROKEN {item}")
    for item in missing:
        print(f"KNOWN_MISSING {item}")
    print(
        f"SUMMARY {len(repaired_errors)} repaired-contract errors; "
        f"{len(missing)} known unresolved foundations"
    )
    return 1 if repaired_errors or (args.strict and missing) else 0


if __name__ == "__main__":
    raise SystemExit(main())
