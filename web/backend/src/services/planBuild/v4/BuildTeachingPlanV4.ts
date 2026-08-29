/**
 * F4（2026-08-28）Build Agent v4：Approved Plan 供应链的确定性编译层。
 *
 * 输入：Approved QuestionTruth + part 级 TeachingApproach（经 ApproachSet）+
 * Approved ReviewedSolutionGraph（RG，教研 authored 的解法结构真源）+
 * TutorPolicyProfile + RuntimeRegistrySnapshot。
 *
 * 职责（计划 §5 F4 / ADR-007 §1–§2）：
 * - **graph alignment**：RG inference → TA step 的归属用 skill 对齐
 *   （RG fact 的 skill_refs ↔ TA step 的 skill_ids）；对不上即 fail closed
 *   登记为 alignment gap，不猜、不静默丢弃；
 * - **chunk coarsening**：每个小问一个 TeachingChunk（CH-xx），引用
 *   mainline TeachingProtocol + scaffold 分支 protocol（chunks→protocol_refs）；
 * - **Protocol/Beat/resources 草稿**：mainline PR（定向 → 设元操作 →
 *   推理关联 → 收口求值 → 核验收束）与 scaffold PR（复述 → 不变量 →
 *   最小下一步）按固定规则从 TA/RG 派生；资源无 hint kind、无
 *   assistance_level（v4 合同），支持强度边界落在 Beat 的 support_boundary；
 * - 泄漏自查：voice_seed/diagnostic_probe/support 含 part 答案值时降级为
 *   通用脚手架话术并留痕。
 *
 * 全确定性（provider=deterministic-rules），不生成固定 TutorAction 时间线，
 * 不推断教学策略——策略结构来自教师已批 TA/RG，本层只做编译与登记。
 */
import type { AuthoredActionTemplate } from "../../../../../shared/actionRuntime";
import { normalizeForMatch, staticAnswerTargets } from "../../benchmark/approachCases";
import { ACTION_KIND_CAPABILITY } from "../adapters/actionRuntimeV5/adapter";
import {
  type ApproachPayload,
  type ApproachSetPayload,
  type GraphFactNode,
  type PlanResourceV4,
  type ProtocolBeatPayload,
  type ReviewedSolutionGraphPayload,
  type TeachingProtocolPayload,
  type TruthPayload,
  type TutorPlanV4Payload,
  type TutorPolicyProfilePayload,
  canonicalHash,
  truthAnswerForPart,
  truthPartIds,
} from "../canonicalInputs";
import { type RuntimeRegistrySnapshot, isKnownActionKind } from "../RuntimeRegistrySnapshot";
import { MATERIALIZER_V4_VERSION } from "./MaterializeTutorPlanV4";

export const BUILD_AGENT_V4_PROVIDER = "deterministic-rules";
export const BUILD_AGENT_V4_MODEL_ID = "plan-build-rules/v4";
export const BUILD_AGENT_V4_WORKFLOW_VERSION = "tutor-plan-build/v4";
export const PLAN_COMPILER_V4_VERSION = "tutor-plan-compiler/v4@0.1.0";

/** id-registry capability_ref 的 vendored 摘要（与 BuildTutorPlan.FROZEN_SKILL_IDS 同源）。 */
const SKILL_CAPABILITY: Readonly<Record<string, string>> = {
  "SKILL-SMV-001": "similarity.mark-known-segments",
  "SKILL-SMV-002": "similarity.map-corresponding-sides",
  "SKILL-SMV-003": "similarity.transfer-ratio-shares",
  "SKILL-SMV-005": "similarity.convert-collinear-segments",
  "SKILL-SMV-007": "similarity.build-side-equation",
  "SKILL-SMV-008": "similarity.recognize-similarity-model",
  "SKILL-SMV-009": "similarity.plan-similarity-proof",
};

/** capability → 可驱动的 workspace ActionKind（反向查 ACTION_KIND_CAPABILITY）。 */
function actionKindForCapability(capability: string): string | undefined {
  for (const [kind, cap] of Object.entries(ACTION_KIND_CAPABILITY)) {
    if (cap === capability) return kind;
  }
  return undefined;
}

const GENERIC_SAFE_SUPPORT = "回到题干，把已知条件与要求的目标各列一遍，再对照图形找它们的联系。";

export interface BuildPlanV4Inputs {
  readonly planId: string;
  readonly runId: string;
  readonly builtAt: string;
  readonly truth: TruthPayload;
  readonly approachSet: ApproachSetPayload;
  /** AS default variant 选中的 part 级/整题 TA。 */
  readonly approach: ApproachPayload;
  readonly graph: ReviewedSolutionGraphPayload;
  readonly profile: TutorPolicyProfilePayload;
  readonly snapshot: RuntimeRegistrySnapshot;
  /** 新产 protocol 的 artifact id（mainline 与 scaffold 分支）。 */
  readonly protocolIds: { readonly mainline: string; readonly scaffold: string };
  /** capability-matrix 的该题动作链（action kinds）；缺省仅生成结论类模板。 */
  readonly capabilityPath?: readonly string[];
  /** golden 题图（action_template input.geometry，与 workspace world 同源）。 */
  readonly geometry?: Record<string, unknown>;
}

export interface V4BuildGap {
  readonly kind: "alignment_gap" | "missing_primitive" | "unknown_capability" | "part_uncovered" | "graph_part_mismatch";
  readonly detail: string;
}

export interface StepAlignment {
  readonly step_id: string;
  readonly inference_ids: string[];
  readonly conclusion_facts: string[];
}

export type BuildPlanV4Result =
  | {
      ok: true;
      mainlineProtocol: TeachingProtocolPayload;
      scaffoldProtocol: TeachingProtocolPayload;
      plan: TutorPlanV4Payload;
      alignment: StepAlignment[];
      pendingCapabilityBindings: string[];
      sanitizedSupports: string[];
      gaps: V4BuildGap[];
    }
  | { ok: false; errors: string[]; gaps: V4BuildGap[] };

function partOf(fact: GraphFactNode, hasSubquestions: boolean): string {
  return hasSubquestions ? fact.part_id ?? "1" : "1";
}

/** 事实的拓扑秩：given=0；conclusion=max(premises)+1（RG 无环，schema 已保证）。 */
function factRanks(graph: ReviewedSolutionGraphPayload): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const fact of graph.facts) if (fact.role === "given") ranks.set(fact.fact_id, 0);
  let grew = true;
  while (grew) {
    grew = false;
    for (const inf of graph.inferences) {
      const next = Math.max(...inf.premises.map((p) => ranks.get(p) ?? 0)) + 1;
      const current = ranks.get(inf.conclusion) ?? -1;
      if (next > current) {
        ranks.set(inf.conclusion, next);
        grew = true;
      }
    }
  }
  return ranks;
}

/** RG inference → TA step 归属：结论 fact 的 skill_refs 与 step.skill_ids 交集。 */
function alignStepsToGraph(
  approach: ApproachPayload,
  graph: ReviewedSolutionGraphPayload,
  partId: string,
  hasSubquestions: boolean,
): { ok: true; alignment: StepAlignment[] } | { ok: false; errors: string[] } {
  const factById = new Map(graph.facts.map((fact) => [fact.fact_id, fact]));
  const partFacts = new Set(
    graph.facts.filter((fact) => partOf(fact, hasSubquestions) === partId).map((fact) => fact.fact_id),
  );
  const alignment: StepAlignment[] = approach.steps.map((step) => ({
    step_id: step.step_id,
    inference_ids: [],
    conclusion_facts: [],
  }));
  const errors: string[] = [];
  for (const inf of graph.inferences) {
    if (!partFacts.has(inf.conclusion)) continue;
    const conclusion = factById.get(inf.conclusion);
    const skills = new Set(conclusion?.skill_refs ?? []);
    const owner = approach.steps.find((step) => (step.skill_ids ?? []).some((skill) => skills.has(skill)));
    if (!owner) {
      errors.push(
        `alignment gap：inference ${inf.inference_id}（结论 ${inf.conclusion}）的 skill_refs ` +
          `[${[...(conclusion?.skill_refs ?? [])].join(",") || "空"}] 与 part ${partId} 任何 TA step 的 skill_ids 都对不上——` +
          `RG 与 TA 需教研补齐 skill 锚点后重建`,
      );
      continue;
    }
    const entry = alignment.find((item) => item.step_id === owner.step_id);
    entry?.inference_ids.push(inf.inference_id);
    if (!entry?.conclusion_facts.includes(inf.conclusion)) entry?.conclusion_facts.push(inf.conclusion);
  }
  return errors.length ? { ok: false, errors } : { ok: true, alignment };
}

function sanitizeText(content: string, targets: string[]): { content: string; sanitized: boolean } {
  const normalized = normalizeForMatch(content);
  if (targets.some((target) => target && normalized.includes(normalizeForMatch(target)))) {
    return { content: GENERIC_SAFE_SUPPORT, sanitized: true };
  }
  return { content, sanitized: false };
}

function answerValues(answer: TruthPayload["canonical_answer"]): string[] {
  if (!answer) return [];
  if (answer.kind === "choice_option") return (answer.options ?? []).map((option) => option.value);
  return [answer.value];
}

function buildEnterTextTemplate(
  planId: string,
  partId: string,
  hasSubquestions: boolean,
  lastStepId: string,
  answer: TruthPayload["canonical_answer"],
  geometry?: Record<string, unknown>,
): AuthoredActionTemplate {
  const title = hasSubquestions ? `第${partId}问结论` : "本题结论";
  return {
    actionId: `tp:${planId}:${partId}:enter-text`,
    sourceStepId: lastStepId,
    kind: "enter-text",
    version: 1,
    title,
    instruction: "根据前面的推理，写出这一问的最终结论。",
    input: { placeholder: `写出${hasSubquestions ? `第${partId}问` : "本题"}结论`, ...(geometry ? { geometry } : {}) },
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
  geometry?: Record<string, unknown>,
): AuthoredActionTemplate {
  return {
    actionId: `tp:${planId}:${partId}:select-option`,
    sourceStepId: lastStepId,
    kind: "select-option",
    version: 1,
    title: "选择判断",
    instruction: "选择符合当前推理的选项。",
    input: {
      options: (answer.options ?? []).map((option) => ({ value: option.id, labelLatex: option.value })),
      ...(geometry ? { geometry } : {}),
    },
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

type BeatRole = "orientation" | "operate" | "relate" | "verify" | "closing" | "scaffold";

const ROLE_COGNITIVE: Record<BeatRole, ProtocolBeatPayload["cognitive_activity"]> = {
  orientation: "attend",
  operate: "apply",
  relate: "relate",
  verify: "verify",
  closing: "explain",
  scaffold: "recall",
};

const ROLE_PARTICIPATION: Record<BeatRole, ProtocolBeatPayload["participation"]> = {
  orientation: "confirm",
  operate: "operate",
  relate: "answer",
  verify: "answer",
  closing: "confirm",
  scaffold: "answer",
};

const ROLE_MAX_SUPPORT: Record<BeatRole, ProtocolBeatPayload["support_boundary"]["max_support"]> = {
  orientation: "orient",
  operate: "foreground",
  relate: "name_strategy",
  verify: "specify_operation",
  closing: "provide_intermediate_conclusion",
  scaffold: "name_strategy",
};

const ROLE_VOICE: Record<BeatRole, ProtocolBeatPayload["presentation_intent"]["voice"]> = {
  orientation: ["narrate"],
  operate: ["narrate", "question"],
  relate: ["question"],
  verify: ["question", "feedback"],
  closing: ["feedback"],
  scaffold: ["question"],
};

const ROLE_SURFACES: Record<BeatRole, ProtocolBeatPayload["presentation_intent"]["workspace_surfaces"]> = {
  orientation: ["geometry"],
  operate: ["geometry", "solution_board"],
  relate: ["geometry"],
  verify: ["solution_board", "geometry"],
  closing: ["solution_board"],
  scaffold: ["geometry"],
};

export function buildTutorPlanV4Draft(inputs: BuildPlanV4Inputs): BuildPlanV4Result {
  const errors: string[] = [];
  const gaps: V4BuildGap[] = [];
  const { truth, approach, approachSet, graph, profile, snapshot } = inputs;
  const hasSubquestions = Boolean(truth.subquestions?.length);
  const partIds = truthPartIds(truth);
  const factById = new Map(graph.facts.map((fact) => [fact.fact_id, fact]));

  // ---- 上游绑定对账（RG 归属本题；AS/TA 归属本题）。
  if (graph.question_ref.artifact_id !== truth.artifact_id) {
    errors.push(`RG ${graph.graph_id} 绑定题目 ${graph.question_ref.artifact_id}，期望 ${truth.artifact_id}`);
  }
  if (approachSet.question_ref.artifact_id !== truth.artifact_id) {
    errors.push(`ApproachSet ${approachSet.artifact_id} 绑定题目 ${approachSet.question_ref.artifact_id}`);
  }
  if (approach.question_ref.artifact_id !== truth.artifact_id) {
    errors.push(`TA ${approach.artifact_id} 绑定题目 ${approach.question_ref.artifact_id}`);
  }
  // 产线 v1 编译口径：AS default variant 的单一 TA 编译整题（多 part 且 TA
  // 非 part 级时 fail closed，多 part 扩围登记在 F4 ledger 偏差）。
  if (hasSubquestions && partIds.length > 1 && approach.question_ref.part_id === undefined) {
    errors.push(
      `多小问题（${partIds.join("/")}）需要 part 级 TeachingApproach，` +
        `TA ${approach.artifact_id} 是整题绑定——v4 产线 v1 只编译整题单问/单一 TA 的题`,
    );
  }
  for (const partId of partIds) {
    const covered = graph.facts.some(
      (fact) => partOf(fact, hasSubquestions) === partId && fact.role === "goal",
    );
    if (!covered) {
      gaps.push({ kind: "graph_part_mismatch", detail: `part ${partId} 在 RG 中没有 role=goal 的 fact` });
      errors.push(`part ${partId} 缺 goal fact（RG 覆盖不全）`);
    }
  }

  // ---- capability path 前置（缺 primitive fail closed）。
  const pathKinds = inputs.capabilityPath ?? [];
  for (const kind of pathKinds) {
    if (!isKnownActionKind(snapshot, kind)) {
      gaps.push({ kind: "missing_primitive", detail: `capability path 引用未知 ActionKind: ${kind}` });
      errors.push(`missing primitive: ${kind}`);
    }
  }

  // ---- graph alignment（每 part 一次；本题整题单 part 时 partIds=["1"]）。
  const alignments: StepAlignment[] = [];
  for (const partId of partIds) {
    const aligned = alignStepsToGraph(approach, graph, partId, hasSubquestions);
    if (!aligned.ok) {
      gaps.push({ kind: "alignment_gap", detail: aligned.errors.join("; ") });
      errors.push(...aligned.errors);
      continue;
    }
    alignments.push(...aligned.alignment);
  }
  if (errors.length) return { ok: false, errors, gaps };

  // ---- 资源与 Beat 装配（顺序确定）。
  const resources: PlanResourceV4[] = [];
  const pendingCapabilityBindings: string[] = [];
  const sanitizedSupports: string[] = [];
  let resourceSeq = 0;
  let beatSeq = 0;
  let gateSeq = 0;
  const emit = (resource: Omit<PlanResourceV4, "resource_id">): string => {
    resourceSeq += 1;
    const resourceId = `RES${resourceSeq}`;
    resources.push({ ...resource, resource_id: resourceId });
    return resourceId;
  };
  const answerTargetsFor = (partId: string): string[] =>
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
    );

  const mainlineBeats: ProtocolBeatPayload[] = [];
  const chunkPlan: Array<{ partId: string; chunkId: string; beatIds: string[]; resourceIds: string[] }> = [];
  const generatedActionKinds = new Set<string>();

  for (const [partIndex, partId] of partIds.entries()) {
    const partLabel = hasSubquestions ? `第${partId}问` : "这道题";
    const partAnswer = truthAnswerForPart(truth, partId);
    const targets = answerTargetsFor(partId);
    const givenFacts = graph.facts
      .filter((fact) => partOf(fact, hasSubquestions) === partId && fact.role === "given")
      .map((fact) => fact.fact_id);
    const partAlignment = alignments.filter((entry) =>
      approach.steps.some((step) => step.step_id === entry.step_id),
    );
    const lastPart = partIndex === partIds.length - 1;
    const partBeatIds: string[] = [];
    const partResourceIds: string[] = [];
    const scaffoldRef = {
      artifact_id: inputs.protocolIds.scaffold,
      version: "v1",
      content_hash: "", // 占位，approve 前由 CLI 用真实 hash 回填
    };

    // ---- orientation beat（定向读题）
    beatSeq += 1;
    const orientationId = `BT-${String(beatSeq).padStart(2, "0")}`;
    gateSeq += 1;
    const orientationResources: string[] = [];
    const opening = sanitizeText(`我们先处理${partLabel}：${approach.goal}`, targets);
    if (opening.sanitized) sanitizedSupports.push(`${orientationId} voice_seed`);
    orientationResources.push(
      emit({ kind: "voice_seed", beat_ref: orientationId, source: "authored", content: opening.content }),
    );
    mainlineBeats.push({
      beat_id: orientationId,
      part_id: hasSubquestions ? partId : undefined,
      purpose: `定向：读题并标注${partLabel}的条件与目标（${approach.goal}）`,
      graph_fact_refs: givenFacts.length ? givenFacts : [graph.facts[0].fact_id],
      cognitive_activity: ROLE_COGNITIVE.orientation,
      completion_evidence: {
        evidence_kind: "student_confirmation",
        gate: {
          gate_id: `GT-${String(gateSeq).padStart(2, "0")}`,
          requirement: `学生确认已定位${partLabel}的已知条件与要求的目标`,
        },
      },
      participation: ROLE_PARTICIPATION.orientation,
      pacing: { wait_policy: "student_driven" },
      presentation_intent: { voice: ROLE_VOICE.orientation, workspace_surfaces: ROLE_SURFACES.orientation },
      resource_ids: orientationResources,
      support_boundary: {
        may_reveal_answer: false,
        may_reveal_intermediate: false,
        max_support: ROLE_MAX_SUPPORT.orientation,
      },
      transitions: [],
      inquiry_branch: {
        inquiry_protocol_ref: scaffoldRef,
        return_beat_id: orientationId,
        trigger: "ask_question",
      },
    });
    partBeatIds.push(orientationId);
    partResourceIds.push(...orientationResources);

    // ---- 内容 beats（每个 TA step 一个；末 step 承担收口求值）
    const stepCount = approach.steps.length;
    for (const [stepIndex, step] of approach.steps.entries()) {
      beatSeq += 1;
      const beatId = `BT-${String(beatSeq).padStart(2, "0")}`;
      const isLast = stepIndex === stepCount - 1;
      const alignmentEntry = partAlignment.find((entry) => entry.step_id === step.step_id);
      const conclusionFacts = alignmentEntry?.conclusion_facts ?? [];
      const workspaceSkill = (step.skill_ids ?? []).find(
        (skill) => SKILL_CAPABILITY[skill] && stepIndex === 0,
      );
      const role: BeatRole = workspaceSkill ? "operate" : isLast ? "verify" : "relate";
      const beatResources: string[] = [];

      const explanation = sanitizeText(step.narration, isLast ? [] : targets);
      if (explanation.sanitized) sanitizedSupports.push(`${beatId} explanation`);
      beatResources.push(
        emit({ kind: "explanation", beat_ref: beatId, source: "authored", content: explanation.content }),
      );

      const supportText = sanitizeText(
        step.common_errors?.length ? `常见卡点：${step.common_errors[0]}` : "检查还有哪个已知条件没有用上",
        targets,
      );
      if (supportText.sanitized) sanitizedSupports.push(`${beatId} support`);
      beatResources.push(
        emit({ kind: "support", beat_ref: beatId, source: "agent_generated", content: supportText.content }),
      );

      if (stepIndex === 0) {
        const probe = sanitizeText(
          `快速确认：${step.intent}——你能指出它在图或题干中对应的具体对象吗？`,
          targets,
        );
        if (probe.sanitized) sanitizedSupports.push(`${beatId} probe`);
        beatResources.push(
          emit({ kind: "diagnostic_probe", beat_ref: beatId, source: "agent_generated", content: probe.content }),
        );
      }

      let gate: NonNullable<ProtocolBeatPayload["completion_evidence"]["gate"]>;
      gateSeq += 1;
      if (workspaceSkill) {
        const capability = SKILL_CAPABILITY[workspaceSkill];
        gate = {
          gate_id: `GT-${String(gateSeq).padStart(2, "0")}`,
          requirement: `完成 ${capability}（${step.intent}）`,
          capability,
        };
      } else if (isLast) {
        const goalFact = graph.facts.find(
          (fact) => partOf(fact, hasSubquestions) === partId && fact.role === "goal",
        );
        gate = {
          gate_id: `GT-${String(gateSeq).padStart(2, "0")}`,
          requirement: `给出${partLabel}最终结论并经解法图核验（对应 ${goalFact?.fact_id ?? "goal"}）`,
          graph_fact_id: goalFact?.fact_id,
        };
      } else {
        gate = {
          gate_id: `GT-${String(gateSeq).padStart(2, "0")}`,
          requirement: `${step.expected_student_reasoning}`,
          graph_fact_id: conclusionFacts[0],
        };
      }

      const lastStepId = approach.steps[stepCount - 1].step_id;
      if (isLast && partAnswer) {
        const template =
          partAnswer.kind === "choice_option" && partAnswer.options?.length
            ? buildSelectOptionTemplate(inputs.planId, partId, lastStepId, partAnswer, inputs.geometry)
            : buildEnterTextTemplate(inputs.planId, partId, hasSubquestions, lastStepId, partAnswer, inputs.geometry);
        generatedActionKinds.add(template.kind);
        beatResources.push(
          emit({
            kind: "action_template",
            beat_ref: beatId,
            source: "agent_generated",
            content: JSON.stringify(template),
          }),
        );
        beatResources.push(
          emit({
            kind: "repair",
            beat_ref: beatId,
            source: "agent_generated",
            content: `多次提示仍未推进时：回到${partLabel}目标（${approach.goal}），由教师用该 Beat 的讲解资源重新示范一遍，再请学生复述关键一步。`,
          }),
        );
      }

      const beat: ProtocolBeatPayload = {
        beat_id: beatId,
        part_id: hasSubquestions ? partId : undefined,
        purpose: step.intent,
        graph_fact_refs: conclusionFacts.length ? conclusionFacts : [givenFacts[0] ?? graph.facts[0].fact_id],
        cognitive_activity: ROLE_COGNITIVE[role],
        completion_evidence: {
          evidence_kind: workspaceSkill ? "workspace_command" : "student_answer",
          gate,
        },
        participation: ROLE_PARTICIPATION[role],
        pacing:
          role === "relate" || role === "verify"
            ? { wait_policy: "bounded_wait", max_wait_seconds: 180 }
            : { wait_policy: "student_driven" },
        presentation_intent: { voice: ROLE_VOICE[role], workspace_surfaces: ROLE_SURFACES[role] },
        resource_ids: beatResources,
        support_boundary: {
          may_reveal_answer: false,
          may_reveal_intermediate: role !== "relate",
          max_support: ROLE_MAX_SUPPORT[role],
        },
        transitions: [],
        inquiry_branch: {
          inquiry_protocol_ref: scaffoldRef,
          return_beat_id: beatId,
          trigger: role === "relate" ? "unclear" : "request_scaffold",
        },
      };
      mainlineBeats.push(beat);
      partBeatIds.push(beatId);
      partResourceIds.push(...beatResources);
    }

    // ---- closing beat（核验收束；仅最后一个 part）
    if (lastPart) {
      beatSeq += 1;
      const closingId = `BT-${String(beatSeq).padStart(2, "0")}`;
      const goalFacts = graph.facts
        .filter((fact) => partOf(fact, hasSubquestions) === partId && fact.role === "goal")
        .map((fact) => fact.fact_id);
      gateSeq += 1;
      mainlineBeats.push({
        beat_id: closingId,
        part_id: hasSubquestions ? partId : undefined,
        purpose: "核验收束：复述关键不变量并代回图形检验结论",
        graph_fact_refs: goalFacts,
        cognitive_activity: ROLE_COGNITIVE.closing,
        completion_evidence: {
          evidence_kind: "student_confirmation",
          gate: {
            gate_id: `GT-${String(gateSeq).padStart(2, "0")}`,
            requirement: "学生复述本题关键推理（等角对等边 / 翻折不变量 / 收口工具）并确认结论",
          },
        },
        participation: ROLE_PARTICIPATION.closing,
        pacing: { wait_policy: "student_driven" },
        presentation_intent: { voice: ROLE_VOICE.closing, workspace_surfaces: ROLE_SURFACES.closing },
        support_boundary: {
          may_reveal_answer: false,
          may_reveal_intermediate: true,
          max_support: ROLE_MAX_SUPPORT.closing,
        },
        transitions: [],
      });
      partBeatIds.push(closingId);
    }

    chunkPlan.push({
      partId,
      chunkId: `CH-${String(partIndex + 1).padStart(2, "0")}`,
      beatIds: partBeatIds,
      resourceIds: partResourceIds,
    });
  }

  // ---- 线性转移链：相邻 beat 用 gate_satisfied（confirmation beat 用 evidence_collected）；
  //      bounded beat 加 timeout 自环；收尾 beat 自环 evidence_collected。
  for (let index = 0; index < mainlineBeats.length; index += 1) {
    const beat = mainlineBeats[index];
    const next = mainlineBeats[index + 1];
    const confirmation = beat.completion_evidence.evidence_kind === "student_confirmation";
    if (next) {
      beat.transitions.push({ to_beat: next.beat_id, on: confirmation ? "evidence_collected" : "gate_satisfied" });
    } else {
      beat.transitions.push({ to_beat: beat.beat_id, on: confirmation ? "evidence_collected" : "gate_satisfied" });
    }
    if (beat.pacing.wait_policy === "bounded_wait") {
      beat.transitions.push({ to_beat: beat.beat_id, on: "timeout" });
    }
  }

  // ---- scaffold 分支 protocol（确定性模板，参数取自 RG 结构）。
  const ranks = factRanks(graph);
  const firstGiven = graph.facts.find((fact) => fact.role === "given")?.fact_id ?? graph.facts[0].fact_id;
  const rank1Facts = graph.facts
    .filter((fact) => (ranks.get(fact.fact_id) ?? 0) === 1)
    .slice(0, 2)
    .map((fact) => fact.fact_id);
  const firstIntermediate = graph.facts.find((fact) => fact.role === "intermediate_value")?.fact_id
    ?? graph.facts.find((fact) => fact.role === "derived")?.fact_id
    ?? firstGiven;
  const scaffoldBeats: ProtocolBeatPayload[] = [
    {
      beat_id: "BT-01",
      purpose: "复述当前问题与图形对象，确认卡住的位置",
      graph_fact_refs: [firstGiven],
      cognitive_activity: "recall",
      completion_evidence: {
        evidence_kind: "student_answer",
        gate: { gate_id: "GT-01", requirement: "用自己的话说出当前问题问的是什么、涉及哪些对象" },
      },
      participation: "answer",
      pacing: { wait_policy: "bounded_wait", max_wait_seconds: 120 },
      presentation_intent: { voice: ["question"], workspace_surfaces: ["geometry"] },
      support_boundary: { may_reveal_answer: false, may_reveal_intermediate: false, max_support: "orient" },
      transitions: [{ to_beat: "BT-02", on: "evidence_collected" }],
    },
    {
      beat_id: "BT-02",
      purpose: "对照不变量清单，定位推理链断点（等角对等边 / 翻折保长保角）",
      graph_fact_refs: rank1Facts.length ? rank1Facts : [firstGiven],
      cognitive_activity: "relate",
      completion_evidence: {
        evidence_kind: "student_confirmation",
        gate: { gate_id: "GT-02", requirement: "学生对照检查表确认哪一步断了" },
      },
      participation: "confirm",
      pacing: { wait_policy: "student_driven" },
      presentation_intent: { voice: ["question"], workspace_surfaces: ["geometry"] },
      support_boundary: { may_reveal_answer: false, may_reveal_intermediate: true, max_support: "foreground" },
      transitions: [{ to_beat: "BT-03", on: "evidence_collected" }],
    },
    {
      beat_id: "BT-03",
      purpose: "选择一个最小下一步（命名策略，不揭示答案）",
      graph_fact_refs: [firstIntermediate],
      cognitive_activity: "apply",
      completion_evidence: {
        evidence_kind: "student_confirmation",
        gate: { gate_id: "GT-03", requirement: "学生选定一个最小下一步动作并说明理由" },
      },
      participation: "answer",
      pacing: { wait_policy: "bounded_wait", max_wait_seconds: 120 },
      presentation_intent: { voice: ["question"], workspace_surfaces: ["geometry"] },
      support_boundary: { may_reveal_answer: false, may_reveal_intermediate: true, max_support: "name_strategy" },
      transitions: [{ to_beat: "BT-03", on: "evidence_collected" }],
    },
  ];

  const mainlineProtocol: TeachingProtocolPayload = {
    schema: "ai_teaching_teaching_protocol/v1",
    protocol_id: inputs.protocolIds.mainline,
    version: "v1",
    status: "Draft",
    question_ref: {
      artifact_id: truth.artifact_id,
      version: truth.version,
      content_hash: truth.content_hash,
    },
    solution_graph_ref: {
      artifact_id: graph.graph_id,
      version: graph.version,
      content_hash: graph.content_hash,
    },
    protocol_kind: "mainline",
    entry_beat_id: mainlineBeats[0]?.beat_id ?? "BT-01",
    beats: mainlineBeats,
    content_hash: "",
    artifact_uri: `artifact://teaching-protocol/${inputs.protocolIds.mainline}@v1`,
  };
  mainlineProtocol.content_hash = canonicalHash(
    mainlineProtocol as unknown as Record<string, unknown>,
    "authoring",
  );

  const scaffoldProtocol: TeachingProtocolPayload = {
    schema: "ai_teaching_teaching_protocol/v1",
    protocol_id: inputs.protocolIds.scaffold,
    version: "v1",
    status: "Draft",
    question_ref: { ...mainlineProtocol.question_ref },
    solution_graph_ref: { ...mainlineProtocol.solution_graph_ref },
    protocol_kind: "scaffold",
    entry_beat_id: "BT-01",
    beats: scaffoldBeats,
    content_hash: "",
    artifact_uri: `artifact://teaching-protocol/${inputs.protocolIds.scaffold}@v1`,
  };
  scaffoldProtocol.content_hash = canonicalHash(
    scaffoldProtocol as unknown as Record<string, unknown>,
    "authoring",
  );

  // ---- inquiry_branch 引用回填真实 scaffold hash（草稿内占位在编译完成时消解）。
  for (const beat of mainlineProtocol.beats) {
    if (beat.inquiry_branch) {
      beat.inquiry_branch.inquiry_protocol_ref = {
        artifact_id: scaffoldProtocol.protocol_id,
        version: scaffoldProtocol.version,
        content_hash: scaffoldProtocol.content_hash,
      };
    }
  }
  mainlineProtocol.content_hash = canonicalHash(
    mainlineProtocol as unknown as Record<string, unknown>,
    "authoring",
  );

  // ---- capability path 中未生成模板的几何绑定类 kind：登记待绑定（非 gap）。
  for (const kind of pathKinds) {
    if (!generatedActionKinds.has(kind)) pendingCapabilityBindings.push(kind);
  }

  const mainlineRef = {
    artifact_id: mainlineProtocol.protocol_id,
    version: mainlineProtocol.version,
    content_hash: mainlineProtocol.content_hash,
  };
  const scaffoldRef = {
    artifact_id: scaffoldProtocol.protocol_id,
    version: scaffoldProtocol.version,
    content_hash: scaffoldProtocol.content_hash,
  };
  const plan: TutorPlanV4Payload = {
    schema: "ai_teaching_tutor_plan_bundle/v4",
    artifact_id: inputs.planId,
    version: "v1",
    status: "Draft",
    question_ref: {
      artifact_id: truth.artifact_id,
      version: truth.version,
      content_hash: truth.content_hash,
    },
    approach_set_ref: {
      artifact_id: approachSet.artifact_id,
      version: approachSet.version,
      content_hash: approachSet.content_hash,
    },
    solution_graph_ref: {
      artifact_id: graph.graph_id,
      version: graph.version,
      content_hash: graph.content_hash,
    },
    policy_profile_ref: {
      artifact_id: profile.artifact_id,
      version: profile.version,
      content_hash: profile.content_hash,
    },
    chunks: chunkPlan.map((chunk) => ({
      chunk_id: chunk.chunkId,
      part_id: hasSubquestions ? chunk.partId : "1",
      protocol_refs: [mainlineRef, scaffoldRef],
      resource_ids: chunk.resourceIds,
    })),
    resources,
    build_provenance: {
      provider: BUILD_AGENT_V4_PROVIDER,
      model_id: BUILD_AGENT_V4_MODEL_ID,
      workflow_version: BUILD_AGENT_V4_WORKFLOW_VERSION,
      run_id: inputs.runId,
      built_at: inputs.builtAt,
      runtime_registry_version: snapshot.runtime_registry_version,
      compiler_version: PLAN_COMPILER_V4_VERSION,
      materializer_version: MATERIALIZER_V4_VERSION,
    },
    content_hash: "",
    artifact_uri: `artifact://tutor-plan/${inputs.planId}@v1`,
  };
  plan.content_hash = canonicalHash(plan as unknown as Record<string, unknown>, "plan");

  return {
    ok: true,
    mainlineProtocol,
    scaffoldProtocol,
    plan,
    alignment: alignments,
    pendingCapabilityBindings,
    sanitizedSupports,
    gaps,
  };
}
