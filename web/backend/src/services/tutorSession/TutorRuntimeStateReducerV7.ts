/**
 * TutorRuntimeState v2 纯 reducer（F7 Step 4 — V7 Session Kernel）。
 *
 * v6 reducer（TutorRuntimeStateReducerV6）的 v7 后继：State = f(Pinned Plan +
 * 有序 committed v7 events + session-pinned capability registry) 的纯函数；
 * 输出合同仍为 state/v2/tutor-runtime-state（v7 不改 state 形状）。
 *
 * 相对 v6 的 fold 差异（ADR-011 修订 2026-09-04——两条输入因果链）：
 * 1. `student_workspace_command_recorded`（新事件）：登记学生来源权威
 *    WorkspaceCommand 事实（command_id → {capability, commandSequence,
 *    expectedWorkspaceRevision}；重复 command_id = corruption）；
 * 2. `student_intent_recorded`：只做解释器门禁（causation→更早同
 *    client_request_id 的 student_input_recorded）——v7 canonical 已移除
 *    submit_workspace_command 与内嵌命令，命令链不经 intent；
 * 3. `action_outcome_recorded{student_command}` 回执完整性：causation_sequence
 *    必须指向该命令的 `student_workspace_command_recorded` 事件（误指
 *    student_input_recorded 等其它事件 = COMMAND_CAUSATION_MISMATCH——复核 P1
 *    负例，kernel 级 stream 校验强制）；resulting_revision 恰 +1 或不变语义保留。
 * 4. 其余分支（presentation 家族有序交付 / decision / gate / inquiry /
 *     interpretation / 失败类 / session_completed）与 v6 逐条相同。
 *
 * 跨事件记忆（沿用 v5/v6 模式）：模块级 WeakMap 按 state 对象血缘传递，不进
 * canonical 输出、不参与语义比较；lineage 一律不可变复制（纯度纪律保留）。
 */
import type { z } from "zod";
import { tutorRuntimeStateV2Schema } from "../../../../shared/canonical";
import { resolveSessionPresentationAction } from "./SessionPinnedCapabilityRegistry";
import {
  RuntimeStateReducerV7Error,
  type StoredV7Event,
  type V7PresentationActionAppliedPayload,
  type V7PresentationActionRefPayload,
  type V7PresentationOutcomeRecordedPayload,
  type V7PresentationOrderedAction,
  type V7PresentationSequencePlannedPayload,
  type V7PresentationSequenceSupersededPayload,
  type V7SessionStartedPayload,
  type V7StudentInputRecordedPayload,
  type V7StudentIntentRecordedPayload,
  type V7StudentWorkspaceCommandRecordedPayload,
} from "./TutorSessionEventV7";
import {
  TutorSessionIntegrityError,
  type V5ActionOutcomePayload,
  V5GateEvaluatedPayload,
  V5InquiryPayload,
  V5PolicyDecisionPayload,
  V5SemanticInterpretationPayload,
} from "./TutorSessionEventV5";

/** state/v2 TutorRuntimeState（canonical Zod 推导类型，唯一形状；v7 不改）。 */
export type TutorRuntimeStateV7 = z.infer<typeof tutorRuntimeStateV2Schema>;

/** V7 fold context：session-pinned capability registry（append/rebuild 同源重解析）。 */
export type V7FoldContext = import("./SessionPinnedCapabilityRegistry").SessionPinnedCapabilityRegistry;

/**
 * fold 血缘索引：已提交学生输入链 + 学生命令事实（v7：经独立事件，非 intent
 * 内嵌）+ presentation 序列状态。只服务于跨事件完整性检查，不是 canonical
 * state 的一部分。纯度纪律：lineage 一律不可变复制。
 */
interface V7FoldLineage {
  readonly studentInputs: ReadonlyMap<number, { clientRequestId: string }>;
  readonly studentCommands: ReadonlyMap<
    string,
    { capability: string; commandSequence: number; expectedWorkspaceRevision: number }
  >;
  readonly sequences: ReadonlyMap<string, V7PlannedSequenceLineage>;
}

interface V7PlannedSequenceLineage {
  readonly actions: readonly { ordinal: number; kind: "voice" | "workspace"; actionId: string }[];
  readonly superseded: boolean;
  readonly presentedOrdinals: ReadonlySet<number>;
  readonly validatedOrdinals: ReadonlySet<number>;
  readonly appliedOrdinals: ReadonlySet<number>;
}

/** withSequenceUpdated 的可变工作副本（复制后本地修改，落回只读形状）。 */
interface V7WritablePlannedSequence {
  superseded: boolean;
  presentedOrdinals: Set<number>;
  validatedOrdinals: Set<number>;
  appliedOrdinals: Set<number>;
}

/** presentation 序列的不可变更新（调用方已校验 sequence 存在）。 */
function withSequenceUpdated(
  lineage: V7FoldLineage,
  sequenceId: string,
  update: (sequence: V7WritablePlannedSequence) => void,
): V7FoldLineage {
  const existing = lineage.sequences.get(sequenceId);
  if (!existing) {
    throw new RuntimeStateReducerV7Error(
      "PRESENTATION_ORDER_INVALID",
      `internal: withSequenceUpdated called for unregistered sequence ${sequenceId}`,
    );
  }
  const copy: V7WritablePlannedSequence = {
    superseded: existing.superseded,
    presentedOrdinals: new Set(existing.presentedOrdinals),
    validatedOrdinals: new Set(existing.validatedOrdinals),
    appliedOrdinals: new Set(existing.appliedOrdinals),
  };
  update(copy);
  const sequences = new Map(lineage.sequences);
  sequences.set(sequenceId, { actions: existing.actions, ...copy });
  return {
    studentInputs: lineage.studentInputs,
    studentCommands: lineage.studentCommands,
    sequences,
  };
}

const foldLineageByState = new WeakMap<object, V7FoldLineage>();

function emptyLineage(): V7FoldLineage {
  return {
    studentInputs: new Map(),
    studentCommands: new Map(),
    sequences: new Map(),
  };
}

function lineageOf(state: TutorRuntimeStateV7): V7FoldLineage {
  return foldLineageByState.get(state) ?? emptyLineage();
}

function withLineage(state: TutorRuntimeStateV7, lineage: V7FoldLineage): TutorRuntimeStateV7 {
  foldLineageByState.set(state, lineage);
  return state;
}

/**
 * v9 组装缝（F7 RT4）：把 source state 的 fold lineage 过继到同血缘的 target
 * state 对象（v9 reducer 在 v4 字段上做生成态归约时保持跨事件完整性检查的
 * lineage 连续）。纯桥接，不改变 lineage 内容；source 只要求是同一血缘的
 * state 对象（WeakMap 键），不约束 schema 字面量。
 */
export function adoptV7Lineage<TState extends object>(target: TState, source: object): TState {
  foldLineageByState.set(target, lineageOf(source as TutorRuntimeStateV7));
  return target;
}

export function initialStateFromSessionStartedV7(event: StoredV7Event): TutorRuntimeStateV7 {
  if (event.event_type !== "session_started") {
    throw new RuntimeStateReducerV7Error(
      "MISSING_SESSION_START",
      `first committed event must be session_started, got ${event.event_type}`,
      event.sequence,
    );
  }
  const payload = event.payload as unknown as V7SessionStartedPayload;
  // v7 新增：session_mode 显式记录（canonical 已强制必填；此处防御性复核——
  // mode 是 assessment 权限矩阵与 catalog pin 双重对账的输入）。
  if (payload.session_mode !== "teaching" && payload.session_mode !== "assessment") {
    throw new RuntimeStateReducerV7Error(
      "SESSION_MODE_MISMATCH",
      `session_started carries illegal session_mode=${String(payload.session_mode)} (expect teaching|assessment)`,
      event.sequence,
    );
  }
  return withLineage(
    {
      schema: "ai_teaching_tutor_runtime_state/v2",
      session_id: event.session_id,
      state_revision: event.state_revision,
      pinned_plan: {
        tutor_plan_ref: payload.tutor_plan_ref,
        solution_graph_ref: payload.solution_graph_ref,
        protocol_refs: payload.protocol_refs,
        ...(payload.policy_profile_snapshot ? { policy_profile_snapshot: payload.policy_profile_snapshot } : {}),
      },
      teaching_cursor: {
        protocol_id: payload.initial_cursor.protocol_id,
        beat_id: payload.initial_cursor.beat_id,
        phase: "presenting",
      },
      inquiry_cursor: null,
      workspace_revision: 0,
      completed: false,
      presentation_cursor: { status: "idle" },
    },
    emptyLineage(),
  );
}

function cloneState(state: TutorRuntimeStateV7): TutorRuntimeStateV7 {
  return {
    ...state,
    pinned_plan: { ...state.pinned_plan },
    teaching_cursor: { ...state.teaching_cursor },
    inquiry_cursor: state.inquiry_cursor ? { ...state.inquiry_cursor } : null,
    ...(state.reasoning_focus ? { reasoning_focus: { ...state.reasoning_focus } } : {}),
    presentation_cursor:
      state.presentation_cursor.status === "idle"
        ? { status: "idle" }
        : { ...state.presentation_cursor },
  };
}

// --------------------------------------------------------------------------- //
// 两条输入链（语言/控制链 intent 门禁 + 命令链事实登记/回执完整性）
// --------------------------------------------------------------------------- //

/**
 * student_intent_recorded 的解释器门禁（v6 同款）：causation 必须指向同 session
 * 更早的 student_input_recorded 且 client_request_id 一致。v7 起 intent 只表示
 * 语义解释产物——无命令登记（命令走 student_workspace_command_recorded）。
 */
function foldStudentIntentV7(lineage: V7FoldLineage, event: StoredV7Event): V7FoldLineage {
  const payload = event.payload as unknown as V7StudentIntentRecordedPayload;
  const causation = event.causation_sequence;
  if (causation === undefined || !lineage.studentInputs.has(causation)) {
    throw new RuntimeStateReducerV7Error(
      "INTENT_CAUSATION_MISMATCH",
      `sequence ${event.sequence}: student_intent_recorded causation_sequence=${String(
        causation,
      )} does not reference an earlier committed student_input_recorded in the same session`,
      event.sequence,
    );
  }
  const sourceInput = lineage.studentInputs.get(causation)!;
  if (sourceInput.clientRequestId !== payload.client_request_id) {
    throw new RuntimeStateReducerV7Error(
      "INTENT_CAUSATION_MISMATCH",
      `sequence ${event.sequence}: student_intent_recorded client_request_id=${payload.client_request_id} differs from the referenced student_input_recorded (${sourceInput.clientRequestId})`,
      event.sequence,
    );
  }
  return lineage;
}

/** 学生来源权威 WorkspaceCommand 事实登记（v7 新事件；raw fact 无 causation）。 */
function foldStudentWorkspaceCommandRecorded(lineage: V7FoldLineage, event: StoredV7Event): V7FoldLineage {
  const command = event.payload as unknown as V7StudentWorkspaceCommandRecordedPayload;
  if (lineage.studentCommands.has(command.command_id)) {
    throw new TutorSessionIntegrityError(
      "CORRUPT_EVENT",
      `sequence ${event.sequence}: student command ${command.command_id} is registered twice (duplicate command_id across committed command facts)`,
      event.sequence,
    );
  }
  const studentCommands = new Map(lineage.studentCommands);
  studentCommands.set(command.command_id, {
    capability: command.capability,
    commandSequence: event.sequence,
    expectedWorkspaceRevision: command.expected_workspace_revision,
  });
  return {
    studentInputs: lineage.studentInputs,
    studentCommands,
    sequences: lineage.sequences,
  };
}

/**
 * action_outcome_recorded(student_command) 回执完整性（v7）：causation_sequence
 * 必须指向该命令的 student_workspace_command_recorded 事件——误指
 * student_input_recorded 等其它事件 = COMMAND_CAUSATION_MISMATCH（复核 P1 负例，
 * kernel 级 stream 校验强制）；resulting_revision 恰 +1 或不变语义保留（R0 §5）。
 */
function assertStudentCommandReceiptV7(
  lineage: V7FoldLineage,
  state: TutorRuntimeStateV7,
  event: StoredV7Event,
): void {
  const outcome = event.payload as unknown as V5ActionOutcomePayload;
  const command = lineage.studentCommands.get(outcome.action_id);
  if (!command) {
    throw new TutorSessionIntegrityError(
      "CORRUPT_EVENT",
      `sequence ${event.sequence}: orphan student_command outcome ${outcome.action_id} (no committed student_workspace_command_recorded with this command_id)`,
      event.sequence,
    );
  }
  if (event.causation_sequence !== command.commandSequence) {
    throw new RuntimeStateReducerV7Error(
      "COMMAND_CAUSATION_MISMATCH",
      `sequence ${event.sequence}: student_command outcome ${outcome.action_id} causation_sequence=${String(
        event.causation_sequence,
      )} does not point at the command's student_workspace_command_recorded event (sequence ${command.commandSequence}) — cross-event-type causation is fail closed`,
      event.sequence,
    );
  }
  if (outcome.outcome === "completed" && typeof outcome.resulting_revision === "number") {
    const expected = command.expectedWorkspaceRevision;
    if (outcome.resulting_revision !== expected && outcome.resulting_revision !== expected + 1) {
      throw new TutorSessionIntegrityError(
        "CORRUPT_EVENT",
        `sequence ${event.sequence}: student_command outcome ${outcome.action_id} resulting_revision=${outcome.resulting_revision} violates the exact semantics (must be ${expected} unchanged or ${expected + 1} exactly-once)`,
        event.sequence,
      );
    }
    if (outcome.resulting_revision < state.workspace_revision) {
      throw new TutorSessionIntegrityError(
        "CORRUPT_EVENT",
        `sequence ${event.sequence}: student_command outcome ${outcome.action_id} resulting_revision=${outcome.resulting_revision} regresses below the folded workspace_revision=${state.workspace_revision}`,
        event.sequence,
      );
    }
  }
}

// --------------------------------------------------------------------------- //
// presentation 家族（有序交付生命周期 + cursor 对账；v6 同款）
// --------------------------------------------------------------------------- //

function actionIdOf(action: V7PresentationOrderedAction): string {
  return action.kind === "voice" ? (action.voice_action?.action_id ?? "") : (action.workspace_action?.action_id ?? "");
}

function requirePlannedAction(
  lineage: V7FoldLineage,
  event: StoredV7Event,
  ref: V7PresentationActionRefPayload,
): { sequence: V7PlannedSequenceLineage } {
  const sequence = lineage.sequences.get(ref.sequence_id);
  if (!sequence) {
    throw new RuntimeStateReducerV7Error(
      "PRESENTATION_ORDER_INVALID",
      `sequence ${event.sequence}: ${event.event_type} references unregistered sequence ${ref.sequence_id}`,
      event.sequence,
    );
  }
  if (sequence.superseded) {
    throw new RuntimeStateReducerV7Error(
      "PRESENTATION_ORDER_INVALID",
      `sequence ${event.sequence}: ${event.event_type} references superseded sequence ${ref.sequence_id}`,
      event.sequence,
    );
  }
  const planned = sequence.actions.find((action) => action.ordinal === ref.ordinal);
  if (!planned) {
    throw new RuntimeStateReducerV7Error(
      "PRESENTATION_ORDER_INVALID",
      `sequence ${event.sequence}: ${event.event_type} ordinal=${ref.ordinal} is outside sequence ${ref.sequence_id} (length ${sequence.actions.length})`,
      event.sequence,
    );
  }
  if (planned.actionId !== ref.action_id || planned.kind !== ref.kind) {
    throw new RuntimeStateReducerV7Error(
      "PRESENTATION_ORDER_INVALID",
      `sequence ${event.sequence}: ${event.event_type} ref ${ref.action_id}/kind=${ref.kind} does not match the planned action ${planned.actionId}/kind=${planned.kind} at ordinal ${ref.ordinal}`,
      event.sequence,
    );
  }
  return { sequence };
}

/** 「全部更早 ordinal 已 presented」——只有浏览器 presented 才推进下一项。 */
function earlierOrdinalsPresented(sequence: V7PlannedSequenceLineage, ordinal: number): boolean {
  return sequence.actions.every((action) => action.ordinal >= ordinal || sequence.presentedOrdinals.has(action.ordinal));
}

function foldSequencePlanned(
  lineage: V7FoldLineage,
  event: StoredV7Event,
  context: V7FoldContext,
): V7FoldLineage {
  const payload = event.payload as unknown as V7PresentationSequencePlannedPayload;
  if (lineage.sequences.has(payload.sequence_id)) {
    throw new RuntimeStateReducerV7Error(
      "PRESENTATION_ORDER_INVALID",
      `sequence ${event.sequence}: presentation sequence ${payload.sequence_id} is registered twice`,
      event.sequence,
    );
  }
  // capability/target 门禁（增补 10 #3）：session-pinned registry 校验每个
  // workspace action；unknown → 整批拒绝（零事件、零状态变更、零 delivery）。
  for (const action of payload.actions) {
    if (action.kind !== "workspace" || !action.workspace_action) continue;
    const verdict = resolveSessionPresentationAction(context, action.workspace_action);
    if (!verdict.ok) {
      throw new RuntimeStateReducerV7Error(
        "CAPABILITY_UNREGISTERED",
        `sequence ${event.sequence}: presentation sequence ${payload.sequence_id} ordinal=${action.ordinal} action ${action.workspace_action.action_id}: ${verdict.reason} (fail closed; zero events, zero state change, zero delivery)`,
        event.sequence,
      );
    }
  }
  const actions = payload.actions.map((action) => ({
    ordinal: action.ordinal,
    kind: action.kind,
    actionId: actionIdOf(action),
  }));
  if (actions.some((action) => !action.actionId)) {
    throw new RuntimeStateReducerV7Error(
      "REDUCER_INVARIANT",
      `sequence ${event.sequence}: presentation sequence ${payload.sequence_id} contains an action without an action_id for its kind`,
      event.sequence,
    );
  }
  const sequences = new Map(lineage.sequences);
  sequences.set(payload.sequence_id, {
    actions,
    superseded: false,
    presentedOrdinals: new Set<number>(),
    validatedOrdinals: new Set<number>(),
    appliedOrdinals: new Set<number>(),
  });
  // planned 后教学阶段保持 presenting（PLAN.md §2.2）——不改 phase/cursor。
  return {
    studentInputs: lineage.studentInputs,
    studentCommands: lineage.studentCommands,
    sequences,
  };
}

/** 单事件归约（纯函数：返回新 state，不修改入参）。事件须已过 canonical 校验。 */
export function applyV7Event(
  state: TutorRuntimeStateV7,
  event: StoredV7Event,
  context: V7FoldContext,
): TutorRuntimeStateV7 {
  const lineage = lineageOf(state);
  const next = cloneState(state);
  next.state_revision = event.state_revision;
  const payload = event.payload;

  switch (event.event_type) {
    case "student_input_recorded": {
      const input = payload as unknown as V7StudentInputRecordedPayload;
      const studentInputs = new Map(lineage.studentInputs);
      studentInputs.set(event.sequence, { clientRequestId: input.client_request_id });
      return withLineage(next, {
        studentInputs,
        studentCommands: lineage.studentCommands,
        sequences: lineage.sequences,
      });
    }
    case "student_workspace_command_recorded": {
      const nextLineage = foldStudentWorkspaceCommandRecorded(lineage, event);
      return withLineage(next, nextLineage);
    }
    case "student_intent_recorded": {
      const nextLineage = foldStudentIntentV7(lineage, event);
      return withLineage(next, nextLineage);
    }
    case "semantic_interpretation_recorded": {
      // v5 R0 §1 语义保留：携带 reasoning_focus ⇒ 整体覆写；缺省不动。
      const interpretation = payload as unknown as V5SemanticInterpretationPayload;
      if (interpretation.reasoning_focus) {
        next.reasoning_focus = {
          ...interpretation.reasoning_focus,
          graph_fact_refs: [...interpretation.reasoning_focus.graph_fact_refs],
        };
      }
      return withLineage(next, lineage);
    }
    case "policy_decision_made": {
      const decision = payload as unknown as V5PolicyDecisionPayload;
      switch (decision.decision_kind) {
        case "transition_beat":
        case "revisit_beat":
        case "return_to_mainline": {
          if (!decision.to_beat_id) break;
          next.teaching_cursor = {
            protocol_id: decision.protocol_id,
            beat_id: decision.to_beat_id,
            phase: "presenting",
          };
          next.inquiry_cursor = null;
          break;
        }
        case "complete_beat":
          next.teaching_cursor.phase = "completed";
          break;
        case "execute_beat":
          next.teaching_cursor.phase = "presenting";
          break;
        case "open_inquiry":
        case "open_scaffold": {
          if (!decision.inquiry) break;
          next.inquiry_cursor = {
            inquiry_id: decision.inquiry.inquiry_id,
            state: decision.decision_kind === "open_inquiry" ? "clarifying" : "supporting",
            return_beat_id: decision.inquiry.return_beat_id,
            ...(decision.inquiry.inquiry_protocol_id
              ? { inquiry_protocol_id: decision.inquiry.inquiry_protocol_id }
              : {}),
          };
          break;
        }
        default:
          // continue_inquiry / accept_alternate_path / change_stance /
          // request_clarification / pause / safe_fallback：事实入流，不改游标。
          break;
      }
      return withLineage(next, lineage);
    }
    case "inquiry_opened": {
      const inquiry = payload as unknown as V5InquiryPayload;
      if (next.inquiry_cursor && next.inquiry_cursor.inquiry_id !== inquiry.inquiry_id) {
        throw new RuntimeStateReducerV7Error(
          "REDUCER_INVARIANT",
          `inquiry_opened while another inquiry ${next.inquiry_cursor.inquiry_id} is open`,
          event.sequence,
        );
      }
      next.inquiry_cursor = {
        inquiry_id: inquiry.inquiry_id,
        state: "clarifying",
        return_beat_id: inquiry.return_beat_id,
        ...(inquiry.inquiry_protocol_id ? { inquiry_protocol_id: inquiry.inquiry_protocol_id } : {}),
      };
      return withLineage(next, lineage);
    }
    case "inquiry_returned": {
      const inquiry = payload as unknown as V5InquiryPayload;
      if (!next.inquiry_cursor) return withLineage(next, lineage);
      if (next.inquiry_cursor.return_beat_id !== inquiry.return_beat_id) {
        throw new RuntimeStateReducerV7Error(
          "INQUIRY_RETURN_MISMATCH",
          `inquiry_returned return_beat_id=${inquiry.return_beat_id} differs from opened ${next.inquiry_cursor.return_beat_id}`,
          event.sequence,
        );
      }
      next.teaching_cursor = {
        protocol_id: next.teaching_cursor.protocol_id,
        beat_id: inquiry.return_beat_id,
        phase: "presenting",
      };
      next.inquiry_cursor = null;
      return withLineage(next, lineage);
    }
    case "gate_evaluated": {
      const gate = payload as unknown as V5GateEvaluatedPayload;
      // R3 语义保留：gate 事实必须绑定当时的主线 Beat（wrong/future/stale
      // fail closed；gate_id 与 pinned Plan 的绑定校验属 Navigator 重建边界）。
      if (gate.beat_id !== next.teaching_cursor.beat_id) {
        throw new RuntimeStateReducerV7Error(
          "GATE_BEAT_MISMATCH",
          `sequence ${event.sequence}: gate_evaluated ${gate.gate_id}@${gate.beat_id} does not match the current teaching cursor beat ${next.teaching_cursor.beat_id} (fail closed; no silent phase effect)`,
          event.sequence,
        );
      }
      next.teaching_cursor.gate_id = gate.gate_id;
      next.teaching_cursor.phase = gate.satisfied ? "gate_satisfied" : "awaiting_evidence";
      return withLineage(next, lineage);
    }
    case "presentation_sequence_planned": {
      const nextLineage = foldSequencePlanned(lineage, event, context);
      return withLineage(next, nextLineage);
    }
    case "presentation_action_validated": {
      const ref = payload as unknown as V7PresentationActionRefPayload;
      const { sequence } = requirePlannedAction(lineage, event, ref);
      if (sequence.validatedOrdinals.has(ref.ordinal)) {
        throw new RuntimeStateReducerV7Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: presentation action ${ref.action_id}@${ref.ordinal} is validated twice`,
          event.sequence,
        );
      }
      return withLineage(
        next,
        withSequenceUpdated(lineage, ref.sequence_id, (copy) => {
          copy.validatedOrdinals.add(ref.ordinal);
        }),
      );
    }
    case "presentation_action_applied": {
      const ref = payload as unknown as V7PresentationActionAppliedPayload;
      const { sequence } = requirePlannedAction(lineage, event, ref);
      if (!sequence.validatedOrdinals.has(ref.ordinal)) {
        throw new RuntimeStateReducerV7Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: presentation action ${ref.action_id}@${ref.ordinal} is applied before being validated`,
          event.sequence,
        );
      }
      if (sequence.appliedOrdinals.has(ref.ordinal)) {
        throw new RuntimeStateReducerV7Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: presentation action ${ref.action_id}@${ref.ordinal} is applied twice`,
          event.sequence,
        );
      }
      const appliedLineage = withSequenceUpdated(lineage, ref.sequence_id, (copy) => {
        copy.appliedOrdinals.add(ref.ordinal);
      });
      if (ref.kind === "workspace" && typeof ref.resulting_workspace_revision === "number") {
        // 服务端应用 ≠ 浏览器呈现完成：workspace_revision 在 applied 推进
        // （delivery 携带的 workspace_revision 即此回执），单调禁回退。
        if (ref.resulting_workspace_revision < next.workspace_revision) {
          throw new RuntimeStateReducerV7Error(
            "PRESENTATION_ORDER_INVALID",
            `sequence ${event.sequence}: presentation action ${ref.action_id} resulting_workspace_revision=${ref.resulting_workspace_revision} regresses below the folded workspace_revision=${next.workspace_revision}`,
            event.sequence,
          );
        }
        next.workspace_revision = Math.max(next.workspace_revision, ref.resulting_workspace_revision);
      }
      return withLineage(next, appliedLineage);
    }
    case "presentation_action_delivered": {
      const ref = payload as unknown as V7PresentationActionRefPayload;
      const { sequence } = requirePlannedAction(lineage, event, ref);
      if (sequence.presentedOrdinals.has(ref.ordinal)) {
        throw new RuntimeStateReducerV7Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: presentation action ${ref.action_id}@${ref.ordinal} is delivered after being presented`,
          event.sequence,
        );
      }
      // 同一 pending ref 的重复 delivered = 幂等 no-op（refresh 重投语义）；
      // 不同 ref / 越序 / failed 停留期间一律拒绝。
      const cursor = next.presentation_cursor;
      if (cursor.status === "awaiting_browser") {
        if (cursor.sequence_id === ref.sequence_id && cursor.ordinal === ref.ordinal && cursor.action_id === ref.action_id) {
          return withLineage(next, lineage);
        }
        throw new RuntimeStateReducerV7Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: delivery for ${ref.action_id}@${ref.ordinal} while ${cursor.action_id}@${cursor.ordinal} of ${cursor.sequence_id} is still awaiting browser outcome`,
          event.sequence,
        );
      }
      if (cursor.status === "failed") {
        throw new RuntimeStateReducerV7Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: delivery for ${ref.action_id}@${ref.ordinal} while the cursor is parked failed at ${cursor.action_id}@${cursor.ordinal} of ${cursor.sequence_id} (recovery requires control.retry_recovery + new sequence)`,
          event.sequence,
        );
      }
      if (!earlierOrdinalsPresented(sequence, ref.ordinal)) {
        throw new RuntimeStateReducerV7Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: delivery for ${ref.action_id}@${ref.ordinal} skips an un-presented earlier ordinal in ${ref.sequence_id} (cursor only advances on browser presented)`,
          event.sequence,
        );
      }
      // workspace 必须先经服务端 validator/reducer 应用（未应用不得交付——
      // 增补 10 #4）；voice 只需 validated（无权威状态转移）。
      if (ref.kind === "workspace" && !sequence.appliedOrdinals.has(ref.ordinal)) {
        throw new RuntimeStateReducerV7Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: workspace action ${ref.action_id}@${ref.ordinal} is delivered before being applied (workspace_revision receipt required)`,
          event.sequence,
        );
      }
      if (ref.kind === "voice" && !sequence.validatedOrdinals.has(ref.ordinal)) {
        throw new RuntimeStateReducerV7Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: voice action ${ref.action_id}@${ref.ordinal} is delivered before being validated`,
          event.sequence,
        );
      }
      next.presentation_cursor = {
        status: "awaiting_browser",
        sequence_id: ref.sequence_id,
        ordinal: ref.ordinal,
        action_id: ref.action_id,
      };
      return withLineage(next, lineage);
    }
    case "presentation_action_outcome_recorded": {
      const ref = payload as unknown as V7PresentationOutcomeRecordedPayload;
      const cursor = next.presentation_cursor;
      // cursor 对账（增补 9 Step 2 义务）：孤儿 / 越序 / 重复 / 非 pending
      // 一律 fail closed——只有浏览器 outcome 推进 cursor。
      if (
        cursor.status !== "awaiting_browser" ||
        cursor.sequence_id !== ref.sequence_id ||
        cursor.ordinal !== ref.ordinal ||
        cursor.action_id !== ref.action_id
      ) {
        const at = cursor.status === "idle" ? "idle" : `${cursor.action_id}@${cursor.ordinal} of ${cursor.sequence_id} (${cursor.status})`;
        throw new RuntimeStateReducerV7Error(
          "PRESENTATION_CURSOR_MISMATCH",
          `sequence ${event.sequence}: outcome for ${ref.action_id}@${ref.ordinal} of ${ref.sequence_id} does not match the pending cursor (at ${at})`,
          event.sequence,
        );
      }
      const { sequence } = requirePlannedAction(lineage, event, ref);
      let outcomeLineage: V7FoldLineage = lineage;
      switch (ref.outcome) {
        case "presented": {
          outcomeLineage = withSequenceUpdated(lineage, ref.sequence_id, (copy) => {
            copy.presentedOrdinals.add(ref.ordinal);
          });
          next.presentation_cursor = { status: "idle" };
          // 最后一项 presented 后才能进入 awaiting_evidence（且仅在 presenting
          // 相位——v5 voice completed 规则的 v6/v7 落点）。
          const isLast = !sequence.actions.some((action) => action.ordinal > ref.ordinal);
          if (isLast && next.teaching_cursor.phase === "presenting") {
            next.teaching_cursor.phase = "awaiting_evidence";
          }
          break;
        }
        case "interrupted": {
          // 浏览器打断：cursor 回 idle；剩余 ordinal 因 presented-集检查锁死，
          // 废止由后续 presentation_sequence_superseded(reason=interrupted) 记录。
          next.presentation_cursor = { status: "idle" };
          break;
        }
        case "failed": {
          // presentation/system failure（非学生错误）：cursor 停留 failed；已应用
          // 的 Workspace 语义不伪回滚；恢复只能经 supersede + retry_recovery。
          next.presentation_cursor = {
            status: "failed",
            sequence_id: ref.sequence_id,
            ordinal: ref.ordinal,
            action_id: ref.action_id,
          };
          break;
        }
      }
      return withLineage(next, outcomeLineage);
    }
    case "presentation_sequence_superseded": {
      const ref = payload as unknown as V7PresentationSequenceSupersededPayload;
      const sequence = lineage.sequences.get(ref.sequence_id);
      if (!sequence) {
        throw new RuntimeStateReducerV7Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: presentation_sequence_superseded references unregistered sequence ${ref.sequence_id}`,
          event.sequence,
        );
      }
      if (sequence.superseded) {
        throw new RuntimeStateReducerV7Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: presentation sequence ${ref.sequence_id} is superseded twice`,
          event.sequence,
        );
      }
      const cursor = next.presentation_cursor;
      if (
        cursor.status !== "idle" &&
        cursor.sequence_id === ref.sequence_id &&
        ref.pending_ordinal !== undefined &&
        ref.pending_action_id !== undefined &&
        (cursor.ordinal !== ref.pending_ordinal || cursor.action_id !== ref.pending_action_id)
      ) {
        throw new RuntimeStateReducerV7Error(
          "PRESENTATION_CURSOR_MISMATCH",
          `sequence ${event.sequence}: superseded pending ref ${ref.pending_action_id}@${ref.pending_ordinal} does not match the cursor ${cursor.action_id}@${cursor.ordinal}`,
          event.sequence,
        );
      }
      const supersededLineage = withSequenceUpdated(lineage, ref.sequence_id, (copy) => {
        copy.superseded = true;
      });
      if (cursor.status !== "idle" && cursor.sequence_id === ref.sequence_id) {
        next.presentation_cursor = { status: "idle" };
      }
      return withLineage(next, supersededLineage);
    }
    case "action_outcome_recorded": {
      const outcome = payload as unknown as V5ActionOutcomePayload;
      // v6 收窄保留：仅 student_command（canonical 字面量强制；防御性复核）。
      if (outcome.action_kind !== "student_command") {
        throw new RuntimeStateReducerV7Error(
          "REDUCER_INVARIANT",
          `sequence ${event.sequence}: v7 action_outcome_recorded only admits action_kind=student_command, got ${String(outcome.action_kind)}`,
          event.sequence,
        );
      }
      assertStudentCommandReceiptV7(lineage, next, event);
      if (outcome.outcome !== "completed") return withLineage(next, lineage);
      if (
        typeof outcome.resulting_revision === "number" &&
        outcome.resulting_revision > next.workspace_revision
      ) {
        next.workspace_revision = outcome.resulting_revision;
      }
      return withLineage(next, lineage);
    }
    case "session_completed": {
      next.completed = true;
      next.teaching_cursor.phase = "completed";
      return withLineage(next, lineage);
    }
    default:
      // external_support_recorded / student_progressed / policy_failed /
      // runtime_failure / session_started（首事件经 initialState 处理，此处
      // 到达即为流内重复，不改 state）。
      return withLineage(next, lineage);
  }
}

/** 全量折叠：session_started 起步 + 逐事件归约（在线与重建共用）。 */
export function foldCommittedV7Events(
  events: readonly StoredV7Event[],
  context: V7FoldContext,
): TutorRuntimeStateV7 {
  if (events.length === 0) {
    throw new RuntimeStateReducerV7Error("MISSING_SESSION_START", "committed event stream is empty");
  }
  let state = initialStateFromSessionStartedV7(events[0]);
  for (const event of events.slice(1)) {
    state = applyV7Event(state, event, context);
  }
  return state;
}
