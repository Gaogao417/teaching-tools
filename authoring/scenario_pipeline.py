#!/usr/bin/env python3
"""Offline Scenario Bank validation, approval, and publication CLI."""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import pathlib
import subprocess
import tempfile
import uuid
from typing import Any

SCENARIO_SCHEMA = "teaching-tools/scenario-record/v1"
REPORT_SCHEMA = "teaching-tools/scenario-validation-report/v1"
BANK_SCHEMA = "teaching-tools/scenario-bank/v1"
RUN_SCHEMA = "teaching-tools/authoring-run/v1"
TOOLCHAIN_VERSION = "1.0.0"
ALLOWED_STATUSES = {"draft", "validated", "approved", "rejected"}
ALLOWED_SOURCES = {"manual", "python-generator", "ai-assisted", "reviewed-bank-import"}
REQUIRED_SCENARIO_FIELDS = {
    "schema", "id", "taskId", "engineKind", "contentId", "version",
    "status", "promptData", "answerKey", "metadata", "createdAt",
}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path: pathlib.Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def write_json(path: pathlib.Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def deterministic_checks(scenario: dict[str, Any]) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []

    def add(name: str, passed: bool, message: str) -> None:
        checks.append({"name": name, "kind": "domain", "passed": passed, "message": message})

    missing = sorted(REQUIRED_SCENARIO_FIELDS - scenario.keys())
    add("required-fields", not missing, "All required fields are present." if not missing else f"Missing: {', '.join(missing)}")
    add("schema-version", scenario.get("schema") == SCENARIO_SCHEMA, f"Expected schema {SCENARIO_SCHEMA}.")
    for field in ("id", "taskId", "engineKind", "contentId", "version"):
        value = scenario.get(field)
        add(f"non-empty-{field}", isinstance(value, str) and bool(value.strip()), f"{field} must be a non-empty string.")
    add("known-status", scenario.get("status") in ALLOWED_STATUSES, "Status must be a known authoring lifecycle state.")
    add("pre-approval-input", scenario.get("status") in {"draft", "validated"}, "Validation accepts only draft or validated candidates.")
    add("prompt-data-object", isinstance(scenario.get("promptData"), dict) and bool(scenario.get("promptData")), "promptData must be a non-empty object.")
    add("answer-key-object", isinstance(scenario.get("answerKey"), dict) and bool(scenario.get("answerKey")), "answerKey must be a non-empty object.")
    metadata = scenario.get("metadata")
    add("metadata-object", isinstance(metadata, dict), "metadata must be an object.")
    source = metadata.get("source") if isinstance(metadata, dict) else None
    add("known-source", source in ALLOWED_SOURCES, "metadata.source must identify a supported provenance.")
    add("authoring-run", isinstance(metadata, dict) and bool(metadata.get("authoringRunId")), "metadata.authoringRunId is required.")
    add("assignments", isinstance(metadata, dict) and isinstance(metadata.get("assignments"), list), "metadata.assignments must be an array.")
    return checks


def generate_command(args: argparse.Namespace) -> int:
    """Normalize an engine-specific candidate batch into draft ScenarioRecords."""
    spec = read_json(args.input)
    candidates = spec.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("Generation input must contain a non-empty candidates array")
    for field in ("taskId", "engineKind", "contentId", "version"):
        if not isinstance(spec.get(field), str) or not spec[field].strip():
            raise ValueError(f"Generation input requires non-empty {field}")
    run_id = args.run_id or f"authoring:{spec['taskId']}:{uuid.uuid4().hex[:12]}"
    started_at = now_iso()
    scenario_ids: list[str] = []
    for index, candidate in enumerate(candidates, start=1):
        if not isinstance(candidate, dict):
            raise ValueError(f"Candidate {index} must be an object")
        candidate_id = str(candidate.get("id") or f"candidate-{index:04d}")
        record_id = candidate_id if ":" in candidate_id else f"{spec['taskId']}:{candidate_id}"
        metadata = copy.deepcopy(candidate.get("metadata") or {})
        metadata.setdefault("source", spec.get("source", "python-generator"))
        metadata["authoringRunId"] = run_id
        metadata.setdefault("assignments", list(spec.get("assignments") or []))
        record = {
            "schema": SCENARIO_SCHEMA,
            "id": record_id,
            "taskId": spec["taskId"],
            "engineKind": spec["engineKind"],
            "contentId": spec["contentId"],
            "version": str(spec["version"]),
            "status": "draft",
            "promptData": copy.deepcopy(candidate.get("promptData") or {}),
            "answerKey": copy.deepcopy(candidate.get("answerKey") or {}),
            "metadata": metadata,
            "createdAt": started_at,
        }
        scenario_ids.append(record_id)
        write_json(args.output_dir / f"{record_id.replace(':', '__')}.draft.json", record)
    write_json(args.run_output, {
        "schema": RUN_SCHEMA,
        "id": run_id,
        "status": "completed",
        "taskIds": [spec["taskId"]],
        "startedAt": started_at,
        "finishedAt": now_iso(),
        "toolchainVersion": TOOLCHAIN_VERSION,
        "inputSpecVersion": str(spec.get("inputSpecVersion", spec["version"])),
        "counts": {"candidate": len(scenario_ids), "validated": 0, "approved": 0, "rejected": 0},
        "scenarioIds": scenario_ids,
    })
    return 0


def run_wolfram_checks(
    scenario: dict[str, Any],
    wolframscript: str,
    validator: pathlib.Path,
) -> tuple[list[dict[str, Any]], str]:
    raw_checks = scenario.get("metadata", {}).get("wolframChecks", [])
    if not raw_checks:
        return [{
            "name": "wolfram-checks-declared",
            "kind": "mathematical",
            "passed": False,
            "message": "No metadata.wolframChecks were declared; mathematical validation fails closed.",
        }], "0/0 Wolfram checks declared"
    with tempfile.TemporaryDirectory(prefix="teaching-tools-wolfram-") as tmp:
        request_path = pathlib.Path(tmp) / "request.json"
        response_path = pathlib.Path(tmp) / "response.json"
        write_json(request_path, {"checks": raw_checks})
        completed = subprocess.run(
            [wolframscript, "-file", str(validator), str(request_path), str(response_path)],
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if completed.returncode != 0 or not response_path.exists():
            message = (completed.stderr or completed.stdout or "wolframscript failed").strip()
            return [{"name": "wolfram-process", "kind": "mathematical", "passed": False, "message": message}], "Wolfram validation failed"
        response = read_json(response_path)
    checks = [{
        "name": item.get("name", "wolfram-check"),
        "kind": "mathematical",
        "passed": bool(item.get("passed")),
        "message": item.get("message", ""),
    } for item in response.get("checks", [])]
    return checks, str(response.get("summary", "Wolfram validation completed"))


def validate_command(args: argparse.Namespace) -> int:
    scenario = read_json(args.input)
    checks = deterministic_checks(scenario)
    wolfram_summary = None
    if args.wolfram:
        wolfram_checks, wolfram_summary = run_wolfram_checks(scenario, args.wolframscript, args.validator)
        checks.extend(wolfram_checks)
    passed = all(check["passed"] for check in checks)
    report_id = f"validation:{scenario.get('id', 'unknown')}:{uuid.uuid4().hex[:12]}"
    report = {
        "schema": REPORT_SCHEMA,
        "id": report_id,
        "scenarioId": scenario.get("id", ""),
        "scenarioVersion": scenario.get("version", ""),
        "authoringRunId": scenario.get("metadata", {}).get("authoringRunId", ""),
        "passed": passed,
        "checks": checks,
        "createdAt": now_iso(),
    }
    if wolfram_summary is not None:
        report["wolframSummary"] = wolfram_summary
    output = copy.deepcopy(scenario)
    if passed:
        output["status"] = "validated"
        output["validationReportId"] = report_id
    write_json(args.output_scenario, output)
    write_json(args.output_report, report)
    return 0 if passed else 1


def approve_command(args: argparse.Namespace) -> int:
    scenario = read_json(args.scenario)
    report = read_json(args.report)
    if scenario.get("status") != "validated":
        raise ValueError("Only a validated scenario can be approved")
    if not report.get("passed") or report.get("scenarioId") != scenario.get("id"):
        raise ValueError("Validation report must pass and match the scenario")
    if scenario.get("validationReportId") != report.get("id"):
        raise ValueError("Scenario validationReportId does not match the supplied report")
    approved = copy.deepcopy(scenario)
    approved["status"] = "approved"
    approved.setdefault("metadata", {})["reviewedBy"] = args.reviewer
    approved["metadata"]["reviewedAt"] = now_iso()
    approved["approvedAt"] = approved["metadata"]["reviewedAt"]
    write_json(args.output, approved)
    return 0


def publish_command(args: argparse.Namespace) -> int:
    records = [read_json(path) for path in args.scenarios]
    invalid = [record.get("id", "<unknown>") for record in records if record.get("status") != "approved"]
    if invalid:
        raise ValueError(f"Scenario Bank accepts approved records only: {', '.join(invalid)}")
    reports = {report.get("id"): report for report in (read_json(path) for path in args.reports)}
    for record in records:
        report = reports.get(record.get("validationReportId"))
        if not report or not report.get("passed"):
            raise ValueError(f"Approved scenario {record['id']} requires its passed validation report")
        if report.get("scenarioId") != record["id"] or report.get("scenarioVersion") != record["version"]:
            raise ValueError(f"Validation report does not match {record['id']}@{record['version']}")
        if report.get("authoringRunId") != record.get("metadata", {}).get("authoringRunId"):
            raise ValueError(f"Validation report authoring run does not match {record['id']}")
        if not record.get("approvedAt") or not record.get("metadata", {}).get("reviewedBy"):
            raise ValueError(f"Approved scenario {record['id']} lacks explicit review evidence")
    records.sort(key=lambda item: (str(item["taskId"]), str(item["id"])))
    write_json(args.output, {
        "schema": BANK_SCHEMA,
        "version": args.version,
        "publishedAt": now_iso(),
        "scenarios": records,
    })
    return 0


def parser() -> argparse.ArgumentParser:
    root = pathlib.Path(__file__).resolve().parent
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    generate = commands.add_parser("generate", help="Normalize a candidate batch into draft ScenarioRecords")
    generate.add_argument("--input", type=pathlib.Path, required=True)
    generate.add_argument("--output-dir", type=pathlib.Path, required=True)
    generate.add_argument("--run-output", type=pathlib.Path, required=True)
    generate.add_argument("--run-id")
    generate.set_defaults(handler=generate_command)
    validate = commands.add_parser("validate", help="Run deterministic and optional Wolfram validation")
    validate.add_argument("--input", type=pathlib.Path, required=True)
    validate.add_argument("--output-scenario", type=pathlib.Path, required=True)
    validate.add_argument("--output-report", type=pathlib.Path, required=True)
    validate.add_argument("--wolfram", action="store_true", help="Fail closed unless all declared Wolfram checks pass")
    validate.add_argument("--wolframscript", default="wolframscript")
    validate.add_argument("--validator", type=pathlib.Path, default=root / "wolfram" / "validate-scenario.wls")
    validate.set_defaults(handler=validate_command)
    approve = commands.add_parser("approve", help="Apply an explicit human approval to a validated scenario")
    approve.add_argument("--scenario", type=pathlib.Path, required=True)
    approve.add_argument("--report", type=pathlib.Path, required=True)
    approve.add_argument("--reviewer", required=True)
    approve.add_argument("--output", type=pathlib.Path, required=True)
    approve.set_defaults(handler=approve_command)
    publish = commands.add_parser("publish", help="Publish approved records into an immutable bank bundle")
    publish.add_argument("--scenarios", type=pathlib.Path, nargs="+", required=True)
    publish.add_argument("--reports", type=pathlib.Path, nargs="+", required=True)
    publish.add_argument("--version", required=True)
    publish.add_argument("--output", type=pathlib.Path, required=True)
    publish.set_defaults(handler=publish_command)
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        return int(args.handler(args))
    except (OSError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired) as error:
        print(f"authoring error: {error}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
