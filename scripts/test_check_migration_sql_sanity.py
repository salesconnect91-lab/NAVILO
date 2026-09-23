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


if __name__ == "__main__":
    unittest.main()
