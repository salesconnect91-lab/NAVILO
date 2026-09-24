import tempfile
import unittest
from pathlib import Path

from check_migration_dependencies import audit


class MigrationDependencyAuditTests(unittest.TestCase):
    def _write(self, directory: Path, name: str, sql: str) -> None:
        (directory / name).write_text(sql)

    def test_missing_repaired_foundations_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            errors, _, _ = audit(Path(temporary))
            self.assertTrue(any(item.startswith("godowns:") for item in errors))
            self.assertTrue(any(item.startswith("warehouses:") for item in errors))

    def test_repaired_foundations_must_precede_consumers(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self._write(
                directory,
                "20260821170557_0002.sql",
                "create table categories(); create table uom(); create table warehouses(); "
                "create table godowns(); create table transporters();",
            )
            errors, resolved, missing = audit(directory)
            for table in ("categories", "uom", "warehouses", "godowns", "transporters"):
                self.assertFalse(any(item.startswith(f"{table}:") for item in errors))
            self.assertEqual(len([item for item in resolved if "20260821170557_0002.sql" in item]), 5)
            self.assertEqual(missing, [])

    def test_repository_has_no_known_missing_foundations(self):
        repository_migrations = Path(__file__).resolve().parents[1] / "supabase" / "migrations"
        errors, _, missing = audit(repository_migrations)
        self.assertEqual(errors, [])
        self.assertEqual(missing, [])

    def test_out_of_order_foundation_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self._write(directory, "20260901000000_late.sql", "create table public.godowns();")
            errors, _, _ = audit(directory)
            self.assertTrue(any(item.startswith("godowns: first CREATE TABLE") for item in errors))


if __name__ == "__main__":
    unittest.main()
