/**
 * UnifiedViewProjectionV5（F6 — 统一 Projection；f6-scope-ledger 输出 4）。
 *
 * 同一 TutorRuntimeState + 同一 revision 投影三视图 + Status/Error 切片
 * （计划 §5 F6：「Coach/Participation/Workspace 从同一 TutorRuntimeState/
 * revision 投影」；ADR-010 不变量 4：CoachPanelView 与 StudentWorkspaceView
 * 同 revision）：
 * - StudentWorkspaceView：**委托** F3 `projectStudentWorkspaceViewV5` +
 *   `deriveMainlineParticipation`（零第二 projector、零第二 Board 真相）；
 * - CoachPanelView：canonical view/v1（受控 mainline 七态、inquiry 显式
 *   return_checkpoint_id、学生安全 transcript——不含模型私有推理）；
 * - Status/Error：六类失败语义分类（student_incorrect / model_runtime_failure /
 *   policy_failure / gate_binding_integrity_failure / presentation_action_failure
 *   / revision_conflict_failure）——按事件类型 + canonical 封闭 failure_class
 *   枚举派生（不依赖 message 前缀作长期机器分类；R3 既有 gate_binding_mismatch
 *   message 前缀偏差在此**继承登记**，不扩大）。
 *
 * 纯函数：输入 = fresh rebuild 的双 state + committed events + pinned plan/
 * catalog；禁止读 db、禁止另建 Coach/Board/页面内教学状态机。
 */
import type { z } from "zod";
import { coachPanelViewV1Schema } from "../../../../shared/canonical";
import type { NavigatorPlanV5 } from "../tutorNavigator/NavigatorPlanV5";
import type { StoredV5Event } from "../tutorSession/TutorSessionEventV5";
import type { TutorRuntimeStateV5 } from "../tutorSession/TutorRuntimeStateReducerV5";
import type { WorkspaceRuntimeStateV5 } from "../tutorSession/WorkspaceRuntimeReducerV5";
import type { WorkspacePresentationCatalogV5 } from "../tutorSession/WorkspacePresentationCatalogV5";
import {
  deriveMainlineParticipation,
  projectStudentWorkspaceViewV5,
  type MainlineParticipationSlice,
  type StudentWorkspaceViewV5,
} from "../tutorSession/WorkspaceViewProjectorV5";

export type CoachPanelViewV5 = z.infer<typeof coachPanelViewV1Schema>;

/** F6 六类失败语义（投影层分类；非 canonical 合同——代码级枚举，登记于 ledger）。 */
export type F6FailureCategory =
  | "student_incorrect"
  | "model_runtime_failure"
  | "policy_failure"
  | "gate_binding_integrity_failure"
  | "presentation_action_failure"
  | "revision_conflict_failure";

export interface F6StatusView {
  readonly session_id: string;
  readonly session_revision: number;
  readonly workspace_revision: number;
  readonly completed: boolean;
  /** 最近一次失败语义（无失败=undefined）。 */
  readonly last_failure?: {
    readonly category: F6FailureCategory;
    readonly event_type: string;
    readonly sequence: number;
    readonly failure_class: string;
    readonly message?: string;
    /** student_incorrect 时的 gate/Beat 归属。 */
    readonly gate_id?: string;
    readonly beat_id?: string;
  };
}

export interface UnifiedProjection {
  readonly studentWorkspaceView: StudentWorkspaceViewV5;
  readonly coachPanelView: CoachPanelViewV5;
  readonly participation: MainlineParticipationSlice;
  readonly status: F6StatusView;
}

export interface UnifiedProjectionInput {
  readonly sessionId: string;
  readonly tutorState: TutorRuntimeStateV5;
  readonly workspaceState: WorkspaceRuntimeStateV5;
  readonly events: readonly StoredV5Event[];
  readonly plan: NavigatorPlanV5;
  readonly catalog: WorkspacePresentationCatalogV5;
  readonly factEntryIds: ReadonlyMap<string, string>;
  readonly sessionRevision: number;
}

/** 当前 Beat（inquiry-aware）：inquiry 打开=inquiry 游标 Beat，否则主线 Beat。 */
function currentBeatOf(input: UnifiedProjectionInput) {
  const state = input.tutorState;
  if (state.inquiry_cursor?.inquiry_protocol_id) {
    const branch = [...input.plan.branches.values()].find(
      (protocol) => protocol.protocol_id === state.inquiry_cursor!.inquiry_protocol_id,
    );
    if (branch) {
      const inInquiryDecision = [...input.events].reverse().find(
        (event) => event.event_type === "policy_decision_made" && (event.payload as { inquiry?: { inquiry_id?: string } }).inquiry?.inquiry_id === state.inquiry_cursor!.inquiry_id,
      );
      const payload = inInquiryDecision?.payload as { beat_id?: string } | undefined;
      const beatId = payload?.beat_id ?? branch.entry_beat_id;
      const beat = branch.beats.get(beatId) ?? branch.beats.get(branch.entry_beat_id);
      if (beat) return beat;
    }
  }
  const protocol =
    input.plan.mainline.protocol_id === state.teaching_cursor.protocol_id
      ? input.plan.mainline
      : [...input.plan.branches.values()].find(
          (branch) => branch.protocol_id === state.teaching_cursor.protocol_id,
        );
  const beat = protocol?.beats.get(state.teaching_cursor.beat_id);
  if (!protocol || !beat) {
    throw new Error(`projection: cursor ${state.teaching_cursor.protocol_id}/${state.teaching_cursor.beat_id} is outside the pinned plan`);
  }
  return beat;
}

interface FailureFact {
  readonly sequence: number;
  readonly category: F6FailureCategory;
  readonly event_type: string;
  readonly failure_class: string;
  readonly message?: string;
  readonly gate_id?: string;
  readonly beat_id?: string;
}

/** 六类失败语义分类（事件类型 + canonical 封闭枚举派生）。 */
function classifyFailures(events: readonly StoredV5Event[]): FailureFact | undefined {
  let latest: FailureFact | undefined;
  let latestIncorrect: FailureFact | undefined;
  let latestIncorrectGate: string | undefined;
  for (const event of events) {
    if (event.event_type === "runtime_failure") {
      const payload = event.payload as { failure_class: string; message?: string };
      const category: F6FailureCategory = payload.failure_class === "revision_conflict" ? "revision_conflict_failure" : "model_runtime_failure";
      latest = { sequence: event.sequence, category, event_type: event.event_type, failure_class: payload.failure_class, message: payload.message };
    } else if (event.event_type === "policy_failed") {
      const payload = event.payload as { failure_class: string; fallback_beat_id?: string };
      latest = { sequence: event.sequence, category: "policy_failure", event_type: event.event_type, failure_class: payload.failure_class };
    } else if (event.event_type === "presentation_failed") {
      const payload = event.payload as { failure_class: string; message?: string };
      latest = { sequence: event.sequence, category: "presentation_action_failure", event_type: event.event_type, failure_class: payload.failure_class, message: payload.message };
    } else if (event.event_type === "gate_evaluated") {
      const payload = event.payload as { gate_id: string; beat_id: string; satisfied: boolean };
      if (!payload.satisfied) {
        // student incorrect：学生证据被裁决不满足（语义分类，非新事实）。
        latestIncorrect = {
          sequence: event.sequence,
          category: "student_incorrect",
          event_type: event.event_type,
          failure_class: "gate_unsatisfied",
          gate_id: payload.gate_id,
          beat_id: payload.beat_id,
        };
        latestIncorrectGate = payload.gate_id;
      } else if (latestIncorrectGate === payload.gate_id) {
        latestIncorrect = undefined; // 同 gate 后续 satisfied 覆盖早期不满足
        latestIncorrectGate = undefined;
      }
    }
  }
  return latest ?? latestIncorrect;
}

/**
 * 轮内失败分类（orchestrator TurnResult.failure → 六类）。gate_binding_mismatch
 * 只存在于内存失败（canonical policy_failed 封闭枚举无 message 字段——R3 登记
 * 偏差：持久化为 policy_engine_error；此处按 R3 前缀口径归类，仅内存消费）。
 */
export function classifyTurnFailure(failure: { failure_class: string; message: string }): F6FailureCategory {
  if (failure.message.startsWith("gate_binding_mismatch")) return "gate_binding_integrity_failure";
  switch (failure.failure_class) {
    case "revision_conflict":
      return "revision_conflict_failure";
    case "internal_error":
      return "model_runtime_failure";
    case "gate_unresolvable":
    case "no_legal_transition":
    case "interpreter_unavailable":
    case "policy_engine_error":
    case "timeout":
      return "policy_failure";
    default:
      return "policy_failure";
  }
}

/**
 * F6 参与推导（WorkspaceViewProjectorV5 注释明示「answer/workspace 之分属
 * F5/F6」）：awaiting_evidence 按 pinned Plan 当前 Beat 的 completion
 * evidence_kind 细分 answer_input / workspace_input / confirm_input（gate_id
 * 取 Beat completion gate——cursor.gate_id 仅在 gate 评估后存在）；其余相位
 * 沿用 F3 冻结映射（completed/inquiry/presenting/gate_satisfied）。
 */
export function deriveF6Participation(
  state: TutorRuntimeStateV5,
  beat: ReturnType<typeof currentBeatOf>,
): MainlineParticipationSlice {
  if (state.completed === true) return { kind: "read_only_completed" };
  if (state.inquiry_cursor) {
    return { kind: "temporarily_paused_for_inquiry", return_checkpoint_id: state.inquiry_cursor.return_beat_id };
  }
  const gateId = beat.completion_evidence.gate?.gate_id ?? state.teaching_cursor.gate_id;
  switch (state.teaching_cursor.phase) {
    case "gate_satisfied":
      return { kind: "confirm_input", ...(gateId ? { gate_id: gateId } : {}) };
    case "awaiting_evidence": {
      switch (beat.completion_evidence.evidence_kind) {
        case "student_answer":
          return { kind: "answer_input", ...(gateId ? { gate_id: gateId } : {}) };
        case "student_confirmation":
          return { kind: "confirm_input", ...(gateId ? { gate_id: gateId } : {}) };
        case "workspace_command":
          return { kind: "workspace_input", ...(gateId ? { gate_id: gateId } : {}) };
        default:
          return { kind: "listen_only" };
      }
    }
    default:
      return { kind: "listen_only" };
  }
}

/** 投影入口（纯函数；三个视图 + status 全部同一次输入推导）。 */
export function projectUnifiedViews(input: UnifiedProjectionInput): UnifiedProjection {
  const state = input.tutorState;
  const beat = currentBeatOf(input);
  const participation = deriveF6Participation(state, beat);
  const studentWorkspaceView = projectStudentWorkspaceViewV5(input.workspaceState, input.catalog, participation);

  const cursor = state.teaching_cursor;

  // ---- mainline 受控状态 ----
  const pendingVoice = input.events.some(
    (event) => event.event_type === "voice_action_issued" && !hasOutcome(input.events, (event.payload as { action_id: string }).action_id),
  )
    // F7 Step 3（additive：v6 流适配——v5 流不含 presentation 事件，行为不变）：
    // v6 词表无 voice_action_issued；pending voice = 已 delivered 未收 outcome。
    || input.events.some(
      (event) => isDeliveredVoice(event) && !hasPresentationOutcome(input.events, deliveredRefOf(event)),
    );
  let mainline: CoachPanelViewV5["mainline"];
  if (state.completed) {
    mainline = { kind: "completed" };
  } else if (pendingVoice) {
    mainline = { kind: "recovering", checkpoint_id: cursor.beat_id };
  } else if (state.inquiry_cursor) {
    mainline = { kind: "presenting", beat_id: cursor.beat_id };
  } else {
    const gate = beat.completion_evidence.gate;
    const gateId = cursor.gate_id ?? gate?.gate_id;
    switch (cursor.phase) {
      case "awaiting_evidence": {
        const kind = beat.completion_evidence.evidence_kind;
        if (kind === "workspace_command" && gateId) {
          // awaiting_workspace.action_id：学生发起命令无 pending tutor 动作 id——
          // 以 gate 声明的期望 capability 为操作锚（登记偏差：ADR-010 未定义
          // 学生发起场景的 action_id 语义）。
          mainline = { kind: "awaiting_workspace", beat_id: cursor.beat_id, gate_id: gateId, action_id: gate?.capability ?? `gate:${gateId}` };
        } else if (kind === "student_confirmation" && gateId) {
          mainline = { kind: "awaiting_confirmation", beat_id: cursor.beat_id, gate_id: gateId };
        } else if (gateId) {
          mainline = { kind: "awaiting_answer", beat_id: cursor.beat_id, gate_id: gateId };
        } else {
          mainline = { kind: "presenting", beat_id: cursor.beat_id };
        }
        break;
      }
      case "gate_satisfied":
        mainline = gateId ? { kind: "ready_to_continue", beat_id: cursor.beat_id, gate_id: gateId } : { kind: "presenting", beat_id: cursor.beat_id };
        break;
      default:
        mainline = { kind: "presenting", beat_id: cursor.beat_id };
    }
  }

  // ---- inquiry 切片 ----
  let inquiry: CoachPanelViewV5["inquiry"];
  if (state.inquiry_cursor) {
    inquiry = {
      kind: state.inquiry_cursor.state,
      inquiry_id: state.inquiry_cursor.inquiry_id,
      return_checkpoint_id: state.inquiry_cursor.return_beat_id,
    };
  } else {
    inquiry = { kind: "no_inquiry" };
  }

  // ---- transcript（学生安全轮；不含模型私有推理）----
  // turn_id = DT- 对话轮命名空间（≠ TD- 决策 id）：确定性派生自承载事件的
  // sequence（student=intent sequence、tutor=voice issued sequence）。
  const transcript: CoachPanelViewV5["transcript"] = [];
  for (const event of input.events) {
    if (event.event_type === "student_intent_recorded") {
      const payload = event.payload as { intent_kind: string; text?: string };
      if (payload.text) {
        transcript.push({
          turn_id: dialogueTurnId(input.sessionId, event.sequence),
          role: "student",
          content: payload.text,
        });
      }
      continue;
    }
    if (event.event_type === "voice_action_issued") {
      const payload = event.payload as { action_id: string; decision_id: string; text: string; beat_id?: string };
      transcript.push({
        turn_id: dialogueTurnId(input.sessionId, event.sequence),
        role: "tutor",
        content: payload.text,
        ...(payload.beat_id !== undefined ? { beat_id: payload.beat_id } : {}),
      });
      continue;
    }
    // F7 Step 3（additive）：v6 tutor 转录 = presentation_action_delivered(voice)
    //（v5 流不含该事件类型，行为不变；文本回查 planned 序列）。
    if (isDeliveredVoice(event)) {
      const planned = indexPlannedVoiceActions(input.events).get(
        `${(event.payload as { sequence_id: string }).sequence_id}`,
      );
      const voice = planned?.voices.get((event.payload as { ordinal: number }).ordinal);
      if (voice) {
        transcript.push({
          turn_id: dialogueTurnId(input.sessionId, event.sequence),
          role: "tutor",
          content: voice.text,
          ...(planned?.beatId !== undefined ? { beat_id: planned.beatId } : {}),
        });
      }
    }
  }

  const waitingFor =
    state.completed ? undefined
      : beat.completion_evidence.evidence_kind === "workspace_command" ? "操作"
        : beat.completion_evidence.evidence_kind === "student_confirmation" ? "确认"
          : beat.completion_evidence.evidence_kind === "student_answer" ? "回答" : "继续";

  const lastVoice = [...input.events]
    .reverse()
    .find((event) => event.event_type === "voice_action_issued" || isDeliveredVoice(event));
  const failure = classifyFailures(input.events);

  const coachPanelView: CoachPanelViewV5 = {
    schema: "ai_teaching_coach_panel_view/v1",
    session_id: input.sessionId,
    revision: input.workspaceState.revision,
    mainline,
    inquiry,
    teaching_context: {
      ...(beat.part_id !== undefined ? { part_id: beat.part_id } : {}),
      beat_id: beat.beat_id,
      student_facing_progress: `第 ${beat.part_id ?? "1"} 小问 · ${beat.purpose}`,
      focus_cue: beat.purpose,
      ...(waitingFor !== undefined ? { waiting_for: waitingFor } : {}),
    },
    current_tutor_turn: lastVoice !== undefined ? (lastTutorVoiceText(input.events, lastVoice) ?? undefined) : undefined,
    assistance_available: state.completed !== true,
    replay_available: input.events.some(
      (event) => event.event_type === "voice_action_issued" || isDeliveredVoice(event),
    ),
    transcript,
  };
  if (coachPanelView.current_tutor_turn === undefined) {
    delete coachPanelView.current_tutor_turn;
  }
  const canonical = coachPanelViewV1Schema.safeParse(coachPanelView);
  if (!canonical.success) {
    throw new Error(
      `projected coach panel view fails canonical view/v1 validation: ${canonical.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const status: F6StatusView = {
    session_id: input.sessionId,
    session_revision: input.sessionRevision,
    workspace_revision: input.workspaceState.revision,
    completed: state.completed === true,
    ...(failure
      ? {
          last_failure: {
            category: failure.category,
            event_type: failure.event_type,
            sequence: failure.sequence,
            failure_class: failure.failure_class,
            ...(failure.message !== undefined ? { message: failure.message } : {}),
            ...("gate_id" in failure && failure.gate_id !== undefined ? { gate_id: failure.gate_id } : {}),
            ...("beat_id" in failure && failure.beat_id !== undefined ? { beat_id: failure.beat_id } : {}),
          },
        }
      : {}),
  };

  return { studentWorkspaceView, coachPanelView, participation, status };
}

function hasOutcome(events: readonly StoredV5Event[], actionId: string): boolean {
  return events.some(
    (event) =>
      event.event_type === "action_outcome_recorded"
      && (event.payload as { action_id: string }).action_id === actionId,
  );
}

// --------------------------------------------------------------------------- //
// F7 Step 3（additive v6 适配——v5 流不含 presentation 事件，以下分支对 v5 行为零影响；
// 参数取结构宽型（event_type: string），v5/v6 StoredEvent 均可传入）
// --------------------------------------------------------------------------- //

interface AnyStoredEventShape {
  event_type: string;
  sequence: number;
  payload: Record<string, unknown>;
}

function isDeliveredVoice(event: AnyStoredEventShape): boolean {
  return event.event_type === "presentation_action_delivered"
    && (event.payload as { kind?: string }).kind === "voice";
}

function deliveredRefOf(event: AnyStoredEventShape): { sequence_id: string; ordinal: number; action_id: string } {
  return event.payload as { sequence_id: string; ordinal: number; action_id: string };
}

function hasPresentationOutcome(
  events: readonly AnyStoredEventShape[],
  ref: { sequence_id: string; ordinal: number; action_id: string },
): boolean {
  return events.some(
    (event) =>
      event.event_type === "presentation_action_outcome_recorded"
      && (event.payload as typeof ref).sequence_id === ref.sequence_id
      && (event.payload as typeof ref).ordinal === ref.ordinal
      && (event.payload as typeof ref).action_id === ref.action_id,
  );
}

/** planned 序列的 voice 文本索引（v6 tutor 转录回查；sequence_id → {beatId, voices}）。 */
function indexPlannedVoiceActions(events: readonly AnyStoredEventShape[]): Map<string, { beatId?: string; voices: Map<number, { text: string }> }> {
  const index = new Map<string, { beatId?: string; voices: Map<number, { text: string }> }>();
  for (const event of events) {
    if (event.event_type !== "presentation_sequence_planned") continue;
    const payload = event.payload as {
      sequence_id: string;
      beat_id?: string;
      actions: Array<{ ordinal: number; kind: string; voice_action?: { text: string } }>;
    };
    const voices = new Map<number, { text: string }>();
    for (const action of payload.actions) {
      if (action.kind === "voice" && action.voice_action) voices.set(action.ordinal, { text: action.voice_action.text });
    }
    index.set(payload.sequence_id, { beatId: payload.beat_id, voices });
  }
  return index;
}

/** 最近 tutor 轮文本（v5=voice_action_issued.text；v6=delivered(voice) 回查 planned）。 */
function lastTutorVoiceText(events: readonly StoredV5Event[], event: AnyStoredEventShape): string | undefined {
  if (event.event_type === "voice_action_issued") return (event.payload as { text: string }).text;
  const ref = deliveredRefOf(event);
  return indexPlannedVoiceActions(events).get(ref.sequence_id)?.voices.get(ref.ordinal)?.text;
}

/** 对话轮 id（view/v1 transcript turn_id 的 DT- 命名空间；确定性派生）。 */
function dialogueTurnId(sessionId: string, sequence: number): string {
  return `DT-${sessionId}-${String(sequence).padStart(4, "0")}`;
}
