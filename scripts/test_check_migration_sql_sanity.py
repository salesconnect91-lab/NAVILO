import tempfile
import unittest
from pathlib import Path

from check_migration_sql_sanity import inspect


class MigrationSqlSanityTests(unittest.TestCase):
    def test_valid_dollar_quoted_block_is_accepted(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260923000001_valid.sql").write_text("DO $$ BEGIN NULL; END $$;")
            self.assertEqual(inspect(directory), [])

    def test_currency_substitution_corruption_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260923000001_bad.sql").write_text("DO PKRPKR BEGIN NULL; END PKRPKR;")
            self.assertEqual(len(inspect(directory)), 1)

    def test_diff_marker_before_sql_statement_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260923000001_bad.sql").write_text(
                "+create or replace function public.bad() returns void language sql as $$ select $$;"
            )
            findings = inspect(directory)
            self.assertTrue(any("stray diff marker" in finding for finding in findings))

    def test_single_dollar_function_delimiter_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260923000001_bad.sql").write_text(
                "create function public.bad() returns int language sql as $ select 1 $;"
            )
            findings = inspect(directory)
            self.assertTrue(any("single-dollar" in finding for finding in findings))

    def test_dollar_body_without_statement_semicolon_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260923000001_bad.sql").write_text(
                "create function public.bad() returns int language sql as $fn$\n"
                "select 1;\n"
                "$fn$\n"
                "revoke all on function public.bad() from public;"
            )
            findings = inspect(directory)
            self.assertTrue(any("missing its statement semicolon" in finding for finding in findings))

    def test_incomplete_legacy_column_provider_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260824220000_0004_coa_foundation.sql").write_text(
                "ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS payment_mode text DEFAULT 'Cash';"
            )
            self.assertGreater(len(inspect(directory)), 0)

    def test_missing_item_warehouse_foundation_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260821170557_0002_steel_mill_extension.sql").write_text(
                "create table warehouses(id uuid);"
            )
            self.assertGreater(len(inspect(directory)), 0)

    def test_incomplete_stock_location_foundation_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260821170557_0002_steel_mill_extension.sql").write_text(
                "ALTER TABLE public.items\n  ADD COLUMN IF NOT EXISTS warehouse_id uuid;"
            )
            self.assertGreater(len(inspect(directory)), 0)

    def test_function_acl_before_creator_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260831010000_0026_harden_stock_engine.sql").write_text(
                "revoke all on function public.apply_stock_movement(uuid,uuid,uuid,text,numeric,text) from public;"
            )
            self.assertTrue(any("ACL precedes" in finding for finding in inspect(directory)))

    def test_sales_core_wrapper_must_be_replay_safe(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260908174200_enforce_sales_post_business_unit_scope.sql").write_text(
                "alter function public.post_sales_invoice(uuid) rename to post_sales_invoice_core;"
            )
            self.assertGreater(len(inspect(directory)), 0)

    def test_stock_approval_foundation_must_be_complete(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260906225648_secure_godown_transfer_with_approval_slip.sql").write_text(
                "alter table public.stock_movements add column if not exists approval_slip_path text;"
            )
            self.assertGreater(len(inspect(directory)), 0)

    def test_stock_movement_traceability_foundation_must_be_complete(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260906223502_control_manual_inventory_adjustments.sql").write_text(
                "alter table public.stock_movements add column if not exists source_type text;"
            )
            findings = inspect(directory)
            self.assertTrue(
                any("missing required legacy foundation" in finding for finding in findings)
            )

    def test_sales_core_dynamic_patch_must_accept_verified_final_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            filename = "20260914225847_restore_sales_post_tenant_user_resolution.sql"
            (directory / filename).write_text(
                "select pg_get_functiondef('public.post_sales_invoice_core(uuid)'::regprocedure);"
            )
            self.assertGreater(len(inspect(directory)), 0)

    def test_restored_core_accounting_rpcs_must_retain_tenant_guards(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            filename = "20260923180627_restore_live_core_accounting_rpcs.sql"
            (directory / filename).write_text(
                "CREATE OR REPLACE FUNCTION public.post_journal_entry(p_entry_id uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;"
            )
            findings = inspect(directory)
            self.assertTrue(
                any("missing required legacy foundation" in finding for finding in findings)
            )

    def test_party_account_foundation_requires_both_columns_and_foreign_keys(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            filename = "20260923182230_restore_customer_supplier_account_foundation.sql"
            (directory / filename).write_text(
                "alter table public.customers add column if not exists account_id uuid;"
            )
            findings = inspect(directory)
            self.assertTrue(
                any("missing required legacy foundation" in finding for finding in findings)
            )

    def test_polymorphic_trigger_patch_requires_row_shape_guards(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            filename = "20260923183710_harden_polymorphic_trigger_row_contracts.sql"
            (directory / filename).write_text(
                "create or replace function public.apply_document_discount_total() returns trigger language plpgsql as $$ begin return new; end $$;"
            )
            findings = inspect(directory)
            self.assertTrue(
                any("missing required legacy foundation" in finding for finding in findings)
            )

    def test_line_description_and_snapshot_order_repair_is_complete(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            filename = "20260923185524_restore_line_descriptions_and_prelock_snapshots.sql"
            (directory / filename).write_text(
                "alter table public.sales_order_lines add column if not exists description text;"
            )
            findings = inspect(directory)
            self.assertTrue(
                any("missing required legacy foundation" in finding for finding in findings)
            )

    def test_consolidated_descriptions_and_bu_costing_repair_is_complete(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            filename = "20260923190959_restore_consolidated_descriptions_and_bu_inventory_cost.sql"
            (directory / filename).write_text(
                "alter table public.consolidated_sales_invoice_lines "
                "add column if not exists description text;"
            )
            findings = inspect(directory)
            self.assertTrue(
                any("missing required legacy foundation" in finding for finding in findings)
            )

    def test_sales_charge_cost_and_journal_tenant_repair_is_complete(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            filename = "20260923193415_restore_sales_charge_cost_and_journal_tenant_scope.sql"
            (directory / filename).write_text(
                "alter table public.sales_order_charges "
                "add column if not exists cost_account_id uuid;"
            )
            findings = inspect(directory)
            self.assertTrue(
                any("missing required legacy foundation" in finding for finding in findings)
            )


if __name__ == "__main__":
    unittest.main()
