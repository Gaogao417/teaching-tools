/**
 * P4-10：C-PLN deterministic case 判定与 Run 记录合法性测试。
 * 在临时 canonical root 上跑完整闭环：合成 Truth/TA → Build/Approve/Materialize
 * 写入 tutor-plan/ 注册表 → runPlanCases 全 pass；抽掉一个 TP 后 fail closed。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const { canonicalHash } = require("../../planBuild/canonicalInputs") as typeof import("../../planBuild/canonicalInputs");
const { buildTutorPlanDraft } = require("../../planBuild/BuildTutorPlan") as typeof import("../../planBuild/BuildTutorPlan");
const { approveTutorPlan } = require("../../planBuild/ReviewTutorPlan") as typeof import("../../planBuild/ReviewTutorPlan");
const {
  MATERIALIZER_VERSION,
  materializeTutorPlan,
  projectApprovedPlan,
} = require("../../planBuild/MaterializeTutorPlan") as typeof import("../../planBuild/MaterializeTutorPlan");
const { buildRuntimeRegistrySnapshot } = require("../../planBuild/RuntimeRegistrySnapshot") as typeof import("../../planBuild/RuntimeRegistrySnapshot");
const { buildPlanRun, runPlanCases } = require("../planCases") as typeof import("../planCases");

const SHA = (seed: string): string => `sha256:${createHash("sha256").update(seed).digest("hex")}`;

function writeVersioned(root: string, namespace: string, artifactId: string, payload: Record<string, unknown>): void {
  const dir = path.join(root, namespace, artifactId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${payload.version as string}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(
    path.join(dir, "registry.yaml"),
    [
      `artifact_id: ${artifactId}`,
      `current_version: ${payload.version as string}`,
      "versions:",
      `- {version: ${payload.version as string}, status: Approved}`,
      "",
    ].join("\n"),
  );
}

function makeTruth(qtId: string, partCount: number): Record<string, unknown> {
  const subquestions = Array.from({ length: partCount }, (_, index) => ({
    part_id: String(index + 1),
    prompt: `(1) 求证：$\\triangle AOB \\sim \\triangle DOC$；`.replace("(1)", `(${index + 1})`),
    canonical_answer: { kind: "proof", value: "$\\triangle AOB \\sim \\triangle DOC$" },
    reviewed_solution: "由平行得内错角相等，AA 判定。",
  }));
  const payload: Record<string, unknown> = {
    schema: "ai_teaching_question_truth/v2",
    artifact_id: qtId,
    version: "v1",
    status: "Approved",
    question_type: "solution",
    stem: `如图（${qtId}），$AB \\parallel CD$。求证：$\\triangle AOB \\sim \\triangle DOC$。`,
    subquestions: partCount > 0 ? subquestions : undefined,
    ...(partCount > 0
      ? {}
      : {
          canonical_answer: { kind: "proof", value: "$\\triangle AOB \\sim \\triangle DOC$" },
          reviewed_solution: "由平行得内错角相等，AA 判定。",
        }),
    source_evidence_refs: [{ evidence_id: "SE-TST-001", artifact_uri: "artifact://source-evidence/SE-TST-001" }],
    approval: { reviewer_id: "tst", approved_at: "2026-08-21T00:00:00Z" },
    content_hash: "",
    artifact_uri: `artifact://question-truth/${qtId}@v1`,
  };
  payload.content_hash = canonicalHash(payload, "authoring");
  return payload;
}

function makeApproach(qtId: string, taId: string, partId: string | undefined, truthHash: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    schema: "ai_teaching_teaching_approach/v2",
    artifact_id: taId,
    version: "v1",
    status: "Approved",
    question_ref: {
      artifact_id: qtId,
      version: "v1",
      content_hash: truthHash,
      ...(partId ? { part_id: partId } : {}),
    },
    title: `${taId}`,
    goal: "建立平行到相似的推理链",
    entry_signal: "指出目标三角形",
    steps: [
      {
        step_id: "S1",
        intent: "识别目标三角形",
        narration: "看两个三角形。",
        expected_student_reasoning: "指出目标三角形",
        common_errors: ["只看数值"],
        skill_ids: ["SKILL-SMV-008"],
      },
      {
        step_id: "S2",
        intent: "转换平行条件",
        narration: "平行给内错角。",
        expected_student_reasoning: "说出内错角",
        skill_ids: ["SKILL-SMV-005"],
      },
      {
        step_id: "S3",
        intent: "AA 收尾",
        narration: "AA 判定。",
        expected_student_reasoning: "写出判定",
        skill_ids: ["SKILL-SMV-009"],
      },
    ],
    evidence: {
      audio: [{ artifact_uri: `artifact://audio/${taId}@v1/a.wav`, content_hash: SHA("a"), recorded_at: "2026-08-21T00:00:00Z" }],
      transcripts: [{ artifact_uri: `artifact://transcript/${taId}@v1/a.txt`, asr_provenance: { provider: "dashscope", model_id: "qwen3-asr-flash" } }],
      polished: [],
      manual_edit_notes: ["tst"],
    },
    approval: { reviewer_id: "tst", approved_at: "2026-08-21T00:00:00Z" },
    content_hash: "",
    artifact_uri: `artifact://teaching-approach/${taId}@v1`,
  };
  payload.content_hash = canonicalHash(payload, "authoring");
  return payload;
}

interface QuestionFixture {
  qtId: string;
  parts: number;
}

function publishPlanFor(root: string, { qtId, parts }: QuestionFixture, tpId: string): void {
  const truth = makeTruth(qtId, parts) as unknown as import("../../planBuild/canonicalInputs").TruthPayload;
  writeVersioned(root, "question-truth", qtId, truth as unknown as Record<string, unknown>);
  const qtSeq = qtId.slice(-1);
  const approaches = Array.from({ length: parts === 0 ? 1 : parts }, (_, index) => {
    const taId = `TA-TST-${qtSeq}0${index + 1}`;
    return makeApproach(qtId, taId, parts === 0 ? undefined : String(index + 1), truth.content_hash) as unknown as import("../../planBuild/canonicalInputs").ApproachPayload;
  });
  for (const approach of approaches) {
    writeVersioned(root, "teaching-approach", approach.artifact_id, approach as unknown as Record<string, unknown>);
  }
  const snapshot = buildRuntimeRegistrySnapshot();
  const build = buildTutorPlanDraft({
    planId: tpId,
    runId: "run-tst",
    builtAt: "2026-08-21T00:00:00Z",
    truth,
    approachSet: null,
    approaches,
    snapshot,
    capabilityPath: ["select-option", "enter-text"],
  });
  if (!build.ok) throw new Error(build.errors.join(";"));
  const inputs = {
    truth,
    approaches: new Map(approaches.map((approach) => [approach.artifact_id, approach])),
    snapshot,
  };
  const { projection_hash } = projectApprovedPlan(build.plan, inputs);
  const approval = approveTutorPlan(build.plan, {
    reviewer_id: "reviewer-tst",
    approved_at: "2026-08-21T01:00:00Z",
    review_note: "tst",
    runtime_projection: {
      materializer_version: MATERIALIZER_VERSION,
      runtime_registry_version: snapshot.runtime_registry_version,
      projection_hash,
      validation_status: "passed",
    },
  });
  if (!approval.ok) throw new Error(approval.errors.join(";"));
  const materialized = materializeTutorPlan(approval.plan, inputs);
  if (!materialized.ok) throw new Error(materialized.errors.join(";"));
  writeVersioned(root, "tutor-plan", tpId, materialized.plan as unknown as Record<string, unknown>);
}

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), "plan-cases-"));

  await runTest("C-PLN cases pass against a fully published canonical root", () => {
    publishPlanFor(root, { qtId: "QT-SMV-001", parts: 0 }, "TP-SMV-001");
    publishPlanFor(root, { qtId: "QT-SMV-002", parts: 2 }, "TP-SMV-002");
    publishPlanFor(root, { qtId: "QT-SMV-005", parts: 2 }, "TP-SMV-005");
    const results = runPlanCases({ canonicalRoot: root });
    assert.equal(results.length, 3);
    for (const result of results) {
      assert.equal(result.status, "pass", `${result.case_id}: ${result.metrics?.detail ?? ""}`);
    }
  });

  await runTest("missing published plan fails closed with input_missing", () => {
    const emptyRoot = mkdtempSync(path.join(os.tmpdir(), "plan-cases-empty-"));
    const results = runPlanCases({ canonicalRoot: emptyRoot });
    assert.equal(results.length, 3);
    for (const result of results) {
      assert.equal(result.status, "fail");
      assert.equal(result.failure_class, "input_missing");
    }
    rmSync(emptyRoot, { recursive: true, force: true });
  });

  await runTest("run record validates against canonical benchmark schema", () => {
    const run = buildPlanRun({
      runId: "BR-0006",
      sutId: "sut-a-claudecode-glm52-qwen",
      datasetId: "similarity-mvp-benchmark-v1",
      datasetVersion: "v1",
      inputs: { canonicalRoot: root },
    });
    assert.ok(run.ok, run.ok ? "" : run.errors.join(";"));
    const record = run.ok ? (run.record as { summary: { passed: number; failed: number } }) : null;
    assert.equal(record?.summary.passed, 3);
    assert.equal(record?.summary.failed, 0);
  });

  rmSync(root, { recursive: true, force: true });
}

void main().then(
  () => console.log("PASS planCases (all)"),
  (error) => {
    console.error("FAIL planCases", error);
    throw error;
  },
);
