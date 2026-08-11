#!/usr/bin/env python3
"""Validate that generated Topic records are bound to Action Runtime v2 authoring."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


BUNDLE_SCHEMA = "teaching-tools/topic-scenario-bundle/v2"
SLOT_PATTERN = re.compile(r"\{\{([a-zA-Z0-9._-]+)\}\}")


def object_value(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def validate_record(record: Any, index: int) -> list[str]:
    prefix = f"record[{index}]"
    if not isinstance(record, dict):
        return [f"{prefix} must be an object"]
    record_id = str(record.get("id") or prefix)
    errors: list[str] = []
    prompt = object_value(record.get("promptData"))
    if prompt is None:
        return [f"{record_id}: missing promptData object"]

    actions = prompt.get("actionTemplates")
    if not isinstance(actions, list) or not actions:
        errors.append(f"{record_id}: promptData.actionTemplates must be non-empty (legacy/incomplete authoring)")
        actions = []

    action_ids: set[str] = set()
    for action_index, action in enumerate(actions):
        label = f"{record_id}: actionTemplates[{action_index}]"
        if not isinstance(action, dict):
            errors.append(f"{label} must be an object")
            continue
        action_id = action.get("actionId")
        if not isinstance(action_id, str) or not action_id:
            errors.append(f"{label}.actionId must be a non-empty string")
        elif action_id in action_ids:
            errors.append(f"{record_id}: duplicate actionId {action_id!r}")
        else:
            action_ids.add(action_id)
        if not isinstance(action.get("kind"), str) or not action.get("kind"):
            errors.append(f"{label}.kind must be a non-empty string")
        version = action.get("version")
        if not isinstance(version, int) or version < 1:
            errors.append(f"{label}.version must be a positive integer")
        if not isinstance(action.get("input"), dict):
            errors.append(f"{label}.input must be a public object")
        if "boardTargets" in action:
            errors.append(f"{label}.boardTargets is forbidden; SolutionBoard is server-projected context")

    board = object_value(prompt.get("solutionBoard"))
    if board is None:
        errors.append(f"{record_id}: promptData.solutionBoard is required")
        return errors
    if not isinstance(board.get("schemaVersion"), int):
        errors.append(f"{record_id}: solutionBoard.schemaVersion must be an integer")
    if not isinstance(board.get("documentId"), str) or not board.get("documentId"):
        errors.append(f"{record_id}: solutionBoard.documentId must be a non-empty string")
    expressions = board.get("expressions")
    if not isinstance(expressions, list) or not expressions:
        errors.append(f"{record_id}: solutionBoard.expressions must be non-empty")
        expressions = []

    declared_slots: set[str] = set()
    expression_ids: set[str] = set()
    for expression_index, expression in enumerate(expressions):
        label = f"{record_id}: solutionBoard.expressions[{expression_index}]"
        if not isinstance(expression, dict):
            errors.append(f"{label} must be an object")
            continue
        expression_id = expression.get("expressionId")
        if not isinstance(expression_id, str) or not expression_id:
            errors.append(f"{label}.expressionId must be a non-empty string")
        elif expression_id in expression_ids:
            errors.append(f"{record_id}: duplicate expressionId {expression_id!r}")
        else:
            expression_ids.add(expression_id)
        template = expression.get("latexTemplate")
        if not isinstance(template, str) or not template:
            errors.append(f"{label}.latexTemplate must be a non-empty string")
            slots: list[str] = []
        else:
            slots = SLOT_PATTERN.findall(template)
        if len(slots) != len(set(slots)):
            errors.append(f"{label} repeats a slot ID in one expression")
        for slot_id in slots:
            if slot_id in declared_slots:
                errors.append(f"{record_id}: SolutionBoard slot {slot_id!r} is declared more than once")
            declared_slots.add(slot_id)
        owners = expression.get("ownerActionIds")
        if not isinstance(owners, list) or not owners or not all(isinstance(owner, str) for owner in owners):
            errors.append(f"{label}.ownerActionIds must be a non-empty string list")
        else:
            unknown = sorted(set(owners) - action_ids)
            if unknown:
                errors.append(f"{label} references unknown owner actions: {', '.join(unknown)}")

    if declared_slots:
        errors.append(f"{record_id}: runtime SolutionBoard templates must be complete text without slots: {', '.join(sorted(declared_slots))}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--task-id", required=True)
    args = parser.parse_args()

    try:
        bundle = json.loads(args.bundle.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"ERROR: Bundle does not exist: {args.bundle}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as exc:
        print(f"ERROR: Invalid JSON: {exc}", file=sys.stderr)
        return 1

    errors: list[str] = []
    if not isinstance(bundle, dict) or bundle.get("schema") != BUNDLE_SCHEMA:
        actual = bundle.get("schema") if isinstance(bundle, dict) else type(bundle).__name__
        errors.append(f"Bundle schema is {actual!r}; expected {BUNDLE_SCHEMA!r}")
    scenarios = bundle.get("scenarios") if isinstance(bundle, dict) else None
    records = scenarios.get(args.task_id) if isinstance(scenarios, dict) else None
    if not isinstance(records, list) or not records:
        errors.append(f"Task {args.task_id!r} has no generated scenario records")
        records = []
    for index, record in enumerate(records):
        errors.extend(validate_record(record, index))

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    sample_indexes = sorted({0, len(records) // 2, len(records) - 1})
    sample_ids = [str(records[index].get("id", index)) for index in sample_indexes]
    print(
        f"OK: task={args.task_id} schema={BUNDLE_SCHEMA} records={len(records)} "
        f"samples={','.join(sample_ids)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
