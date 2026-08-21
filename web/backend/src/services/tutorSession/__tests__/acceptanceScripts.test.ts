/**
 * Phase 5 退出门禁 1：12 条浏览器验收剧本（scripted closed-loop 形态）在合成
 * canonical plan 上全部通过；golden 实跑（TP-SMV-001..006）由
 * scripts/run-tutor-sessions.ts CLI 用同一 runner 执行并落报告。
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { ensureSqlite, publishSyntheticPlan, tempRoot } from "./support";

const sqlitePath = ensureSqlite("acceptance-scripts");

const { createTutorSessionCoordinator } = require("../TutorSession") as typeof import("../TutorSession");
const { ACCEPTANCE_SCRIPT_IDS, runAcceptanceScript } = require("../acceptanceScripts") as typeof import("../acceptanceScripts");

async function main(): Promise<void> {
  const root = tempRoot("acceptance-scripts");
  publishSyntheticPlan(root, { qtId: "QT-SMV-001", tpId: "TP-SMV-001", parts: 0 });
  const { loadCurrentPlan } = require("../../planBuild/canonicalInputs") as typeof import("../../planBuild/canonicalInputs");
  const planResult = loadCurrentPlan({ canonicalRoot: root }, "TP-SMV-001");
  assert.ok(planResult.ok);
  const plan = planResult.payload;

  let sessionCounter = 7000;
  const makeCoordinator = () => createTutorSessionCoordinator({ canonicalRoot: root });
  const harness = {
    coordinator: makeCoordinator(),
    canonicalRoot: root,
    nextSessionId: () => `TS-${(sessionCounter += 1)}`,
    makeCoordinatorWithPolicy: (policy: unknown) =>
      createTutorSessionCoordinator({ canonicalRoot: root, policy: policy as never, policyTimeoutMs: 50 }),
  };

  const outcomes = [];
  for (const scriptId of ACCEPTANCE_SCRIPT_IDS) {
    outcomes.push(await runAcceptanceScript(scriptId, harness, plan));
  }
  const failures = outcomes.filter((outcome) => outcome.status === "fail");
  for (const outcome of outcomes) {
    console.log(`${outcome.status.toUpperCase()} ${outcome.script_id}${outcome.detail ? `: ${outcome.detail}` : ""}`);
    for (const failure of outcome.failures) console.error(`  ↳ ${failure}`);
  }
  assert.equal(ACCEPTANCE_SCRIPT_IDS.length, 12, "必须恰好 12 条剧本");
  assert.deepEqual(
    failures.map((failure) => failure.script_id),
    [],
    `剧本不得失败：${failures.map((failure) => failure.failures.join("; ")).join(" | ")}`,
  );

  rmSync(root, { recursive: true, force: true });
  const { db } = require("../../../db/database") as typeof import("../../../db/database");
  db.close();
  if (existsSync(sqlitePath)) rmSync(sqlitePath, { force: true });
  console.log("PASS acceptanceScripts (12/12 on synthetic plan)");
}

void main().catch((error) => {
  console.error("FAIL acceptanceScripts", error);
  throw error;
});
