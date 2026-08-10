#!/usr/bin/env python3
"""Validate the structure and lifecycle state of a TopicBlueprint Markdown file."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


VALID_STATUSES = {"draft", "approved", "implemented", "verified"}
REQUIRED_FRONTMATTER = ("topic_id", "content_id", "status", "source_explanation", "bank_sources")
REQUIRED_HEADINGS = (
    "Source mapping",
    "Teaching intent",
    "Topic registration",
    "User flow",
    "Action blueprint",
    "Geometry contract",
    "SolutionBoard",
    "Mode boundaries",
    "Question-bank compilation",
    "Verification plan",
    "Decisions requiring approval",
    "Verification evidence",
)
REQUIRED_ACTION_COLUMNS = (
    "Source step",
    "Disposition",
    "Goal",
    "Public input",
    "Private truth",
    "Evidence",
    "Diagram effect",
    "Board effect",
    "Submit boundary",
    "Mode behavior",
)
PLACEHOLDER_PATTERN = re.compile(r"replace-with|<topic|\bTODO\b", re.IGNORECASE)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        raise ValueError("Blueprint must start with YAML frontmatter")
    end = text.find("\n---\n", 4)
    if end < 0:
        raise ValueError("Blueprint frontmatter is not closed with ---")
    raw = text[4:end]
    values: dict[str, str] = {}
    active_list: str | None = None
    list_values: dict[str, list[str]] = {}
    for line in raw.splitlines():
        item = re.match(r"^\s+-\s+(.+?)\s*$", line)
        if item and active_list:
            list_values.setdefault(active_list, []).append(item.group(1).strip().strip('"\''))
            continue
        match = re.match(r"^([a-zA-Z0-9_-]+):\s*(.*?)\s*$", line)
        if not match:
            continue
        key, value = match.groups()
        value = value.strip().strip('"\'')
        values[key] = value
        active_list = key if not value else None
    for key, items in list_values.items():
        values[key] = ",".join(items)
    return values, text[end + 5 :]


def validate(path: Path, expected_status: str | None) -> list[str]:
    errors: list[str] = []
    if not path.is_file():
        return [f"Blueprint does not exist: {path}"]
    text = path.read_text(encoding="utf-8")
    try:
        frontmatter, body = parse_frontmatter(text)
    except ValueError as exc:
        return [str(exc)]

    for key in REQUIRED_FRONTMATTER:
        value = frontmatter.get(key, "").strip()
        if not value:
            errors.append(f"Missing frontmatter value: {key}")
        elif PLACEHOLDER_PATTERN.search(value):
            errors.append(f"Frontmatter value still contains a placeholder: {key}")

    status = frontmatter.get("status", "")
    if status not in VALID_STATUSES:
        errors.append(f"Invalid status {status!r}; expected one of {sorted(VALID_STATUSES)}")
    if expected_status and status != expected_status:
        errors.append(f"Status is {status!r}, expected {expected_status!r}")

    headings = set(re.findall(r"^##\s+(.+?)\s*$", body, flags=re.MULTILINE))
    for heading in REQUIRED_HEADINGS:
        if heading not in headings:
            errors.append(f"Missing required heading: ## {heading}")

    action_heading = re.search(
        r"^## Action blueprint\s*$([\s\S]*?)(?=^##\s|\Z)",
        body,
        flags=re.MULTILINE,
    )
    if action_heading:
        section = action_heading.group(1)
        table_header = next((line for line in section.splitlines() if line.lstrip().startswith("|")), "")
        normalized = table_header.replace("`", "")
        for column in REQUIRED_ACTION_COLUMNS:
            if column not in normalized:
                errors.append(f"Action blueprint table is missing column: {column}")
        data_rows = [
            line for line in section.splitlines()
            if line.lstrip().startswith("|") and "---" not in line and line != table_header
        ]
        if not data_rows:
            errors.append("Action blueprint must contain at least one action row")

    if status in {"implemented", "verified"}:
        evidence = re.search(
            r"^## Verification evidence\s*$([\s\S]*?)(?=^##\s|\Z)",
            body,
            flags=re.MULTILINE,
        )
        evidence_text = evidence.group(1).strip() if evidence else ""
        if len(evidence_text) < 40 or "Complete after implementation" in evidence_text:
            errors.append("Implemented/verified blueprint requires concrete Verification evidence")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("blueprint", type=Path)
    parser.add_argument("--expect-status", choices=sorted(VALID_STATUSES))
    args = parser.parse_args()
    errors = validate(args.blueprint, args.expect_status)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"OK: {args.blueprint} ({args.expect_status or 'valid lifecycle status'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
