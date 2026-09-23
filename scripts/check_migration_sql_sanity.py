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
    "20260908174200_enforce_sales_post_business_unit_scope.sql": (
        "IF to_regprocedure('public.post_sales_invoice_core(uuid)') IS NULL THEN",
        "ALTER FUNCTION public.post_sales_invoice(uuid)",
        "RENAME TO post_sales_invoice_core",
        "create or replace function public.post_sales_invoice(p_order_id uuid)",
    ),
    "20260906223502_control_manual_inventory_adjustments.sql": (
        "add column if not exists reason text",
        "add column if not exists remarks text",
        "add column if not exists unit_cost numeric",
        "add column if not exists source_type text",
        "add column if not exists source_id uuid",
        "create or replace function public.apply_stock_movement(",
        "perform public.assert_module_permission('inventory','edit')",
        "'manual_adjustment'",
    ),
    "20260906225648_secure_godown_transfer_with_approval_slip.sql": (
        "alter table public.stock_movements add column if not exists approval_slip_path text",
        "values('stock-transfer-approvals','stock-transfer-approvals'",
        "create or replace function public.transfer_stock_controlled(",
    ),
    "20260906230719_require_stock_adjustment_approval_slip.sql": (
        "values('stock-adjustment-approvals','stock-adjustment-approvals'",
        "create function public.manual_stock_adjustment(",
        "p_approval_slip_path text",
    ),
    "20260907074107_enable_controlled_cross_warehouse_stock_transfer.sql": (
        "p_to_warehouse_id uuid default null",
        "'warehouse_transfer'",
    ),
    "20260907074902_add_stock_transfer_numbers_v2.sql": (
        "alter table public.stock_movements add column if not exists transfer_no text",
        "create or replace function public.next_stock_transfer_no(",
    ),
    "20260914225847_restore_sales_post_tenant_user_resolution.sql": (
        "position('v_user_id := v_order.user_id;' in v_def)>0",
        "position('Invoice owner context is missing.' in v_def)>0",
        "position('company_id = public.current_company_id()' in v_def)>0",
        "position('business_unit_id = public.current_business_unit_id()' in v_def)>0",
        "if v_new=v_def then raise exception 'post_sales_invoice_core patch pattern did not match'; end if;",
        "if v_new<>v_def then execute v_new; end if;",
    ),
    "20260923180627_restore_live_core_accounting_rpcs.sql": (
        "CREATE OR REPLACE FUNCTION public.initialize_default_coa()",
        "uid uuid := public.legacy_data_user_id();",
        "cid uuid := public.current_company_id();",
        "PERFORM public.assert_module_permission('accounting', 'create');",
        "CREATE OR REPLACE FUNCTION public.post_journal_entry(p_entry_id uuid)",
        "PERFORM public.assert_module_permission('accounting', 'post');",
        "AND je.user_id = public.legacy_data_user_id()",
        "AND je.business_unit_id = public.current_business_unit_id()",
        "CREATE OR REPLACE FUNCTION public.reverse_manual_journal_entry",
        "perform public.assert_module_permission('accounting','post');",
        "and business_unit_id=v_unit for update",
        "revoke all on function public.post_journal_entry(uuid) from public, anon;",
        "grant execute on function public.post_journal_entry(uuid) to authenticated, service_role;",
    ),
    "20260923182230_restore_customer_supplier_account_foundation.sql": (
        "alter table public.customers\n  add column if not exists account_id uuid;",
        "alter table public.suppliers\n  add column if not exists account_id uuid;",
        "add constraint customers_account_id_fkey",
        "add constraint suppliers_account_id_fkey",
        "references public.chart_of_accounts(id);",
        "notify pgrst, 'reload schema';",
    ),
    "20260923183710_harden_polymorphic_trigger_row_contracts.sql": (
        "v_row jsonb := to_jsonb(NEW);",
        "v_no := coalesce(v_row ->> 'order_no', '');",
        "v_no := coalesce(v_row ->> 'invoice_no', '');",
        "if TG_TABLE_NAME = 'journal_entries' then",
        "elsif TG_TABLE_NAME = 'stock_movements' then",
        "revoke all on function public.apply_document_discount_total() from public, anon, authenticated;",
        "revoke all on function public.navilo_link_posting_traceability() from public, anon, authenticated;",
        "revoke all on function public.sync_commercial_transaction_link() from public, anon, authenticated;",
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
