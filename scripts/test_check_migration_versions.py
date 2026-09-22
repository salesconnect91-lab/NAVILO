import tempfile
import unittest
from pathlib import Path

from check_migration_versions import inspect


class MigrationFilenameAuditTests(unittest.TestCase):
    def test_unique_nonempty_files_are_accepted(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260922000001_first.sql").write_text("select 1;")
            (directory / "20260922000002_second.sql").write_text("select 2;")
            self.assertEqual(inspect(directory), ([], {}))

    def test_duplicate_version_and_empty_file_are_detected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "20260922000001_first.sql").write_text("select 1;")
            (directory / "20260922000001_second.sql").write_text("")
            empty, duplicates = inspect(directory)
            self.assertEqual([file.name for file in empty], ["20260922000001_second.sql"])
            self.assertEqual(len(duplicates["20260922000001"]), 2)


if __name__ == "__main__":
    unittest.main()
