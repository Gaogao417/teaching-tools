/**
 * TutorSessionOrchestratorV6（F7 Step 3 — 有序交付 Orchestrator；PLAN.md §3）。
 *
 * 权威效果顺序（v6，替换 V5 的「整份 plan 立即执行」）：
 *
 * ```text
 * validate session/revision
 *   → student_input_recorded（原始输入事实，独立批先落）           [NavigatorSessionV6]
 *   → 后端解释 intent → interpretation/intent(+gate)/decision 原子批 [NavigatorSessionV6]
 *   → TutorPresenterV6 realize 单一有序 actions[]（Geometry→Voice→Board）
 *   → presentation_sequence_planned（capability 门禁在 kernel reducer）
 *   → 只准备队首：workspace 先经 F3 validator/reducer 应用
 *     （validated → applied{resulting_workspace_revision}）           [本类 + F3]
 *   → presentation_action_delivered → cursor awaiting_browser
 *   → 等浏览器 outcome（presented 才推进下一项；failed 停留；
 *     interrupted 同批 superseded；retry_recovery → 新恢复 sequence）
 *   → 统一 V6SessionSnapshot + pending delivery                       [V6SessionSnapshot]
 * ```
 *
 * 编排纪律（与 V5 同源，v6 落点）：
 * - 只编排不做教学判断：决策全经 NavigatorSessionV6（decideNavigation 唯一
 *   确定性裁决者）；workspace 校验/效果全经 F3 纯 validator（五重校验原样）；
 *   投影只读 fresh rebuild；
 * - 唯一写入口：一切持久 transition 经 TutorSessionKernelV6（store 事务内先纯
 *   折叠后落库；V6 跨事件门禁在 append/rebuild 双边界强制）；
 * - refresh 语义：resume 零模型调用、零事件——pending delivery 从 committed
 *   事实原样重投（Step 2 zero-event oracle 上移到编排层）；唯一例外是
 *   mid-action 崩溃窗口（planned 已提交、队首未 delivered）→ resumePresentation
 *   续投队首（恰好一次）；
 * - 服务端应用 ≠ 浏览器完成：workspace 语义在 applied 落定（revision 推进），
 *   cursor 只被浏览器 outcome 推进（presented）——两事实永不相混。
 *
 * **Step 3 边界（ledger 增补 13 登记）**：
 * - 不含 V6 HTTP 路由 / 统一 SessionSnapshot 线格式（Step 4）；
 * - 不含 action-evidence / workspace-command 的 V6 化（student-input/v1 联合
 *   无法合法承载结构化命令输入事实——Step 4 先走 PRDS 合同流程；V5 编排链
 *   继续服务现有路由）；
 * - 不含 assessment 变体 catalog（v6 registryProvider 只对账 construction 形态
 *   pin；assessment v6 化随 Step 4 一并裁定）。
 */
import type { PendingV6Event, StoredV6Event, V6PresentationOrderedAction, V6StudentInputBody } from "../tutorSession/TutorSessionEventV6";
import { createV6Rebuilder } from "../tutorSession/RuntimeStateRebuilderV6";
import { rebuildWorkspaceRuntimeStateV6 } from "../tutorSession/WorkspaceRuntimeReducerV6";
import { executeWorkspacePresentationV5, type WorkspacePresentationExecution } from "../tutorSession/WorkspaceActionRuntimeV5";
import { workspaceCatalogPin } from "../tutorSession/WorkspacePresentationCatalogV5";
import type { WorkspaceFold } from "../tutorSession/WorkspaceRuntimeReducerV5";
import type { GateAdjudicationProvider } from "../tutorNavigator/ModelGateAdjudicatorV5";
import type { NavigatorDecision } from "../tutorNavigator/TutorNavigatorV5";
import type { V5ModelGatePin } from "./StructuredModelGateProvider";
import { TutorTaskBindingResolver, type TutorTaskBinding } from "./TutorTaskBindingResolver";
import { NavigatorSessionV6, type V6TurnResult } from "../tutorNavigator/NavigatorSessionV6";
import { realizePresentationPlanV6, type PresentationPlanV6 } from "./TutorPresenterV6";
import { projectPendingPresentation, projectV6Views, type V6PendingPresentation, type V6SessionSnapshot } from "./V6SessionSnapshot";
import { projectActiveAction, type ActiveAction, type ProjectedActionContract } from "./ActiveActionProjector";
import { buildExternalSupportEvidence } from "../tutorNavigator/ExternalSupportEvidenceV5";
import { constructionOutputId } from "./WorkspaceActionAdjudication";

export const ORCHESTRATOR_V6_VERSION = "tutor-session-orchestrator/v6";

export interface OrchestratorV6ModelInput {
  readonly provider: GateAdjudicationProvider;
  readonly pin: V5ModelGatePin;
}

export interface OrchestratorV6StartInput {
  readonly sessionId: string;
  readonly studentId: string;
  /** F7 Step 2：start 显式传 task_id（无默认值；unknown → fail closed）。 */
  readonly taskId: string;
  readonly canonicalRoot: string;
  readonly model: OrchestratorV6ModelInput;
  readonly modelTimeoutMs?: number;
}

export interface OrchestratorV6ResumeInput {
  readonly sessionId: string;
  readonly canonicalRoot: string;
  readonly model: OrchestratorV6ModelInput;
  readonly modelTimeoutMs?: number;
}

export interface V6InputTurnOptions {
  /** 调用方声明的期望 session revision（stale → revision_conflict failure 事实）。 */
  readonly expectedRevision?: number;
}

export interface V6StudentInputTurn {
  /** canonical student-input/v1 的 input 判别联合（utterance|control）。 */
  readonly input: V6StudentInputBody;
  readonly client_request_id: string;
}

export interface V6PresentationReport {
  readonly sequence_id: string;
  readonly beat_id: string;
  readonly plannedCount: number;
  /** 队首（或恢复续投项）delivery；全序列 presented 后缺省。 */
  readonly pending?: V6PendingPresentation;
}

export interface V6InputTurnResult {
  readonly revision: number;
  readonly turn: V6TurnResult;
  readonly presentations: readonly V6PresentationReport[];
  readonly snapshot: V6SessionSnapshot;
}

export interface V6PresentationOutcomeRequest {
  readonly sequence_id: string;
  readonly ordinal: number;
  readonly action_id: string;
  readonly outcome: "presented" | "interrupted" | "failed";
  readonly failure_class?: string;
  readonly message?: string;
  readonly expected_revision?: number;
  readonly client_request_id: string;
}

export interface V6OutcomeTurnResult {
  readonly revision: number;
  /** presented 且还有剩余项时为 true（同调用内已备好下一项 delivery）。 */
  readonly advanced: boolean;
  readonly snapshot: V6SessionSnapshot;
}

export type OrchestratorV6ErrorCode =
  | "MODEL_PIN_MISMATCH"
  | "PLAN_IMPORT_FAILED"
  | "UNKNOWN_TASK"
  | "NO_EXECUTABLE_DECISION"
  | "PRESENTATION_CURSOR_MISMATCH"
  | "PRESENTATION_FAILED_PENDING_RECOVERY"
  | "WORKSPACE_APPLY_REJECTED"
  | "RETRY_RECOVERY_WITHOUT_FAILURE";

export class OrchestratorV6Error extends Error {
  constructor(readonly code: OrchestratorV6ErrorCode, message: string) {
    super(message);
    this.name = "OrchestratorV6Error";
  }
}

const nowIso = (): string => new Date().toISOString();

function actionIdOf(action: V6PresentationOrderedAction): string {
  return action.kind === "voice" ? (action.voice_action?.action_id ?? "") : (action.workspace_action?.action_id ?? "");
}

/** deliverOrdinal 的窄输入（plan/v2 与 planned payload 共同满足的结构形状）。 */
interface DeliverableSequence {
  readonly sequence_id: string;
  readonly beat_id: string;
  readonly actions: readonly V6PresentationOrderedAction[];
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

export class TutorSessionOrchestratorV6 {
  readonly sessionId: string;
  private readonly resolver: TutorTaskBindingResolver;
  private readonly binding: TutorTaskBinding;
  private readonly model: OrchestratorV6ModelInput;
  private readonly modelTimeoutMs: number | undefined;
  private navigator: NavigatorSessionV6;

  private constructor(fields: {
    sessionId: string;
    resolver: TutorTaskBindingResolver;
    binding: TutorTaskBinding;
    model: OrchestratorV6ModelInput;
    modelTimeoutMs: number | undefined;
    navigator: NavigatorSessionV6;
  }) {
    this.sessionId = fields.sessionId;
    this.resolver = fields.resolver;
    this.binding = fields.binding;
    this.model = fields.model;
    this.modelTimeoutMs = fields.modelTimeoutMs;
    this.navigator = fields.navigator;
  }

  // ------------------------------------------------------------------ //
  // start / resume
  // ------------------------------------------------------------------ //

  /**
   * 启动 v6 教学会话：resolver 唯一绑定解析（task→question→approved Plan）→
   * kernel v6 原子 pin（catalog pin + model pin + event_schema='v6'）→ 起步
   * execute_beat 决策 → 初始 Beat 序列计划 + 队首交付。
   */
  static start(input: OrchestratorV6StartInput): TutorSessionOrchestratorV6 {
    const resolver = new TutorTaskBindingResolver(input.canonicalRoot);
    const binding = resolveBindingOrThrow(resolver, input.taskId);
    const navigator = NavigatorSessionV6.start({
      sessionId: input.sessionId,
      studentId: input.studentId,
      plan: binding.plan,
      imported: binding.imported,
      registryProvider: resolver.v6RegistryProvider,
      gateProvider: input.model.provider,
      modelTimeoutMs: input.modelTimeoutMs,
      taskId: binding.taskId,
      scenarioId: binding.scenarioId,
      sessionStartedPins: {
        workspace_catalog_pin: workspaceCatalogPin(binding.golden.catalog),
        model_gate_pin: input.model.pin,
      },
    });
    const orchestrator = new TutorSessionOrchestratorV6({
      sessionId: input.sessionId,
      resolver,
      binding,
      model: input.model,
      modelTimeoutMs: input.modelTimeoutMs,
      navigator,
    });
    orchestrator.presentCurrentBeat();
    return orchestrator;
  }

  /**
   * 恢复（refresh/reconnect/replay）：verified rebuild + binding/pin 对账（resolver
   * provider）+ model pin 对账 + Plan-aware gate 归属核对；**零模型调用**；pending
   * delivery 原样重投零新事件——唯一例外是 mid-action 崩溃窗口（planned 已提交、
   * 队首未 delivered）→ resumePresentation 续投（恰好一次）。
   */
  static resume(input: OrchestratorV6ResumeInput): TutorSessionOrchestratorV6 {
    const resolver = new TutorTaskBindingResolver(input.canonicalRoot);
    const verified = createV6Rebuilder(resolver.v6RegistryProvider).verifyCommittedStreamV6(input.sessionId);
    const started = verified.sessionStartedPayload as {
      task_id?: string;
      model_gate_pin?: V5ModelGatePin;
    };
    if (typeof started.task_id !== "string" || started.task_id === "") {
      throw new OrchestratorV6Error("UNKNOWN_TASK", `session ${input.sessionId} carries no pinned task_id (fail closed)`);
    }
    const binding = resolveBindingOrThrow(resolver, started.task_id);
    // model pin 对账（实现级边界：不符即拒，与 catalog pin 对账同型；零事件追加）。
    const expected = input.model.pin;
    const actual = started.model_gate_pin;
    if (!actual || actual.provider !== expected.provider || actual.model_id !== expected.model_id
      || actual.prompt_version !== expected.prompt_version || actual.adjudicator_version !== expected.adjudicator_version) {
      throw new OrchestratorV6Error(
        "MODEL_PIN_MISMATCH",
        `session ${input.sessionId} model_gate_pin mismatch: stream=${JSON.stringify(actual)} vs resumed provider=${JSON.stringify(expected)} (fail closed; zero events appended)`,
      );
    }
    const navigator = NavigatorSessionV6.resume({
      sessionId: input.sessionId,
      plan: binding.plan,
      imported: binding.imported,
      registryProvider: resolver.v6RegistryProvider,
      gateProvider: input.model.provider,
      ...(input.modelTimeoutMs !== undefined ? { modelTimeoutMs: input.modelTimeoutMs } : {}),
    });
    const orchestrator = new TutorSessionOrchestratorV6({
      sessionId: input.sessionId,
      resolver,
      binding,
      model: input.model,
      modelTimeoutMs: input.modelTimeoutMs,
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

  get events(): StoredV6Event[] {
    return this.navigator.events;
  }

  get plan(): TutorTaskBinding["plan"] {
    return this.binding.plan;
  }

  /** G2 对账入口：在线缓存 state vs 全量重建 state（含 presentation cursor）。 */
  assertReplayParity(): { equal: boolean; differences: unknown[] } {
    return this.navigator.assertReplayParity();
  }

  // ------------------------------------------------------------------ //
  // turn 入口（真实提交路径）
  // ------------------------------------------------------------------ //

  /**
   * 学生输入轮（utterance|control）：revision 校验 →（barge_in 先关 pending
   * cursor）/（retry_recovery 走恢复分支：input 事实 + supersede + 新恢复序列）
   * → Navigator 输入链（input 事实 → 解释 → intent → gate → decision）→
   * presentAfterDecision → snapshot。
   */
  async submitStudentInput(input: V6StudentInputTurn, options: V6InputTurnOptions = {}): Promise<V6InputTurnResult> {
    this.refreshWrappers();
    const conflict = this.checkExpectedRevision(options.expectedRevision);
    if (conflict) {
      return {
        revision: conflict.revision,
        turn: conflict.turn,
        presentations: [],
        snapshot: this.snapshot(),
      };
    }
    // failed 停留锁（spec §2.5）：cursor=failed 期间唯一合法输入是
    // control.retry_recovery——其余一律显式拒绝（零事件、零推进、零跳过）。
    if (this.navigator.kernel.state.presentation_cursor.status === "failed"
      && !(input.input.kind === "control" && input.input.command === "retry_recovery")) {
      throw new OrchestratorV6Error(
        "PRESENTATION_FAILED_PENDING_RECOVERY",
        `presentation cursor is parked failed; only control.retry_recovery is admitted until the recovery sequence replaces it (fail closed, zero events)`,
      );
    }
    // retry_recovery：presentation failed 的唯一显式恢复控制（spec §2.5）——
    // input 事实照常入流（原始控制是审计事实），恢复语义由编排层落定。
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
    // barge-in 顺序（PLAN Step 8 服务端侧）：interrupted outcome（+同批 superseded）
    // 先行关闭 pending cursor，再提交显式 control.barge_in。
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
    return {
      revision: this.navigator.revision,
      turn,
      presentations,
      snapshot: this.snapshot(),
    };
  }

  /**
   * 浏览器 outcome 轮：三元组与 pending cursor 唯一对账（不符 fail closed 零事件；
   * 同三元组同值已提交 → 幂等回放零新事件）→ outcome 批（interrupted 同批
   * superseded）→ presented 且非末项：同调用内备好下一项 delivery。
   */
  reportPresentationOutcome(request: V6PresentationOutcomeRequest): V6OutcomeTurnResult {
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
      // 幂等回放：同三元组已提交同值 outcome → 零新事件返回当前快照。
      const committed = findCommittedOutcome(this.events, request);
      if (committed && committed.outcome === request.outcome) {
        return { revision: this.navigator.revision, advanced: false, snapshot: this.snapshot() };
      }
      if (committed) {
        throw new OrchestratorV6Error(
          "PRESENTATION_CURSOR_MISMATCH",
          `outcome for ${request.action_id}@${request.ordinal} of ${request.sequence_id} conflicts with the committed outcome (${committed.outcome}); fail closed, zero events`,
        );
      }
      const at = cursor.status === "idle" ? "idle" : `${cursor.action_id}@${cursor.ordinal} of ${cursor.sequence_id} (${cursor.status})`;
      throw new OrchestratorV6Error(
        "PRESENTATION_CURSOR_MISMATCH",
        `outcome for ${request.action_id}@${request.ordinal} of ${request.sequence_id} does not match the pending cursor (at ${at}); fail closed, zero events`,
      );
    }
    const planned = this.plannedSequenceOf(request.sequence_id);
    if (!planned) {
      throw new OrchestratorV6Error("PRESENTATION_CURSOR_MISMATCH", `sequence ${request.sequence_id} has no committed planned fact (corrupt stream)`);
    }
    const action = planned.actions.find((candidate) => candidate.ordinal === request.ordinal);
    if (!action || actionIdOf(action) !== request.action_id) {
      throw new OrchestratorV6Error("PRESENTATION_CURSOR_MISMATCH", `outcome ref ${request.action_id}@${request.ordinal} does not match the planned action (corrupt stream)`);
    }
    const deliveredSequence = findDeliveredSequence(this.events, request);
    if (deliveredSequence === undefined) {
      throw new OrchestratorV6Error("PRESENTATION_CURSOR_MISMATCH", `no committed delivery for ${request.action_id}@${request.ordinal} of ${request.sequence_id} (corrupt stream)`);
    }
    // outcome 事件的预填序列（store 从当前最大 +1 严格分配；批内引用可预测）。
    const outcomeSequence = this.events.length + 1;
    const batch: PendingV6Event[] = [
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
      // interrupted 废止剩余 sequence（PLAN §2.2）：同批 superseded，原子关闭。
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
  // 呈现编排（有序交付环）
  // ------------------------------------------------------------------ //

  /** 呈现当前 Beat（对最近一个 execute_beat 决策）：Presenter realize → 计划 → 队首交付。 */
  presentCurrentBeat(): V6PresentationReport {
    const decisionEntry = latestExecuteBeatDecision(this.events);
    if (!decisionEntry) {
      throw new OrchestratorV6Error("NO_EXECUTABLE_DECISION", `no committed execute_beat decision to present in ${this.sessionId}`);
    }
    return this.realizeAndDeliver(decisionEntry.decision, decisionEntry.sequence, {});
  }

  /** 当前学生安全 active action（ActiveActionProjector 门面；Step 3 保留链）。 */
  activeAction(promptLatex: string): ActiveAction | undefined {
    const workspaceRebuild = this.rebuildWorkspace();
    return projectActiveAction({
      resources: this.binding.imported.plan.resources,
      actionContracts: (this.binding.imported.projection as { action_contracts?: ProjectedActionContract[] }).action_contracts ?? [],
      beat: this.navigator.currentBeat,
      catalog: this.binding.golden.catalog,
      committedTutorCommands: workspaceRebuild.context.tutorCommands,
      workspaceRevision: workspaceRebuild.state.revision,
      taskId: this.binding.taskId,
      promptLatex,
    });
  }

  /** 服务层快照（fresh rebuild 投影；pending delivery 从 committed 事实构造）。 */
  snapshot(promptLatex = ""): V6SessionSnapshot {
    const tutorState = this.navigator.kernel.rebuild();
    const workspace = this.rebuildWorkspace();
    const events = this.events;
    const views = projectV6Views({
      sessionId: this.sessionId,
      tutorState,
      workspaceState: workspace.state,
      events,
      plan: this.binding.plan,
      catalog: this.binding.golden.catalog,
      factEntryIds: this.binding.golden.factEntryIds,
      sessionRevision: this.navigator.revision,
      resources: this.binding.imported.plan.resources,
    });
    const active = (() => {
      // F7 Step 3 rework（spec §1.3 / PLAN Step 4 一致性校验）：active action
      // 只在 workspace_input 相位挂载——末项 presented 进入 awaiting_evidence
      // 且无 pending delivery 时才对学生开放（「老师呈现完再开放学生操作」；
      // 服务端 applied ≠ 浏览器呈现完成，构造进行中不得挂载）。
      const presenterIdle = tutorState.teaching_cursor.phase === "awaiting_evidence"
        && tutorState.presentation_cursor.status === "idle";
      return presenterIdle ? this.activeAction(promptLatex) : undefined;
    })();
    const pending = projectPendingPresentation({
      sessionId: this.sessionId,
      events,
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
  // 内部：决策后呈现 / 交付 / 恢复
  // ------------------------------------------------------------------ //

  /** 决策后呈现策略（v6）：transition→executeCurrentBeat；execute/return/
   * clarification→presentCurrentBeat；open_inquiry/open_scaffold→锚定 inquiry
   * entry beat 呈现（v5 内联 scaffold voice 已由序列承载取代）。 */
  private presentAfterDecision(turn: V6TurnResult): V6PresentationReport[] {
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
      // inquiry 打开后 currentBeat 即分支 entry beat（inquiry-aware）；锚定该
      // Beat 的 execute_beat 决策再呈现（golden 分支序列为 voice-only——若内容
      // 声明 workspace 面，F3 因果将显式拒绝，零静默降级）。
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
  ): V6PresentationReport {
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
      catalog: this.binding.golden.catalog,
      factEntryIds: this.binding.golden.factEntryIds,
      gateLedger: workspaceRebuild.context.gateLedger,
      hiddenEntryIds: new Set(
        workspaceRebuild.state.solution_board.entries
          .filter((entry) => entry.visibility === "hidden")
          .map((entry) => entry.entry_id),
      ),
      committedElementIds: new Set(workspaceRebuild.state.geometry.committed_element_ids),
      representTargets: this.representTargets(),
    });
    // 队首 workspace 先经 F3 validator（五重校验）——拒绝即零事件（sequence 不
    // 入流；防「计划了必拒动作」）。非队首 workspace 在其交付点同样校验。
    if (plan.actions[0].kind === "workspace") {
      const receipt = this.validateWorkspaceAction(plan, workspaceRebuild, 0);
      if (receipt.status === "rejected") {
        throw new OrchestratorV6Error(
          "WORKSPACE_APPLY_REJECTED",
          `head workspace action of ${plan.sequence_id} rejected by F3 validator: ${receipt.reason} (zero events; sequence never registered)`,
        );
      }
    }
    const batch: PendingV6Event[] = [
      {
        event_type: "presentation_sequence_planned",
        payload: plannedPayloadOf(plan),
        occurred_at: nowIso(),
        causation_sequence: decisionSequence,
        idempotency_key: `${this.sessionId}:ps:${plan.sequence_id}`,
      },
    ];
    if (options.supportEvidence) {
      // open_scaffold 的支持证据事实（v5 随内联 voice 产生；v6 随序列产生，
      // action_ids 引用计划内 voice 动作）。
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
        if (!ese.ok) throw new OrchestratorV6Error("PLAN_IMPORT_FAILED", `external support evidence failed closed: ${ese.errors.join("; ")}`);
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
  ): V6PresentationReport | undefined {
    const action = sequence.actions[ordinal];
    if (!action) return undefined;
    const ref = {
      sequence_id: sequence.sequence_id,
      ordinal,
      action_id: actionIdOf(action),
      kind: action.kind,
    };
    const batch: PendingV6Event[] = [
      {
        event_type: "presentation_action_validated",
        payload: { ...ref },
        occurred_at: nowIso(),
        causation_sequence: plannedSequenceEventSequence,
        idempotency_key: `${this.sessionId}:${sequence.sequence_id}:val:${ordinal}`,
      },
    ];
    if (action.kind === "workspace") {
      // Workspace 队首先经 F3 validator/reducer 应用（PLAN Step 3 第 4 步）：
      // validated → applied（resulting_workspace_revision 回执）→ delivered。
      const workspaceRebuild = this.rebuildWorkspace();
      const receipt = this.validateWorkspaceAction(sequence, workspaceRebuild, ordinal);
      if (receipt.status === "rejected") {
        throw new OrchestratorV6Error(
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
      events: this.events,
      cursor: this.navigator.kernel.state.presentation_cursor,
      revision: this.navigator.revision,
    });
    return { sequence_id: sequence.sequence_id, beat_id: sequence.beat_id, plannedCount: sequence.actions.length, pending };
  }

  /**
   * resume 的崩溃窗口续投：最近一个未 superseded 的 planned 序列若尚有未
   * presented 项且 cursor idle（planned 已提交、队首未 delivered），续投下一
   * 未 presented 项——恰好一次；正常流（全 presented / cursor awaiting_browser
   * / superseded）零事件。
   */
  private resumePresentation(): void {
    const state = this.navigator.kernel.state;
    if (state.presentation_cursor.status !== "idle" || state.completed) return;
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index];
      if (event.event_type !== "presentation_sequence_planned") continue;
      const payload = event.payload as unknown as { sequence_id: string; beat_id: string; actions: V6PresentationOrderedAction[] };
      if (isSequenceSuperseded(this.events, payload.sequence_id)) continue;
      const nextOrdinal = nextUnpresentedOrdinal(this.events, payload.sequence_id, payload.actions.length);
      if (nextOrdinal === undefined) return; // 全 presented：awaiting_evidence 等后续输入
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
      throw new OrchestratorV6Error("PRESENTATION_CURSOR_MISMATCH", `pending cursor ${cursor.action_id}@${cursor.ordinal} cannot be resolved against committed facts (corrupt stream)`);
    }
    const outcomeSequence = this.events.length + 1;
    const batch: PendingV6Event[] = [
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
  private retryRecovery(): { supersededSequence: number; report: V6PresentationReport } {
    const cursor = this.navigator.kernel.state.presentation_cursor;
    if (cursor.status !== "failed") {
      throw new OrchestratorV6Error(
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
    // 新恢复序列：Presenter 以 committed/hidden 过滤重 realize——已 presented 的
    // 构造/reveal 天然跳过，只含剩余工作（含 failed 停留项）。
    const report = this.presentCurrentBeat();
    return { supersededSequence: appended.appendedSequences[0], report };
  }

  // ------------------------------------------------------------------ //
  // 内部：基础设施
  // ------------------------------------------------------------------ //

  /** 原始控制输入事实（retry_recovery 分支不经 navigator 解释链，仍入流审计）。 */
  private appendStudentInputFact(input: V6StudentInputTurn): number {
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
    events: PendingV6Event[],
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
      catalog: this.binding.golden.catalog,
      action: {
        schema: "ai_teaching_workspace_surface_action/v1" as const,
        session_id: this.sessionId,
        ...action.workspace_action,
      },
    });
  }

  private plannedSequenceOf(sequenceId: string): { sequence_id: string; beat_id: string; actions: V6PresentationOrderedAction[] } | undefined {
    const event = findPlannedSequenceEvent(this.events, sequenceId);
    if (!event) return undefined;
    return event.payload as unknown as { sequence_id: string; beat_id: string; actions: V6PresentationOrderedAction[] };
  }

  private rebuildWorkspace(): WorkspaceFold {
    const rebuilt = rebuildWorkspaceRuntimeStateV6(this.sessionId, this.binding.golden.catalog, this.resolver.v6RegistryProvider);
    return { state: rebuilt.state, context: rebuilt.context };
  }

  private countPlanned(): number {
    return this.events.filter((event) => event.event_type === "presentation_sequence_planned").length;
  }

  /**
   * F7 Step 3 rework：需重呈现的目标集——committed 流中「服务端 applied 但
   * 浏览器未 presented（failed/interrupted/崩溃窗口）」的 workspace 动作目标
   * （geometry 构造 output id / Board entry id）。恢复/重呈现序列对这些目标
   * 以 presentation_only 重新入列（零服务端效果），不被 committed/hidden
   * 幂等过滤跳过（spec §2.5：retry 必须重新呈现失败 action）。
   */
  private representTargets(): Set<string> {
    const events = this.events;
    const targets = new Set<string>();
    for (const event of events) {
      if (event.event_type !== "presentation_sequence_planned") continue;
      const payload = event.payload as unknown as { sequence_id: string; actions: V6PresentationOrderedAction[] };
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

  private checkExpectedRevision(expectedRevision: number | undefined): { revision: number; turn: V6TurnResult } | undefined {
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
    this.navigator = NavigatorSessionV6.resume({
      sessionId: this.sessionId,
      plan: this.binding.plan,
      imported: this.binding.imported,
      registryProvider: this.resolver.v6RegistryProvider,
      gateProvider: this.model.provider,
      ...(this.modelTimeoutMs !== undefined ? { modelTimeoutMs: this.modelTimeoutMs } : {}),
    });
  }
}

// ------------------------------------------------------------------ //
// committed 流只读扫描（呈现编排的解析面；不信任调用方载荷的任何 id）
// ------------------------------------------------------------------ //

function resolveBindingOrThrow(resolver: TutorTaskBindingResolver, taskId: string): TutorTaskBinding {
  try {
    return resolver.resolveForStart(taskId);
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      throw new OrchestratorV6Error(
        error.code === "UNKNOWN_TASK" ? "UNKNOWN_TASK" : "PLAN_IMPORT_FAILED",
        (error as Error).message,
      );
    }
    throw error;
  }
}

function latestExecuteBeatDecision(events: readonly StoredV6Event[]): { decision: NavigatorDecision; sequence: number } | undefined {
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

function findPlannedSequenceEvent(events: readonly StoredV6Event[], sequenceId: string): StoredV6Event | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.event_type === "presentation_sequence_planned" && (event.payload as { sequence_id: string }).sequence_id === sequenceId) {
      return event;
    }
  }
  return undefined;
}

function findDeliveredSequence(events: readonly StoredV6Event[], ref: { sequence_id: string; ordinal: number; action_id: string }): number | undefined {
  for (const event of events) {
    if (event.event_type !== "presentation_action_delivered") continue;
    const payload = event.payload as typeof ref;
    if (payload.sequence_id === ref.sequence_id && payload.ordinal === ref.ordinal && payload.action_id === ref.action_id) {
      return event.sequence;
    }
  }
  return undefined;
}

function findOutcomeSequence(events: readonly StoredV6Event[], ref: { sequence_id: string; ordinal: number; action_id: string }): number | undefined {
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
  events: readonly StoredV6Event[],
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

function isSequenceSuperseded(events: readonly StoredV6Event[], sequenceId: string): boolean {
  return events.some(
    (event) => event.event_type === "presentation_sequence_superseded"
      && (event.payload as { sequence_id: string }).sequence_id === sequenceId,
  );
}

/** 下一个未 presented 的 ordinal（全 presented → undefined）。 */
function nextUnpresentedOrdinal(events: readonly StoredV6Event[], sequenceId: string, count: number): number | undefined {
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
function workspaceActionTargetIds(action: NonNullable<V6PresentationOrderedAction["workspace_action"]>): string[] {
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
