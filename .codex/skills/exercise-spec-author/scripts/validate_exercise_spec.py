#!/usr/bin/env python3
"""Validate a learning spec produced by exercise-spec-author."""

from __future__ import annotations

import re
import sys
from pathlib import Path


REQUIRED_FRONTMATTER = {
    "spec_version",
    "spec_kind",
    "working_title",
    "grade_band",
    "topic_or_chapter",
    "target_concept",
    "primary_skill_unit",
    "related_skill_units",
    "learning_mode",
    "prototype_candidate",
    "fit_level",
    "difficulty",
    "estimated_minutes",
    "step_mode",
    "repo_mapping_ready",
}

REQUIRED_SECTIONS = [
    "## 1. Spec Summary",
    "## 2. Skill Unit Definition",
    "## 3. Learning Role and Experience",
    "## 4. Learner Flow",
    "## 5. Workspace and UI Requirements",
    "## 6. Evaluation and Feedback",
    "## 7. Variants and Constraints",
    "## 8. Review Checklist",
    "## Appendix A. Repo Mapping",
]

SPEC_KINDS = {"skill-unit", "example", "exercise-pack"}
LEARNING_MODES = {"example", "exercise", "not-applicable"}
FIT_LEVELS = {"supported", "stretch", "new-tool-needed", "not-applicable"}
STEP_MODES = {"single-step", "multi-step", "not-applicable"}
REPO_MAPPING_READY = {"yes", "partial", "no"}


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        raise ValueError("missing YAML frontmatter opening line '---'")

    match = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.DOTALL)
    if not match:
        raise ValueError("frontmatter block is not closed with '---'")

    raw_frontmatter, body = match.groups()
    fields: dict[str, str] = {}
    for line in raw_frontmatter.splitlines():
        if not line.strip():
            continue
        if ":" not in line:
            raise ValueError(f"invalid frontmatter line: {line}")
        key, value = line.split(":", 1)
        fields[key.strip()] = value.strip()
    return fields, body


def validate(path: Path) -> list[str]:
    errors: list[str] = []
    text = path.read_text(encoding="utf-8")

    try:
        frontmatter, body = parse_frontmatter(text)
    except ValueError as exc:
        return [str(exc)]

    missing = sorted(REQUIRED_FRONTMATTER - frontmatter.keys())
    if missing:
        errors.append(f"missing frontmatter keys: {', '.join(missing)}")

    spec_kind = frontmatter.get("spec_kind", "")
    if spec_kind and spec_kind not in SPEC_KINDS:
        errors.append(f"spec_kind must be one of: {', '.join(sorted(SPEC_KINDS))}")

    learning_mode = frontmatter.get("learning_mode", "")
    if learning_mode and learning_mode not in LEARNING_MODES:
        errors.append(
            f"learning_mode must be one of: {', '.join(sorted(LEARNING_MODES))}"
        )

    fit_level = frontmatter.get("fit_level", "")
    if fit_level and fit_level not in FIT_LEVELS:
        errors.append(f"fit_level must be one of: {', '.join(sorted(FIT_LEVELS))}")

    step_mode = frontmatter.get("step_mode", "")
    if step_mode and step_mode not in STEP_MODES:
        errors.append(f"step_mode must be one of: {', '.join(sorted(STEP_MODES))}")

    repo_mapping_ready = frontmatter.get("repo_mapping_ready", "")
    if repo_mapping_ready and repo_mapping_ready not in REPO_MAPPING_READY:
        errors.append(
            f"repo_mapping_ready must be one of: {', '.join(sorted(REPO_MAPPING_READY))}"
        )

    for section in REQUIRED_SECTIONS:
        if section not in body:
            errors.append(f"missing section heading: {section}")

    appendix_b_present = "## Appendix B. Tooling Gap" in body
    if fit_level in {"stretch", "new-tool-needed"} and not appendix_b_present:
        errors.append("Appendix B. Tooling Gap is required when fit_level is not supported")

    return errors


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: validate_exercise_spec.py <spec.md>", file=sys.stderr)
        return 2

    path = Path(argv[1])
    if not path.exists():
        print(f"file not found: {path}", file=sys.stderr)
        return 2

    errors = validate(path)
    if errors:
        print("[FAIL] learning spec validation failed")
        for error in errors:
            print(f"- {error}")
        return 1

    print("[OK] learning spec is structurally valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))