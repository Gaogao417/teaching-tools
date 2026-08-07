#!/usr/bin/env python3
"""Validate the structural gate for a topic experience specification."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


SCHEMA = "teaching-tools/topic-experience-spec/v1"
STATUSES = {"draft", "approved", "implemented", "verified"}
REQUIRED_HEADINGS = (
    "## 内容来源",
    "## 用户流程图",
    "## 页面结构",
    "## 交互规则",
    "## 页面状态说明",
    "## 待确认事项",
    "## 实现与验收记录",
)
COACH_MARKERS = ("陪练老师", "动态陪练", "填空辅助")
COACH_HEADING = "## 陪练讲题脚本"
COACH_TABLE_HEADER = "| 触发条件 | 学生已有结果 | 推理依据 | 严密讲解链 | 下一动作/填空 | 错误时如何解释 | 来源 |"


def parse_frontmatter(text: str) -> dict[str, str]:
    match = re.match(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", text, re.DOTALL)
    if not match:
        raise ValueError("missing YAML frontmatter")

    values: dict[str, str] = {}
    for line in match.group(1).splitlines():
        field = re.match(r"^([a-z_]+):\s*(.*?)\s*$", line)
        if field:
            values[field.group(1)] = field.group(2).strip('"\'')
    return values


def validate(path: Path, expected_status: str | None) -> list[str]:
    errors: list[str] = []
    if not path.is_file():
        return [f"specification does not exist: {path}"]

    text = path.read_text(encoding="utf-8")
    try:
        metadata = parse_frontmatter(text)
    except ValueError as error:
        return [str(error)]

    if metadata.get("schema") != SCHEMA:
        errors.append(f"schema must be {SCHEMA}")

    topic_id = metadata.get("topic_id", "")
    if not topic_id or topic_id == "replace-me":
        errors.append("topic_id must be set")

    status = metadata.get("status", "")
    if status not in STATUSES:
        errors.append(f"status must be one of: {', '.join(sorted(STATUSES))}")
    if expected_status and status != expected_status:
        errors.append(f"expected status {expected_status}, found {status or '<missing>'}")

    for heading in REQUIRED_HEADINGS:
        if heading not in text:
            errors.append(f"missing required heading: {heading}")

    if "```mermaid" not in text:
        errors.append("用户流程图 must contain a Mermaid diagram")

    has_coaching = any(marker in text for marker in COACH_MARKERS)
    if has_coaching and COACH_HEADING not in text:
        errors.append(f"coached experiences must contain: {COACH_HEADING}")
    if COACH_HEADING in text:
        coach_section = text.split(COACH_HEADING, 1)[1].split("\n## ", 1)[0]
        if COACH_TABLE_HEADER not in coach_section:
            errors.append("陪练讲题脚本 must use the required review table")
        coach_rows = [
            line for line in coach_section.splitlines()
            if line.startswith("|")
            and not line.startswith("| ---")
            and line != COACH_TABLE_HEADER
            and line.replace("|", "").strip()
        ]
        if not coach_rows:
            errors.append("陪练讲题脚本 must contain at least one script row")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("spec", type=Path)
    parser.add_argument("--expect-status", choices=sorted(STATUSES))
    args = parser.parse_args()

    errors = validate(args.spec, args.expect_status)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(f"OK: {args.spec} ({args.expect_status or 'valid status'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
