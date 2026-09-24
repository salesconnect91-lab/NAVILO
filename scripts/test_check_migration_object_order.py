import tempfile
import unittest
from pathlib import Path

from check_migration_object_order import audit


class MigrationObjectOrderTests(unittest.TestCase):
    def test_missing_relation_and_function_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "001.sql").write_text(
                "alter table public.missing add column x int; "
                "revoke all on function public.later(uuid) from public;"
            )
            errors = audit(root)
            self.assertTrue(any("relation missing" in item for item in errors))
            self.assertTrue(any("function later" in item for item in errors))

    def test_later_creator_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "001.sql").write_text("alter function public.later(uuid) set search_path=public;")
            (root / "002.sql").write_text(
                "create function public.later(p_id uuid) returns void language sql as $$select$$;"
            )
            self.assertTrue(audit(root))

    def test_ordered_objects_pass(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "001.sql").write_text(
                "create table public.ready(id uuid); "
                "create function public.ready_fn(p_id uuid) returns void language sql as $$select$$;"
            )
            (root / "002.sql").write_text(
                "alter table public.ready add column name text; "
                "grant execute on function public.ready_fn(uuid) to authenticated;"
            )
            self.assertEqual(audit(root), [])


if __name__ == "__main__":
    unittest.main()

