#!/usr/bin/env python3
"""Reject explicit table/view/function DDL before its repository creator.

This is deliberately a conservative lexical gate, not a general SQL parser.
It covers object-resolution statements that caused the Phase 2B fresh-replay
failures: ALTER TABLE, policies, triggers, indexes, grants/revokes and function
ACL/ALTER statements. Dynamic SQL remains covered only by an actual replay.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re


RELATION_CREATE = re.compile(
    r"\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?(?:table|view)\s+"
    r"(?:if\s+not\s+exists\s+)?(?:public\.)?\"?([A-Za-z_][\w$]*)\"?",
    re.IGNORECASE,
)
FUNCTION_CREATE = re.compile(
    r"\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([A-Za-z_][\w$]*)\s*\(",
    re.IGNORECASE,
)
RELATION_CONSUMERS = tuple(
    re.compile(pattern, re.IGNORECASE | re.DOTALL)
    for pattern in (
        r"\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\.\"?([A-Za-z_][\w$]*)\"?",
        r"\bcreate\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?[^;\n]+?\bon\s+public\.\"?([A-Za-z_][\w$]*)\"?",
        r"\b(?:create|drop)\s+policy\s+[^;\n]+?\bon\s+public\.\"?([A-Za-z_][\w$]*)\"?",
        r"\b(?:create|drop)\s+trigger\s+[^;\n]+?\bon\s+public\.\"?([A-Za-z_][\w$]*)\"?",
        r"\b(?:grant|revoke)\s+[^;]+?\bon\s+(?:table\s+)?public\.\"?([A-Za-z_][\w$]*)\"?",
    )
)
FUNCTION_CONSUMERS = tuple(
    re.compile(pattern, re.IGNORECASE | re.DOTALL)
    for pattern in (
        r"\b(?:revoke|grant)[^;]{0,240}?\bon\s+function\s+public\.([A-Za-z_][\w$]*)\s*\(",
        r"\balter\s+function\s+public\.([A-Za-z_][\w$]*)\s*\(",
    )
)

# `accounts` is an optional read-only compatibility table. Its only explicit
# statements are guarded by to_regclass() blocks for legacy hosted installs;
# a genuinely fresh database intentionally has no creator.
OPTIONAL_LEGACY_RELATIONS = {"accounts"}


def _creators(files: list[Path], pattern: re.Pattern[str]) -> dict[str, tuple[str, int]]:
    result: dict[str, tuple[str, int]] = {}
    for path in files:
        text = path.read_text(errors="replace")
        for match in pattern.finditer(text):
            result.setdefault(match.group(1).lower(), (path.name, match.start()))
    return result


def audit(directory: Path) -> list[str]:
    files = sorted(directory.glob("*.sql"))
    relation_creators = _creators(files, RELATION_CREATE)
    function_creators = _creators(files, FUNCTION_CREATE)
    errors: list[str] = []
    seen: set[tuple[str, str, str]] = set()

    for path in files:
        text = path.read_text(errors="replace")
        for kind, patterns, creators in (
            ("relation", RELATION_CONSUMERS, relation_creators),
            ("function", FUNCTION_CONSUMERS, function_creators),
        ):
            for pattern in patterns:
                for match in pattern.finditer(text):
                    name = match.group(1).lower()
                    if kind == "relation" and name in OPTIONAL_LEGACY_RELATIONS:
                        continue
                    creator = creators.get(name)
                    consumer = (path.name, match.start())
                    if creator is not None and creator <= consumer:
                        continue
                    key = (kind, path.name, name)
                    if key in seen:
                        continue
                    seen.add(key)
                    provider = creator[0] if creator else "absent"
                    errors.append(f"{kind} {name}: consumed by {path.name}; creator {provider}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=Path("supabase/migrations"))
    args = parser.parse_args()
    errors = audit(args.directory)
    for error in errors:
        print(f"BROKEN {error}")
    print(f"SUMMARY {len(errors)} explicit object-order errors")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
