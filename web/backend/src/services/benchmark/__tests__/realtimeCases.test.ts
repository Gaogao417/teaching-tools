/**
 * C-RT deterministic case 判定与 Run 记录合法性测试（合成 canonical root 上
 * 跑 5 个 realtime scripted 场景；golden 实跑由 run-realtime-cases.ts CLI 执行）。
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { ensureSqlite, publishSyntheticPlan, tempRoot } from "../../tutorSession/__tests__/support";

const sqlitePath = ensureSqlite("realtime-cases");

const { buildRealtimeRun } = require("../realtimeCases") as typeof import("../realtimeCases");
const { createTutorSessionCoordinator } = require("../../tutorSession/TutorSession") as typeof import("../../tutorSession/TutorSession");

async function main(): Promise<void> {
  const root = tempRoot("realtime-cases");
  publishSyntheticPlan(root, { qtId: "QT-SMV-001", tpId: "TP-SMV-001", parts: 0 });
  publishSyntheticPlan(root, { qtId: "QT-SMV-002", tpId: "TP-SMV-002", parts: 2 });
  publishSyntheticPlan(root, { qtId: "QT-SMV-003", tpId: "TP-SMV-003", parts: 3 });
  publishSyntheticPlan(root, { qtId: "QT-SMV-004", tpId: "TP-SMV-004", parts: 0 });
  publishSyntheticPlan(root, { qtId: "QT-SMV-005", tpId: "TP-SMV-005", parts: 2 });

  const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
  let sessionCounter = 8900;
  const run = await buildRealtimeRun({
    runId: "BR-0007",
    sutId: "sut-a-claudecode-glm52-qwen",
    datasetId: "similarity-mvp-benchmark-v1",
    datasetVersion: "v1",
    inputs: { canonicalRoot: root, coordinator, nextSessionId: () => `TS-${(sessionCounter += 1)}` },
  });
  assert.ok(run.ok, run.ok ? "" : run.errors.join("; "));
  const record = run.ok ? (run.record as { case_results: Array<{ case_id: string; status: string; failure_class?: string; metrics?: { detail?: string } }>; summary: { passed: number; failed: number } }) : null;
  assert.equal(record?.case_results.length, 5);
  for (const caseResult of record?.case_results ?? []) {
    assert.equal(
      caseResult.status,
      "pass",
      `${caseResult.case_id}: ${caseResult.failure_class ?? ""} ${caseResult.metrics?.detail ?? ""}`,
    );
    console.log(`PASS ${caseResult.case_id}: ${caseResult.metrics?.detail}`);
  }
  assert.equal(record?.summary.passed, 5);
  assert.equal(record?.summary.failed, 0);

  // 缺输入 fail closed
  const emptyRoot = tempRoot("realtime-cases-empty");
  const missing = await buildRealtimeRun({
    runId: "BR-0008",
    sutId: "sut-a-claudecode-glm52-qwen",
    datasetId: "similarity-mvp-benchmark-v1",
    datasetVersion: "v1",
    inputs: { canonicalRoot: emptyRoot, coordinator, nextSessionId: () => `TS-${(sessionCounter += 1)}` },
  });
  assert.ok(missing.ok);
  const missingRecord = missing.ok
    ? (missing.record as { case_results: Array<{ status: string; failure_class?: string }>; summary: { failed: number } })
    : null;
  assert.equal(missingRecord?.summary.failed, 5);
  assert.ok(missingRecord?.case_results.every((caseResult) => caseResult.failure_class === "input_missing"));
  rmSync(emptyRoot, { recursive: true, force: true });

  rmSync(root, { recursive: true, force: true });
  const { db } = require("../../../db/database") as typeof import("../../../db/database");
  db.close();
  if (existsSync(sqlitePath)) rmSync(sqlitePath, { force: true });
  console.log("PASS realtimeCases (5/5 on synthetic plans + fail-closed)");
}

void main().catch((error) => {
  console.error("FAIL realtimeCases", error);
  throw error;
});
