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


if __name__ == "__main__":
    unittest.main()
