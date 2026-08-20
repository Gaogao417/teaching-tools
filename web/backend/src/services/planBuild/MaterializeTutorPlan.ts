/**
 * Deterministic materializer + projection hash（Phase 4 / P4-08/P4-09，ADR-006 §2）。
 *
 * 发布前 fail-closed 门禁（全部通过才允许写入 runtime_projection）：
 *  1. canonical schema（Zod v2）与 publication 校验（Approved / 无绝对路径）；
 *  2. content_hash 自洽（TP 排除集：authoring 集 + runtime_projection）；
 *  3. version/stale：question_ref 必须 == QT current Approved（版本+hash），
 *     approach_refs 必须 == 各 TA current Approved 且 part 绑定合法、part 全覆盖；
 *  4. capability：资源与 policy 引用的 capability ⊆ registry snapshot；
 *  5. action_template：kind 必须在 registry（缺 primitive fail）、render smoke
 *     （learn/assessment 双投影过 isExercisePlan，assessment 无 truth）、
 *     typed evaluator smoke（正证据 accepted / 误证据 rejected）；
 *  6. truth leak：hint/probe/voice_seed 不得含 part 答案值（归一化匹配），
 *     任何资源不得出现 canonical_answer/reviewed_solution 键，repair 不得整段
 *     复述官方解答；
 *  7. hint ladder：每个 checkpoint ≥2 档且 assistance_level 严格递增（P4-05）；
 *  8. skill annotation：skill ∈ 冻结集，evidence_refs 指向绑定 TA 的真实 step；
 *  9. registry 版本一致：build_provenance.runtime_registry_version == snapshot。
 *
 * 确定性投影：projection = f(plan 内容, materializer_version, registry_version)，
 * hash 对相同输入恒等（排序键稳定序列化）；registry/plan 任何变化都会改变 hash。
 */
import { createHash } from "node:crypto";

import type { ActionContract, AuthoredActionTemplate } from "../../../../shared/actionRuntime";
import { validateForPublication, validatePayload } from "../../../../shared/canonical";
import { normalizeForMatch, staticAnswerTargets } from "../benchmark/approachCases";
import {
  evaluatorSmoke,
  smokeActionTemplate,
} from "./adapters/actionRuntimeV5/adapter";
import {
  type ApproachPayload,
  type TruthPayload,
  type TutorPlanV2Payload,
  canonicalHash,
  truthPartIds,
  truthSolutionForPart,
} from "./canonicalInputs";
import { type RuntimeRegistrySnapshot, unknownCapabilities } from "./RuntimeRegistrySnapshot";
import { FROZEN_SKILL_IDS } from "./BuildTutorPlan";

export const MATERIALIZER_VERSION = "tutor-plan-materializer/0.1.0";

export interface MaterializationInputs {
  readonly truth: TruthPayload;
  /** plan.approach_refs 涉及的 TA（key = artifact_id）；必须 current Approved。 */
  readonly approaches: ReadonlyMap<string, ApproachPayload>;
  readonly snapshot: RuntimeRegistrySnapshot;
}

export type ValidationOutcome = { ok: true } | { ok: false; errors: string[] };

export interface RuntimeProjectionBody {
  plan_ref: { artifact_id: string; version: string; content_hash: string };
  parts: Array<{
    part_id: string;
    route_ids: string[];
    checkpoints: Array<{
      checkpoint_id: string;
      skill_annotation_ids: string[];
      resource_ids: string[];
      hint_levels: number[];
    }>;
  }>;
  action_contracts: Array<{
    resource_id: string;
    action_ref: string;
    learn: ActionContract;
    assessment: ActionContract;
  }>;
}

const FORBIDDEN_RESOURCE_KEYS = new Set(["canonical_answer", "reviewed_solution"]);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function containsForbiddenKey(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = containsForbiddenKey(item);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === "object") {
    for (const [key, nested] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_RESOURCE_KEYS.has(key)) return key;
      const hit = containsForbiddenKey(nested);
      if (hit) return hit;
    }
  }
  return null;
}

/** 发布前全部 fail-closed 门禁（不修改 plan）。
 *
 * requireApproved=false 用于 Draft 审核路径：跳过 Approved-only 的
 * publication/status 门（schema 的条件必填在 Draft 下自然放宽），
 * 其余内容门禁（绑定/capability/leak/ladder/annotation/registry）全量执行。
 */
export function validateApprovedPlan(
  plan: TutorPlanV2Payload,
  inputs: MaterializationInputs,
  options: { requireApproved?: boolean } = {},
): ValidationOutcome {
  const requireApproved = options.requireApproved !== false;
  const errors: string[] = [];
  const { truth, snapshot } = inputs;

  // 1. schema + publication
  const schema = validatePayload(plan as unknown as Record<string, unknown>);
  if (!schema.ok) errors.push(`schema: ${schema.errors.join("; ")}`);
  if (requireApproved) {
    const publication = validateForPublication(plan);
    if (publication.length) {
      errors.push(`publication: ${publication.map((issue) => `${issue.code}(${issue.detail})`).join("; ")}`);
    }
    if (plan.status !== "Approved") errors.push(`status=${plan.status}：materializer 只接受 Approved`);
  }

  // 2. content_hash 自洽
  const recomputed = canonicalHash(plan as unknown as Record<string, unknown>, "plan");
  if (recomputed !== plan.content_hash) errors.push("content_hash 与内容不一致（漂移或被篡改）");
  if (plan.artifact_uri !== `artifact://tutor-plan/${plan.artifact_id}@${plan.version}`) {
    errors.push(`artifact_uri 与 artifact_id@version 不一致: ${plan.artifact_uri}`);
  }

  // 3. version/stale 绑定
  if (plan.question_ref.artifact_id !== truth.artifact_id) {
    errors.push(`question_ref 绑定 ${plan.question_ref.artifact_id}，期望 ${truth.artifact_id}`);
  }
  if (plan.question_ref.version !== truth.version || plan.question_ref.content_hash !== truth.content_hash) {
    errors.push(
      `question_ref 绑定 ${plan.question_ref.artifact_id}@${plan.question_ref.version}，` +
        `当前 ${truth.version}（stale：QuestionTruth 已升版，plan 必须重建）`,
    );
  }
  const hasSubquestions = Boolean(truth.subquestions?.length);
  const partIds = truthPartIds(truth);
  const referencedParts = new Set<string>();
  for (const ref of plan.approach_refs) {
    const approach = inputs.approaches.get(ref.artifact_id);
    if (!approach) {
      errors.push(`approach_ref ${ref.artifact_id} 不在 current Approved 集合中（缺失或 stale）`);
      continue;
    }
    if (ref.version !== approach.version || ref.content_hash !== approach.content_hash) {
      errors.push(
        `approach_ref ${ref.artifact_id} 绑定 ${ref.version}，当前 ${approach.version}（stale）`,
      );
    }
    if (approach.question_ref.artifact_id !== truth.artifact_id) {
      errors.push(`approach_ref ${ref.artifact_id} 绑定题目 ${approach.question_ref.artifact_id}`);
    }
    if (hasSubquestions) {
      if (!partIds.includes(ref.part_id)) errors.push(`approach_ref ${ref.artifact_id} part ${ref.part_id} 不在题面小问列表`);
      else if (approach.question_ref.part_id !== ref.part_id) {
        errors.push(`approach_ref ${ref.artifact_id} 声明 part ${ref.part_id}，TA 实际绑定 ${approach.question_ref.part_id ?? "(整题)"}`);
      }
    } else if (ref.part_id !== "1" || approach.question_ref.part_id !== undefined) {
      errors.push(`整题计划的 approach_ref ${ref.artifact_id} 必须使用约定 part "1" 且 TA 为整题绑定`);
    }
    referencedParts.add(ref.part_id);
  }
  for (const partId of partIds) {
    if (!referencedParts.has(hasSubquestions ? partId : "1")) {
      errors.push(`part ${partId} 未被任何 approach_ref 覆盖`);
    }
  }

  // checkpoint/route/resource 引用完整性
  const checkpointIds = new Set(plan.checkpoints.map((checkpoint) => checkpoint.checkpoint_id));
  if (checkpointIds.size !== plan.checkpoints.length) errors.push("checkpoint_id 重复");
  const resourceIds = new Set(plan.resources.map((resource) => resource.resource_id));
  if (resourceIds.size !== plan.resources.length) errors.push("resource_id 重复");
  for (const checkpoint of plan.checkpoints) {
    if (!partIds.includes(hasSubquestions ? checkpoint.part_id : "1")) {
      errors.push(`${checkpoint.checkpoint_id} part_id ${checkpoint.part_id} 不在题面小问列表`);
    }
    for (const resourceId of checkpoint.resource_ids ?? []) {
      if (!resourceIds.has(resourceId)) errors.push(`${checkpoint.checkpoint_id} 引用不存在的 ${resourceId}`);
    }
  }
  for (const route of plan.recommended_routes) {
    for (const checkpointId of route.checkpoint_ids) {
      if (!checkpointIds.has(checkpointId)) errors.push(`路线 ${route.route_id} 引用不存在的 ${checkpointId}`);
    }
  }
  if (!plan.recommended_routes.some((route) => route.role === "primary")) {
    errors.push("缺少 primary 路线");
  }

  // 4. capability 校验
  const requested = [
    ...plan.policy_constraints.allowed_capabilities,
    ...plan.resources.flatMap((resource) => (resource.capability ? [resource.capability] : [])),
  ];
  const unknown = unknownCapabilities(snapshot, requested);
  if (unknown.length) errors.push(`非法 capability（不在 runtime registry）: ${unknown.join(", ")}`);

  // 5./7. action_template + hint ladder + 6. truth leak
  const hintLevelsByCheckpoint = new Map<string, number[]>();
  for (const resource of plan.resources) {
    if (resource.kind === "hint") {
      if (resource.checkpoint_id === undefined || resource.assistance_level === undefined) {
        errors.push(`${resource.resource_id} hint 缺少 checkpoint_id 或 assistance_level`);
        continue;
      }
      const levels = hintLevelsByCheckpoint.get(resource.checkpoint_id) ?? [];
      levels.push(resource.assistance_level);
      hintLevelsByCheckpoint.set(resource.checkpoint_id, levels);
    }
    const forbiddenKey = containsForbiddenKey(resource);
    if (forbiddenKey) errors.push(`${resource.resource_id} 携带禁止键 ${forbiddenKey}（truth 不得作为资源字段）`);

    if (resource.kind === "action_template") {
      if (!resource.content || !resource.action_ref) {
        errors.push(`${resource.resource_id} action_template 缺少 content/action_ref`);
        continue;
      }
      let template: AuthoredActionTemplate;
      try {
        template = JSON.parse(resource.content) as AuthoredActionTemplate;
      } catch {
        errors.push(`${resource.resource_id} action_template content 不是合法 JSON`);
        continue;
      }
      if (!snapshot.action_kinds.includes(template.kind)) {
        errors.push(`${resource.resource_id} 引用缺失 primitive：ActionKind ${template.kind} 不在 registry`);
        continue;
      }
      const smoke = smokeActionTemplate(template);
      if (!smoke.ok) errors.push(`${resource.resource_id} render smoke 失败: ${smoke.errors.join("; ")}`);
      const evaluator = evaluatorSmoke(template);
      if (!evaluator.ok) errors.push(`${resource.resource_id} evaluator smoke 失败: ${evaluator.errors.join("; ")}`);
    }
  }
  for (const checkpoint of plan.checkpoints) {
    const levels = (hintLevelsByCheckpoint.get(checkpoint.checkpoint_id) ?? []).sort((a, b) => a - b);
    const ascending = levels.every((level, index) => index === 0 || level > levels[index - 1]);
    if (levels.length < 2 || !ascending) {
      errors.push(
        `${checkpoint.checkpoint_id} hint 阶梯不满足 P4-05（需 ≥2 档严格递增，当前 [${levels.join(",")}]）`,
      );
    }
  }

  // 6. truth leak：hint/probe/voice_seed 不得含 part 答案值；repair 不得整段复述官方解答
  const partTargets = new Map<string, string[]>();
  for (const partId of partIds) {
    partTargets.set(
      partId,
      staticAnswerTargets(
        {
          artifact_id: truth.artifact_id,
          version: truth.version,
          status: truth.status,
          stem: truth.stem,
          canonical_answer: truth.canonical_answer,
          subquestions: truth.subquestions,
          content_hash: truth.content_hash,
        },
        hasSubquestions ? partId : undefined,
      ),
    );
  }
  for (const resource of plan.resources) {
    if (!resource.content) continue;
    if (resource.kind === "hint" || resource.kind === "diagnostic_probe" || resource.kind === "voice_seed") {
      const normalized = normalizeForMatch(resource.content);
      for (const [partId, targets] of partTargets) {
        const hit = targets.find((target) => target && normalized.includes(normalizeForMatch(target)));
        if (hit) {
          errors.push(
            `${resource.resource_id}（${resource.kind}，part ${partId}）泄漏答案值「${hit}」——过早泄题 fail closed`,
          );
        }
      }
    }
    if (resource.kind === "repair") {
      const checkpoint = plan.checkpoints.find((entry) => entry.checkpoint_id === resource.checkpoint_id);
      const partId = hasSubquestions ? checkpoint?.part_id : "1";
      const solution = partId ? truthSolutionForPart(truth, partId) : undefined;
      if (solution) {
        const solutionNormalized = normalizeForMatch(solution);
        if (solutionNormalized.length > 12 && normalizeForMatch(resource.content).includes(solutionNormalized)) {
          errors.push(`${resource.resource_id}（repair）整段复述官方 reviewed_solution`);
        }
      }
    }
  }

  // 8. skill annotation 校验
  for (const checkpoint of plan.checkpoints) {
    for (const annotation of checkpoint.skill_annotations ?? []) {
      if (!FROZEN_SKILL_IDS.has(annotation.skill_id)) {
        errors.push(`${checkpoint.checkpoint_id} 标注 ${annotation.skill_id} 不在 MVP 冻结 skill 集`);
      }
      for (const evidenceRef of annotation.evidence_refs) {
        const match = /^(TA-[A-Z0-9]+-\d+)@(v\d+)#(S\d+)$/.exec(evidenceRef);
        if (!match) {
          errors.push(`${checkpoint.checkpoint_id} 证据引用格式非法: ${evidenceRef}`);
          continue;
        }
        const approach = inputs.approaches.get(match[1]);
        if (!approach || !approach.steps.some((step) => step.step_id === match[3])) {
          errors.push(`${checkpoint.checkpoint_id} 证据引用不存在的 step: ${evidenceRef}`);
        }
      }
    }
  }

  // 9. registry 版本一致
  if (plan.build_provenance.runtime_registry_version !== snapshot.runtime_registry_version) {
    errors.push(
      `runtime registry 漂移：plan 构建于 ${plan.build_provenance.runtime_registry_version}，` +
        `当前 ${snapshot.runtime_registry_version}（必须重建 plan）`,
    );
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

/** 确定性投影（只读 plan；不改写、不调用模型）。 */
export function projectApprovedPlan(
  plan: TutorPlanV2Payload,
  inputs: MaterializationInputs,
): { projection: RuntimeProjectionBody; projection_hash: string } {
  const hasSubquestions = Boolean(inputs.truth.subquestions?.length);
  const parts = truthPartIds(inputs.truth).map((partId) => {
    const normalizedPartId = hasSubquestions ? partId : "1";
    return {
      part_id: partId,
      route_ids: plan.recommended_routes
        .filter((route) => route.part_id === normalizedPartId)
        .map((route) => route.route_id),
      checkpoints: plan.checkpoints
        .filter((checkpoint) => checkpoint.part_id === normalizedPartId)
        .map((checkpoint) => ({
          checkpoint_id: checkpoint.checkpoint_id,
          skill_annotation_ids: (checkpoint.skill_annotations ?? []).map((annotation) => annotation.skill_id),
          resource_ids: [...(checkpoint.resource_ids ?? [])],
          hint_levels: plan.resources
            .filter(
              (resource) =>
                resource.kind === "hint" && resource.checkpoint_id === checkpoint.checkpoint_id,
            )
            .map((resource) => resource.assistance_level ?? 0)
            .sort((a, b) => a - b),
        })),
    };
  });

  const actionContracts = plan.resources
    .filter((resource) => resource.kind === "action_template" && resource.content && resource.action_ref)
    .map((resource) => {
      const template = JSON.parse(resource.content as string) as AuthoredActionTemplate;
      const smoke = smokeActionTemplate(template);
      return {
        resource_id: resource.resource_id,
        action_ref: resource.action_ref as string,
        learn: smoke.learn as ActionContract,
        assessment: smoke.assessment as ActionContract,
      };
    });

  const projection: RuntimeProjectionBody = {
    plan_ref: {
      artifact_id: plan.artifact_id,
      version: plan.version,
      content_hash: plan.content_hash,
    },
    parts,
    action_contracts: actionContracts,
  };
  const projectionHash = `sha256:${createHash("sha256")
    .update(
      stableStringify({
        materializer_version: MATERIALIZER_VERSION,
        runtime_registry_version: inputs.snapshot.runtime_registry_version,
        plan_content_hash: plan.content_hash,
        projection,
      }),
      "utf8",
    )
    .digest("hex")}`;
  return { projection, projection_hash: projectionHash };
}

export type MaterializeResult =
  | {
      ok: true;
      plan: TutorPlanV2Payload;
      projection: RuntimeProjectionBody;
    }
  | { ok: false; errors: string[] };

/** materialize：校验全过 → 计算投影与 hash → 组装 runtime_projection（新对象）。 */
export function materializeTutorPlan(
  plan: TutorPlanV2Payload,
  inputs: MaterializationInputs,
): MaterializeResult {
  const validation = validateApprovedPlan(plan, inputs);
  if (!validation.ok) return { ok: false, errors: [...validation.errors] };
  const { projection, projection_hash } = projectApprovedPlan(plan, inputs);
  const materialized: TutorPlanV2Payload = {
    ...plan,
    runtime_projection: {
      materializer_version: MATERIALIZER_VERSION,
      runtime_registry_version: inputs.snapshot.runtime_registry_version,
      projection_hash,
      validation_status: "passed",
    },
  };
  const finalCheck = validatePayload(materialized as unknown as Record<string, unknown>);
  if (!finalCheck.ok) return { ok: false, errors: [...finalCheck.errors] };
  return { ok: true, plan: materialized, projection };
}
