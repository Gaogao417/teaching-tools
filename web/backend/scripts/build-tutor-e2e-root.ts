/**
 * Phase 5 UI 集成（波次 C）：tutor E2E 合成 canonical root 构建脚本。
 *
 * 在 /learn/:taskId 驱动的浏览器矩阵（72 场景）里替代真实 golden root：
 * 真实 golden v2 Plan 无 Approved Binding（波次 D 才重建/审核），所以这里按
 * vitestSupport.publishSyntheticV3Experience 的同一管线（truth/TA→build→
 * approve→materialize→publish + v3 升级 + ApproachSet/Profile/Binding 登记）
 * 为 6 个真实 Topic task id 发布合成 v3 体验：
 *
 *   task 1–4：enter-text 结论步（task 1 附 alternate 讲法）
 *   task 5  ：select-option（choice_option 真值）
 *   task 6  ：make-parallel 白板动作（input.geometry 携带画布模型）
 *
 * 用法：tsx scripts/build-tutor-e2e-root.ts <outDir>
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import {
  canonicalHash,
  type TruthPayload,
  type ApproachPayload,
  type TutorPlanV2Payload,
} from "../src/services/planBuild/canonicalInputs";
import { buildTutorPlanDraft } from "../src/services/planBuild/BuildTutorPlan";
import { approveTutorPlan } from "../src/services/planBuild/ReviewTutorPlan";
import { materializeTutorPlan, projectApprovedPlan, MATERIALIZER_VERSION } from "../src/services/planBuild/MaterializeTutorPlan";
import { buildRuntimeRegistrySnapshot } from "../src/services/planBuild/RuntimeRegistrySnapshot";
import type { AuthoredActionTemplate } from "../../../shared/actionRuntime";

const SHA = (seed: string): string => `sha256:${createHash("sha256").update(seed).digest("hex")}`;

export interface E2eTaskSpec {
  taskId: string;
  scenarioId: string;
  qtId: string;
  tpId: string;
  alternateTpId?: string;
  action: "enter-text" | "select-option" | "make-parallel";
}

export const E2E_TASKS: E2eTaskSpec[] = [
  { taskId: "parallelLineRatios", scenarioId: "SC-E2E-001", qtId: "QT-E2E-001", tpId: "TP-E2E-001", alternateTpId: "TP-E2E-101", action: "enter-text" },
  { taskId: "auxiliaryTwoRatios", scenarioId: "SC-E2E-002", qtId: "QT-E2E-002", tpId: "TP-E2E-002", action: "enter-text" },
  { taskId: "reverseASimilarity", scenarioId: "SC-E2E-003", qtId: "QT-E2E-003", tpId: "TP-E2E-003", action: "enter-text" },
  { taskId: "nestedSimilarity", scenarioId: "SC-E2E-004", qtId: "QT-E2E-004", tpId: "TP-E2E-004", action: "enter-text" },
  { taskId: "butterflySimilarity", scenarioId: "SC-E2E-005", qtId: "QT-E2E-005", tpId: "TP-E2E-005", action: "select-option" },
  { taskId: "reverseAFourSimilarity", scenarioId: "SC-E2E-006", qtId: "QT-E2E-006", tpId: "TP-E2E-006", action: "make-parallel" },
];

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

function makeTruth(spec: E2eTaskSpec): Record<string, unknown> {
  const stem = `如图（${spec.qtId}），$AB \\parallel CD$。求证：$\\triangle AOB \\sim \\triangle DOC$。`;
  const canonicalAnswer =
    spec.action === "select-option"
      ? {
          kind: "choice_option",
          value: "opt-a",
          options: [
            { id: "opt-a", value: "$\\triangle AOB \\sim \\triangle DOC$" },
            { id: "opt-b", value: "$\\triangle AOB \\cong \\triangle DOC$" },
            { id: "opt-c", value: "$\\triangle AOB \\sim \\triangle COD$" },
          ],
        }
      : { kind: "proof", value: "$\\triangle AOB \\sim \\triangle DOC$" };
  const payload: Record<string, unknown> = {
    schema: "ai_teaching_question_truth/v2",
    artifact_id: spec.qtId,
    version: "v1",
    status: "Approved",
    question_type: "solution",
    stem,
    canonical_answer: canonicalAnswer,
    reviewed_solution: "由平行得内错角相等，AA 判定。",
    source_evidence_refs: [{ evidence_id: "SE-E2E-001", artifact_uri: "artifact://source-evidence/SE-E2E-001" }],
    approval: { reviewer_id: "e2e", approved_at: "2026-08-22T00:00:00Z" },
    content_hash: "",
    artifact_uri: `artifact://question-truth/${spec.qtId}@v1`,
  };
  payload.content_hash = canonicalHash(payload, "authoring");
  return payload;
}

function makeApproach(spec: E2eTaskSpec, variantSeed: string): Record<string, unknown> {
  const taId = `TA-E2E-${spec.qtId.slice(-3)}${variantSeed}`;
  const truthHash = makeTruthHashCache.get(spec.qtId)!;
  const payload: Record<string, unknown> = {
    schema: "ai_teaching_teaching_approach/v2",
    artifact_id: taId,
    version: "v1",
    status: "Approved",
    question_ref: { artifact_id: spec.qtId, version: "v1", content_hash: truthHash },
    title: taId,
    goal: `建立平行到相似的推理链（${variantSeed}）`,
    entry_signal: "学生能先指出目标三角形，再转换条件",
    steps: [
      {
        step_id: "S1",
        intent: "识别目标三角形",
        narration: "先看两个三角形。",
        expected_student_reasoning: "学生能指出目标三角形",
        common_errors: ["只看数值不指出目标三角形"],
        skill_ids: ["SKILL-SMV-008"],
      },
      {
        step_id: "S2",
        intent: "转换平行条件",
        narration: "平行给内错角。",
        expected_student_reasoning: "学生能说出内错角相等",
        skill_ids: ["SKILL-SMV-005"],
      },
      {
        step_id: "S3",
        intent: "AA 收尾",
        narration: "AA 判定收尾。",
        expected_student_reasoning: "学生能写出 AA 判定结论",
        common_errors: ["在斜三角形中硬凑勾股"],
        skill_ids: ["SKILL-SMV-009"],
      },
    ],
    evidence: {
      audio: [{ artifact_uri: `artifact://audio/${taId}@v1/a.wav`, content_hash: SHA("a"), recorded_at: "2026-08-22T00:00:00Z" }],
      transcripts: [{ artifact_uri: `artifact://transcript/${taId}@v1/a.txt`, asr_provenance: { provider: "dashscope", model_id: "qwen3-asr-flash" } }],
      polished: [],
      manual_edit_notes: ["e2e"],
    },
    approval: { reviewer_id: "e2e", approved_at: "2026-08-22T00:00:00Z" },
    content_hash: "",
    artifact_uri: `artifact://teaching-approach/${taId}@v1`,
  };
  payload.content_hash = canonicalHash(payload, "authoring");
  return payload;
}

const makeTruthHashCache = new Map<string, string>();

function makeParallelTemplate(tpId: string): AuthoredActionTemplate {
  return {
    actionId: `tp:${tpId}:1:make-parallel`,
    sourceStepId: "S3",
    kind: "make-parallel",
    version: 1,
    title: "作平行线",
    instruction: "过点 C 作 AB 的平行线。",
    input: {
      availablePointIds: ["A", "B", "C"],
      availableLineIds: ["AB", "BC"],
      outputLineId: "L1",
      outputLineLabel: "过 C 的平行线",
      geometry: {
        viewBox: { width: 400, height: 300 },
        points: [
          { id: "A", x: 60, y: 220 },
          { id: "B", x: 300, y: 220 },
          { id: "C", x: 120, y: 60 },
        ],
        segments: [
          { id: "AB", from: "A", to: "B" },
          { id: "BC", from: "B", to: "C" },
        ],
      },
    },
    teachingInput: { throughPointId: "C", referenceLineId: "AB" },
    capabilities: ["similarity.construct-parallel-helper", "agent:select-object", "agent:set-answer", "agent:back", "agent:clear"],
    answerSlots: [{ id: "target", label: "平行线", kind: "object", required: true }],
    submitOnComplete: true,
  };
}

function buildPlan(
  spec: E2eTaskSpec,
  tpId: string,
  variantSeed: string,
  replaceActionWithMakeParallel: boolean,
): { plan: TutorPlanV2Payload; approaches: ApproachPayload[]; truth: TruthPayload } {
  const truth = makeTruth(spec) as unknown as TruthPayload;
  const approach = makeApproach(spec, variantSeed) as unknown as ApproachPayload;
  const snapshot = buildRuntimeRegistrySnapshot();
  let build = buildTutorPlanDraft({
    planId: tpId,
    runId: "run-e2e",
    builtAt: "2026-08-22T00:00:00Z",
    truth,
    approachSet: null,
    approaches: [approach],
    snapshot,
    capabilityPath: ["enter-text"],
  });
  if (!build.ok) throw new Error(build.errors.join(";"));
  if (replaceActionWithMakeParallel) {
    // 白板动作任务：去掉自动生成的 enter-text 结论步，注入 make-parallel
    // 模板（hash 在 approve 前重算，投影走同一 materializer 管线）。
    const draft = build.plan as unknown as {
      resources: Array<{ resource_id: string; kind: string; capability?: string; checkpoint_id?: string }>;
      checkpoints: Array<{ checkpoint_id: string }>;
      policy_constraints: { allowed_capabilities: string[] };
      content_hash: string;
    };
    const lastCheckpointId = draft.checkpoints[draft.checkpoints.length - 1].checkpoint_id;
    draft.resources = draft.resources.filter((resource) => resource.kind !== "action_template");
    const template = makeParallelTemplate(tpId);
    draft.resources.push({
      resource_id: `RES${draft.resources.length + 1}`,
      kind: "action_template",
      checkpoint_id: lastCheckpointId,
      source: "agent_generated",
      action_ref: template.actionId,
      capability: "similarity.construct-parallel-helper",
      content: JSON.stringify(template),
    } as never);
    // allowed_capabilities 从资源 capability 派生（BuildTutorPlan 同规则）：
    // 注入模板后必须重算，否则五重校验 capability allowlist 拒绝。
    draft.policy_constraints.allowed_capabilities = [
      ...new Set(draft.resources.flatMap((resource) => (resource.capability ? [resource.capability] : []))),
    ].sort();
    draft.content_hash = canonicalHash(build.plan as unknown as Record<string, unknown>, "plan");
  }
  const inputs = {
    truth,
    approaches: new Map([[approach.artifact_id, approach]] as const),
    snapshot,
  };
  const { projection_hash } = projectApprovedPlan(build.plan, inputs);
  const approval = approveTutorPlan(build.plan, {
    reviewer_id: "reviewer-e2e",
    approved_at: "2026-08-22T01:00:00Z",
    review_note: "e2e",
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
  return { plan: materialized.plan, approaches: [approach], truth };
}

function upgradePlanToV3(
  v2Plan: TutorPlanV2Payload,
  asId: string,
  asHash: string,
  ppId: string,
  profileVersion: string,
  profileHash: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(v2Plan as unknown as Record<string, unknown>),
    schema: "ai_teaching_tutor_plan_bundle/v3",
    approach_set_ref: { artifact_id: asId, version: "v1", content_hash: asHash },
    policy_profile_ref: { profile_id: ppId, version: profileVersion, content_hash: profileHash },
  };
  next.content_hash = canonicalHash(next, "plan");
  return next;
}

function main(): void {
  const outDir = process.argv[2];
  if (!outDir) throw new Error("usage: tsx scripts/build-tutor-e2e-root.ts <outDir>");
  mkdirSync(outDir, { recursive: true });

  for (const spec of E2E_TASKS) {
    const truth = makeTruth(spec);
    makeTruthHashCache.set(spec.qtId, truth.content_hash as string);
    writeVersioned(outDir, "question-truth", spec.qtId, truth);

    const primaryApproach = makeApproach(spec, "01");
    writeVersioned(outDir, "teaching-approach", primaryApproach.artifact_id as string, primaryApproach);
    if (spec.alternateTpId) {
      const alternateApproach = makeApproach(spec, "02");
      writeVersioned(outDir, "teaching-approach", alternateApproach.artifact_id as string, alternateApproach);
    }

    const makeApproachSet = (seed: string, approach: Record<string, unknown>): { asId: string; payload: Record<string, unknown> } => {
      const asId = `AS-E2E-${spec.qtId.slice(-3)}${seed}`;
      const payload: Record<string, unknown> = {
        schema: "ai_teaching_approach_set/v1",
        artifact_id: asId,
        version: "v1",
        status: "Approved",
        question_ref: { artifact_id: spec.qtId, version: "v1", content_hash: truth.content_hash },
        parts: [{
          part_id: "1",
          approach: { artifact_id: approach.artifact_id, version: "v1", content_hash: approach.content_hash },
          alternates: [],
        }],
        approval: { reviewer_id: "e2e", approved_at: "2026-08-22T00:00:00Z" },
        content_hash: "",
        artifact_uri: `artifact://approach-set/${asId}@v1`,
      };
      payload.content_hash = canonicalHash(payload, "authoring");
      writeVersioned(outDir, "approach-set", asId, payload);
      return { asId, payload };
    };
    // 主讲法 ApproachSet（default variant 引用）；alternate variant 有独立
    // ApproachSet（引用 TA-02）——同题不同讲法，传递依赖不漂移。
    const primarySet = makeApproachSet("01", primaryApproach);
    const asId = primarySet.asId;
    const approachSet = primarySet.payload;
    const alternateApproach = spec.alternateTpId ? makeApproach(spec, "02") : undefined;
    const alternateSet = alternateApproach ? makeApproachSet("02", alternateApproach) : undefined;

    const ppId = "PP-E2E-001";
    const profile: Record<string, unknown> = {
      schema: "ai_teaching_tutor_policy_profile/v1",
      artifact_id: ppId,
      version: "v1",
      status: "Approved",
      profile_version: "2026-08-22.1",
      primary_provider: "deepseek-langgraph",
      fallback_provider: "deterministic-rules",
      model_id: "deepseek-v4-flash",
      prompt_version: "policy-voice-deepseek/v1",
      approval: { reviewer_id: "e2e", approved_at: "2026-08-22T00:00:00Z" },
      content_hash: "",
      artifact_uri: `artifact://tutor-policy-profile/${ppId}@v1`,
    };
    profile.content_hash = canonicalHash(profile, "authoring");
    writeVersioned(outDir, "tutor-policy-profile", ppId, profile);

    const variants: Array<Record<string, unknown>> = [];
    const publish = (tpId: string, variantSeed: string, role: "default" | "alternate") => {
      const { plan } = buildPlan(spec, tpId, variantSeed, spec.action === "make-parallel" && role === "default");
      const setRef = role === "alternate" && alternateSet ? alternateSet : primarySet;
      const planV3 = upgradePlanToV3(
        plan,
        setRef.asId,
        setRef.payload.content_hash as string,
        ppId,
        profile.profile_version as string,
        profile.content_hash as string,
      );
      (planV3 as { version: string }).version = "v2";
      // v3 新增字段改变投影：重算 projection_hash 后回填（先改版本再算）。
      const snapshot = buildRuntimeRegistrySnapshot();
      const approachForVariant = role === "alternate" && alternateApproach ? alternateApproach : primaryApproach;
      const { projection_hash } = projectApprovedPlan(planV3 as unknown as TutorPlanV2Payload, {
        truth: makeTruth(spec) as unknown as TruthPayload,
        approaches: new Map([[approachForVariant.artifact_id, approachForVariant as unknown as ApproachPayload]] as const),
        snapshot,
      });
      planV3.runtime_projection = {
        ...(plan.runtime_projection as Record<string, unknown>),
        projection_hash,
      };
      planV3.content_hash = canonicalHash(planV3, "plan");
      writeVersioned(outDir, "tutor-plan", tpId, planV3);
      variants.push({
        approach_set_ref: { artifact_id: setRef.asId, version: "v1", content_hash: setRef.payload.content_hash },
        tutor_plan_ref: { artifact_id: tpId, version: "v2", content_hash: planV3.content_hash },
        role,
      });
    };

    publish(spec.tpId, "01", "default");
    if (spec.alternateTpId) publish(spec.alternateTpId, "02", "alternate");

    const binding: Record<string, unknown> = {
      schema: "ai_teaching_topic_question_binding/v1",
      artifact_id: `TB-E2E-${spec.qtId.slice(-3)}01`,
      version: "v1",
      status: "Approved",
      task_id: spec.taskId,
      scenario_id: spec.scenarioId,
      question_ref: { artifact_id: spec.qtId, version: "v1", content_hash: truth.content_hash },
      teaching_variants: variants,
      approval: { reviewer_id: "e2e", approved_at: "2026-08-22T00:00:00Z" },
      content_hash: "",
      artifact_uri: `artifact://topic-question-binding/TB-E2E-${spec.qtId.slice(-3)}01@v1`,
    };
    binding.content_hash = canonicalHash(binding, "authoring");
    writeVersioned(outDir, "topic-question-binding", binding.artifact_id as string, binding);
  }

  process.stdout.write(`${outDir}\n`);
}

main();
