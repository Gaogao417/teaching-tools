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
import type { PendingV7Event, StoredV7Event, V7PresentationOrderedAction, V7StudentInputBody, V7StudentWorkspaceCommandRecordedPayload } from "../tutorSession/TutorSessionEventV7";
import { createV7Rebuilder } from "../tutorSession/RuntimeStateRebuilderV7";
import { rebuildWorkspaceRuntimeStateV7 } from "../tutorSession/WorkspaceRuntimeReducerV7";
import { executeStudentWorkspaceCommandV5, executeWorkspacePresentationV5, type WorkspacePresentationExecution, type StudentWorkspaceCommandV5 } from "../tutorSession/WorkspaceActionRuntimeV5";
import { workspaceCatalogPin, type WorkspacePresentationCatalogV5 } from "../tutorSession/WorkspacePresentationCatalogV5";
import type { WorkspaceFold } from "../tutorSession/WorkspaceRuntimeReducerV5";
import type { GateAdjudicationProvider } from "../tutorNavigator/ModelGateAdjudicatorV5";
import type { WorkspaceGateAssessmentInput } from "../tutorNavigator/GateEvidenceEvaluatorV5";
import type { NavigatorDecision } from "../tutorNavigator/TutorNavigatorV5";
import type { V5ModelGatePin } from "./StructuredModelGateProvider";
import { TutorTaskBindingResolver, assessmentCatalogVariant, type TutorTaskBinding } from "./TutorTaskBindingResolver";
import { NavigatorSessionV7, type V7TurnResult } from "../tutorNavigator/NavigatorSessionV7";
import { realizePresentationPlanV6, type PresentationPlanV6 } from "./TutorPresenterV6";
import { projectPendingPresentation, projectV6Views, type V6PendingPresentation, type V6SessionSnapshot } from "./V6SessionSnapshot";
import { projectActiveAction, type ActiveAction, type ProjectedActionContract } from "./ActiveActionProjector";
import { buildExternalSupportEvidence } from "../tutorNavigator/ExternalSupportEvidenceV5";
import { constructionOutputId, adjudicateCommandPayload, adjudicateActionEvidence, evidenceToWorkspaceCommand, resolveBeatActionTemplate } from "./WorkspaceActionAdjudication";
import type { ActionEvaluationResponse, AuthoredActionTemplate } from "../../../../shared/actionRuntime";
import type { TypedActionDiagnosis } from "../actionRuntime/topicTypedEvaluator";

export const ORCHESTRATOR_V7_VERSION = "tutor-session-orchestrator/v7";

/** 服务层快照（V6SessionSnapshot 结构复用——投影对 v6/v7 事件流版本无关）。 */
export type V7SessionSnapshot = V6SessionSnapshot;
export type V7PendingPresentation = V6PendingPresentation;

export interface OrchestratorV7ModelInput {
  readonly provider: GateAdjudicationProvider;
  readonly pin: V5ModelGatePin;
}

export interface OrchestratorV7StartInput {
  readonly sessionId: string;
  readonly studentId: string;
  readonly taskId: string;
  readonly canonicalRoot: string;
  readonly model: OrchestratorV7ModelInput;
  readonly modelTimeoutMs?: number;
  /** v7：会话模式显式（teaching|assessment；assessment ⇒ locked catalog 变体 pin）。 */
  readonly assessment?: boolean;
}

export interface OrchestratorV7ResumeInput {
  readonly sessionId: string;
  readonly canonicalRoot: string;
  readonly model: OrchestratorV7ModelInput;
  readonly modelTimeoutMs?: number;
}

export interface V7InputTurnOptions {
  readonly expectedRevision?: number;
}

export interface V7StudentInputTurn {
  readonly input: V7StudentInputBody;
  readonly client_request_id: string;
}

export interface V7PresentationReport {
  readonly sequence_id: string;
  readonly beat_id: string;
  readonly plannedCount: number;
  readonly pending?: V7PendingPresentation;
}

export interface V7InputTurnResult {
  readonly revision: number;
  readonly turn: V7TurnResult;
  readonly presentations: readonly V7PresentationReport[];
  readonly snapshot: V7SessionSnapshot;
}

export interface V7PresentationOutcomeRequest {
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
  | "PLAN_IMPORT_FAILED"
  | "UNKNOWN_TASK"
  | "NO_EXECUTABLE_DECISION"
  | "PRESENTATION_CURSOR_MISMATCH"
  | "PRESENTATION_FAILED_PENDING_RECOVERY"
  | "WORKSPACE_APPLY_REJECTED"
  | "RETRY_RECOVERY_WITHOUT_FAILURE"
  | "ASSESSMENT_INTENT_FORBIDDEN"
  | "WORKSPACE_COMMAND_PAYLOAD_DRIFT"
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

  private constructor(fields: {
    sessionId: string;
    resolver: TutorTaskBindingResolver;
    binding: TutorTaskBinding;
    model: OrchestratorV7ModelInput;
    modelTimeoutMs: number | undefined;
    sessionMode: "teaching" | "assessment";
    catalog: WorkspacePresentationCatalogV5;
    navigator: NavigatorSessionV7;
  }) {
    this.sessionId = fields.sessionId;
    this.resolver = fields.resolver;
    this.binding = fields.binding;
    this.model = fields.model;
    this.modelTimeoutMs = fields.modelTimeoutMs;
    this.sessionMode = fields.sessionMode;
    this.catalog = fields.catalog;
    this.navigator = fields.navigator;
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
    const resolver = new TutorTaskBindingResolver(input.canonicalRoot);
    const binding = resolveBindingOrThrow(resolver, input.taskId);
    const sessionMode: "teaching" | "assessment" = input.assessment === true ? "assessment" : "teaching";
    const catalog = sessionMode === "assessment" ? assessmentCatalogVariant(binding) : binding.golden.catalog;
    const navigator = NavigatorSessionV7.start({
      sessionId: input.sessionId,
      studentId: input.studentId,
      plan: binding.plan,
      imported: binding.imported,
      registryProvider: resolver.v7RegistryProvider,
      gateProvider: input.model.provider,
      modelTimeoutMs: input.modelTimeoutMs,
      taskId: binding.taskId,
      scenarioId: binding.scenarioId,
      sessionMode,
      sessionStartedPins: {
        workspace_catalog_pin: workspaceCatalogPin(catalog),
        model_gate_pin: input.model.pin,
      },
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
    const resolver = new TutorTaskBindingResolver(input.canonicalRoot);
    const verified = createV7Rebuilder(resolver.v7RegistryProvider).verifyCommittedStreamV7(input.sessionId);
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
    const binding = resolveBindingOrThrow(resolver, started.task_id);
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
      registryProvider: resolver.v7RegistryProvider,
      gateProvider: input.model.provider,
      ...(input.modelTimeoutMs !== undefined ? { modelTimeoutMs: input.modelTimeoutMs } : {}),
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
    });
    orchestrator.resumePresentation();
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
    const conflict = this.checkExpectedRevision(options.expectedRevision);
    if (conflict) {
      return { revision: conflict.revision, turn: conflict.turn, presentations: [], snapshot: this.snapshot() };
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
    if (this.navigator.kernel.state.presentation_cursor.status === "failed"
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
    const turn = await this.navigator.submitStudentInput({ input: input.input, client_request_id: input.client_request_id });
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
        idempotency_key: `sc:${this.sessionId}:${command.client_command_id}`,
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
    const conflict = this.checkExpectedRevision(request.expected_revision);
    if (conflict) {
      return { revision: conflict.revision, advanced: false, snapshot: this.snapshot() };
    }
    const cursor = this.navigator.kernel.state.presentation_cursor;
    const matches = (ref: { sequence_id: string; ordinal: number; action_id: string }): boolean =>
      cursor.status === "awaiting_browser"
      && cursor.sequence_id === ref.sequence_id
      && cursor.ordinal === ref.ordinal
      && cursor.action_id === ref.action_id;
    if (!matches(request)) {
      const committed = findCommittedOutcome(this.events, request);
      if (committed && committed.outcome === request.outcome) {
        return { revision: this.navigator.revision, advanced: false, snapshot: this.snapshot() };
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
        idempotency_key: `${this.sessionId}:poutcome:${request.sequence_id}:${request.ordinal}:${request.action_id}:${request.client_request_id}`,
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
    this.appendViaKernel(this.navigator.revision, batch);
    if (request.outcome === "presented" && request.ordinal + 1 < planned.actions.length) {
      const plannedEvent = findPlannedSequenceEvent(this.events, request.sequence_id)!;
      this.deliverOrdinal(planned, plannedEvent.sequence, request.ordinal + 1);
      this.refreshWrappers();
      return { revision: this.navigator.revision, advanced: true, snapshot: this.snapshot() };
    }
    this.refreshWrappers();
    return { revision: this.navigator.revision, advanced: false, snapshot: this.snapshot() };
  }

  // ------------------------------------------------------------------ //
  // 呈现编排（有序交付环；v6 同款 + assessment presenter 模式）
  // ------------------------------------------------------------------ //

  /** 呈现当前 Beat（对最近一个 execute_beat 决策）：Presenter realize → 计划 → 队首交付。 */
  presentCurrentBeat(): V7PresentationReport {
    const decisionEntry = latestExecuteBeatDecision(this.events);
    if (!decisionEntry) {
      throw new OrchestratorV7Error("NO_EXECUTABLE_DECISION", `no committed execute_beat decision to present in ${this.sessionId}`);
    }
    return this.realizeAndDeliver(decisionEntry.decision, decisionEntry.sequence, {});
  }

  /** 当前学生安全 active action（ActiveActionProjector 门面；Step 3/4 保留链）。 */
  activeAction(promptLatex: string): ActiveAction | undefined {
    const workspaceRebuild = this.rebuildWorkspace();
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
    const tutorState = this.navigator.kernel.rebuild();
    const workspace = this.rebuildWorkspace();
    const events = this.events;
    const views = projectV6Views({
      sessionId: this.sessionId,
      tutorState,
      workspaceState: workspace.state,
      events: events as never,
      plan: this.binding.plan,
      catalog: this.catalog,
      factEntryIds: this.binding.golden.factEntryIds,
      sessionRevision: this.navigator.revision,
    });
    const active = (() => {
      // active action 只在 workspace_input 相位挂载（spec §1.3 / PLAN Step 4）：
      // 末项 presented 进入 awaiting_evidence 且无 pending delivery。
      const presenterIdle = tutorState.teaching_cursor.phase === "awaiting_evidence"
        && tutorState.presentation_cursor.status === "idle";
      return presenterIdle ? this.activeAction(promptLatex) : undefined;
    })();
    const pending = projectPendingPresentation({
      sessionId: this.sessionId,
      events: events as never,
      cursor: tutorState.presentation_cursor,
      revision: this.navigator.revision,
    });
    return {
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
  }

  // ------------------------------------------------------------------ //
  // 内部：决策后呈现 / 交付 / 恢复（v6 同款）
  // ------------------------------------------------------------------ //

  /** 决策后呈现策略：transition→executeCurrentBeat；execute/return/clarification→
   * presentCurrentBeat；open_inquiry/open_scaffold→锚定 inquiry entry beat 呈现。 */
  private presentAfterDecision(turn: V7TurnResult): V7PresentationReport[] {
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
      cursor: this.navigator.kernel.state.presentation_cursor,
      revision: this.navigator.revision,
    });
    return { sequence_id: sequence.sequence_id, beat_id: sequence.beat_id, plannedCount: sequence.actions.length, pending };
  }

  /** resume 的崩溃窗口续投：planned 已提交、队首未 delivered → 续投恰好一次。 */
  private resumePresentation(): void {
    const state = this.navigator.kernel.state;
    if (state.presentation_cursor.status !== "idle" || state.completed) return;
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index];
      if (event.event_type !== "presentation_sequence_planned") continue;
      const payload = event.payload as unknown as { sequence_id: string; beat_id: string; actions: V7PresentationOrderedAction[] };
      if (isSequenceSuperseded(this.events, payload.sequence_id)) continue;
      const nextOrdinal = nextUnpresentedOrdinal(this.events, payload.sequence_id, payload.actions.length);
      if (nextOrdinal === undefined) return;
      this.deliverOrdinal(payload, event.sequence, nextOrdinal);
      return;
    }
  }

  /** barge-in 服务端侧：pending cursor → outcome interrupted + 同批 superseded。 */
  private closePendingAsInterrupted(): void {
    const cursor = this.navigator.kernel.state.presentation_cursor;
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

  /** retry_recovery：failed 停留的显式恢复——supersede 原序列 + 新恢复序列。 */
  private retryRecovery(): { supersededSequence: number; report: V7PresentationReport } {
    const cursor = this.navigator.kernel.state.presentation_cursor;
    if (cursor.status !== "failed") {
      throw new OrchestratorV7Error(
        "RETRY_RECOVERY_WITHOUT_FAILURE",
        `control.retry_recovery requires a failed presentation cursor (at ${cursor.status}); fail closed, zero events`,
      );
    }
    const failedOutcomeSequence = findOutcomeSequence(this.events, cursor) ?? 1;
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

  // ------------------------------------------------------------------ //
  // 内部：基础设施
  // ------------------------------------------------------------------ //

  /** 原始控制输入事实（retry_recovery 分支不经 navigator 解释链，仍入流审计）。 */
  private appendStudentInputFact(input: V7StudentInputTurn): number {
    const appended = this.appendViaKernel(this.navigator.revision, [
      {
        event_type: "student_input_recorded",
        payload: { input: input.input, client_request_id: input.client_request_id },
        occurred_at: nowIso(),
        idempotency_key: `si:${this.sessionId}:${input.client_request_id}`,
      },
    ]);
    return appended.appendedSequences[0];
  }

  private appendViaKernel(
    expectedRevision: number,
    events: PendingV7Event[],
  ): { revision: number; appendedSequences: number[] } {
    const result = this.navigator.kernel.append(expectedRevision, events);
    return { revision: result.revision, appendedSequences: result.appendedSequences };
  }

  /** F3 纯 validator（ExecutePresentation）：canonical+capability+target/mode/truth+几何 dry-run。 */
  private validateWorkspaceAction(
    sequence: DeliverableSequence,
    fold: WorkspaceFold,
    ordinal: number,
  ): WorkspacePresentationExecution {
    const action = sequence.actions[ordinal];
    if (!action || action.kind !== "workspace" || !action.workspace_action) {
      return { status: "rejected", reason: "internal: expected a workspace action" };
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
    return event.payload as unknown as { sequence_id: string; beat_id: string; actions: V7PresentationOrderedAction[] };
  }

  private rebuildWorkspace(): WorkspaceFold {
    const rebuilt = rebuildWorkspaceRuntimeStateV7(this.sessionId, this.catalog, this.resolver.v7RegistryProvider);
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
    // stale revision：revision_conflict failure 事实（canonical runtime_failure 封闭
    // 枚举）——零教学决策、零 presentation 推进。
    this.appendViaKernel(current, [
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
      registryProvider: this.resolver.v7RegistryProvider,
      gateProvider: this.model.provider,
      ...(this.modelTimeoutMs !== undefined ? { modelTimeoutMs: this.modelTimeoutMs } : {}),
    });
  }
}

// ------------------------------------------------------------------ //
// committed 流只读扫描（呈现/命令编排的解析面；不信任调用方载荷的任何 id）
// ------------------------------------------------------------------ //

function resolveBindingOrThrow(resolver: TutorTaskBindingResolver, taskId: string): TutorTaskBinding {
  try {
    return resolver.resolveForStart(taskId);
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
