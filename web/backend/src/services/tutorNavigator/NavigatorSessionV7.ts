import type {GenerationCompanion} from '../tutorSession/GenerationCompanionStore';
/**
 * NavigatorSessionV7（F7 Step 4 — V7 Session Kernel 上的 Navigator 会话壳）。
 *
 * NavigatorSessionV6 的 v7 后继：决策引擎零重写（decideNavigation /
 * SemanticInterpreterV5 / GateEvidenceEvaluator / ModelGateAdjudicatorV5 /
 * NavigatorPlanV5 纯模块原样复用）。本类只做会话壳的 v7 适配：
 * - kernel = TutorSessionKernelV7（event_schema='v7'；registryProvider 注入）；
 * - session_started 增必填 session_mode（teaching|assessment——assessment 权限
 *   矩阵在编排层执行，本类只落 mode 事实）；
 * - 语言/控制输入链（ADR-011 决策 6）：先独立批落 `student_input_recorded`
 *   （utterance{channel,text} | control 七值），再同批原子 append
 *   `semantic_interpretation_recorded` + `student_intent_recorded`
 *   （causation→input、同 client_request_id）+（gate）+ decision——v7 起 intent
 *   不承载 submit_workspace_command（canonical 已移除；命令走独立事件）；
 * - 命令链（v7 新增，R1 硬边界保留）：`consumeWorkspaceCommandOutcome` 消费
 *   F3 已提交的 student_workspace_command_recorded + action_outcome_recorded
 *   {student_command} 回执对——本方法不创建/追加任何回执；gate 只消费单一
 *   typed evaluator 产出的 verified assessment（completed ≠ 数学正确）；
 * - 幂等：同 client_request_id 的已提交判断 → 读已 committed 轮返回，零新事件。
 */
import { TutorSessionKernelV10 } from "../tutorSession/TutorSessionKernelV10";
import { readTutorSessionEventsV10, type V10RegistryProvider } from "../tutorSession/RuntimeStateRebuilderV10";
import type { VisualExecutionOwner } from "../../../../shared/canonical";
import type { ImportedApprovedPlanV5 } from "../planBuild/v5/ImportApprovedPlanV5";
import type { PendingV7Event, StoredV7Event, V7StudentInputBody } from "../tutorSession/TutorSessionEventV7";
import { TutorSessionKernelV7 } from "../tutorSession/TutorSessionKernelV7";
import { TutorSessionKernelV9 } from "../tutorSession/TutorSessionKernelV9";
import { readSessionEventSchema, readTutorSessionEventsV9, type V9RegistryProvider } from "../tutorSession/RuntimeStateRebuilderV9";
import type { V7RegistryProvider } from "../tutorSession/RuntimeStateRebuilderV7";
import { readTutorSessionEventsV7 } from "../tutorSession/WorkspaceRuntimeReducerV7";
import { assertIdempotencyKeyShape, composeIdempotencyKey } from "../tutorSession/IdempotencyKey";
import type { TutorRuntimeStateV5 } from "../tutorSession/TutorRuntimeStateReducerV5";
import type { StoredV5Event } from "../tutorSession/TutorSessionEventV5";
import {
  buildSessionStartedPayload,
  pinnedProtocol,
  type NavigatorBeatView,
  type NavigatorPlanV5,
} from "./NavigatorPlanV5";
import {
  hypothesisEventPayload,
  hypothesisFromAdjudication,
  INTERPRETER_V5_VERSION,
  interpretationMatchScore,
  interpretStudentInput,
  isNaturalLanguageInput,
  type IntentKind,
  type NavigatorInterpretation,
} from "./SemanticInterpreterV5";
import { evaluateGateEvidence, type GateEvidenceInput, type WorkspaceGateAssessmentInput } from "./GateEvidenceEvaluatorV5";
import {
  ModelGateAdjudicatorV5,
  UnavailableGateProvider,
  buildGateAdjudicationContext,
  type GateAdjudicationProvider,
} from "./ModelGateAdjudicatorV5";
import {
  NAVIGATOR_V5_VERSION,
  canonicalPolicyFailureClass,
  decideNavigation,
  deriveLocalInquirySteps,
  deriveUnresolvedClarifications,
  type NavigatorContext,
  type NavigatorDecision,
  type NavigatorTrigger,
} from "./TutorNavigatorV5";
import { reconstructInquiryBeatId, NavigatorResumeIntegrityError } from "./NavigatorSessionV5";
import type { PlanResourceV4 } from "../planBuild/canonicalInputs";
import { adjudicateCommandPayload, resolveBeatActionTemplate } from "../tutorOrchestration/WorkspaceActionAdjudication";
import {
  applyV7Event,
  initialStateFromSessionStartedV7,
  type V7FoldContext,
} from "../tutorSession/TutorRuntimeStateReducerV7";

/**
 * Navigator 会话壳的 kernel 结构面（F7 RT4 会话级接线）：v7（state/v2）与
 * v9（state/v4）kernel 共用——方法签名兼容（v9 append 词表为 v7 超集），
 * state 经 navigator 的只读 getter 按字段读取（不在此处建第二 state 真源）。
 */
export interface NavigatorSessionKernel {
  readonly sessionId: string;
  readonly revision: number;
  /** v7 = state/v2；v9 = state/v4 超集（读取经 NavigatorOnlineState face）。 */
  readonly state: unknown;
  append(expectedRevision: number, events: PendingV7Event[],companion?:GenerationCompanion): { revision: number; appendedSequences: number[] };
  assertReplayParity(): { equal: boolean; differences: unknown[] };
  rebuild(): unknown;
}

/** v7/v9 共有的在线游标面（state/v2 ⊂ state/v4；generation 字段仅 v9 存在）。 */
export type NavigatorOnlineState = TutorRuntimeStateV5 & {
  presentation_cursor:
    | { status: "idle" }
    | { status: "awaiting_browser"; sequence_id: string; ordinal: number; action_id: string }
    | { status: "failed"; sequence_id: string; ordinal: number; action_id: string };
  generation_slot?: { status: "idle" } | { status: "pending" | "failed"; request_id: string };
  generation_requests?: unknown[];
  workspace_revision: number;
};

/** v7 会话壳的公共输入（binding 由编排层经 resolver 唯一解析后拆开注入）。 */
export interface NavigatorV7SessionInput {
  readonly sessionId: string;
  readonly plan: NavigatorPlanV5;
  readonly imported: ImportedApprovedPlanV5;
  readonly registryProvider: V7RegistryProvider;
  readonly gateProvider?: GateAdjudicationProvider;
  readonly modelTimeoutMs?: number;
  /**
   * F7 RT4：会话事件合同版本（缺省 v7 = 既有行为；'v9' = 生成生命周期会话，
   * start 必须携带 presenterGenerationPin）。resume 按会话行 event_schema 分派，
   * 本字段缺省时以行值为准。
   */
  readonly eventSchema?: "v7" | "v9" | "v10";
}

export interface NavigatorV7StartInput extends NavigatorV7SessionInput {
  readonly studentId: string;
  readonly taskId: string;
  readonly scenarioId: string;
  /** v7：会话模式显式入流（teaching|assessment；编排层按权限矩阵裁定后传入）。 */
  readonly sessionMode: "teaching" | "assessment";
  /** session_started 服务端 pin（catalog/model——orchestrator 计算后透传）。 */
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
  /**
   * F7 RT4（v9 会话）：Presenter 生成 pin（state/v4 pinned_plan 必填；与判题链
   * model_gate_pin、教学策略链 policy_profile 分开）。提供即启用 v9 会话。
   */
  readonly presentationExecutionOwner?: VisualExecutionOwner;
  readonly presenterGenerationPin?: {
    provider: string;
    model_id: string;
    prompt_version: string;
    context_builder_version: string;
    tool_catalog_version: string;
  };
}

export interface StudentInputTurnInputV7 {
  /** canonical student-input/v1 的 input 判别联合（utterance|control）。 */
  readonly input: V7StudentInputBody;
  readonly client_request_id: string;
}

export interface V7TurnResult {
  readonly revision: number;
  readonly inputSequence: number;
  readonly interpretationSequence?: number;
  readonly gateSequence?: number;
  readonly decisionSequence?: number;
  readonly decision?: NavigatorDecision;
  readonly failure?: { failure_class: string; message: string };
}

/**
 * 后端解释器的 intent 推导（F7 Step 3 rework，spec §2.5/ADR-011 决策 6）：
 * channel 是入口事实不是理解结果——mainline utterance 不预判 submit_answer，
 * intent 由模型裁决的 response_kind 推导；无法归类不落 intent。
 */
function presetIntentOfInput(input: V7StudentInputBody): IntentKind | undefined {
  if (input.kind === "utterance") {
    return input.channel === "assistance" ? "ask_question" : undefined;
  }
  switch (input.command) {
    case "confirm": return "confirm";
    case "continue": return "continue";
    case "request_scaffold": return "request_scaffold";
    case "request_rephrase": return "request_rephrase";
    case "barge_in": return "barge_in";
    case "return_to_mainline": return "return_to_mainline";
    case "retry_recovery": return "retry_recovery";
    default: return "continue";
  }
}

/** 模型裁决 → IntentKind（无法归类 → undefined，不伪造）。 */
function deriveIntentFromAdjudication(
  adjudication: { response_kind: string; verdict?: string },
  followAlong = false,
): IntentKind | undefined {
  if (followAlong && (adjudication.response_kind === "understanding_confirmation" || adjudication.response_kind === "restatement")) {
    if (adjudication.verdict === "pass") return "confirm";
    if (adjudication.verdict === "fail") return "request_scaffold";
    return undefined;
  }
  switch (adjudication.response_kind) {
    case "final_answer":
    case "alternate_path":
      return "submit_answer";
    case "question":
      return "ask_question";
    case "help_request":
      return "request_scaffold";
    default:
      // restatement / mixed_or_ambiguous（含降级形态）：语义不可归类——不落 intent。
      return undefined;
  }
}

/** unclear 假设（无法归类输入的 canonical 假设；不携带 gate assessment）。 */
function unclearHypothesis(): NavigatorInterpretation {
  return {
    intent: "unclear",
    reasoning_location: "unknown",
    confidence: 0.3,
    interpreter_version: INTERPRETER_V5_VERSION,
    reasoning_alignment: { kind: "unclear_reasoning" },
    in_bound: true,
  };
}

function isConfirmationIntent(intentKind: IntentKind): boolean {
  return intentKind === "confirm" || intentKind === "continue" || intentKind === "return_to_mainline";
}

function nowIso(): string {
  return new Date().toISOString();
}

/** policy_failed payload（canonical 封闭枚举；与 v5 同口径）。 */
function policyFailedPayload(failureClass: string): Record<string, unknown> {
  const mapped = canonicalPolicyFailureClass(failureClass as Parameters<typeof canonicalPolicyFailureClass>[0]);
  return {
    policy_version: NAVIGATOR_V5_VERSION,
    failure_class: mapped.failure_class,
    fallback_used: false,
  };
}

function inquiryTriggerFor(decision: NavigatorDecision): string {
  const intent = decision.interpretation_summary?.intent ?? "";
  if (intent.startsWith("request_scaffold")) return "request_scaffold";
  if (intent.startsWith("request_rephrase")) return "request_rephrase";
  if (intent.startsWith("submit_answer")) return "unclear";
  return "ask_question";
}

/**
 * 同 client_request_id 的已提交轮次（幂等重试读取；v7 版）：input 事实 → 派生
 * interpretation/intent（causation→input；mainline 无法归类时无 intent）→
 * gate/decision（trigger 序列集与 v5/v6 同推导）。
 */
export function findCommittedV7Turn(events: readonly StoredV7Event[], clientRequestId: string): {
  revision: number;
  inputSequence: number;
  intentSequence?: number;
  interpretationSequence?: number;
  gateSequence?: number;
  decisionSequence?: number;
  decision?: NavigatorDecision;
  failure?: { failure_class: string; message: string };
} | undefined {
  let inputSequence: number | undefined;
  let intentSequence: number | undefined;
  let interpretationSequence: number | undefined;
  let gateSequence: number | undefined;
  let decisionSequence: number | undefined;
  let decision: NavigatorDecision | undefined;
  let failure: { failure_class: string; message: string } | undefined;
  let revision = 1;
  for (const event of events) {
    revision = Math.max(revision, event.state_revision);
    if (event.event_type === "student_input_recorded") {
      const payload = event.payload as { client_request_id?: string };
      if (payload.client_request_id === clientRequestId) inputSequence = event.sequence;
      continue;
    }
    if (inputSequence === undefined) continue;
    const turnSequences = new Set<number>([inputSequence]);
    if (interpretationSequence !== undefined) turnSequences.add(interpretationSequence);
    if (intentSequence !== undefined) turnSequences.add(intentSequence);
    if (gateSequence !== undefined) turnSequences.add(gateSequence);
    if (event.event_type === "semantic_interpretation_recorded" && event.causation_sequence === inputSequence) {
      interpretationSequence = event.sequence;
    } else if (event.event_type === "student_intent_recorded" && event.causation_sequence === inputSequence) {
      intentSequence = event.sequence;
    } else if (intentSequence !== undefined && event.event_type === "gate_evaluated" && event.causation_sequence === intentSequence) {
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
  if (inputSequence === undefined) return undefined;
  return {
    revision,
    inputSequence,
    ...(intentSequence !== undefined ? { intentSequence } : {}),
    ...(interpretationSequence !== undefined ? { interpretationSequence } : {}),
    ...(gateSequence !== undefined ? { gateSequence } : {}),
    ...(decisionSequence !== undefined ? { decisionSequence } : {}),
    ...(decision !== undefined ? { decision } : {}),
    ...(failure !== undefined ? { failure } : {}),
  };
}

export interface PreparedNavigationV7 {
  readonly expectedRevision: number;
  readonly events: readonly PendingV7Event[];
  readonly result: V7TurnResult;
  readonly nextInquiryBeatId: string | undefined;
}

export class NavigatorSessionV7 {
  readonly sessionId: string;
  readonly plan: NavigatorPlanV5;
  private readonly registryProvider: V7RegistryProvider;
  private kernelRef: NavigatorSessionKernel;
  private readonly adjudicator: ModelGateAdjudicatorV5;
  private inquiryBeatId: string | undefined;
  private readonly imported: ImportedApprovedPlanV5;
  private decisionBatchComposer: ((prepared:PreparedNavigationV7)=>PreparedNavigationV7) | undefined;
  setDecisionBatchComposer(composer:(prepared:PreparedNavigationV7)=>PreparedNavigationV7):void { this.decisionBatchComposer=composer; }
  private readonly schemaVersion: "v7" | "v9" | "v10";

  private constructor(input: NavigatorV7SessionInput, kernel: NavigatorSessionKernel, schemaVersion: "v7" | "v9" | "v10") {
    this.sessionId = input.sessionId;
    this.plan = input.plan;
    this.imported = input.imported;
    this.registryProvider = input.registryProvider;
    this.kernelRef = kernel;
    this.schemaVersion = schemaVersion;
    this.adjudicator = new ModelGateAdjudicatorV5(input.gateProvider ?? new UnavailableGateProvider(), {
      ...(input.modelTimeoutMs !== undefined ? { timeoutMs: input.modelTimeoutMs } : {}),
    });
  }

  /** 会话事件合同版本（编排层 v9 生成路径判定；start 冻结、resume 按行值）。 */
  get eventSchema(): "v7" | "v9" | "v10" {
    return this.schemaVersion;
  }

  /**
   * 启动会话：kernel.start（原子 pin + event_schema + session_mode）+ 起步
   * execute_beat 决策。F7 RT4：提供 presenterGenerationPin ⇒ v9 会话（生成
   * 生命周期；state/v4）；否则 v7（既有行为零变化）。
   */
  static start(input: NavigatorV7StartInput): NavigatorSessionV7 {
    if (input.sessionMode === "assessment" && [input.plan.mainline, ...input.plan.branches.values()]
      .some((protocol) => [...protocol.beats.values()].some((beat) => beat.completion_evidence.confirmation_target === "follow_along"))) {
      throw new Error("follow_along is a Teach protocol; assessment requires separately approved verification evidence");
    }
    const payload = {
      ...buildSessionStartedPayload(input.plan, {
        sessionId: input.sessionId,
        taskId: input.taskId,
        scenarioId: input.scenarioId,
      }),
      session_mode: input.sessionMode,
      ...(input.sessionStartedPins?.workspace_catalog_pin
        ? { workspace_catalog_pin: input.sessionStartedPins.workspace_catalog_pin }
        : {}),
      ...(input.sessionStartedPins?.model_gate_pin
        ? { model_gate_pin: input.sessionStartedPins.model_gate_pin }
        : {}),
      ...(input.presenterGenerationPin
        ? { presenter_generation_pin: input.presenterGenerationPin }
        : {}),
    };
    if (input.presentationExecutionOwner) {
      if (!input.presenterGenerationPin) throw new Error("PRESENTER_PIN_MISMATCH: V10 requires presenter pin");
      const kernel = TutorSessionKernelV10.start({sessionId:input.sessionId,studentId:input.studentId,
        sessionStarted:{...payload,presentation_execution_owner:input.presentationExecutionOwner},occurred_at:nowIso()},input.registryProvider as V10RegistryProvider);
      const session=new NavigatorSessionV7(input,kernel,"v10");
      session.commitDecisions(1,[{kind:"session_start"}]);
      return session;
    }
    if (input.presenterGenerationPin) {
      const kernel = TutorSessionKernelV9.start({
        sessionId: input.sessionId,
        studentId: input.studentId,
        sessionStarted: payload as unknown as Parameters<typeof TutorSessionKernelV9.start>[0]["sessionStarted"],
        occurred_at: nowIso(),
      }, input.registryProvider as unknown as V9RegistryProvider);
      const session = new NavigatorSessionV7(input, kernel, "v9");
      session.commitDecisions(1, [{ kind: "session_start" }]);
      return session;
    }
    const kernel = TutorSessionKernelV7.start({
      sessionId: input.sessionId,
      studentId: input.studentId,
      sessionStarted: payload as unknown as Parameters<typeof TutorSessionKernelV7.start>[0]["sessionStarted"],
      occurred_at: nowIso(),
    }, input.registryProvider);
    const session = new NavigatorSessionV7(input, kernel, "v7");
    session.commitDecisions(1, [{ kind: "session_start" }]);
    return session;
  }

  /**
   * 恢复：kernel verified rebuild（v5/v6 会话行 → SESSION_VERSION_UNSUPPORTED）+
   * pinned Plan 逐事件 gate 归属核对（与 v5 同一函数；只读结构 adapter）。
   * 零模型调用。
   */
  static resume(input: NavigatorV7SessionInput): NavigatorSessionV7 {
    // F7 RT4：按会话行 event_schema 分派（v7 行 → v7 kernel；v9 行 → v9 kernel；
    // v5/v6 行 → SESSION_VERSION_UNSUPPORTED。半升级组合显式拒绝，不迁移）。
    const rowSchema = readSessionEventSchema(input.sessionId);
    if ((input.eventSchema ?? rowSchema) === "v10") {
      const provider=input.registryProvider as V10RegistryProvider;
      const kernel=TutorSessionKernelV10.resume(input.sessionId,provider,{expectedTutorPlanRef:input.plan.tutor_plan_ref});
      const events=readTutorSessionEventsV10(input.sessionId,provider);
      verifyGateAttributionAgainstPlanV7(input.plan,input.imported.plan.resources,events as unknown as StoredV7Event[],provider(events[0].payload));
      const session=new NavigatorSessionV7(input,kernel,"v10");
      session.inquiryBeatId=reconstructInquiryBeatId(events as unknown as StoredV5Event[]);
      return session;
    }
    const useV9 = (input.eventSchema ?? rowSchema) === "v9";
    if (useV9) {
      const kernel = TutorSessionKernelV9.resume(input.sessionId, input.registryProvider as unknown as V9RegistryProvider, {
        expectedTutorPlanRef: input.plan.tutor_plan_ref,
      });
      const events = readTutorSessionEventsV9(input.sessionId, input.registryProvider as unknown as V9RegistryProvider);
      verifyGateAttributionAgainstPlanV7(
        input.plan,
        input.imported.plan.resources,
        events as unknown as readonly StoredV7Event[],
        input.registryProvider(events[0]?.payload ?? {}),
      );
      const session = new NavigatorSessionV7(input, kernel, "v9");
      session.inquiryBeatId = reconstructInquiryBeatId(events as unknown as readonly StoredV5Event[]);
      return session;
    }
    const kernel = TutorSessionKernelV7.resume(input.sessionId, input.registryProvider, {
      expectedTutorPlanRef: input.plan.tutor_plan_ref,
    });
    const events = readTutorSessionEventsV7(input.sessionId, input.registryProvider);
    verifyGateAttributionAgainstPlanV7(
      input.plan,
      input.imported.plan.resources,
      events,
      input.registryProvider(events[0]?.payload ?? {}),
    );
    const session = new NavigatorSessionV7(input, kernel, "v7");
    session.inquiryBeatId = reconstructInquiryBeatId(events as unknown as readonly StoredV5Event[]);
    return session;
  }

  get state(): NavigatorOnlineState {
    // v7 state = state/v2；v9 = state/v4 超集（决策引擎只读 v1/v2 面；编排层
    // 另读 presentation_cursor/generation_slot）。
    return this.kernelRef.state as NavigatorOnlineState;
  }

  get revision(): number {
    return this.kernelRef.revision;
  }

  get events(): StoredV7Event[] {
    // v9 行经 v9 reader（canonical v9 判定）；返回形状对编排层读取面兼容
    //（共享事件逐字段同形；v9 生成事件族由 GenerationCoordinator 消费）。
    if (this.schemaVersion === "v10") return readTutorSessionEventsV10(this.sessionId,this.registryProvider as V10RegistryProvider) as unknown as StoredV7Event[];
    if (this.schemaVersion === "v9") {
      return readTutorSessionEventsV9(this.sessionId, this.registryProvider as unknown as V9RegistryProvider) as unknown as StoredV7Event[];
    }
    return readTutorSessionEventsV7(this.sessionId, this.registryProvider);
  }

  /** F2 事实内核（只读暴露：V7 orchestrator 在此驱动 presentation/命令/生成事件；本类不改其行为）。 */
  get kernel(): NavigatorSessionKernel {
    return this.kernelRef;
  }

  /** 全量重建（快照/对账用）——在线 face（v7=state/v2；v9=state/v4 超集）。 */
  rebuildState(): NavigatorOnlineState {
    return this.kernelRef.rebuild() as NavigatorOnlineState;
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

  /** G2 对账入口（在线缓存 state vs 全量重建 state）。 */
  assertReplayParity(): { equal: boolean; differences: unknown[] } {
    return this.kernelRef.assertReplayParity();
  }

  /**
   * 接受学生输入（canonical utterance|control）：input 事实先独立批落库 →
   * 后端解释（mainline：模型裁决 response_kind 推导 intent；assistance/control：
   * 入口语义预设）→ interpretation + intent（causation→input）+（gate）+
   * decision 同批原子 append。同 client_request_id 重试读已提交判断。
   */
  async submitStudentInput(input: StudentInputTurnInputV7): Promise<V7TurnResult> {
    if (input.input.kind === "utterance" && (input.input.text === undefined || input.input.channel === undefined)) {
      throw new Error("kind=utterance requires channel and text (canonical mirror rule)");
    }
    if (input.input.kind === "control" && input.input.command === undefined) {
      throw new Error("kind=control requires command (canonical mirror rule)");
    }
    const intentKind = presetIntentOfInput(input.input);
    const text = input.input.kind === "utterance" ? input.input.text : undefined;
    // 幂等重试：同 client_request_id 已有 committed 判断 → 读已提交判断返回。
    const committed = findCommittedV7Turn(this.events, input.client_request_id);
    if (committed?.decisionSequence !== undefined || committed?.failure !== undefined) {
      const { intentSequence, ...rest } = committed;
      void intentSequence;
      return rest;
    }

    const priorEvents = this.events;
    let revision = this.kernelRef.revision;
    // 输入事实先行持久化（独立批；调用中断恢复时复用已提交 input sequence）。
    let inputSequence: number;
    if (committed) {
      inputSequence = committed.inputSequence;
    } else {
      const appended = this.kernelRef.append(revision, [
        {
          event_type: "student_input_recorded",
          payload: { input: input.input, client_request_id: input.client_request_id },
          occurred_at: nowIso(),
          idempotency_key: (() => { const key = composeIdempotencyKey(["si", this.sessionId, input.client_request_id]); assertIdempotencyKeyShape(key); return key; })(),
        },
      ]);
      inputSequence = appended.appendedSequences[0];
      revision = appended.revision;
    }

    // mainline utterance：channel 只是入口事实——intent 由模型裁决推导。
    const followAlong = this.currentBeat.completion_evidence.confirmation_target === "follow_along";
    const interpretFollowAlong = followAlong && (input.input.kind === "utterance"
      || intentKind === "confirm" || intentKind === "continue");
    if (intentKind === undefined || interpretFollowAlong) {
      const adjudication = await this.adjudicator.adjudicate(
        buildGateAdjudicationContext({
          plan: this.plan,
          beat: this.currentBeat,
          events: priorEvents as unknown as Parameters<typeof buildGateAdjudicationContext>[0]["events"],
          ...(this.state.reasoning_focus ? { reasoningFocus: this.state.reasoning_focus } : {}),
          studentInput: { intent_kind: input.input.kind === "utterance" ? "utterance" : (intentKind ?? "utterance"), text: text ?? "" },
          factRelevanceScore: interpretationMatchScore,
        }),
      );
      const derived = deriveIntentFromAdjudication(adjudication, followAlong);
      if (derived === undefined) {
        // 无法归类：不落 intent——unclear 假设 → 澄清/安全 fallback。
        const modelFailure = adjudication.degraded_reason
          ? { reason: adjudication.degraded_reason, detail: `provider=${adjudication.provider}` }
          : undefined;
        return this.interpretUnclearAndDecide(revision, inputSequence, text, unclearHypothesis(), modelFailure);
      }
      return this.interpretAndDecide(
        revision,
        inputSequence,
        input.client_request_id,
        derived,
        text,
        hypothesisFromAdjudication({
          plan: this.plan,
          beat: this.currentBeat,
          intent_kind: derived,
          text: text ?? "",
          adjudication,
          evidence_sequence: this.nextSequence() + 1,
        }),
        undefined,
      );
    }

    // assistance utterance / control：入口语义预设，自然语言仍经模型裁决（R3）。
    let hypothesis: NavigatorInterpretation;
    let modelFailure: { reason: string; detail: string } | undefined;
    if (isNaturalLanguageInput(intentKind, text)) {
      const adjudication = await this.adjudicator.adjudicate(
        buildGateAdjudicationContext({
          plan: this.plan,
          beat: this.currentBeat,
          events: priorEvents as unknown as Parameters<typeof buildGateAdjudicationContext>[0]["events"],
          ...(this.state.reasoning_focus ? { reasoningFocus: this.state.reasoning_focus } : {}),
          studentInput: { intent_kind: intentKind, text: text ?? "" },
          factRelevanceScore: interpretationMatchScore,
        }),
      );
      if (adjudication.degraded_reason) {
        modelFailure = { reason: adjudication.degraded_reason, detail: `provider=${adjudication.provider}` };
      }
      hypothesis = hypothesisFromAdjudication({
        plan: this.plan,
        beat: this.currentBeat,
        intent_kind: intentKind,
        text: text ?? "",
        adjudication,
        evidence_sequence: this.nextSequence() + (modelFailure ? 2 : 1),
      });
    } else {
      hypothesis = interpretStudentInput(this.plan, {
        intent_kind: intentKind,
        ...(text !== undefined ? { text } : {}),
        beat: this.currentBeat,
      });
    }
    return this.interpretAndDecide(revision, inputSequence, input.client_request_id, intentKind, text, hypothesis, modelFailure);
  }

  /**
   * 消费 F3 已提交的 workspace 命令执行回执（R1 硬边界：禁止「校验后自报
   * outcome」——本方法不创建/追加任何 action_outcome_recorded）。
   *
   * v7 命令事实 = `student_workspace_command_recorded(command_id)`；执行回执 =
   * 其配对的 `action_outcome_recorded(action_id=command_id, action_kind=
   * student_command)`（causation 指向命令事实事件）。任一缺失即 fail closed。
   * gate 只消费调用方经单一 typed evaluator 产出的 verified assessment
   * （WorkspaceGateAssessment：completed ≠ 数学正确；缺省不得 pass）。
   */
  consumeWorkspaceCommandOutcome(input: { command_id: string; assessment?: WorkspaceGateAssessmentInput }): V7TurnResult {
    const events = this.events;
    let command: { sequence: number; capability: string } | undefined;
    let receipt: { sequence: number; outcome: "completed" | "rejected" | "interrupted" | "failed"; resulting_revision?: number } | undefined;
    for (const event of events) {
      if (event.event_type === "student_workspace_command_recorded") {
        const payload = event.payload as { command_id?: string; capability?: string };
        if (payload.command_id === input.command_id && typeof payload.capability === "string") {
          command = { sequence: event.sequence, capability: payload.capability };
        }
      } else if (event.event_type === "action_outcome_recorded") {
        const outcome = event.payload as {
          action_id?: string;
          action_kind?: string;
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
    if (!command) {
      throw new Error(
        `consumeWorkspaceCommandOutcome fail closed: no committed student_workspace_command_recorded with command_id=${input.command_id} (nothing to consume)`,
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
      return { revision: this.kernelRef.revision, inputSequence: command.sequence };
    }
    const assessment = evaluateGateEvidence(this.plan, beat, {
      confirmation_sequences: [],
      workspace_outcomes: [{ capability: command.capability, outcome: receipt.outcome, sequence: receipt.sequence }],
      narration_completed: false,
      // F7 因果链 2（v7）：workspace gate 只消费已验证裁决（单一 typed evaluator
      // 产出；缺省不得 pass——completed 回执本身不构成满足）。
      ...(input.assessment ? { workspace_assessments: [input.assessment] } : {}),
    } satisfies GateEvidenceInput);
    // gate 事实 + decision 同批原子（锚定回执 sequence；与 v6 解释链同型）。
    const gateSequence = this.nextSequence();
    const batch: PendingV7Event[] = [
      {
        event_type: "gate_evaluated",
        payload: {
          gate_id: gate.gate_id,
          beat_id: beat.beat_id,
          satisfied: assessment.satisfied,
          ...(assessment.evidence_sequence !== undefined ? { evidence_sequence: assessment.evidence_sequence } : {}),
        },
        occurred_at: nowIso(),
        causation_sequence: receipt.sequence,
      },
    ];
    const trigger: NavigatorTrigger = {
      kind: "gate_evaluated",
      sequence: gateSequence,
      gate_id: gate.gate_id,
      beat_id: beat.beat_id,
      satisfied: assessment.satisfied,
      ...(assessment.evidence_sequence !== undefined ? { evidence_sequence: assessment.evidence_sequence } : {}),
    };
    const outcome = decideNavigation(this.baseContext(), trigger);
    const result = this.commitDecisions(
      this.kernelRef.revision,
      [
        outcome.ok
          ? { kind: "plain", sequence: trigger.sequence, decision: outcome.decision }
          : { kind: "failed", sequence: trigger.sequence, failure: outcome.failure },
      ],
      batch,
    );
    return {
      ...result,
      inputSequence: command.sequence,
      ...(receipt !== undefined ? { gateSequence } : {}),
    };
  }

  /** Explicit write-side bootstrap. Fixed idempotency plus CAS fences workers. */
  completeBootstrap(): V7TurnResult | undefined {
    if (this.events.some(event=>event.event_type === "policy_decision_made")) return undefined;
    if (this.events.length !== 1) throw new Error("VISUAL_BOOTSTRAP_CORRUPT");
    const prepared=this.prepareDecisions(this.revision,[{kind:"session_start"}]);
    return this.commitPrepared({...prepared,events:prepared.events.map((event,index)=>({...event,
      idempotency_key:composeIdempotencyKey([this.sessionId,"bootstrap",String(index)])}))});
  }

  /** 对当前（inquiry-aware）Beat 产出 execute_beat 呈现决策（与 v5/v6 同型）。 */
  executeCurrentBeat(): V7TurnResult {
    const revision = this.kernelRef.revision;
    const anchor = this.events[this.events.length - 1]?.sequence ?? 1;
    const outcome = decideNavigation(this.baseContext(), { kind: "beat_execution", sequence: anchor });
    if (!outcome.ok) {
      return this.commitPolicyFailure(revision, anchor, outcome.failure.failure_class, outcome.failure.message);
    }
    return this.commitDecisions(revision, [{ kind: "plain", sequence: anchor, decision: outcome.decision }]);
  }

  /** timeout 等无输入触发轮（与 v5/v6 同型）。 */
  reportTimeout(): V7TurnResult {
    const revision = this.kernelRef.revision;
    const anchor = this.events[this.events.length - 1]?.sequence ?? 1;
    const outcome = decideNavigation(this.baseContext(), { kind: "timeout", sequence: anchor, beat_id: this.currentBeat.beat_id });
    if (!outcome.ok) {
      return this.commitPolicyFailure(revision, anchor, outcome.failure.failure_class, outcome.failure.message);
    }
    return this.commitDecisions(revision, [{ kind: "plain", sequence: anchor, decision: outcome.decision }]);
  }

  // ------------------------------------------------------------------ //
  // 内部：interpret → (gate) → decide → 持久化（同批原子）
  // ------------------------------------------------------------------ //

  private commitPolicyFailure(
    revision: number,
    anchor: number,
    failureClass: string,
    message: string,
  ): V7TurnResult {
    const failed = this.append(revision, [
      {
        event_type: "policy_failed",
        payload: policyFailedPayload(failureClass),
        occurred_at: nowIso(),
        causation_sequence: anchor,
      },
    ]);
    return { revision: failed.revision, inputSequence: anchor, failure: { failure_class: failureClass, message } };
  }

  /**
   * 无法归类输入（无 intent）的决策批：[runtime_failure?] + interpretation
   * (unclear) + decision（零 intent、零 gate）。
   */
  private interpretUnclearAndDecide(
    revision: number,
    inputSequence: number,
    text: string | undefined,
    hypothesis: NavigatorInterpretation,
    modelFailure?: { reason: string; detail: string },
  ): V7TurnResult {
    const batch: PendingV7Event[] = [];
    if (modelFailure) {
      batch.push({
        event_type: "runtime_failure",
        payload: {
          failure_class: "internal_error",
          message: `gate_adjudicator_model_failure: ${modelFailure.reason} (${modelFailure.detail})`,
          related_event_sequence: inputSequence,
        },
        occurred_at: nowIso(),
        causation_sequence: inputSequence,
      });
    }
    batch.push({
      event_type: "semantic_interpretation_recorded",
      payload: hypothesisEventPayload(hypothesis),
      occurred_at: nowIso(),
      causation_sequence: inputSequence,
    });
    const trigger: NavigatorTrigger = {
      kind: "student_input",
      sequence: inputSequence,
      hypothesis,
      ...(text !== undefined ? { text } : {}),
    };
    const outcome = decideNavigation(this.baseContext(), trigger);
    const result = this.commitDecisions(
      revision,
      [
        outcome.ok
          ? { kind: "plain", sequence: inputSequence, decision: outcome.decision }
          : { kind: "failed", sequence: inputSequence, failure: outcome.failure },
      ],
      batch,
    );
    return { ...result, inputSequence };
  }

  private async interpretAndDecide(
    revision: number,
    inputSequence: number,
    clientRequestId: string,
    intentKind: IntentKind,
    text: string | undefined,
    hypothesis: NavigatorInterpretation,
    modelFailure?: { reason: string; detail: string },
  ): Promise<V7TurnResult> {
    const batch: PendingV7Event[] = [];
    if (modelFailure) {
      batch.push({
        event_type: "runtime_failure",
        payload: {
          failure_class: "internal_error",
          message: `gate_adjudicator_model_failure: ${modelFailure.reason} (${modelFailure.detail})`,
          related_event_sequence: inputSequence,
        },
        occurred_at: nowIso(),
        causation_sequence: inputSequence,
      });
    }
    const interpretationSequence = this.nextSequence() + batch.length;
    let effectiveInterpretationSequence = interpretationSequence;
    batch.push({
      event_type: "semantic_interpretation_recorded",
      payload: hypothesisEventPayload(hypothesis),
      occurred_at: nowIso(),
      causation_sequence: inputSequence,
    });
    // v7 输入链：intent 是后端解释器派生事实（causation→input、同
    // client_request_id；v7 词表无 submit_workspace_command）。
    batch.push({
      event_type: "student_intent_recorded",
      payload: {
        intent_kind: intentKind,
        client_request_id: clientRequestId,
        ...(text !== undefined ? { text } : {}),
      },
      occurred_at: nowIso(),
      causation_sequence: inputSequence,
    });
    const intentSequence = interpretationSequence + 1;

    const beat = this.currentBeat;
    const gate = beat.completion_evidence.gate;
    const evidenceKind = beat.completion_evidence.evidence_kind;
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
      const answerRelevant = evidenceKind === "student_answer" && intentKind === "submit_answer" && !hypothesis.matched_variant_id;
      if (gateRelevant || answerRelevant) {
        const assessment = evaluateGateEvidence(this.plan, beat, evidenceInput);
        gateSequence = this.nextSequence() + batch.length;
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
    let reuse: { beat: NavigatorBeatView; evidenceSequence: number } | undefined;
    // A local repair and the original Beat are different evidence goals. Reuse the
    // same raw feedback only after adjudicating the saved mainline goal as well.
    // Both judgments and all navigation facts commit in one batch: a lost response
    // cannot leave half a returned/advanced turn or cause a second confirmation.
    if (outcome.ok && outcome.decision.decision_kind === "return_to_mainline"
      && outcome.decision.transition_basis?.basis === "inquiry_completed"
      && hypothesis.gate_assessment?.verdict === "pass"
      && text !== undefined && text.trim().length > 0
      && beat.completion_evidence.confirmation_target === "follow_along") {
      const target = this.plan.mainline.beats.get(outcome.decision.to_beat_id ?? "");
      if (target?.completion_evidence.confirmation_target === "follow_along") {
        const originalInput = (this.events.find((event) => event.sequence === inputSequence)?.payload as {input: V7StudentInputBody}).input;
        const context = buildGateAdjudicationContext({
          plan: this.plan, beat: target,
          events: this.events as unknown as Parameters<typeof buildGateAdjudicationContext>[0]["events"],
          studentInput: { intent_kind: originalInput.kind === "utterance" ? "utterance" : (originalInput.command ?? "utterance"), text: text ?? "" },
          factRelevanceScore: interpretationMatchScore,
        });
        const adjudication = await this.adjudicator.adjudicate({...context, student_input: {...context.student_input,
          responding_to: {protocol_id: beat.protocol_id, beat_id: beat.beat_id, purpose: beat.purpose}}});
        const checked = hypothesisFromAdjudication({plan: this.plan, beat: target, intent_kind: "confirm", text: text ?? "",
          adjudication, evidence_sequence: intentSequence});
        effectiveInterpretationSequence = this.nextSequence() + batch.length;
        batch.push({ event_type: "semantic_interpretation_recorded", payload: {
          ...hypothesisEventPayload(checked),
          intent: `${checked.intent}:return:${target.protocol_id}:${target.beat_id}:${target.completion_evidence.gate!.gate_id}`,
        }, occurred_at: nowIso(), causation_sequence: inputSequence });
        if (adjudication.degraded_reason) batch.push({event_type: "runtime_failure", payload: {
          failure_class: "internal_error", message: `return feedback adjudication unavailable: ${adjudication.degraded_reason}`,
          related_event_sequence: inputSequence,
        }, occurred_at: nowIso(), causation_sequence: inputSequence});
        if ((checked.intent === "confirm:follow_along:self_reported" || checked.intent === "confirm:follow_along:expressed")
          && evaluateGateEvidence(this.plan, target, {confirmation_sequences: [intentSequence], workspace_outcomes: [],
            narration_completed: false, model_assessment: checked.gate_assessment}).satisfied) {
          reuse = {beat: target, evidenceSequence: intentSequence};
        }
      }
    }
    const result = this.commitDecisions(
      revision,
      [
        outcome.ok
          ? { kind: "plain", sequence: trigger.sequence, decision: outcome.decision }
          : { kind: "failed", sequence: trigger.sequence, failure: outcome.failure },
      ],
      batch,
      reuse,
    );
    return {
      ...result,
      inputSequence,
      interpretationSequence: effectiveInterpretationSequence,
      ...(gateSequence !== undefined ? { gateSequence } : {}),
    };
  }

  prepareDecisions(
    revision: number,
    items: ReadonlyArray<
      | { kind: "session_start" }
      | { kind: "plain"; sequence: number; decision: NavigatorDecision }
      | { kind: "failed"; sequence: number; failure: { failure_class: string; message: string } }
    >,
    prefixBatch: PendingV7Event[] = [],
    reuseAfterReturn?: { beat: NavigatorBeatView; evidenceSequence: number },
  ): PreparedNavigationV7 {
    const batch: PendingV7Event[] = [...prefixBatch];
    let nextInquiryBeatId = this.inquiryBeatId;
    const results: V7TurnResult[] = [];
    let currentRevision = revision;
    for (const item of items) {
      if (item.kind === "session_start") {
        const outcome = decideNavigation(this.baseContext(), { kind: "session_start" });
        if (!outcome.ok) throw new Error(`navigator refused session start: ${outcome.failure.message}`);
        batch.push(this.decisionEvent(1, outcome.decision, 1));
        results.push({ revision: currentRevision, inputSequence: 1, decision: outcome.decision });
        continue;
      }
      if (item.kind === "failed") {
        batch.push({
          event_type: "policy_failed",
          payload: policyFailedPayload(item.failure.failure_class),
          occurred_at: nowIso(),
          causation_sequence: item.sequence,
        });
        results.push({ revision: currentRevision, inputSequence: item.sequence, failure: item.failure });
        continue;
      }
      const decision = item.decision;
      const decisionSequence = this.nextSequence() + batch.length;
      batch.push(this.decisionEvent(decisionSequence, decision, item.sequence));
      // companion 事实：inquiry 生命周期 + 收束（与 v5/v6 同形状；open_scaffold
      // 叙述由编排层呈现序列承载）。
      if (decision.decision_kind === "open_inquiry" || decision.decision_kind === "open_scaffold") {
        const inquiry = decision.inquiry as { inquiry_id: string; inquiry_protocol_id?: string; return_beat_id: string } | undefined;
        if (inquiry) {
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
          nextInquiryBeatId = inquiry.inquiry_protocol_id
            ? pinnedProtocol(this.plan, inquiry.inquiry_protocol_id)?.entry_beat_id
            : undefined;
        }
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
        nextInquiryBeatId = undefined;
      }
      if (decision.decision_kind === "continue_inquiry" && decision.inquiry?.inquiry_protocol_id) {
        nextInquiryBeatId = decision.beat_id;
      }
      if (decision.decision_kind === "complete_beat" && !this.state.completed) {
        batch.push({
          event_type: "session_completed",
          payload: { final_beat_id: decision.beat_id, completed_parts: [this.currentBeat.part_id ?? "1"] },
          occurred_at: nowIso(),
        });
      }
      results.push({ revision: currentRevision, inputSequence: item.sequence, decisionSequence, decision });
      if (decision.decision_kind === "return_to_mainline" && reuseAfterReturn) {
        const target = reuseAfterReturn.beat;
        const gate = target.completion_evidence.gate!;
        const gateSequence = this.nextSequence() + batch.length;
        batch.push({event_type: "gate_evaluated", payload: {gate_id: gate.gate_id, beat_id: target.beat_id,
          satisfied: true, evidence_sequence: reuseAfterReturn.evidenceSequence}, occurred_at: nowIso(),
          causation_sequence: reuseAfterReturn.evidenceSequence});
        // Fold the prospective batch using the existing reducer. This is transaction
        // validation, not a second persisted state or a guessed cursor transition.
        let prospective = this.state as unknown as Parameters<typeof applyV7Event>[0];
        const foldContext = this.registryProvider(this.events[0].payload);
        for (const [index, pending] of batch.entries()) {
          prospective = applyV7Event(prospective, {schema: "ai_teaching_tutor_session_event/v7",
            session_id: this.sessionId, sequence: this.nextSequence() + index, state_revision: revision + 1,
            idempotency_key: `${this.sessionId}:preview:${index}`, ...pending} as StoredV7Event, foldContext);
        }
        const next = decideNavigation({...this.baseContext(), state: prospective as unknown as NavigatorContext["state"], inquiryBeatId: undefined}, {
          kind: "gate_evaluated", sequence: gateSequence, gate_id: gate.gate_id, beat_id: target.beat_id,
          satisfied: true, evidence_sequence: reuseAfterReturn.evidenceSequence,
        });
        if (!next.ok) throw new Error(`return feedback cannot take a legal transition: ${next.failure.message}`);
        const nextSequence = this.nextSequence() + batch.length;
        batch.push(this.decisionEvent(nextSequence, next.decision, gateSequence));
        if (next.decision.decision_kind === "complete_beat") batch.push({event_type: "session_completed",
          payload: {final_beat_id: target.beat_id, completed_parts: [target.part_id ?? "1"]}, occurred_at: nowIso()});
        results.push({revision: currentRevision, inputSequence: item.sequence, decisionSequence: nextSequence,
          gateSequence, decision: next.decision});
      }
    }
    const last = results[results.length - 1];
    return { expectedRevision: revision, events: batch,
      result: { ...last, revision: currentRevision }, nextInquiryBeatId };
  }

  /** Commit decisions and lifecycle companions with one CAS. */
  commitPrepared(prepared: PreparedNavigationV7, suffix: readonly PendingV7Event[] = []): V7TurnResult {
    prepared=this.decisionBatchComposer?.(prepared) ?? prepared;
    const batch = [...prepared.events, ...suffix];
    const result = batch.length ? this.kernelRef.append(prepared.expectedRevision, batch) : {revision: prepared.expectedRevision};
    this.inquiryBeatId = prepared.nextInquiryBeatId;
    return {...prepared.result, revision: result.revision};
  }

  private commitDecisions(...args: Parameters<NavigatorSessionV7["prepareDecisions"]>): V7TurnResult {
    return this.commitPrepared(this.prepareDecisions(...args));
  }

  private decisionEvent(decisionSequence: number, decision: NavigatorDecision, causation: number): PendingV7Event {
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
        ...(decision.local_inquiry_protocol ? { local_inquiry_protocol: decision.local_inquiry_protocol } : {}),
      } as Record<string, unknown>,
      occurred_at: nowIso(),
      causation_sequence: causation,
      idempotency_key: `${this.sessionId}:decision:${decision.decision_id}`,
    };
  }

  private baseContext(): NavigatorContext {
    const events = this.events;
    return {
      sessionId: this.sessionId,
      plan: this.plan,
      state: this.state,
      revision: this.kernelRef.revision,
      ...(this.inquiryBeatId !== undefined ? { inquiryBeatId: this.inquiryBeatId } : {}),
      localInquirySteps: deriveLocalInquirySteps(events as unknown as readonly StoredV5Event[]),
      unresolvedClarifications: deriveUnresolvedClarifications(events as unknown as readonly StoredV5Event[]),
    };
  }

  private append(revision: number, events: PendingV7Event[]): { revision: number; sequences: number[] } {
    const result = this.kernelRef.append(revision, events);
    return { revision: result.revision, sequences: result.appendedSequences };
  }

  private nextSequence(): number {
    return this.events.length + 1;
  }
}

// ------------------------------------------------------------------ //
// R3 resume（v7）：pinned Plan 逐事件 gate 归属核对（纯函数，只读 committed 流）
// ------------------------------------------------------------------ //

/**
 * verifyGateAttributionAgainstPlan（V5）的 v7 后继：逐事件核对 gate_evaluated
 * 的 Gate/Beat 归属与 satisfied 证据的可采信性——fold 用 v7 reducer（含
 * student_workspace_command_recorded 事实链）；workspace gate 的 replay 复算
 * 从 student_workspace_command_recorded 解析命令载荷（V5 经 intent 内嵌）。
 */
export function verifyGateAttributionAgainstPlanV7(
  plan: NavigatorPlanV5,
  resources: readonly PlanResourceV4[],
  events: readonly StoredV7Event[],
  foldContext: V7FoldContext,
): void {
  if (events.length === 0) return;
  let state = initialStateFromSessionStartedV7(events[0]);
  const evidenceBySequence = new Map<number, StoredV7Event>();
  const inputScopes = new Map<number, {inquiry: boolean; protocol_id: string; beat_id: string; inquiry_id?: string; return_beat_id?: string}>();
  for (const event of events) {
    if (
      event.event_type === "student_intent_recorded"
      || event.event_type === "student_workspace_command_recorded"
      || event.event_type === "action_outcome_recorded"
    ) {
      evidenceBySequence.set(event.sequence, event);
    }
  }
  for (const event of events.slice(1)) {
    if (event.event_type === "student_input_recorded") inputScopes.set(event.sequence, {
      inquiry: state.inquiry_cursor !== null, protocol_id: state.teaching_cursor.protocol_id, beat_id: state.teaching_cursor.beat_id,
      inquiry_id: state.inquiry_cursor?.inquiry_id, return_beat_id: state.inquiry_cursor?.return_beat_id,
    });
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
          if (!isStudentEvidenceEventV7(evidence, evidenceKind)) {
            throw new NavigatorResumeIntegrityError(
              "GATE_EVIDENCE_FORGED",
              `sequence ${event.sequence}: satisfied gate ${gate.gate_id}@${gate.beat_id} evidence_sequence=${String(gate.evidence_sequence)} points at ${evidence.event_type} which is not admissible student evidence for evidence_kind=${evidenceKind}; forged pass, resume refused`,
              event.sequence,
            );
          }
          if (beat.completion_evidence.confirmation_target === "follow_along") {
            const source = inputScopes.get(evidence.causation_sequence ?? -1);
            const directScope = source?.inquiry === false && source.protocol_id === beat.protocol_id && source.beat_id === beat.beat_id;
            const returnedScope = source?.inquiry === true && source.protocol_id === beat.protocol_id && source.return_beat_id === beat.beat_id
              && events.some((candidate) => candidate.event_type === "inquiry_returned"
                && candidate.sequence > evidence.sequence && candidate.sequence < event.sequence
                && candidate.state_revision === event.state_revision
                && (candidate.payload as {return_beat_id?: string}).return_beat_id === beat.beat_id
                && (candidate.payload as {inquiry_id?: string}).inquiry_id === source.inquiry_id
                && events.some((decision) => decision.sequence === candidate.causation_sequence
                  && decision.event_type === "policy_decision_made" && decision.causation_sequence === evidence.sequence
                  && decision.state_revision === event.state_revision
                  && (decision.payload as {decision_kind?: string}).decision_kind === "return_to_mainline"));
            const interpretation = events.find((candidate) =>
              candidate.event_type === "semantic_interpretation_recorded"
              && candidate.causation_sequence === evidence.causation_sequence
              && candidate.sequence < event.sequence
              && candidate.state_revision === evidence.state_revision
              && ((directScope && candidate.sequence < evidence.sequence && ((candidate.payload as {intent?: string}).intent === "confirm:follow_along:self_reported"
                || (candidate.payload as {intent?: string}).intent === "confirm:follow_along:expressed"))
                || (returnedScope && (candidate.payload as {intent?: string}).intent?.endsWith(`:return:${beat.protocol_id}:${beat.beat_id}:${gate.gate_id}`))));
            const semanticIntent = (interpretation?.payload as { intent?: string } | undefined)?.intent;
            const allowedIntents = ["confirm:follow_along:self_reported", "confirm:follow_along:expressed"];
            const validIntent = allowedIntents.includes(semanticIntent ?? "") || allowedIntents.some((kind) =>
              semanticIntent === `${kind}:return:${beat.protocol_id}:${beat.beat_id}:${gate.gate_id}`);
            const rawInput = events.find((candidate) => candidate.sequence === evidence.causation_sequence);
            if ((evidence.payload as { intent_kind?: string }).intent_kind !== "confirm"
              || rawInput?.event_type !== "student_input_recorded"
              || event.causation_sequence !== evidence.sequence
              || event.state_revision !== evidence.state_revision
              || !validIntent) {
              throw new NavigatorResumeIntegrityError("GATE_EVIDENCE_FORGED",
                `sequence ${event.sequence}: follow-along gate requires the same input's interpreted understanding confirmation`, event.sequence);
            }
          }
          if (evidenceKind === "workspace_command") {
            // F7 replay 对账（因果链 2，v7）：satisfied workspace gate 必须能由
            // pinned ActionTemplate + committed command payload（v7 从
            // student_workspace_command_recorded 解析）+ 同一 typed evaluator
            // 重新复算为 verified-correct。
            const recheck = reAdjudicateWorkspaceGateV7(events, resources, beat, evidence.sequence);
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
    state = applyV7Event(state, event, foldContext);
  }
}

/** v7 的学生证据可采信性（workspace 证据 = completed 回执；载荷在命令事实事件）。 */
function isStudentEvidenceEventV7(event: StoredV7Event, evidenceKind: string): boolean {
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

/** v7 replay 复算：回执 → 命令事实事件（student_workspace_command_recorded）→ typed evaluator。 */
function reAdjudicateWorkspaceGateV7(
  events: readonly StoredV7Event[],
  resources: readonly PlanResourceV4[],
  beat: NavigatorBeatView,
  receiptSequence: number,
): string | undefined {
  const receipt = events.find((event) => event.sequence === receiptSequence);
  const commandId = receipt ? (receipt.payload as { action_id?: string }).action_id : undefined;
  if (typeof commandId !== "string") return "receipt carries no command id";
  let command: { target_ids?: string[]; params?: { values?: Record<string, unknown> } } | undefined;
  for (const event of events) {
    if (event.event_type !== "student_workspace_command_recorded") continue;
    const candidate = event.payload as unknown as { command_id?: string; target_ids?: string[]; params?: { values?: Record<string, unknown> } };
    if (candidate.command_id === commandId) {
      command = candidate;
      break;
    }
  }
  if (!command) return "no committed command payload for the receipt";
  const resolved = resolveBeatActionTemplate(resources, beat);
  if (!resolved) return "no pinned action template bound to the beat";
  const diagnosis = adjudicateCommandPayload(resolved.template, { target_ids: command.target_ids ?? [], params: command.params });
  return diagnosis.accepted ? undefined : "committed values do not verify against teachingInput";
}
