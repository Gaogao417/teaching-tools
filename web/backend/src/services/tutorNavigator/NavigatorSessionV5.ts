/**
 * NavigatorSessionV5（F5 — Session 与 Protocol Navigator 内核）。
 *
 * headless 教学闭环编排（09-target-architecture §10.2 的 F5 切片）：
 * - session start 的 Plan pin 来自 F4 importer 真实产物（`importApprovedPlanV4`
 *   公开入口，anchored 语义内建；固定题 TP-SMV-009@v1 真实 Approved 链），
 *   不用 fixture 发明教学结构；
 * - 全部成功持久 transition 经 F2 内核（TutorSessionKernelV5.start / append——
 *   只读消费，不修改内核；store 事务内先纯折叠后落库对 navigator 批同样
 *   生效：reducer 拒绝 ⇒ 整批回滚）；
 * - 每轮顺序（计划 §3.3）：append 学生输入事实 → interpreter 假设事实 →
 *   （证据评估 → gate 事实）→ Navigator 确定性裁决 → decision 事实（+
 *   inquiry_opened/returned、ESE、失败 policy_failed）——因果链全程
 *   causation_sequence 可追溯；
 * - G5 对账入口：`kernel.rebuild()` 与在线 state 逐字段一致（F2 comparator
 *   白名单空集），mainline/gate/inquiry/return/barge-in/unclear/out-of-bound
 *   轨迹都由 committed events 重建。
 */
import { importApprovedPlanV4, type ImportedApprovedPlanV4 } from "../planBuild/v4/ImportApprovedPlanV4";
import { readTutorSessionEventsV5 } from "../tutorSession/TutorSessionEventStoreV5";
import type { PendingV5Event, StoredV5Event } from "../tutorSession/TutorSessionEventV5";
import { TutorSessionKernelV5 } from "../tutorSession/TutorSessionKernelV5";
import type { TutorRuntimeStateV5 } from "../tutorSession/TutorRuntimeStateReducerV5";
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
  interpretStudentInput,
  noProgressHypothesis,
  type IntentKind,
  type NavigatorInterpretation,
} from "./SemanticInterpreterV5";
import { evaluateGateEvidence, type GateEvidenceInput } from "./GateEvidenceEvaluatorV5";
import {
  MAX_LOCAL_INQUIRY_STEPS,
  NAVIGATOR_V5_VERSION,
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

export class NavigatorSessionV5 {
  readonly sessionId: string;
  readonly plan: NavigatorPlanV5;
  readonly kernel: TutorSessionKernelV5;
  /** inquiry 打开时的当前 inquiry Beat id（mainline 游标冻结在 state）。 */
  private inquiryBeatId: string | undefined;
  private imported: ImportedApprovedPlanV4;

  private constructor(
    sessionId: string,
    plan: NavigatorPlanV5,
    imported: ImportedApprovedPlanV4,
    kernel: TutorSessionKernelV5,
  ) {
    this.sessionId = sessionId;
    this.plan = plan;
    this.imported = imported;
    this.kernel = kernel;
  }

  /** 启动 navigator 会话：真实 Approved 链导入 → F2 kernel.start（原子 pin）。 */
  static start(input: NavigatorSessionStartInput): NavigatorSessionV5 {
    const imported = importApprovedPlanV4({ canonicalRoot: input.canonicalRoot, anchored: true }, input.tpId ?? GOLDEN_TP_ID);
    if (!imported.ok) {
      throw new Error(`approved plan import failed (fail closed): ${imported.errors.join("; ")}`);
    }
    const plan = buildNavigatorPlan(imported.imported);
    const payload = buildSessionStartedPayload(plan, {
      sessionId: input.sessionId,
      taskId: input.taskId ?? GOLDEN_TASK_ID,
      scenarioId: input.scenarioId ?? GOLDEN_SCENARIO_ID,
    });
    const kernel = TutorSessionKernelV5.start({
      sessionId: input.sessionId,
      studentId: input.studentId,
      sessionStarted: payload,
      occurred_at: new Date().toISOString(),
    });
    const session = new NavigatorSessionV5(input.sessionId, plan, imported.imported, kernel);
    // 起步决策：execute entry Beat（causation→session_started sequence 1）。
    session.commitDecisions(1, [{ kind: "session_start" }]);
    return session;
  }

  get state(): TutorRuntimeStateV5 {
    return this.kernel.state;
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

  private nextSequence(): number {
    return this.events.length + 1;
  }

  private baseContext(): NavigatorContext {
    const events = this.events;
    return {
      sessionId: this.sessionId,
      plan: this.plan,
      state: this.kernel.state,
      revision: this.kernel.revision,
      ...(this.inquiryBeatId !== undefined ? { inquiryBeatId: this.inquiryBeatId } : {}),
      localInquirySteps: deriveLocalInquirySteps(events),
      unresolvedClarifications: deriveUnresolvedClarifications(events),
    };
  }

  private append(revision: number, events: PendingV5Event[]): { revision: number; sequences: number[] } {
    const result = this.kernel.append(revision, events);
    return { revision: result.revision, sequences: result.appendedSequences };
  }

  /**
   * 接受学生输入（真实提交路径）：intent 事实 → interpreter 假设事实 →
   * （gate 评估事实）→ Navigator 决策事实（或显式 policy_failed）。
   */
  acceptStudentIntent(input: StudentIntentInput): TurnResult {
    if (
      (input.intent_kind === "submit_answer" || input.intent_kind === "ask_question") &&
      (input.text === undefined || input.text.length === 0)
    ) {
      throw new Error(`${input.intent_kind} requires text (canonical mirror rule)`);
    }
    let revision = this.kernel.revision;
    const intentSequence = this.nextSequence();
    const intentPayload: Record<string, unknown> = {
      intent_kind: input.intent_kind,
      client_request_id: input.client_request_id,
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.workspace_command ? { workspace_command: input.workspace_command } : {}),
    };
    ({ revision } = this.append(revision, [
      { event_type: "student_intent_recorded", payload: intentPayload, occurred_at: nowIso() },
    ]));

    const hypothesis = interpretStudentInput(this.plan, {
      intent_kind: input.intent_kind,
      ...(input.text !== undefined ? { text: input.text } : {}),
      beat: this.currentBeat,
    });
    return this.interpretAndDecide(revision, intentSequence, input.intent_kind, input.text, hypothesis);
  }

  /** narration 完成（voice issued + outcome completed 事实），再经 Navigator 裁决。 */
  completeNarration(options: { resourceRef?: string; text?: string } = {}): TurnResult & { advanced: boolean } {
    let revision = this.kernel.revision;
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
          payload: { policy_version: NAVIGATOR_V5_VERSION, failure_class: outcome.failure.failure_class, fallback_used: false },
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
   *   测试/F6 前由调用方经 kernel.append 提交——Navigator 永不代写）。
   * 任一缺失即 fail closed（抛错、零事件追加）——没有回执就没有证据。
   * 孤儿/不匹配回执在持久化/重建边界已被 F2 reducer 拒绝（R0 §5 两层落点），
   * 本层只消费合法 committed 回执。
   */
  consumeWorkspaceCommandOutcome(input: { command_id: string }): TurnResult {
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
      return { revision: this.kernel.revision, intentSequence: receipt.sequence };
    }
    const assessment = evaluateGateEvidence(this.plan, beat, {
      confirmation_sequences: [],
      submitted_answers: [],
      workspace_outcomes: [{ capability: intent.capability, outcome: receipt.outcome, sequence: receipt.sequence }],
      narration_completed: false,
    });
    return this.evaluateGateAndDecide(this.kernel.revision, receipt.sequence, gate.gate_id, beat.beat_id, assessment.satisfied, assessment.evidence_sequence);
  }

  /**
   * silence/无进展证据（R0 §1：no_progress 来自 silence/timeout/无新事实）：
   * 落 semantic_interpretation_recorded(reasoning_alignment=no_progress) 事实
   * → Navigator 裁决（主线=澄清门禁；inquiry 内=bounded 强制返回）。
   */
  reportSilence(): TurnResult {
    const revision = this.kernel.revision;
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
    return this.commitDecisions(this.kernel.revision, [
      outcome.ok
        ? { kind: "plain", sequence, decision: outcome.decision }
        : { kind: "failed", sequence, failure: outcome.failure },
    ]);
  }

  /** bounded_wait 超时（计时结束不能替代证据——只走 timeout 出边或安全 fallback）。 */
  reportTimeout(): TurnResult {
    const revision = this.kernel.revision;
    const anchor = this.events[this.events.length - 1]?.sequence ?? 1;
    const beat = this.currentBeat;
    const outcome = decideNavigation(this.baseContext(), { kind: "timeout", sequence: anchor, beat_id: beat.beat_id });
    if (!outcome.ok) {
      const failed = this.append(revision, [
        {
          event_type: "policy_failed",
          payload: { policy_version: NAVIGATOR_V5_VERSION, failure_class: outcome.failure.failure_class, fallback_used: false },
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
  // 内部：interpret → (gate) → decide → 持久化
  // ------------------------------------------------------------------ //

  private interpretAndDecide(
    revision: number,
    intentSequence: number,
    intentKind: IntentKind,
    text: string | undefined,
    hypothesis: NavigatorInterpretation,
  ): TurnResult {
    const interpretationSequence = this.nextSequence();
    const interpretationEvent: PendingV5Event = {
      event_type: "semantic_interpretation_recorded",
      payload: hypothesisEventPayload(hypothesis),
      occurred_at: nowIso(),
      causation_sequence: intentSequence,
    };
    const batch: PendingV5Event[] = [interpretationEvent];

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
        submitted_answers: intentKind === "submit_answer" && text !== undefined ? [{ text, sequence: intentSequence }] : [],
        workspace_outcomes: [],
        narration_completed: false,
      };
      const gateRelevant =
        (evidenceKind === "student_confirmation" || evidenceKind === "explicit_gate_pass") && isConfirmationIntent(intentKind);
      // 替代路线作答不是当前 gate 的证据（是另一条合法数学路径的提案）：
      // 不做 gate 评估，直接交 Navigator 验证 SV 后 accept_alternate_path。
      const answerRelevant = evidenceKind === "student_answer" && intentKind === "submit_answer" && !hypothesis.matched_variant_id;
      if (gateRelevant || answerRelevant) {
        const assessment = evaluateGateEvidence(this.plan, beat, evidenceInput);
        gateSequence = this.nextSequence() + batch.length; // interpretation 之后
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
    const appended = this.append(revision, batch);
    void appended;

    const result = this.commitDecisions(this.kernel.revision, [
      outcome.ok
        ? { kind: "plain", sequence: trigger.sequence, decision: outcome.decision }
        : { kind: "failed", sequence: trigger.sequence, failure: outcome.failure },
    ]);
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
    this.append(revision, [
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
    ]);
    const outcome = decideNavigation(this.baseContext(), {
      kind: "gate_evaluated",
      sequence: gateSequence,
      gate_id: gateId,
      beat_id: beatId,
      satisfied,
      ...(evidenceRef !== undefined ? { evidence_sequence: evidenceRef } : {}),
    });
    return this.commitDecisions(this.kernel.revision, [
      outcome.ok
        ? { kind: "plain", sequence: gateSequence, decision: outcome.decision }
        : { kind: "failed", sequence: gateSequence, failure: outcome.failure },
    ]);
  }

  private commitDecisions(
    revision: number,
    items: ReadonlyArray<
      | { kind: "session_start" }
      | { kind: "plain"; sequence: number; decision: NavigatorDecision }
      | { kind: "gate_from_narration"; sequence: number; decision: NavigatorDecision }
      | { kind: "failed"; sequence: number; failure: { failure_class: string; message: string } }
    >,
  ): TurnResult {
    const batch: PendingV5Event[] = [];
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
          payload: { policy_version: NAVIGATOR_V5_VERSION, failure_class: item.failure.failure_class, fallback_used: false },
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
    return this.kernel.assertReplayParity();
  }
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
