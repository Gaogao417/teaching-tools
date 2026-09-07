/**
 * TutorSessionOrchestratorV5（F6 — 唯一 Orchestrator application service；
 * f6-scope-ledger 输出 5）。
 *
 * 汇合 F4（Approved Plan 供应链）/F5（Navigator）/F3（Workspace Action
 * Runtime）/R3（模型裁决）与 Presenter、统一投影，形成一题可 headless 运行、
 * 可重建、可审计的完整教学闭环。权威效果顺序（计划 §5 F6，任何模块不得越权）：
 *
 * ```text
 * validate session/revision
 *   → classify StudentIntent / append accepted input fact        [F5 acceptStudentIntent]
 *   → Navigator chooses legal decision                           [F5 decideNavigation]
 *   → Presenter realizes selected Beat                           [TutorPresenterV5]
 *   → validate and execute Voice/Workspace actions in order      [本类 + F3 runtime]
 *   → append outcome facts                                       [F2 kernel（真实提交路径）]
 *   → reduce TutorRuntimeState                                   [F2 reducer（同一函数）]
 *   → project StudentWorkspaceView + CoachPanelView + Participation at one revision
 *                                                                [UnifiedViewProjectionV5]
 * ```
 *
 * 编排纪律：
 * - **只编排，不做教学判断**：一切决策经 NavigatorSessionV5（decideNavigation
 *   唯一确定性裁决者）；一切 workspace 校验/效果经 F3 Action Runtime（五重
 *   校验原样生效）；一切投影经同一 reducer/projector（fresh rebuild）；
 * - **唯一写入口**：成功持久 transition 全部经 F2 kernel（store 事务内先纯
 *   折叠后落库）；voice 执行 = issued + outcome 两批真实 append（两批之间
 *   崩溃 = mid-action crash 语义，issued 无 outcome ⇒ 零完成副作用）；
 * - **双 wrapper 缓存一致性**：Navigator 与 Workspace 各持 kernel 缓存；本类
 *   在每个 turn 边界与每次呈现执行后重建两 wrapper（resume——verified rebuild
 *   + catalog pin 对账 + Plan-aware gate 核对，零模型调用），决策输入与投影
 *   只读 fresh rebuild（`rebuildTutorRuntimeStateV5`/`rebuildWorkspaceRuntimeStateV5`
 *   ——在线与重建同一 reducer，结构性满足「online 与 rebuilt 复用同一
 *   reducer/projector」）；
 * - **模型 pin**：start 把组合根注入的 provider/model/prompt/version 写入
 *   `session_started.model_gate_pin`（PRDS-first 合同增补，f6-scope-ledger）；
 *   resume 重算对账，不符 `MODEL_PIN_MISMATCH` fail closed（零事件追加）；
 *   replay/rebuild 不重新调模型（resume 零模型调用，R3 保证）；
 * - **失败分类**（六类分开记录/投影，非 message 前缀长期分类）：student
 *   incorrect（gate_evaluated satisfied=false 的学生证据语义）/ model+runtime
 *   failure（runtime_failure 事实）/ policy failure（policy_failed 事实）/
 *   Gate binding+integrity failure（R3 前缀偏差继承登记）/ presentation+action
 *   failure（presentation_failed 事实，canonical 五类枚举）/ revision+conflict
 *   failure（runtime_failure.revision_conflict）。已成功 action 不伪回滚
 *   （presentation_failed.completed_action_ids 如实携带）；
 * - **Assessment 隔离**（f3-scope-ledger 登记门禁的 F6 落实）：独立 start 入口
 *   （assessment=true：catalog locked + Presenter 教学工具禁用 + 教学类 intent
 *   边界拒绝——零事实、零 scaffold、零 reveal、零暗示性 workspace action；
 *   Assessment failure 不误记 student incorrect）。
 */
import { importApprovedPlanV5, type ImportedApprovedPlanV5 } from "../planBuild/v5/ImportApprovedPlanV5";
import {
  rebuildTutorRuntimeStateV5,
  type RebuildV5Options,
} from "../tutorSession/RuntimeStateRebuilderV5";
import { readTutorSessionEventsV5, type StartTutorSessionV5Input } from "../tutorSession/TutorSessionEventStoreV5";
import { TutorSessionEventStoreV5Error, type PendingV5Event, type StoredV5Event } from "../tutorSession/TutorSessionEventV5";
import { rebuildWorkspaceRuntimeStateV5 } from "../tutorSession/WorkspaceStateRebuilderV5";
import {
  WorkspaceSessionRuntimeV5,
  type WorkspaceExecutionReceipt,
} from "../tutorSession/WorkspaceSessionRuntimeV5";
import { workspaceCatalogPin } from "../tutorSession/WorkspacePresentationCatalogV5";
import { NavigatorSessionV5, type StudentIntentInput, type TurnResult } from "../tutorNavigator/NavigatorSessionV5";
import type { GateAdjudicationProvider } from "../tutorNavigator/ModelGateAdjudicatorV5";
import type { NavigatorDecision } from "../tutorNavigator/TutorNavigatorV5";
import type { V5ModelGatePin } from "./StructuredModelGateProvider";
import { buildGoldenWorkspaceCatalogV5, GOLDEN_CATALOG_TASK_ID, type GoldenWorkspaceCatalog } from "./GoldenWorkspaceCatalog";
import {
  adjudicateActionEvidence,
  adjudicateCommandPayload,
  evidenceToWorkspaceCommand,
  resolveBeatActionTemplate,
} from "./WorkspaceActionAdjudication";
import type { WorkspaceGateAssessmentInput } from "../tutorNavigator/GateEvidenceEvaluatorV5";
import type { ActionEvaluationResponse, AuthoredActionTemplate } from "../../../../shared/actionRuntime";
import type { TypedActionDiagnosis } from "../actionRuntime/topicTypedEvaluator";
import { projectActiveAction, type ActiveAction, type ProjectedActionContract } from "./ActiveActionProjector";
import { realizePresentationPlanV5, TutorPresenterError, type PresentationPlanV5 } from "./TutorPresenterV5";
import {
  projectUnifiedViews,
  type UnifiedProjection,
  type F6FailureCategory,
} from "./UnifiedViewProjectionV5";

export const ORCHESTRATOR_V5_VERSION = "tutor-session-orchestrator/v5";

/** 生产组合根显式注入的模型裁决配置（provider + session pin 声明）。 */
export interface OrchestratorModelInput {
  readonly provider: GateAdjudicationProvider;
  readonly pin: V5ModelGatePin;
}

export interface OrchestratorStartInput {
  readonly sessionId: string;
  readonly studentId: string;
  readonly canonicalRoot: string;
  readonly tpId?: string;
  readonly taskId?: string;
  readonly scenarioId?: string;
  readonly model: OrchestratorModelInput;
  readonly modelTimeoutMs?: number;
  /** Assessment 独立入口（显式模式：locked catalog + 教学工具禁用）。 */
  readonly assessment?: boolean;
}

export interface OrchestratorResumeInput {
  readonly sessionId: string;
  readonly canonicalRoot: string;
  readonly tpId?: string;
  readonly model: OrchestratorModelInput;
  readonly modelTimeoutMs?: number;
}

export interface TurnExecutionOptions {
  /** 调用方声明的期望 session revision（stale → revision_conflict failure 事实）。 */
  readonly expectedRevision?: number;
}

/** 单个呈现动作的执行回执（因果引用完整：action→decision→Beat→outcome→revision）。 */
export interface ActionExecutionReceipt {
  readonly kind: "voice" | "workspace";
  readonly actionId: string;
  readonly decisionId: string;
  readonly beatId: string;
  readonly outcome: "completed" | "rejected" | "interrupted" | "failed";
  readonly issuedSequence?: number;
  readonly outcomeSequence?: number;
  readonly resultingRevision?: number;
  readonly reason?: string;
}

export interface PresentationExecutionReport {
  readonly plan: PresentationPlanV5;
  readonly decisionSequence: number;
  readonly receipts: readonly ActionExecutionReceipt[];
  /** 执行中首个失败（含 partial：已成功 receipts 保留，不伪回滚）。 */
  readonly failure?: { failure_class: string; message: string; completed_action_ids: string[] };
  readonly presentationFailedSequence?: number;
}

export interface OrchestratorTurn {
  readonly revision: number;
  readonly turn: TurnResult;
  readonly presentations: readonly PresentationExecutionReport[];
  readonly projection: UnifiedProjection;
}

export type OrchestratorErrorCode =
  | "MODEL_PIN_MISMATCH"
  | "PLAN_IMPORT_FAILED"
  | "ASSESSMENT_INTENT_FORBIDDEN"
  | "WORKSPACE_COMMAND_REQUIRED"
  | "NO_EXECUTABLE_DECISION"
  | "WORKSPACE_COMMAND_PAYLOAD_DRIFT"
  | "WORKSPACE_COMMAND_UNRESOLVABLE"
  | "NO_ACTIVE_ACTION";

export class OrchestratorError extends Error {
  constructor(readonly code: OrchestratorErrorCode, message: string) {
    super(message);
    this.name = "OrchestratorError";
  }
}

const nowIso = (): string => new Date().toISOString();

export class TutorSessionOrchestratorV5 {
  readonly sessionId: string;
  readonly assessmentMode: boolean;
  private readonly canonicalRoot: string;
  private readonly tpId: string;
  private readonly pinnedTaskId: string;
  private readonly scenarioId: string;
  private readonly model: OrchestratorModelInput;
  private readonly modelTimeoutMs: number | undefined;
  private readonly imported: ImportedApprovedPlanV5;
  private readonly golden: GoldenWorkspaceCatalog;
  private navigator: NavigatorSessionV5;
  private workspace: WorkspaceSessionRuntimeV5;

  private constructor(fields: {
    sessionId: string;
    canonicalRoot: string;
    tpId: string;
    taskId: string;
    scenarioId: string;
    assessment: boolean;
    model: OrchestratorModelInput;
    modelTimeoutMs: number | undefined;
    imported: ImportedApprovedPlanV5;
    golden: GoldenWorkspaceCatalog;
    navigator: NavigatorSessionV5;
    workspace: WorkspaceSessionRuntimeV5;
  }) {
    this.sessionId = fields.sessionId;
    this.assessmentMode = fields.assessment;
    this.canonicalRoot = fields.canonicalRoot;
    this.tpId = fields.tpId;
    this.pinnedTaskId = fields.taskId;
    this.scenarioId = fields.scenarioId;
    this.model = fields.model;
    this.modelTimeoutMs = fields.modelTimeoutMs;
    this.imported = fields.imported;
    this.golden = fields.golden;
    this.navigator = fields.navigator;
    this.workspace = fields.workspace;
  }

  // ------------------------------------------------------------------ //
  // start / resume
  // ------------------------------------------------------------------ //

  /**
   * 启动完整教学会话：F4 importer 真实 Approved 链 → golden catalog（服务端
   * 计算）+ model pin 原子写入 session_started（经 NavigatorSession.start →
   * F2 kernel.start）→ 起步 execute_beat 决策 → 初始 Beat 呈现。
   */
  static start(input: OrchestratorStartInput): TutorSessionOrchestratorV5 {
    const imported = importApprovedPlanV5({ canonicalRoot: input.canonicalRoot, anchored: true }, input.tpId ?? "TP-SMV-009");
    if (!imported.ok) {
      throw new OrchestratorError("PLAN_IMPORT_FAILED", `approved plan import failed (fail closed): ${imported.errors.join("; ")}`);
    }
    const golden = buildGoldenWorkspaceCatalogV5(imported.imported);
    const catalog = input.assessment
      ? { ...golden.catalog, initialInteractionMode: "locked" as const }
      : golden.catalog;
    const navigator = NavigatorSessionV5.start({
      sessionId: input.sessionId,
      studentId: input.studentId,
      canonicalRoot: input.canonicalRoot,
      tpId: input.tpId,
      taskId: input.taskId,
      scenarioId: input.scenarioId,
      gateProvider: input.model.provider,
      modelTimeoutMs: input.modelTimeoutMs,
      sessionStartedPins: {
        workspace_catalog_pin: workspaceCatalogPin(catalog),
        model_gate_pin: input.model.pin,
      },
    });
    const workspace = WorkspaceSessionRuntimeV5.resume(input.sessionId, catalog);
    const orchestrator = new TutorSessionOrchestratorV5({
      sessionId: input.sessionId,
      canonicalRoot: input.canonicalRoot,
      tpId: input.tpId ?? "TP-SMV-009",
      taskId: input.taskId ?? "goldenMinhangFold2020",
      scenarioId: input.scenarioId ?? "golden-similarity-mvp-001:QT-SMV-001",
      assessment: input.assessment === true,
      model: input.model,
      modelTimeoutMs: input.modelTimeoutMs,
      imported: imported.imported,
      golden: { ...golden, catalog },
      navigator,
      workspace,
    });
    // 初始 Beat 呈现（session_start 的 execute_beat 决策 → Presenter → 执行）。
    orchestrator.presentCurrentBeat();
    return orchestrator;
  }

  /**
   * 恢复（refresh/reconnect/replay）：verified rebuild + catalog pin + model pin
   * + Plan-aware gate 归属全对账；**零模型调用**（R3：replay 不重新调模型）。
   * pin 不符 fail closed（零事件追加）。
   *
   * F6.1（P1-1 修复）：catalog 形态与 assessment 模式**由 committed 事实恢复**——
   * `session_started.workspace_catalog_pin` 是 start 时 pin 的 catalog hash；
   * assessment 会话 pin 的是 locked 变体（`initialInteractionMode:"locked"`，
   * digest 含该字段 → 两形态 hash 必不相同）。resume 枚举服务端可构造的两种
   * 形态并对账唯一匹配：匹配 locked → `assessmentMode=true` 并以 locked catalog
   * 重建；匹配 construction → 常规恢复；两者皆不匹配 → 以 construction 交给
   * F3 catalog pin 对账 fail closed（HASH_MISMATCH，零事件）。不新增跨仓字段：
   * committed pin 已足以表达「当时 pin 的 catalog 形态」（验收复核 §6.1 授权的
   * 「现有事实已足够表达」路线，避免合同变更）。
   */
  static resume(input: OrchestratorResumeInput): TutorSessionOrchestratorV5 {
    const imported = importApprovedPlanV5({ canonicalRoot: input.canonicalRoot, anchored: true }, input.tpId ?? "TP-SMV-009");
    if (!imported.ok) {
      throw new OrchestratorError("PLAN_IMPORT_FAILED", `approved plan import failed (fail closed): ${imported.errors.join("; ")}`);
    }
    const golden = buildGoldenWorkspaceCatalogV5(imported.imported);
    const events = readTutorSessionEventsV5(input.sessionId);
    if (events.length === 0) {
      throw new OrchestratorError("PLAN_IMPORT_FAILED", `session ${input.sessionId} has no committed stream`);
    }
    const started = events[0].payload as {
      task_id?: string;
      scenario_id?: string;
      model_gate_pin?: V5ModelGatePin;
      workspace_catalog_pin?: { content_hash?: string };
    };
    // model pin 对账（实现级边界：不符即拒，与 catalog pin 对账同型）。
    const expected = input.model.pin;
    const actual = started.model_gate_pin;
    if (!actual || actual.provider !== expected.provider || actual.model_id !== expected.model_id
      || actual.prompt_version !== expected.prompt_version || actual.adjudicator_version !== expected.adjudicator_version) {
      throw new OrchestratorError(
        "MODEL_PIN_MISMATCH",
        `session ${input.sessionId} model_gate_pin mismatch: stream=${JSON.stringify(actual)} vs resumed provider=${JSON.stringify(expected)} (fail closed; zero events appended)`,
      );
    }
    // catalog 形态对账：committed pin 唯一匹配 → 恢复当时 pin 的 catalog 与
    // assessment 模式（教学工具禁用边界随模式恢复；不得硬编码 false）。
    const assessmentCatalog = { ...golden.catalog, initialInteractionMode: "locked" as const };
    const constructionHash = workspaceCatalogPin(golden.catalog).content_hash;
    const assessmentHash = workspaceCatalogPin(assessmentCatalog).content_hash;
    const streamCatalogHash = started.workspace_catalog_pin?.content_hash;
    const assessment = streamCatalogHash !== undefined && streamCatalogHash === assessmentHash && assessmentHash !== constructionHash;
    const catalog = assessment ? assessmentCatalog : golden.catalog;
    const navigator = NavigatorSessionV5.resume({
      sessionId: input.sessionId,
      canonicalRoot: input.canonicalRoot,
      tpId: input.tpId,
      gateProvider: input.model.provider,
      modelTimeoutMs: input.modelTimeoutMs,
    });
    const workspace = WorkspaceSessionRuntimeV5.resume(input.sessionId, catalog);
    return new TutorSessionOrchestratorV5({
      sessionId: input.sessionId,
      canonicalRoot: input.canonicalRoot,
      tpId: input.tpId ?? "TP-SMV-009",
      taskId: started.task_id ?? GOLDEN_CATALOG_TASK_ID,
      scenarioId: started.scenario_id ?? "golden-similarity-mvp-001:QT-SMV-001",
      assessment,
      model: input.model,
      modelTimeoutMs: input.modelTimeoutMs,
      imported: imported.imported,
      golden: { ...golden, catalog },
      navigator,
      workspace,
    });
  }

  // ------------------------------------------------------------------ //
  // 只读视图
  // ------------------------------------------------------------------ //

  get plan(): NavigatorSessionV5["plan"] {
    return this.navigator.plan;
  }

  /**
   * 会话 pin 的 task id（F7 Step 2：start 显式传入；resume 只读
   * session_started.task_id——路由层据此解析题面，禁止读 allowlist 第一项）。
   */
  get taskId(): string {
    return this.pinnedTaskId;
  }

  get events(): StoredV5Event[] {
    return readTutorSessionEventsV5(this.sessionId);
  }

  get revision(): number {
    return this.navigator.revision;
  }

  /** 教学状态（turn 边界 fresh；turn 内以 projection 的 fresh rebuild 为准）。 */
  get state(): NavigatorSessionV5["state"] {
    return this.navigator.state;
  }

  get catalog(): GoldenWorkspaceCatalog["catalog"] {
    return this.golden.catalog;
  }

  // ------------------------------------------------------------------ //
  // turn 入口（真实提交路径）
  // ------------------------------------------------------------------ //

  /**
   * 学生自然语言/确认输入轮：校验 revision →（barge-in 先关闭 pending voice）
   * → Navigator 裁决（intent 事实→模型→gate→decision 同批原子）→ 呈现执行 →
   * 统一投影。workspace 命令走 submitWorkspaceCommand（不经 Presenter）。
   */
  async submitStudentIntent(input: StudentIntentInput, options: TurnExecutionOptions = {}): Promise<OrchestratorTurn> {
    this.refreshWrappers();
    if (input.intent_kind === "submit_workspace_command") {
      throw new OrchestratorError(
        "WORKSPACE_COMMAND_REQUIRED",
        "workspace commands must enter through submitWorkspaceCommand (student-originated commands never pass the presenter; plan §3.3)",
      );
    }
    if (this.assessmentMode && (input.intent_kind === "ask_question" || input.intent_kind === "request_scaffold" || input.intent_kind === "request_rephrase")) {
      // Assessment 隔离：教学工具类 intent 边界拒绝——零事实、零 scaffold 打开、
      // 不误记 student incorrect（拒绝发生在输入成为事实之前）。
      throw new OrchestratorError(
        "ASSESSMENT_INTENT_FORBIDDEN",
        `assessment mode forbids teaching-tool intent ${input.intent_kind} (zero facts, no scaffold, no reveal)`,
      );
    }
    const conflict = this.checkExpectedRevision(options.expectedRevision);
    if (conflict) {
      return conflict;
    }
    if (input.intent_kind === "barge_in") {
      this.interruptPendingVoice();
    }
    const eventsBeforeTurn = this.events.length;
    const turn = await this.navigator.acceptStudentIntent(input);
    // 幂等重放判定：返回的 decisionSequence 指向本轮开始前已提交的事件
    // （同 client_request_id 读已提交判断）——不重复裁决、不重复呈现。
    const idempotentReplay =
      turn.decisionSequence !== undefined && turn.decisionSequence <= eventsBeforeTurn;
    const presentations = idempotentReplay ? [] : this.presentAfterDecision(turn);
    this.refreshWrappers();
    return {
      revision: this.navigator.revision,
      turn,
      presentations,
      projection: this.projectUnifiedViews(),
    };
  }

  /**
   * 学生 workspace 命令轮：真实 F3 `executeStudentCommand`（canonical+capability+
   * target/mode/truth/stale/幂等全部校验，intent+outcome 经 kernel 真实提交）
   * → Navigator `consumeWorkspaceCommandOutcome` 消费已提交回执（R1 硬边界：
   * Navigator 永不自报 outcome）→ 呈现执行 → 统一投影。
   *
   * F6.1（P1-2 修复）幂等重试语义（同 `client_command_id` 已提交，F3 返回
   * `duplicate`）：一律按 client_command_id 解析到**已提交事实**（重试携带的
   * 新 `command_id` 不得用于查旧事实）——
   * - 载荷漂移（surface/capability/target_ids/params 与 committed 命令不一致）
   *   → 显式拒绝 `WORKSPACE_COMMAND_PAYLOAD_DRIFT`（fail closed，零事件）；
   * - committed outcome=completed 且尚未消费（崩溃窗口：F3 两批已提交、消费
   *   未及执行）→ 现在消费，与首次提交同一效果、恰好一次；
   * - 其余（已消费 / 先前 outcome=rejected——首次提交本就不消费回执）→
   *   幂等回放：零新事件、零呈现、返回 committed 决策（若有）。
   */
  /**
   * F7 因果链 2（统一 adjudication）：当前 Beat 的 gate 为 workspace_command 且
   * pinned plan 解析出 ActionTemplate 时，对 command payload 跑同一 typed
   * evaluator，产出 Gate 消费的 assessment。直接命令（绕过 action-evidence
   * 端点）由此与结构化 evidence 走同一判定——completed 但数学错误是合法组合
   * （痕迹保留、gate 不满足）。非 action-bound Beat 返回 undefined（原有行为）。
   */
  private adjudicateIfActionBound(
    command: unknown,
    commandId: string,
  ): { assessment: WorkspaceGateAssessmentInput } | undefined {
    const beat = this.navigator.currentBeat;
    if (beat.completion_evidence.evidence_kind !== "workspace_command") return undefined;
    const resolved = resolveBeatActionTemplate(this.imported.plan.resources, beat);
    if (!resolved) return undefined;
    const body = command as { target_ids?: string[]; params?: { values?: Record<string, unknown> } };
    const receiptSequence = findReceiptSequence(this.events, commandId);
    if (receiptSequence === undefined) return undefined;
    const diagnosis = adjudicateCommandPayload(resolved.template, {
      target_ids: body.target_ids ?? [],
      params: body.params,
    });
    return { assessment: {
      verdict: diagnosis.accepted ? "verified-correct" : "verified-wrong",
      evidence_sequence: receiptSequence,
      ...(diagnosis.accepted ? {} : { diagnosis: undefined }),
    } };
  }

  /**
   * F7 Step 5（方案 A）：structured action evidence 提交——服务端先以 pinned
   * template 走既有 typed evaluator：
   * - rejected：暂态模式（因果链 3）——零事件、零命令、零 gate、零呈现，真实
   *   diagnosis 随 ActionEvaluationResponse 返回（错误高亮留在 ActionRuntime）；
   * - accepted：evidence 确定性转 StudentWorkspaceCommand（值键短名化）→ F3 →
   *   committed receipt → verified assessment → Gate/Navigator → 最新 views。
   */
  submitActionEvidence(
    evidence: { actionId: string; sourceStepId: string; kind: string; version: number; values?: Record<string, string> },
    options: TurnExecutionOptions & { clientCommandId: string } = { clientCommandId: "" },
  ): ActionEvidenceSubmission {
    this.refreshWrappers();
    const beat = this.navigator.currentBeat;
    const resolved = resolveBeatActionTemplate(this.imported.plan.resources, beat);
    if (!resolved) {
      throw new OrchestratorError("NO_ACTIVE_ACTION", `beat ${beat.beat_id} has no pinned action_template (nothing to evaluate evidence against)`);
    }
    const conflict = this.checkExpectedRevision(options.expectedRevision);
    if (conflict) {
      return { status: "revision-conflict", turn: conflict.turn, presentations: [], projection: this.projectUnifiedViews(), revision: conflict.revision, evaluation: conflictEvaluation() };
    }
    const diagnosis = adjudicateActionEvidence(resolved.template, evidence as never);
    if (!diagnosis.accepted) {
      // 暂态模式：零事件（无 committed causation → 不呈现、不入流）。
      return {
        status: "evidence-rejected",
        turn: { revision: this.navigator.revision, intentSequence: this.navigator.revision },
        presentations: [],
        projection: this.projectUnifiedViews(),
        revision: this.navigator.revision,
        evaluation: rejectedEvaluation(resolved.template, diagnosis),
      };
    }
    const workspaceRevision = rebuildWorkspaceRuntimeStateV5(this.sessionId, this.golden.catalog).state.revision;
    const command = evidenceToWorkspaceCommand({
      sessionId: this.sessionId,
      commandId: `SC-${this.sessionId}-EV-${Date.now().toString(36)}`,
      clientCommandId: options.clientCommandId,
      expectedWorkspaceRevision: workspaceRevision,
      template: resolved.template,
      evidence: evidence as never,
    });
    const result = this.submitWorkspaceCommand(command, { expectedRevision: options.expectedRevision });
    return {
      status: result.turn.failure ? "command-rejected" : "workspace-committed",
      turn: result.turn,
      presentations: result.presentations,
      projection: result.projection,
      revision: result.revision,
      evaluation: acceptedEvaluation(resolved.template, result),
    };
  }

  submitWorkspaceCommand(command: unknown, options: TurnExecutionOptions = {}): OrchestratorTurn {
    this.refreshWrappers();
    const conflict = this.checkExpectedRevision(options.expectedRevision);
    if (conflict) {
      return conflict;
    }
    const receipt: WorkspaceExecutionReceipt = this.workspace.executeStudentCommand(command);
    if (receipt.status === "duplicate") {
      return this.replayCommittedStudentCommand(command);
    }
    if (receipt.status === "completed") {
      const commandId = (command as { command_id?: string }).command_id;
      if (typeof commandId === "string") {
        const turn = this.navigator.consumeWorkspaceCommandOutcome({
          command_id: commandId,
          ...(this.adjudicateIfActionBound(command, commandId) ?? {}),
        });
        const presentations = this.presentAfterDecision(turn);
        this.refreshWrappers();
        return { revision: this.navigator.revision, turn, presentations, projection: this.projectUnifiedViews() };
      }
    }
    // rejected / incomplete：命令侧已有事实（rejected 的 intent+outcome 或前次
    // crash 的 incomplete），投影如实呈现，不误记 student incorrect。
    this.refreshWrappers();
    return {
      revision: this.navigator.revision,
      turn: { revision: this.navigator.revision, intentSequence: receipt.appendedSequences[0] ?? this.navigator.revision },
      presentations: [],
      projection: this.projectUnifiedViews(),
    };
  }

  /**
   * 幂等重试/崩溃恢复（F6.1）：duplicate 回执的编排层收口。解析、对账、消费
   * 判定全部只读 committed 事件流——不信任重试载荷里的任何 id。
   */
  private replayCommittedStudentCommand(command: unknown): OrchestratorTurn {
    const clientCommandId = (command as { client_command_id?: unknown }).client_command_id;
    if (typeof clientCommandId !== "string") {
      throw new OrchestratorError(
        "WORKSPACE_COMMAND_UNRESOLVABLE",
        "duplicate workspace command receipt carries no client_command_id (fail closed; nothing to resolve)",
      );
    }
    const committed = findCommittedStudentCommand(this.events, clientCommandId);
    if (!committed || committed.outcomeSequence === undefined || committed.outcome === undefined) {
      throw new OrchestratorError(
        "WORKSPACE_COMMAND_UNRESOLVABLE",
        `duplicate client_command_id=${clientCommandId} has no committed intent+outcome receipt to replay (fail closed; nothing to consume)`,
      );
    }
    // 载荷漂移：同键异载荷显式拒绝（零事件）——语义载荷字段集见 F6.1 remediation
    // 登记（surface/capability/target_ids/params；id 族与 expected_workspace_revision
    // 属每次尝试自然的差异面，不参与漂移判定）。
    const retryPayload = semanticCommandFields(command);
    if (!fieldsDeepEqual(retryPayload, committed.semanticFields)) {
      throw new OrchestratorError(
        "WORKSPACE_COMMAND_PAYLOAD_DRIFT",
        `client_command_id=${clientCommandId} retry payload drifts from the committed command (committed=${JSON.stringify(committed.semanticFields)} vs retry=${JSON.stringify(retryPayload)}); explicit refusal, zero facts (ledger-registered semantics)`,
      );
    }
    // 消费状态：committed outcome 是否已引发下游事实（consume 产出的
    // gate_evaluated 以 outcome sequence 为 causation/evidence）。
    const consumed = this.events.some((event) => event.causation_sequence === committed.outcomeSequence);
    if (!consumed && committed.outcome === "completed") {
      // 崩溃窗口恢复：outcome 已提交、消费未及执行 → 现在恰好消费一次。
      const committedCommand = findCommittedCommandPayload(this.events, committed.commandId);
      const turn = this.navigator.consumeWorkspaceCommandOutcome({
        command_id: committed.commandId,
        ...(committedCommand ? (this.adjudicateIfActionBound(committedCommand, committed.commandId) ?? {}) : {}),
      });
      const presentations = this.presentAfterDecision(turn);
      this.refreshWrappers();
      return { revision: this.navigator.revision, turn, presentations, projection: this.projectUnifiedViews() };
    }
    // 幂等回放：零新事件、零呈现；返回 committed 决策（若有）——与自然语言
    // client_request_id 重试同型（读已提交判断，不重复裁决/呈现）。
    this.refreshWrappers();
    return {
      revision: this.navigator.revision,
      turn: {
        revision: this.navigator.revision,
        intentSequence: committed.intentSequence,
        ...(committed.gateSequence !== undefined ? { gateSequence: committed.gateSequence } : {}),
        ...(committed.decisionSequence !== undefined ? { decisionSequence: committed.decisionSequence } : {}),
        ...(committed.decision !== undefined ? { decision: committed.decision } : {}),
      },
      presentations: [],
      projection: this.projectUnifiedViews(),
    };
  }

  /** timeout / silence 等无输入触发轮（bounded_wait 出边或澄清门禁）。 */
  reportTimeout(): OrchestratorTurn {
    this.refreshWrappers();
    const turn = this.navigator.reportTimeout();
    const presentations = this.presentAfterDecision(turn);
    this.refreshWrappers();
    return { revision: this.navigator.revision, turn, presentations, projection: this.projectUnifiedViews() };
  }

  /**
   * 呈现当前 Beat（对最近一个 execute_beat 决策）：Presenter realize → 顺序执行。
   * 公开（F7/headless 均经此入口；不得绕过直接 kernel.append 动作事件）。
   */
  presentCurrentBeat(options: { through?: number } = {}): PresentationExecutionReport {
    const decisionEntry = latestExecuteBeatDecision(this.events);
    if (!decisionEntry) {
      throw new OrchestratorError("NO_EXECUTABLE_DECISION", `no committed execute_beat decision to present in ${this.sessionId}`);
    }
    return this.realizeAndExecute(decisionEntry.decision, decisionEntry.sequence, options);
  }

  /**
   * barge-in / 恢复语义：关闭 issued-without-outcome 的 pending voice（interrupted
   * ——零完成副作用，G2 六态区分）；后续未 issued 动作自然不产生事实。
   */
  interruptPendingVoice(): number[] {
    const closed: number[] = [];
    const pending = this.events.filter(
      (event) => event.event_type === "voice_action_issued" && !this.hasVoiceOutcome(event),
    );
    for (const issued of pending) {
      const actionId = (issued.payload as { action_id: string }).action_id;
      const [outcomeSequence] = this.appendViaWorkspaceKernel(this.navigator.revision, [
        {
          event_type: "action_outcome_recorded",
          payload: { action_id: actionId, action_kind: "voice", outcome: "interrupted" },
          occurred_at: nowIso(),
          causation_sequence: issued.sequence,
          idempotency_key: `va-outcome:${actionId}`,
        },
      ]);
      closed.push(outcomeSequence);
    }
    if (closed.length > 0) this.refreshWrappers();
    return closed;
  }

  // ------------------------------------------------------------------ //
  // 统一投影（fresh rebuild；online 与 rebuilt 同一 reducer/projector）
  // ------------------------------------------------------------------ //

  /** F7 Step 4/6：当前 Beat 的学生安全 active action（ActiveActionProjector
   *  门面——route 只序列化；非 workspace 拍/构造未 committed 返回 undefined）。 */
  activeAction(promptLatex: string): ActiveAction | undefined {
    const workspaceRebuild = rebuildWorkspaceRuntimeStateV5(this.sessionId, this.golden.catalog);
    return projectActiveAction({
      resources: this.imported.plan.resources,
      actionContracts: (this.imported.projection as { action_contracts?: ProjectedActionContract[] }).action_contracts ?? [],
      beat: this.navigator.currentBeat,
      catalog: this.golden.catalog,
      committedTutorCommands: workspaceRebuild.context.tutorCommands,
      workspaceRevision: workspaceRebuild.state.revision,
      taskId: this.pinnedTaskId,
      promptLatex,
    });
  }

  projectUnifiedViews(): UnifiedProjection {
    const tutorState = rebuildTutorRuntimeStateV5(this.sessionId);
    const workspace = rebuildWorkspaceRuntimeStateV5(this.sessionId, this.golden.catalog);
    return projectUnifiedViews({
      sessionId: this.sessionId,
      tutorState,
      workspaceState: workspace.state,
      events: readTutorSessionEventsV5(this.sessionId),
      plan: this.navigator.plan,
      catalog: this.golden.catalog,
      factEntryIds: this.golden.factEntryIds,
      sessionRevision: this.navigator.revision,
      resources: this.imported.plan.resources,
    });
  }

  // ------------------------------------------------------------------ //
  // 内部：呈现执行与编排
  // ------------------------------------------------------------------ //

  /** 决策后呈现策略：transition → executeCurrentBeat + 呈现；return 后重入的
   *  裸 execute_beat 决策 → presentCurrentBeat（否则主线相位停在 presenting，
   *  学生输入无法推进——F7 偏差登记 D-1 修复）；其余不自动呈现。 */
  private presentAfterDecision(turn: TurnResult): PresentationExecutionReport[] {
    const reports: PresentationExecutionReport[] = [];
    const decision = turn.decision;
    if (!decision) return reports;
    if (decision.decision_kind === "transition_beat" && decision.to_beat_id) {
      // 新 Beat 呈现锚定：executeCurrentBeat（确定性 execute_beat 决策）→ Presenter。
      const executionDecision = this.navigator.executeCurrentBeat();
      if (executionDecision.decision && executionDecision.decisionSequence !== undefined) {
        reports.push(this.realizeAndExecute(executionDecision.decision, executionDecision.decisionSequence, {}));
      }
      return reports;
    }
    if (decision.decision_kind === "execute_beat") {
      // F7 D-1：inquiry 返回后主线相位为 presenting，Navigator 对后续输入先给
      // execute_beat（重执行当前 Beat）——不呈现即卡死。呈现走同一
      // presentCurrentBeat 入口（voice 完成 → awaiting_evidence → 可推进）。
      reports.push(this.presentCurrentBeat());
      return reports;
    }
    if (decision.decision_kind === "return_to_mainline") {
      // F7 D-1（同根）：返回主线即重呈现返回点 Beat——学生回到冻结点立刻
      // 重新获得教学锚定（voice 完成 → awaiting_evidence），无需先再交一次输入。
      reports.push(this.presentCurrentBeat());
      return reports;
    }
    if (decision.decision_kind === "request_clarification") {
      // F7 D-3：明确答错（模型 fail→misaligned）落 request_clarification——
      // 不呈现则 transcript 只剩学生自己的话，老师零回应（headless 旧断言只
      // 覆盖"不推进"，未覆盖"有回应"；浏览器旅程实证暴露）。重呈现当前 Beat
      // 重新锚定（voice=approved 资源或拍目的，不发明反馈文案——逐错反馈属
      // 教研内容工作，登记 F8/R 波）；beat 不推进、gate 不满足语义不变。
      reports.push(this.presentCurrentBeat());
    }
    return reports;
  }

  private realizeAndExecute(
    decision: NavigatorDecision,
    decisionSequence: number,
    options: { through?: number },
  ): PresentationExecutionReport {
    const beat = this.navigator.currentBeat;
    const protocol = this.imported.protocols.get(beat.protocol_id);
    const beatPayload = protocol?.beats.find((candidate) => candidate.beat_id === beat.beat_id);
    const resources = new Map(this.imported.plan.resources.map((resource) => [resource.resource_id, resource]));
    const workspaceRebuild = rebuildWorkspaceRuntimeStateV5(this.sessionId, this.golden.catalog);
    const plan = realizePresentationPlanV5({
      sessionId: this.sessionId,
      decision,
      beat,
      presentationIntent: beatPayload?.presentation_intent,
      resources,
      catalog: this.golden.catalog,
      factEntryIds: this.golden.factEntryIds,
      gateLedger: workspaceRebuild.context.gateLedger,
      hiddenEntryIds: new Set(
        workspaceRebuild.state.solution_board.entries
          .filter((entry) => entry.visibility === "hidden")
          .map((entry) => entry.entry_id),
      ),
      committedElementIds: new Set(workspaceRebuild.state.geometry.committed_element_ids),
      ...(this.assessmentMode ? { assessmentMode: true } : {}),
      actionSerial: this.events.length + 1,
    });
    const report = this.executePresentationPlan(plan, decisionSequence, options);
    this.refreshWrappers();
    return report;
  }

  /**
   * 顺序执行 PresentationPlan（voice plane 先、workspace plane 后——canonical
   * 编排顺序）。部分失败语义：动作校验失败/执行拒绝 ⇒ 停止剩余动作、记
   * `presentation_failed`（canonical 封闭枚举；completed_action_ids 如实携带
   * 已成功动作——不伪回滚）；已 issued 无 outcome 的崩溃窗口由
   * interruptPendingVoice/恢复路径收口。
   */
  executePresentationPlan(
    plan: PresentationPlanV5,
    decisionSequence: number,
    options: { through?: number } = {},
  ): PresentationExecutionReport {
    const receipts: ActionExecutionReceipt[] = [];
    const ordered: Array<{ kind: "voice" | "workspace"; action: PresentationPlanV5["voice_actions"][number] | PresentationPlanV5["workspace_actions"][number] }> = [
      ...plan.voice_actions.map((action) => ({ kind: "voice" as const, action })),
      ...plan.workspace_actions.map((action) => ({ kind: "workspace" as const, action })),
    ];
    const limit = options.through !== undefined ? options.through : ordered.length;
    let stopped = false;
    for (let index = 0; index < Math.min(limit, ordered.length); index += 1) {
      const entry = ordered[index];
      if (stopped) break;
      if (entry.kind === "voice") {
        const action = entry.action as PresentationPlanV5["voice_actions"][number];
        try {
          const voicePayload = {
            action_id: action.action_id,
            decision_id: action.decision_id,
            beat_id: plan.beat_id,
            text: action.text,
            source: action.source,
            ...(action.resource_ref !== undefined ? { resource_ref: action.resource_ref } : {}),
            ...(action.generation_id !== undefined ? { generation_id: action.generation_id } : {}),
            ...(action.interruptible !== undefined ? { interruptible: action.interruptible } : {}),
          };
          const [issuedSequence] = this.appendViaWorkspaceKernel(this.navigator.revision, [
            {
              event_type: "voice_action_issued",
              payload: voicePayload,
              occurred_at: nowIso(),
              causation_sequence: decisionSequence,
              idempotency_key: `va-issued:${action.action_id}`,
            },
          ]);
          const [outcomeSequence] = this.appendViaWorkspaceKernel(this.navigator.revision, [
            {
              event_type: "action_outcome_recorded",
              payload: { action_id: action.action_id, action_kind: "voice", outcome: "completed" },
              occurred_at: nowIso(),
              causation_sequence: issuedSequence,
              idempotency_key: `va-outcome:${action.action_id}`,
            },
          ]);
          receipts.push({
            kind: "voice",
            actionId: action.action_id,
            decisionId: action.decision_id,
            beatId: plan.beat_id,
            outcome: "completed",
            issuedSequence,
            outcomeSequence,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failed = this.recordPresentationFailure(plan, "action_validation_rejected", message, receipts, decisionSequence);
          receipts.push({
            kind: "voice",
            actionId: action.action_id,
            decisionId: action.decision_id,
            beatId: plan.beat_id,
            outcome: "failed",
            reason: message,
          });
          return { plan, decisionSequence, receipts, failure: failed.failure, presentationFailedSequence: failed.sequence };
        }
      } else {
        const action = entry.action as PresentationPlanV5["workspace_actions"][number];
        const canonicalAction = {
          schema: "ai_teaching_workspace_surface_action/v1" as const,
          session_id: this.sessionId,
          ...action,
        };
        const receipt: WorkspaceExecutionReceipt = this.workspace.executePresentation(canonicalAction, decisionSequence);
        if (receipt.status === "rejected" || receipt.status === "incomplete") {
          const reason = receipt.status === "rejected"
            ? receipt.reason ?? "workspace presentation rejected"
            : `incomplete (mid-action crash window): ${receipt.reason ?? ""}`;
          const failed = this.recordPresentationFailure(
            plan,
            receipt.status === "rejected" ? "action_validation_rejected" : "partial_execution",
            reason,
            receipts,
            decisionSequence,
          );
          receipts.push({
            kind: "workspace",
            actionId: action.action_id,
            decisionId: action.decision_id,
            beatId: plan.beat_id,
            outcome: receipt.status === "rejected" ? "rejected" : "failed",
            reason,
          });
          return { plan, decisionSequence, receipts, failure: failed.failure, presentationFailedSequence: failed.sequence };
        }
        receipts.push({
          kind: "workspace",
          actionId: action.action_id,
          decisionId: action.decision_id,
          beatId: plan.beat_id,
          outcome: "completed",
          resultingRevision: receipt.resultingRevision,
        });
      }
    }
    if (options.through !== undefined && limit < ordered.length) {
      // 部分执行（服务端分批/中断窗口模拟）：未执行动作=未 issued=零事实。
      return {
        plan,
        decisionSequence,
        receipts,
        failure: {
          failure_class: "partial_execution",
          message: `executed ${limit}/${ordered.length} actions (remaining actions never issued; zero facts)`,
          completed_action_ids: receipts.filter((receipt) => receipt.outcome === "completed").map((receipt) => receipt.actionId),
        },
      };
    }
    return { plan, decisionSequence, receipts };
  }

  private recordPresentationFailure(
    plan: PresentationPlanV5,
    failureClass: "action_validation_rejected" | "resource_missing" | "provider_failure" | "partial_execution" | "timeout",
    message: string,
    receipts: readonly ActionExecutionReceipt[],
    decisionSequence: number,
  ): { failure: PresentationExecutionReport["failure"]; sequence?: number } {
    const completedActionIds = receipts.filter((receipt) => receipt.outcome === "completed").map((receipt) => receipt.actionId);
    const payload = {
      failure_class: failureClass,
      message,
      decision_id: plan.decision_id,
      ...(completedActionIds.length > 0 ? { completed_action_ids: completedActionIds } : {}),
    };
    try {
      const [sequence] = this.appendViaWorkspaceKernel(this.navigator.revision, [
        { event_type: "presentation_failed", payload, occurred_at: nowIso(), causation_sequence: decisionSequence },
      ]);
      return { failure: { failure_class: failureClass, message, completed_action_ids: completedActionIds }, sequence };
    } catch {
      // presentation_failed 自身落库失败（如流已终态）：返回内存分类，不掩盖原失败。
      return { failure: { failure_class: failureClass, message, completed_action_ids: completedActionIds } };
    }
  }

  /** 经 workspace wrapper 的 F2 kernel 追加（真实提交路径；revision DB-fresh）。 */
  private appendViaWorkspaceKernel(expectedRevision: number, events: PendingV5Event[]): number[] {
    const result = this.workspace.kernel.append(expectedRevision, events);
    return result.appendedSequences;
  }

  private checkExpectedRevision(expectedRevision: number | undefined): OrchestratorTurn | undefined {
    if (expectedRevision === undefined) return undefined;
    const current = this.navigator.revision;
    if (current === expectedRevision) return undefined;
    // stale revision：revision_conflict failure 事实（canonical runtime_failure
    // 封闭枚举）——分类=revision_conflict_failure，零教学决策。
    const [sequence] = this.appendViaWorkspaceKernel(current, [
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
        intentSequence: sequence,
        failure: { failure_class: "revision_conflict", message: `expected revision ${expectedRevision} but session is at ${current}` },
      },
      presentations: [],
      projection: this.projectUnifiedViews(),
    };
  }

  /**
   * 双 wrapper 重建（turn 边界/呈现后）：Navigator resume（verified rebuild +
   * Plan-aware gate 核对，零模型调用）+ Workspace resume（catalog pin 对账）。
   * 决策输入与投影自此只读 fresh 状态。
   */
  private refreshWrappers(): void {
    this.navigator = NavigatorSessionV5.resume({
      sessionId: this.sessionId,
      canonicalRoot: this.canonicalRoot,
      tpId: this.tpId,
      gateProvider: this.model.provider,
      ...(this.modelTimeoutMs !== undefined ? { modelTimeoutMs: this.modelTimeoutMs } : {}),
    });
    this.workspace = WorkspaceSessionRuntimeV5.resume(this.sessionId, this.golden.catalog);
  }

  private hasVoiceOutcome(issued: StoredV5Event): boolean {
    const actionId = (issued.payload as { action_id: string }).action_id;
    return this.events.some(
      (event) =>
        event.event_type === "action_outcome_recorded"
        && (event.payload as { action_id: string; action_kind: string }).action_id === actionId
        && (event.payload as { action_kind: string }).action_kind === "voice",
    );
  }
}

function latestExecuteBeatDecision(
  events: readonly StoredV5Event[],
): { decision: NavigatorDecision; sequence: number } | undefined {
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

/**
 * 幂等重试的语义载荷字段集（F6.1 登记）：参与漂移判定的命令内容面——
 * surface/capability/target_ids/params（committed intent 内嵌 workspace_command
 * 实际携带的语义字段；origin 由学生命令路径结构性保证，不在 committed 形状内，
 * 不参与判定；command_id/client_command_id/expected_workspace_revision 属每次
 * 尝试自然的差异面，亦不参与）。
 */
type SemanticCommandFields = {
  surface: unknown;
  capability: unknown;
  target_ids: unknown;
  params: unknown;
};

function semanticCommandFields(command: unknown): SemanticCommandFields {
  const record = typeof command === "object" && command !== null ? command as Record<string, unknown> : {};
  return {
    surface: record.surface,
    capability: record.capability,
    target_ids: record.target_ids,
    params: record.params,
  };
}

function fieldsDeepEqual(left: SemanticCommandFields, right: SemanticCommandFields): boolean {
  return JSON.stringify(normalizeJsonish(left)) === JSON.stringify(normalizeJsonish(right));
}

/** 键序无关的稳定序列化（对象键排序；数组保序）。 */
function normalizeJsonish(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonish);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, normalizeJsonish(record[key])]),
    );
  }
  return value;
}

/**
 * F6.1（P1-2）：按 `client_command_id` 解析已提交的学生命令事实（唯一 intent +
 * 配对 outcome + 消费产物）。只读 committed 流；重试载荷的任何 id 不参与解析。
 */
function findCommittedStudentCommand(events: readonly StoredV5Event[], clientCommandId: string): {
  commandId: string;
  intentSequence: number;
  semanticFields: SemanticCommandFields;
  outcome?: "completed" | "rejected" | "interrupted" | "failed";
  outcomeSequence?: number;
  gateSequence?: number;
  decisionSequence?: number;
  decision?: NavigatorDecision;
} | undefined {
  let intent: { sequence: number; commandId: string; semanticFields: SemanticCommandFields } | undefined;
  for (const event of events) {
    if (event.event_type !== "student_intent_recorded") continue;
    const command = (event.payload as { workspace_command?: Record<string, unknown> }).workspace_command;
    if (command && command.client_command_id === clientCommandId) {
      // F3 以 client_command_id 幂等去重：同键只可能 committed 一次；防御取最后。
      intent = {
        sequence: event.sequence,
        commandId: String(command.command_id),
        semanticFields: {
          surface: command.surface,
          capability: command.capability,
          target_ids: command.target_ids,
          params: command.params,
        },
      };
    }
  }
  if (!intent) return undefined;
  let outcome: { kind: "completed" | "rejected" | "interrupted" | "failed"; sequence: number } | undefined;
  for (const event of events) {
    if (event.event_type !== "action_outcome_recorded") continue;
    const payload = event.payload as { action_id: string; action_kind: string; outcome: "completed" | "rejected" | "interrupted" | "failed" };
    if (payload.action_id === intent.commandId && payload.action_kind === "student_command") {
      outcome = { kind: payload.outcome, sequence: event.sequence };
    }
  }
  if (!outcome) return { commandId: intent.commandId, intentSequence: intent.sequence, semanticFields: intent.semanticFields };
  // 消费产物（若已消费）：gate_evaluated 以 outcome sequence 为 causation/evidence；
  // 其后的 policy_decision_made 以 gate sequence 为 causation。
  let gateSequence: number | undefined;
  let decisionSequence: number | undefined;
  let decision: NavigatorDecision | undefined;
  for (const event of events) {
    if (gateSequence === undefined && event.event_type === "gate_evaluated" && event.causation_sequence === outcome.sequence) {
      gateSequence = event.sequence;
      continue;
    }
    if (gateSequence !== undefined && decisionSequence === undefined
      && event.event_type === "policy_decision_made" && event.causation_sequence === gateSequence) {
      decisionSequence = event.sequence;
      decision = event.payload as unknown as NavigatorDecision;
    }
  }
  return {
    commandId: intent.commandId,
    intentSequence: intent.sequence,
    semanticFields: intent.semanticFields,
    outcome: outcome.kind,
    outcomeSequence: outcome.sequence,
    ...(gateSequence !== undefined ? { gateSequence } : {}),
    ...(decisionSequence !== undefined ? { decisionSequence } : {}),
    ...(decision !== undefined ? { decision } : {}),
  };
}

export type { UnifiedProjection, F6FailureCategory, StartTutorSessionV5Input, RebuildV5Options, TutorPresenterError };


// ------------------------------------------------------------------ //
// F7 Step 5（方案 A）：action evidence 提交的应用层响应 envelope。
// 字段权威来源（ledger 增补 4/68551a6）：evaluation/outcome/diagnosis 出自
// typed evaluator 真实结果；phase/nextIndex 出自评价后的状态读取；revision/
// views 出自 canonical projector 同 revision 快照；系统失败绝不映射 wrong。
// ------------------------------------------------------------------ //

export interface ActionEvidenceSubmission extends OrchestratorTurn {
  readonly status: "evidence-rejected" | "workspace-committed" | "command-rejected" | "revision-conflict";
  readonly evaluation: ActionEvaluationResponse;
}

function beatOrdinalOf(plan: { beat_order: readonly string[] }, beatId: string): number {
  const index = plan.beat_order.indexOf(beatId);
  return index < 0 ? 0 : index;
}

function rejectedEvaluation(template: AuthoredActionTemplate, diagnosis: TypedActionDiagnosis): ActionEvaluationResponse {
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

function acceptedEvaluation(template: AuthoredActionTemplate, result: OrchestratorTurn): ActionEvaluationResponse {
  const advanced = result.turn.decision?.decision_kind === "transition_beat";
  return {
    outcome: "accepted",
    evaluation: "correct",
    revision: result.revision,
    phase: advanced ? "correct_pause" : "answering",
    nextIndex: 0,
  };
}

function conflictEvaluation(): ActionEvaluationResponse {
  return { outcome: "conflict", evaluation: "progress", revision: 0, phase: "answering", nextIndex: 0 };
}

/** 定位 command 的 committed 回执事件 sequence（assessment.evidence_sequence）。 */
function findReceiptSequence(events: readonly { event_type: string; sequence: number; payload: unknown }[], commandId: string): number | undefined {
  for (const event of events) {
    if (event.event_type !== "action_outcome_recorded") continue;
    const payload = event.payload as { action_id?: string; action_kind?: string };
    if (payload.action_id === commandId && payload.action_kind === "student_command") return event.sequence;
  }
  return undefined;
}

/** 从 committed intent 事件重建命令体（崩溃窗口恢复路径的 adjudication 输入）。 */
function findCommittedCommandPayload(
  events: readonly { event_type: string; sequence: number; payload: unknown }[],
  commandId: string,
): { target_ids?: string[]; params?: { values?: Record<string, unknown> } } | undefined {
  for (const event of events) {
    if (event.event_type !== "student_intent_recorded") continue;
    const command = (event.payload as { workspace_command?: { command_id?: string } }).workspace_command;
    if (command && command.command_id === commandId) {
      return command as { target_ids?: string[]; params?: { values?: Record<string, unknown> } };
    }
  }
  return undefined;
}
