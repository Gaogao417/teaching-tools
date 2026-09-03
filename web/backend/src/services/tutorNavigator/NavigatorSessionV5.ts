/**
 * NavigatorSessionV5（F5 — Session 与 Protocol Navigator 内核；R3 加固，2026-08-31）。
 *
 * headless 教学闭环编排（09-target-architecture §10.2 的 F5 切片）：
 * - session start 的 Plan pin 来自 F4 importer 真实产物（`importApprovedPlanV5`
 *   公开入口，anchored 语义内建；固定题 TP-SMV-009@v3 真实 Approved 链），
 *   不用 fixture 发明教学结构；
 * - 全部成功持久 transition 经 F2 内核（TutorSessionKernelV5.start / append——
 *   只读消费，不修改内核；store 事务内先纯折叠后落库对 navigator 批同样
 *   生效：reducer 拒绝 ⇒ 整批回滚）；
 * - 每轮顺序（计划 §3.3 + R3）：append 学生输入事实 →（自然语言）模型裁决 →
 *   服务端校验 → interpreter 假设事实 →（证据评估 → gate 事实）→ Navigator
 *   确定性裁决 → decision 事实（interpretation/gate/decision 尽量同批原子
 *   append）——因果链全程 causation_sequence 可追溯；
 * - G5 对账入口：`rebuildState()` 与在线 state 逐字段一致（F2 comparator
 *   白名单空集），mainline/gate/inquiry/return/barge-in/unclear/out-of-bound
 *   轨迹都由 committed events 重建。
 *
 * ## R3（计划 §5 R3 工作项 4）
 *
 * - `acceptStudentIntent` **异步化**：先持久化学生输入 → 调模型（注入的
 *   provider）→ 服务端校验（候选集复核、canonical ID 采信）→ 同批原子 append。
 *   同 `client_request_id` 重试：读已提交的模型判断，不重复裁决、不双写。
 * - 模型失败（timeout/provider 错误/非法 JSON/候选集外）→ `runtime_failure`
 *   事实（canonical 封闭枚举下 failure_class=internal_error，message 前缀
 *   gate_adjudicator_model_failure）+ unclear 假设 → 澄清/安全 fallback——
 *   **不是 student incorrect**（ADR-007 不变量 6），绝不回退字符串规则 pass。
 * - `kernel` 字段私有化（`private kernelRef`）：对外只暴露 state/revision/
 *   events 与受控用例接口（appendExternalFacts/rebuildState）；仓内 consumer
 *   迁移至公开 API。
 * - `static resume`：kernel verified rebuild 之上叠加 **pinned Plan 逐事件
 *   gate 归属核对**（gate_id 绑定当前 Beat 的 completion gate、satisfied 的
 *   evidence_sequence 指向已提交学生证据）——伪造/损坏流拒绝恢复（设计明示
 *   通用 F2 reducer 不必加载整个 Plan，Plan-aware 校验落本边界）。
 * - replay/rebuild 不重新调模型（裁决以 committed 事实存在；resume 零模型调用）。
 *
 * ## R3.1（2026-08-31）：在线写入边界封口
 *
 * `appendExternalFacts` 收紧为**明确 allowlist**：只接受真正来自外部 Runtime
 * 的事实（当前 = F3 Action Runtime 执行回执 `action_outcome_recorded`）。公开
 * 入口不得提交 Navigator 内部控制事实（`gate_evaluated` 只能由本类内部的证据
 * 评估路径生成；决策/inquiry 生命周期/收束/失败事实同理——计划 §5 F6 归属
 * Orchestrator 的内部控制事实在本切片同样不经此入口）。任一非法类型混入即
 * **fail closed + 整批拒绝**（批未进入 store，任何行未写入——与 F2 store
 * 事务「先纯折叠后落库、拒绝即整批回滚」同一可观测语义；不静默忽略、不部
 * 分提交）。背景：用户 2026-08-31 实测 GT-99@BT-01 satisfied=true 经该入口
 * 污染在线 state（reducer 只核 beat 归属、不核 gate_id↔Plan 绑定，resume 才
 * 拒绝——在线已被污染），R3 退出门禁 3 的写入向量由此补齐。
 */
import { importApprovedPlanV5, type ImportedApprovedPlanV5 } from "../planBuild/v5/ImportApprovedPlanV5";
import { readTutorSessionEventsV5 } from "../tutorSession/TutorSessionEventStoreV5";
import type { PendingV5Event, StoredV5Event, V5EventType } from "../tutorSession/TutorSessionEventV5";
import { TutorSessionKernelV5 } from "../tutorSession/TutorSessionKernelV5";
import { applyV5Event, initialStateFromSessionStarted, type TutorRuntimeStateV5 } from "../tutorSession/TutorRuntimeStateReducerV5";
import {
  buildNavigatorPlan,
  buildSessionStartedPayload,
  pinnedProtocol,
  type NavigatorBeatView,
  type NavigatorPlanV5,
} from "./NavigatorPlanV5";
import {
  INTERPRETER_V5_VERSION,
  hypothesisEventPayload,
  hypothesisFromAdjudication,
  interpretationMatchScore,
  interpretStudentInput,
  isNaturalLanguageInput,
  noProgressHypothesis,
  type IntentKind,
  type NavigatorInterpretation,
} from "./SemanticInterpreterV5";
import { evaluateGateEvidence, type GateEvidenceInput, type WorkspaceGateAssessmentInput } from "./GateEvidenceEvaluatorV5";
import { adjudicateCommandPayload, resolveBeatActionTemplate } from "../tutorOrchestration/WorkspaceActionAdjudication";
import type { PlanResourceV4 } from "../planBuild/canonicalInputs";
import {
  ModelGateAdjudicatorV5,
  UnavailableGateProvider,
  buildGateAdjudicationContext,
  type GateAdjudicationProvider,
  type GateAdjudicationResult,
} from "./ModelGateAdjudicatorV5";
import {
  MAX_LOCAL_INQUIRY_STEPS,
  NAVIGATOR_V5_VERSION,
  canonicalPolicyFailureClass,
  decideNavigation,
  deriveLocalInquirySteps,
  deriveUnresolvedClarifications,
  type NavigatorContext,
  type NavigatorDecision,
  type NavigatorTrigger,
} from "./TutorNavigatorV5";
import { buildExternalSupportEvidence } from "./ExternalSupportEvidenceV5";

export const GOLDEN_TP_ID = "TP-SMV-009";
export const GOLDEN_TASK_ID = "goldenMinhangFold2020";
export const GOLDEN_SCENARIO_ID = "golden-similarity-mvp-001:QT-SMV-001";

export interface NavigatorSessionStartInput {
  readonly sessionId: string;
  readonly studentId: string;
  /** canonical-authoring 根（skills 仓 artifacts/canonical-authoring）。 */
  readonly canonicalRoot: string;
  readonly tpId?: string;
  readonly taskId?: string;
  readonly scenarioId?: string;
  /**
   * R3：Gate 裁决 provider（依赖注入）。缺省 UnavailableGateProvider（fail
   * closed——自然语言输入不会因模型缺失回退字符串规则 pass）；确定性测试注入
   * FixedResponseGateProvider，真模型实证注入 ClaudeCodeGateProvider。
   */
  readonly gateProvider?: GateAdjudicationProvider;
  /** 模型调用超时（ms）；超时 → unclear（provider_timeout）。 */
  readonly modelTimeoutMs?: number;
  /**
   * F6 增补（f6-scope-ledger 授权边界 3）：session_started 的服务端 pin 增补
   * （orchestrator 计算后透传；本类不理解其语义，只进 payload——canonical
   * append 侧校验）。缺省不写（F5 独立用法行为不变）。
   */
  readonly sessionStartedPins?: {
    workspace_catalog_pin?: {
      catalog_schema_version: number;
      content_hash: string;
      entry_count?: number;
    };
    model_gate_pin?: {
      provider: string;
      model_id: string;
      prompt_version: string;
      adjudicator_version: string;
    };
  };
}

export interface StudentIntentInput {
  readonly intent_kind: IntentKind;
  readonly client_request_id: string;
  readonly text?: string;
  readonly workspace_command?: {
    command_id: string;
    surface: "geometry" | "solution_board";
    capability: string;
    target_ids: string[];
    expected_workspace_revision: number;
    client_command_id: string;
  };
}

export interface TurnResult {
  readonly revision: number;
  readonly intentSequence: number;
  readonly interpretationSequence?: number;
  readonly gateSequence?: number;
  readonly decisionSequence?: number;
  readonly decision?: NavigatorDecision;
  readonly failure?: { failure_class: string; message: string };
}

/** resume 边界的 Plan-aware 完整性错误（伪造/损坏流拒绝恢复）。 */
export type NavigatorResumeErrorCode =
  | "CURSOR_OUTSIDE_PINNED_PLAN"
  | "GATE_BEAT_MISMATCH"
  | "PLAN_GATE_BINDING_MISMATCH"
  | "GATE_EVIDENCE_FORGED";

export class NavigatorResumeIntegrityError extends Error {
  readonly code: NavigatorResumeErrorCode;
  readonly relatedSequence?: number;

  constructor(code: NavigatorResumeErrorCode, message: string, relatedSequence?: number) {
    super(message);
    this.name = "NavigatorResumeIntegrityError";
    this.code = code;
    if (relatedSequence !== undefined) this.relatedSequence = relatedSequence;
  }
}

/**
 * R3.1 在线写入边界错误：公开外部事实入口（`appendExternalFacts`）收到
 * allowlist 之外的 Navigator 内部控制事实——fail closed，整批拒绝。
 */
export type NavigatorWriteBoundaryErrorCode = "EXTERNAL_FACT_TYPE_FORBIDDEN";

export class NavigatorWriteBoundaryError extends Error {
  readonly code: NavigatorWriteBoundaryErrorCode;
  /** 本批中混入的非法事件类型（去重）。 */
  readonly forbiddenTypes: readonly string[];

  constructor(forbiddenTypes: readonly string[], message: string) {
    super(message);
    this.name = "NavigatorWriteBoundaryError";
    this.code = "EXTERNAL_FACT_TYPE_FORBIDDEN";
    this.forbiddenTypes = forbiddenTypes;
  }
}

/**
 * R3.1 外部事实 allowlist（封闭集）：`appendExternalFacts` 唯一接受的
 * 「真正来自外部 Runtime 的事实」= F3 Action Runtime 的执行回执
 * `action_outcome_recorded`（R1 consumeWorkspaceCommandOutcome 消费链路的
 * 输入；Navigator 永不代写）。其余 15 类事件全部属 Navigator 内部生成路径：
 * `gate_evaluated` 只经本类证据评估路径（interpretAndDecide /
 * evaluateGateAndDecide）；`policy_decision_made`/`inquiry_opened`/
 * `inquiry_returned`/`session_completed`/`voice_action_issued`/
 * `external_support_recorded` 只经 commitDecisions；学生输入事实只经
 * `acceptStudentIntent`；`session_started` 只经 kernel.start。扩展本集合
 * （如 F6 Orchestrator 内部事实提交）须先改本仓 PRDS 计划，不得原地放行。
 */
export const NAVIGATOR_EXTERNAL_FACT_EVENT_TYPES: ReadonlySet<V5EventType> = new Set<V5EventType>([
  "action_outcome_recorded",
]);

export interface NavigatorResumeInput {
  readonly sessionId: string;
  readonly canonicalRoot: string;
  readonly tpId?: string;
  readonly gateProvider?: GateAdjudicationProvider;
  readonly modelTimeoutMs?: number;
}

export class NavigatorSessionV5 {
  readonly sessionId: string;
  readonly plan: NavigatorPlanV5;
  /** R3：kernel 私有化——对外只经 state/revision/events 与受控用例接口。 */
  private kernelRef: TutorSessionKernelV5;
  private readonly adjudicator: ModelGateAdjudicatorV5;
  /** inquiry 打开时的当前 inquiry Beat id（mainline 游标冻结在 state）。 */
  private inquiryBeatId: string | undefined;
  private imported: ImportedApprovedPlanV5;

  private constructor(
    sessionId: string,
    plan: NavigatorPlanV5,
    imported: ImportedApprovedPlanV5,
    kernel: TutorSessionKernelV5,
    adjudicator: ModelGateAdjudicatorV5,
  ) {
    this.sessionId = sessionId;
    this.plan = plan;
    this.imported = imported;
    this.kernelRef = kernel;
    this.adjudicator = adjudicator;
  }

  /** 启动 navigator 会话：真实 Approved 链导入 → F2 kernel.start（原子 pin）。 */
  static start(input: NavigatorSessionStartInput): NavigatorSessionV5 {
    const imported = importApprovedPlanV5({ canonicalRoot: input.canonicalRoot, anchored: true }, input.tpId ?? GOLDEN_TP_ID);
    if (!imported.ok) {
      throw new Error(`approved plan import failed (fail closed): ${imported.errors.join("; ")}`);
    }
    const plan = buildNavigatorPlan(imported.imported);
    const payload = {
      ...buildSessionStartedPayload(plan, {
        sessionId: input.sessionId,
        taskId: input.taskId ?? GOLDEN_TASK_ID,
        scenarioId: input.scenarioId ?? GOLDEN_SCENARIO_ID,
      }),
      ...(input.sessionStartedPins?.workspace_catalog_pin
        ? { workspace_catalog_pin: input.sessionStartedPins.workspace_catalog_pin }
        : {}),
      ...(input.sessionStartedPins?.model_gate_pin
        ? { model_gate_pin: input.sessionStartedPins.model_gate_pin }
        : {}),
    };
    const kernel = TutorSessionKernelV5.start({
      sessionId: input.sessionId,
      studentId: input.studentId,
      sessionStarted: payload,
      occurred_at: new Date().toISOString(),
    });
    const adjudicator = new ModelGateAdjudicatorV5(input.gateProvider ?? new UnavailableGateProvider(), {
      ...(input.modelTimeoutMs !== undefined ? { timeoutMs: input.modelTimeoutMs } : {}),
    });
    const session = new NavigatorSessionV5(input.sessionId, plan, imported.imported, kernel, adjudicator);
    // 起步决策：execute entry Beat（causation→session_started sequence 1）。
    session.commitDecisions(1, [{ kind: "session_start" }]);
    return session;
  }

  /**
   * 恢复会话（refresh/replay/reconnect）：kernel verified rebuild（gap/corrupt/
   * revision/pin fail closed——F2 边界不动）+ **pinned Plan 逐事件 gate 归属
   * 核对**（R3 工作项 6：通用 F2 reducer 不必加载整个 Plan，Plan-aware 校验
   * 落本边界）。伪造 gate 事件（候选外 gate_id / 未来 Beat / pass 无对应学生
   * 证据 sequence）→ NavigatorResumeIntegrityError，拒绝恢复。零模型调用。
   */
  static resume(input: NavigatorResumeInput): NavigatorSessionV5 {
    const imported = importApprovedPlanV5({ canonicalRoot: input.canonicalRoot, anchored: true }, input.tpId ?? GOLDEN_TP_ID);
    if (!imported.ok) {
      throw new Error(`approved plan import failed (fail closed): ${imported.errors.join("; ")}`);
    }
    const plan = buildNavigatorPlan(imported.imported);
    const kernel = TutorSessionKernelV5.resume(input.sessionId, { expectedTutorPlanRef: plan.tutor_plan_ref });
    const events = readTutorSessionEventsV5(input.sessionId);
    verifyGateAttributionAgainstPlan(plan, imported.imported.plan.resources, events);
    const adjudicator = new ModelGateAdjudicatorV5(input.gateProvider ?? new UnavailableGateProvider(), {
      ...(input.modelTimeoutMs !== undefined ? { timeoutMs: input.modelTimeoutMs } : {}),
    });
    const session = new NavigatorSessionV5(input.sessionId, plan, imported.imported, kernel, adjudicator);
    session.inquiryBeatId = reconstructInquiryBeatId(events);
    return session;
  }

  get state(): TutorRuntimeStateV5 {
    return this.kernelRef.state;
  }

  /** 当前 session revision（受控公开接口；kernel 私有化的替代入口）。 */
  get revision(): number {
    return this.kernelRef.revision;
  }

  get events(): StoredV5Event[] {
    return readTutorSessionEventsV5(this.sessionId);
  }

  /** 当前导航 Beat（inquiry 打开时为 inquiry Beat，否则主线 Beat）。 */
  get currentBeat(): NavigatorBeatView {
    if (this.state.inquiry_cursor?.inquiry_protocol_id) {
      const protocol = pinnedProtocol(this.plan, this.state.inquiry_cursor.inquiry_protocol_id);
      const beatId = this.inquiryBeatId ?? protocol?.entry_beat_id;
      const beat = protocol?.beats.get(beatId ?? "");
      if (beat) return beat;
    }
    const cursor = this.state.teaching_cursor;
    const protocol = pinnedProtocol(this.plan, cursor.protocol_id);
    const beat = protocol?.beats.get(cursor.beat_id);
    if (!protocol || !beat) {
      throw new Error(`cursor ${cursor.protocol_id}/${cursor.beat_id} is outside the pinned plan`);
    }
    return beat;
  }

  /** 全量重建（受控公开接口；对账/恢复用）。 */
  rebuildState(): TutorRuntimeStateV5 {
    return this.kernelRef.rebuild();
  }

  /**
   * 受控用例 append：F3 侧执行回执 / 编排外部事实（原 `session.kernel.append`
   * 的公开替代——kernel 私有化后，外部事实必须经此显式入口，教学决策仍只经
   * 本类内部路径产生）。
   *
   * R3.1 写入边界：批内只允许 `NAVIGATOR_EXTERNAL_FACT_EVENT_TYPES`
   * （allowlist，当前 = `action_outcome_recorded`）。任一 Navigator 内部控制
   * 事实（`gate_evaluated` / `policy_decision_made` /
   * `semantic_interpretation_recorded` / `session_completed` /
   * `inquiry_opened` / `inquiry_returned` / 学生输入 / issued 动作 / 失败类
   * / `session_started`……）混入即抛 `NavigatorWriteBoundaryError`——
   * **fail closed + 整批零提交**（批在进入 store 前被拒，任何行未写入；
   * 过边界后仍受 F2 store 事务「先纯折叠后落库、拒绝即整批回滚」约束）。
   * 不静默忽略非法事件、不部分提交合法项（混批 = 整批回滚）。
   */
  appendExternalFacts(expectedRevision: number, events: PendingV5Event[]): {
    revision: number;
    appendedSequences: number[];
    state: TutorRuntimeStateV5;
  } {
    const forbidden = [
      ...new Set(
        events
          .filter((event) => !NAVIGATOR_EXTERNAL_FACT_EVENT_TYPES.has(event.event_type))
          .map((event) => event.event_type),
      ),
    ];
    if (forbidden.length > 0) {
      throw new NavigatorWriteBoundaryError(
        forbidden,
        `appendExternalFacts fail closed: batch contains Navigator-internal control fact(s) [${forbidden.join(", ")}]; `
          + `this boundary only accepts external Runtime receipts [${[...NAVIGATOR_EXTERNAL_FACT_EVENT_TYPES].join(", ")}] `
          + `(gate_evaluated is produced only by the in-session evidence evaluation path; decisions and inquiry lifecycle only by the Navigator itself; plan §5 R3.1/R3 exit gate 3 write vector)`,
      );
    }
    return this.kernelRef.append(expectedRevision, events);
  }

  private nextSequence(): number {
    return this.events.length + 1;
  }

  private baseContext(): NavigatorContext {
    const events = this.events;
    return {
      sessionId: this.sessionId,
      plan: this.plan,
      state: this.kernelRef.state,
      revision: this.kernelRef.revision,
      ...(this.inquiryBeatId !== undefined ? { inquiryBeatId: this.inquiryBeatId } : {}),
      localInquirySteps: deriveLocalInquirySteps(events),
      unresolvedClarifications: deriveUnresolvedClarifications(events),
    };
  }

  private append(revision: number, events: PendingV5Event[]): { revision: number; sequences: number[] } {
    const result = this.kernelRef.append(revision, events);
    return { revision: result.revision, sequences: result.appendedSequences };
  }

  /**
   * 接受学生输入（真实提交路径，R3 异步化）：intent 事实先行持久化 →（自然
   * 语言）单次模型裁决 → 服务端校验 → interpretation/gate/decision 同批原子
   * append → Navigator 决策（或显式 policy_failed）。
   *
   * 同 `client_request_id` 重试：读已提交的模型判断（interpretation + decision
   * 事实），不重复裁决、不双写（幂等重放）。
   */
  async acceptStudentIntent(input: StudentIntentInput): Promise<TurnResult> {
    if (
      (input.intent_kind === "submit_answer" || input.intent_kind === "ask_question") &&
      (input.text === undefined || input.text.length === 0)
    ) {
      throw new Error(`${input.intent_kind} requires text (canonical mirror rule)`);
    }
    // 幂等重试：同 client_request_id 已有 committed 判断（interpretation 已落）
    // → 读已提交判断返回，不重复裁决、不双写。
    const committed = findCommittedTurn(this.events, input.client_request_id);
    if (committed?.interpretationSequence !== undefined) return committed;

    const priorEvents = this.events;
    let revision = this.kernelRef.revision;
    // 学生输入事实先行持久化（R3：输入事实先于模型调用落库）；输入已落库但
    // 判断未提交（调用中断恢复）→ 复用已提交 intent sequence，不重复持久化输入。
    let intentSequence: number;
    if (committed) {
      intentSequence = committed.intentSequence;
    } else {
      intentSequence = this.nextSequence();
      const intentPayload: Record<string, unknown> = {
        intent_kind: input.intent_kind,
        client_request_id: input.client_request_id,
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.workspace_command ? { workspace_command: input.workspace_command } : {}),
      };
      ({ revision } = this.append(revision, [
        { event_type: "student_intent_recorded", payload: intentPayload, occurred_at: nowIso() },
      ]));
    }

    // 自然语言 → 同一次模型调用返回 intent + reasoning location + grounding +
    // verdict（R3 工作项 1/3）；结构化输入仍走确定性解释器。
    let hypothesis: NavigatorInterpretation;
    let modelFailure: { reason: string; detail: string } | undefined;
    if (isNaturalLanguageInput(input.intent_kind, input.text)) {
      const adjudication = await this.adjudicator.adjudicate(
        buildGateAdjudicationContext({
          plan: this.plan,
          beat: this.currentBeat,
          events: priorEvents,
          ...(this.state.reasoning_focus ? { reasoningFocus: this.state.reasoning_focus } : {}),
          studentInput: { intent_kind: input.intent_kind, text: input.text ?? "" },
          factRelevanceScore: interpretationMatchScore,
        }),
      );
      if (adjudication.degraded_reason) {
        // 模型失败 = runtime/model failure（ADR-007 不变量 6），非 student
        // incorrect：记 runtime_failure 事实，假设降级 unclear（不回退字符串规则）。
        modelFailure = { reason: adjudication.degraded_reason, detail: `provider=${adjudication.provider}` };
      }
      hypothesis = hypothesisFromAdjudication({
        plan: this.plan,
        beat: this.currentBeat,
        intent_kind: input.intent_kind,
        text: input.text ?? "",
        adjudication,
        evidence_sequence: intentSequence,
      });
    } else {
      hypothesis = interpretStudentInput(this.plan, {
        intent_kind: input.intent_kind,
        ...(input.text !== undefined ? { text: input.text } : {}),
        beat: this.currentBeat,
      });
    }
    return this.interpretAndDecide(revision, intentSequence, input.intent_kind, input.text, hypothesis, modelFailure);
  }

  /**
   * F6 增补（f6-scope-ledger 授权边界 3）：对当前（inquiry-aware）Beat 产出
   * execute_beat 呈现决策（唯一确定性来源=decideNavigation 的 beat_execution
   * trigger；completed 后显式失败）。Beat 推进（transition/return_to_mainline）
   * 后由编排层调用一次，锚定新 Beat 的 Presenter 呈现与 tutor workspace 动作
   * 因果（F3 assertTutorActionCausation 要求 decision.beatId==cursor.beatId；
   * transition 决策的 beat_id=from-Beat 不能作锚）。
   */
  executeCurrentBeat(): TurnResult {
    const revision = this.kernelRef.revision;
    const anchor = this.events[this.events.length - 1]?.sequence ?? 1;
    const outcome = decideNavigation(this.baseContext(), { kind: "beat_execution", sequence: anchor });
    if (!outcome.ok) {
      const failed = this.append(revision, [
        {
          event_type: "policy_failed",
          payload: policyFailedPayload(outcome.failure.failure_class),
          occurred_at: nowIso(),
          causation_sequence: anchor,
        },
      ]);
      return {
        revision: failed.revision,
        intentSequence: anchor,
        failure: { failure_class: outcome.failure.failure_class, message: outcome.failure.message },
      };
    }
    return this.commitDecisions(revision, [{ kind: "plain", sequence: anchor, decision: outcome.decision }]);
  }

  /** narration 完成（voice issued + outcome completed 事实），再经 Navigator 裁决。 */
  completeNarration(options: { resourceRef?: string; text?: string } = {}): TurnResult & { advanced: boolean } {
    let revision = this.kernelRef.revision;
    const beat = this.currentBeat;
    const issuedSequence = this.nextSequence();
    const voiceId = `VA-${this.sessionId}-${String(issuedSequence).padStart(4, "0")}`;
    const text = options.text ?? beat.purpose;
    ({ revision } = this.append(revision, [
      {
        event_type: "voice_action_issued",
        payload: {
          action_id: voiceId,
          decision_id: latestDecisionId(this.events) ?? `TD-${this.sessionId}-0001`,
          ...(beat ? { beat_id: beat.beat_id } : {}),
          text,
          source: options.resourceRef ? "approved-resource" : "deterministic-scaffold",
          ...(options.resourceRef ? { resource_ref: options.resourceRef } : {}),
          interruptible: true,
        },
        occurred_at: nowIso(),
        causation_sequence: latestDecisionSequence(this.events) ?? 1,
      },
      {
        event_type: "action_outcome_recorded",
        payload: { action_id: voiceId, action_kind: "voice", outcome: "completed" },
        occurred_at: nowIso(),
        causation_sequence: issuedSequence,
      },
    ]));
    const outcomeSequence = issuedSequence + 1;
    const outcome = decideNavigation(this.baseContext(), { kind: "narration_completed", sequence: outcomeSequence });
    if (!outcome.ok) {
      const failed = this.append(revision, [
        {
          event_type: "policy_failed",
          payload: policyFailedPayload(outcome.failure.failure_class),
          occurred_at: nowIso(),
          causation_sequence: outcomeSequence,
        },
      ]);
      return {
        revision: failed.revision,
        intentSequence: issuedSequence,
        advanced: false,
        failure: { failure_class: outcome.failure.failure_class, message: outcome.failure.message },
      };
    }
    const decided = this.commitDecisions(revision, [{ kind: "gate_from_narration", sequence: outcomeSequence, decision: outcome.decision }]);
    return { ...decided, intentSequence: issuedSequence, advanced: true };
  }

  /**
   * 消费 F3 已提交的 workspace 执行回执（2026-08-31 R1 硬边界：禁止「校验后
   * 自报 outcome」——本方法**不创建/追加任何 action_outcome_recorded**）。
   *
   * action ID、capability、outcome、revision 全部取自 committed 事件流：
   * - 命令事实 = `student_intent_recorded.workspace_command(command_id)`；
   * - 执行回执 = 其配对的 `action_outcome_recorded(action_id=command_id,
   *   action_kind=student_command)`（F3 Action Runtime 经真实提交路径产出；
   *   测试/F6 前由调用方经 appendExternalFacts 提交——Navigator 永不代写）。
   * 任一缺失即 fail closed（抛错、零事件追加）——没有回执就没有证据。
   * 孤儿/不匹配回执在持久化/重建边界已被 F2 reducer 拒绝（R0 §5 两层落点），
   * 本层只消费合法 committed 回执。
   */
  consumeWorkspaceCommandOutcome(input: { command_id: string; assessment?: WorkspaceGateAssessmentInput }): TurnResult {
    const events = this.events;
    let intent: { sequence: number; capability: string; surface: string } | undefined;
    let receipt: { sequence: number; outcome: "completed" | "rejected" | "interrupted" | "failed"; resulting_revision?: number } | undefined;
    for (const event of events) {
      if (event.event_type === "student_intent_recorded") {
        const command = (event.payload as { workspace_command?: { command_id: string; capability: string; surface: string } }).workspace_command;
        if (command && command.command_id === input.command_id) {
          intent = { sequence: event.sequence, capability: command.capability, surface: command.surface };
        }
      } else if (event.event_type === "action_outcome_recorded") {
        const outcome = event.payload as {
          action_id: string;
          action_kind: string;
          outcome: "completed" | "rejected" | "interrupted" | "failed";
          resulting_revision?: number;
        };
        if (outcome.action_id === input.command_id && outcome.action_kind === "student_command") {
          receipt = {
            sequence: event.sequence,
            outcome: outcome.outcome,
            ...(outcome.resulting_revision !== undefined ? { resulting_revision: outcome.resulting_revision } : {}),
          };
        }
      }
    }
    if (!intent) {
      throw new Error(
        `consumeWorkspaceCommandOutcome fail closed: no committed student_intent_recorded.workspace_command with command_id=${input.command_id} (nothing to consume)`,
      );
    }
    if (!receipt) {
      throw new Error(
        `consumeWorkspaceCommandOutcome fail closed: no committed execution receipt (action_outcome_recorded action_id=${input.command_id}, action_kind=student_command); the Navigator never fabricates outcomes`,
      );
    }
    const beat = this.currentBeat;
    const gate = beat.completion_evidence.gate;
    const inInquiry = this.state.inquiry_cursor !== null;
    if (!gate || beat.completion_evidence.evidence_kind !== "workspace_command" || inInquiry || this.state.completed) {
      return { revision: this.kernelRef.revision, intentSequence: receipt.sequence };
    }
    const assessment = evaluateGateEvidence(this.plan, beat, {
      confirmation_sequences: [],
      workspace_outcomes: [{ capability: intent.capability, outcome: receipt.outcome, sequence: receipt.sequence }],
      narration_completed: false,
      // F7 因果链 2：workspace gate 只消费已验证裁决（调用方经单一 typed
      // evaluator 产出；缺省不得 pass——completed 回执本身不构成满足）。
      ...(input.assessment ? { workspace_assessments: [input.assessment] } : {}),
    });
    return this.evaluateGateAndDecide(this.kernelRef.revision, receipt.sequence, gate.gate_id, beat.beat_id, assessment.satisfied, assessment.evidence_sequence);
  }

  /**
   * silence/无进展证据（R0 §1：no_progress 来自 silence/timeout/无新事实）：
   * 落 semantic_interpretation_recorded(reasoning_alignment=no_progress) 事实
   * → Navigator 裁决（主线=澄清门禁；inquiry 内=bounded 强制返回）。
   */
  reportSilence(): TurnResult {
    const revision = this.kernelRef.revision;
    const sequence = this.nextSequence();
    const hypothesis = noProgressHypothesis();
    this.append(revision, [
      {
        event_type: "semantic_interpretation_recorded",
        payload: hypothesisEventPayload(hypothesis),
        occurred_at: nowIso(),
        causation_sequence: latestIntentSequence(this.events) ?? 1,
      },
    ]);
    const outcome = decideNavigation(this.baseContext(), { kind: "silence", sequence, hypothesis });
    return this.commitDecisions(this.kernelRef.revision, [
      outcome.ok
        ? { kind: "plain", sequence, decision: outcome.decision }
        : { kind: "failed", sequence, failure: outcome.failure },
    ]);
  }

  /** bounded_wait 超时（计时结束不能替代证据——只走 timeout 出边或安全 fallback）。 */
  reportTimeout(): TurnResult {
    const revision = this.kernelRef.revision;
    const anchor = this.events[this.events.length - 1]?.sequence ?? 1;
    const beat = this.currentBeat;
    const outcome = decideNavigation(this.baseContext(), { kind: "timeout", sequence: anchor, beat_id: beat.beat_id });
    if (!outcome.ok) {
      const failed = this.append(revision, [
        {
          event_type: "policy_failed",
          payload: policyFailedPayload(outcome.failure.failure_class),
          occurred_at: nowIso(),
          causation_sequence: anchor,
        },
      ]);
      return {
        revision: failed.revision,
        intentSequence: anchor,
        failure: { failure_class: outcome.failure.failure_class, message: outcome.failure.message },
      };
    }
    return this.commitDecisions(revision, [{ kind: "plain", sequence: anchor, decision: outcome.decision }]);
  }

  // ------------------------------------------------------------------ //
  // 内部：interpret → (gate) → decide → 持久化（同批原子）
  // ------------------------------------------------------------------ //

  private interpretAndDecide(
    revision: number,
    intentSequence: number,
    intentKind: IntentKind,
    text: string | undefined,
    hypothesis: NavigatorInterpretation,
    modelFailure?: { reason: string; detail: string },
  ): TurnResult {
    // R3：runtime_failure（若有）+ interpretation +（gate）+ decision 同批原子
    // append（store 事务内先纯折叠，任一事件被拒 ⇒ 整批回滚）。
    const batch: PendingV5Event[] = [];
    if (modelFailure) {
      batch.push({
        event_type: "runtime_failure",
        payload: {
          failure_class: "internal_error",
          message: `gate_adjudicator_model_failure: ${modelFailure.reason} (${modelFailure.detail})`,
          related_event_sequence: intentSequence,
        },
        occurred_at: nowIso(),
        causation_sequence: intentSequence,
      });
    }
    const interpretationSequence = this.nextSequence() + batch.length;
    batch.push({
      event_type: "semantic_interpretation_recorded",
      payload: hypothesisEventPayload(hypothesis),
      occurred_at: nowIso(),
      causation_sequence: intentSequence,
    });

    const beat = this.currentBeat;
    const gate = beat.completion_evidence.gate;
    const evidenceKind = beat.completion_evidence.evidence_kind;
    // inquiry（批准分支或 LocalInquiry）打开期间主线 gate 不评估：主线游标冻结。
    const inInquiry = this.state.inquiry_cursor !== null;

    let gateSequence: number | undefined;
    let trigger: NavigatorTrigger = { kind: "student_input", sequence: intentSequence, intent_kind: intentKind, ...(text !== undefined ? { text } : {}), hypothesis };

    if (!inInquiry && gate) {
      const evidenceInput: GateEvidenceInput = {
        confirmation_sequences: isConfirmationIntent(intentKind) ? [intentSequence] : [],
        workspace_outcomes: [],
        narration_completed: false,
        ...(hypothesis.gate_assessment ? { model_assessment: hypothesis.gate_assessment } : {}),
      };
      const gateRelevant =
        (evidenceKind === "student_confirmation" || evidenceKind === "explicit_gate_pass") && isConfirmationIntent(intentKind);
      // 替代路线作答不是当前 gate 的证据（是另一条合法数学路径的提案）：
      // 不做 gate 评估，直接交 Navigator 验证 SV 后 accept_alternate_path。
      const answerRelevant = evidenceKind === "student_answer" && intentKind === "submit_answer" && !hypothesis.matched_variant_id;
      if (gateRelevant || answerRelevant) {
        const assessment = evaluateGateEvidence(this.plan, beat, evidenceInput);
        gateSequence = this.nextSequence() + batch.length; // runtime_failure?/interpretation 之后
        batch.push({
          event_type: "gate_evaluated",
          payload: {
            gate_id: gate.gate_id,
            beat_id: beat.beat_id,
            satisfied: assessment.satisfied,
            ...(assessment.evidence_sequence !== undefined ? { evidence_sequence: assessment.evidence_sequence } : {}),
          },
          occurred_at: nowIso(),
          causation_sequence: intentSequence,
        });
        trigger = {
          kind: "gate_evaluated",
          sequence: gateSequence,
          gate_id: gate.gate_id,
          beat_id: beat.beat_id,
          satisfied: assessment.satisfied,
          ...(assessment.evidence_sequence !== undefined ? { evidence_sequence: assessment.evidence_sequence } : {}),
        };
      }
    }

    const outcome = decideNavigation(this.baseContext(), trigger);
    const result = this.commitDecisions(
      revision,
      [
        outcome.ok
          ? { kind: "plain", sequence: trigger.sequence, decision: outcome.decision }
          : { kind: "failed", sequence: trigger.sequence, failure: outcome.failure },
      ],
      batch,
    );
    return {
      ...result,
      intentSequence,
      interpretationSequence,
      ...(gateSequence !== undefined ? { gateSequence } : {}),
    };
  }

  private evaluateGateAndDecide(
    revision: number,
    evidenceSequence: number,
    gateId: string,
    beatId: string,
    satisfied: boolean,
    evidenceRef?: number,
  ): TurnResult {
    const gateSequence = this.nextSequence();
    const batch: PendingV5Event[] = [
      {
        event_type: "gate_evaluated",
        payload: {
          gate_id: gateId,
          beat_id: beatId,
          satisfied,
          ...(evidenceRef !== undefined ? { evidence_sequence: evidenceRef } : {}),
        },
        occurred_at: nowIso(),
        causation_sequence: evidenceSequence,
      },
    ];
    const outcome = decideNavigation(this.baseContext(), {
      kind: "gate_evaluated",
      sequence: gateSequence,
      gate_id: gateId,
      beat_id: beatId,
      satisfied,
      ...(evidenceRef !== undefined ? { evidence_sequence: evidenceRef } : {}),
    });
    const result = this.commitDecisions(
      this.kernelRef.revision,
      [
        outcome.ok
          ? { kind: "plain", sequence: gateSequence, decision: outcome.decision }
          : { kind: "failed", sequence: gateSequence, failure: outcome.failure },
      ],
      batch,
    );
    return { ...result, gateSequence };
  }

  private commitDecisions(
    revision: number,
    items: ReadonlyArray<
      | { kind: "session_start" }
      | { kind: "plain"; sequence: number; decision: NavigatorDecision }
      | { kind: "gate_from_narration"; sequence: number; decision: NavigatorDecision }
      | { kind: "failed"; sequence: number; failure: { failure_class: string; message: string } }
    >,
    prefixBatch: PendingV5Event[] = [],
  ): TurnResult {
    const batch: PendingV5Event[] = [...prefixBatch];
    const results: TurnResult[] = [];
    let currentRevision = revision;
    for (const item of items) {
      if (item.kind === "session_start") {
        const outcome = decideNavigation(this.baseContext(), { kind: "session_start" });
        if (!outcome.ok) throw new Error(`navigator refused session start: ${outcome.failure.message}`);
        batch.push(this.decisionEvent(1, outcome.decision, 1));
        results.push({ revision: currentRevision, intentSequence: 1, decisionSequence: undefined, decision: outcome.decision });
        continue;
      }
      if (item.kind === "failed") {
        batch.push({
          event_type: "policy_failed",
          payload: policyFailedPayload(item.failure.failure_class),
          occurred_at: nowIso(),
          causation_sequence: item.sequence,
        });
        results.push({ revision: currentRevision, intentSequence: item.sequence, failure: item.failure });
        continue;
      }
      const decision = item.decision;
      const decisionSequence = this.nextSequence() + batch.length;
      batch.push(this.decisionEvent(decisionSequence, decision, item.sequence));
      // companion 事实：inquiry 生命周期 + scaffold 支持证据 + 收束。
      if (decision.decision_kind === "open_inquiry" || decision.decision_kind === "open_scaffold") {
        const inquiry = decision.inquiry as { inquiry_id: string; inquiry_protocol_id?: string; return_beat_id: string };
        batch.push({
          event_type: "inquiry_opened",
          payload: {
            inquiry_id: inquiry.inquiry_id,
            ...(inquiry.inquiry_protocol_id ? { inquiry_protocol_id: inquiry.inquiry_protocol_id } : {}),
            return_beat_id: inquiry.return_beat_id,
            local: inquiry.inquiry_protocol_id === undefined,
            trigger: inquiryTriggerFor(decision),
          },
          occurred_at: nowIso(),
          causation_sequence: decisionSequence,
        });
        if (decision.decision_kind === "open_scaffold" && inquiry.inquiry_protocol_id) {
          const branchProtocol = pinnedProtocol(this.plan, inquiry.inquiry_protocol_id);
          const entryBeat = branchProtocol?.beats.get(branchProtocol.entry_beat_id);
          const voiceId = `VA-${this.sessionId}-${String(this.nextSequence() + batch.length).padStart(4, "0")}`;
          batch.push({
            event_type: "voice_action_issued",
            payload: {
              action_id: voiceId,
              decision_id: decision.decision_id,
              text: entryBeat?.purpose ?? "我们先把问题理清楚。",
              source: "deterministic-scaffold",
              interruptible: true,
            },
            occurred_at: nowIso(),
            causation_sequence: decisionSequence,
          });
          const ese = buildExternalSupportEvidence({
            session_id: this.sessionId,
            evidence_id: `ESE-${this.sessionId}-${String(this.nextSequence() + batch.length).padStart(4, "0")}`,
            beat: entryBeat ?? this.currentBeat,
            support_kinds: ["orient"],
            initiated_by: "student_requested",
            action_ids: [voiceId],
          });
          if (!ese.ok) throw new Error(`external support evidence failed closed: ${ese.errors.join("; ")}`);
          batch.push({
            event_type: "external_support_recorded",
            payload: ese.payload,
            occurred_at: nowIso(),
            causation_sequence: decisionSequence + 2, // 指向 scaffold narration 的 voice_action_issued（base: decision+0 / opened+1 / voice+2）
          });
        }
        this.inquiryBeatId = inquiry.inquiry_protocol_id
          ? pinnedProtocol(this.plan, inquiry.inquiry_protocol_id)?.entry_beat_id
          : undefined;
      }
      if (decision.decision_kind === "return_to_mainline" && decision.inquiry) {
        batch.push({
          event_type: "inquiry_returned",
          payload: {
            inquiry_id: decision.inquiry.inquiry_id,
            ...(decision.inquiry.inquiry_protocol_id ? { inquiry_protocol_id: decision.inquiry.inquiry_protocol_id } : {}),
            return_beat_id: decision.inquiry.return_beat_id,
            ...(decision.inquiry.inquiry_protocol_id ? {} : { local: true }),
          },
          occurred_at: nowIso(),
          causation_sequence: decisionSequence,
        });
        this.inquiryBeatId = undefined;
      }
      if (decision.decision_kind === "continue_inquiry" && decision.inquiry?.inquiry_protocol_id) {
        this.inquiryBeatId = decision.beat_id;
      }
      if (decision.decision_kind === "complete_beat" && !this.state.completed) {
        // 单 part golden：mainline 末 Beat gate satisfied → complete_beat + 收束事实。
        batch.push({
          event_type: "session_completed",
          payload: { final_beat_id: decision.beat_id, completed_parts: [this.currentBeat.part_id ?? "1"] },
          occurred_at: nowIso(),
        });
      }
      results.push({ revision: currentRevision, intentSequence: item.sequence, decisionSequence, decision });
    }
    if (batch.length) {
      const appended = this.append(currentRevision, batch);
      currentRevision = appended.revision;
    }
    const last = results[results.length - 1];
    return { ...last, revision: currentRevision };
  }

  private decisionEvent(decisionSequence: number, decision: NavigatorDecision, causation: number): PendingV5Event {
    return {
      event_type: "policy_decision_made",
      payload: {
        decision_id: decision.decision_id,
        decision_kind: decision.decision_kind,
        protocol_id: decision.protocol_id,
        beat_id: decision.beat_id,
        ...(decision.to_beat_id !== undefined ? { to_beat_id: decision.to_beat_id } : {}),
        policy_version: decision.policy_version,
        source_event_sequence: decision.source_event_sequence,
        source_state_revision: decision.source_state_revision,
        ...(decision.transition_basis
          ? {
              transition_basis: {
                basis: decision.transition_basis.basis,
                ...(decision.transition_basis.gate_id !== undefined ? { gate_id: decision.transition_basis.gate_id } : {}),
                ...(decision.transition_basis.graph_variant_id !== undefined
                  ? { graph_variant_id: decision.transition_basis.graph_variant_id }
                  : {}),
              },
            }
          : {}),
        ...(decision.inquiry ? { inquiry: { ...decision.inquiry } } : {}),
        // 2026-08-31 R1：session-local LocalInquiryProtocol 六要素随决策事件
        // 持久化（只随 open_inquiry 无 inquiry_protocol_id；canonical payload
        // 同形状 superRefine 在 append 侧强制）。
        ...(decision.local_inquiry_protocol ? { local_inquiry_protocol: decision.local_inquiry_protocol } : {}),
        // 注：v5 policy_decision_made 事件 payload 不含 interpretation_summary
        // （canonical 事件合同封闭字段；结构化假设由 semantic_interpretation_recorded
        // 事实承载）。interpretation_summary 只存在于独立合同
        // ai_teaching_tutor_policy_decision/v1（NavigatorDecision → canonical 包装）。
      } as Record<string, unknown>,
      occurred_at: nowIso(),
      causation_sequence: causation,
      idempotency_key: `${this.sessionId}:decision:${decision.decision_id}`,
    };
  }

  /** G5 对账：在线 state vs 全量重建（F2 semantic comparator，白名单空集）。 */
  assertReplayParity(): ReturnType<TutorSessionKernelV5["assertReplayParity"]> {
    return this.kernelRef.assertReplayParity();
  }
}

// ------------------------------------------------------------------ //
// R3 resume：pinned Plan 逐事件 gate 归属核对（纯函数，只读 committed 流）
// ------------------------------------------------------------------ //

/**
 * 逐事件核对 `gate_evaluated` 的 Gate/Beat 归属（用户授权的第二轮 reducer
 * 边界的 Plan-aware 侧——通用 F2 reducer 不加载 Plan，本函数在 Navigator
 * 重建边界执行）：
 * - 事件时点的 teaching_cursor Beat 必须与 gate_evaluated.beat_id 一致；
 * - gate_id 必须等于该 Beat 在 pinned Plan 的 completion gate（GT-99@BT-01 拒绝）；
 * - satisfied 的 gate 必须携带 evidence_sequence 且指向更早的已提交**学生证据**
 *   事件（student_intent_recorded 作答/确认、student_command completed 回执）——
 *   无对应学生证据的 pass 视为伪造，拒绝恢复。
 * 任一违反 → NavigatorResumeIntegrityError（fail closed，不部分重建）。
 */
export function verifyGateAttributionAgainstPlan(
  plan: NavigatorPlanV5,
  resources: readonly PlanResourceV4[],
  events: readonly StoredV5Event[],
): void {
  if (events.length === 0) return;
  let state = initialStateFromSessionStarted(events[0]);
  const evidenceBySequence = new Map<number, StoredV5Event>();
  for (const event of events) {
    if (event.event_type === "student_intent_recorded" || event.event_type === "action_outcome_recorded") {
      evidenceBySequence.set(event.sequence, event);
    }
  }
  for (const event of events.slice(1)) {
    if (event.event_type === "gate_evaluated") {
      const gate = event.payload as unknown as { gate_id: string; beat_id: string; satisfied: boolean; evidence_sequence?: number };
      const cursor = state.teaching_cursor;
      const protocol = pinnedProtocol(plan, cursor.protocol_id);
      const beat = protocol?.beats.get(cursor.beat_id);
      if (!protocol || !beat) {
        throw new NavigatorResumeIntegrityError(
          "CURSOR_OUTSIDE_PINNED_PLAN",
          `sequence ${event.sequence}: teaching cursor ${cursor.protocol_id}/${cursor.beat_id} is outside the pinned plan at gate_evaluated ${gate.gate_id}@${gate.beat_id}`,
          event.sequence,
        );
      }
      if (gate.beat_id !== cursor.beat_id) {
        throw new NavigatorResumeIntegrityError(
          "GATE_BEAT_MISMATCH",
          `sequence ${event.sequence}: gate_evaluated ${gate.gate_id}@${gate.beat_id} does not match the teaching cursor beat ${cursor.beat_id} (forged or stale gate event; resume refused)`,
          event.sequence,
        );
      }
      const boundGateId = beat.completion_evidence.gate?.gate_id;
      if (gate.gate_id !== boundGateId) {
        throw new NavigatorResumeIntegrityError(
          "PLAN_GATE_BINDING_MISMATCH",
          `sequence ${event.sequence}: gate_evaluated ${gate.gate_id}@${gate.beat_id} is not the completion gate bound to the beat in the pinned plan (${String(boundGateId)}); forged gate attribution, resume refused`,
          event.sequence,
        );
      }
      if (gate.satisfied) {
        const evidenceKind = beat.completion_evidence.evidence_kind;
        const requiresStudentEvidence =
          evidenceKind === "student_answer" || evidenceKind === "student_confirmation" ||
          evidenceKind === "workspace_command" || evidenceKind === "explicit_gate_pass";
        if (requiresStudentEvidence) {
          const evidence = gate.evidence_sequence !== undefined ? evidenceBySequence.get(gate.evidence_sequence) : undefined;
          if (!evidence || evidence.sequence >= event.sequence) {
            throw new NavigatorResumeIntegrityError(
              "GATE_EVIDENCE_FORGED",
              `sequence ${event.sequence}: satisfied gate ${gate.gate_id}@${gate.beat_id} has no earlier committed student-evidence event at evidence_sequence=${String(gate.evidence_sequence)}; forged pass, resume refused`,
              event.sequence,
            );
          }
          if (!isStudentEvidenceEvent(evidence, evidenceKind)) {
            throw new NavigatorResumeIntegrityError(
              "GATE_EVIDENCE_FORGED",
              `sequence ${event.sequence}: satisfied gate ${gate.gate_id}@${gate.beat_id} evidence_sequence=${String(gate.evidence_sequence)} points at ${evidence.event_type} which is not admissible student evidence for evidence_kind=${evidenceKind}; forged pass, resume refused`,
              event.sequence,
            );
          }
          if (evidenceKind === "workspace_command") {
            // F7 replay 对账（因果链 2）：satisfied 的 workspace gate 必须能由
            // pinned ActionTemplate + committed command payload + 同一 typed
            // evaluator 重新复算为 verified-correct——在线安全且恢复安全（伪造
            // satisfied/值不符 → fail closed）。
            const recheck = reAdjudicateWorkspaceGate(events, resources, beat, evidence.sequence);
            if (recheck !== undefined) {
              throw new NavigatorResumeIntegrityError(
                "GATE_EVIDENCE_FORGED",
                `sequence ${event.sequence}: satisfied workspace gate ${gate.gate_id}@${gate.beat_id} fails replay re-adjudication (${recheck}); committed values do not verify against the pinned action template, resume refused`,
                event.sequence,
              );
            }
          }
        }
      }
    }
    state = applyV5Event(state, event);
  }
}

/**
 * F7 replay 对账：定位回执对应的 committed command 载荷，用 pinned template +
 * 同一 typed evaluator 复算。返回 undefined=verified-correct；否则返回错误描述。
 */
function reAdjudicateWorkspaceGate(
  events: readonly StoredV5Event[],
  resources: readonly PlanResourceV4[],
  beat: NavigatorBeatView,
  receiptSequence: number,
): string | undefined {
  const receipt = events.find((event) => event.sequence === receiptSequence);
  const commandId = receipt ? (receipt.payload as { action_id?: string }).action_id : undefined;
  if (typeof commandId !== "string") return "receipt carries no command id";
  let command: { target_ids?: string[]; params?: { values?: Record<string, unknown> } } | undefined;
  for (const event of events) {
    if (event.event_type !== "student_intent_recorded") continue;
    const candidate = (event.payload as { workspace_command?: { command_id?: string } }).workspace_command;
    if (candidate && candidate.command_id === commandId) {
      command = candidate as { target_ids?: string[]; params?: { values?: Record<string, unknown> } };
      break;
    }
  }
  if (!command) return "no committed command payload for the receipt";
  const resolved = resolveBeatActionTemplate(resources, beat);
  if (!resolved) return "no pinned action template bound to the beat";
  const diagnosis = adjudicateCommandPayload(resolved.template, { target_ids: command.target_ids ?? [], params: command.params });
  return diagnosis.accepted ? undefined : "committed values do not verify against teachingInput";
}

/** evidence_kind 对应的可采信学生证据事件（plan-aware，非字符串裁决）。 */
function isStudentEvidenceEvent(event: StoredV5Event, evidenceKind: string): boolean {
  if (event.event_type === "student_intent_recorded") {
    const intentKind = (event.payload as { intent_kind: string }).intent_kind;
    if (evidenceKind === "student_answer") return intentKind === "submit_answer";
    if (evidenceKind === "student_confirmation" || evidenceKind === "explicit_gate_pass") {
      return intentKind === "confirm" || intentKind === "continue" || intentKind === "return_to_mainline";
    }
    return false;
  }
  if (event.event_type === "action_outcome_recorded" && evidenceKind === "workspace_command") {
    const outcome = event.payload as { action_kind: string; outcome: string };
    return outcome.action_kind === "student_command" && outcome.outcome === "completed";
  }
  return false;
}

/**
 * 从 committed 流重建 inquiryBeatId（与 commitDecisions 的内存推进同口径）。
 * F7 Step 3 起导出：NavigatorSessionV6 resume 复用同一重建（事件形状同 v5）。
 */
export function reconstructInquiryBeatId(events: readonly StoredV5Event[]): string | undefined {
  let inquiryBeatId: string | undefined;
  for (const event of events) {
    if (event.event_type !== "policy_decision_made") continue;
    const payload = event.payload as {
      decision_kind?: string;
      beat_id?: string;
      inquiry?: { inquiry_protocol_id?: string };
    };
    if (payload.decision_kind === "open_inquiry" || payload.decision_kind === "open_scaffold") {
      // 打开时内存态=协议 entry beat；事件不含该 id，置 undefined 由 currentBeat
      // getter 以 pinned protocol entry_beat_id 兜底（同一语义）。
      inquiryBeatId = undefined;
    } else if (payload.decision_kind === "continue_inquiry" && payload.inquiry?.inquiry_protocol_id) {
      inquiryBeatId = payload.beat_id;
    } else if (payload.decision_kind === "return_to_mainline") {
      inquiryBeatId = undefined;
    }
  }
  return inquiryBeatId;
}

/** 同 client_request_id 的已提交轮次（幂等重试读取）。 */
function findCommittedTurn(events: readonly StoredV5Event[], clientRequestId: string): {
  revision: number;
  intentSequence: number;
  interpretationSequence?: number;
  gateSequence?: number;
  decisionSequence?: number;
  decision?: NavigatorDecision;
  failure?: { failure_class: string; message: string };
} | undefined {
  let intentSequence: number | undefined;
  let interpretationSequence: number | undefined;
  let gateSequence: number | undefined;
  let decisionSequence: number | undefined;
  let decision: NavigatorDecision | undefined;
  let failure: { failure_class: string; message: string } | undefined;
  let revision = 1;
  for (const event of events) {
    revision = Math.max(revision, event.state_revision);
    if (event.event_type === "student_intent_recorded") {
      const payload = event.payload as { client_request_id?: string };
      if (payload.client_request_id === clientRequestId) intentSequence = event.sequence;
      continue;
    }
    if (intentSequence === undefined) continue;
    // 本轮 trigger 序列集：intent 本身 / 由其引发的 interpretation 与 gate 事件
    //（decision.source_event_sequence 指向触发它的 trigger 序列）。
    const turnSequences = new Set<number>([intentSequence]);
    if (interpretationSequence !== undefined) turnSequences.add(interpretationSequence);
    if (gateSequence !== undefined) turnSequences.add(gateSequence);
    if (event.event_type === "semantic_interpretation_recorded" && event.causation_sequence === intentSequence) {
      interpretationSequence = event.sequence;
    } else if (event.event_type === "gate_evaluated" && event.causation_sequence === intentSequence) {
      gateSequence = event.sequence;
    } else if (event.event_type === "policy_decision_made") {
      const payload = event.payload as { source_event_sequence?: number };
      if (payload.source_event_sequence !== undefined && turnSequences.has(payload.source_event_sequence)) {
        decisionSequence = event.sequence;
        decision = event.payload as unknown as NavigatorDecision;
      }
    } else if (event.event_type === "policy_failed" && turnSequences.has(event.causation_sequence ?? -1) && decisionSequence === undefined) {
      const payload = event.payload as { failure_class?: string };
      failure = { failure_class: payload.failure_class ?? "policy_engine_error", message: "committed policy failure (idempotent replay)" };
    }
  }
  if (intentSequence === undefined) return undefined;
  return {
    revision,
    intentSequence,
    ...(interpretationSequence !== undefined ? { interpretationSequence } : {}),
    ...(gateSequence !== undefined ? { gateSequence } : {}),
    ...(decisionSequence !== undefined ? { decisionSequence } : {}),
    ...(decision !== undefined ? { decision } : {}),
    ...(failure !== undefined ? { failure } : {}),
  };
}

/** policy_failed payload（canonical v5 封闭枚举；内部类经 canonicalPolicyFailureClass 映射）。 */
function policyFailedPayload(failureClass: string): Record<string, unknown> {
  const mapped = canonicalPolicyFailureClass(
    failureClass as Parameters<typeof canonicalPolicyFailureClass>[0],
  );
  return {
    policy_version: NAVIGATOR_V5_VERSION,
    failure_class: mapped.failure_class,
    fallback_used: false,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function isConfirmationIntent(intentKind: IntentKind): boolean {
  return intentKind === "confirm" || intentKind === "continue" || intentKind === "return_to_mainline";
}

function inquiryTriggerFor(decision: NavigatorDecision): string {
  const intent = decision.interpretation_summary?.intent ?? "";
  if (intent.startsWith("request_scaffold")) return "request_scaffold";
  if (intent.startsWith("request_rephrase")) return "request_rephrase";
  if (intent.startsWith("submit_answer")) return "unclear"; // unclear 假设打开的 scaffold 分支
  return "ask_question";
}

function latestDecisionSequence(events: readonly StoredV5Event[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].event_type === "policy_decision_made") return events[index].sequence;
  }
  return undefined;
}

function latestDecisionId(events: readonly StoredV5Event[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].event_type === "policy_decision_made") {
      return (events[index].payload as { decision_id?: string }).decision_id;
    }
  }
  return undefined;
}

function latestIntentSequence(events: readonly StoredV5Event[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].event_type === "student_intent_recorded") return events[index].sequence;
  }
  return undefined;
}

export { MAX_LOCAL_INQUIRY_STEPS, INTERPRETER_V5_VERSION };
