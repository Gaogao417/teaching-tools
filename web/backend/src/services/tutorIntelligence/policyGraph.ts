/**
 * LangGraph 智能链子图（Phase 5 remediation / 完整收口计划 §2）。
 *
 * 六个节点固定：
 *  1. build_context             确定性裁剪（当前/相邻 checkpoint、合法路线、偏差清单）
 *  2. align_reasoning           仅 reasoning utterance 调模型；action evidence 走
 *                               typed evaluator 结论、silence/interruption/pointing
 *                               确定性处理；置信度与 grounding 阈值确定性执行
 *  3. project_provisional_state 纯函数模拟对齐/推进后的暂定状态（含备选路线切换）
 *  4. choose_move_and_voice     模型输出 Move + 资源 + 受控动态文案
 *  5. validate_proposal         checkpoint/route/资源/帮助级别/泄题/文本来源全量校验
 *  6. repair_output             校验失败带反馈重试一次；仍失败或预算耗尽 → Wait fallback
 *
 * 子图无 checkpointer（stateless）：SQLite SessionEvent 是唯一状态真源，本图
 * 每轮从固定版本 Plan + 事件投影 State 重建。模型节点挂 retryPolicy（最多
 * 2 次尝试，仅限可重试网络错误，退避上限远小于总预算）。预算：总计 3.5s、
 * 单次调用 ≤1.5s、修复重试 ≤1 次；deadline 由 proposeTurn 的 AbortController
 * 与各节点剩余时间计算共同强制，耗尽立即 Wait fallback。
 */
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import type { TutorPlanV2Payload } from "../planBuild/canonicalInputs";
import { alignReasoning, normalizeForAlignment } from "../tutorSession/ReasoningAligner";
import { hasSentenceLevelNegation } from "./negationGuard";
import type { TutorRuntimeState } from "../tutorSession/TutorRuntimeStateProjection";
import type { StructuredModelPort } from "./structuredModelPort";
import {
  EXPECTED_CONFIDENCE_THRESHOLD,
  INCORRECT_CONFIDENCE_THRESHOLD,
  buildAlignmentContext,
  validateGroundingRef,
  type AlignmentContextView,
} from "./contextView";
import { validateProposal, waitFallbackProposal } from "./proposalValidation";
import { ALIGNER_PROMPT_VERSION, ALIGNER_SYSTEM_PROMPT } from "./prompts/alignerPrompt";
import { POLICY_VOICE_PROMPT_VERSION, POLICY_VOICE_SYSTEM_PROMPT } from "./prompts/policyVoicePrompt";
import {
  POLICY_GRAPH_WORKFLOW_VERSION,
  type AlignmentProposal,
  type PolicyFailure,
  type ProposeTurnOutcome,
  type RecentEventFact,
  type StudentTurnInput,
  type TutorTurnProposal,
} from "./proposal";

export const POLICY_TOTAL_BUDGET_MS = 3_500;
export const POLICY_PER_CALL_TIMEOUT_MS = 1_500;
const MIN_REMAINING_FOR_RETRY_MS = 250;

// --------------------------------------------------------------------------- //
// 图状态（LastValue 通道；usage 累加 reducer；无 checkpointer）
// --------------------------------------------------------------------------- //

interface UsageAccumulator {
  inputTokens?: number;
  outputTokens?: number;
  calls: number;
}

const GraphState = Annotation.Root({
  plan: Annotation<TutorPlanV2Payload>(),
  runtimeState: Annotation<TutorRuntimeState>(),
  input: Annotation<StudentTurnInput>(),
  facts: Annotation<RecentEventFact[]>(),
  answerValuesByPart: Annotation<Map<string, readonly string[]>>(),
  deadlineAt: Annotation<number>(),
  contextView: Annotation<AlignmentContextView | undefined>(),
  alignment: Annotation<AlignmentProposal | undefined>(),
  provisional: Annotation<ProvisionalState | undefined>(),
  rawMove: Annotation<unknown>(),
  validationFeedback: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  attempts: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  proposal: Annotation<TutorTurnProposal | undefined>(),
  failure: Annotation<PolicyFailure | undefined>(),
  usage: Annotation<UsageAccumulator>({
    reducer: (left, right) => ({
      inputTokens: (left.inputTokens ?? 0) + (right.inputTokens ?? 0) || undefined,
      outputTokens: (left.outputTokens ?? 0) + (right.outputTokens ?? 0) || undefined,
      calls: left.calls + right.calls,
    }),
    default: () => ({ calls: 0 }),
  }),
});

type GraphStateType = typeof GraphState.State;
type GraphUpdate = Partial<GraphStateType>;

// --------------------------------------------------------------------------- //
// 对齐置信度门（确定性；模型不得自行放宽）
// --------------------------------------------------------------------------- //

interface RawAlignmentOutput {
  classification?: string;
  checkpoint_id?: string;
  route_id?: string;
  confidence?: number;
  grounding_refs?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 置信度 + grounding 生效门：expected/alternate ≥0.85 且 refs 合法命中；
 *  incorrect ≥0.75 且有 deviation ref；其余一律降 unclear；
 *  no_progress 只能由确定性路径产生（模型输出该值 → unclear）。 */
export function gateAlignmentProposal(
  raw: RawAlignmentOutput,
  view: AlignmentContextView,
): AlignmentProposal {
  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.min(Math.max(raw.confidence, 0), 1)
      : 0;
  const refs = Array.isArray(raw.grounding_refs)
    ? raw.grounding_refs.filter((ref): ref is string => typeof ref === "string")
    : [];
  const downgrade: AlignmentProposal = { classification: "unclear", confidence, groundingRefs: [] };
  const classification = raw.classification;
  if (
    classification !== "expected_checkpoint" &&
    classification !== "alternate_valid" &&
    classification !== "incorrect"
  ) {
    return downgrade;
  }
  const resolutions = refs.map((ref) => validateGroundingRef(ref, view));
  if (!resolutions.length || resolutions.some((resolution) => !resolution.ok)) return downgrade;

  if (classification === "incorrect") {
    if (confidence < INCORRECT_CONFIDENCE_THRESHOLD) return downgrade;
    if (!resolutions.some((resolution) => resolution.classification === "incorrect")) return downgrade;
    return { classification: "incorrect", confidence, groundingRefs: refs };
  }

  if (confidence < EXPECTED_CONFIDENCE_THRESHOLD) return downgrade;
  if (classification === "expected_checkpoint") {
    const hit = resolutions.find((resolution) => resolution.classification === "expected_checkpoint");
    if (!hit) return downgrade;
    if (raw.checkpoint_id !== undefined && raw.checkpoint_id !== hit.checkpoint_id) return downgrade;
    return {
      classification: "expected_checkpoint",
      checkpointId: hit.checkpoint_id,
      confidence,
      groundingRefs: refs,
    };
  }
  // alternate_valid：要么路线 ref（必须带合法 route id），要么 checkpoint alt ref。
  const routeHit = resolutions.find((resolution) => resolution.route_id !== undefined);
  if (routeHit?.route_id) {
    if (raw.route_id !== undefined && raw.route_id !== routeHit.route_id) return downgrade;
    return {
      classification: "alternate_valid",
      checkpointId: routeHit.checkpoint_id,
      routeId: routeHit.route_id,
      confidence,
      groundingRefs: refs,
    };
  }
  const altHit = resolutions.find((resolution) => resolution.classification === "alternate_valid");
  if (!altHit?.checkpoint_id) return downgrade;
  if (raw.checkpoint_id !== undefined && raw.checkpoint_id !== altHit.checkpoint_id) return downgrade;
  return {
    classification: "alternate_valid",
    checkpointId: altHit.checkpoint_id,
    confidence,
    groundingRefs: refs,
  };
}

// --------------------------------------------------------------------------- //
// 暂定状态投影（纯函数）
// --------------------------------------------------------------------------- //

export interface ProvisionalState {
  /** 对齐将推进到的节点（expected/alternate 时）。 */
  progressed_checkpoint_id?: string;
  /** alternate 命中备选路线时的真实路线切换（v3 投影据此落状态）。 */
  route_switch_to?: string;
  /** 推进后的下一节点（沿切换后路线的节点序）。 */
  next_checkpoint_id?: string;
}

export function projectProvisional(
  alignment: AlignmentProposal | undefined,
  plan: TutorPlanV2Payload,
  state: TutorRuntimeState,
): ProvisionalState {
  if (!alignment) return {};
  if (
    alignment.classification !== "expected_checkpoint" &&
    alignment.classification !== "alternate_valid"
  ) {
    return {};
  }
  const partId =
    plan.checkpoints.find((entry) => entry.checkpoint_id === state.reasoning.current_checkpoint_id)
      ?.part_id ?? "1";
  const routeId =
    alignment.classification === "alternate_valid" && alignment.routeId
      ? alignment.routeId
      : plan.recommended_routes.find(
          (route) => route.role === "primary" && (route.part_id ?? "1") === partId,
        )?.route_id;
  const route = plan.recommended_routes.find((entry) => entry.route_id === routeId);
  const progressed = alignment.checkpointId ?? state.reasoning.current_checkpoint_id;
  const order = route?.checkpoint_ids ?? [];
  const progressedIndex = order.indexOf(progressed);
  const nextCheckpointId =
    progressedIndex >= 0 && progressedIndex + 1 < order.length
      ? order[progressedIndex + 1]
      : undefined;
  return {
    progressed_checkpoint_id: progressed,
    ...(alignment.classification === "alternate_valid" && alignment.routeId
      ? { route_switch_to: alignment.routeId }
      : {}),
    ...(nextCheckpointId ? { next_checkpoint_id: nextCheckpointId } : {}),
  };
}

// --------------------------------------------------------------------------- //
// 模型原始输出 → 提案（浅映射；深校验在 validate 节点）
// --------------------------------------------------------------------------- //

function mapRawMove(
  raw: unknown,
  alignment: AlignmentProposal | undefined,
): { ok: true; proposal: TutorTurnProposal } | { ok: false; failure: PolicyFailure } {
  if (!isPlainObject(raw)) {
    return { ok: false, failure: { kind: "invalid_proposal", detail: "模型输出不是 JSON 对象" } };
  }
  const move = isPlainObject(raw.move) ? raw.move : undefined;
  if (!move) {
    return { ok: false, failure: { kind: "invalid_proposal", detail: "模型输出缺少 move 对象" } };
  }
  const moveType = typeof move.move_type === "string" ? move.move_type : undefined;
  const purposeCode = typeof move.purpose_code === "string" ? move.purpose_code : undefined;
  if (!moveType || !purposeCode) {
    return { ok: false, failure: { kind: "invalid_proposal", detail: "move 缺少 move_type/purpose_code" } };
  }
  const modeChange =
    isPlainObject(move.mode_change) && typeof move.mode_change.to_mode === "string"
      ? { to_mode: move.mode_change.to_mode as "teach" | "guided_solve" | "repair" }
      : undefined;
  const diagnosisUpdates = Array.isArray(move.diagnosis_updates)
    ? move.diagnosis_updates
        .filter(isPlainObject)
        .map((update) => ({
          summary_code: String(update.summary_code ?? ""),
          ...(Array.isArray(update.candidate_skill_ids)
            ? { candidate_skill_ids: update.candidate_skill_ids.map((id) => String(id)) }
            : {}),
          evidence_sequences: Array.isArray(update.evidence_sequences)
            ? update.evidence_sequences.map((seq) => Number(seq))
            : [],
        }))
    : undefined;
  const voice = isPlainObject(raw.voice) ? raw.voice : {};
  const voiceText = typeof voice.text === "string" && voice.text.trim() ? voice.text : undefined;
  const voiceSource: "model-generated" | "approved-resource" =
    voice.source === "model-generated" ? "model-generated" : "approved-resource";

  return {
    ok: true,
    proposal: {
      ...(alignment ? { alignment } : {}),
      move: {
        move_type: moveType as "explain" | "prompt" | "hint" | "confirm" | "wait" | "repair",
        purpose_code: purposeCode,
        ...(typeof move.checkpoint_id === "string" ? { checkpoint_id: move.checkpoint_id } : {}),
        ...(typeof move.assistance_level === "number" ? { assistance_level: move.assistance_level } : {}),
        ...(Array.isArray(move.resource_ids)
          ? { resource_ids: move.resource_ids.map((id) => String(id)) }
          : {}),
        ...(modeChange ? { mode_change: modeChange } : {}),
        ...(diagnosisUpdates?.length ? { diagnosis_updates: diagnosisUpdates } : {}),
      },
      ...(voiceText !== undefined ? { voiceText } : {}),
      voiceSource,
      workflowVersion: POLICY_GRAPH_WORKFLOW_VERSION,
      modelId: "",
      promptVersions: [],
    },
  };
}

function isRetryableModelFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "retryable" in error &&
    (error as { retryable: unknown }).retryable === true
  );
}

/** action_template 的学生安全摘要（裁定 §3：title/instruction 可见，
 *  teachingInput/localTruth/expectedValues/capabilities 等一律不可见）。 */
function actionTemplateSummary(content: string | undefined): { title?: string; instruction?: string } {
  try {
    const template = JSON.parse(content ?? "{}") as { title?: unknown; instruction?: unknown };
    return {
      ...(typeof template.title === "string" ? { title: template.title } : {}),
      ...(typeof template.instruction === "string" ? { instruction: template.instruction } : {}),
    };
  } catch {
    return {};
  }
}

function modelFailureKindOf(error: unknown): PolicyFailure["kind"] {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code: unknown }).code);
    if (code === "not-configured") return "not_configured";
    if (code === "timeout") return "timeout";
    if (code === "invalid-json") return "invalid_proposal";
  }
  return "model_error";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 400);
  try {
    return JSON.stringify(error).slice(0, 400);
  } catch {
    return "unknown graph error";
  }
}

// --------------------------------------------------------------------------- //
// 图工厂
// --------------------------------------------------------------------------- //

export interface ProposeTurnArgs {
  plan: TutorPlanV2Payload;
  state: TutorRuntimeState;
  input: StudentTurnInput;
  facts: RecentEventFact[];
  answerValuesByPart: Map<string, readonly string[]>;
}

export interface TutorPolicyGraph {
  readonly workflowVersion: string;
  proposeTurn(args: ProposeTurnArgs): Promise<ProposeTurnOutcome>;
}

export interface PolicyGraphOptions {
  model: StructuredModelPort;
  totalBudgetMs?: number;
  perCallTimeoutMs?: number;
}

export function createTutorPolicyGraph(options: PolicyGraphOptions): TutorPolicyGraph {
  const totalBudgetMs = options.totalBudgetMs ?? POLICY_TOTAL_BUDGET_MS;
  const perCallTimeoutMs = options.perCallTimeoutMs ?? POLICY_PER_CALL_TIMEOUT_MS;
  const model = options.model;

  const retryPolicy = {
    maxAttempts: 2,
    initialInterval: 50,
    maxInterval: 200,
    backoffFactor: 2,
    jitter: false,
    retryOn: isRetryableModelFailure,
  };

  const remainingMs = (deadlineAt: number) => deadlineAt - Date.now();
  const callTimeoutMs = (deadlineAt: number) => Math.max(200, Math.min(perCallTimeoutMs, remainingMs(deadlineAt)));

  const provenance = {
    workflowVersion: POLICY_GRAPH_WORKFLOW_VERSION,
    modelId: model.modelId,
    promptVersions: [ALIGNER_PROMPT_VERSION, POLICY_VOICE_PROMPT_VERSION],
  };

  function fallbackUpdate(
    state: GraphStateType,
    failure: PolicyFailure,
  ): GraphUpdate {
    return {
      proposal: waitFallbackProposal(state.runtimeState, provenance),
      failure,
    };
  }

  const buildContextNode = (state: GraphStateType): GraphUpdate => ({
    contextView: buildAlignmentContext(state.plan, state.runtimeState),
  });

  const alignReasoningNode = async (state: GraphStateType): Promise<GraphUpdate> => {
    const input = state.input;
    // 确定性路径：no_progress 只来自 silence/空文本；pointing 不构成对齐；
    // action evidence 用 typed evaluator 结论；提问/打断不产生对齐。
    if (input.input_kind === "silence_observed") {
      return { alignment: { classification: "no_progress", confidence: 1, groundingRefs: [] } };
    }
    if (input.input_kind === "student_interrupted" || input.input_kind === "question_asked") {
      return { alignment: undefined };
    }
    if (input.input_kind === "pointing_evidence") {
      return { alignment: { classification: "unclear", confidence: 0, groundingRefs: [] } };
    }
    if (input.input_kind === "structured_action_evidence") {
      const outcome = input.actionAlignment;
      if (!outcome) {
        return { alignment: { classification: "unclear", confidence: 0, groundingRefs: [] } };
      }
      return {
        alignment: {
          classification: outcome.alignment,
          ...(outcome.checkpoint_id ? { checkpointId: outcome.checkpoint_id } : {}),
          confidence:
            outcome.alignment === "expected_checkpoint" || outcome.alignment === "alternate_valid" ? 1 : 0.9,
          groundingRefs: [],
        },
      };
    }
    const text = (input.text ?? "").trim();
    if (!text) {
      return { alignment: { classification: "no_progress", confidence: 1, groundingRefs: [] } };
    }
    // 确定性下限（Phase 5 remediation）：与 plan 文本强重叠（LCS ≥ 候选长度
    // 一半且 ≥6 字）的输入直接采用确定性对齐——逐字/近逐字输入不需要模型，
    // 语义改写与含糊输入仍交给 DeepSeek。省时延也消除逐字偏差被误判模糊。
    const deterministic = alignReasoning(state.plan, state.runtimeState, {
      input_kind: input.input_kind,
      text,
    });
    const basis = deterministic.matched_basis;
    const normalizedUtterance = normalizeForAlignment(text);
    const bidirectionalThreshold = Math.max(
      6,
      Math.floor(Math.max(normalizedUtterance.length, normalizeForAlignment(basis?.text ?? "").length) * 0.5),
    );
    if (
      basis &&
      !hasSentenceLevelNegation(text) &&
      basis.score >= bidirectionalThreshold
    ) {
      return {
        alignment: {
          classification: deterministic.alignment,
          ...(deterministic.checkpoint_id ? { checkpointId: deterministic.checkpoint_id } : {}),
          ...(basis.source === "alternate_route"
            ? { routeId: /route\.([A-Za-z0-9-]+)\.entry/.exec(basis.ref)?.[1] }
            : {}),
          confidence: deterministic.alignment === "incorrect" ? 0.92 : 0.96,
          groundingRefs: [basis.ref],
        },
      };
    }
    const view = state.contextView ?? buildAlignmentContext(state.plan, state.runtimeState);
    const result = await model.complete<RawAlignmentOutput>({
      systemPrompt: ALIGNER_SYSTEM_PROMPT,
      promptVersion: ALIGNER_PROMPT_VERSION,
      timeoutMs: callTimeoutMs(state.deadlineAt),
      userPayload: {
        utterance: text,
        current_checkpoint: view.candidates.find(
          (candidate) => candidate.checkpoint_id === view.current_checkpoint_id,
        ),
        neighbor_checkpoints: view.candidates.filter(
          (candidate) => candidate.checkpoint_id !== view.current_checkpoint_id,
        ),
        common_deviations: view.deviation_catalog ?? [],
        alternate_routes: view.alternate_routes.map((route) => ({
          route_id: route.route_id,
          entry_condition: route.entry_condition,
        })),
      },
    });
    return {
      alignment: gateAlignmentProposal(result.value, view),
      usage: {
        ...(result.usage?.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
        ...(result.usage?.outputTokens !== undefined ? { outputTokens: result.usage.outputTokens } : {}),
        calls: 1,
      },
    };
  };

  const projectProvisionalNode = (state: GraphStateType): GraphUpdate => ({
    provisional: projectProvisional(state.alignment, state.plan, state.runtimeState),
  });

  const chooseMoveNode = async (state: GraphStateType): Promise<GraphUpdate> => {
    const plan = state.plan;
    const runtime = state.runtimeState;
    const checkpointId = state.alignment?.checkpointId ?? runtime.reasoning.current_checkpoint_id;
    const partId =
      plan.checkpoints.find((entry) => entry.checkpoint_id === runtime.reasoning.current_checkpoint_id)
        ?.part_id ?? "1";
    const partCheckpointIds = new Set(
      plan.checkpoints.filter((entry) => entry.part_id === partId).map((entry) => entry.checkpoint_id),
    );
    // 模型可见目录（裁定 §3）：只投影 resource_id/kind/归属/档位与学生安全
    // 摘要。action_template 的 JSON 内容（teachingInput 等）、capability、
    // action_ref、DomainCommand 一律不可见——Workspace 由 Presenter 从
    // resource_id 确定性解析。
    const resourceCatalog = plan.resources
      .filter(
        (resource) =>
          (resource.checkpoint_id && partCheckpointIds.has(resource.checkpoint_id)) ||
          resource.kind === "repair",
      )
      .map((resource) => {
        if (resource.kind === "action_template" || resource.kind === "workspace") {
          const summary = actionTemplateSummary(resource.content);
          return {
            resource_id: resource.resource_id,
            kind: resource.kind,
            checkpoint_id: resource.checkpoint_id,
            workspace_step: summary,
          };
        }
        return {
          resource_id: resource.resource_id,
          kind: resource.kind,
          checkpoint_id: resource.checkpoint_id,
          assistance_level: resource.assistance_level,
          excerpt: (resource.content ?? "").slice(0, 60),
        };
      });
    const ledger =
      runtime.assistance[checkpointId] ?? {
        hintLevelsIssued: [],
        incorrectSequences: [],
        failedActionSequences: [],
        promptsIssued: 0,
        promptSequences: [],
        explainedSequences: [],
      };
    const result = await model.complete<Record<string, unknown>>({
      systemPrompt: POLICY_VOICE_SYSTEM_PROMPT,
      promptVersion: POLICY_VOICE_PROMPT_VERSION,
      timeoutMs: callTimeoutMs(state.deadlineAt),
      userPayload: {
        mode: runtime.mode,
        current_checkpoint: checkpointId,
        provisional: state.provisional ?? {},
        student_fact: {
          input_kind: state.input.input_kind,
          text: state.input.text,
          alignment: state.alignment?.classification,
          alignment_checkpoint_id: state.alignment?.checkpointId,
          confidence: state.alignment?.confidence,
        },
        assistance_ledger: ledger,
        recent_events: state.facts.slice(-8),
        resource_catalog: resourceCatalog,
        constraints: {
          allowed_move_types: plan.policy_constraints.allowed_move_types,
          maximum_assistance_level: plan.policy_constraints.maximum_assistance_level,
          frozen_skill_ids: [
            ...new Set(
              plan.checkpoints.flatMap((checkpoint) =>
                (checkpoint.skill_annotations ?? []).map((annotation) => annotation.skill_id),
              ),
            ),
          ],
          alternate_routes: plan.recommended_routes
            .filter((route) => (route.part_id ?? "1") === partId)
            .map((route) => ({ route_id: route.route_id, role: route.role })),
        },
        ...(state.validationFeedback.length
          ? { previous_attempt_errors: state.validationFeedback }
          : {}),
      },
    });
    return {
      rawMove: result.value,
      usage: {
        ...(result.usage?.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
        ...(result.usage?.outputTokens !== undefined ? { outputTokens: result.usage.outputTokens } : {}),
        calls: 1,
      },
    };
  };

  const validateProposalNode = (state: GraphStateType): GraphUpdate => {
    const mapped = mapRawMove(state.rawMove, state.alignment);
    if (!mapped.ok) {
      return fallbackUpdate(state, mapped.failure);
    }
    const check = validateProposal(
      mapped.proposal,
      state.plan,
      state.runtimeState,
      state.facts,
      state.answerValuesByPart,
    );
    if (check.ok) {
      return {
        proposal: { ...check.proposal, ...provenance },
        failure: undefined,
        validationFeedback: [],
      };
    }
    const canRetry = state.attempts < 1 && remainingMs(state.deadlineAt) > MIN_REMAINING_FOR_RETRY_MS;
    if (canRetry) {
      return { proposal: undefined, validationFeedback: check.errors, failure: undefined };
    }
    return fallbackUpdate(state, {
      kind: remainingMs(state.deadlineAt) <= 0 ? "budget_exhausted" : "invalid_proposal",
      detail: "校验失败且重试预算耗尽",
      errors: check.errors,
    });
  };

  const repairOutputNode = (state: GraphStateType): GraphUpdate => ({
    // validationFeedback 已由 validate_proposal 写入；这里只推进重试计数。
    attempts: state.attempts + 1,
  });

  // 链式构建：addNode 的节点名 phantom typing 只随返回值传播，链式接收后
  // addEdge 的节点名才能通过类型检查。
  const graph = new StateGraph(GraphState)
    .addNode("build_context", buildContextNode)
    .addNode("align_reasoning", alignReasoningNode, { retryPolicy })
    .addNode("project_provisional_state", projectProvisionalNode)
    .addNode("choose_move_and_voice", chooseMoveNode, { retryPolicy })
    .addNode("validate_proposal", validateProposalNode)
    .addNode("repair_output", repairOutputNode)
    .addEdge(START, "build_context")
    .addEdge("build_context", "align_reasoning")
    .addEdge("align_reasoning", "project_provisional_state")
    .addEdge("project_provisional_state", "choose_move_and_voice")
    .addEdge("choose_move_and_voice", "validate_proposal")
    .addConditionalEdges(
      "validate_proposal",
      (state: GraphStateType) => (state.proposal ? "done" : "repair"),
      { done: END, repair: "repair_output" },
    )
    .addEdge("repair_output", "choose_move_and_voice")
    .compile();

  return {
    workflowVersion: POLICY_GRAPH_WORKFLOW_VERSION,
    async proposeTurn(args: ProposeTurnArgs): Promise<ProposeTurnOutcome> {
      const startedAt = Date.now();
      const deadlineAt = startedAt + totalBudgetMs;
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error("policy budget exhausted")),
        totalBudgetMs,
      );
      try {
        const result = (await graph.invoke(
          {
            plan: args.plan,
            runtimeState: args.state,
            input: args.input,
            facts: args.facts,
            answerValuesByPart: args.answerValuesByPart,
            deadlineAt,
          },
          { signal: controller.signal },
        )) as GraphStateType;
        if (!result.proposal) {
          return {
            ok: false,
            failure: result.failure ?? { kind: "invalid_proposal", detail: "图结束但无提案" },
          };
        }
        return {
          ok: true,
          proposal: {
            ...result.proposal,
            usage: result.usage,
            latencyMs: Date.now() - startedAt,
          },
        };
      } catch (error) {
        const deadlineHit = Date.now() >= deadlineAt;
        return {
          ok: false,
          failure: {
            kind: deadlineHit ? "budget_exhausted" : modelFailureKindOf(error),
            detail: errorMessage(error),
          },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
