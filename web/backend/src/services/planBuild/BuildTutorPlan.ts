/**
 * Build TutorPlan v2（Phase 4 / P4-03..06，ADR-006 离线语义层）。
 *
 * 确定性规则版 Build Agent v1：从 Approved QuestionTruth + ApproachSet/part 级
 * TeachingApproach + RuntimeRegistrySnapshot 派生备课资源包 Draft：
 * - 推荐路线（primary per part + 跳起点 alternate），不生成固定 TutorAction 时间线；
 * - checkpoint = TA TeachingStep 的认知节点（expected/alternates/deviations 直承）；
 * - 资源：explanation（narration）/ voice_seed（part 开场）/ hint 两档 /
 *   diagnostic_probe（annotated checkpoint）/ repair（part 兜底）；
 * - action_template：仅生成可从 canonical 数据确定性构造的 kind
 *   （enter-text 终问结论、choice_option 时的 select-option），truth 只进
 *   teachingInput（learn/guided 合并、assessment 剥离），几何绑定类 kind 留给
 *   Phase 5 presenter/内容工序，登记进 pendingCapabilityBindings 供预览；
 * - skill annotation：v2 skill_ids 仅作 provisional hint——细粒度 skill 去重后
 *   首次出现处锚定（≤2/checkpoint），粗粒度（006/008/009）只在 part 首节点
 *   作低置信线索，其余节点写 unmapped_skill_reason（P4-06 允许为空）；
 * - hint/probe/voice_seed 内容做答案值泄漏自查，污染时降级为通用脚手架话术。
 *
 * 生成式 Agent 不要求逐字可复现（ADR-006 §2）；本实现选择全确定性，
 * provenance 如实记录 provider=deterministic-rules。
 */
import type { AuthoredActionTemplate } from "../../../../shared/actionRuntime";
import { normalizeForMatch, staticAnswerTargets } from "../benchmark/approachCases";
import { ACTION_KIND_CAPABILITY } from "./adapters/actionRuntimeV5/adapter";
import {
  type ApproachPayload,
  type ApproachSetPayload,
  type PlanCheckpointV2,
  type PlanResourceV2,
  type TruthPayload,
  type TutorPlanV2Payload,
  canonicalHash,
  truthAnswerForPart,
  truthPartIds,
} from "./canonicalInputs";
import { type RuntimeRegistrySnapshot, isKnownActionKind } from "./RuntimeRegistrySnapshot";

export const BUILD_AGENT_PROVIDER = "deterministic-rules";
export const BUILD_AGENT_MODEL_ID = "plan-build-rules/v1";
export const BUILD_AGENT_WORKFLOW_VERSION = "tutor-plan-build/v1";

/** MVP 冻结 skill 集（skill-scope.yaml；004 deferred）。 */
export const FROZEN_SKILL_IDS: ReadonlySet<string> = new Set([
  "SKILL-SMV-001",
  "SKILL-SMV-002",
  "SKILL-SMV-003",
  "SKILL-SMV-005",
  "SKILL-SMV-006",
  "SKILL-SMV-007",
  "SKILL-SMV-008",
  "SKILL-SMV-009",
]);

/** capability-skill-map 的 granularity：fine 可直接锚定，coarse 需 checkpoint 语境。 */
const FINE_SKILL_IDS: ReadonlySet<string> = new Set([
  "SKILL-SMV-001",
  "SKILL-SMV-002",
  "SKILL-SMV-003",
  "SKILL-SMV-005",
  "SKILL-SMV-007",
]);

export interface BuildPlanInputs {
  readonly planId: string;
  readonly runId: string;
  readonly builtAt: string;
  readonly truth: TruthPayload;
  /** golden 题的跨小问组合层；缺省时按 part 逐个找 Approved TA。 */
  readonly approachSet: ApproachSetPayload | null;
  /** 该题全部 current Approved 的 part 级/整题 TA（approaches_for_question 镜像）。 */
  readonly approaches: ApproachPayload[];
  readonly snapshot: RuntimeRegistrySnapshot;
  /** capability-matrix 的该题动作链（action kinds）；缺省时仅生成结论类模板。 */
  readonly capabilityPath?: readonly string[];
}

export interface PlanBuildGap {
  readonly kind: "missing_primitive" | "unknown_capability" | "part_uncovered";
  readonly detail: string;
}

export type BuildPlanResult =
  | {
      ok: true;
      plan: TutorPlanV2Payload;
      pendingCapabilityBindings: string[];
      sanitizedHints: string[];
      gaps: PlanBuildGap[];
    }
  | { ok: false; errors: string[]; gaps: PlanBuildGap[] };

const GENERIC_SAFE_HINT = "回到题干，把已知条件与要求的目标各列一遍，再对照图形找它们的联系。";

function partLabel(partId: string, hasSubquestions: boolean): string {
  return hasSubquestions ? `第${partId}问` : "这道题";
}

function answerValues(answer: TruthPayload["canonical_answer"]): string[] {
  if (!answer) return [];
  if (answer.kind === "choice_option") {
    return (answer.options ?? []).map((option) => option.value);
  }
  return [answer.value];
}

/** hint/probe/voice_seed 泄漏自查：包含 part 答案值（归一化后）即降级。 */
function sanitizeText(
  content: string,
  targets: string[],
): { content: string; sanitized: boolean } {
  const normalized = normalizeForMatch(content);
  if (targets.some((target) => target && normalized.includes(normalizeForMatch(target)))) {
    return { content: GENERIC_SAFE_HINT, sanitized: true };
  }
  return { content, sanitized: false };
}

function approachForPart(
  inputs: BuildPlanInputs,
  partId: string,
  hasSubquestions: boolean,
): ApproachPayload | undefined {
  if (inputs.approachSet) {
    const part = inputs.approachSet.parts.find((entry) =>
      hasSubquestions ? entry.part_id === partId : entry.part_id === undefined,
    );
    if (!part) return undefined;
    return inputs.approaches.find((approach) => approach.artifact_id === part.approach.artifact_id)
      ?? inputs.approaches.find(
        (approach) =>
          approach.artifact_id === part.approach.artifact_id ||
          (part.alternates ?? []).some((alt) => alt.artifact_id === approach.artifact_id),
      );
  }
  return inputs.approaches.find((approach) =>
    hasSubquestions
      ? approach.question_ref.part_id === partId
      : approach.question_ref.part_id === undefined,
  );
}

function buildEnterTextTemplate(
  planId: string,
  partId: string,
  hasSubquestions: boolean,
  lastStepId: string,
  answer: TruthPayload["canonical_answer"],
): AuthoredActionTemplate {
  const title = hasSubquestions ? `第${partId}问结论` : "本题结论";
  return {
    actionId: `tp:${planId}:${partId}:enter-text`,
    sourceStepId: lastStepId,
    kind: "enter-text",
    version: 1,
    title,
    instruction: "根据前面的推理，写出这一问的最终结论。",
    input: { placeholder: `写出${hasSubquestions ? `第${partId}问` : "本题"}结论` },
    teachingInput: { expectedValues: answerValues(answer) },
    capabilities: [
      ACTION_KIND_CAPABILITY["enter-text"],
      "agent:select-object",
      "agent:set-answer",
      "agent:back",
      "agent:clear",
    ],
    answerSlots: [
      {
        id: "value",
        label: title,
        kind: "text",
        required: true,
        placeholder: `写出${hasSubquestions ? `第${partId}问` : "本题"}结论`,
      },
    ],
    submitOnComplete: true,
  };
}

function buildSelectOptionTemplate(
  planId: string,
  partId: string,
  lastStepId: string,
  answer: NonNullable<TruthPayload["canonical_answer"]>,
): AuthoredActionTemplate {
  return {
    actionId: `tp:${planId}:${partId}:select-option`,
    sourceStepId: lastStepId,
    kind: "select-option",
    version: 1,
    title: "选择判断",
    instruction: "选择符合当前推理的选项。",
    input: { options: (answer.options ?? []).map((option) => ({ value: option.id, labelLatex: option.value })) },
    teachingInput: { expectedValue: answer.value },
    capabilities: [
      ACTION_KIND_CAPABILITY["select-option"],
      "agent:select-object",
      "agent:set-answer",
      "agent:back",
      "agent:clear",
    ],
    answerSlots: [
      {
        id: "choice",
        label: "选择判断",
        kind: "text",
        required: true,
        options: (answer.options ?? []).map((option) => ({ value: option.id, labelLatex: option.value })),
      },
    ],
    submitOnComplete: true,
  };
}

export function buildTutorPlanDraft(inputs: BuildPlanInputs): BuildPlanResult {
  const errors: string[] = [];
  const gaps: PlanBuildGap[] = [];
  const { truth, snapshot } = inputs;
  const hasSubquestions = Boolean(truth.subquestions?.length);
  const partIds = truthPartIds(truth);

  // ---- P4-04 前置：capability path 里的 kind 必须存在于 registry（缺 primitive fail closed）
  const pathKinds = inputs.capabilityPath ?? [];
  for (const kind of pathKinds) {
    if (!isKnownActionKind(snapshot, kind)) {
      gaps.push({ kind: "missing_primitive", detail: `capability path 引用未知 ActionKind: ${kind}` });
      errors.push(`missing primitive: ${kind}`);
    }
  }
  for (const [kind, capability] of Object.entries(ACTION_KIND_CAPABILITY)) {
    if (pathKinds.includes(kind) && !snapshot.capabilities.includes(capability)) {
      gaps.push({ kind: "unknown_capability", detail: `${kind} → ${capability} 不在 registry` });
    }
  }

  // ---- part 覆盖
  const checkpoints: PlanCheckpointV2[] = [];
  const resources: PlanResourceV2[] = [];
  const routes: TutorPlanV2Payload["recommended_routes"] = [];
  const approachRefs: TutorPlanV2Payload["approach_refs"] = [];
  const pendingCapabilityBindings: string[] = [];
  const sanitizedHints: string[] = [];
  const generatedActionKinds = new Set<string>();
  const usedSkills = new Set<string>();
  let checkpointSeq = 0;
  let resourceSeq = 0;
  let routeSeq = 0;

  for (const partId of partIds) {
    const approach = approachForPart(inputs, partId, hasSubquestions);
    if (!approach) {
      gaps.push({
        kind: "part_uncovered",
        detail: `${partId} 没有绑定该小问的 Approved TeachingApproach`,
      });
      errors.push(`part ${partId} uncovered by Approved approach`);
      continue;
    }
    const label = partLabel(partId, hasSubquestions);
    const answer = truthAnswerForPart(truth, partId);
    const targets = staticAnswerTargets(
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
    );
    const partCheckpointIds: string[] = [];
    approachRefs.push({
      artifact_id: approach.artifact_id,
      version: approach.version,
      content_hash: approach.content_hash,
      // 约定：整题 TA 归一化为 part "1"（schema 要求 approach_refs 携带 part_id）。
      part_id: hasSubquestions ? partId : "1",
    });

    approach.steps.forEach((step, stepIndex) => {
      checkpointSeq += 1;
      const checkpointId = `CP${checkpointSeq}`;
      partCheckpointIds.push(checkpointId);

      // skill annotation（P4-06）：fine 优先去重锚定；coarse 仅 part 首节点低置信。
      const candidates = (step.skill_ids ?? []).filter((skill) => FROZEN_SKILL_IDS.has(skill));
      const picks: string[] = [];
      for (const skill of candidates) {
        if (picks.length >= 2) break;
        if (usedSkills.has(skill)) continue;
        if (FINE_SKILL_IDS.has(skill)) picks.push(skill);
      }
      if (!picks.length && stepIndex === 0) {
        const coarse = candidates.find(
          (skill) => !FINE_SKILL_IDS.has(skill) && !usedSkills.has(skill),
        );
        if (coarse) picks.push(coarse);
      }
      picks.forEach((skill) => usedSkills.add(skill));
      const annotations = picks.map((skill) => ({
        skill_id: skill,
        rationale: FINE_SKILL_IDS.has(skill)
          ? `该 checkpoint 对应教学步骤「${step.intent}」，预期学生能${step.expected_student_reasoning}；此处证据可直接支持该 skill 的判定。`
          : `select 类证据在 recognize/plan 间共享（capability-skill-map gap note）；以本 checkpoint 语境（${step.intent}）作为该 skill 的低置信线索。`,
        evidence_refs: [`${approach.artifact_id}@${approach.version}#${step.step_id}`],
      }));
      const unmappedSkillReason = annotations.length
        ? undefined
        : candidates.length
          ? `v2 skill_ids 仅作 provisional hint：${candidates.join("/")} 未在此节点锚定（已在他处使用或粗粒度语境不足）`
          : "该认知节点不属于 MVP 诊断关键点（P4-06 允许为空）";

      // 资源（顺序确定：explanation → hint L1 → hint L2 → probe）
      const resourceIds: string[] = [];
      const emit = (resource: Omit<PlanResourceV2, "resource_id">): string => {
        resourceSeq += 1;
        const resourceId = `RES${resourceSeq}`;
        resources.push({ ...resource, resource_id: resourceId });
        resourceIds.push(resourceId);
        return resourceId;
      };

      if (stepIndex === 0) {
        const openTarget = hasSubquestions
          ? truth.subquestions?.find((entry) => entry.part_id === partId)?.prompt
          : approach.goal;
        const open = sanitizeText(`我们先看${label}：${approach.goal}${openTarget ? `（${openTarget}）` : ""}`, targets);
        if (open.sanitized) sanitizedHints.push(`${checkpointId} voice_seed`);
        emit({
          kind: "voice_seed",
          checkpoint_id: checkpointId,
          source: "authored",
          content: open.content,
        });
      }

      emit({
        kind: "explanation",
        checkpoint_id: checkpointId,
        source: "authored",
        content: step.narration,
      });

      const hintL1 = sanitizeText(
        `先别急着算——这一步的关键是「${step.intent}」。说说你打算怎么找？`,
        targets,
      );
      const hintL2 = sanitizeText(
        step.common_errors?.length
          ? `常见卡点是「${step.common_errors[0]}」。回到「${step.intent}」，检查还有哪个已知条件没有用上。`
          : `提示：先写出这一步要用到的已知条件，再看它们如何组合出「${step.intent}」。`,
        targets,
      );
      if (hintL1.sanitized) sanitizedHints.push(`${checkpointId} hint L1`);
      if (hintL2.sanitized) sanitizedHints.push(`${checkpointId} hint L2`);
      emit({
        kind: "hint",
        checkpoint_id: checkpointId,
        assistance_level: 1,
        source: "agent_generated",
        content: hintL1.content,
      });
      emit({
        kind: "hint",
        checkpoint_id: checkpointId,
        assistance_level: 2,
        source: "agent_generated",
        content: hintL2.content,
      });

      if (annotations.length) {
        const probe = sanitizeText(
          `快速确认：${step.intent}——你能指出它在图或题干中对应的具体对象吗？`,
          targets,
        );
        if (probe.sanitized) sanitizedHints.push(`${checkpointId} probe`);
        emit({
          kind: "diagnostic_probe",
          checkpoint_id: checkpointId,
          source: "agent_generated",
          content: probe.content,
        });
      }

      checkpoints.push({
        checkpoint_id: checkpointId,
        part_id: hasSubquestions ? partId : "1",
        expected_reasoning: step.expected_student_reasoning,
        accepted_alternatives: step.accepted_alternatives?.length ? step.accepted_alternatives : undefined,
        common_deviations: step.common_errors?.length ? step.common_errors : undefined,
        skippable: stepIndex === 0 && approach.steps.length > 1 ? true : undefined,
        skill_annotations: annotations.length ? annotations : undefined,
        unmapped_skill_reason: unmappedSkillReason,
        resource_ids: resourceIds,
      });
    });

    if (!partCheckpointIds.length) continue;

    // part 兜底 repair + 结论 action_template（挂在 part 最后一个 checkpoint）
    const lastCheckpointId = partCheckpointIds[partCheckpointIds.length - 1];
    resourceSeq += 1;
    resources.push({
      resource_id: `RES${resourceSeq}`,
      kind: "repair",
      checkpoint_id: lastCheckpointId,
      source: "agent_generated",
      content: `多次提示仍未推进时：回到${label}目标（${approach.goal}），由教师用该节点的讲解资源重新示范一遍，再请学生复述关键一步。`,
    });

    const lastStepId = approach.steps[approach.steps.length - 1].step_id;
    if (answer?.kind === "choice_option" && answer.options?.length) {
      const template = buildSelectOptionTemplate(inputs.planId, partId, lastStepId, answer);
      resourceSeq += 1;
      generatedActionKinds.add(template.kind);
      resources.push({
        resource_id: `RES${resourceSeq}`,
        kind: "action_template",
        checkpoint_id: lastCheckpointId,
        source: "agent_generated",
        action_ref: template.actionId,
        capability: ACTION_KIND_CAPABILITY[template.kind],
        content: JSON.stringify(template),
      });
    } else if (answer) {
      const template = buildEnterTextTemplate(inputs.planId, partId, hasSubquestions, lastStepId, answer);
      resourceSeq += 1;
      generatedActionKinds.add(template.kind);
      resources.push({
        resource_id: `RES${resourceSeq}`,
        kind: "action_template",
        checkpoint_id: lastCheckpointId,
        source: "agent_generated",
        action_ref: template.actionId,
        capability: ACTION_KIND_CAPABILITY[template.kind],
        content: JSON.stringify(template),
      });
    }

    // 路线：primary 全节点；alternate 跳过首个 skippable 节点（entry_signal 门槛）
    routeSeq += 1;
    routes.push({
      route_id: `R${routeSeq}`,
      role: "primary",
      part_id: hasSubquestions ? partId : "1",
      checkpoint_ids: [...partCheckpointIds],
      completion_condition: approach.goal,
    });
    if (partCheckpointIds.length > 1) {
      routeSeq += 1;
      routes.push({
        route_id: `R${routeSeq}`,
        role: "alternate",
        part_id: hasSubquestions ? partId : "1",
        entry_condition: approach.entry_signal
          ? `学生已能${approach.entry_signal}，可直接跳过开场确认`
          : "学生对本问起点已有清晰认识",
        checkpoint_ids: partCheckpointIds.slice(1),
        completion_condition: approach.goal,
      });
    }
  }

  if (errors.length) return { ok: false, errors, gaps };

  // ---- capability path 中未生成模板的几何绑定类 kind：登记待绑定（非 gap）
  for (const kind of pathKinds) {
    if (!generatedActionKinds.has(kind)) pendingCapabilityBindings.push(kind);
  }

  const maxHintLevel = Math.max(
    0,
    ...resources.filter((r) => r.kind === "hint").map((r) => r.assistance_level ?? 0),
  );
  const allowedCapabilities = [
    ...new Set(resources.flatMap((resource) => (resource.capability ? [resource.capability] : []))),
  ].sort();

  const draft: TutorPlanV2Payload = {
    schema: "ai_teaching_tutor_plan_bundle/v2",
    artifact_id: inputs.planId,
    version: "v1",
    status: "Draft",
    question_ref: {
      artifact_id: truth.artifact_id,
      version: truth.version,
      content_hash: truth.content_hash,
    },
    approach_refs: approachRefs,
    recommended_routes: routes,
    checkpoints,
    resources,
    policy_constraints: {
      allowed_move_types: ["explain", "prompt", "hint", "confirm", "wait", "repair"],
      allowed_capabilities: allowedCapabilities,
      forbidden_content_kinds: ["canonical_answer", "reviewed_solution", "hidden_truth", "unapproved_tool"],
      maximum_assistance_level: maxHintLevel,
      assessment_enabled: false,
    },
    build_provenance: {
      provider: BUILD_AGENT_PROVIDER,
      model_id: BUILD_AGENT_MODEL_ID,
      workflow_version: BUILD_AGENT_WORKFLOW_VERSION,
      run_id: inputs.runId,
      built_at: inputs.builtAt,
      runtime_registry_version: snapshot.runtime_registry_version,
    },
    content_hash: "",
    artifact_uri: `artifact://tutor-plan/${inputs.planId}@v1`,
  };
  draft.content_hash = canonicalHash(draft as unknown as Record<string, unknown>, "plan");
  return { ok: true, plan: draft, pendingCapabilityBindings, sanitizedHints, gaps };
}
