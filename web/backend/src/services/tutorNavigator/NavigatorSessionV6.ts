/**
 * NavigatorSessionV6（F7 Step 3 — V6 Session Kernel 上的 Navigator 会话壳）。
 *
 * 决策引擎零重写：decideNavigation / SemanticInterpreterV5 / GateEvidenceEvaluator /
 * ModelGateAdjudicatorV5 / NavigatorPlanV5 全部纯模块原样复用（PLAN.md Step 3
 * 「保留现有 Navigator」）。本类只做**会话壳的 v6 适配**：
 * - kernel = TutorSessionKernelV6（event_schema='v6'；registryProvider 注入）；
 * - 输入链（ADR-011 决策 6）：先独立批落 `student_input_recorded`（原始
 *   utterance{channel,text} | control 七值——输入事实先于模型调用持久化，R3
 *   纪律保留），再同批原子 append `semantic_interpretation_recorded` +
 *   `student_intent_recorded`（causation→input、同 client_request_id——增补 10 #2
 *   跨事件门禁由 kernel reducer 强制）+（gate）+ decision；
 * - **不写** v6 已删事件：voice_action_issued / voice action_outcome_recorded
 *   （tutor 呈现改由 Orchestrator 的 presentation 序列承载）；open_scaffold 的
 *   scaffold 叙述因此不再由本类内联——由编排层呈现序列承载（行为等价迁移）；
 * - utterance 解释归属后端：mainline → submit_answer 语义、assistance →
 *   ask_question 语义（channel 是入口事实；语义只由本解释器产生）；
 * - 幂等：同 client_request_id 的已提交判断 → 读已 committed 轮返回，零新事件
 *   （输入已落库但判断未提交的崩溃窗口 → 复用 input sequence，不重复持久化）。
 */
import type { ImportedApprovedPlanV5 } from "../planBuild/v5/ImportApprovedPlanV5";
import type { PendingV6Event, StoredV6Event, V6StudentInputBody } from "../tutorSession/TutorSessionEventV6";
import { TutorSessionKernelV6 } from "../tutorSession/TutorSessionKernelV6";
import type { V6RegistryProvider } from "../tutorSession/RuntimeStateRebuilderV6";
import { readTutorSessionEventsV6 } from "../tutorSession/WorkspaceRuntimeReducerV6";
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
  interpretationMatchScore,
  interpretStudentInput,
  isNaturalLanguageInput,
  type IntentKind,
  type NavigatorInterpretation,
} from "./SemanticInterpreterV5";
import { evaluateGateEvidence, type GateEvidenceInput } from "./GateEvidenceEvaluatorV5";
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
import { reconstructInquiryBeatId, verifyGateAttributionAgainstPlan } from "./NavigatorSessionV5";

/** v6 会话壳的公共输入（binding 由编排层经 resolver 唯一解析后拆开注入）。 */
export interface NavigatorV6SessionInput {
  readonly sessionId: string;
  readonly plan: NavigatorPlanV5;
  readonly imported: ImportedApprovedPlanV5;
  readonly registryProvider: V6RegistryProvider;
  readonly gateProvider?: GateAdjudicationProvider;
  readonly modelTimeoutMs?: number;
}

export interface NavigatorV6StartInput extends NavigatorV6SessionInput {
  readonly studentId: string;
  readonly taskId: string;
  readonly scenarioId: string;
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
}

export interface StudentInputTurnInput {
  /** canonical student-input/v1 的 input 判别联合（utterance|control）。 */
  readonly input: V6StudentInputBody;
  readonly client_request_id: string;
}

export interface V6TurnResult {
  readonly revision: number;
  readonly inputSequence: number;
  readonly interpretationSequence?: number;
  readonly gateSequence?: number;
  readonly decisionSequence?: number;
  readonly decision?: NavigatorDecision;
  readonly failure?: { failure_class: string; message: string };
}

/** control 七值 → IntentKind 确定性映射（retry_recovery 由编排层先行处理）。 */
function intentKindOfInput(input: V6StudentInputBody): IntentKind {
  if (input.kind === "utterance") {
    return input.channel === "assistance" ? "ask_question" : "submit_answer";
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
 * 同 client_request_id 的已提交轮次（幂等重试读取；v6 版）：input 事实 → 派生
 * intent（causation→input）→ gate/decision（trigger 序列集与 v5 同推导）。
 */
function findCommittedV6Turn(events: readonly StoredV6Event[], clientRequestId: string): {
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
    if (event.event_type === "student_intent_recorded" && event.causation_sequence === inputSequence) {
      intentSequence = event.sequence;
      continue;
    }
    if (intentSequence === undefined) continue;
    const turnSequences = new Set<number>([inputSequence, intentSequence]);
    if (interpretationSequence !== undefined) turnSequences.add(interpretationSequence);
    if (gateSequence !== undefined) turnSequences.add(gateSequence);
    if (event.event_type === "semantic_interpretation_recorded" && event.causation_sequence === inputSequence) {
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

export class NavigatorSessionV6 {
  readonly sessionId: string;
  readonly plan: NavigatorPlanV5;
  private readonly registryProvider: V6RegistryProvider;
  private kernelRef: TutorSessionKernelV6;
  private readonly adjudicator: ModelGateAdjudicatorV5;
  private inquiryBeatId: string | undefined;
  private readonly imported: ImportedApprovedPlanV5;

  private constructor(input: NavigatorV6SessionInput, kernel: TutorSessionKernelV6) {
    this.sessionId = input.sessionId;
    this.plan = input.plan;
    this.imported = input.imported;
    this.registryProvider = input.registryProvider;
    this.kernelRef = kernel;
    this.adjudicator = new ModelGateAdjudicatorV5(input.gateProvider ?? new UnavailableGateProvider(), {
      ...(input.modelTimeoutMs !== undefined ? { timeoutMs: input.modelTimeoutMs } : {}),
    });
  }

  /** 启动 v6 会话：kernel.start（原子 pin + event_schema='v6'）+ 起步 execute_beat 决策。 */
  static start(input: NavigatorV6StartInput): NavigatorSessionV6 {
    const payload = {
      ...buildSessionStartedPayload(input.plan, {
        sessionId: input.sessionId,
        taskId: input.taskId,
        scenarioId: input.scenarioId,
      }),
      ...(input.sessionStartedPins?.workspace_catalog_pin
        ? { workspace_catalog_pin: input.sessionStartedPins.workspace_catalog_pin }
        : {}),
      ...(input.sessionStartedPins?.model_gate_pin
        ? { model_gate_pin: input.sessionStartedPins.model_gate_pin }
        : {}),
    };
    const kernel = TutorSessionKernelV6.start({
      sessionId: input.sessionId,
      studentId: input.studentId,
      sessionStarted: payload,
      occurred_at: nowIso(),
    }, input.registryProvider);
    const session = new NavigatorSessionV6(input, kernel);
    session.commitDecisions(1, [{ kind: "session_start" }]);
    return session;
  }

  /**
   * 恢复：kernel verified rebuild（v5 会话行 → SESSION_VERSION_UNSUPPORTED）+
   * pinned Plan 逐事件 gate 归属核对（与 v5 同一函数；只读结构 adapter）。
   * 零模型调用。
   */
  static resume(input: NavigatorV6SessionInput): NavigatorSessionV6 {
    const kernel = TutorSessionKernelV6.resume(input.sessionId, input.registryProvider, {
      expectedTutorPlanRef: input.plan.tutor_plan_ref,
    });
    const events = readTutorSessionEventsV6(input.sessionId, input.registryProvider);
    verifyGateAttributionAgainstPlan(
      input.plan,
      input.imported.plan.resources,
      events as unknown as readonly StoredV5Event[],
    );
    const session = new NavigatorSessionV6(input, kernel);
    session.inquiryBeatId = reconstructInquiryBeatId(events as unknown as readonly StoredV5Event[]);
    return session;
  }

  get state(): TutorRuntimeStateV5 {
    // v6 state = v1 全字段 + presentation_cursor（结构超集；决策引擎只读 v1 面）。
    return this.kernelRef.state as unknown as TutorRuntimeStateV5;
  }

  get revision(): number {
    return this.kernelRef.revision;
  }

  get events(): StoredV6Event[] {
    return readTutorSessionEventsV6(this.sessionId, this.registryProvider);
  }

  /** F2 事实内核（只读暴露：V6 orchestrator 在此驱动 presentation 事件；本类不改其行为）。 */
  get kernel(): TutorSessionKernelV6 {
    return this.kernelRef;
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
   * （自然语言）模型裁决 → interpretation + intent（causation→input）+（gate）
   * + decision 同批原子 append。同 client_request_id 重试读已提交判断。
   */
  async submitStudentInput(input: StudentInputTurnInput): Promise<V6TurnResult> {
    if (input.input.kind === "utterance" && (input.input.text === undefined || input.input.channel === undefined)) {
      throw new Error("kind=utterance requires channel and text (canonical mirror rule)");
    }
    if (input.input.kind === "control" && input.input.command === undefined) {
      throw new Error("kind=control requires command (canonical mirror rule)");
    }
    const intentKind = intentKindOfInput(input.input);
    const text = input.input.kind === "utterance" ? input.input.text : undefined;
    if ((intentKind === "submit_answer" || intentKind === "ask_question") && (text === undefined || text.length === 0)) {
      throw new Error(`${intentKind} requires text (canonical mirror rule)`);
    }
    // 幂等重试：同 client_request_id 已有 committed 判断（intent 已落）→ 读已
    // 提交判断返回，不重复落 input、不重复裁决（零新事件）。
    const committed = findCommittedV6Turn(this.events, input.client_request_id);
    if (committed?.decisionSequence !== undefined || committed?.failure !== undefined) {
      const { intentSequence, ...rest } = committed;
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
          idempotency_key: `si:${this.sessionId}:${input.client_request_id}`,
        },
      ]);
      inputSequence = appended.appendedSequences[0];
      revision = appended.revision;
    }

    // 自然语言 → 单次模型裁决（R3：模型失败=runtime_failure 事实 + unclear 降级，
    // 非 student incorrect）；结构化输入走确定性解释器。
    // gate assessment 的 evidence_sequence 指向 intent 事件（resume 的 gate
    // 归属核对只采信 student_intent_recorded——v5 同口径）；intent 序列按批
    // 布局预测（[runtime_failure?] + interpretation + intent）。
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

  /** 对当前（inquiry-aware）Beat 产出 execute_beat 呈现决策（与 v5 同型）。 */
  executeCurrentBeat(): V6TurnResult {
    const revision = this.kernelRef.revision;
    const anchor = this.events[this.events.length - 1]?.sequence ?? 1;
    const outcome = decideNavigation(this.baseContext(), { kind: "beat_execution", sequence: anchor });
    if (!outcome.ok) {
      return this.commitPolicyFailure(revision, anchor, outcome.failure.failure_class, outcome.failure.message);
    }
    return this.commitDecisions(revision, [{ kind: "plain", sequence: anchor, decision: outcome.decision }]);
  }

  /** timeout 等无输入触发轮（与 v5 同型）。 */
  reportTimeout(): V6TurnResult {
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
  ): V6TurnResult {
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

  private interpretAndDecide(
    revision: number,
    inputSequence: number,
    clientRequestId: string,
    intentKind: IntentKind,
    text: string | undefined,
    hypothesis: NavigatorInterpretation,
    modelFailure?: { reason: string; detail: string },
  ): V6TurnResult {
    const batch: PendingV6Event[] = [];
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
    batch.push({
      event_type: "semantic_interpretation_recorded",
      payload: hypothesisEventPayload(hypothesis),
      occurred_at: nowIso(),
      causation_sequence: inputSequence,
    });
    // v6 输入链：intent 是后端解释器派生事实（causation→input、同
    // client_request_id——kernel reducer 增补 10 #2 门禁强制）。
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
    // gate 归属核对的 evidence 面：student_intent_recorded 是学生证据事件
    //（verifyGateAttributionAgainstPlan 与 v5 同判读）。
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
      inputSequence,
      interpretationSequence,
      ...(gateSequence !== undefined ? { gateSequence } : {}),
    };
  }

  private commitDecisions(
    revision: number,
    items: ReadonlyArray<
      | { kind: "session_start" }
      | { kind: "plain"; sequence: number; decision: NavigatorDecision }
      | { kind: "failed"; sequence: number; failure: { failure_class: string; message: string } }
    >,
    prefixBatch: PendingV6Event[] = [],
  ): V6TurnResult {
    const batch: PendingV6Event[] = [...prefixBatch];
    const results: V6TurnResult[] = [];
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
      // companion 事实：inquiry 生命周期 + 收束（与 v5 同形状）。v6 差异：
      // open_scaffold 不再内联 voice_action_issued（v6 词表已删）——scaffold
      // 叙述由编排层的 presentation 序列承载（external_support_recorded 亦随
      // 编排层呈现批次产生）。
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
          this.inquiryBeatId = inquiry.inquiry_protocol_id
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
        this.inquiryBeatId = undefined;
      }
      if (decision.decision_kind === "continue_inquiry" && decision.inquiry?.inquiry_protocol_id) {
        this.inquiryBeatId = decision.beat_id;
      }
      if (decision.decision_kind === "complete_beat" && !this.state.completed) {
        batch.push({
          event_type: "session_completed",
          payload: { final_beat_id: decision.beat_id, completed_parts: [this.currentBeat.part_id ?? "1"] },
          occurred_at: nowIso(),
        });
      }
      results.push({ revision: currentRevision, inputSequence: item.sequence, decisionSequence, decision });
    }
    if (batch.length) {
      const appended = this.append(currentRevision, batch);
      currentRevision = appended.revision;
    }
    const last = results[results.length - 1];
    return { ...last, revision: currentRevision };
  }

  private decisionEvent(decisionSequence: number, decision: NavigatorDecision, causation: number): PendingV6Event {
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

  private append(revision: number, events: PendingV6Event[]): { revision: number; sequences: number[] } {
    const result = this.kernelRef.append(revision, events);
    return { revision: result.revision, sequences: result.appendedSequences };
  }

  private nextSequence(): number {
    return this.events.length + 1;
  }
}
