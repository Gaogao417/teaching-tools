/**
 * C-PLN deterministic benchmark cases（Phase 4 / P4-10）。
 *
 * evaluation-scope.yaml plan 阶段 3 个 case，输入是 Phase 4 真实产物
 * （skills 仓 canonical-authoring/tutor-plan/ 的 Approved TutorPlanBundle v2）：
 *
 * - C-PLN-01（QT-SMV-002）checkpoint/route/resource 覆盖与 Hint 单调性；
 * - C-PLN-02（QT-SMV-001）Action 复用/生成正确性与 answer leakage
 *   （fail-closed 演练：注入泄漏 hint 必须被识别）；
 * - C-PLN-03（QT-SMV-005）物化确定性（同 Approved Plan + 同 materializer/registry
 *   version ⇒ 同 projection hash；registry 漂移必改 hash）。
 *
 * 判定全部确定性（不调模型）；Plan 资源质量 rubric v1 = coverage / monotonicity /
 * leakage-isolation / determinism 四维机判，语义质量（提示措辞是否过强、annotation
 * 是否牵强）由教师 preview 走查 + Phase 7 LLM-judge 初筛。
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import * as path from "node:path";

import {
  benchmarkRunSchema,
  validatePayload,
} from "../../../../shared/canonical";
import {
  type TruthPayload,
  type TutorPlanV2Payload,
  loadApprovedTruth,
  loadCurrentPlan,
} from "../planBuild/canonicalInputs";
import {
  type MaterializationInputs,
  projectApprovedPlan,
  validateApprovedPlan,
} from "../planBuild/MaterializeTutorPlan";
import { buildRuntimeRegistrySnapshot } from "../planBuild/RuntimeRegistrySnapshot";
import { loadApprovedApproach } from "../planBuild/canonicalInputs";

export const PLAN_RUNNER_VERSION = "benchmark-runner-plan-0.1.0";

export const GOLDEN_TP_BY_QT: Record<string, string> = {
  "QT-SMV-001": "TP-SMV-001",
  "QT-SMV-002": "TP-SMV-002",
  "QT-SMV-003": "TP-SMV-003",
  "QT-SMV-004": "TP-SMV-004",
  "QT-SMV-005": "TP-SMV-005",
  "QT-SMV-006": "TP-SMV-006",
};

export interface PlanCaseResult {
  case_id: string;
  stage: "plan";
  status: "pass" | "fail";
  failure_class?: string;
  metrics?: { detail?: string };
}

export interface PlanInputs {
  /** canonical-authoring 根。 */
  canonicalRoot: string;
}

const FAILURE = {
  missingInput: "input_missing",
  structureInvalid: "plan_structure_invalid",
  leakDetected: "answer_leak_not_detected",
  determinism: "projection_hash_divergence",
} as const;

function fail(caseId: string, failureClass: string, detail: string): PlanCaseResult {
  return { case_id: caseId, stage: "plan", status: "fail", failure_class: failureClass, metrics: { detail } };
}

function pass(caseId: string, detail?: string): PlanCaseResult {
  return { case_id: caseId, stage: "plan", status: "pass", ...(detail ? { metrics: { detail } } : {}) };
}

function materializationInputsFor(
  inputs: PlanInputs,
  plan: TutorPlanV2Payload,
  truth: TruthPayload,
): MaterializationInputs {
  const snapshot = buildRuntimeRegistrySnapshot();
  const approaches = new Map();
  for (const ref of plan.approach_refs) {
    const approach = loadApprovedApproach({ canonicalRoot: inputs.canonicalRoot }, ref.artifact_id);
    if (approach.ok) approaches.set(ref.artifact_id, approach.payload);
  }
  return { truth, approaches, snapshot };
}

function loadGoldenPlan(inputs: PlanInputs, qtId: string): TutorPlanV2Payload | null {
  const tpId = GOLDEN_TP_BY_QT[qtId];
  if (!tpId) return null;
  const registryDir = path.join(inputs.canonicalRoot, "tutor-plan");
  if (!existsSync(path.join(registryDir, tpId, "registry.yaml"))) return null;
  const result = loadCurrentPlan({ canonicalRoot: inputs.canonicalRoot }, tpId);
  return result.ok ? result.payload : null;
}

export function runPlanCases(inputs: PlanInputs): PlanCaseResult[] {
  const results: PlanCaseResult[] = [];

  // ---- C-PLN-01: checkpoint/route/resource 覆盖 + hint 单调性（QT-SMV-002）----
  {
    const caseId = "C-PLN-01";
    const plan = loadGoldenPlan(inputs, "QT-SMV-002");
    const truthResult = loadApprovedTruth({ canonicalRoot: inputs.canonicalRoot }, "QT-SMV-002");
    if (!plan || !truthResult.ok) {
      results.push(fail(caseId, FAILURE.missingInput, "QT-SMV-002 的 Approved TutorPlan/Truth 缺失"));
    } else {
      const truth = truthResult.payload;
      const problems: string[] = [];
      const schema = validatePayload(plan as unknown as Record<string, unknown>);
      if (!schema.ok) problems.push(`schema: ${schema.errors.join(";")}`);
      if (plan.status !== "Approved" || !plan.approval?.reviewer_id) problems.push("非 Approved 或缺 approval");
      const partIds = truth.subquestions?.length
        ? truth.subquestions.map((entry) => entry.part_id)
        : ["1"];
      for (const partId of partIds) {
        const partCheckpoints = plan.checkpoints.filter((checkpoint) => checkpoint.part_id === partId);
        if (!partCheckpoints.length) problems.push(`part ${partId} 无 checkpoint`);
        const primary = plan.recommended_routes.find(
          (route) => route.role === "primary" && route.part_id === partId,
        );
        if (!primary) problems.push(`part ${partId} 无 primary 路线`);
        else if (primary.checkpoint_ids.join(",") !== partCheckpoints.map((c) => c.checkpoint_id).join(",")) {
          problems.push(`part ${partId} primary 路线未覆盖全部 checkpoint`);
        }
      }
      for (const checkpoint of plan.checkpoints) {
        const hints = plan.resources
          .filter((resource) => resource.kind === "hint" && resource.checkpoint_id === checkpoint.checkpoint_id)
          .map((resource) => resource.assistance_level ?? 0)
          .sort((a, b) => a - b);
        if (hints.length < 2 || hints.some((level, index) => index > 0 && level <= hints[index - 1])) {
          problems.push(`${checkpoint.checkpoint_id} hint 不满足 ≥2 档严格递增`);
        }
        for (const resourceId of checkpoint.resource_ids ?? []) {
          if (!plan.resources.some((resource) => resource.resource_id === resourceId)) {
            problems.push(`${checkpoint.checkpoint_id} 悬空资源引用 ${resourceId}`);
          }
        }
      }
      results.push(
        problems.length
          ? fail(caseId, FAILURE.structureInvalid, problems.join("; "))
          : pass(
              caseId,
              `${plan.checkpoints.length} checkpoints / ${plan.recommended_routes.length} routes：` +
                `part 全覆盖、primary 路线覆盖全部节点、每节点 hint ≥2 档严格递增`,
            ),
      );
    }
  }

  // ---- C-PLN-02: Action 复用/生成正确性 + answer leakage（QT-SMV-001）----
  {
    const caseId = "C-PLN-02";
    const plan = loadGoldenPlan(inputs, "QT-SMV-001");
    const truthResult = loadApprovedTruth({ canonicalRoot: inputs.canonicalRoot }, "QT-SMV-001");
    if (!plan || !truthResult.ok) {
      results.push(fail(caseId, FAILURE.missingInput, "QT-SMV-001 的 Approved TutorPlan/Truth 缺失"));
    } else {
      const truth = truthResult.payload;
      const problems: string[] = [];
      const templates = plan.resources.filter((resource) => resource.kind === "action_template");
      if (!templates.length) problems.push("无 action_template 资源（Action 复用/生成不可评）");
      const gate = validateApprovedPlan(plan, materializationInputsFor(inputs, plan, truth));
      if (!gate.ok) problems.push(`发布门禁未过: ${gate.errors.join("; ")}`);
      // fail-closed 演练：注入泄漏 hint（含真实答案值），判定函数必须识别
      const answerValue = truth.subquestions?.[0]?.canonical_answer.value ?? truth.canonical_answer?.value ?? "";
      const leaking = JSON.parse(JSON.stringify(plan)) as TutorPlanV2Payload;
      const hintIndex = leaking.resources.findIndex((resource) => resource.kind === "hint");
      leaking.resources[hintIndex].content = `小提示：这一步的结果就是 ${answerValue}`;
      const leakCheck = validateApprovedPlan(leaking, materializationInputsFor(inputs, plan, truth));
      if (leakCheck.ok) problems.push("fail-closed 演练失败：注入答案值的 hint 未被识别");
      results.push(
        problems.length
          ? fail(caseId, FAILURE.leakDetected, problems.join("; "))
          : pass(
              caseId,
              `${templates.length} 个 ActionTemplate 通过 render smoke + typed evaluator + assessment ` +
                `truth isolation；注入泄漏样本被 fail-closed 识别`,
            ),
      );
    }
  }

  // ---- C-PLN-03: 物化确定性（QT-SMV-005；同输入同 hash，registry 变必改 hash）----
  {
    const caseId = "C-PLN-03";
    const plan = loadGoldenPlan(inputs, "QT-SMV-005");
    const truthResult = loadApprovedTruth({ canonicalRoot: inputs.canonicalRoot }, "QT-SMV-005");
    if (!plan || !truthResult.ok) {
      results.push(fail(caseId, FAILURE.missingInput, "QT-SMV-005 的 Approved TutorPlan/Truth 缺失"));
    } else {
      const truth = truthResult.payload;
      const materializationInputs = materializationInputsFor(inputs, plan, truth);
      const first = projectApprovedPlan(plan, materializationInputs);
      const second = projectApprovedPlan(JSON.parse(JSON.stringify(plan)), materializationInputs);
      const driftedSnapshot = {
        ...materializationInputs.snapshot,
        runtime_registry_version: "action-runtime-registry/v5@drift0000000",
      };
      const drifted = projectApprovedPlan(plan, { ...materializationInputs, snapshot: driftedSnapshot });
      const problems: string[] = [];
      if (first.projection_hash !== second.projection_hash) problems.push("同输入两次投影 hash 不一致");
      if (first.projection_hash === drifted.projection_hash) problems.push("registry 漂移未改变 hash");
      if (plan.runtime_projection && plan.runtime_projection.projection_hash !== first.projection_hash) {
        problems.push("canonical 记录的 projection_hash 与重算不一致");
      }
      if (plan.runtime_projection && plan.runtime_projection.runtime_registry_version !== materializationInputs.snapshot.runtime_registry_version) {
        problems.push("canonical 记录的 registry version 与当前 registry 不一致");
      }
      results.push(
        problems.length
          ? fail(caseId, FAILURE.determinism, problems.join("; "))
          : pass(
              caseId,
              `同 Approved Plan + materializer/registry version ⇒ 同 projection hash ` +
                `(${first.projection_hash.slice(0, 19)}…)；registry 漂移 hash 改变`,
            ),
      );
    }
  }

  return results;
}

export interface PlanRunInput {
  runId: string;
  sutId: string;
  datasetId: string;
  datasetVersion: string;
  inputs: PlanInputs;
  startedAt?: string;
}

export type PlanRunResult =
  | { ok: true; record: Record<string, unknown> }
  | { ok: false; errors: readonly string[] };

export function buildPlanRun(input: PlanRunInput): PlanRunResult {
  const caseResults = runPlanCases(input.inputs);
  const passed = caseResults.filter((result) => result.status === "pass").length;
  const failed = caseResults.filter((result) => result.status === "fail").length;
  const configHash = createHash("sha256")
    .update(JSON.stringify({ runner: PLAN_RUNNER_VERSION, dataset: input.datasetId }))
    .digest("hex");
  const record = {
    schema: "ai_teaching_benchmark_run/v1",
    run_id: input.runId,
    dataset_id: input.datasetId,
    dataset_version: input.datasetVersion,
    sut: {
      sut_id: input.sutId,
      config_hash: `sha256:${configHash}`,
      config_artifact_uri: `artifact://sut-config/${input.sutId.replace(/^sut-/, "")}@v1`,
    },
    status: "completed",
    case_results: caseResults,
    runner_version: PLAN_RUNNER_VERSION,
    environment: `node ${process.version}`,
    started_at: input.startedAt ?? new Date().toISOString(),
    completed_at: new Date().toISOString(),
    summary: { passed, failed, errored: 0, not_executed: 0 },
  };
  const validation = validatePayload(record);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  benchmarkRunSchema.parse(record);
  return { ok: true, record };
}
