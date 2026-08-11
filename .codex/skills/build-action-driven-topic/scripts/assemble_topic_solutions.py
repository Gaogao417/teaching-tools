#!/usr/bin/env python3
"""Assemble complete first/middle/last SolutionBoard samples from generated canonical truth."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


SLOT_PATTERN = re.compile(r"\{\{([a-zA-Z0-9._-]+)\}\}")
UI_LANGUAGE = re.compile(r"点击|输入|按钮|当前动作|系统会|告诉老师")


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def text(value: Any) -> str | None:
    if value is None:
        return None
    result = str(value).strip()
    return result or None


def render_template(template: str, slot_values: dict[str, str]) -> tuple[str, list[str]]:
    missing: list[str] = []

    def replace(match: re.Match[str]) -> str:
        slot_id = match.group(1)
        value = slot_values.get(slot_id)
        if value is None:
            missing.append(slot_id)
            return match.group(0)
        inside_math = template[: match.start()].count("$") % 2 == 1
        if inside_math and value.startswith("$") and value.endswith("$"):
            return value[1:-1]
        return value

    return SLOT_PATTERN.sub(replace, template), missing


def assemble(record: dict[str, Any]) -> tuple[list[str], list[str]]:
    prompt = as_dict(record.get("promptData"))
    board = as_dict(prompt.get("solutionBoard"))
    errors: list[str] = []

    rendered: list[str] = []
    heading = text(board.get("headingLatex")) or "解："
    rendered.append(heading)
    for expression in as_list(board.get("expressions")):
        if not isinstance(expression, dict):
            errors.append("solutionBoard.expressions contains a non-object entry")
            continue
        template = text(expression.get("latexTemplate")) or ""
        line, missing = render_template(template, {})
        if missing:
            errors.append(f"{expression.get('expressionId')}: unresolved slots {', '.join(sorted(set(missing)))}")
        rendered.append(line)
    return rendered, errors


def mechanical_findings(lines: list[str]) -> list[str]:
    joined = "\n".join(lines)
    findings: list[str] = []
    if lines and lines[0] != "解：":
        findings.append("heading should be exactly '解：'")
    if SLOT_PATTERN.search(joined):
        findings.append("contains unresolved SolutionBoard slots")
    if "$$" in joined:
        findings.append("contains nested/adjacent math delimiters '$$'")
    if joined.count("$") % 2:
        findings.append("contains unmatched '$' math delimiters")
    if UI_LANGUAGE.search(joined):
        findings.append("contains UI/action/coach language")
    if "由题意，在图中标出" in joined:
        findings.append("review truth attribution: values introduced by '由题意，在图中标出' may require an explicit derivation")
    if re.search(r"。。|，，|，。|。；|；。", joined):
        findings.append("contains duplicated or malformed Chinese punctuation")
    if any(line and line != "解：" and not re.search(r"[。；！？.!?]$", line) for line in lines):
        findings.append("one or more solution expressions lack terminal punctuation")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--task-id", required=True)
    args = parser.parse_args()

    try:
        bundle = json.loads(args.bundle.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    scenarios = as_dict(bundle.get("scenarios")).get(args.task_id)
    if not isinstance(scenarios, list) or not scenarios:
        print(f"ERROR: no generated records for task {args.task_id!r}", file=sys.stderr)
        return 1

    positions = [("First", 0), ("Middle", len(scenarios) // 2), ("Last", len(scenarios) - 1)]
    failed = False
    print(f"# Complete solution assembly: {args.task_id}")
    for label, index in positions:
        record = scenarios[index]
        if not isinstance(record, dict):
            print(f"ERROR: record[{index}] is not an object", file=sys.stderr)
            failed = True
            continue
        lines, errors = assemble(record)
        findings = mechanical_findings(lines)
        prompt = as_dict(record.get("promptData"))
        answer_key = as_dict(record.get("answerKey"))
        print(f"\n## {label}")
        print(f"- Scenario ID: {record.get('id')}")
        print(f"- Stem: {prompt.get('promptLatex', '')}")
        print(f"- Answer-key result: {answer_key.get('answerLatex', '')}")
        print("- Assembled solution:")
        for line in lines:
            print(f"  {line}")
        if findings:
            print("- Mechanical review findings:")
            for finding in findings:
                print(f"  - {finding}")
        else:
            print("- Mechanical review findings: none")
        for error in errors:
            print(f"ERROR: {record.get('id')}: {error}", file=sys.stderr)
        failed = failed or bool(errors)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
