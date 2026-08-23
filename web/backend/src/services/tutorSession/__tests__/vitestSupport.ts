/**
 * Vitest 专用测试工件（Phase 5 remediation）：静态 import 版合成 canonical
 * root（与 node 版 support.ts 同管线：truth/TA→build→approve→materialize→
 * publish）。SQLITE_PATH 已由 vitest.setup.ts 在模块图加载前落好。
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  canonicalHash,
  type TruthPayload,
  type ApproachPayload,
  type TutorPlanV2Payload,
} from "../../planBuild/canonicalInputs";
import { buildTutorPlanDraft } from "../../planBuild/BuildTutorPlan";
import { approveTutorPlan } from "../../planBuild/ReviewTutorPlan";
import { materializeTutorPlan, projectApprovedPlan, MATERIALIZER_VERSION } from "../../planBuild/MaterializeTutorPlan";
import { buildRuntimeRegistrySnapshot } from "../../planBuild/RuntimeRegistrySnapshot";

export const SHA = (seed: string): string => `sha256:${createHash("sha256").update(seed).digest("hex")}`;

export function tempRoot(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

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
    prompt: `(${index + 1}) 求证：$\\triangle AOB \\sim \\triangle DOC$；`,
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
    ...(partCount > 0
      ? { subquestions }
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
    entry_signal: "学生能先指出目标三角形，再转换条件",
    steps: [
      {
        step_id: "S1",
        intent: "识别目标三角形",
        narration: "看两个三角形。",
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
        narration: "AA 判定。",
        expected_student_reasoning: "学生能写出 AA 判定结论",
        common_errors: ["在斜三角形中硬凑勾股"],
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

export interface SyntheticPlanOptions {
  qtId: string;
  tpId: string;
  parts: number;
  /** 每个 part 的 step 数（默认 3：S1/S2/S3 → 3 checkpoints + alternate route）。 */
  stepsPerPart?: number;
  /** 波次 C-2 裁定 1：注入 make-parallel 白板动作模板（input.geometry 携带
   *  authored TopicGeometryModel），替换自动生成的 action_template 资源——
   *  与 scripts/build-tutor-e2e-root.ts 的 replaceActionWithMakeParallel 同规则。 */
  makeParallelAction?: boolean;
}

export function publishSyntheticPlanVt(root: string, options: SyntheticPlanOptions): TutorPlanV2Payload {
  const { qtId, tpId, parts } = options;
  const stepsPerPart = options.stepsPerPart ?? 3;
  const truth = makeTruth(qtId, parts) as unknown as TruthPayload;
  writeVersioned(root, "question-truth", qtId, truth as unknown as Record<string, unknown>);
  const qtSeq = qtId.slice(-1);
  const approaches = Array.from({ length: parts === 0 ? 1 : parts }, (_, index) => {
    const taId = `TA-TST-${qtSeq}0${index + 1}`;
    const approach = makeApproach(qtId, taId, parts === 0 ? undefined : String(index + 1), truth.content_hash) as unknown as ApproachPayload;
    const steps = (approach as unknown as { steps: unknown[] }).steps;
    (approach as unknown as { steps: unknown[] }).steps = steps.slice(0, stepsPerPart);
    return approach;
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
  if (options.makeParallelAction) {
    // 与 scripts/build-tutor-e2e-root.ts 同规则：注入 make-parallel 模板后
    // 必须重算 allowed_capabilities 与 content_hash（approve 前），否则
    // 五重校验 capability allowlist 拒绝。
    const draft = build.plan as unknown as {
      resources: Array<{ resource_id: string; kind: string; capability?: string; checkpoint_id?: string }>;
      checkpoints: Array<{ checkpoint_id: string }>;
      policy_constraints: { allowed_capabilities: string[] };
      content_hash: string;
    };
    const lastCheckpointId = draft.checkpoints[draft.checkpoints.length - 1].checkpoint_id;
    draft.resources = draft.resources.filter((resource) => resource.kind !== "action_template");
    draft.resources.push({
      resource_id: `RES${draft.resources.length + 1}`,
      kind: "action_template",
      checkpoint_id: lastCheckpointId,
      source: "agent_generated",
      action_ref: `tp:${tpId}:1:make-parallel`,
      capability: "similarity.construct-parallel-helper",
      content: JSON.stringify(makeParallelActionTemplate(tpId)),
    } as never);
    draft.policy_constraints.allowed_capabilities = [
      ...new Set(draft.resources.flatMap((resource) => (resource.capability ? [resource.capability] : []))),
    ].sort();
    draft.content_hash = canonicalHash(build.plan as unknown as Record<string, unknown>, "plan");
  }
  const inputs = {
    truth,
    approaches: new Map(approaches.map((approach) => [approach.artifact_id, approach] as const)),
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
  return materialized.plan;
}

// --------------------------------------------------------------------------- //
// Phase 5 UI 集成（波次 C）：公开 tpId 直启 HTTP 路由下线后，测试用协调器
// 内部启动路径（benchmark/runner 等价面）准备会话，返回与原 POST / 响应同形
// 的 { session_id, opening } 学生安全面。
// --------------------------------------------------------------------------- //

export async function startViaCoordinator(
  coordinator: import("../TutorSession").TutorSessionCoordinator,
  options: { sessionId: string; tpId: string; studentId: string; initialMode?: "teach" | "guided_solve" | "repair" },
): Promise<{ session_id: string; opening: any }> {
  const { tutorOpeningBody } = await import("../../../transport/http/tutorSessionRoutes");
  coordinator.start(options);
  const turn = await coordinator.driveTutorTurn(options.sessionId, { kind: "system", reason: "session_started" });
  return { session_id: options.sessionId, opening: tutorOpeningBody(coordinator, options.sessionId, turn) };
}

// --------------------------------------------------------------------------- //
// Phase 5 UI 集成（波次 B）：v3 plan + ApproachSet + Binding + PolicyProfile
// 合成发布（在 publishSyntheticPlanVt 的 v2 管线之上升级为 v3 并登记周边合同）。
// --------------------------------------------------------------------------- //

/** make-parallel 白板动作模板（与 build-tutor-e2e-root.ts 的同形布局）。 */
function makeParallelActionTemplate(tpId: string): Record<string, unknown> {
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

export interface SyntheticV3ExperienceOptions {
  qtId: string;
  tpId: string;
  /** alternate 讲法的第二个 plan（同一题、独立 ApproachSet 由测试自行改造时用）。 */
  alternateTpId?: string;
  taskId: string;
  scenarioId: string;
  profileId?: string;
  /** 波次 C-2 裁定 1：默认 plan 注入 make-parallel 白板动作（input.geometry）。 */
  makeParallelAction?: boolean;
  /** 波次 E（教师问「讲完第一小题怎么进第二小题」）：小问数，0=整题。 */
  parts?: number;
}

export interface SyntheticV3Experience {
  binding: Record<string, unknown>;
  approachSet: Record<string, unknown>;
  profile: Record<string, unknown>;
  planV3: Record<string, unknown>;
  alternatePlanV3?: Record<string, unknown>;
}

function makeApproachSetPayload(qtId: string, asId: string, truth: Record<string, unknown>, parts: number): Record<string, unknown> {
  const truthHash = (truth as { content_hash: string }).content_hash;
  const payload: Record<string, unknown> = {
    schema: "ai_teaching_approach_set/v1",
    artifact_id: asId,
    version: "v1",
    status: "Approved",
    question_ref: { artifact_id: qtId, version: "v1", content_hash: truthHash },
    parts: Array.from({ length: parts === 0 ? 1 : parts }, (_, index) => ({
      ...(parts === 0 ? {} : { part_id: String(index + 1) }),
      approach: {
        artifact_id: `TA-TST-${qtId.slice(-1)}0${index + 1}`,
        version: "v1",
        content_hash: SHA(`ta-${qtId}-${index + 1}`),
      },
      alternates: [],
    })),
    approval: { reviewer_id: "tst", approved_at: "2026-08-22T00:00:00Z" },
    content_hash: "",
    artifact_uri: `artifact://approach-set/${asId}@v1`,
  };
  payload.content_hash = canonicalHash(payload, "authoring");
  return payload;
}

function makePolicyProfilePayload(ppId: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    schema: "ai_teaching_tutor_policy_profile/v1",
    artifact_id: ppId,
    version: "v1",
    status: "Approved",
    profile_version: "2026-08-22.1",
    primary_provider: "deepseek-langgraph",
    fallback_provider: "deterministic-rules",
    model_id: "deepseek-v4-flash",
    prompt_version: "policy-voice-deepseek/v1",
    approval: { reviewer_id: "tst", approved_at: "2026-08-22T00:00:00Z" },
    content_hash: "",
    artifact_uri: `artifact://tutor-policy-profile/${ppId}@v1`,
  };
  payload.content_hash = canonicalHash(payload, "authoring");
  return payload;
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


/** v3 新增字段会改变 materializer 投影：升级后重算 projection_hash 并回填。 */
function refreshV3Projection(
  root: string,
  qtId: string,
  planV3: Record<string, unknown>,
  v2Plan: TutorPlanV2Payload,
): void {
  const truth = JSON.parse(
    readFileSync(path.join(root, "question-truth", qtId, "v1.json"), "utf8"),
  ) as TruthPayload;
  const taId = `TA-TST-${qtId.slice(-1)}01`;
  const approach = JSON.parse(
    readFileSync(path.join(root, "teaching-approach", taId, "v1.json"), "utf8"),
  ) as ApproachPayload;
  const inputs = {
    truth,
    approaches: new Map([[taId, approach]] as const),
    snapshot: buildRuntimeRegistrySnapshot(),
  };
  const { projection_hash } = projectApprovedPlan(planV3 as unknown as TutorPlanV2Payload, inputs);
  planV3.runtime_projection = {
    ...(v2Plan.runtime_projection as Record<string, unknown>),
    projection_hash,
  };
  planV3.content_hash = canonicalHash(planV3, "plan");
}

export function publishSyntheticV3Experience(
  root: string,
  options: SyntheticV3ExperienceOptions,
): SyntheticV3Experience {
  const { qtId, tpId, taskId, scenarioId } = options;
  const ppId = options.profileId ?? "PP-TST-001";
  const v2 = publishSyntheticPlanVt(root, {
    qtId,
    tpId,
    parts: options.parts ?? 0,
    ...(options.makeParallelAction ? { makeParallelAction: true } : {}),
  });
  const asId = `AS-TST-${qtId.slice(-1)}01`;
  const approachSet = makeApproachSetPayload(qtId, asId, v2 as unknown as Record<string, unknown>, options.parts ?? 0);
  // AS 引用的 TA hash 必须与真实发布的 TA 一致（对账用 truth.content_hash
  // 无关；approach hash 直接取注册表内 TA 的 content_hash）。波次 E：逐
  // part 修补（多小问时 TA-…01..N 全部对齐，此前只修第 1 问导致
  // approachRefsMatchSet fail closed）。
  (approachSet.parts as Array<{ approach: { content_hash: string } }>).forEach((part, index) => {
    const taId = `TA-TST-${qtId.slice(-1)}0${index + 1}`;
    const taPath = path.join(root, "teaching-approach", taId, "v1.json");
    const taPayload = JSON.parse(readFileSync(taPath, "utf8")) as { content_hash: string };
    part.approach.content_hash = taPayload.content_hash;
  });
  approachSet.content_hash = canonicalHash(approachSet, "authoring");
  writeVersioned(root, "approach-set", asId, approachSet);

  const profile = makePolicyProfilePayload(ppId);
  writeVersioned(root, "tutor-policy-profile", ppId, profile);

  const planV3 = upgradePlanToV3(
    v2,
    asId,
    approachSet.content_hash as string,
    ppId,
    profile.profile_version as string,
    profile.content_hash as string,
  );
  // v3 作为该 plan registry 的 v2 版本发布（v1 保留为 v2-schema 历史版本）。
  // 投影 body 含 plan.version，必须先改版本号再重算 projection_hash。
  (planV3 as { version: string }).version = "v2";
  refreshV3Projection(root, qtId, planV3, v2);
  writeVersioned(root, "tutor-plan", tpId, planV3);

  let alternatePlanV3: Record<string, unknown> | undefined;
  const variants: Array<Record<string, unknown>> = [
    {
      approach_set_ref: { artifact_id: asId, version: "v1", content_hash: approachSet.content_hash },
      tutor_plan_ref: { artifact_id: tpId, version: "v2", content_hash: planV3.content_hash },
      role: "default",
    },
  ];
  if (options.alternateTpId) {
    const altV2 = publishSyntheticPlanVt(root, { qtId, tpId: options.alternateTpId, parts: 0 });
    alternatePlanV3 = upgradePlanToV3(
      altV2,
      asId,
      approachSet.content_hash as string,
      ppId,
      profile.profile_version as string,
      profile.content_hash as string,
    );
    (alternatePlanV3 as { version: string }).version = "v2";
    refreshV3Projection(root, qtId, alternatePlanV3, altV2);
    writeVersioned(root, "tutor-plan", options.alternateTpId, alternatePlanV3);
    variants.push({
      approach_set_ref: { artifact_id: asId, version: "v1", content_hash: approachSet.content_hash },
      tutor_plan_ref: { artifact_id: options.alternateTpId, version: "v2", content_hash: alternatePlanV3.content_hash },
      role: "alternate",
    });
  }

  const binding: Record<string, unknown> = {
    schema: "ai_teaching_topic_question_binding/v1",
    artifact_id: `TB-TST-${qtId.slice(-1)}01`,
    version: "v1",
    status: "Approved",
    task_id: taskId,
    scenario_id: scenarioId,
    question_ref: {
      artifact_id: qtId,
      version: "v1",
      content_hash: (v2 as unknown as { question_ref: { content_hash: string } }).question_ref.content_hash,
    },
    teaching_variants: variants,
    approval: { reviewer_id: "tst", approved_at: "2026-08-22T00:00:00Z" },
    content_hash: "",
    artifact_uri: `artifact://topic-question-binding/TB-TST-${qtId.slice(-1)}01@v1`,
  };
  binding.content_hash = canonicalHash(binding, "authoring");
  writeVersioned(root, "topic-question-binding", binding.artifact_id as string, binding);

  return { binding, approachSet, profile, planV3, ...(alternatePlanV3 ? { alternatePlanV3 } : {}) };
}
