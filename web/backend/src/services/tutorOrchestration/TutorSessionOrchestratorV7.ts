import { projectionReadStamp, registerSnapshotProjection } from "./V7SnapshotProjectionContext";
import { VISUAL_MAX_ACTIONS } from "./presentationGeneration/VisualPresentationTools";
import { createHash } from "node:crypto";
import { explanationFragmentContentHash } from "../tutorSession/WorkspaceExplanationFragmentsV5";
import { frozenVisualGeneration, remainingVisualConstructionTools } from "./presentationGeneration/FrozenVisualGeneration";
import { isVisualPresenterPromptVersion, usesVisualV7PresentationPolicy } from "./presentationGeneration/PresenterPrompts";
/**
 * TutorSessionOrchestratorV7（F7 Step 4 — V7 有序交付 + 两条输入因果链）。
 *
 * TutorSessionOrchestratorV6 的 v7 后继。权威效果顺序：
 *
 * ```text
 * 语言/控制链：validate revision → student_input_recorded（独立批）→ 后端解释
 *   → interpretation/intent(+gate)/decision 原子批            [NavigatorSessionV7]
 * 命令链（v7 新增）：
 *   student_workspace_command_recorded（source: direct|accepted_action_evidence）
 *   → F3 执行 → action_outcome_recorded{student_command}（causation→命令事实）
 *   → pinned ActionTemplate typed evaluator → WorkspaceGateAssessment
 *     （VerifiedCorrect|VerifiedWrong|NotApplicable；completed ≠ 数学正确）
 *   → Gate → Navigator decision                              [NavigatorSessionV7]
 * evidence 链：wrong → evidence-rejected 零事件；accepted → 确定性构造命令
 *   → 与直接命令完全相同的命令链
 * 呈现链（v6 同款）：decision → TutorPresenterV6 realize（Geometry→Voice→Board；
 *   assessment 模式单 voice 零 workspace）→ planned → 队首 validated→[applied]
 *   →delivered → 浏览器 outcome 推进 cursor
 * ```
 *
 * assessment（V5 真实语义，f6 测试锁定）：无教学帮助、无答案揭示、Workspace
 * locked（独立 catalog 变体 + 独立 pin），但仍收集并评价学生独立作答——
 * mainline utterance（后端解释为答案）/confirm/continue 与确定性指示 voice
 * 允许；assistance utterance / request_scaffold / request_rephrase / 学生
 * workspace 命令拒绝（越界零事实）。session_mode 显式入流（v7），resume 经
 * v7RegistryProvider 与 catalog pin 双重对账。
 */
import { rebuildWorkspaceRuntimeStateV10, projectStudentWorkspaceViewV10, type createPinnedVisualWorkspaceBridge } from "../tutorSession/VisualViewProjector";
import type { z } from "zod";
import { studentInputV2Schema, tutorRuntimeStateV5Schema, type VisualExecutionOwner, type VisualBarrier } from "../../../../shared/canonical";
import { createV10Rebuilder, type V10RegistryProvider } from "../tutorSession/RuntimeStateRebuilderV10";
import { visualScopeEpochs, assertVisualExecutionOwner, VisualLifecycleError, type TutorRuntimeStateV10, type V10FoldContext } from "../tutorSession/TutorRuntimeStateReducerV10";
import { commitVisualControl, visualTransitionBatch } from "./VisualLifecycleCommands";
import { visualHash, stableVisualJson } from "../tutorSession/WorkspaceVisualReducer";
import type { StoredSessionEvent, PendingSessionEvent } from "../tutorSession/kernel/sessionKernelTypes";
function visualRegistryProvider(resolver:TutorTaskBindingResolver):V10RegistryProvider {
  const provider=(resolver as unknown as {v10RegistryProvider?:V10RegistryProvider}).v10RegistryProvider;
  if(!provider) throw new VisualLifecycleError("VISUAL_CONTEXT_UNAVAILABLE","pinned V10 registry provider is unavailable");
  return provider;
}
import type { PendingV7Event, StoredV7Event, V7PresentationOrderedAction, V7StudentInputBody, V7StudentWorkspaceCommandRecordedPayload } from "../tutorSession/TutorSessionEventV7";
import { createV7Rebuilder } from "../tutorSession/RuntimeStateRebuilderV7";
import { rebuildWorkspaceRuntimeStateV7 } from "../tutorSession/WorkspaceRuntimeReducerV7";
import { executeStudentWorkspaceCommandV5, executeWorkspacePresentationV5, type WorkspacePresentationExecution, type StudentWorkspaceCommandV5 } from "../tutorSession/WorkspaceActionRuntimeV5";
import { workspaceCatalogPin, type WorkspacePresentationCatalogV5 } from "../tutorSession/WorkspacePresentationCatalogV5";
import type { WorkspaceFold } from "../tutorSession/WorkspaceRuntimeReducerV5";
import { projectStudentWorkspaceViewV9 } from "../tutorSession/WorkspaceViewProjectorV5";
import type { GateAdjudicationProvider } from "../tutorNavigator/ModelGateAdjudicatorV5";
import type { WorkspaceGateAssessmentInput } from "../tutorNavigator/GateEvidenceEvaluatorV5";
import type { NavigatorDecision } from "../tutorNavigator/TutorNavigatorV5";
import type { V5ModelGatePin } from "./StructuredModelGateProvider";
import { TutorTaskBindingResolver, assessmentCatalogVariant, type TutorTaskBinding } from "./TutorTaskBindingResolver";
import { NavigatorSessionV7, findCommittedV7Turn, type V7TurnResult } from "../tutorNavigator/NavigatorSessionV7";
import { isDeepStrictEqual } from "node:util";
import { realizePresentationPlanV6, type PresentationPlanV6 } from "./TutorPresenterV6";
import { listWorkspaceCapabilities } from "../tutorSession/WorkspaceCapabilityRegistryV5";
import { assertIdempotencyKeyShape, composeIdempotencyKey } from "../tutorSession/IdempotencyKey";
import { createV9Rebuilder, readSessionEventSchema, rebuildWorkspaceRuntimeStateV9 } from "../tutorSession/RuntimeStateRebuilderV9";
import type { StoredV9Event, V9GenerationEventPayload, V9PresentationSequencePlannedPayload } from "../tutorSession/TutorSessionEventV9";
import { buildPresentationContext, DEFAULT_CONTEXT_POLICY, PresentationContextError, type BuiltPresentationContext } from "./presentationGeneration/ContextBuilder";
import { PresenterGenerationError, type PresenterGeneratorPort } from "./presentationGeneration/GeneratorPort";
import { cancelGeneration, driveGeneration, reserveGeneration, type DriveOutcome, type GenerationKernelAccess } from "./presentationGeneration/GenerationCoordinator";
import { IntentCompilerError, compilePresentationIntentsForPreflight, VisualObligationQualityError, type CompiledPresentationCandidate, type CompiledPresentationPlanV4 } from "./presentationGeneration/IntentCompiler";
import { buildPresenterPrompt, PRESENTER_PROMPT_VERSION, type PresentedBoardNote } from "./presentationGeneration/PresenterPrompts";
import { requiredBoardBindings, assertRequiredBoardBindings } from "./presentationGeneration/BoardProofCompleteness";
import { visiblePresentationTools, type PresentationResourceBinding } from "./presentationGeneration/PresentationToolCatalog";
import { SequencePreflightError, preflightPresentationSequence } from "./presentationGeneration/SequencePreflight";
import { projectPendingPresentation, projectV6Views, type V6PendingPresentation, type V6SessionSnapshot } from "./V6SessionSnapshot";
import { projectActiveAction, type ActiveAction, type ProjectedActionContract } from "./ActiveActionProjector";
import { buildExternalSupportEvidence } from "../tutorNavigator/ExternalSupportEvidenceV5";
import { constructionOutputId, adjudicateCommandPayload, adjudicateActionEvidence, evidenceToWorkspaceCommand, resolveBeatActionTemplate, resolveBeatConstructions } from "./WorkspaceActionAdjudication";
import type { ActionEvaluationResponse, AuthoredActionTemplate } from "../../../../shared/actionRuntime";
import type { TypedActionDiagnosis } from "../actionRuntime/topicTypedEvaluator";

export const ORCHESTRATOR_V7_VERSION = "tutor-session-orchestrator/v7";

/** 服务层快照：v7 保留 view/v1；v9 使用含动态板书的 canonical view/v2。 */
export type V7SessionSnapshot = Omit<V6SessionSnapshot, "views"> & {
  readonly views: Omit<V6SessionSnapshot["views"], "studentWorkspaceView"> & {
    readonly studentWorkspaceView: V6SessionSnapshot["views"]["studentWorkspaceView"]
      | ReturnType<typeof projectStudentWorkspaceViewV9>
      | ReturnType<typeof projectStudentWorkspaceViewV10>;
  };
};
export type V7PendingPresentation = V6PendingPresentation;

export interface OrchestratorV7ModelInput {
  readonly provider: GateAdjudicationProvider;
  readonly pin: V5ModelGatePin;
}

export interface OrchestratorV7StartInput {
  readonly clientInstanceId?: string;
  readonly sessionId: string;
  readonly studentId: string;
  readonly taskId: string;
  readonly canonicalRoot: string;
  /** Explicit local review composition; omitted in the production entry. */
  readonly bindingResolver?: TutorTaskBindingResolver;
  readonly model: OrchestratorV7ModelInput;
  readonly modelTimeoutMs?: number;
  /** v7：会话模式显式（teaching|assessment；assessment ⇒ locked catalog 变体 pin）。 */
  readonly assessment?: boolean;
  /**
   * F7 RT4（v9 会话）：Presenter 生成端口。提供 ⇒ 会话走 event_schema='v9'
   *（session_started 携 presenter_generation_pin；呈现经预约→驱动→提交拆开）；
   * 缺省 ⇒ v7 既有确定性链零变化。assessment 会话不提供（无教学生成）。
   */
  readonly presenter?: PresenterGeneratorPort;
}

export interface OrchestratorV7ResumeInput {
  readonly sessionId: string;
  readonly canonicalRoot: string;
  /** Explicit local review composition; omitted in the production entry. */
  readonly bindingResolver?: TutorTaskBindingResolver;
  readonly model: OrchestratorV7ModelInput;
  readonly modelTimeoutMs?: number;
  /** F7 RT4：v9 会话恢复所需的 Presenter 端口（v7 行忽略；驱动 pending 生成必需）。 */
  readonly presenter?: PresenterGeneratorPort;
}

export interface V7InputTurnOptions {
  readonly execution_owner?: VisualExecutionOwner;
  readonly expectedRevision?: number;
}

export interface V7StudentInputTurn {
  readonly execution_owner?: VisualExecutionOwner;
  readonly input: z.infer<typeof studentInputV2Schema>["input"];
  readonly client_request_id: string;
}

export interface V7PresentationReport {
  readonly sequence_id: string;
  readonly beat_id: string;
  readonly plannedCount: number;
  readonly pending?: V7PendingPresentation;
  /** F7 RT4（v9）：预约已落库、驱动待执行（sequence 尚未 planned——不伪造 id）。 */
  readonly generation?: { readonly request_id: string; readonly status: "pending" };
}

export interface V7InputTurnResult {
  readonly revision: number;
  readonly turn: V7TurnResult;
  readonly presentations: readonly V7PresentationReport[];
  readonly snapshot: V7SessionSnapshot;
}

export interface V7PresentationOutcomeRequest {
  readonly execution_owner?: VisualExecutionOwner;
  readonly hold_for_control?: {client_request_id:string};
  readonly sequence_id: string;
  readonly ordinal: number;
  readonly action_id: string;
  readonly outcome: "presented" | "interrupted" | "failed";
  readonly failure_class?: string;
  readonly message?: string;
  readonly expected_revision?: number;
  readonly client_request_id: string;
}

export interface V7OutcomeTurnResult {
  readonly revision: number;
  readonly advanced: boolean;
  readonly snapshot: V7SessionSnapshot;
}

/** 命令提交轮的 turn 结果（不含 ActionSubmission 判别——evidence 链另加）。 */
export interface V7CommandTurnResult {
  readonly revision: number;
  readonly turn: V7TurnResult;
  readonly presentations: readonly V7PresentationReport[];
  readonly snapshot: V7SessionSnapshot;
}

/** spec §1.2 TurnFailure（application profile）。 */
export interface V7TurnFailure {
  readonly category: string;
  readonly failure_class: string;
  readonly message?: string;
  readonly retryable: boolean;
}

/**
 * V7 ActionSubmission（spec §2.6 五判别，结构互斥）：
 * - evidence-rejected / workspace-committed 携带 evaluation（typed evaluator
 *   真实结果），禁 failure；
 * - revision-conflict / command-rejected / runtime-failure 携带 failure，**结构上
 *   禁 evaluation**（线协议消除「command-rejected + correct」）。
 */
export type V7ActionSubmission = V7CommandTurnResult &
  (
    | { status: "evidence-rejected"; evaluation: ActionEvaluationResponse }
    | { status: "workspace-committed"; evaluation: ActionEvaluationResponse }
    | { status: "revision-conflict"; failure: V7TurnFailure }
    | { status: "command-rejected"; failure: V7TurnFailure }
    | { status: "runtime-failure"; failure: V7TurnFailure }
  );

export interface V7ActionEvidenceInput {
  readonly actionId: string;
  readonly sourceStepId: string;
  readonly kind: string;
  readonly version: number;
  readonly values?: Record<string, string>;
}

export type OrchestratorV7ErrorCode =
  | "MODEL_PIN_MISMATCH"
  | "PRESENTER_PIN_MISMATCH"
  | "PLAN_IMPORT_FAILED"
  | "UNKNOWN_TASK"
  | "NO_EXECUTABLE_DECISION"
  | "PRESENTATION_CURSOR_MISMATCH"
  | "PRESENTATION_FAILED_PENDING_RECOVERY"
  | "PRESENTATION_AWAITING_BROWSER"
  | "WORKSPACE_APPLY_REJECTED"
  | "RETRY_RECOVERY_WITHOUT_FAILURE"
  | "ASSESSMENT_INTENT_FORBIDDEN"
  | "WORKSPACE_COMMAND_PAYLOAD_DRIFT"
  | "REQUEST_PAYLOAD_DRIFT"
  | "WORKSPACE_COMMAND_UNRESOLVABLE"
  | "NO_ACTIVE_ACTION";

export class OrchestratorV7Error extends Error {
  constructor(readonly code: OrchestratorV7ErrorCode, message: string) {
    super(message);
    this.name = "OrchestratorV7Error";
  }
}

const nowIso = (): string => new Date().toISOString();

function actionIdOf(action: V7PresentationOrderedAction): string {
  return action.kind === "voice" ? (action.voice_action?.action_id ?? "") : (action.workspace_action?.action_id ?? "");
}

/** deliverOrdinal 的窄输入（plan/v2 与 planned payload 共同满足的结构形状）。 */
interface DeliverableSequence {
  readonly sequence_id: string;
  readonly beat_id: string;
  readonly actions: readonly V7PresentationOrderedAction[];
}

function plannedPayloadOf(plan: PresentationPlanV6): Record<string, unknown> {
  return {
    sequence_id: plan.sequence_id,
    decision_id: plan.decision_id,
    protocol_id: plan.protocol_id,
    beat_id: plan.beat_id,
    actions: plan.actions,
  };
}

/** 命令语义字段集（幂等漂移判定面；id 族与 expected_workspace_revision 不参与）。 */
interface SemanticCommandFields {
  surface: unknown;
  capability: unknown;
  target_ids: unknown;
  params: unknown;
}

function semanticCommandFields(command: unknown): SemanticCommandFields {
  const record = typeof command === "object" && command !== null ? (command as Record<string, unknown>) : {};
  return { surface: record.surface, capability: record.capability, target_ids: record.target_ids, params: record.params };
}

function normalizeJsonish(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonish);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalizeJsonish(record[key])]));
  }
  return value;
}

function fieldsDeepEqual(left: SemanticCommandFields, right: SemanticCommandFields): boolean {
  return JSON.stringify(normalizeJsonish(left)) === JSON.stringify(normalizeJsonish(right));
}

/**
 * 按 client_request_id 解析已提交的学生命令事实（v7：唯一
 * student_workspace_command_recorded + 配对 outcome + 消费产物）。只读 committed 流。
 */
function findCommittedV7StudentCommand(events: readonly StoredV7Event[], clientRequestId: string): {
  commandId: string;
  commandSequence: number;
  semanticFields: SemanticCommandFields;
  source?: string;
  evidenceActionId?: string;
  outcome?: "completed" | "rejected" | "interrupted" | "failed";
  outcomeSequence?: number;
  decision?: NavigatorDecision;
} | undefined {
  let fact: { sequence: number; commandId: string; semanticFields: SemanticCommandFields; source?: string; evidenceActionId?: string } | undefined;
  for (const event of events) {
    if (event.event_type !== "student_workspace_command_recorded") continue;
    const payload = event.payload as unknown as V7StudentWorkspaceCommandRecordedPayload;
    if (payload.client_request_id === clientRequestId) {
      fact = {
        sequence: event.sequence,
        commandId: payload.command_id,
        semanticFields: { surface: payload.surface, capability: payload.capability, target_ids: payload.target_ids, params: payload.params },
        ...(payload.source !== undefined ? { source: payload.source } : {}),
        ...(payload.evidence_action_id !== undefined ? { evidenceActionId: payload.evidence_action_id } : {}),
      };
    }
  }
  if (!fact) return undefined;
  let outcome: { kind: "completed" | "rejected" | "interrupted" | "failed"; sequence: number } | undefined;
  for (const event of events) {
    if (event.event_type !== "action_outcome_recorded") continue;
    const payload = event.payload as { action_id?: string; action_kind?: string; outcome: "completed" | "rejected" | "interrupted" | "failed" };
    if (payload.action_id === fact.commandId && payload.action_kind === "student_command") {
      outcome = { kind: payload.outcome, sequence: event.sequence };
    }
  }
  if (!outcome) {
    return { commandId: fact.commandId, commandSequence: fact.sequence, semanticFields: fact.semanticFields, ...(fact.source !== undefined ? { source: fact.source } : {}), ...(fact.evidenceActionId !== undefined ? { evidenceActionId: fact.evidenceActionId } : {}) };
  }
  // 消费产物（若已消费）：gate_evaluated 以 outcome sequence 为 causation。
  let decision: NavigatorDecision | undefined;
  for (const event of events) {
    if (decision === undefined && event.event_type === "gate_evaluated" && event.causation_sequence === outcome.sequence) continue;
    if (event.event_type === "policy_decision_made" && event.causation_sequence !== undefined) {
      const gate = events.find((candidate) => candidate.sequence === event.causation_sequence && candidate.event_type === "gate_evaluated");
      if (gate && gate.causation_sequence === outcome.sequence) {
        decision = event.payload as unknown as NavigatorDecision;
      }
    }
  }
  return {
    commandId: fact.commandId,
    commandSequence: fact.sequence,
    semanticFields: fact.semanticFields,
    ...(fact.source !== undefined ? { source: fact.source } : {}),
    ...(fact.evidenceActionId !== undefined ? { evidenceActionId: fact.evidenceActionId } : {}),
    outcome: outcome.kind,
    outcomeSequence: outcome.sequence,
    ...(decision !== undefined ? { decision } : {}),
  };
}

export class TutorSessionOrchestratorV7 {
  readonly sessionId: string;
  private readonly resolver: TutorTaskBindingResolver;
  private readonly binding: TutorTaskBinding;
  private readonly model: OrchestratorV7ModelInput;
  private readonly modelTimeoutMs: number | undefined;
  private readonly sessionMode: "teaching" | "assessment";
  /** 会话 pin 的生效 catalog（teaching=construction 形态；assessment=locked 变体）。 */
  private readonly catalog: WorkspacePresentationCatalogV5;
  private navigator: NavigatorSessionV7;
  /** F7 RT4：v9 生成会话的 Presenter 端口（v7 会话 undefined）。 */
  private readonly presenterGenerator: PresenterGeneratorPort | undefined;

  private constructor(fields: {
    sessionId: string;
    resolver: TutorTaskBindingResolver;
    binding: TutorTaskBinding;
    model: OrchestratorV7ModelInput;
    modelTimeoutMs: number | undefined;
    sessionMode: "teaching" | "assessment";
    catalog: WorkspacePresentationCatalogV5;
    navigator: NavigatorSessionV7;
    presenterGenerator?: PresenterGeneratorPort;
  }) {
    this.sessionId = fields.sessionId;
    this.resolver = fields.resolver;
    this.binding = fields.binding;
    this.model = fields.model;
    this.modelTimeoutMs = fields.modelTimeoutMs;
    this.sessionMode = fields.sessionMode;
    this.catalog = fields.catalog;
    this.navigator = fields.navigator;
    this.presenterGenerator = fields.presenterGenerator;
    this.configureVisualNavigation();
  }

  /** F7 RT4：会话事件合同版本（v9 = 生成生命周期链）。 */
  get eventSchema(): "v7" | "v9" | "v10" {
    return this.navigator.eventSchema;
  }

  /** F7 RT4：在线权威 state 重建（v7=state/v2；v9=state/v4 face；只读）。 */
  rebuildRuntimeState() {
    return this.navigator.rebuildState();
  }

  // ------------------------------------------------------------------ //
  // start / resume
  // ------------------------------------------------------------------ //

  /**
   * 启动 v7 教学会话：resolver 唯一绑定解析 → kernel v7 原子 pin（session_mode +
   * catalog pin[assessment ⇒ locked 变体] + model pin + event_schema='v7'）→
   * 起步 execute_beat 决策 → 初始 Beat 序列计划 + 队首交付（assessment 模式 =
   * 单确定性指示 voice、零 workspace action）。
   */
  static start(input: OrchestratorV7StartInput): TutorSessionOrchestratorV7 {
    const resolver = input.bindingResolver ?? new TutorTaskBindingResolver(input.canonicalRoot);
    const binding = resolveBindingOrThrow(resolver, input.taskId);
    const sessionMode: "teaching" | "assessment" = input.assessment === true ? "assessment" : "teaching";
    const catalog = sessionMode === "assessment" ? assessmentCatalogVariant(binding) : binding.golden.catalog;
    // F7 RT4：Presenter 端口提供 ⇒ v9 生成会话（pin 进 session_started；state/v4）。
    const presenter = input.assessment ? undefined : input.presenter;
    // Browser identity is transport metadata, not a session-contract selector.
    // The pinned visual plan owns V10 admission; historical plans keep their reader.
    const visualPlan = String(binding.imported.plan.schema) === "ai_teaching_tutor_plan_bundle/v8";
    if (visualPlan && !input.clientInstanceId) {
      throw new VisualLifecycleError("VISUAL_CONTEXT_UNAVAILABLE", "visual plan requires a browser execution owner");
    }
    const navigator = NavigatorSessionV7.start({
      sessionId: input.sessionId,
      studentId: input.studentId,
      plan: binding.plan,
      imported: binding.imported,
      registryProvider: visualPlan ? visualRegistryProvider(resolver) : resolver.v7RegistryProvider,
      gateProvider: input.model.provider,
      modelTimeoutMs: input.modelTimeoutMs,
      taskId: binding.taskId,
      scenarioId: binding.scenarioId,
      sessionMode,
      sessionStartedPins: {
        workspace_catalog_pin: workspaceCatalogPin(catalog),
        model_gate_pin: input.model.pin,
      },
      ...(presenter ? { presenterGenerationPin: presenter.pin } : {}),
      ...(visualPlan ? {presentationExecutionOwner:{client_instance_id:input.clientInstanceId!,epoch:1}} : {}),
    });
    const orchestrator = new TutorSessionOrchestratorV7({
      sessionId: input.sessionId,
      resolver,
      binding,
      model: input.model,
      modelTimeoutMs: input.modelTimeoutMs,
      sessionMode,
      catalog,
      navigator,
      ...(presenter ? { presenterGenerator: presenter } : {}),
    });
    orchestrator.presentCurrentBeat();
    return orchestrator;
  }

  /**
   * 恢复（refresh/reconnect/replay）：verified rebuild + binding/pin/model pin 对账
   * （resolver.v7RegistryProvider 含 session_mode ↔ catalog 双重对账）+ Plan-aware
   * gate 归属核对；**零模型调用**；pending delivery 原样重投零新事件——唯一例外
   * 是 mid-action 崩溃窗口（planned 已提交、队首未 delivered）→ resumePresentation
   * 续投（恰好一次）。v5/v6 会话行 → SESSION_VERSION_UNSUPPORTED（不迁移）。
   */
  static resume(input: OrchestratorV7ResumeInput): TutorSessionOrchestratorV7 {
    const resolver = input.bindingResolver ?? new TutorTaskBindingResolver(input.canonicalRoot);
    // F7 RT4：按会话行 event_schema 选择 rebuilder（v9 行经 v9 codec verify；
    // v7 行走既有链——半升级组合在 reader 边界显式拒绝）。
    const rowSchema = readSessionEventSchema(input.sessionId);
    const verified = rowSchema === "v10" ? createV10Rebuilder(visualRegistryProvider(resolver)).verifyCommittedStreamV10(input.sessionId) : rowSchema === "v9"
      ? createV9Rebuilder(resolver.v7RegistryProvider).verifyCommittedStreamV9(input.sessionId) as unknown as { sessionStartedPayload: Record<string, unknown> }
      : createV7Rebuilder(resolver.v7RegistryProvider).verifyCommittedStreamV7(input.sessionId);
    const started = verified.sessionStartedPayload as {
      task_id?: string;
      session_mode?: "teaching" | "assessment";
      model_gate_pin?: V5ModelGatePin;
    };
    if (typeof started.task_id !== "string" || started.task_id === "") {
      throw new OrchestratorV7Error("UNKNOWN_TASK", `session ${input.sessionId} carries no pinned task_id (fail closed)`);
    }
    // session_mode 合法性已由 v7RegistryProvider 强制（canonical 必填 + 双重对账）；
    // 此处只读取以选择会话 pin 的 catalog 形态（teaching=construction；assessment=locked 变体）。
    const sessionMode = started.session_mode === "assessment" ? "assessment" : "teaching";
    const binding = resolveBindingOrThrow(resolver, started.task_id, verified.sessionStartedPayload);
    // model pin 对账（实现级边界：不符即拒，与 catalog pin 对账同型；零事件追加）。
    const expected = input.model.pin;
    const actual = started.model_gate_pin;
    if (!actual || actual.provider !== expected.provider || actual.model_id !== expected.model_id
      || actual.prompt_version !== expected.prompt_version || actual.adjudicator_version !== expected.adjudicator_version) {
      throw new OrchestratorV7Error(
        "MODEL_PIN_MISMATCH",
        `session ${input.sessionId} model_gate_pin mismatch: stream=${JSON.stringify(actual)} vs resumed provider=${JSON.stringify(expected)} (fail closed; zero events appended)`,
      );
    }
    const catalog = sessionMode === "assessment" ? assessmentCatalogVariant(binding) : binding.golden.catalog;
    const navigator = NavigatorSessionV7.resume({
      sessionId: input.sessionId,
      plan: binding.plan,
      imported: binding.imported,
      registryProvider: rowSchema === "v10" ? visualRegistryProvider(resolver) : resolver.v7RegistryProvider,
      gateProvider: input.model.provider,
      ...(input.modelTimeoutMs !== undefined ? { modelTimeoutMs: input.modelTimeoutMs } : {}),
    });
    // F7 P2-B（B3）Presenter pin 校验（用户裁决：fail closed）——v9 会话恢复传入
    // presenter 端口时，其 pin 必须与会话冻结 pin 及在途生成请求冻结 pin 全字段
    // 一致（provider/model_id/prompt_version/context_builder_version/
    // tool_catalog_version）。不一致 ⇒ 显式拒绝恢复（零事件、零模型调用；会话仍
    // 可不带 presenter 只读加载）——否则替换模型生成的内容会以旧 pin 写入
    // provenance（实测：换 provider/model 端口恢复后 committed 仍记旧 pin）。
    if (input.presenter !== undefined && navigator.eventSchema !== "v7") {
      const presenterPinFields = ["provider", "model_id", "prompt_version", "context_builder_version", "tool_catalog_version"] as const;
      const state = navigator.rebuildState() as unknown as {
        pinned_plan?: { presenter_generation_pin?: Record<string, string> };
        generation_slot?: { status?: string; request_id?: string };
        generation_requests?: Array<{ request_id: string; presenter_pin: Record<string, string> }>;
      };
      const mismatches: string[] = [];
      const sessionPin = state.pinned_plan?.presenter_generation_pin;
      if (!sessionPin) {
        mismatches.push("session presenter_generation_pin missing from authoritative state");
      } else {
        for (const field of presenterPinFields) {
          if (sessionPin[field] !== input.presenter.pin[field]) {
            mismatches.push(`session pin ${field}: stream=${JSON.stringify(sessionPin[field])} vs resumed=${JSON.stringify(input.presenter.pin[field])}`);
          }
        }
      }
      const slot = state.generation_slot;
      const pendingRequest = slot?.status === "pending"
        ? state.generation_requests?.find((record) => record.request_id === slot.request_id)
        : undefined;
      if (pendingRequest) {
        for (const field of presenterPinFields) {
          if (pendingRequest.presenter_pin[field] !== input.presenter.pin[field]) {
            mismatches.push(`pending request ${pendingRequest.request_id} pin ${field}: frozen=${JSON.stringify(pendingRequest.presenter_pin[field])} vs resumed=${JSON.stringify(input.presenter.pin[field])}`);
          }
        }
      }
      if (mismatches.length > 0) {
        throw new OrchestratorV7Error(
          "PRESENTER_PIN_MISMATCH",
          `session ${input.sessionId} presenter pin mismatch on resume (${mismatches.join("; ")}); fail closed, zero events, zero model calls — resume without a presenter port (read-only) or with the pinned presenter model`,
        );
      }
    }
    const orchestrator = new TutorSessionOrchestratorV7({
      sessionId: input.sessionId,
      resolver,
      binding,
      model: input.model,
      modelTimeoutMs: input.modelTimeoutMs,
      sessionMode,
      catalog,
      navigator,
      ...(input.presenter && navigator.eventSchema !== "v7" ? { presenterGenerator: input.presenter } : {}),
    });
    if(orchestrator.eventSchema !== "v10") orchestrator.resumePresentation();
    return orchestrator;
  }

  // ------------------------------------------------------------------ //
  // 只读视图
  // ------------------------------------------------------------------ //

  get taskId(): string {
    return this.binding.taskId;
  }

  get revision(): number {
    return this.navigator.revision;
  }

  get events(): StoredV7Event[] {
    return this.navigator.events;
  }

  get plan(): TutorTaskBinding["plan"] {
    return this.binding.plan;
  }

  get assessmentMode(): boolean {
    return this.sessionMode === "assessment";
  }

  /** 会话 pin 的生效 catalog（HTTP render 投影与 evaluator 共用；只读）。 */
  get sessionCatalog(): WorkspacePresentationCatalogV5 {
    return this.catalog;
  }

  /** 学生安全题面（question stem/type；答案真值不出编排层）。 */
  get question(): TutorTaskBinding["question"] {
    return this.binding.question;
  }

  /** workspace fold 只读重建（HTTP render 投影用；与内部裁决同一函数）。 */
  workspaceFold(): WorkspaceFold {
    return this.rebuildWorkspace();
  }

  /** G2 对账入口：在线缓存 state vs 全量重建 state（含 presentation cursor）。 */
  assertReplayParity(): { equal: boolean; differences: unknown[] } {
    return this.navigator.assertReplayParity();
  }

  // ------------------------------------------------------------------ //
  // 语言/控制输入链（v6 同款 + assessment 权限矩阵）
  // ------------------------------------------------------------------ //

  /**
   * 学生输入轮（utterance|control）：revision 校验 → assessment 越界拒绝（零
   * 事实）→（barge_in 先关 pending cursor）/（retry_recovery 恢复分支）→
   * Navigator 输入链 → presentAfterDecision → snapshot。
   */
  async submitStudentInput(input: V7StudentInputTurn, options: V7InputTurnOptions = {}): Promise<V7InputTurnResult> {
    this.refreshWrappers();
    if(this.eventSchema === "v10") {
      const state=this.navigator.state as unknown as TutorRuntimeStateV10;
      const control=input.input.kind === "control" ? input.input.command : undefined;
      if(control === "claim_presentation" || control === "barge_in" || control === "retry_recovery" && (state.visual_barrier?.status === "failed" || state.presentation_cursor.status === "failed")) {
        const canonical=studentInputV2Schema.parse({schema:"ai_teaching_student_input/v2",session_id:this.sessionId,
          expected_revision:options.expectedRevision,client_request_id:input.client_request_id,input:input.input,execution_owner:input.execution_owner});
        const result=commitVisualControl({kernel:this.navigator.kernel as unknown as Parameters<typeof commitVisualControl>[0]["kernel"],history:this.events as unknown as StoredSessionEvent[],context:this.visualContext(),input:canonical,expectedRevision:canonical.expected_revision});
        this.refreshWrappers();
        return {revision:this.revision,turn:{revision:this.revision,inputSequence:result.inputSequence},presentations:[],snapshot:this.snapshot()};
      }
      this.assertVisualWrite(input.execution_owner);
    } else if(input.input.command === "claim_presentation" || input.input.not_started_delivery) throw new VisualLifecycleError("SESSION_VERSION_UNSUPPORTED","visual input requires V10");
    const prior = this.events.find((event) => event.event_type === "student_input_recorded"
      && (event.payload as { client_request_id?: string }).client_request_id === input.client_request_id);
    if (prior && !isDeepStrictEqual((prior.payload as { input: unknown }).input, input.input)) {
      throw new OrchestratorV7Error("REQUEST_PAYLOAD_DRIFT", "student input retry changed payload for the same client_request_id");
    }
    if (prior && input.input.kind === "control" && input.input.command === "retry_recovery") {
      const later = this.events.filter(event => event.sequence > prior.sequence);
      const generationAtInput = [...this.events].reverse().find(event => event.sequence < prior.sequence
        && (String(event.event_type).startsWith("presentation_generation_")
          || (event.event_type === "presentation_sequence_planned" && (event.payload as { generation?: unknown }).generation)));
      const resumedPendingBudget = (generationAtInput?.payload as { status?: string } | undefined)?.status === "pending";
      // Recovery controls intentionally have no Navigator decision. Their completed
      // reservation/delivery still makes a lost-response retry a read, not new input.
      if (resumedPendingBudget || later.some(event => String(event.event_type) === "presentation_generation_requested"
        || event.event_type === "presentation_sequence_planned"
        || event.event_type === "student_input_recorded"
        || event.event_type === "policy_decision_made")) {
        return { revision: this.navigator.revision,
          turn: { revision: this.navigator.revision, inputSequence: prior.sequence }, presentations: [], snapshot: this.snapshot() };
      }
      // The control fact may commit before the atomic recovery batch. Resume that
      // same request before revision admission, without recording the raw input again.
      if(this.navigator.state.presentation_cursor.status === "failed" || this.undeliveredPresentationFailure()) {
        const recovery=this.retryRecovery();
        return {revision:this.revision,turn:{revision:this.revision,inputSequence:prior.sequence},presentations:[recovery.report],snapshot:this.snapshot()};
      }
      // Crash after retry_recovery superseded the failed sequence, before reservation.
      // Complete just that missing presentation; no Navigator/Gate is re-entered.
      const superseded = later.find(event => event.event_type === "presentation_sequence_superseded"
        && (event.payload as { reason?: string }).reason === "retry_recovery");
      if (superseded && this.navigator.state.presentation_cursor.status === "idle" && !this.hasPendingGeneration()) {
        const presentations = [this.presentCurrentBeat()];
        return { revision: this.navigator.revision,
          turn: { revision: this.navigator.revision, inputSequence: prior.sequence }, presentations, snapshot: this.snapshot() };
      }
    }
    const committed = findCommittedV7Turn(this.events, input.client_request_id);
    if (committed?.decisionSequence !== undefined || committed?.failure !== undefined) {
      // Replay never reinterprets evidence. Repair only a still-current decision
      // whose presentation was never reserved (e.g. a crash between the commits).
      const { intentSequence, ...turn } = committed;
      void intentSequence;
      const presentations = this.recoverUnreservedPresentation(turn);
      return { revision: this.navigator.revision, turn, presentations, snapshot: this.snapshot() };
    }
    // Admission precedes even revision-failure recording and generation cancellation.
    // An unacknowledged delivery is not permission to interpret another input.
    if (!(input.input.kind === "control" && input.input.command === "barge_in")) {
      this.assertDeliverySettled();
    }
    const conflict = this.checkExpectedRevision(options.expectedRevision);
    if (conflict) {
      return { revision: conflict.revision, turn: conflict.turn, presentations: [], snapshot: this.snapshot() };
    }
    // A recovery request resumes the existing pending budget, without cancelling
    // it or changing the frozen teaching input. The application drives the worker.
    if (this.hasPendingGeneration() && input.input.kind === "control" && input.input.command === "retry_recovery") {
      const slot = this.navigator.state.generation_slot!;
      const request = (this.navigator.state.generation_requests as Array<{request_id:string}> | undefined)?.find((entry) => entry.request_id === (slot as {request_id:string}).request_id);
      if (!request) throw new OrchestratorV7Error("NO_EXECUTABLE_DECISION", "pending generation request missing");
      const inputSequence = this.appendStudentInputFact(input);
      return { revision: this.navigator.revision, turn: { revision: this.navigator.revision, inputSequence },
        presentations: [{ sequence_id: "", beat_id: this.navigator.currentBeat.beat_id, plannedCount: 0,
          generation: { request_id: request.request_id, status: "pending" } }], snapshot: this.snapshot() };
    }
    // F7 RT4（v9）：生成中的新输入使旧任务失效——用户取消是**正常控制操作**
    //（不记系统故障或学生错误）：barge_in ⇒ cancelled；其余输入 ⇒
    // superseded_by_new_input。取消经 kernel CAS 与提交同事务边界裁决。
    if (this.hasPendingGeneration() && this.eventSchema !== "v10") {
      const cancelReason = input.input.kind === "control" && input.input.command === "barge_in" ? "cancelled" : "superseded_by_new_input";
      cancelGeneration(this.generationKernelAccess(), cancelReason, this.generationCausationSequence());
      this.refreshWrappers();
    }
    // assessment 权限矩阵（spec §0 裁决 7 修订）：assistance / scaffold / rephrase
    // 是教学帮助入口——assessment 会话边界拒绝（零事实，发生在输入成为事实之前；
    // V5 f6 语义保留）。mainline utterance（后端解释为答案）/confirm/continue 允许。
    if (this.assessmentMode) {
      const forbidden = (input.input.kind === "utterance" && input.input.channel === "assistance")
        || (input.input.kind === "control" && (input.input.command === "request_scaffold" || input.input.command === "request_rephrase"));
      if (forbidden) {
        throw new OrchestratorV7Error(
          "ASSESSMENT_INTENT_FORBIDDEN",
          `assessment mode forbids teaching-help input ${JSON.stringify(input.input)} (zero facts, no scaffold, no reveal)`,
        );
      }
    }
    // failed 停留锁（spec §2.5）：cursor=failed 期间唯一合法输入是 retry_recovery。
    if ((this.navigator.state.presentation_cursor.status === "failed" || this.undeliveredPresentationFailure())
      && !(input.input.kind === "control" && input.input.command === "retry_recovery")) {
      throw new OrchestratorV7Error(
        "PRESENTATION_FAILED_PENDING_RECOVERY",
        `presentation cursor is parked failed; only control.retry_recovery is admitted until the recovery sequence replaces it (fail closed, zero events)`,
      );
    }
    if (input.input.kind === "control" && input.input.command === "retry_recovery") {
      const inputSequence = this.appendStudentInputFact(input);
      const recovery = this.retryRecovery();
      return {
        revision: this.navigator.revision,
        turn: { revision: this.navigator.revision, inputSequence },
        presentations: [recovery.report],
        snapshot: this.snapshot(),
      };
    }
    if (input.input.kind === "control" && input.input.command === "barge_in") {
      this.closePendingAsInterrupted();
    }
    const eventsBeforeTurn = this.events.length;
    const turn = await this.navigator.submitStudentInput({ input: input.input as V7StudentInputBody, client_request_id: input.client_request_id });
    // 幂等重放：返回的 decisionSequence 指向本轮开始前已提交的事件——不重复呈现。
    const idempotentReplay =
      turn.decisionSequence !== undefined && turn.decisionSequence <= eventsBeforeTurn;
    const presentations = idempotentReplay ? [] : this.presentAfterDecision(turn);
    this.refreshWrappers();
    return { revision: this.navigator.revision, turn, presentations, snapshot: this.snapshot() };
  }

  // ------------------------------------------------------------------ //
  // 命令链（v7 新增：直接命令 + evidence 派生命令共用）
  // ------------------------------------------------------------------ //

  /**
   * 学生 workspace 命令轮（直接命令，source=direct）：
   * student_workspace_command_recorded → F3 执行 → action_outcome_recorded
   * {student_command}（causation→命令事实）→ pinned typed evaluator →
   * WorkspaceGateAssessment → Gate → decision → 呈现。
   * completed 只说明 Workspace 接受命令——只有 VerifiedCorrect 满足 GT-04。
   * 同 client_request_id 幂等（漂移 → WORKSPACE_COMMAND_PAYLOAD_DRIFT 零事件）。
   */
  submitWorkspaceCommand(command: StudentWorkspaceCommandV5, options: V7InputTurnOptions = {}): V7CommandTurnResult {
    this.assertVisualWrite(options.execution_owner);
    return this.commitStudentWorkspaceCommand(command, { expectedRevision: options.expectedRevision, source: "direct" });
  }

  /**
   * structured action evidence 提交（spec §2.6）：服务端先以 pinned template 走
   * 既有 typed evaluator：
   * - rejected：零事件、零命令、零 gate、零呈现——evidence-rejected + 真实
   *   diagnosis（错误保留在 ActionRuntime）；
   * - accepted：evidence 确定性转 StudentWorkspaceCommand → 与直接命令完全相同
   *   的命令链（source=accepted_action_evidence）→ workspace-committed。
   * 系统失败三判别（revision-conflict/command-rejected/runtime-failure）结构上
   * 不携带 evaluation。
   */
  submitActionEvidence(
    evidence: V7ActionEvidenceInput,
    options: V7InputTurnOptions & { client_request_id: string },
  ): V7ActionSubmission {
    this.refreshWrappers();
    this.assertVisualWrite(options.execution_owner);
    const beat = this.navigator.currentBeat;
    const resolved = resolveBeatActionTemplate(this.binding.imported.plan.resources, beat);
    if (!resolved) {
      throw new OrchestratorV7Error("NO_ACTIVE_ACTION", `beat ${beat.beat_id} has no pinned action_template (nothing to evaluate evidence against)`);
    }
    const conflict = this.checkExpectedRevision(options.expectedRevision);
    if (conflict) {
      return {
        status: "revision-conflict",
        failure: {
          category: "system",
          failure_class: "revision_conflict",
          message: `expected revision ${String(options.expectedRevision)} but session is at ${conflict.revision}`,
          retryable: true,
        },
        turn: conflict.turn,
        presentations: [],
        snapshot: this.snapshot(),
        revision: conflict.revision,
      };
    }
    const diagnosis = adjudicateActionEvidence(resolved.template, evidence as never);
    if (!diagnosis.accepted) {
      // 暂态模式（因果链 3）：零事件——无 committed causation → 不呈现、不入流。
      return {
        status: "evidence-rejected",
        evaluation: rejectedEvaluation(resolved.template, diagnosis),
        turn: { revision: this.navigator.revision, inputSequence: this.navigator.revision },
        presentations: [],
        snapshot: this.snapshot(),
        revision: this.navigator.revision,
      };
    }
    const workspaceRevision = this.rebuildWorkspace().state.revision;
    const command = evidenceToWorkspaceCommand({
      sessionId: this.sessionId,
      commandId: `SC-${this.sessionId}-EV-${Date.now().toString(36)}`,
      clientCommandId: options.client_request_id,
      expectedWorkspaceRevision: workspaceRevision,
      template: resolved.template,
      evidence: evidence as never,
    });
    const committed = this.commitStudentWorkspaceCommand(command, {
      expectedRevision: options.expectedRevision,
      source: "accepted_action_evidence",
      evidenceActionId: evidence.actionId,
    });
    if (committed.turn.failure) {
      return {
        status: "command-rejected",
        failure: {
          category: "command",
          failure_class: committed.turn.failure.failure_class,
          ...(committed.turn.failure.message !== undefined ? { message: committed.turn.failure.message } : {}),
          retryable: true,
        },
        turn: committed.turn,
        presentations: committed.presentations,
        snapshot: committed.snapshot,
        revision: committed.revision,
      };
    }
    return {
      status: "workspace-committed",
      evaluation: acceptedEvaluation(committed),
      turn: committed.turn,
      presentations: committed.presentations,
      snapshot: committed.snapshot,
      revision: committed.revision,
    };
  }

  /**
   * 命令链的共享实现（直接命令与 evidence 派生命令完全同链）：
   * 幂等（同 client_request_id）→ assessment 权限（学生 workspace 命令拒绝）
   * → F3 纯执行 → 单批原子 [student_workspace_command_recorded +
   * action_outcome_recorded{causation→命令事实}] → evaluator/consume → 呈现。
   */
  private commitStudentWorkspaceCommand(
    command: StudentWorkspaceCommandV5,
    options: { expectedRevision?: number; source: "direct" | "accepted_action_evidence"; evidenceActionId?: string },
  ): V7CommandTurnResult {
    this.refreshWrappers();
    const conflict = this.checkExpectedRevision(options.expectedRevision);
    if (conflict) {
      return { revision: conflict.revision, turn: conflict.turn, presentations: [], snapshot: this.snapshot() };
    }
    // assessment 权限矩阵：Workspace locked——学生命令拒绝（零事件）。
    if (this.assessmentMode) {
      throw new OrchestratorV7Error(
        "ASSESSMENT_INTENT_FORBIDDEN",
        `assessment mode forbids student workspace commands (catalog locked; zero facts)`,
      );
    }
    // 幂等重试：同 client_request_id 已提交 → 读已提交事实（漂移显式拒绝）。
    const committed = findCommittedV7StudentCommand(this.events, command.client_command_id);
    if (committed) {
      return this.replayCommittedStudentCommand(command, committed);
    }
    // F3 纯执行（canonical+capability+target/mode/truth/stale 全部校验）。
    const fold = this.rebuildWorkspace();
    const execution = executeStudentWorkspaceCommandV5({ fold, catalog: this.catalog, command });
    const recordedPayload: V7StudentWorkspaceCommandRecordedPayload = {
      command_id: command.command_id,
      surface: command.surface,
      capability: command.capability,
      origin: "student",
      target_ids: command.target_ids,
      ...(command.params !== undefined ? { params: command.params } : {}),
      expected_workspace_revision: command.expected_workspace_revision,
      client_request_id: command.client_command_id,
      source: options.source,
      ...(options.evidenceActionId !== undefined ? { evidence_action_id: options.evidenceActionId } : {}),
    };
    if (execution.status === "rejected" && !execution.events) {
      // canonical 非法：零事实（事件对无法组装）——显式失败返回。
      this.refreshWrappers();
      return {
        revision: this.navigator.revision,
        turn: { revision: this.navigator.revision, inputSequence: this.navigator.revision, failure: { failure_class: "invalid_command", message: execution.reason } },
        presentations: [],
        snapshot: this.snapshot(),
      };
    }
    // 单批原子：命令事实 + 回执（causation → 命令事实 sequence；预测 = 流长 +1）。
    const commandSequence = this.events.length + 1;
    const outcomePayload = (execution.status === "completed" ? execution.events.outcomePayload : execution.events!.outcomePayload);
    this.appendViaKernel(this.navigator.revision, [
      {
        event_type: "student_workspace_command_recorded",
        payload: recordedPayload,
        occurred_at: nowIso(),
        idempotency_key: (() => { const key = composeIdempotencyKey(["sc", this.sessionId, command.client_command_id]); assertIdempotencyKeyShape(key); return key; })(),
      },
      {
        event_type: "action_outcome_recorded",
        payload: outcomePayload,
        occurred_at: nowIso(),
        causation_sequence: commandSequence,
        idempotency_key: `sc-outcome:${command.command_id}`,
      },
    ]);
    if (execution.status === "rejected") {
      // F3 拒绝是学生输入事实（命令+rejected 回执已入流；零状态效果、零 revision）。
      this.refreshWrappers();
      return {
        revision: this.navigator.revision,
        turn: { revision: this.navigator.revision, inputSequence: commandSequence, failure: { failure_class: "command_rejected", message: execution.reason } },
        presentations: [],
        snapshot: this.snapshot(),
      };
    }
    // completed ≠ 数学正确：gate 只消费单一 typed evaluator 的 verified assessment。
    const turn = this.navigator.consumeWorkspaceCommandOutcome({
      command_id: command.command_id,
      ...(this.adjudicateIfActionBound(command, commandSequence + 1) ?? {}),
    });
    const presentations = this.presentAfterDecision(turn);
    this.refreshWrappers();
    return { revision: this.navigator.revision, turn, presentations, snapshot: this.snapshot() };
  }

  /**
   * 幂等重试/崩溃恢复收口（F6.1 语义的 v7 落点）：同 client_request_id 解析已
   * 提交事实——载荷漂移 → WORKSPACE_COMMAND_PAYLOAD_DRIFT（零事件）；outcome=
   * completed 且未消费（崩溃窗口）→ 现在消费（恰好一次）；其余幂等回放。
   */
  private replayCommittedStudentCommand(
    command: StudentWorkspaceCommandV5,
    committed: NonNullable<ReturnType<typeof findCommittedV7StudentCommand>>,
  ): V7CommandTurnResult {
    const retryPayload = semanticCommandFields(command);
    if (!fieldsDeepEqual(retryPayload, committed.semanticFields)) {
      throw new OrchestratorV7Error(
        "WORKSPACE_COMMAND_PAYLOAD_DRIFT",
        `client_request_id=${command.client_command_id} retry payload drifts from the committed command (committed=${JSON.stringify(committed.semanticFields)} vs retry=${JSON.stringify(retryPayload)}); explicit refusal, zero facts`,
      );
    }
    if (committed.outcomeSequence === undefined || committed.outcome === undefined) {
      throw new OrchestratorV7Error(
        "WORKSPACE_COMMAND_UNRESOLVABLE",
        `duplicate client_request_id=${command.client_command_id} has no committed command receipt to replay (fail closed; nothing to consume)`,
      );
    }
    const consumed = this.events.some((event) => event.causation_sequence === committed.outcomeSequence);
    if (!consumed && committed.outcome === "completed") {
      const turn = this.navigator.consumeWorkspaceCommandOutcome({
        command_id: committed.commandId,
        ...(this.adjudicateIfActionBound(command, committed.outcomeSequence) ?? {}),
      });
      const presentations = this.presentAfterDecision(turn);
      this.refreshWrappers();
      return { revision: this.navigator.revision, turn, presentations, snapshot: this.snapshot() };
    }
    this.refreshWrappers();
    return {
      revision: this.navigator.revision,
      turn: {
        revision: this.navigator.revision,
        inputSequence: committed.commandSequence,
        ...(committed.decision !== undefined ? { decision: committed.decision } : {}),
      },
      presentations: [],
      snapshot: this.snapshot(),
    };
  }

  /**
   * F7 因果链 2（统一 adjudication，v7）：当前 Beat 的 gate 为 workspace_command
   * 且 pinned plan 解析出 ActionTemplate 时，对 command payload 跑同一 typed
   * evaluator，产出 Gate 消费的 WorkspaceGateAssessment（VerifiedCorrect |
   * VerifiedWrong；NotApplicable = 非 action-bound Beat → undefined）。直接命令
   * 由此与结构化 evidence 走同一判定——completed 但数学错误是合法组合（痕迹
   * 保留、gate 不满足）。
   */
  private adjudicateIfActionBound(command: unknown, receiptSequence: number): { assessment: WorkspaceGateAssessmentInput } | undefined {
    const beat = this.navigator.currentBeat;
    if (beat.completion_evidence.evidence_kind !== "workspace_command") return undefined;
    const resolved = resolveBeatActionTemplate(this.binding.imported.plan.resources, beat);
    if (!resolved) return undefined;
    const body = command as { target_ids?: string[]; params?: { values?: Record<string, unknown> } };
    const diagnosis = adjudicateCommandPayload(resolved.template, {
      target_ids: body.target_ids ?? [],
      params: body.params,
    });
    return {
      assessment: {
        verdict: diagnosis.accepted ? "verified-correct" : "verified-wrong",
        evidence_sequence: receiptSequence,
        ...(diagnosis.accepted ? {} : { diagnosis: undefined }),
      },
    };
  }

  // ------------------------------------------------------------------ //
  // 浏览器 outcome 轮（v6 同款）
  // ------------------------------------------------------------------ //

  /**
   * 浏览器 outcome 轮：三元组与 pending cursor 唯一对账（不符 fail closed 零事件；
   * 同三元组同值已提交 → 幂等回放零新事件）→ outcome 批（interrupted 同批
   * superseded）→ presented 且非末项：同调用内备好下一项 delivery。
   */
  reportPresentationOutcome(request: V7PresentationOutcomeRequest): V7OutcomeTurnResult {
    this.refreshWrappers();
    this.assertVisualWrite(request.execution_owner,true);
    if(this.eventSchema === "v10") {
      const key=composeIdempotencyKey([this.sessionId,"poutcome",request.sequence_id,String(request.ordinal),request.action_id,request.client_request_id]);
      const prior=this.events.find(e=>e.idempotency_key===key);
      if(prior) {
        const hold=this.events.find(e=>String(e.event_type)==="visual_barrier_changed"&&e.causation_sequence===prior.sequence
          && (e.payload as {barrier?:VisualBarrier}).barrier?.status === "awaiting-control");
        const oldHold=(hold?.payload as {barrier?:{control_request_id?:string}}|undefined)?.barrier?.control_request_id;
        if(prior.payload.outcome!==request.outcome || prior.payload.failure_class!==request.failure_class || prior.payload.message!==request.message || oldHold!==request.hold_for_control?.client_request_id)
          throw new VisualLifecycleError("REQUEST_PAYLOAD_DRIFT","outcome retry changed its original result or hold");
        this.recoverVisualContinuation();
        return {revision:this.revision,advanced:false,snapshot:this.snapshot(this.question.stem)};
      }
      if(request.expected_revision!==this.revision) throw new VisualLifecycleError("REVISION_CONFLICT","outcome revision is stale");
    }
    const conflict = this.checkExpectedRevision(request.expected_revision);
    if (conflict) {
      return { revision: conflict.revision, advanced: false, snapshot: this.snapshot(this.question.stem) };
    }
    const cursor = this.navigator.state.presentation_cursor;
    const matches = (ref: { sequence_id: string; ordinal: number; action_id: string }): boolean =>
      cursor.status === "awaiting_browser"
      && cursor.sequence_id === ref.sequence_id
      && cursor.ordinal === ref.ordinal
      && cursor.action_id === ref.action_id;
    if (!matches(request)) {
      const committed = findCommittedOutcome(this.events, request);
      if (committed && committed.outcome === request.outcome) {
        return { revision: this.navigator.revision, advanced: false, snapshot: this.snapshot(this.question.stem) };
      }
      if (committed) {
        throw new OrchestratorV7Error(
          "PRESENTATION_CURSOR_MISMATCH",
          `outcome for ${request.action_id}@${request.ordinal} of ${request.sequence_id} conflicts with the committed outcome (${committed.outcome}); fail closed, zero events`,
        );
      }
      const at = cursor.status === "idle" ? "idle" : `${cursor.action_id}@${cursor.ordinal} of ${cursor.sequence_id} (${cursor.status})`;
      throw new OrchestratorV7Error(
        "PRESENTATION_CURSOR_MISMATCH",
        `outcome for ${request.action_id}@${request.ordinal} of ${request.sequence_id} does not match the pending cursor (at ${at}); fail closed, zero events`,
      );
    }
    const planned = this.plannedSequenceOf(request.sequence_id);
    if (!planned) {
      throw new OrchestratorV7Error("PRESENTATION_CURSOR_MISMATCH", `sequence ${request.sequence_id} has no committed planned fact (corrupt stream)`);
    }
    const action = planned.actions.find((candidate) => candidate.ordinal === request.ordinal);
    if (!action || actionIdOf(action) !== request.action_id) {
      throw new OrchestratorV7Error("PRESENTATION_CURSOR_MISMATCH", `outcome ref ${request.action_id}@${request.ordinal} does not match the planned action (corrupt stream)`);
    }
    const deliveredSequence = findDeliveredSequence(this.events, request);
    if (deliveredSequence === undefined) {
      throw new OrchestratorV7Error("PRESENTATION_CURSOR_MISMATCH", `no committed delivery for ${request.action_id}@${request.ordinal} of ${request.sequence_id} (corrupt stream)`);
    }
    const outcomeSequence = this.events.length + 1;
    const batch: PendingV7Event[] = [
      {
        event_type: "presentation_action_outcome_recorded",
        payload: {
          sequence_id: request.sequence_id,
          ordinal: request.ordinal,
          action_id: request.action_id,
          kind: action.kind,
          outcome: request.outcome,
          ...(request.outcome === "failed" && request.failure_class !== undefined ? { failure_class: request.failure_class } : {}),
          ...(request.outcome === "failed" && request.message !== undefined ? { message: request.message } : {}),
        },
        occurred_at: nowIso(),
        causation_sequence: deliveredSequence,
        idempotency_key: (() => { const key = composeIdempotencyKey([this.sessionId, "poutcome", request.sequence_id, String(request.ordinal), request.action_id, request.client_request_id]); assertIdempotencyKeyShape(key); return key; })(),
      },
    ];
    if (request.outcome === "interrupted") {
      batch.push({
        event_type: "presentation_sequence_superseded",
        payload: {
          sequence_id: request.sequence_id,
          reason: "interrupted",
          pending_ordinal: request.ordinal,
          pending_action_id: request.action_id,
        },
        occurred_at: nowIso(),
        causation_sequence: outcomeSequence,
      });
    }
    const visual=this.visualLifecycle;
    if(visual) {
      const barrier=visual.visual_barrier;
      if(barrier && (barrier.status !== "awaiting-cleanup" || barrier.cleanup_sequence_id !== request.sequence_id)) throw new VisualLifecycleError("VISUAL_BARRIER_ACTIVE","outcome does not match cleanup");
      if(barrier) {
        if(request.hold_for_control) throw new VisualLifecycleError("VISUAL_HOLD_INVALID","cleanup cannot acquire a control hold");
        batch.push({event_type:"visual_barrier_changed",payload:{previous_barrier_id:barrier.barrier_id,
          barrier:request.outcome === "presented" ? null : {...barrier,status:"failed"}},occurred_at:nowIso(),causation_sequence:outcomeSequence} as unknown as PendingV7Event);
      } else if(request.hold_for_control) {
        batch.push({event_type:"visual_barrier_changed",payload:{previous_barrier_id:null,barrier:{barrier_id:`${this.sessionId}/event/${outcomeSequence}`,cause:"barge-in",status:"awaiting-control",
          execution_owner:visual.presentation_execution_owner,control_request_id:request.hold_for_control.client_request_id}},occurred_at:nowIso(),causation_sequence:outcomeSequence} as unknown as PendingV7Event);
      }
    }
    this.appendViaKernel(this.navigator.revision, batch);
    if(visual?.visual_barrier && request.outcome === "presented") this.recoverVisualContinuation();
    if (request.outcome === "presented" && !request.hold_for_control && !visual?.visual_barrier && request.ordinal + 1 < planned.actions.length) {
      const plannedEvent = findPlannedSequenceEvent(this.events, request.sequence_id)!;
      this.deliverOrdinal(planned, plannedEvent.sequence, request.ordinal + 1);
      this.refreshWrappers();
      return { revision: this.navigator.revision, advanced: true, snapshot: this.snapshot(this.question.stem) };
    }
    this.refreshWrappers();
    return { revision: this.navigator.revision, advanced: false, snapshot: this.snapshot(this.question.stem) };
  }

  // ------------------------------------------------------------------ //
  // 呈现编排（有序交付环；v6 同款 + assessment presenter 模式）
  // ------------------------------------------------------------------ //

  /** 呈现当前 Beat（对最近一个 execute_beat 决策）：Presenter realize → 计划 → 队首交付。 */
  presentCurrentBeat(): V7PresentationReport {
    if(this.visualLifecycle?.visual_barrier) throw new VisualLifecycleError("VISUAL_BARRIER_ACTIVE","teaching cannot start before cleanup");
    const decisionEntry = latestExecuteBeatDecision(this.events);
    if (!decisionEntry) {
      throw new OrchestratorV7Error("NO_EXECUTABLE_DECISION", `no committed execute_beat decision to present in ${this.sessionId}`);
    }
    return this.realizeAndDeliver(decisionEntry.decision, decisionEntry.sequence, {});
  }

  /** 当前学生安全 active action（ActiveActionProjector 门面；Step 3/4 保留链）。 */
  activeAction(promptLatex: string): ActiveAction | undefined {
    return this.projectActiveActionFromWorkspace(promptLatex,this.rebuildWorkspace());
  }

  private projectActiveActionFromWorkspace(promptLatex:string, workspaceRebuild:WorkspaceFold):ActiveAction|undefined {
    return projectActiveAction({
      resources: this.binding.imported.plan.resources,
      actionContracts: (this.binding.imported.projection as { action_contracts?: ProjectedActionContract[] }).action_contracts ?? [],
      beat: this.navigator.currentBeat,
      catalog: this.catalog,
      committedTutorCommands: workspaceRebuild.context.tutorCommands,
      workspaceRevision: workspaceRebuild.state.revision,
      taskId: this.binding.taskId,
      promptLatex,
    });
  }

  /** 服务层快照（fresh rebuild 投影；pending delivery 从 committed 事实构造）。 */
  snapshot(promptLatex = ""): V7SessionSnapshot {
    const projectionStamp = projectionReadStamp();
    let tutorState = this.navigator.rebuildState();
    // A long-lived source may have missed another process's committed Beat or
    // owner change. Do not combine its cached currentBeat with fresh views.
    if (this.navigator.state.state_revision !== tutorState.state_revision) {
      this.refreshWrappers();
      tutorState = this.navigator.rebuildState();
      if (this.navigator.state.state_revision !== tutorState.state_revision || this.revision !== tutorState.state_revision) {
        throw new VisualLifecycleError("REVISION_CONFLICT", "snapshot source changed during refresh; fresh verification required");
      }
    }
    const visualWorkspace=this.eventSchema === "v10" ? rebuildWorkspaceRuntimeStateV10(this.sessionId,this.catalog,visualRegistryProvider(this.resolver)) : undefined;
    const workspace = visualWorkspace ? this.visualWorkspaceDomainFold(visualWorkspace) : this.rebuildWorkspace();
    const events = this.events;
    const baseViews = projectV6Views({
      sessionId: this.sessionId,
      tutorState: tutorState as unknown as Parameters<typeof projectV6Views>[0]["tutorState"],
      workspaceState: workspace.state,
      events: events as never,
      plan: this.binding.plan,
      catalog: this.catalog,
      factEntryIds: this.binding.golden.factEntryIds,
      sessionRevision: this.navigator.revision,
      resources: this.binding.imported.plan.resources,
    });
    const views: V7SessionSnapshot["views"] = this.navigator.eventSchema === "v10"
      ? {...baseViews,studentWorkspaceView:projectStudentWorkspaceViewV10(visualWorkspace!,this.catalog,baseViews.participation)}
      : this.navigator.eventSchema !== "v7"
      ? { ...baseViews, studentWorkspaceView: projectStudentWorkspaceViewV9(
          workspace.state, this.catalog, baseViews.participation,
        ) }
      : baseViews;
    const active = (() => {
      // active action 只在 workspace_input 相位挂载（spec §1.3 / PLAN Step 4）：
      // 末项 presented 进入 awaiting_evidence 且无 pending delivery。
      const presenterIdle = tutorState.teaching_cursor.phase === "awaiting_evidence"
        && tutorState.presentation_cursor.status === "idle";
      return presenterIdle ? this.projectActiveActionFromWorkspace(promptLatex,workspace) : undefined;
    })();
    const pending = projectPendingPresentation({
      sessionId: this.sessionId,
      events: events as never,
      cursor: tutorState.presentation_cursor,
      revision: this.navigator.revision,
    });
    const snapshot: V7SessionSnapshot = {
      schema: "tutor-session-snapshot/v6-service",
      session_id: this.sessionId,
      task_id: this.binding.taskId,
      revision: this.navigator.revision,
      teaching_phase: tutorState.teaching_cursor.phase ?? "presenting",
      completed: tutorState.completed === true,
      presentation_cursor: tutorState.presentation_cursor,
      views,
      ...(active !== undefined ? { active_action: active } : {}),
      ...(pending !== undefined ? { pending_presentation: pending } : {}),
    };
    registerSnapshotProjection(snapshot, this, this.eventSchema, {
      runtimeState: tutorState as unknown as Record<string, unknown>,
      workspace: { state: { revision: workspace.state.revision }, context: { tutorCommands: workspace.context.tutorCommands } },
      baseGeometry: this.catalog.baseGeometry,
      ...(this.eventSchema === "v10" ? { visualLifecycle: {
        presentation_execution_owner: (tutorState as unknown as TutorRuntimeStateV10).presentation_execution_owner,
        visual_barrier: (tutorState as unknown as TutorRuntimeStateV10).visual_barrier,
      } } : {}),
    }, projectionStamp, () => stableVisualJson({
      session: this.sessionId, revision: this.revision, schema: this.eventSchema,
      plan: this.binding.plan.tutor_plan_ref, model: this.model.pin,
      presenter: this.presenterGenerator?.pin, catalog: workspaceCatalogPin(this.catalog),
    }));
    return snapshot;
  }

  // ------------------------------------------------------------------ //
  // 内部：决策后呈现 / 交付 / 恢复（v6 同款）
  // ------------------------------------------------------------------ //

  private configureVisualNavigation():void {
    if(this.eventSchema !== "v10") return;
    this.navigator.setDecisionBatchComposer(prepared=>{
      const state=this.navigator.state as unknown as TutorRuntimeStateV10;
      const events=this.events as unknown as StoredSessionEvent[];
      const decisions=prepared.events.filter(e=>e.event_type === "policy_decision_made");
      const inquiryAdvanced=decisions.some(e=>(e.payload as Record<string,unknown>).decision_kind === "continue_inquiry") && visualScopeEpochs([...events,...prepared.events as unknown as StoredSessionEvent[]],this.visualContext().visual.resolveInquiryEntryBeat).counter>state.scope_epoch;
      const changes=inquiryAdvanced || decisions.some(e=>["transition_beat","revisit_beat","open_inquiry","open_scaffold","return_to_mainline","complete_beat"].includes(String((e.payload as Record<string,unknown>).decision_kind)));
      if(!changes && state.generation_slot.status !== "pending") return prepared;
      const prefix:PendingSessionEvent[]=[];
      if(state.generation_slot.status === "pending") {
        const record=state.generation_requests.find(r=>r.request_id===(state.generation_slot as {request_id:string}).request_id)!;
        const {phase,retry_at,...rest}=record;
        prefix.push({event_type:"presentation_generation_invalidated",payload:{...rest,status:"cancelled",cancel_reason:"superseded_by_new_input"},occurred_at:nowIso(),causation_sequence:events.at(-1)!.sequence});
      }
      const shift=prefix.length,first=events.at(-1)!.sequence+1;
      const shifted=prepared.events.map(e=>{
        const payload={...(e.payload as Record<string,unknown>)};
        for(const name of ["source_event_sequence","evidence_sequence"]) if(typeof payload[name]==="number" && (payload[name] as number)>=first) payload[name]=(payload[name] as number)+shift;
        return {...e,payload,...(e.causation_sequence!==undefined?{causation_sequence:e.causation_sequence>=first?e.causation_sequence+shift:e.causation_sequence}:{})};
      });
      if(!changes) return {...prepared,events:[...prefix,...shifted] as PendingV7Event[],result:{...prepared.result,
        ...(prepared.result.decisionSequence!==undefined?{decisionSequence:prepared.result.decisionSequence+shift}:{})}};
      const batch=visualTransitionBatch(state,events,[...prefix,...shifted],prepared.events.some(e=>e.event_type==="session_completed")?"completion":"scope-transition",this.visualContext(),nowIso());
      return {...prepared,events:batch as PendingV7Event[],result:{...prepared.result,
        ...(prepared.result.decisionSequence!==undefined?{decisionSequence:prepared.result.decisionSequence+shift}:{})}};
    });
  }
  private visualContext():V10FoldContext { return visualRegistryProvider(this.resolver)(this.events[0].payload); }
  assertVisualWrite(owner:unknown, allowBarrier=false):void {
    if(this.eventSchema !== "v10") return;
    const state=this.navigator.rebuildState() as unknown as TutorRuntimeStateV10;
    assertVisualExecutionOwner(state,owner);
    if(state.visual_barrier && !allowBarrier) throw new VisualLifecycleError("VISUAL_BARRIER_ACTIVE","visual cleanup must settle first");
  }
  get visualLifecycle():{presentation_execution_owner:VisualExecutionOwner;visual_barrier:VisualBarrier|null}|undefined {
    if(this.eventSchema !== "v10") return undefined;
    const state=this.navigator.state as unknown as TutorRuntimeStateV10;
    return {presentation_execution_owner:state.presentation_execution_owner,visual_barrier:state.visual_barrier};
  }
  private assertDeliverySettled(): void {
    if (this.navigator.state.presentation_cursor.status === "awaiting_browser") {
      throw new OrchestratorV7Error(
        "PRESENTATION_AWAITING_BROWSER",
        "presentation is awaiting_browser; settle the delivered action or explicitly barge_in before submitting input (zero events)",
      );
    }
  }

  /** Rebuild the commit/reservation gap from facts, never from a second retry ledger. */
  private recoverUnreservedPresentation(turn: V7TurnResult): V7PresentationReport[] {
    if (this.navigator.eventSchema === "v7" || this.presenterGenerator === undefined
      || this.assessmentMode || turn.failure || !turn.decision || turn.decisionSequence === undefined) return [];
    const kind = turn.decision.decision_kind;
    if (!["execute_beat", "request_clarification", "return_to_mainline", "transition_beat", "open_inquiry", "open_scaffold"].includes(kind)) return [];
    const later = this.events.filter(event => event.sequence > turn.decisionSequence!);
    // Any existing reservation (including failed/cancelled) is owned by the
    // generation/retry_recovery protocol. Never manufacture another budget.
    if (later.some(event => String(event.event_type) === "presentation_generation_requested"
      || event.event_type === "presentation_sequence_planned"
      || event.event_type === "student_input_recorded"
      || event.event_type === "student_workspace_command_recorded")) return [];
    const decisions = later.filter(event => event.event_type === "policy_decision_made");
    // A follow-up execution anchor may already have committed before the crash.
    // Only the direct causal child belongs to this turn; newer decisions supersede it.
    const anchor = decisions.length === 1
      && decisions[0].causation_sequence === turn.decisionSequence
      && (decisions[0].payload as unknown as NavigatorDecision).decision_kind === "execute_beat"
      ? decisions[0] : undefined;
    if (decisions.length && !anchor) return [];
    this.assertDeliverySettled();
    if ((this.navigator.state.presentation_cursor.status === "failed" || this.undeliveredPresentationFailure())
      || this.navigator.state.generation_slot?.status === "failed") {
      throw new OrchestratorV7Error("PRESENTATION_FAILED_PENDING_RECOVERY", "failed presentation requires control.retry_recovery before repairing a missing reservation");
    }
    if (this.hasPendingGeneration()) return [];
    if (anchor) {
      const decision = anchor.payload as unknown as NavigatorDecision;
      if (decision.protocol_id !== this.navigator.currentBeat.protocol_id || decision.beat_id !== this.navigator.currentBeat.beat_id) return [];
      return [this.reserveGenerationForDecision(decision, anchor.sequence)];
    }
    if (kind === "transition_beat" || kind === "open_inquiry" || kind === "open_scaffold") {
      // No execution anchor exists yet. This creates only that missing anchor;
      // it does not submit student evidence, call the adjudicator, or evaluate a gate.
      return this.presentAfterDecision(turn);
    }
    if (turn.decision.protocol_id !== this.navigator.currentBeat.protocol_id
      || turn.decision.beat_id !== this.navigator.currentBeat.beat_id) return [];
    return [this.reserveGenerationForDecision(turn.decision, turn.decisionSequence)];
  }

  /** 决策后呈现策略：transition→executeCurrentBeat；execute/return/clarification→
   * presentCurrentBeat；open_inquiry/open_scaffold→锚定 inquiry entry beat 呈现。 */
  private presentAfterDecision(turn: V7TurnResult): V7PresentationReport[] {
    if(this.visualLifecycle?.visual_barrier) return [];
    const decision = turn.decision;
    if (!decision) return [];
    if (decision.decision_kind === "transition_beat" && decision.to_beat_id) {
      const executionDecision = this.navigator.executeCurrentBeat();
      if (executionDecision.decision && executionDecision.decisionSequence !== undefined) {
        return [this.realizeAndDeliver(executionDecision.decision, executionDecision.decisionSequence, {})];
      }
      return [];
    }
    if (
      decision.decision_kind === "execute_beat"
      || decision.decision_kind === "return_to_mainline"
      || decision.decision_kind === "request_clarification"
    ) {
      return [this.presentCurrentBeat()];
    }
    if (decision.decision_kind === "open_inquiry" || decision.decision_kind === "open_scaffold") {
      // assessment 会话不开 inquiry/scaffold（presenter 权限已在输入链拒绝；
      // 决策层安全兜底：不呈现教学帮助序列）。
      if (this.assessmentMode) return [];
      const anchor = this.navigator.executeCurrentBeat();
      if (anchor.decision && anchor.decisionSequence !== undefined) {
        return [this.realizeAndDeliver(anchor.decision, anchor.decisionSequence, {
          supportEvidence: decision.decision_kind === "open_scaffold",
        })];
      }
      return [];
    }
    return [];
  }

  private realizeAndDeliver(
    decision: NavigatorDecision,
    decisionSequence: number,
    options: { supportEvidence?: boolean },
  ): V7PresentationReport {
    // F7 RT4（v9）：呈现拆「预约（本方法）→ drivePendingGeneration（事务外模型
    // 调用+编译+预演+原子提交）→ deliverOrdinal（既有交付链）」；预约返回的
    // report 不携带 sequence（未 planned 不伪造 id）。
    if (this.presenterGenerator !== undefined && this.navigator.eventSchema !== "v7" && !this.assessmentMode) {
      return this.reserveGenerationForDecision(decision, decisionSequence);
    }
    const beat = this.navigator.currentBeat;
    const protocol = this.binding.imported.protocols.get(beat.protocol_id);
    const beatPayload = protocol?.beats.find((candidate) => candidate.beat_id === beat.beat_id);
    const workspaceRebuild = this.rebuildWorkspace();
    const plan = realizePresentationPlanV6({
      sessionId: this.sessionId,
      sequenceSerial: this.countPlanned() + 1,
      decision,
      beat,
      presentationIntent: beatPayload?.presentation_intent,
      resources: new Map(this.binding.imported.plan.resources.map((resource) => [resource.resource_id, resource])),
      catalog: this.catalog,
      factEntryIds: this.binding.golden.factEntryIds,
      gateLedger: workspaceRebuild.context.gateLedger,
      hiddenEntryIds: new Set(
        workspaceRebuild.state.solution_board.entries
          .filter((entry) => entry.visibility === "hidden")
          .map((entry) => entry.entry_id),
      ),
      committedElementIds: new Set(workspaceRebuild.state.geometry.committed_element_ids),
      representTargets: this.representTargets(),
      // assessment 模式：单确定性指示 voice、零 workspace action（TutorPresenterV6
      // 既有能力；无教学帮助、无答案揭示）。
      ...(this.assessmentMode ? { assessmentMode: true } : {}),
    });
    // 队首 workspace 先经 F3 validator（五重校验）——拒绝即零事件。
    if (plan.actions[0].kind === "workspace") {
      const receipt = this.validateWorkspaceAction(plan, workspaceRebuild, 0);
      if (receipt.status === "rejected") {
        throw new OrchestratorV7Error(
          "WORKSPACE_APPLY_REJECTED",
          `head workspace action of ${plan.sequence_id} rejected by F3 validator: ${receipt.reason} (zero events; sequence never registered)`,
        );
      }
    }
    const batch: PendingV7Event[] = [
      {
        event_type: "presentation_sequence_planned",
        payload: plannedPayloadOf(plan),
        occurred_at: nowIso(),
        causation_sequence: decisionSequence,
        idempotency_key: `${this.sessionId}:ps:${plan.sequence_id}`,
      },
    ];
    if (options.supportEvidence) {
      const voiceAction = plan.actions.find((action) => action.kind === "voice");
      if (voiceAction) {
        const ese = buildExternalSupportEvidence({
          session_id: this.sessionId,
          evidence_id: `ESE-${this.sessionId}-${plan.sequence_id}`,
          beat,
          support_kinds: ["orient"],
          initiated_by: "student_requested",
          action_ids: [actionIdOf(voiceAction)],
        });
        if (!ese.ok) throw new OrchestratorV7Error("PLAN_IMPORT_FAILED", `external support evidence failed closed: ${ese.errors.join("; ")}`);
        batch.push({
          event_type: "external_support_recorded",
          payload: ese.payload,
          occurred_at: nowIso(),
          causation_sequence: decisionSequence,
        });
      }
    }
    const appended = this.appendViaKernel(this.navigator.revision, batch);
    return this.deliverOrdinal(plan, appended.appendedSequences[0], 0)!;
  }

  /** 交付指定 ordinal（validated → [applied] → delivered 单批；causation→planned）。 */
  private deliverOrdinal(
    sequence: DeliverableSequence,
    plannedSequenceEventSequence: number,
    ordinal: number,
  ): V7PresentationReport | undefined {
    const action = sequence.actions[ordinal];
    if (!action) return undefined;
    const ref = {
      sequence_id: sequence.sequence_id,
      ordinal,
      action_id: actionIdOf(action),
      kind: action.kind,
    };
    const batch: PendingV7Event[] = [
      {
        event_type: "presentation_action_validated",
        payload: { ...ref },
        occurred_at: nowIso(),
        causation_sequence: plannedSequenceEventSequence,
        idempotency_key: `${this.sessionId}:${sequence.sequence_id}:val:${ordinal}`,
      },
    ];
    if (action.kind === "workspace") {
      const workspaceRebuild = this.rebuildWorkspace();
      const receipt = this.validateWorkspaceAction(sequence, workspaceRebuild, ordinal);
      if (receipt.status === "rejected") {
        if(this.eventSchema === "v9" && !this.undeliveredPresentationFailure()) this.appendViaKernel(this.navigator.revision,[{
          event_type:"runtime_failure",payload:{failure_class:"internal_error",related_event_sequence:plannedSequenceEventSequence,
            message:`workspace delivery rejected: ${receipt.reason}`},occurred_at:nowIso(),causation_sequence:plannedSequenceEventSequence,
          idempotency_key:`${this.sessionId}:${sequence.sequence_id}:delivery-rejected:${ordinal}`,
        }]);
        throw new OrchestratorV7Error(
          "WORKSPACE_APPLY_REJECTED",
          `workspace action ${ref.action_id}@${ordinal} of ${sequence.sequence_id} rejected by F3 validator: ${receipt.reason} (fail closed)`,
        );
      }
      const resultingRevision = receipt.status === "completed"
        ? (receipt.resultingRevision ?? workspaceRebuild.state.revision)
        : workspaceRebuild.state.revision;
      batch.push({
        event_type: "presentation_action_applied",
        payload: { ...ref, resulting_workspace_revision: resultingRevision },
        occurred_at: nowIso(),
        causation_sequence: plannedSequenceEventSequence,
        idempotency_key: `${this.sessionId}:${sequence.sequence_id}:app:${ordinal}`,
      });
    }
    batch.push({
      event_type: "presentation_action_delivered",
      payload: { ...ref },
      occurred_at: nowIso(),
      causation_sequence: plannedSequenceEventSequence,
      idempotency_key: `${this.sessionId}:${sequence.sequence_id}:del:${ordinal}`,
    });
    this.appendViaKernel(this.navigator.revision, batch);
    const pending = projectPendingPresentation({
      sessionId: this.sessionId,
      events: this.events as never,
      cursor: this.navigator.state.presentation_cursor,
      revision: this.navigator.revision,
    });
    return { sequence_id: sequence.sequence_id, beat_id: sequence.beat_id, plannedCount: sequence.actions.length, pending };
  }

  /** Undelivered rejection is a system fact, never a browser outcome. */
  private undeliveredPresentationFailure(): {sequence_id:string;ordinal:number;action_id:string;failureSequence:number}|undefined {
    if(this.eventSchema!=="v9")return;
    for(const event of [...this.events].reverse()) {
      if(event.event_type!=="runtime_failure" || event.payload.failure_class!=="internal_error")continue;
      const source=this.events.find(e=>e.sequence===event.payload.related_event_sequence && e.event_type==="presentation_sequence_planned");
      if(!source)continue;
      const plan=source.payload as unknown as CompiledPresentationPlanV4;
      if(isSequenceSuperseded(this.events,plan.sequence_id) || this.events.some(e=>e.sequence>event.sequence && e.event_type==="presentation_action_delivered" && (e.payload as {sequence_id:string}).sequence_id===plan.sequence_id))continue;
      const ordinal=nextUnpresentedOrdinal(this.events,plan.sequence_id,plan.actions.length);
      if(ordinal!==undefined)return {sequence_id:plan.sequence_id,ordinal,action_id:actionIdOf(plan.actions[ordinal]),failureSequence:event.sequence};
    }
  }

  /** resume 的崩溃窗口续投：planned 已提交、队首未 delivered → 续投恰好一次。 */
  private resumePresentation(): void {
    const state = this.navigator.state;
    if (state.presentation_cursor.status !== "idle" || state.completed || this.undeliveredPresentationFailure()) return;
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index];
      if (event.event_type !== "presentation_sequence_planned") continue;
      const payload = this.plannedSequenceOf((event.payload as { sequence_id: string }).sequence_id)!;
      if (isSequenceSuperseded(this.events, payload.sequence_id)) continue;
      const nextOrdinal = nextUnpresentedOrdinal(this.events, payload.sequence_id, payload.actions.length);
      if (nextOrdinal === undefined) return;
      this.deliverOrdinal(payload, event.sequence, nextOrdinal);
      return;
    }
  }

  /** barge-in 服务端侧：pending cursor → outcome interrupted + 同批 superseded。 */
  private closePendingAsInterrupted(): void {
    if(this.eventSchema === "v10") throw new VisualLifecycleError("VISUAL_ACTUAL_OUTCOME_REQUIRED","server cannot manufacture interrupted");
    const cursor = this.navigator.state.presentation_cursor;
    if (cursor.status !== "awaiting_browser") return;
    const planned = this.plannedSequenceOf(cursor.sequence_id);
    const action = planned?.actions.find((candidate) => candidate.ordinal === cursor.ordinal);
    const deliveredSequence = findDeliveredSequence(this.events, cursor);
    if (!planned || !action || deliveredSequence === undefined) {
      throw new OrchestratorV7Error("PRESENTATION_CURSOR_MISMATCH", `pending cursor ${cursor.action_id}@${cursor.ordinal} cannot be resolved against committed facts (corrupt stream)`);
    }
    const outcomeSequence = this.events.length + 1;
    const batch: PendingV7Event[] = [
      {
        event_type: "presentation_action_outcome_recorded",
        payload: {
          sequence_id: cursor.sequence_id,
          ordinal: cursor.ordinal,
          action_id: cursor.action_id,
          kind: action.kind,
          outcome: "interrupted",
        },
        occurred_at: nowIso(),
        causation_sequence: deliveredSequence,
        idempotency_key: `${this.sessionId}:poutcome:${cursor.sequence_id}:${cursor.ordinal}:${cursor.action_id}`,
      },
      {
        event_type: "presentation_sequence_superseded",
        payload: {
          sequence_id: cursor.sequence_id,
          reason: "interrupted",
          pending_ordinal: cursor.ordinal,
          pending_action_id: cursor.action_id,
        },
        occurred_at: nowIso(),
        causation_sequence: outcomeSequence,
      },
    ];
    this.appendViaKernel(this.navigator.revision, batch);
  }

  /**
   * retry_recovery（F7 P2-B/B4 分流）：
   * - presentation cursor=failed ⇒ 既有恢复链不变：supersede 原序列 + 新恢复序列；
   * - generation slot=failed（cursor idle）⇒ 生成耗尽后的显式重试（生成生命周期
   *   规格 :47「耗尽后可重新尝试」）：为原 decision/scope 预约**新生成请求**
   *   （新 request_id、全新 attempt 预算、当前合法状态重新冻结上下文；旧失败
   *   记录原样保留），随后由应用层正常 drive。
   * 两者皆非 ⇒ RETRY_RECOVERY_WITHOUT_FAILURE（fail closed、零事件）。
   */
  /** Recovery is a delivery reference to immutable committed content, not generation. */
  private recoverCommittedPresentation(cursor: {sequence_id:string;ordinal:number;action_id:string}, cause: number): { supersededSequence:number; report:V7PresentationReport } {
    const source = this.events.find(e => e.event_type === "presentation_sequence_planned"
      && (e.payload as {sequence_id:string}).sequence_id === cursor.sequence_id);
    if (!source) throw new OrchestratorV7Error("PRESENTATION_CURSOR_MISMATCH", "failed sequence has no committed content");
    const old = source.payload as unknown as CompiledPresentationPlanV4;
    const serial = String(this.countPlanned() + 1).padStart(4, "0");
    const actions = old.actions.slice(cursor.ordinal).map((action, ordinal) => ({...structuredClone(action), ordinal,
      ...(action.voice_action ? {voice_action:{...structuredClone(action.voice_action),action_id:`VA-${this.sessionId}-${serial}-R${ordinal}`}} : {}),
      ...(action.workspace_action ? {workspace_action:{...structuredClone(action.workspace_action),action_id:`WSA-${this.sessionId}-${serial}-R${ordinal}`}} : {}),
    }));
    const used = new Set(actions.flatMap(a => a.workspace_action?.capability === "board.explain" ? [a.workspace_action.command_payload!] : []));
    const refs = [...used].map(fragment_id => {
      const origin = this.events.find(e => e.event_type === "presentation_sequence_planned"
        && ((e.payload as unknown as CompiledPresentationPlanV4).explanation_fragments ?? []).some(f => f.fragment_id === fragment_id));
      const plan = origin?.payload as unknown as CompiledPresentationPlanV4 | undefined;
      const fragment = plan?.explanation_fragments?.find(f => f.fragment_id === fragment_id);
      if (!plan || !fragment) throw new OrchestratorV7Error("PRESENTATION_CURSOR_MISMATCH", `missing immutable fragment ${fragment_id}`);
      return {fragment_id,source_sequence_id:plan.sequence_id,content_hash:explanationFragmentContentHash(fragment)};
    });
    const plan = {schema:"ai_teaching_presentation_plan/v4",session_id:this.sessionId,sequence_id:`PS-${serial}`,
      decision_id:old.decision_id,scope:old.scope,...(old.generation?{generation:old.generation}:{}),actions,
      ...(refs.length?{existing_fragment_refs:refs}:{})} as CompiledPresentationPlanV4;
    // Recheck current permissions and dependencies before ending the failed cursor.
    preflightPresentationSequence({fold:this.rebuildWorkspace(),catalog:this.catalog,plan});
    const supersedeSequence = this.events.length + 1;
    const {schema:_schema,session_id:_session,...payload}=plan;
    const appended=this.appendViaKernel(this.navigator.revision,[{
      event_type:"presentation_sequence_superseded",payload:{sequence_id:cursor.sequence_id,reason:"retry_recovery",pending_ordinal:cursor.ordinal,pending_action_id:cursor.action_id},
      occurred_at:nowIso(),causation_sequence:cause,idempotency_key:`${this.sessionId}:pss:${cursor.sequence_id}`,
    },{event_type:"presentation_sequence_planned",payload,occurred_at:nowIso(),causation_sequence:supersedeSequence,
      idempotency_key:`${this.sessionId}:ps:${plan.sequence_id}`} as unknown as PendingV7Event]);
    const deliverable={...plan,beat_id:plan.scope.kind === "approved" ? plan.scope.beat_id : plan.scope.local_beat_id};
    return {supersededSequence:appended.appendedSequences[0],report:this.deliverOrdinal(deliverable,appended.appendedSequences[1],0)!};
  }

  private retryRecovery(): { supersededSequence: number; report: V7PresentationReport } {
    const systemFailure=this.undeliveredPresentationFailure();
    if(systemFailure)return this.recoverCommittedPresentation(systemFailure,systemFailure.failureSequence);
    const cursor = this.navigator.state.presentation_cursor;
    if (cursor.status === "failed") {
      const failedOutcomeSequence = findOutcomeSequence(this.events, cursor) ?? 1;
      if (this.eventSchema === "v9") return this.recoverCommittedPresentation(cursor, failedOutcomeSequence);
      const appended = this.appendViaKernel(this.navigator.revision, [
        {
          event_type: "presentation_sequence_superseded",
          payload: {
            sequence_id: cursor.sequence_id,
            reason: "retry_recovery",
            pending_ordinal: cursor.ordinal,
            pending_action_id: cursor.action_id,
          },
          occurred_at: nowIso(),
          causation_sequence: failedOutcomeSequence,
          idempotency_key: `${this.sessionId}:pss:${cursor.sequence_id}`,
        },
      ]);
      const report = this.presentCurrentBeat();
      return { supersededSequence: appended.appendedSequences[0], report };
    }
    const slot = this.navigator.state.generation_slot;
    if (slot?.status === "failed") {
      const failedRequest = (this.navigator.state.generation_requests as unknown as Array<{
        request_id: string;
        decision_id: string;
        scope: V9GenerationEventPayload["scope"];
      }> | undefined)?.find((record) => record.request_id === slot.request_id);
      if (!failedRequest) {
        throw new OrchestratorV7Error(
          "NO_EXECUTABLE_DECISION",
          `failed generation slot references unknown request ${slot.request_id} (corrupt stream; fail closed, zero events)`,
        );
      }
      if (this.presenterGenerator === undefined) {
        throw new OrchestratorV7Error(
          "NO_EXECUTABLE_DECISION",
          `generation retry_recovery for ${failedRequest.request_id} requires the presenter port to re-reserve (fail closed, zero events; provide the presenter model)`,
        );
      }
      const decisionSequence = this.events.find(
        (event) => event.event_type === "policy_decision_made"
          && (event.payload as { decision_id?: string }).decision_id === failedRequest.decision_id,
      )?.sequence;
      if (decisionSequence === undefined) {
        throw new OrchestratorV7Error(
          "NO_EXECUTABLE_DECISION",
          `failed generation ${failedRequest.request_id} references decision ${failedRequest.decision_id} with no committed policy_decision_made fact (corrupt stream; fail closed, zero events)`,
        );
      }
      // 重新冻结当前合法状态（规格 :43：显式重试使用当前合法状态和新预算；不修改
      // 旧失败记录）。source_request_id 携当前 revision 判别——与原预约（旧 revision）
      // 不同源，幂等身份不冲突；同 revision 重投同 payload ⇒ existing 幂等返回。
      const context = this.buildGenerationContext(null);
      const reservation = reserveGeneration(this.generationKernelAccess(), {
        sourceRequestId: `gen:${this.sessionId}:${failedRequest.decision_id}:r${this.navigator.revision}`,
        decisionId: failedRequest.decision_id,
        decisionSequence,
        scope: failedRequest.scope,
        contextDigest: context.digest,
        context: context.context as unknown as V9GenerationEventPayload["context"],
        inputText: null,
        presenterPin: this.presenterGenerator.pin as unknown as V9GenerationEventPayload["presenter_pin"],
        policy: {
          policy_version: "retry-policy/v1-default",
          max_attempts: 3,
          timeout_ms: 30_000,
          retry_delays_ms: [1_000, 3_000],
        },
      });
      const scope = reservation.request.scope;
      return {
        supersededSequence: 0,
        report: {
          sequence_id: "",
          beat_id: scope.kind === "approved" ? scope.beat_id : scope.local_beat_id,
          plannedCount: 0,
          generation: { request_id: reservation.request.request_id, status: "pending" },
        },
      };
    }
    throw new OrchestratorV7Error(
      "RETRY_RECOVERY_WITHOUT_FAILURE",
      `control.retry_recovery requires a failed presentation cursor or a failed generation slot (cursor=${cursor.status}, slot=${this.navigator.state.generation_slot?.status ?? "n/a"}); fail closed, zero events`,
    );
  }

  // ------------------------------------------------------------------ //
  // F7 RT4：v9 生成生命周期（预约 → 驱动 → 提交 → 队首交付）
  // ------------------------------------------------------------------ //

  /** v9 kernel 访问面（GenerationCoordinator 输入；append 走 kernel CAS 事务）。 */
  private generationKernelAccess(): GenerationKernelAccess {
    // 闭包捕获 orchestrator（getter 内 this 指向 access 对象——不绑定方法）。
    const navigator = () => this.navigator;
    return {
      sessionId: this.sessionId,
      get revision(): number {
        return navigator().revision;
      },
      get state(): never {
        return navigator().rebuildState() as never;
      },
      append: (expectedRevision: number, events: never[]) =>
        this.appendViaKernel(expectedRevision, events as never) as never,
    };
  }

  /** 当前教学任务的生成上下文（RT2：expand 仅扩上下文；纯只读计算）。 */
  private buildGenerationContext(inputText: string | null): BuiltPresentationContext {
    const beat = this.navigator.currentBeat;
    const graph = this.binding.imported.graph;
    const state = this.navigator.rebuildState();
    const events = this.events;
    const recentInputs = events
      .filter((event) => event.event_type === "student_input_recorded")
      .slice(-DEFAULT_CONTEXT_POLICY.recent_input_count)
      .map((event) => {
        const payload = event.payload as { input?: { kind?: string; channel?: "mainline" | "assistance"; text?: string } };
        return {
          sequence: event.sequence,
          channel: payload.input?.channel === "assistance" ? ("assistance" as const) : ("mainline" as const),
          ...(payload.input?.text !== undefined ? { text: payload.input.text } : {}),
        };
      });
    // Approved explanation bindings contribute optional, permission-filtered basis
    // only for this Beat's resources. Budget trimming also hides unusable tools.
    const explanationBindings = (this.binding.imported.plan.resource_bindings ?? [])
      .filter((binding): binding is Extract<PresentationResourceBinding, { binding_kind: "explanation" }> =>
        binding.binding_kind === "explanation" && beat.resource_ids.includes(binding.presentation_resource));
    const base = buildPresentationContext({
      regionFineRefs: {
        fact_ids: [...new Set(explanationBindings.flatMap((binding) => binding.basis_refs.fact_ids))],
        inference_ids: [...new Set(explanationBindings.flatMap((binding) => binding.basis_refs.inference_ids))],
      },
      planRef: this.binding.plan.tutor_plan_ref,
      graphRef: this.binding.plan.solution_graph_ref,
      graph: {
        facts: new Map(graph.facts.map((fact) => [fact.fact_id, fact])),
        inferences: new Map(graph.inferences.map((inference) => [inference.inference_id, inference])),
      },
      beat: {
        protocol_id: beat.protocol_id,
        beat_id: beat.beat_id,
        graph_fact_refs: [...beat.graph_fact_refs],
        inference_refs: [...beat.inference_refs],
        resource_ids: [...beat.resource_ids],
      },
      ...(state.reasoning_focus ? { reasoningFocusFactIds: [...state.reasoning_focus.graph_fact_refs] } : {}),
      recentInputs,
      // GenerationContextRef.event_cutoff = 冻结时权威 state revision（多事件
      // 批共享 revision——不得以原始事件数充当，否则 canonical cutoff≤reservation
      // 与 STALE_CONTEXT 双违）。
      eventCutoff: this.navigator.revision,
      workspaceRevision: this.rebuildWorkspace().state.revision,
      currentRevision: this.navigator.revision,
      policy: DEFAULT_CONTEXT_POLICY,
      sessionMode: "teaching",
      resourceContent: (resourceId: string) =>
        this.binding.imported.plan.resources.find((resource) => resource.resource_id === resourceId)?.content,
    });
    if(this.eventSchema!=="v10")return base;
    const registry=this.visualContext();
    return frozenVisualGeneration({base,events:this.events,hooks:registry.visual as ReturnType<typeof createPinnedVisualWorkspaceBridge>,sessionId:this.sessionId,capabilities:new Set(registry.capabilities.keys())}).context;
  }

  /** 模型可见工具实例（服务端已注册 capability ∩ Approved 绑定 ∩ mode；golden v5 ⇒ 空集）。 */
  private visibleGenerationTools(context: V9GenerationEventPayload["context"]) {
    const registered = new Set(
      listWorkspaceCapabilities()
        .filter((spec) => spec.origin === "tutor")
        .map((spec) => spec.capability),
    );
    if (registered.has("board.explain")) registered.add("solution_board.explain_fragment");
    const bindings = ((this.binding.imported.plan as { resource_bindings?: readonly PresentationResourceBinding[] }).resource_bindings ?? []) as readonly PresentationResourceBinding[];
    return visiblePresentationTools({ registeredCapabilities: registered, bindings: bindings.filter(binding => (binding as {binding_kind:string}).binding_kind !== "geometry_visual"), sessionMode: this.sessionMode,
      scopeAllows: (binding) => {
        if (binding.binding_kind === "explanation") return context.resource_ids.includes(binding.presentation_resource)
          && binding.basis_refs.fact_ids.every((id) => context.selected_fact_ids.includes(id))
          && binding.basis_refs.inference_ids.every((id) => context.selected_inference_ids.includes(id));
        if (binding.binding_kind === "geometry") return (resolveBeatConstructions(this.binding.imported.plan.resources, this.navigator.currentBeat) ?? [])
          .some((command) => binding.allowed_template_ids.includes(constructionOutputId(command) ?? ""));
        const entry = this.catalog.boardEntries.find((item) => item.entryId === binding.board_entry_id);
        return Boolean(entry && binding.reveal_after_gate
          && binding.reveal_after_gate.protocol_id === this.navigator.currentBeat.protocol_id);
      },
    });
  }

  /** 预约（幂等 source_request_id；决策因果锚；冻结上下文与预算）。 */
  private reserveGenerationForDecision(decision: NavigatorDecision, decisionSequence: number): V7PresentationReport {
    const context = this.buildGenerationContext(null);
    const reservation = reserveGeneration(this.generationKernelAccess(), {
      // source_request_id 携冻结 revision 判别：同决策在取消/失效后的重呈现是
      // **新的冻结上下文**（新任务新预算）；同 revision 重投同 payload ⇒ existing
      // 幂等返回（spec：异 payload 同源显式拒绝）。
      sourceRequestId: `gen:${this.sessionId}:${decision.decision_id}:r${this.navigator.revision}`,
      decisionId: decision.decision_id,
      decisionSequence,
      scope: this.eventSchema === "v10" ? (this.visualContext().visual as ReturnType<typeof createPinnedVisualWorkspaceBridge>).generationAt(this.events).authorization.currentOwner.scope : { kind: "approved", protocol_id: decision.protocol_id, beat_id: decision.beat_id },
      contextDigest: context.digest,
      context: context.context as unknown as V9GenerationEventPayload["context"],
      inputText: null,
      presenterPin: this.presenterGenerator!.pin as unknown as V9GenerationEventPayload["presenter_pin"],
      policy: {
        policy_version: "retry-policy/v1-default",
        max_attempts: 3,
        timeout_ms: 30_000,
        retry_delays_ms: [1_000, 3_000],
      },
    });
    const scope = reservation.request.scope;
    return {
      sequence_id: "",
      beat_id: scope.kind === "approved" ? scope.beat_id : scope.local_beat_id,
      plannedCount: 0,
      generation: { request_id: reservation.request.request_id, status: "pending" },
    };
  }

  /** 是否存在待驱动的生成请求（应用/路由层决定何时 drive；GET/restore 不调用）。 */
  /** Write-side restart repair; GET restore stays read-only. The committed release
   * and decision determine continuation, so no in-memory completion callback owns it. */
  recoverVisualContinuation():void {
    if(this.eventSchema !== "v10") return;
    this.refreshWrappers();
    if(!this.events.some(e=>e.event_type === "policy_decision_made")) {this.navigator.completeBootstrap();this.refreshWrappers();}
    const state=this.navigator.state as unknown as TutorRuntimeStateV10;
    if(state.visual_barrier || state.completed || state.presentation_cursor.status !== "idle" || state.generation_slot.status !== "idle") return;
    const release=[...this.events].reverse().find(e=>String(e.event_type)==="visual_barrier_changed"&&(e.payload as {barrier:unknown}).barrier===null);
    if(!release) {
      if(!this.events.some(e=>e.event_type === "presentation_sequence_planned" || String(e.event_type).startsWith("presentation_generation_"))) this.presentCurrentBeat();
      return;
    }
    const opened=[...this.events].reverse().find(e=>String(e.event_type)==="visual_barrier_changed"
      && (e.payload as {barrier?:VisualBarrier}).barrier?.barrier_id===(release.payload as {previous_barrier_id:string}).previous_barrier_id);
    const barrier=(opened?.payload as {barrier?:VisualBarrier}|undefined)?.barrier;
    if(!barrier || !["scope-transition","recovery","claim"].includes(barrier.cause)) return;
    // A takeover replaces delivery authority, but preserves an interrupted
    // teaching turn's wait for student input across subsequent claims.
    if(barrier.cause === "claim") {
      let inherited:VisualBarrier|undefined=barrier;
      let firstClaimOpening=opened;
      const seen=new Set<string>();
      while(inherited?.cause === "claim" && !seen.has(inherited.barrier_id)) {
        seen.add(inherited.barrier_id);
        const opening=this.events.find(e=>String(e.event_type)==="visual_barrier_changed"
          && (e.payload as {barrier?:VisualBarrier}).barrier?.barrier_id===inherited!.barrier_id);
        firstClaimOpening=opening;
        const previousId=(opening?.payload as {previous_barrier_id?:string}|undefined)?.previous_barrier_id;
        inherited=previousId ? ([...this.events].reverse().find(e=>String(e.event_type)==="visual_barrier_changed"
          && (e.payload as {barrier?:VisualBarrier}).barrier?.barrier_id===previousId)?.payload as {barrier?:VisualBarrier}|undefined)?.barrier : undefined;
      }
      if(inherited?.cause === "barge-in") return;
      if(!inherited && firstClaimOpening) {
        // A claim changes browser ownership, not the student's evidence obligation.
        // Use the pre-claim committed action receipts: cursor idle alone also covers
        // failed/cancelled generation and cannot prove that teaching was presented.
        const claim=[...this.events].reverse().find(e=>String(e.event_type) === "presentation_execution_claimed"
          && e.sequence<firstClaimOpening!.sequence && e.state_revision===firstClaimOpening!.state_revision);
        if(claim) {
          const prior=this.events.filter(e=>e.sequence<claim.sequence);
          const taught=[...prior].reverse().find(e=>e.event_type === "presentation_sequence_planned"
            && (e.payload as {purpose?:string}).purpose === "teaching");
          const plan=taught?.payload as unknown as CompiledPresentationPlanV4|undefined;
          const decision=[...prior].reverse().find(e=>e.event_type === "policy_decision_made");
          if(taught && plan && (decision?.payload as {decision_id?:string}|undefined)?.decision_id === plan.decision_id
            && !prior.some(e=>e.sequence>taught.sequence && String(e.event_type)==="presentation_generation_requested")
            && plan.actions.every(action=>prior.some(e=>e.event_type === "presentation_action_outcome_recorded"
              && (e.payload as {sequence_id:string}).sequence_id===plan.sequence_id
              && (e.payload as {ordinal:number}).ordinal===action.ordinal
              && (e.payload as {action_id:string}).action_id===actionIdOf(action)
              && (e.payload as {kind:string}).kind===action.kind
              && (e.payload as {outcome:string}).outcome==="presented"))) return;
        }
      }
    }
    if(this.events.some(e=>e.sequence>release.sequence && (String(e.event_type)==="presentation_generation_requested"||e.event_type==="presentation_sequence_planned"||e.event_type==="student_input_recorded"))) return;
    const latest=[...this.events].reverse().find(e=>e.event_type==="policy_decision_made");
    if(!latest) return;
    const turn={revision:this.revision,inputSequence:latest.sequence,decisionSequence:latest.sequence,decision:latest.payload as unknown as NavigatorDecision};
    const reports=this.presentAfterDecision(turn);
    if(!reports.length && !this.hasPendingGeneration()) this.presentCurrentBeat();
  }
  hasPendingGeneration(): boolean {
    if(this.visualLifecycle?.visual_barrier) return false;
    return this.navigator.state.generation_slot?.status === "pending";
  }

  /**
   * 驱动 pending 生成直至终态（committed ⇒ 原子提交序列并按既有链交付队首）。
   * 模型调用在 kernel 事务外；迟到/取消由 coordinator CAS 裁决零提交。
   */
  async drivePendingGeneration(): Promise<DriveOutcome & { report?: V7PresentationReport }> {
    if (this.presenterGenerator === undefined) {
      throw new OrchestratorV7Error(
        "NO_EXECUTABLE_DECISION",
        `session ${this.sessionId} carries a pending generation but the restoring process provided no presenter port (fail closed; provide the presenter model to drive)`,
      );
    }
    const outcome = await driveGeneration(this.generationKernelAccess(), {
      buildAndRun: async (request) => {
        try { return { candidate: await this.buildAndRunGeneration(request as never) }; }
        catch (error) {
          if (error instanceof IntentCompilerError) throw new PresenterGenerationError("draft_invalid", error.message, false);
          if (error instanceof SequencePreflightError) throw new PresenterGenerationError("preflight_failed", error.message, false);
          if (error instanceof PresentationContextError) throw new PresenterGenerationError("context_irreproducible", error.message, false);
          throw error;
        }
      },
    }, {
      causationSequence: this.generationCausationSequence(),
      refresh: () => {
        this.refreshWrappers();
        return this.generationKernelAccess();
      },
    });
    if (outcome.kind !== "committed") return outcome;
    let plannedEvent: StoredV7Event | undefined;
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index];
      if (event.event_type === "presentation_sequence_planned"
        && (event.payload as { sequence_id?: string }).sequence_id === outcome.sequence.sequence_id) {
        plannedEvent = event;
        break;
      }
    }
    if (!plannedEvent) {
      throw new OrchestratorV7Error("PRESENTATION_CURSOR_MISMATCH", `committed generation sequence ${outcome.sequence.sequence_id} has no committed planned fact (corrupt stream)`);
    }
    // A competing owner may already have delivered or finished this sequence.
    // Re-read committed progress; never reapply ordinal zero after takeover.
    const sequence = this.plannedSequenceOf(outcome.sequence.sequence_id)!;
    if (this.navigator.state.presentation_cursor.status !== "idle"
      || isSequenceSuperseded(this.events, sequence.sequence_id)) return outcome;
    const ordinal = nextUnpresentedOrdinal(this.events, sequence.sequence_id, sequence.actions.length);
    if (ordinal === undefined) return outcome;
    const report = this.deliverOrdinal(sequence, plannedEvent.sequence, ordinal)!;
    return { ...outcome, report };
  }

  /** 生成事件因果锚：pending request 的 requested 事件 sequence。 */
  private generationCausationSequence(): number {
    const slot = this.navigator.state.generation_slot;
    const requestId = slot?.status === "pending" ? slot.request_id : undefined;
    if (requestId === undefined) return this.events.length;
    const event = this.events.find(
      (candidate) => (candidate.event_type as string) === "presentation_generation_requested"
        && (candidate.payload as { request_id?: string }).request_id === requestId,
    );
    return event?.sequence ?? this.events.length;
  }

  /**
   * 单次内容管线（RT2 冻结上下文复算 + RT3 提示词/模型/编译/预演）。
   * 上下文不可复现 ⇒ context_irreproducible（不自动重试——非模型故障）。
   */
  private async buildAndRunGeneration(request: V9GenerationEventPayload): Promise<CompiledPresentationCandidate> {
    if (!this.presenterGenerator) throw new PresenterGenerationError("internal_error", "presenter port missing", false);
    const graph = this.binding.imported.graph;
    const factById = new Map(graph.facts.map((fact) => [fact.fact_id, fact]));
    const inferenceById = new Map(graph.inferences.map((inference) => [inference.inference_id, inference]));
    const missing = [
      ...request.context.selected_fact_ids.filter((factId) => !factById.has(factId)),
      ...request.context.selected_inference_ids.filter((inferenceId) => !inferenceById.has(inferenceId)),
    ];
    if (missing.length > 0) {
      throw new PresenterGenerationError(
        "context_irreproducible",
        `frozen context refs ${missing.join(",")} do not resolve against the pinned graph (irreproducible context; not retried)`,
        false,
      );
    }
    const basis = [
      ...request.context.selected_fact_ids.map((factId) => ({ ref: factId, kind: "fact" as const, rank: "core" as const, text: factById.get(factId)!.statement })),
      ...request.context.selected_inference_ids.map((inferenceId) => {
        const inference = inferenceById.get(inferenceId)!;
        return { ref: inferenceId, kind: "inference" as const, rank: "core" as const, text: `${inference.derivation}（前提：${inference.premises.join("、")} → 结论：${inference.conclusion}）` };
      }),
      ...request.context.resource_ids.flatMap((resourceId) => {
        const content = this.binding.imported.plan.resources.find((resource) => resource.resource_id === resourceId)?.content;
        return content ? [{ ref: resourceId, kind: "resource" as const, rank: "core" as const, text: content }] : [];
      }),
    ];
    // 冻结引用的复算视图：basis 由 context ref 复原（RT2 已在预约前完成组级预算/
    // 截断——被省略的组不在冻结 ref 内）；truncated 字段为构建期审计面，此处不
    // 重建（快照投影从权威状态读）。
    let context = {
      context: request.context,
      digest: request.input_digest,
      basis,
      truncated_inference_ids: [],
      truncated_group_refs: [],
      context_truncated: false,
      budget: { facts: request.context.selected_fact_ids.length, inferences: request.context.selected_inference_ids.length, approx_chars: basis.reduce((total, item) => total + item.text.length, 0) },
    } as unknown as BuiltPresentationContext;
    const registry=this.eventSchema==="v10"?this.visualContext():null;
    const frozen=registry?frozenVisualGeneration({base:context,events:this.events,hooks:registry.visual as ReturnType<typeof createPinnedVisualWorkspaceBridge>,sessionId:this.sessionId,capabilities:new Set(registry.capabilities.keys())}):null;
    if(frozen) {
      context=frozen.context;
      if(JSON.stringify(frozen.visual.owner.scope)!==JSON.stringify(request.scope))throw new PresenterGenerationError("context_irreproducible","frozen visual scope differs from reservation",false);
      const expected=`sha256:${createHash("sha256").update(JSON.stringify({context:context.digest,input:null})).digest("hex")}`;
      if(expected!==request.input_digest)throw new PresenterGenerationError("context_irreproducible","frozen visual context digest mismatch",false);
    }
    // F7 P2-B（B1）：从生成预约的**冻结 cutoff** 重建学生卡点与已呈现内容
    //（presentation-navigation 规格 :11——ContextBuilder 读取相关学生输入；同一
    // 请求重试消费同一冻结视图，不随后续事件漂移）。
    const cutoff = request.context.event_cutoff;
    let stuckPoint: { readonly text: string; readonly locatedRefs: readonly string[] } | null = null;
    const alreadyPresented: string[] = [];
    const alreadyPresentedBoardContent: string[] = [];
    const generatedBoardContents = new Map<string, PresentedBoardNote>();
    const presentedBoard: PresentedBoardNote[] = [];
    const plannedActionsBySequence = new Map<string, V7PresentationOrderedAction[]>();
    for (const event of this.events) {
      if (event.state_revision > cutoff) break; // committed 流按序；cutoff 后的事件不属于本冻结视图
      if (event.event_type === "student_input_recorded") {
        // stuckPoint=最新相关学生输入原文（utterance 文本；control 无文本不入）。
        // located_refs 不经模型定位——不编造定位结论（卡点定位是独立假设面）。
        const payload = event.payload as { input?: { kind?: string; text?: string } };
        if (payload.input?.kind === "utterance" && typeof payload.input.text === "string" && payload.input.text.trim() !== "") {
          stuckPoint = { text: payload.input.text, locatedRefs: [] };
        }
      } else if (event.event_type === "presentation_sequence_planned") {
        const payload = event.payload as unknown as { sequence_id: string; actions: V7PresentationOrderedAction[] };
        plannedActionsBySequence.set(payload.sequence_id, payload.actions);
        const fragments = (event.payload as { explanation_fragments?: { fragment_id: string; content: string; kind: string }[] }).explanation_fragments ?? [];
        for (const fragment of fragments) generatedBoardContents.set(fragment.fragment_id, { kind: fragment.kind, content: fragment.content });
      } else if (event.event_type === "presentation_action_outcome_recorded" && (event.payload as {outcome:string}).outcome === "presented") {
        // alreadyPresented=已呈现内容（浏览器确认 presented 的 voice 正文——committed presentation
        // 序列派生；不重复已讲过的整句是 prompt 硬性规则 7 的输入面）。
        const payload = event.payload as { sequence_id: string; ordinal: number; action_id?: string; kind?: string };
        const actions = plannedActionsBySequence.get(payload.sequence_id);
        const action = actions?.find((candidate) => candidate.ordinal === payload.ordinal);
        if ((request.presenter_pin.prompt_version === PRESENTER_PROMPT_VERSION || isVisualPresenterPromptVersion(request.presenter_pin.prompt_version))
          && (!action || payload.kind !== action.kind
            || payload.action_id !== (action.kind === "voice" ? action.voice_action?.action_id : action.workspace_action?.action_id))) continue;
        const text = action?.kind === "voice" ? action.voice_action?.text : undefined;
        if (typeof text === "string" && text.trim() !== "") alreadyPresented.push(text);
        const workspaceAction = action?.kind === "workspace" ? action.workspace_action : undefined;
        if (workspaceAction?.capability === "board.explain" && typeof workspaceAction.command_payload === "string") {
          const content = generatedBoardContents.get(workspaceAction.command_payload);
          if (content) {
            presentedBoard.push(content);
            if (content.kind === "approved_math_note" || content.kind === "relation_note") alreadyPresentedBoardContent.push(content.content);
          }
        }
      }
    }
    const approvedConstructions = resolveBeatConstructions(this.binding.imported.plan.resources, this.navigator.currentBeat) ?? [];
    const availableTools = this.visibleGenerationTools(request.context);
    const visibleTools = frozen ? remainingVisualConstructionTools(availableTools, frozen.source) : availableTools;
    const requireBoardProof = (request.presenter_pin.prompt_version === PRESENTER_PROMPT_VERSION || isVisualPresenterPromptVersion(request.presenter_pin.prompt_version));
    const boardRequirements = requireBoardProof ? requiredBoardBindings({
      visibleTools, graph: { facts: factById, inferences: inferenceById }, alreadyPresentedBoardContent,
    }) : [];
    const prompt = buildPresenterPrompt({
      context,
      // Roles come only from the pinned graph and the reservation's selected
      // facts. Older prompt pins retain their exact payload shape.
      ...(usesVisualV7PresentationPolicy(request.presenter_pin.prompt_version) ? {
        factRoles: request.context.selected_fact_ids.map(fact_id => ({ fact_id, role: factById.get(fact_id)!.role })),
      } : {}),
      ...(frozen?{visual:frozen.context.visual,visualTools:frozen.visual.visibleTools}:{}),
      instructionalGoal: this.navigator.currentBeat.purpose,
      completionTarget: this.navigator.currentBeat.completion_evidence.confirmation_target,
      promptVersion: request.presenter_pin.prompt_version,
      currentGranularity: "beat",
      alreadyPresented,
      ...(requireBoardProof ? { presentedBoard, requiredBoardBindings: boardRequirements } : {}),
      stuckPoint,
      visibleTools,
      // Five dependent geometry commands need room for speech and a proof note;
      // stay within the existing compiler/canonical 12-action bound.
      maxItems: frozen ? VISUAL_MAX_ACTIONS - 1 : Math.min(12, Math.max(6, approvedConstructions.length + 6)),
      maxSpeechChars: 400,
    });
    const { draft } = await this.presenterGenerator.generatePresentationDraft({
      request_id: request.request_id,
      systemPrompt: prompt.systemPrompt,
      promptVersion: prompt.promptVersion,
      userPayload: prompt.userPayload,
      timeoutMs: request.timeout_ms,
    });
    const {plan: compiled, visualCoverageIssues} = compilePresentationIntentsForPreflight({
      sessionId: this.sessionId,
      sequenceSerial: this.countPlanned() + 1,
      decisionId: request.decision_id,
      scope: request.scope as never,
      request: {
        request_id: request.request_id,
        attempt: request.attempt,
        epoch: request.epoch,
        input_digest: request.input_digest,
        presenter_pin: request.presenter_pin,
      },
      draft,
      ...(frozen?{visual:frozen.visual}:{}),
      context,
      visibleTools,
      resources: new Map(this.binding.imported.plan.resources.map((resource) => [resource.resource_id, resource])),
      graph: { facts: factById, inferences: inferenceById },
      alreadyPresentedBoardContent,
      approvedConstructions,
      revealAuthorized: (binding) => {
        if (binding.binding_kind !== "board" || !binding.reveal_after_gate) return false;
        const { protocol_id, gate_id } = binding.reveal_after_gate;
        if (protocol_id !== this.navigator.currentBeat.protocol_id) return false;
        const gateBeat = this.binding.imported.protocols.get(protocol_id)?.beats
          .find((entry) => entry.completion_evidence.gate?.gate_id === gate_id);
        if (!gateBeat) return false;
        const evaluation = this.rebuildWorkspace().context.gateLedger.evaluations.get(`${gate_id}@${gateBeat.beat_id}`);
        return evaluation?.satisfied === true;
      },
    });
    preflightPresentationSequence({ fold: frozen?.source.workspace ?? this.rebuildWorkspace(), catalog: this.catalog, plan: compiled, ...(frozen?{visual:frozen.visual}:{}) });
    // Deterministic authority and execution failures must win over repairable
    // board omissions. Both checks remain pre-commit and have no live effects.
    if (visualCoverageIssues.length) throw new VisualObligationQualityError(visualCoverageIssues);
    if (requireBoardProof) assertRequiredBoardBindings(draft, boardRequirements);
    return compiled;
  }

  // ------------------------------------------------------------------ //
  // 内部：基础设施
  // ------------------------------------------------------------------ //

  /** 原始控制输入事实（retry_recovery 分支不经 navigator 解释链，仍入流审计）。 */
  private appendStudentInputFact(input: V7StudentInputTurn): number {
    const appended = this.appendViaKernel(this.navigator.revision, [
      {
        event_type: "student_input_recorded",
        payload: { input: input.input as V7StudentInputBody, client_request_id: input.client_request_id },
        occurred_at: nowIso(),
        idempotency_key: (() => { const key = composeIdempotencyKey(["si", this.sessionId, input.client_request_id]); assertIdempotencyKeyShape(key); return key; })(),
      },
    ]);
    return appended.appendedSequences[0];
  }

  private appendViaKernel(
    expectedRevision: number,
    events: PendingV7Event[],
  ): { revision: number; appendedSequences: number[] } {
    const batch=this.eventSchema === "v10" ? events.map(e=>e.event_type === "presentation_sequence_planned"
      ? {...e,payload:{...(e.payload as Record<string,unknown>),purpose:(e.payload as {purpose?:string}).purpose ?? "teaching"}} : e) : events;
    const result = this.navigator.kernel.append(expectedRevision, batch);
    return { revision: result.revision, appendedSequences: result.appendedSequences };
  }

  /** F3 纯 validator（ExecutePresentation）：canonical+capability+target/mode/truth+几何 dry-run。 */
  private validateWorkspaceAction(
    sequence: DeliverableSequence,
    fold: WorkspaceFold,
    ordinal: number,
  ): Pick<Extract<WorkspacePresentationExecution,{status:"completed"}>,"status"|"changed"|"resultingRevision"> | {status:"rejected";reason:string} {
    const action = sequence.actions[ordinal];
    if (!action || action.kind !== "workspace" || !action.workspace_action) {
      return { status: "rejected", reason: "internal: expected a workspace action" };
    }
    if(this.eventSchema === "v10" && action.workspace_action.capability.startsWith("geometry.visual.")) {
      const hooks=this.visualContext().visual as ReturnType<typeof createPinnedVisualWorkspaceBridge>;
      return hooks.prepareTeachingAction(this.events as unknown as StoredSessionEvent[],{sequence_id:sequence.sequence_id,ordinal,action_id:action.workspace_action.action_id});
    }
    return executeWorkspacePresentationV5({
      fold,
      catalog: this.catalog,
      action: {
        schema: "ai_teaching_workspace_surface_action/v1" as const,
        session_id: this.sessionId,
        ...action.workspace_action,
      },
    });
  }

  private plannedSequenceOf(sequenceId: string): { sequence_id: string; beat_id: string; actions: V7PresentationOrderedAction[] } | undefined {
    const event = findPlannedSequenceEvent(this.events, sequenceId);
    if (!event) return undefined;
    const payload = event.payload as unknown as { sequence_id: string; beat_id?: string;
      scope?: { beat_id?: string; anchor?: { beat_id: string } }; actions: V7PresentationOrderedAction[] };
    const beat_id = payload.beat_id ?? payload.scope?.beat_id ?? payload.scope?.anchor?.beat_id;
    if (!beat_id) throw new OrchestratorV7Error("PRESENTATION_CURSOR_MISMATCH", `sequence ${sequenceId} has no committed teaching anchor`);
    return { sequence_id: payload.sequence_id, beat_id, actions: payload.actions };
  }

  private visualWorkspaceDomainFold(workspace:ReturnType<typeof rebuildWorkspaceRuntimeStateV10>):WorkspaceFold {
    const {visual_state,...geometry}=workspace.state.geometry;
    return {state:{...workspace.state,schema:"ai_teaching_workspace_runtime_state/v2",geometry},context:workspace.context};
  }

  private rebuildWorkspace(): WorkspaceFold {
    if(this.eventSchema === "v10") {
      const workspace=rebuildWorkspaceRuntimeStateV10(this.sessionId,this.catalog,visualRegistryProvider(this.resolver));
      return this.visualWorkspaceDomainFold(workspace);
    }
    // F7 RT4：v9 行经 v9 codec 重建（生成事件族对 workspace 零效果）。
    const rebuilt = this.navigator.eventSchema !== "v7"
      ? rebuildWorkspaceRuntimeStateV9(this.sessionId, this.catalog, this.resolver.v7RegistryProvider)
      : rebuildWorkspaceRuntimeStateV7(this.sessionId, this.catalog, this.resolver.v7RegistryProvider);
    return { state: rebuilt.state, context: rebuilt.context };
  }

  private countPlanned(): number {
    return this.events.filter((event) => event.event_type === "presentation_sequence_planned").length;
  }

  /**
   * 需重呈现的目标集（F7 Step 3 rework）：committed 流中「服务端 applied 但
   * 浏览器未 presented」的 workspace 动作目标——恢复序列以 presentation_only
   * 重新入列（零服务端效果）。
   */
  private representTargets(): Set<string> {
    const events = this.events;
    const targets = new Set<string>();
    for (const event of events) {
      if (event.event_type !== "presentation_sequence_planned") continue;
      const payload = event.payload as unknown as { sequence_id: string; actions: V7PresentationOrderedAction[] };
      for (const action of payload.actions) {
        if (action.kind !== "workspace" || !action.workspace_action) continue;
        const ref = { sequence_id: payload.sequence_id, ordinal: action.ordinal, action_id: action.workspace_action.action_id };
        const applied = events.some((candidate) =>
          candidate.event_type === "presentation_action_applied"
          && (candidate.payload as typeof ref).sequence_id === ref.sequence_id
          && (candidate.payload as typeof ref).ordinal === ref.ordinal
          && (candidate.payload as typeof ref).action_id === ref.action_id);
        if (!applied) continue;
        const presented = events.some((candidate) =>
          candidate.event_type === "presentation_action_outcome_recorded"
          && (candidate.payload as typeof ref & { outcome: string }).sequence_id === ref.sequence_id
          && (candidate.payload as typeof ref & { outcome: string }).ordinal === ref.ordinal
          && (candidate.payload as typeof ref & { outcome: string }).action_id === ref.action_id
          && (candidate.payload as typeof ref & { outcome: string }).outcome === "presented");
        if (presented) continue;
        for (const id of workspaceActionTargetIds(action.workspace_action)) targets.add(id);
      }
    }
    return targets;
  }

  private checkExpectedRevision(expectedRevision: number | undefined): { revision: number; turn: V7TurnResult } | undefined {
    if (expectedRevision === undefined) return undefined;
    const current = this.navigator.revision;
    if (current === expectedRevision) return undefined;
    // F7 RT4（v9）：权威 revision 已前进而生成仍在 pending——旧结果不得提交到
    // 新状态（cancel_reason=revision_changed；正常控制语义，非系统故障）。
    if (this.hasPendingGeneration()) {
      cancelGeneration(this.generationKernelAccess(), "revision_changed", this.generationCausationSequence());
      this.refreshWrappers();
    }
    // stale revision：revision_conflict failure 事实（canonical runtime_failure 封闭
    // 枚举）——零教学决策、零 presentation 推进。
    this.appendViaKernel(this.navigator.revision, [
      {
        event_type: "runtime_failure",
        payload: {
          failure_class: "revision_conflict",
          message: `orchestrator turn rejected: expected revision ${expectedRevision} but session is at ${current}`,
        },
        occurred_at: nowIso(),
      },
    ]);
    this.refreshWrappers();
    return {
      revision: this.navigator.revision,
      turn: {
        revision: this.navigator.revision,
        inputSequence: this.events[this.events.length - 1]?.sequence ?? 1,
        failure: { failure_class: "revision_conflict", message: `expected revision ${expectedRevision} but session is at ${current}` },
      },
    };
  }

  private refreshWrappers(): void {
    this.navigator = NavigatorSessionV7.resume({
      sessionId: this.sessionId,
      plan: this.binding.plan,
      imported: this.binding.imported,
      registryProvider: this.eventSchema === "v10" ? visualRegistryProvider(this.resolver) : this.resolver.v7RegistryProvider,
      gateProvider: this.model.provider,
      ...(this.modelTimeoutMs !== undefined ? { modelTimeoutMs: this.modelTimeoutMs } : {}),
    });
    this.configureVisualNavigation();
  }
}

// ------------------------------------------------------------------ //
// committed 流只读扫描（呈现/命令编排的解析面；不信任调用方载荷的任何 id）
// ------------------------------------------------------------------ //

function resolveBindingOrThrow(resolver: TutorTaskBindingResolver, taskId: string, started?: Record<string, unknown>): TutorTaskBinding {
  try {
    return started ? resolver.resolveForRestore(taskId, started) : resolver.resolveForStart(taskId);
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      throw new OrchestratorV7Error(
        error.code === "UNKNOWN_TASK" ? "UNKNOWN_TASK" : "PLAN_IMPORT_FAILED",
        (error as Error).message,
      );
    }
    throw error;
  }
}

function latestExecuteBeatDecision(events: readonly StoredV7Event[]): { decision: NavigatorDecision; sequence: number } | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.event_type !== "policy_decision_made") continue;
    const payload = event.payload as unknown as NavigatorDecision;
    if (payload.decision_kind === "execute_beat") {
      return { decision: payload, sequence: event.sequence };
    }
  }
  return undefined;
}

function findPlannedSequenceEvent(events: readonly StoredV7Event[], sequenceId: string): StoredV7Event | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.event_type === "presentation_sequence_planned" && (event.payload as { sequence_id: string }).sequence_id === sequenceId) {
      return event;
    }
  }
  return undefined;
}

function findDeliveredSequence(events: readonly StoredV7Event[], ref: { sequence_id: string; ordinal: number; action_id: string }): number | undefined {
  for (const event of events) {
    if (event.event_type !== "presentation_action_delivered") continue;
    const payload = event.payload as typeof ref;
    if (payload.sequence_id === ref.sequence_id && payload.ordinal === ref.ordinal && payload.action_id === ref.action_id) {
      return event.sequence;
    }
  }
  return undefined;
}

function findOutcomeSequence(events: readonly StoredV7Event[], ref: { sequence_id: string; ordinal: number; action_id: string }): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.event_type !== "presentation_action_outcome_recorded") continue;
    const payload = event.payload as typeof ref;
    if (payload.sequence_id === ref.sequence_id && payload.ordinal === ref.ordinal && payload.action_id === ref.action_id) {
      return event.sequence;
    }
  }
  return undefined;
}

function findCommittedOutcome(
  events: readonly StoredV7Event[],
  ref: { sequence_id: string; ordinal: number; action_id: string },
): { outcome: string; failure_class?: string } | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.event_type !== "presentation_action_outcome_recorded") continue;
    const payload = event.payload as typeof ref & { outcome: string; failure_class?: string };
    if (payload.sequence_id === ref.sequence_id && payload.ordinal === ref.ordinal && payload.action_id === ref.action_id) {
      return { outcome: payload.outcome, ...(payload.failure_class !== undefined ? { failure_class: payload.failure_class } : {}) };
    }
  }
  return undefined;
}

function isSequenceSuperseded(events: readonly StoredV7Event[], sequenceId: string): boolean {
  return events.some(
    (event) => event.event_type === "presentation_sequence_superseded"
      && (event.payload as { sequence_id: string }).sequence_id === sequenceId,
  );
}

/** 下一个未 presented 的 ordinal（全 presented → undefined）。 */
function nextUnpresentedOrdinal(events: readonly StoredV7Event[], sequenceId: string, count: number): number | undefined {
  const presented = new Set<number>();
  for (const event of events) {
    if (event.event_type !== "presentation_action_outcome_recorded") continue;
    const payload = event.payload as { sequence_id: string; ordinal: number; outcome: string };
    if (payload.sequence_id === sequenceId && payload.outcome === "presented") presented.add(payload.ordinal);
  }
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    if (!presented.has(ordinal)) return ordinal;
  }
  return undefined;
}

/** workspace presentation action 的重呈现目标（构造 output / Board entry id）。 */
function workspaceActionTargetIds(action: NonNullable<V7PresentationOrderedAction["workspace_action"]>): string[] {
  if (action.surface === "solution_board") return [...(action.target_ids ?? [])];
  if (action.command_payload !== undefined) {
    try {
      const command = JSON.parse(action.command_payload) as Parameters<typeof constructionOutputId>[0];
      const output = constructionOutputId(command);
      return output !== undefined ? [output] : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ------------------------------------------------------------------ //
// ActionEvaluationResponse 构造（V5 同口径；evaluation 权威出自 typed evaluator）
// ------------------------------------------------------------------ //

function rejectedEvaluation(template: AuthoredActionTemplate, diagnosis: TypedActionDiagnosis): ActionEvaluationResponse {
  void template;
  return {
    outcome: "rejected",
    evaluation: "wrong",
    revision: 0, // 调用方以投影 revision 覆盖（零事件路径 revision 不变）
    diagnosis: {
      messageLatex: "标注未全部正确，请检查高亮的线段与数值后重试。",
      wrongObjectIds: [...diagnosis.wrongObjectIds],
      wrongActionIds: [...diagnosis.wrongActionIds],
      wrongSlotIds: [...diagnosis.wrongSlotIds],
    },
    phase: "wrong_feedback",
    nextIndex: 0,
  };
}

function acceptedEvaluation(result: { revision: number; turn: V7TurnResult }): ActionEvaluationResponse {
  const advanced = result.turn.decision?.decision_kind === "transition_beat";
  return {
    outcome: "accepted",
    evaluation: "correct",
    revision: result.revision,
    phase: advanced ? "correct_pause" : "answering",
    nextIndex: 0,
  };
}
