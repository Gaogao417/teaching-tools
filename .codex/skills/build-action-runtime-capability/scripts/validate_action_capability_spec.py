#!/usr/bin/env python3
"""Validate an ActionCapabilitySpec structure, v2 binding, and lifecycle state."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


VALID_STATUSES = {"draft", "approved", "implemented", "verified"}
REQUIRED_FRONTMATTER = ("action_kind", "action_version", "runtime_model", "status", "requesting_topic")
REQUIRED_HEADINGS = (
    "Capability boundary",
    "Version decision",
    "Shared contract",
    "Frontend machine",
    "Backend evaluation",
    "Diagram effects and SolutionBoard isolation",
    "Mode and redaction",
    "Recovery and persistence",
    "Registry and authoring",
    "Implementation seams",
    "Verification plan",
    "Decisions requiring approval",
    "Verification evidence",
)
PLACEHOLDER_PATTERN = re.compile(r"replace-with|\bTODO\b", re.IGNORECASE)
KIND_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        raise ValueError("Spec must start with YAML frontmatter")
    end = text.find("\n---\n", 4)
    if end < 0:
        raise ValueError("Spec frontmatter is not closed with ---")
    values: dict[str, str] = {}
    for line in text[4:end].splitlines():
        match = re.match(r"^([a-zA-Z0-9_-]+):\s*(.*?)\s*$", line)
        if match:
            key, value = match.groups()
            values[key] = value.strip().strip("\"'")
    return values, text[end + 5 :]


def validate(path: Path, expected_status: str | None) -> list[str]:
    if not path.is_file():
        return [f"Spec does not exist: {path}"]
    try:
        frontmatter, body = parse_frontmatter(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        return [str(exc)]

    errors: list[str] = []
    for key in REQUIRED_FRONTMATTER:
        value = frontmatter.get(key, "").strip()
        if not value:
            errors.append(f"Missing frontmatter value: {key}")
        elif PLACEHOLDER_PATTERN.search(value):
            errors.append(f"Frontmatter value still contains a placeholder: {key}")

    kind = frontmatter.get("action_kind", "")
    if kind and not KIND_PATTERN.fullmatch(kind):
        errors.append("action_kind must use lowercase hyphen-case")
    version = frontmatter.get("action_version", "")
    if version and (not version.isdigit() or int(version) < 1):
        errors.append("action_version must be a positive integer")
    if frontmatter.get("runtime_model") != "action-runtime-v2":
        errors.append("runtime_model must be 'action-runtime-v2'")

    status = frontmatter.get("status", "")
    if status not in VALID_STATUSES:
        errors.append(f"Invalid status {status!r}; expected one of {sorted(VALID_STATUSES)}")
    if expected_status and status != expected_status:
        errors.append(f"Status is {status!r}, expected {expected_status!r}")

    headings = set(re.findall(r"^##\s+(.+?)\s*$", body, flags=re.MULTILINE))
    for heading in REQUIRED_HEADINGS:
        if heading not in headings:
            errors.append(f"Missing required heading: ## {heading}")

    if status in {"implemented", "verified"}:
        evidence = re.search(
            r"^## Verification evidence\s*$([\s\S]*?)(?=^##\s|\Z)",
            body,
            flags=re.MULTILINE,
        )
        evidence_text = evidence.group(1).strip() if evidence else ""
        if len(evidence_text) < 40 or "Complete after implementation" in evidence_text:
            errors.append("Implemented/verified spec requires concrete Verification evidence")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spec", type=Path)
    parser.add_argument("--expect-status", choices=sorted(VALID_STATUSES))
    args = parser.parse_args()
    errors = validate(args.spec, args.expect_status)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"OK: {args.spec} ({args.expect_status or 'valid lifecycle status'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
