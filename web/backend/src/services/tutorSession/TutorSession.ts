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
  type PendingV2Event,
  type SessionMode,
  type StoredV2Event,
  type V2EventType,
  decisionId,
  voiceActionId,
  workspaceActionId,
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
import type { TutorDecision } from "../tutorPolicy/TutorMove";
import {
  preparePresentation,
  resolveWorkspacePresentation,
  type ValidatedPresentation,
} from "../tutorPresentation/PreparePresentation";
import type { VoiceActionPlan, WorkspaceActionPlan, ValidatedWorkspaceAction } from "../tutorPresentation";
import { evaluateWorkspaceEvidence } from "../tutorPresentation/adapters/legacyActionRuntime/workspaceActionAdapter";

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

interface SessionContext {
  plan: TutorPlanV2Payload;
  projection: RuntimeProjectionBody;
  snapshot: RuntimeRegistrySnapshot;
  truth: TruthPayload;
  answerValuesByPart: Map<string, string[]>;
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

  function buildContext(plan: TutorPlanV2Payload): SessionContext {
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
    return { plan, projection, snapshot, truth: truthResult.payload, answerValuesByPart };
  }

  function contextFor(sessionId: string): SessionContext {
    const cached = contexts.get(sessionId);
    if (cached) return cached;
    const row = getTutorSession(sessionId) as
      | { plan_artifact_id: string; plan_version: string; plan_content_hash: string; event_schema: string }
      | undefined;
    if (!row) throw new TutorSessionCoordinatorError("SESSION_NOT_FOUND", `unknown session: ${sessionId}`);
    if (row.event_schema !== "v2") {
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
    const context = buildContext(plan);
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
    const context = buildContext(plan);
    startTutorSession({
      sessionId: options.sessionId,
      studentId: options.studentId,
      plan: { artifact_id: plan.artifact_id, version: plan.version, content_hash: plan.content_hash },
      eventSchema: "v2",
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

  function recordStudentInput(sessionId: string, input: StudentInput): RecordInputResult {
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
    const alignable = input.input_kind === "reasoning_utterance" || input.input_kind === "pointing_evidence";
    if (alignable) {
      alignment = alignReasoning(context.plan, state, input);
      const alignmentSequence = base + batch.length + 1;
      batch.push({
        event_type: "reasoning_aligned",
        payload: {
          alignment: alignment.alignment,
          ...(alignment.checkpoint_id ? { checkpoint_id: alignment.checkpoint_id } : {}),
          ...(alignment.alternate_description ? { alternate_description: alignment.alternate_description } : {}),
        },
        occurred_at: now(),
        causation_sequence: inputSequence,
      });

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

    const base = events.at(-1)?.sequence ?? 0;
    const batch: PendingV2Event[] = [];
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
  function submitActionEvidence(sessionId: string, evidence: ActionEvidence): { accepted: boolean; appendedSequences: number[] } {
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
  };
}

export type TutorSessionCoordinator = ReturnType<typeof createTutorSessionCoordinator>;
export type { StoredV2Event, V2EventType };
