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


if __name__ == "__main__":
    unittest.main()
