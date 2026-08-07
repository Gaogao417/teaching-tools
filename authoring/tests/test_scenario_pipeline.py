from __future__ import annotations

import argparse
import json
import pathlib
import tempfile
import unittest

from authoring.scenario_pipeline import approve_command, deterministic_checks, generate_command, publish_command


def scenario(status: str = "draft") -> dict:
    return {
        "schema": "teaching-tools/scenario-record/v1",
        "id": "demo:q1",
        "taskId": "demo",
        "engineKind": "demo-counter",
        "contentId": "demo-counter.basic.v1",
        "version": "1",
        "status": status,
        "createdAt": "2026-08-07T00:00:00Z",
        "promptData": {"prompt": "type ok"},
        "answerKey": {"expected": "ok"},
        "metadata": {"source": "manual", "authoringRunId": "run-1", "assignments": []},
    }


class ScenarioPipelineTests(unittest.TestCase):
    def test_generate_normalizes_candidates_and_records_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            spec = {
                "taskId": "demo", "engineKind": "demo-counter",
                "contentId": "demo-counter.basic.v1", "version": "1",
                "candidates": [{"id": "q1", "promptData": {"prompt": "ok"}, "answerKey": {"expected": "ok"}}],
            }
            (root / "input.json").write_text(json.dumps(spec), encoding="utf-8")
            generate_command(argparse.Namespace(
                input=root / "input.json", output_dir=root / "drafts",
                run_output=root / "run.json", run_id="run-1",
            ))
            generated = json.loads((root / "drafts" / "demo__q1.draft.json").read_text(encoding="utf-8"))
            run = json.loads((root / "run.json").read_text(encoding="utf-8"))
            self.assertEqual(generated["status"], "draft")
            self.assertEqual(generated["metadata"]["authoringRunId"], "run-1")
            self.assertEqual(run["scenarioIds"], ["demo:q1"])
            self.assertEqual(run["counts"]["candidate"], 1)

    def test_deterministic_validation_accepts_complete_draft(self) -> None:
        self.assertTrue(all(check["passed"] for check in deterministic_checks(scenario())))

    def test_approval_requires_matching_passed_report(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            candidate = scenario("validated")
            candidate["validationReportId"] = "report-1"
            report = {
                "id": "report-1", "scenarioId": "demo:q1", "scenarioVersion": "1",
                "authoringRunId": "run-1", "passed": True,
            }
            (root / "scenario.json").write_text(json.dumps(candidate), encoding="utf-8")
            (root / "report.json").write_text(json.dumps(report), encoding="utf-8")
            approve_command(argparse.Namespace(
                scenario=root / "scenario.json",
                report=root / "report.json",
                reviewer="teacher@example.com",
                output=root / "approved.json",
            ))
            approved = json.loads((root / "approved.json").read_text(encoding="utf-8"))
            self.assertEqual(approved["status"], "approved")
            self.assertEqual(approved["metadata"]["reviewedBy"], "teacher@example.com")
            publish_command(argparse.Namespace(
                scenarios=[root / "approved.json"], reports=[root / "report.json"],
                version="1", output=root / "bank.json",
            ))
            bank = json.loads((root / "bank.json").read_text(encoding="utf-8"))
            self.assertEqual([item["id"] for item in bank["scenarios"]], ["demo:q1"])

    def test_publish_rejects_non_approved_records(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            path = root / "scenario.json"
            path.write_text(json.dumps(scenario("validated")), encoding="utf-8")
            with self.assertRaises(ValueError):
                publish_command(argparse.Namespace(scenarios=[path], reports=[], version="1", output=root / "bank.json"))


if __name__ == "__main__":
    unittest.main()
