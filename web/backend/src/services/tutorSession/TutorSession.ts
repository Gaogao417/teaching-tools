/**
 * TutorSessionCoordinator（Phase 5 / P5-01/03/09/11/12/13，PRD 04 §3）。
 *
 * 最小闭环：`Plan + TutorRuntimeState + StudentEvent → TutorMove →
 * Voice/WorkspaceAction → new State`。每轮教学：
 *   读取 committed state → 接收 StudentEvent/系统完成事件 → Policy 决策 →
 *   tutor_move_decided → Presenter 派生呈现 → 安全校验 → issued/hint/
 *   repair/诊断事件同批落库（一个 revision）→ 等待下一条输入。
 *
 * 关键不变量（ADR-006）：
 * - 只读 Approved、version-pinned、hash-verified Plan（loadCurrentPlan +
 *   pinned restore 双路径；registry 漂移使 projection hash 失配 → fail closed）；
 * - 每个 TutorDecision 关联 source event/state revision/policy version；
 * - state 是 projection：restore = plan + events 全量 replay（无快照）;
 * - feature flag：新 Policy 只对 golden plan 开放（STATEFUL_TUTOR_POLICY_V1
 *   默认 on；非 golden plan 拒绝启动）；
 * - Assessment fail closed：assessment 会话不允许启动教学闭环；
 * - working diagnosis 的 evidence 只能引用非失败事件（P5-14）。
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import type { ActionEvidence, AuthoredActionTemplate } from "../../../../shared/actionRuntime";
import {
  type Alignment,
  type InputKind,
  type MoveType,
  type PendingV2Event,
  type SessionMode,
  type StoredV2Event,
  type VoiceSource,
  type V2EventType,
  decisionId,
  voiceActionId,
  workspaceActionId,
  STUDENT_FACT_EVENT_TYPES,
} from "./TutorSessionEvent";
import {
  appendTutorSessionEventsV2,
  getTutorSession,
  readTutorSessionEventsV2,
  setTutorSessionMode,
  startTutorSession,
  TutorSessionEventStoreError,
} from "./TutorSessionEventStore";
import { projectRuntimeState, type TutorRuntimeState } from "./TutorRuntimeStateProjection";
import { alignReasoning, type AlignmentOutcome } from "./ReasoningAligner";
import {
  type TutorPlanV2Payload,
  type TruthPayload,
  canonicalHash,
  loadApprovedApproach,
  loadApprovedTruth,
  loadCurrentPlan,
  truthAnswerForPart,
} from "../planBuild/canonicalInputs";
import { projectApprovedPlan, type RuntimeProjectionBody } from "../planBuild/MaterializeTutorPlan";
import { buildRuntimeRegistrySnapshot, type RuntimeRegistrySnapshot } from "../planBuild/RuntimeRegistrySnapshot";
import { createDecideTutorMove } from "../tutorPolicy/DecideTutorMove";
import { deterministicRulesPolicy } from "../tutorPolicy/adapters/model/deterministicRulesPolicy";
import type { TutorPolicyPort, PolicyTrigger } from "../tutorPolicy/TutorPolicyPort";
import type { TutorDecision, TutorDecisionDraft } from "../tutorPolicy/TutorMove";
import {
  preparePresentation,
  resolveWorkspacePresentation,
  type ValidatedPresentation,
} from "../tutorPresentation/PreparePresentation";
import type { VoiceActionPlan, WorkspaceActionPlan, ValidatedWorkspaceAction } from "../tutorPresentation";
import { evaluateWorkspaceEvidence } from "../tutorPresentation/adapters/legacyActionRuntime/workspaceActionAdapter";
import type { TutorPolicyGraph } from "../tutorIntelligence/policyGraph";
import { createTutorPolicyGraph } from "../tutorIntelligence/policyGraph";
import type { StudentTurnInput, RecentEventFact } from "../tutorIntelligence/proposal";
import type { StructuredModelPort } from "../tutorIntelligence/structuredModelPort";
import { DeepSeekStructuredModel } from "../tutorIntelligence/adapters/deepseek/DeepSeekStructuredModel";
import { FakeStructuredModel } from "../tutorIntelligence/adapters/fake/FakeStructuredModel";
import { recordTurnTelemetry } from "./turnTelemetry";

/** feature flag 白名单（gate 6：只对 golden plan 启用新 Policy）。 */
export const STATEFUL_TUTOR_POLICY_GOLDEN_PLANS: readonly string[] = [
  "TP-SMV-001",
  "TP-SMV-002",
  "TP-SMV-003",
  "TP-SMV-004",
  "TP-SMV-005",
  "TP-SMV-006",
];

export function statefulTutorPolicyEnabled(tpId: string): boolean {
  const flag = process.env.STATEFUL_TUTOR_POLICY_V1 ?? "on";
  if (flag === "all") return true;
  if (flag === "off") return false;
  return STATEFUL_TUTOR_POLICY_GOLDEN_PLANS.includes(tpId);
}

export class TutorSessionCoordinatorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TutorSessionCoordinatorError";
    this.code = code;
  }
}

export interface TutorSessionDeps {
  canonicalRoot: string;
  policy?: TutorPolicyPort;
  policyTimeoutMs?: number;
  now?: () => string;
  /** 智能链（deepseek-langgraph）：提供时 processTurn 走 LangGraph 提案路径；
   *  recordStudentInput/driveTutorTurn 保留 deterministic 回滚口径。 */
  intelligence?: TutorPolicyGraph;
}

export interface StartTutorSessionOptions {
  sessionId: string;
  studentId: string;
  tpId: string;
  initialMode?: SessionMode;
  sessionKind?: "tutoring" | "assessment";
}

export interface StudentInput {
  input_kind: InputKind;
  text?: string;
  object_id?: string;
  duration_ms?: number;
}

export interface RecordInputResult {
  input_sequence: number;
  alignment?: AlignmentOutcome;
  progressed?: boolean;
  self_corrected?: boolean;
  appendedSequences: number[];
}

export interface TurnResult {
  decision: TutorDecision | null;
  /**
   * 学生安全呈现（2026-08-21 追加裁定 §6）：workspace 只含已过五重校验的
   * ValidatedWorkspaceAction（学生面投影，无 learn_contract/localTruth）；
   * 未验证草案不会出现在这里，也不会签发 workspace_action_issued。
   */
  presentation: ValidatedPresentation;
  policy_failed?: { failure_class: string; fallback_used: boolean };
  appendedSequences: number[];
}

/** processTurn 输入面（Phase 5 remediation / 完整收口计划 §2）：
 *  六类学生输入 + structured_action_evidence 的 typed evaluator 证据。 */
export interface ProcessTurnInput extends StudentInput {
  action_evidence?: ActionEvidence;
}

export type TurnFailureCode =
  | "SESSION_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "COMPLETED_SESSION"
  | "INVALID_INPUT"
  | "NO_ACTIVE_ACTION";

export interface TurnFailure {
  code: TurnFailureCode;
  message: string;
  /** REVISION_CONFLICT 时的 resync 载荷（当前 revision + 学生安全状态）。 */
  resync?: { revision: number; current_checkpoint_id: string };
}

/** 学生安全回合响应（不含答案真值与模型私有推理）。 */
export interface TutorTurnResponse {
  session_id: string;
  revision: number;
  client_turn_id: string;
  idempotent_replay: boolean;
  mode: SessionMode;
  current_checkpoint: { checkpoint_id: string; part_id: string; route_id: string };
  alignment?: {
    alignment: Alignment;
    checkpoint_id?: string;
    route_id?: string;
    confidence?: number;
  };
  decision: {
    decision_id: string;
    move_type: MoveType;
    purpose_code: string;
    policy_version: string;
    fallback?: boolean;
  } | null;
  voice: Array<{ action_id: string; text: string; interruptible: boolean; voice_source?: VoiceSource }>;
  workspace: ValidatedWorkspaceAction[];
  fallback?: { used: boolean; failure_class?: string };
  event_cursor: number;
}

interface SessionContext {
  plan: TutorPlanV2Payload;
  projection: RuntimeProjectionBody;
  snapshot: RuntimeRegistrySnapshot;
  truth: TruthPayload;
  answerValuesByPart: Map<string, string[]>;
  eventSchema: "v2" | "v3";
}

export function createTutorSessionCoordinator(deps: TutorSessionDeps) {
  const decide = createDecideTutorMove(deps.policy ?? deterministicRulesPolicy, {
    timeoutMs: deps.policyTimeoutMs,
  });
  const now = deps.now ?? (() => new Date().toISOString());
  const contexts = new Map<string, SessionContext>();

  // ------------------------------------------------------------------ //
  // plan 装载（start 用 current Approved；restore 用 pinned version）
  // ------------------------------------------------------------------ //

  function answerValuesFor(truth: TruthPayload, partId: string): string[] {
    const answer = truthAnswerForPart(truth, partId);
    if (!answer) return [];
    return [answer.value, ...(answer.acceptance ?? [])].filter((value) => typeof value === "string" && value.length > 0);
  }

  function buildContext(plan: TutorPlanV2Payload, eventSchema: "v2" | "v3" = "v3"): SessionContext {
    const truthResult = loadApprovedTruth({ canonicalRoot: deps.canonicalRoot }, plan.question_ref.artifact_id);
    if (!truthResult.ok) {
      throw new TutorSessionCoordinatorError(
        "TRUTH_MISSING",
        `plan ${plan.artifact_id} 引用的 ${plan.question_ref.artifact_id} 不可读：${truthResult.errors.join("; ")}`,
      );
    }
    const snapshot = buildRuntimeRegistrySnapshot();
    const approaches = new Map();
    for (const ref of plan.approach_refs) {
      const approach = loadApprovedApproach({ canonicalRoot: deps.canonicalRoot }, ref.artifact_id);
      if (approach.ok) approaches.set(ref.artifact_id, approach.payload);
    }
    const projectionResult = projectApprovedPlan(plan, { truth: truthResult.payload, approaches, snapshot });
    if (plan.runtime_projection && plan.runtime_projection.projection_hash !== projectionResult.projection_hash) {
      throw new TutorSessionCoordinatorError(
        "PROJECTION_DRIFT",
        `plan ${plan.artifact_id}@${plan.version} 的 projection hash 与当前 materializer/registry 重算不一致（registry 漂移 fail closed）`,
      );
    }
    const projection = projectionResult.projection;
    const answerValuesByPart = new Map<string, string[]>();
    for (const checkpoint of plan.checkpoints) {
      if (!answerValuesByPart.has(checkpoint.part_id)) {
        answerValuesByPart.set(checkpoint.part_id, answerValuesFor(truthResult.payload, checkpoint.part_id));
      }
    }
    return { plan, projection, snapshot, truth: truthResult.payload, answerValuesByPart, eventSchema };
  }

  function contextFor(sessionId: string): SessionContext {
    const cached = contexts.get(sessionId);
    if (cached) return cached;
    const row = getTutorSession(sessionId) as
      | { plan_artifact_id: string; plan_version: string; plan_content_hash: string; event_schema: string }
      | undefined;
    if (!row) throw new TutorSessionCoordinatorError("SESSION_NOT_FOUND", `unknown session: ${sessionId}`);
    if (row.event_schema !== "v2" && row.event_schema !== "v3") {
      throw new TutorSessionCoordinatorError("LEGACY_SESSION", `session ${sessionId} 是 v1 合同，走遗留读取路径`);
    }
    // pinned restore：按会话行记录的版本装载（Superseded 也可恢复，hash 必须一致）
    const versionPath = path.join(
      deps.canonicalRoot,
      "tutor-plan",
      row.plan_artifact_id,
      `${row.plan_version}.json`,
    );
    if (!existsSync(versionPath)) {
      throw new TutorSessionCoordinatorError("PLAN_PINNED_MISSING", `pinned plan 版本文件缺失: ${versionPath}`);
    }
    const plan = JSON.parse(readFileSync(versionPath, "utf8")) as TutorPlanV2Payload;
    const recomputed = canonicalHash(plan as unknown as Record<string, unknown>, "plan");
    if (recomputed !== row.plan_content_hash || plan.content_hash !== row.plan_content_hash) {
      throw new TutorSessionCoordinatorError("PLAN_HASH_DRIFT", `pinned plan ${row.plan_artifact_id}@${row.plan_version} hash 不一致`);
    }
    const context = buildContext(plan, row.event_schema);
    contexts.set(sessionId, context);
    return context;
  }

  function loadSession(sessionId: string): { context: SessionContext; events: StoredV2Event[]; state: TutorRuntimeState; revision: number } {
    const context = contextFor(sessionId);
    const events = readTutorSessionEventsV2(sessionId);
    const state = projectRuntimeState(context.plan, events);
    const row = getTutorSession(sessionId) as { revision: number } | undefined;
    return { context, events, state, revision: row?.revision ?? 0 };
  }

  function appendBatch(sessionId: string, revision: number, batch: PendingV2Event[]): number[] {
    const result = appendTutorSessionEventsV2(sessionId, revision, batch);
    return result.appendedSequences;
  }

  // ------------------------------------------------------------------ //
  // start / restore
  // ------------------------------------------------------------------ //

  function start(options: StartTutorSessionOptions): { session_id: string; plan_ref: { artifact_id: string; version: string; content_hash: string } } {
    if (options.sessionKind === "assessment") {
      throw new TutorSessionCoordinatorError(
        "ASSESSMENT_FAIL_CLOSED",
        "Assessment 会话禁止启动生成式教学闭环（ADR-006 不变量 6）",
      );
    }
    if (!statefulTutorPolicyEnabled(options.tpId)) {
      throw new TutorSessionCoordinatorError(
        "FEATURE_FLAG_OFF",
        `stateful tutor policy 未对 ${options.tpId} 开放（feature flag gate）`,
      );
    }
    const planResult = loadCurrentPlan({ canonicalRoot: deps.canonicalRoot }, options.tpId);
    if (!planResult.ok) {
      throw new TutorSessionCoordinatorError("PLAN_NOT_APPROVED", planResult.errors.join("; "));
    }
    const plan = planResult.payload;
    // Phase 5 remediation：新会话一律 event_schema=v3（智能链 provenance）；
    // v1/v2 旧会话只读可恢复（readTutorSessionEventsV2 按会话行分派）。
    const context = buildContext(plan, "v3");
    startTutorSession({
      sessionId: options.sessionId,
      studentId: options.studentId,
      plan: { artifact_id: plan.artifact_id, version: plan.version, content_hash: plan.content_hash },
      eventSchema: "v3",
    });
    contexts.set(options.sessionId, context);
    const initialMode = options.initialMode ?? "teach";
    appendBatch(options.sessionId, 0, [
      {
        event_type: "session_started",
        payload: {
          plan: { artifact_id: plan.artifact_id, version: plan.version, content_hash: plan.content_hash },
          initial_mode: initialMode,
        },
        occurred_at: now(),
      },
    ]);
    if (initialMode !== "teach") setTutorSessionMode(options.sessionId, initialMode);
    return {
      session_id: options.sessionId,
      plan_ref: { artifact_id: plan.artifact_id, version: plan.version, content_hash: plan.content_hash },
    };
  }

  /** gate 2：event replay 重建五类 state（无快照，纯 plan+events 投影）。 */
  function restore(sessionId: string): TutorRuntimeState {
    return loadSession(sessionId).state;
  }

  function getEvents(sessionId: string): StoredV2Event[] {
    return readTutorSessionEventsV2(sessionId);
  }

  // ------------------------------------------------------------------ //
  // 学生输入（P5-04）与对齐（P5-05）
  // ------------------------------------------------------------------ //

  function pendingVoiceActions(events: readonly StoredV2Event[]): Array<{ action_id: string; sequence: number }> {
    const issued = new Map<string, number>();
    const completed = new Set<string>();
    for (const event of events) {
      if (event.event_type === "voice_action_issued") {
        issued.set((event.payload as { action_id: string }).action_id, event.sequence);
      }
      if (event.event_type === "voice_action_completed") {
        completed.add((event.payload as { action_id: string }).action_id);
      }
    }
    return [...issued.entries()]
      .filter(([actionId]) => !completed.has(actionId))
      .map(([actionId, sequence]) => ({ action_id: actionId, sequence }));
  }

  function assistanceSinceDeviation(
    state: TutorRuntimeState,
    events: readonly StoredV2Event[],
    checkpointId: string,
    deviationSequence: number,
  ): boolean {
    const ledger = state.assistance[checkpointId];
    if (!ledger) return false;
    if (ledger.lastHintSequence !== undefined && ledger.lastHintSequence > deviationSequence) return true;
    if (ledger.explainedSequences.some((sequence) => sequence > deviationSequence)) return true;
    const repairDelivered = events.some(
      (event) =>
        event.event_type === "repair_delivered" &&
        (event.payload as { source_checkpoint_id?: string }).source_checkpoint_id === checkpointId &&
        event.sequence > deviationSequence,
    );
    return repairDelivered;
  }

  /** 对齐后果事件批（self-correction / progression；供 recordStudentInput 与
   *  智能链 processTurn 共用——两条路径的 progression 口径必须一致）。
   *  offset = 对齐事件前一事件的 sequence（alignmentSequence = offset + 1）。 */
  function alignmentFactBatch(args: {
    context: SessionContext;
    state: TutorRuntimeState;
    events: readonly StoredV2Event[];
    alignment: AlignmentOutcome;
    /** 对齐事件前一事件的 sequence（输入事件或更早同批事件）。 */
    offset: number;
    causationInputSequence: number;
    v3?: { confidence?: number; grounding_refs?: string[]; aligner_version?: string; workflow_version?: string; route_id?: string };
  }): { batch: PendingV2Event[]; progressed: boolean; selfCorrected: boolean } {
    const { context, state, events, alignment } = args;
    const batch: PendingV2Event[] = [];
    const alignmentSequence = args.offset + 1;
    batch.push({
      event_type: "reasoning_aligned",
      payload: {
        alignment: alignment.alignment,
        ...(alignment.checkpoint_id ? { checkpoint_id: alignment.checkpoint_id } : {}),
        ...(alignment.alternate_description ? { alternate_description: alignment.alternate_description } : {}),
        ...(args.v3?.route_id ? { route_id: args.v3.route_id } : {}),
        ...(args.v3?.confidence !== undefined ? { confidence: args.v3.confidence } : {}),
        ...(args.v3?.aligner_version ? { aligner_version: args.v3.aligner_version } : {}),
        ...(args.v3?.workflow_version ? { workflow_version: args.v3.workflow_version } : {}),
        ...(args.v3?.grounding_refs?.length ? { grounding_refs: args.v3.grounding_refs } : {}),
      },
      occurred_at: now(),
      causation_sequence: args.causationInputSequence,
    });

    let progressed = false;
    let selfCorrected = false;
    if (alignment.alignment === "expected_checkpoint" || alignment.alignment === "alternate_valid") {
      const checkpointId = alignment.checkpoint_id ?? state.reasoning.current_checkpoint_id;
      const checkpoint = context.plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId);
      const deviation = state.assistance[checkpointId]?.incorrectSequences.at(-1);
      const isSelfCorrection =
        alignment.alignment === "expected_checkpoint" &&
        deviation !== undefined &&
        !assistanceSinceDeviation(state, events, checkpointId, deviation);
      if (isSelfCorrection && deviation !== undefined) {
        selfCorrected = true;
        batch.push({
          event_type: "student_self_corrected",
          payload: { checkpoint_id: checkpointId, deviation_sequence: deviation },
          occurred_at: now(),
          causation_sequence: alignmentSequence,
        });
      }
      const ledger = state.assistance[checkpointId];
      const assisted = Boolean(
        ledger && (ledger.hintLevelsIssued.length > 0 || ledger.explainedSequences.length > 0),
      );
      progressed = true;
      batch.push({
        event_type: "student_progressed",
        payload: {
          checkpoint_id: checkpointId,
          part_id: checkpoint?.part_id ?? "1",
          assisted,
          ...(alignment.alignment === "alternate_valid" ? { via_alternate: true } : {}),
        },
        occurred_at: now(),
        causation_sequence: alignmentSequence,
      });
    }
    return { batch, progressed, selfCorrected };
  }

  function recordStudentInput(sessionId: string, input: StudentInput, clientTurnId?: string): RecordInputResult {
    const { context, events, state, revision } = loadSession(sessionId);
    const base = events.at(-1)?.sequence ?? 0;
    const batch: PendingV2Event[] = [];
    const inputSequence = base + 1;
    batch.push({
      event_type: "student_input_recorded",
      payload: {
        input_kind: input.input_kind,
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.object_id !== undefined ? { object_id: input.object_id } : {}),
        ...(input.duration_ms !== undefined ? { duration_ms: input.duration_ms } : {}),
        ...(clientTurnId && context.eventSchema === "v3" ? { client_turn_id: clientTurnId } : {}),
      },
      occurred_at: now(),
    });

    // 打断：未播完的 voice 记为 interrupted——未播放内容不算学生已听到（PRD 04 §7）
    if (input.input_kind === "student_interrupted") {
      for (const pending of pendingVoiceActions(events)) {
        batch.push({
          event_type: "voice_action_completed",
          payload: { action_id: pending.action_id, outcome: "interrupted" },
          occurred_at: now(),
          causation_sequence: inputSequence,
        });
      }
    }

    let alignment: AlignmentOutcome | undefined;
    let progressed = false;
    let selfCorrected = false;
    // 缺陷修复（Phase 5 remediation）：pointing 未口头化不推进——与智能链
    // align_reasoning 节点同口径（pointing → unclear），pointing 本身不参与
    // 对齐匹配，期望推理必须由 reasoning_utterance 口头表达。
    const alignable = input.input_kind === "reasoning_utterance" || input.input_kind === "pointing_evidence";
    if (alignable) {
      alignment =
        input.input_kind === "pointing_evidence"
          ? { alignment: "unclear" }
          : alignReasoning(context.plan, state, input);
      const consequence = alignmentFactBatch({
        context,
        state,
        events,
        alignment,
        offset: base + batch.length,
        causationInputSequence: inputSequence,
      });
      batch.push(...consequence.batch);
      progressed = consequence.progressed;
      selfCorrected = consequence.selfCorrected;
    }

    const appendedSequences = appendBatch(sessionId, revision, batch);
    return {
      input_sequence: inputSequence,
      alignment,
      progressed,
      self_corrected: selfCorrected,
      appendedSequences,
    };
  }

  // ------------------------------------------------------------------ //
  // 教学决策轮（P5-03/06/07/08/11/12/13）
  // ------------------------------------------------------------------ //

  function deriveTrigger(events: readonly StoredV2Event[], explicit?: { kind: "system"; reason: "session_started" | "presentation_completed" }): PolicyTrigger {
    const last = events.at(-1);
    if (explicit) {
      const moveOfLastVoice = decisionOfVoice(events, last);
      return {
        kind: "system",
        system_reason: explicit.reason,
        event_sequence: last?.sequence ?? 1,
        ...(moveOfLastVoice ? { last_move_type: moveOfLastVoice.move_type, last_purpose_code: moveOfLastVoice.purpose_code } : {}),
      };
    }
    if (!last) return { kind: "system", system_reason: "session_started", event_sequence: 1 };

    const lastInput = [...events].reverse().find((event) => event.event_type === "student_input_recorded");
    if (lastInput && last.event_type !== "voice_action_completed" && last.event_type !== "workspace_action_completed") {
      // 只有没有后续对齐事实的输入才作为触发源（静默/打断/提问）。
      const lastAlignment = [...events]
        .reverse()
        .find((event) => event.event_type === "reasoning_aligned" && event.causation_sequence === lastInput.sequence);
      if (lastAlignment) {
        const payload = lastAlignment.payload as { alignment: Alignment; checkpoint_id?: string };
        return {
          kind: "student_input",
          event_sequence: lastAlignment.sequence,
          input_kind: (lastInput.payload as { input_kind?: InputKind }).input_kind,
          alignment: payload.alignment,
          alignment_checkpoint_id: payload.checkpoint_id,
        };
      }
      return {
        kind: "student_input",
        event_sequence: lastInput.sequence,
        input_kind: (lastInput.payload as { input_kind: InputKind }).input_kind,
      };
    }
    if (last.event_type === "session_started") {
      return { kind: "system", system_reason: "session_started", event_sequence: last.sequence };
    }
    if (last.event_type === "voice_action_completed") {
      const payload = last.payload as { action_id: string; outcome: string };
      const moveOfLastVoice = decisionOfVoice(events, last);
      return {
        kind: "system",
        system_reason: "presentation_completed",
        event_sequence: last.sequence,
        ...(moveOfLastVoice ? { last_move_type: moveOfLastVoice.move_type, last_purpose_code: moveOfLastVoice.purpose_code } : {}),
      };
    }
    return { kind: "system", system_reason: "session_started", event_sequence: last.sequence };
  }

  function decisionOfVoice(
    events: readonly StoredV2Event[],
    voiceCompleted: StoredV2Event | undefined,
  ): { move_type: string; purpose_code: string } | undefined {
    if (!voiceCompleted || voiceCompleted.event_type !== "voice_action_completed") return undefined;
    const actionId = (voiceCompleted.payload as { action_id: string }).action_id;
    const issued = events.find(
      (event) => event.event_type === "voice_action_issued" && (event.payload as { action_id: string }).action_id === actionId,
    );
    if (!issued) return undefined;
    const decisionId = (issued.payload as { decision_id: string }).decision_id;
    const decision = events.find(
      (event) =>
        event.event_type === "tutor_move_decided" &&
        (event.payload as { decision_id: string }).decision_id === decisionId,
    );
    if (!decision) return undefined;
    const payload = decision.payload as { move_type: string; purpose_code: string };
    return { move_type: payload.move_type, purpose_code: payload.purpose_code };
  }

  function validDiagnosisEvidence(events: readonly StoredV2Event[], sequences: readonly number[]): boolean {
    return sequences.every((sequence) => {
      const target = events.find((event) => event.sequence === sequence);
      return target !== undefined && target.event_type !== "policy_failed" && target.event_type !== "runtime_failure";
    });
  }

  async function driveTutorTurn(
    sessionId: string,
    explicitTrigger?: { kind: "system"; reason: "session_started" | "presentation_completed" },
  ): Promise<TurnResult> {
    const { context, events, state, revision } = loadSession(sessionId);
    const trigger = deriveTrigger(events, explicitTrigger);
    const outcome = await decide({ plan: context.plan, state, trigger, session_kind: "tutoring" });
    return commitTutorDecision({
      sessionId,
      context,
      events,
      state,
      revision,
      trigger,
      draft: outcome.draft,
      policyVersion: outcome.policy_version,
      failure: outcome.failure,
    });
  }

  /**
   * 决策落库（deterministic 与智能链共用的事件写入口）。
   *
   * 职责边界（2026-08-21 追加裁定）：LangGraph 只产出受约束提案；本函数构造
   * canonical 事件、派生 Presenter 呈现、执行五重校验并在一个 append 事务里
   * 原子落库（prefixBatch 允许把对齐/进度事实与决策合并为同一 revision）。
   */
  async function commitTutorDecision(args: {
    sessionId: string;
    context: SessionContext;
    events: readonly StoredV2Event[];
    state: TutorRuntimeState;
    revision: number;
    trigger: PolicyTrigger;
    draft: TutorDecisionDraft | null;
    policyVersion: string;
    failure?: { failure_class: string; fallback_used: boolean };
    dynamicVoice?: { text: string; source: "model-generated" };
    provenance?: { model?: string; workflowVersion?: string; promptVersions?: string[]; voiceSource?: VoiceSource };
    correlationId?: string;
    prefixBatch?: PendingV2Event[];
  }): Promise<TurnResult> {
    const { sessionId, context, events, state, revision, trigger } = args;
    const outcome = {
      draft: args.draft,
      policy_version: args.policyVersion,
      failure: args.failure,
    };
    const isV3 = context.eventSchema === "v3";

    const base = events.at(-1)?.sequence ?? 0;
    const batch: PendingV2Event[] = [...(args.prefixBatch ?? [])];
    let presentation: ValidatedPresentation = { voice: [], workspace: [] };
    /** Presenter 草案中未通过五重校验的 WorkspaceAction（记录 runtime_failure，不签发）。 */
    let workspaceFailures: Array<{ action_id: string; errors: string[] }> = [];
    let decision: TutorDecision | null = null;

    if (outcome.failure && !outcome.draft) {
      batch.push({
        event_type: "policy_failed",
        payload: {
          policy_version: outcome.policy_version,
          failure_class: outcome.failure.failure_class,
          fallback_used: false,
        },
        occurred_at: now(),
        causation_sequence: trigger.event_sequence,
      });
    } else if (outcome.draft) {
      if (outcome.failure) {
        // safe fallback 轮：policy_failed 事实与回退决策同批落库（P5-08/P5-14）。
        batch.push({
          event_type: "policy_failed",
          payload: {
            policy_version: outcome.policy_version,
            failure_class: outcome.failure.failure_class,
            fallback_used: outcome.failure.fallback_used,
          },
          occurred_at: now(),
          causation_sequence: trigger.event_sequence,
        });
      }
      const decisionSequence = base + batch.length + 1;
      const ordinal = events.filter((event) => event.event_type === "tutor_move_decided").length + 1;
      decision = {
        ...outcome.draft,
        decision_id: decisionId(sessionId, ordinal),
        policy_version: outcome.policy_version,
        source_event_sequence: trigger.event_sequence,
        source_state_revision: state.revision,
      };
      const voiceOrdinal = events.filter((event) => event.event_type === "voice_action_issued").length + 1;
      const workspaceOrdinal = events.filter((event) => event.event_type === "workspace_action_issued").length + 1;
      const checkpointId = decision.checkpoint_id ?? state.reasoning.current_checkpoint_id;
      const partId =
        context.plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)?.part_id ?? "1";
      const presentationResult = preparePresentation({
        decision,
        plan: context.plan,
        state,
        sessionId,
        voiceOrdinal,
        workspaceOrdinal,
        answerValues: context.answerValuesByPart.get(partId) ?? [],
        ...(args.dynamicVoice ? { dynamicVoice: args.dynamicVoice } : {}),
      });
      if (!presentationResult.ok || !presentationResult.presentation) {
        batch.push({
          event_type: "policy_failed",
          payload: {
            policy_version: outcome.policy_version,
            failure_class: "presentation_invalid",
            fallback_used: false,
            ...(presentationResult.ok ? {} : { note: presentationResult.errors.join("; ") }),
          },
          occurred_at: now(),
          causation_sequence: trigger.event_sequence,
        });
      } else {
        // 裁定 §6 生命周期隔离：Workspace 草案先过五重校验升格为
        // ValidatedWorkspacePresentation——未验证动作不进学生 presentation、
        // 不签发 workspace_action_issued，只记 runtime_failure。
        const resolution = resolveWorkspacePresentation(
          presentationResult.presentation.workspace,
          context.plan,
          context.projection,
          { registrySnapshot: context.snapshot, sessionKind: "tutoring" },
        );
        presentation = { voice: presentationResult.presentation.voice, workspace: resolution.presentation };
        workspaceFailures = resolution.failures.map((failure) => ({
          action_id: failure.action.action_id,
          errors: failure.errors,
        }));
        batch.push({
          event_type: "tutor_move_decided",
          payload: {
            decision_id: decision.decision_id,
            move_type: decision.move_type,
            purpose_code: decision.purpose_code,
            policy_version: decision.policy_version,
            source_event_sequence: decision.source_event_sequence,
            source_state_revision: decision.source_state_revision,
            checkpoint_id: checkpointId,
            ...(decision.assistance_level !== undefined ? { assistance_level: decision.assistance_level } : {}),
            ...(decision.resource_ids?.length ? { resource_ids: decision.resource_ids } : {}),
            ...(decision.fallback ? { fallback: true } : {}),
            // v3 智能链 provenance（deterministic provider 不携带）。
            ...(isV3 && args.provenance?.model ? { model: args.provenance.model } : {}),
            ...(isV3 && args.provenance?.workflowVersion ? { workflow_version: args.provenance.workflowVersion } : {}),
            ...(isV3 && args.provenance?.promptVersions?.length ? { prompt_versions: args.provenance.promptVersions } : {}),
            ...(isV3 && args.provenance?.voiceSource ? { voice_source: args.provenance.voiceSource } : {}),
            ...(isV3 && presentation.workspace.length
              ? {
                  workspace_resource_ids: presentation.workspace.map(
                    (workspace) => workspace.resource_id,
                  ),
                }
              : {}),
          },
          occurred_at: now(),
          causation_sequence: trigger.event_sequence,
        });

        for (const update of decision.diagnosis_updates ?? []) {
          if (!validDiagnosisEvidence(events, update.evidence_sequences)) continue;
          batch.push({
            event_type: "working_diagnosis_updated",
            payload: {
              summary_code: update.summary_code,
              ...(update.candidate_skill_ids?.length ? { candidate_skill_ids: update.candidate_skill_ids } : {}),
              evidence_sequences: update.evidence_sequences,
            },
            occurred_at: now(),
            causation_sequence: decisionSequence,
          });
        }

        if (decision.mode_change && decision.mode_change.to_mode !== state.mode) {
          batch.push({
            event_type: "mode_changed",
            payload: { from_mode: state.mode, to_mode: decision.mode_change.to_mode },
            occurred_at: now(),
            causation_sequence: decisionSequence,
          });
        }

        presentation.voice.forEach((voice, index) => {
          batch.push({
            event_type: "voice_action_issued",
            payload: {
              action_id: voiceActionId(sessionId, voiceOrdinal + index),
              decision_id: decision!.decision_id,
              text: voice.text,
              interruptible: voice.interruptible,
              ...(isV3 && voice.resource_id ? { resource_ref: voice.resource_id } : {}),
              ...(isV3 && voice.generation_id ? { generation_id: voice.generation_id } : {}),
              ...(isV3 && voice.voice_source ? { voice_source: voice.voice_source } : {}),
            },
            occurred_at: now(),
            causation_sequence: decisionSequence,
          });
        });

        // 只签发已验证动作（裁定 §6）：issued payload 的 command 重建自
        // 解析出的 resource_id/action_ref（服务端私有来源，非模型输出）。
        for (const workspace of presentation.workspace) {
          batch.push({
            event_type: "workspace_action_issued",
            payload: {
              action_id: workspace.action_id,
              decision_id: decision!.decision_id,
              capability: workspace.capability,
              target_ids: workspace.target_ids,
              command_payload: JSON.stringify({
                resource_id: workspace.resource_id,
                action_ref: workspace.action_ref,
                mode: "learn",
              }),
            },
            occurred_at: now(),
            causation_sequence: decisionSequence,
          });
        }
        // 未通过校验的 WorkspaceAction：系统失败事实（P5-14 与学生错误分离），
        // 不签发、不下发。
        for (const failure of workspaceFailures) {
          batch.push({
            event_type: "runtime_failure",
            payload: {
              failure_class: "workspace_action_rejected",
              message: `${failure.action_id}: ${failure.errors.join("; ")}`,
              related_event_sequence: decisionSequence,
            },
            occurred_at: now(),
            causation_sequence: decisionSequence,
          });
        }

        if (decision.move_type === "hint") {
          batch.push({
            event_type: "hint_issued",
            payload: {
              decision_id: decision.decision_id,
              checkpoint_id: checkpointId,
              level: decision.assistance_level ?? 1,
            },
            occurred_at: now(),
            causation_sequence: decisionSequence,
          });
        }
        if (decision.move_type === "repair") {
          batch.push({
            event_type: "repair_delivered",
            payload: {
              source_checkpoint_id: checkpointId,
              resource_id: decision.resource_ids?.[0] ?? "",
              decision_id: decision.decision_id,
            },
            occurred_at: now(),
            causation_sequence: decisionSequence,
          });
        }
        if (decision.mode_change && decision.mode_change.to_mode !== state.mode) {
          setTutorSessionMode(sessionId, decision.mode_change.to_mode);
        }
      }
    }

    const appendedSequences = batch.length ? appendBatch(sessionId, revision, batch) : [];
    // 观测旁路（计划 §2.6）：validation failure / fallback 至少落 telemetry 一份。
    if (args.correlationId) {
      for (const failure of workspaceFailures) {
        recordTurnTelemetry({
          correlation_id: args.correlationId,
          session_id: sessionId,
          stage: "validation",
          outcome: "workspace_action_rejected",
          detail: { action_id: failure.action_id, errors: failure.errors },
        });
      }
      if (outcome.failure) {
        recordTurnTelemetry({
          correlation_id: args.correlationId,
          session_id: sessionId,
          stage: "fallback",
          outcome: outcome.failure.failure_class,
          detail: { fallback_used: outcome.failure.fallback_used },
        });
      }
    }
    return {
      decision,
      presentation,
      ...(outcome.failure ? { policy_failed: outcome.failure } : {}),
      appendedSequences,
    };
  }

  // ------------------------------------------------------------------ //
  // 呈现完成 / workspace 执行 / 非法动作演练
  // ------------------------------------------------------------------ //

  function completeVoice(
    sessionId: string,
    completion: { action_id: string; outcome: "completed" | "interrupted" | "rejected" | "failed"; failure_class?: string; message?: string },
  ): number[] {
    const { events, revision } = loadSession(sessionId);
    const issued = events.find(
      (event) =>
        event.event_type === "voice_action_issued" &&
        (event.payload as { action_id: string }).action_id === completion.action_id,
    );
    if (!issued) {
      throw new TutorSessionCoordinatorError("ACTION_NOT_FOUND", `voice action ${completion.action_id} 未签发`);
    }
    return appendBatch(sessionId, revision, [
      {
        event_type: "voice_action_completed",
        payload: {
          action_id: completion.action_id,
          outcome: completion.outcome,
          ...(completion.failure_class ? { failure_class: completion.failure_class } : {}),
          ...(completion.message ? { message: completion.message } : {}),
        },
        occurred_at: now(),
        causation_sequence: issued.sequence,
      },
    ]);
  }

  /** gate 4 演练入口：注入一条待校验 WorkspaceAction（裁定 §6：非法输入
   *  记 runtime_failure，不签发 workspace_action_issued、不进学生呈现）。 */
  function attemptWorkspaceAction(sessionId: string, action: WorkspaceActionPlan): { accepted: boolean; errors: string[] } {
    const { context, events, revision } = loadSession(sessionId);
    const resolution = resolveWorkspacePresentation([action], context.plan, context.projection, {
      registrySnapshot: context.snapshot,
      sessionKind: "tutoring",
    });
    const batch: PendingV2Event[] = [];
    if (!resolution.presentation.length) {
      const failure = resolution.failures[0];
      batch.push({
        event_type: "runtime_failure",
        payload: {
          failure_class: "workspace_action_rejected",
          message: `${action.action_id}: ${(failure?.errors ?? ["未知拒绝原因"]).join("; ")}`,
          related_event_sequence: events.at(-1)?.sequence,
        },
        occurred_at: now(),
        causation_sequence: events.at(-1)?.sequence ?? 1,
      });
    } else {
      const validated = resolution.presentation[0];
      batch.push({
        event_type: "workspace_action_issued",
        payload: {
          action_id: validated.action_id,
          decision_id: validated.decision_id,
          capability: validated.capability,
          target_ids: validated.target_ids,
          command_payload: JSON.stringify({
            resource_id: validated.resource_id,
            action_ref: validated.action_ref,
            mode: "learn",
          }),
        },
        occurred_at: now(),
        causation_sequence: events.at(-1)?.sequence ?? 1,
      });
    }
    appendBatch(sessionId, revision, batch);
    return { accepted: resolution.presentation.length > 0, errors: resolution.failures[0]?.errors ?? [] };
  }

  /** 学生操作：真实 typed evaluator 判定（accepted/rejected → 事实与进度）。 */
  function submitActionEvidence(
    sessionId: string,
    evidence: ActionEvidence,
    clientTurnId?: string,
  ): { accepted: boolean; appendedSequences: number[] } {
    const { context, events, state, revision } = loadSession(sessionId);
    const activeActionId = state.workspace.active_action_id;
    const issued = activeActionId
      ? events.find(
          (event) =>
            event.event_type === "workspace_action_issued" &&
            (event.payload as { action_id: string }).action_id === activeActionId,
        )
      : undefined;
    if (!issued) {
      throw new TutorSessionCoordinatorError("NO_ACTIVE_ACTION", "无进行中的 workspace action，无法提交操作证据");
    }
    const workspaceActionId = (issued.payload as { action_id: string }).action_id;
    const rawCommand = (issued.payload as { command_payload?: unknown }).command_payload;
    const command = (typeof rawCommand === "string" ? (JSON.parse(rawCommand) as Record<string, unknown>) : (rawCommand ?? {})) as {
      resource_id?: string;
    };
    const resource = context.plan.resources.find((entry) => entry.resource_id === command.resource_id);
    if (!resource || resource.kind !== "action_template") {
      throw new TutorSessionCoordinatorError("ACTION_TEMPLATE_MISSING", `workspace action 绑定的资源缺失: ${command.resource_id}`);
    }
    const template = JSON.parse(resource.content ?? "{}") as AuthoredActionTemplate;
    const diagnosis = evaluateWorkspaceEvidence(template, evidence);
    const accepted = diagnosis.accepted;

    const base = events.at(-1)?.sequence ?? 0;
    const batch: PendingV2Event[] = [];
    const inputSequence = base + 1;
    batch.push({
      event_type: "student_input_recorded",
      payload: {
        input_kind: "structured_action_evidence",
        action_id: evidence.actionId,
        action_payload: JSON.stringify(evidence),
        ...(clientTurnId && context.eventSchema === "v3" ? { client_turn_id: clientTurnId } : {}),
      },
      occurred_at: now(),
    });
    const alignmentSequence = base + 2;
    const checkpointId = resource.checkpoint_id ?? state.reasoning.current_checkpoint_id;
    batch.push({
      event_type: "reasoning_aligned",
      payload: {
        alignment: accepted ? "expected_checkpoint" : "incorrect",
        checkpoint_id: checkpointId,
      },
      occurred_at: now(),
      causation_sequence: inputSequence,
    });
    if (accepted) {
      batch.push({
        event_type: "workspace_action_completed",
        payload: { action_id: workspaceActionId, outcome: "completed" },
        occurred_at: now(),
        causation_sequence: alignmentSequence,
      });
      const checkpoint = context.plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId);
      const ledger = state.assistance[checkpointId];
      // 自我修正检测同 utterance 路径：上次错误证据之后无 hint/explain/repair
      // 协助（Prompt 不算实质性帮助）→ 学生自己改对，不记为 Tutor 纠正。
      const deviation = ledger?.incorrectSequences.at(-1);
      if (deviation !== undefined && !assistanceSinceDeviation(state, events, checkpointId, deviation)) {
        batch.push({
          event_type: "student_self_corrected",
          payload: { checkpoint_id: checkpointId, deviation_sequence: deviation },
          occurred_at: now(),
          causation_sequence: alignmentSequence,
        });
      }
      batch.push({
        event_type: "student_progressed",
        payload: {
          checkpoint_id: checkpointId,
          part_id: checkpoint?.part_id ?? "1",
          assisted: Boolean(ledger && (ledger.hintLevelsIssued.length > 0 || ledger.explainedSequences.length > 0)),
          via_action_evidence: true,
        },
        occurred_at: now(),
        causation_sequence: alignmentSequence,
      });
    } else {
      // 学生操作错误是学生事实（P5-14），与工具失败分离——不写 workspace rejected。
    }
    const appendedSequences = appendBatch(sessionId, revision, batch);
    return { accepted, appendedSequences };
  }

  function completeSession(sessionId: string, reason = "finished"): number[] {
    const { events, revision, state } = loadSession(sessionId);
    if (state.completed) return [];
    return appendBatch(sessionId, revision, [
      {
        event_type: "session_completed",
        payload: { reason },
        occurred_at: now(),
      },
    ]);
  }

  // ------------------------------------------------------------------ //
  // 统一异步 processTurn（Phase 5 remediation / 完整收口计划 §2.2）
  // ------------------------------------------------------------------ //

  function buildRecentFacts(events: readonly StoredV2Event[], limit = 8): RecentEventFact[] {
    const facts: RecentEventFact[] = [];
    for (const event of events) {
      const payload = event.payload as unknown as Record<string, unknown>;
      let summary: string = event.event_type;
      if (event.event_type === "student_input_recorded") summary = `${String(payload.input_kind)}: ${String(payload.text ?? payload.object_id ?? "").slice(0, 60)}`;
      else if (event.event_type === "reasoning_aligned") summary = `alignment=${String(payload.alignment)}`;
      else if (event.event_type === "tutor_move_decided") summary = `move=${String(payload.move_type)}/${String(payload.purpose_code)}`;
      else if (event.event_type === "student_progressed") summary = `reached ${String(payload.checkpoint_id)}`;
      else if (event.event_type === "policy_failed") summary = `policy_failed:${String(payload.failure_class)}`;
      else if (event.event_type === "runtime_failure") summary = `runtime_failure:${String(payload.failure_class)}`;
      facts.push({
        sequence: event.sequence,
        event_type: event.event_type,
        summary,
        student_fact: STUDENT_FACT_EVENT_TYPES.has(event.event_type),
      });
    }
    return facts.slice(-limit);
  }

  function currentCheckpointView(state: TutorRuntimeState): TutorTurnResponse["current_checkpoint"] {
    const part = state.curriculum.parts[state.curriculum.current_part_index];
    return {
      checkpoint_id: state.reasoning.current_checkpoint_id,
      part_id: part?.part_id ?? "1",
      route_id: part?.route_id ?? "R1",
    };
  }

  function toTurnResponse(args: {
    sessionId: string;
    clientTurnId: string;
    idempotentReplay?: boolean;
    turn: TurnResult;
    alignment?: TutorTurnResponse["alignment"];
    state: TutorRuntimeState;
    revision: number;
    lastSequence: number;
  }): TutorTurnResponse {
    const { turn } = args;
    return {
      session_id: args.sessionId,
      revision: args.revision,
      client_turn_id: args.clientTurnId,
      idempotent_replay: Boolean(args.idempotentReplay),
      mode: args.state.mode,
      current_checkpoint: currentCheckpointView(args.state),
      ...(args.alignment ? { alignment: args.alignment } : {}),
      decision: turn.decision
        ? {
            decision_id: turn.decision.decision_id,
            move_type: turn.decision.move_type,
            purpose_code: turn.decision.purpose_code,
            policy_version: turn.decision.policy_version,
            ...(turn.decision.fallback ? { fallback: true } : {}),
          }
        : null,
      voice: turn.presentation.voice.map((voice) => ({
        action_id: voice.action_id,
        text: voice.text,
        interruptible: voice.interruptible,
        ...(voice.voice_source ? { voice_source: voice.voice_source } : {}),
      })),
      workspace: turn.presentation.workspace,
      ...(turn.policy_failed ? { fallback: { used: turn.policy_failed.fallback_used, failure_class: turn.policy_failed.failure_class } } : {}),
      event_cursor: args.lastSequence,
    };
  }

  /** 幂等重放：从事件流重建该 clientTurnId 的原始回合响应（学生安全面）。 */
  function rebuildTurnResponse(sessionId: string, clientTurnId: string): TutorTurnResponse | undefined {
    const { context, events, state, revision } = loadSession(sessionId);
    const input = events.find(
      (event) =>
        event.event_type === "student_input_recorded" &&
        (event.payload as { client_turn_id?: string }).client_turn_id === clientTurnId,
    );
    if (!input) return undefined;
    const nextInput = events.find(
      (event) => event.sequence > input.sequence && event.event_type === "student_input_recorded",
    );
    const turnEvents = events.filter(
      (event) => event.sequence >= input.sequence && (!nextInput || event.sequence < nextInput.sequence),
    );
    const alignmentEvent = turnEvents.find((event) => event.event_type === "reasoning_aligned");
    const decisionEvent = turnEvents.find((event) => event.event_type === "tutor_move_decided");
    const voiceEvents = turnEvents.filter((event) => event.event_type === "voice_action_issued");
    const workspaceEvents = turnEvents.filter((event) => event.event_type === "workspace_action_issued");
    const fallbackEvent = turnEvents.find((event) => event.event_type === "policy_failed");
    const decisionPayload = decisionEvent?.payload as
      | { decision_id: string; move_type: MoveType; purpose_code: string; policy_version: string; fallback?: boolean }
      | undefined;
    return {
      session_id: sessionId,
      revision,
      client_turn_id: clientTurnId,
      idempotent_replay: true,
      mode: state.mode,
      current_checkpoint: currentCheckpointView(state),
      ...(alignmentEvent
        ? {
            alignment: (() => {
              const payload = alignmentEvent.payload as {
                alignment: Alignment;
                checkpoint_id?: string;
                route_id?: string;
                confidence?: number;
              };
              return {
                alignment: payload.alignment,
                ...(payload.checkpoint_id ? { checkpoint_id: payload.checkpoint_id } : {}),
                ...(payload.route_id ? { route_id: payload.route_id } : {}),
                ...(payload.confidence !== undefined ? { confidence: payload.confidence } : {}),
              };
            })(),
          }
        : {}),
      decision: decisionPayload
        ? {
            decision_id: decisionPayload.decision_id,
            move_type: decisionPayload.move_type,
            purpose_code: decisionPayload.purpose_code,
            policy_version: decisionPayload.policy_version,
            ...(decisionPayload.fallback ? { fallback: true } : {}),
          }
        : null,
      voice: voiceEvents.map((event) => {
        const payload = event.payload as {
          action_id: string;
          text: string;
          interruptible?: boolean;
          voice_source?: VoiceSource;
        };
        return {
          action_id: payload.action_id,
          text: payload.text,
          interruptible: payload.interruptible ?? true,
          ...(payload.voice_source ? { voice_source: payload.voice_source } : {}),
        };
      }),
      workspace: workspaceEvents.flatMap((event) => {
        const payload = event.payload as { command_payload?: unknown };
        const command = (typeof payload.command_payload === "string"
          ? (JSON.parse(payload.command_payload) as Record<string, unknown>)
          : (payload.command_payload ?? {})) as Record<string, unknown>;
        const resource = context.plan.resources.find((entry) => entry.resource_id === command.resource_id);
        const template = resource?.content ? (JSON.parse(resource.content) as { actionId?: string }) : undefined;
        void template;
        // 学生面重建走 Presenter 同一确定性解析（服务端私有 projection）。
        const resolution = resolveWorkspacePresentation(
          [
            {
              action_id: (event.payload as { action_id: string }).action_id,
              decision_id: (event.payload as { decision_id: string }).decision_id,
              capability: (event.payload as { capability: string }).capability,
              target_ids: (event.payload as { target_ids: string[] }).target_ids,
              command_payload: command,
            },
          ],
          context.plan,
          context.projection,
          { registrySnapshot: context.snapshot, sessionKind: "tutoring" },
        );
        return resolution.presentation;
      }),
      ...(fallbackEvent
        ? {
            fallback: {
              used: Boolean((fallbackEvent.payload as { fallback_used?: boolean }).fallback_used),
              failure_class: (fallbackEvent.payload as { failure_class: string }).failure_class,
            },
          }
        : {}),
      event_cursor: events.at(-1)?.sequence ?? 0,
    };
  }

  /** 智能链回合执行（一次 append 事务：对齐事实 + 决策 + 呈现）。 */
  async function executeIntelligentTurn(args: {
    sessionId: string;
    context: SessionContext;
    events: readonly StoredV2Event[];
    state: TutorRuntimeState;
    revision: number;
    inputSequence: number;
    input: ProcessTurnInput;
    correlationId: string;
    clientTurnId: string;
  }): Promise<{ turn: TurnResult; alignment?: TutorTurnResponse["alignment"] }> {
    const { sessionId, context, events, state, input } = args;
    const graphInput: StudentTurnInput = {
      input_kind: input.input_kind,
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.object_id !== undefined ? { object_id: input.object_id } : {}),
      ...(input.duration_ms !== undefined ? { duration_ms: input.duration_ms } : {}),
    };
    const startedAt = Date.now();
    const outcome = await deps.intelligence!.proposeTurn({
      plan: context.plan,
      state,
      input: graphInput,
      facts: buildRecentFacts(events),
      answerValuesByPart: context.answerValuesByPart,
    });
    recordTurnTelemetry({
      correlation_id: args.correlationId,
      session_id: sessionId,
      stage: "policy",
      client_turn_id: args.clientTurnId,
      outcome: outcome.ok ? "proposal" : `failure:${outcome.failure.kind}`,
      latency_ms: Date.now() - startedAt,
      ...(outcome.ok && outcome.proposal.usage
        ? {
            input_tokens: outcome.proposal.usage.inputTokens,
            output_tokens: outcome.proposal.usage.outputTokens,
            model_calls: outcome.proposal.usage.calls,
          }
        : {}),
    });

    if (outcome.ok) {
      const proposal = outcome.proposal;
      const alignment = proposal.alignment;
      const prefixBatch: PendingV2Event[] = [];
      let alignmentView: TutorTurnResponse["alignment"] | undefined;
      if (alignment) {
        const consequence = alignmentFactBatch({
          context,
          state,
          events,
          alignment: {
            alignment: alignment.classification,
            ...(alignment.checkpointId ? { checkpoint_id: alignment.checkpointId } : {}),
            ...(alignment.routeId ? { alternate_description: alignment.routeId } : {}),
          },
          offset: (events.at(-1)?.sequence ?? 0) + prefixBatch.length,
          causationInputSequence: args.inputSequence,
          ...(context.eventSchema === "v3"
            ? {
                v3: {
                  confidence: alignment.confidence,
                  grounding_refs: alignment.groundingRefs,
                  aligner_version: proposal.promptVersions[0],
                  workflow_version: proposal.workflowVersion,
                  ...(alignment.routeId ? { route_id: alignment.routeId } : {}),
                },
              }
            : {}),
        });
        prefixBatch.push(...consequence.batch);
        alignmentView = {
          alignment: alignment.classification,
          ...(alignment.checkpointId ? { checkpoint_id: alignment.checkpointId } : {}),
          ...(alignment.routeId ? { route_id: alignment.routeId } : {}),
          ...(alignment.confidence !== undefined ? { confidence: alignment.confidence } : {}),
        };
      }
      const trigger: PolicyTrigger = {
        kind: "student_input",
        event_sequence: prefixBatch.length
          ? args.inputSequence + 1
          : args.inputSequence,
        input_kind: input.input_kind,
        ...(alignment
          ? {
              alignment: alignment.classification,
              ...(alignment.checkpointId ? { alignment_checkpoint_id: alignment.checkpointId } : {}),
            }
          : {}),
      };
      const turn = await commitTutorDecision({
        sessionId,
        context,
        events,
        state,
        revision: args.revision,
        trigger,
        draft: proposal.move,
        policyVersion: proposal.workflowVersion,
        ...(proposal.voiceText && proposal.voiceSource === "model-generated"
          ? { dynamicVoice: { text: proposal.voiceText, source: "model-generated" as const } }
          : {}),
        provenance: {
          model: proposal.modelId,
          workflowVersion: proposal.workflowVersion,
          promptVersions: proposal.promptVersions,
          ...(proposal.voiceText && proposal.voiceSource === "model-generated"
            ? { voiceSource: "model-generated" as const }
            : {}),
        },
        correlationId: args.correlationId,
        prefixBatch,
      });
      return { turn, alignment: alignmentView };
    }

    // 降级包装（计划 §2.4）：图失败 → 确定性对齐 + deterministic rules 决策
    // + policy_failed 事实（fallback_used=true）。模型超时/取消/未配置都走
    // 这条安全路径，session 不卡死。
    recordTurnTelemetry({
      correlation_id: args.correlationId,
      session_id: sessionId,
      stage: "fallback",
      client_turn_id: args.clientTurnId,
      outcome: outcome.failure.kind,
      detail: { detail: outcome.failure.detail.slice(0, 200) },
    });
    const alignment =
      input.input_kind === "reasoning_utterance" ? alignReasoning(context.plan, state, input) : undefined;
    const prefixBatch: PendingV2Event[] = [];
    let alignmentView: TutorTurnResponse["alignment"] | undefined;
    if (alignment) {
      const consequence = alignmentFactBatch({
        context,
        state,
        events,
        alignment,
        offset: (events.at(-1)?.sequence ?? 0) + prefixBatch.length,
        causationInputSequence: args.inputSequence,
      });
      prefixBatch.push(...consequence.batch);
      alignmentView = {
        alignment: alignment.alignment,
        ...(alignment.checkpoint_id ? { checkpoint_id: alignment.checkpoint_id } : {}),
      };
    }
    const trigger: PolicyTrigger = {
      kind: "student_input",
      event_sequence: prefixBatch.length ? args.inputSequence + 1 : args.inputSequence,
      input_kind: input.input_kind,
      ...(alignment
        ? { alignment: alignment.alignment, ...(alignment.checkpoint_id ? { alignment_checkpoint_id: alignment.checkpoint_id } : {}) }
        : {}),
    };
    const fallbackOutcome = await decide({ plan: context.plan, state, trigger, session_kind: "tutoring" });
    const turn = await commitTutorDecision({
      sessionId,
      context,
      events,
      state,
      revision: args.revision,
      trigger,
      draft: fallbackOutcome.draft,
      policyVersion: fallbackOutcome.policy_version,
      failure: {
        failure_class: `policy_${outcome.failure.kind}`,
        fallback_used: true,
      },
      correlationId: args.correlationId,
      prefixBatch,
    });
    return { turn, alignment: alignmentView };
  }

  /**
   * 统一异步回合入口：幂等 clientTurnId（重复提交返回同结果）、revision
   * conflict 自动重算一次（第二次 409/resync）、模型超时/取消/恢复走安全
   * 路径（智能链失败降级 deterministic，绝不悬挂）。
   */
  async function processTurn(
    sessionId: string,
    expectedRevision: number,
    clientTurnId: string,
    input: ProcessTurnInput,
    correlationId?: string,
  ): Promise<TutorTurnResponse> {
    const cid = correlationId ?? `corr-${sessionId}-${clientTurnId}`;
    const text = input.text?.slice(0, 2000);
    const turnInput: ProcessTurnInput = { ...input, ...(text !== undefined ? { text } : {}) };
    if (turnInput.input_kind === "structured_action_evidence" && !turnInput.action_evidence) {
      throw new TutorSessionCoordinatorError("INVALID_INPUT", "structured_action_evidence 需要 action_evidence");
    }

    // 幂等：事件流是唯一真源——同 clientTurnId 的输入已存在则重放原回合。
    const replay = rebuildTurnResponse(sessionId, clientTurnId);
    if (replay) {
      recordTurnTelemetry({
        correlation_id: cid,
        session_id: sessionId,
        stage: "turn",
        client_turn_id: clientTurnId,
        outcome: "idempotent_replay",
      });
      return replay;
    }

    const startedAt = Date.now();
    let recomputed = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshot = loadSession(sessionId);
      if (snapshot.state.completed && attempt === 0 && snapshot.events.length) {
        // 会话已完成：仍返回学生安全视图（决策为 null），不再产生新事实。
        return toTurnResponse({
          sessionId,
          clientTurnId,
          turn: { decision: null, presentation: { voice: [], workspace: [] }, appendedSequences: [] },
          state: snapshot.state,
          revision: snapshot.revision,
          lastSequence: snapshot.events.at(-1)?.sequence ?? 0,
        });
      }
      if (snapshot.revision !== expectedRevision && recomputed) {
        throw new TutorSessionCoordinatorError(
          "REVISION_CONFLICT",
          `expected revision ${expectedRevision} but session is at ${snapshot.revision}（已自动重算一次，仍冲突 → resync）`,
        );
      }
      if (snapshot.revision !== expectedRevision) {
        recomputed = true; // 第一次冲突：按服务端当前 revision 自动重算一次。
        recordTurnTelemetry({
          correlation_id: cid,
          session_id: sessionId,
          stage: "turn",
          client_turn_id: clientTurnId,
          outcome: "revision_recompute",
          detail: { expected: expectedRevision, current: snapshot.revision },
        });
      }
      try {
        const result = await executeTurnOnce({
          sessionId,
          snapshot,
          input: turnInput,
          clientTurnId,
          correlationId: cid,
        });
        recordTurnTelemetry({
          correlation_id: cid,
          session_id: sessionId,
          stage: "turn",
          client_turn_id: clientTurnId,
          outcome: "completed",
          latency_ms: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        const conflict =
          error instanceof TutorSessionEventStoreError && error.code === "REVISION_CONFLICT";
        if (conflict && !recomputed) {
          recomputed = true;
          continue;
        }
        if (conflict) {
          const fresh = loadSession(sessionId);
          throw new TutorSessionCoordinatorError(
            "REVISION_CONFLICT",
            `并发写入导致 revision 冲突（已自动重算一次）→ resync at ${fresh.revision}`,
          );
        }
        throw error;
      }
    }
    throw new TutorSessionCoordinatorError("REVISION_CONFLICT", "revision conflict 重试耗尽");
  }

  async function executeTurnOnce(args: {
    sessionId: string;
    snapshot: { context: SessionContext; events: StoredV2Event[]; state: TutorRuntimeState; revision: number };
    input: ProcessTurnInput;
    clientTurnId: string;
    correlationId: string;
  }): Promise<TutorTurnResponse> {
    const { sessionId, snapshot, input } = args;
    const { context, events, state, revision } = snapshot;
    const intelligent = Boolean(deps.intelligence);

    if (input.input_kind === "structured_action_evidence") {
      submitActionEvidence(sessionId, input.action_evidence!, args.clientTurnId);
      const afterEvidence = loadSession(sessionId);
      const turn = await driveTutorTurn(sessionId);
      return toTurnResponse({
        sessionId,
        clientTurnId: args.clientTurnId,
        turn,
        alignment: {
          alignment: afterEvidence.state.reasoning.last_alignment?.alignment ?? "unclear",
          ...(afterEvidence.state.reasoning.last_alignment?.checkpoint_id
            ? { checkpoint_id: afterEvidence.state.reasoning.last_alignment.checkpoint_id }
            : {}),
        },
        state: loadSession(sessionId).state,
        revision: loadSession(sessionId).revision,
        lastSequence: loadSession(sessionId).events.at(-1)?.sequence ?? 0,
      });
    }

    if (intelligent && context.eventSchema === "v3") {
      // 事实先行（一个 revision），对齐+决策+呈现合并为第二个原子事务。
      const batch: PendingV2Event[] = [];
      const inputSequence = (events.at(-1)?.sequence ?? 0) + 1;
      batch.push({
        event_type: "student_input_recorded",
        payload: {
          input_kind: input.input_kind,
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.object_id !== undefined ? { object_id: input.object_id } : {}),
          ...(input.duration_ms !== undefined ? { duration_ms: input.duration_ms } : {}),
          client_turn_id: args.clientTurnId,
        },
        occurred_at: now(),
      });
      if (input.input_kind === "student_interrupted") {
        for (const pending of pendingVoiceActions(events)) {
          batch.push({
            event_type: "voice_action_completed",
            payload: { action_id: pending.action_id, outcome: "interrupted" },
            occurred_at: now(),
            causation_sequence: inputSequence,
          });
        }
      }
      appendBatch(sessionId, revision, batch);
      const afterInput = loadSession(sessionId);
      const { turn, alignment } = await executeIntelligentTurn({
        sessionId,
        context,
        events: afterInput.events,
        state: afterInput.state,
        revision: afterInput.revision,
        inputSequence,
        input,
        correlationId: args.correlationId,
        clientTurnId: args.clientTurnId,
      });
      const final = loadSession(sessionId);
      recordTurnTelemetry({
        correlation_id: args.correlationId,
        session_id: sessionId,
        stage: "alignment",
        client_turn_id: args.clientTurnId,
        outcome: alignment?.alignment ?? "none",
        event_sequence: final.events.at(-1)?.sequence,
      });
      return toTurnResponse({
        sessionId,
        clientTurnId: args.clientTurnId,
        turn,
        alignment,
        state: final.state,
        revision: final.revision,
        lastSequence: final.events.at(-1)?.sequence ?? 0,
      });
    }

    // deterministic 回滚路径：recordStudentInput + driveTutorTurn（现状不变）。
    const record = recordStudentInput(sessionId, input, args.clientTurnId);
    const turn = await driveTutorTurn(sessionId);
    const final = loadSession(sessionId);
    return toTurnResponse({
      sessionId,
      clientTurnId: args.clientTurnId,
      turn,
      alignment: record.alignment
        ? {
            alignment: record.alignment.alignment,
            ...(record.alignment.checkpoint_id ? { checkpoint_id: record.alignment.checkpoint_id } : {}),
          }
        : undefined,
      state: final.state,
      revision: final.revision,
      lastSequence: final.events.at(-1)?.sequence ?? 0,
    });
  }

  /** voice 完成 + 自动续走系统回合（presentation_completed 触发）。 */
  async function completeVoiceAndContinue(
    sessionId: string,
    completion: { action_id: string; outcome: "completed" | "interrupted" | "rejected" | "failed"; failure_class?: string; message?: string },
    correlationId?: string,
  ): Promise<TutorTurnResponse> {
    const cid = correlationId ?? `corr-${sessionId}-voice-${completion.action_id}`;
    completeVoice(sessionId, completion);
    const turn = await driveTutorTurn(sessionId, { kind: "system", reason: "presentation_completed" });
    const final = loadSession(sessionId);
    return toTurnResponse({
      sessionId,
      clientTurnId: `voice.${completion.action_id}`,
      turn,
      state: final.state,
      revision: final.revision,
      lastSequence: final.events.at(-1)?.sequence ?? 0,
    });
  }

  /** 学生安全会话视图（GET :sessionId 恢复面：pending actions + revision）。 */
  function getSessionView(sessionId: string): {
    session_id: string;
    revision: number;
    mode: SessionMode;
    completed: boolean;
    current_checkpoint: TutorTurnResponse["current_checkpoint"];
    pending_voice: Array<{ action_id: string; text: string; interruptible: boolean }>;
    pending_workspace: ValidatedWorkspaceAction[];
    event_cursor: number;
  } {
    const { context, events, state, revision } = loadSession(sessionId);
    const pendingVoice = pendingVoiceActions(events).map((pending) => {
      const issued = events.find(
        (event) =>
          event.event_type === "voice_action_issued" &&
          (event.payload as { action_id: string }).action_id === pending.action_id,
      );
      const payload = (issued?.payload ?? { text: "", interruptible: true }) as { text: string; interruptible?: boolean };
      return { action_id: pending.action_id, text: payload.text, interruptible: payload.interruptible ?? true };
    });
    const pendingWorkspace: ValidatedWorkspaceAction[] = [];
    if (state.workspace.active_action_id) {
      const issued = events.find(
        (event) =>
          event.event_type === "workspace_action_issued" &&
          (event.payload as { action_id: string }).action_id === state.workspace.active_action_id,
      );
      if (issued) {
        const payload = issued.payload as {
          action_id: string;
          decision_id: string;
          capability: string;
          target_ids: string[];
          command_payload?: unknown;
        };
        const command = (typeof payload.command_payload === "string"
          ? (JSON.parse(payload.command_payload) as Record<string, unknown>)
          : (payload.command_payload ?? {})) as Record<string, unknown>;
        const resolution = resolveWorkspacePresentation(
          [
            {
              action_id: payload.action_id,
              decision_id: payload.decision_id,
              capability: payload.capability,
              target_ids: payload.target_ids,
              command_payload: command,
            },
          ],
          context.plan,
          context.projection,
          { registrySnapshot: context.snapshot, sessionKind: "tutoring" },
        );
        pendingWorkspace.push(...resolution.presentation);
      }
    }
    return {
      session_id: sessionId,
      revision,
      mode: state.mode,
      completed: state.completed,
      current_checkpoint: currentCheckpointView(state),
      pending_voice: pendingVoice,
      pending_workspace: pendingWorkspace,
      event_cursor: events.at(-1)?.sequence ?? 0,
    };
  }

  return {
    start,
    restore,
    getEvents,
    recordStudentInput,
    driveTutorTurn,
    completeVoice,
    attemptWorkspaceAction,
    submitActionEvidence,
    completeSession,
    processTurn,
    completeVoiceAndContinue,
    getSessionView,
  };
}

export type TutorSessionCoordinator = ReturnType<typeof createTutorSessionCoordinator>;
export type { StoredV2Event, V2EventType };

// --------------------------------------------------------------------------- //
// Provider 接线（Phase 5 remediation / 完整收口计划 §2.4）
//
// TUTOR_POLICY_PROVIDER=deterministic|deepseek-langgraph（默认 deterministic，
// golden canary 通过后才切）；TUTOR_DEEPSEEK_MODEL=deepseek-v4-flash；
// TUTOR_FAKE_STRUCTURED_MODEL=1 仅供 CI/测试（fake 结构化模型，不访问外部）。
// 回滚 = 切回 deterministic（事件 v3 reader 与已产生会话继续有效）。
// --------------------------------------------------------------------------- //

export type TutorPolicyProviderKind = "deterministic" | "deepseek-langgraph";

export function tutorPolicyProviderFromEnv(env: NodeJS.ProcessEnv = process.env): TutorPolicyProviderKind {
  const provider = env.TUTOR_POLICY_PROVIDER?.trim();
  return provider === "deepseek-langgraph" ? "deepseek-langgraph" : "deterministic";
}

export interface DefaultCoordinatorOptions {
  canonicalRoot: string;
  provider?: TutorPolicyProviderKind;
  now?: () => string;
  /** 测试注入结构化模型（fake / mock fetch）；默认按 env 装配。 */
  structuredModel?: StructuredModelPort;
}

export function createDefaultTutorSessionCoordinator(
  options: DefaultCoordinatorOptions,
): { coordinator: TutorSessionCoordinator; provider: TutorPolicyProviderKind } {
  const provider = options.provider ?? tutorPolicyProviderFromEnv();
  if (provider === "deepseek-langgraph") {
    const model =
      options.structuredModel ??
      (process.env.TUTOR_FAKE_STRUCTURED_MODEL === "1"
        ? new FakeStructuredModel()
        : new DeepSeekStructuredModel());
    const graph = createTutorPolicyGraph({ model });
    return {
      coordinator: createTutorSessionCoordinator({
        canonicalRoot: options.canonicalRoot,
        ...(options.now ? { now: options.now } : {}),
        intelligence: graph,
        // deterministic rules 同时是图失败的降级包装与 env 级回滚路径。
        policy: deterministicRulesPolicy,
      }),
      provider,
    };
  }
  return {
    coordinator: createTutorSessionCoordinator({
      canonicalRoot: options.canonicalRoot,
      ...(options.now ? { now: options.now } : {}),
    }),
    provider,
  };
}
