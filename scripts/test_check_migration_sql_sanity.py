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


if __name__ == "__main__":
    unittest.main()
