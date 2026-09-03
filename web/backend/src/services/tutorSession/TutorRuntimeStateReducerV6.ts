/**
 * TutorRuntimeState v2 纯 reducer（F7 Step 2 — V6 Session Kernel）。
 *
 * State = f(Pinned Plan + 有序 committed v6 events + session-pinned capability
 * registry) 的纯函数：
 * - 输出合同：state/v2/tutor-runtime-state（v1 全字段逐字段保留 + presentation
 *   cursor 三态 idle | awaiting_browser | failed；TS 镜像 tutorRuntimeStateV2Schema）；
 * - 在线 state 与 rebuilt state 使用同一领域 reducer（G2 不变量）：在线 kernel
 *   与 rebuilder 都只经 foldCommittedV6Events / applyV6Event 推进，无第二条
 *   state machine；
 * - reducer 不产生决策、不读 Plan 内容，只把 committed 事实确定性落到 state/v2
 *   字段；跨事件门禁经 fold context（session-pinned capability registry，
 *   codec.resolveFoldContext 从 session_started pin 确定性重导出）裁决。
 *
 * V6 相对 v5 的状态语义（ADR-011 / PLAN.md §2.2）：
 * 1. presentation 家族驱动 cursor：
 *    - `presentation_sequence_planned` 注册序列（capability/target 门禁在此，
 *      unknown → CAPABILITY_UNREGISTERED 整批拒绝：零事件、零状态、零 delivery）；
 *      教学阶段保持 presenting，不因 planned 改相位；
 *    - `presentation_action_validated` / `presentation_action_applied` 是
 *      服务端事实；workspace 的 resulting_workspace_revision 在 **applied**
 *      推进 state.workspace_revision（服务端应用 ≠ 浏览器呈现完成），禁止回退；
 *    - `presentation_action_delivered` 把 cursor 置为 awaiting_browser
 *      {sequence_id, ordinal, action_id}；workspace 未 applied 先 delivered →
 *      PRESENTATION_ORDER_INVALID（增补 10 #4 跨事件不变量）；只能交付「全部
 *      更早 ordinal 已 presented」的下一项（越序拒绝）；同一 pending ref 的
 *      重复 delivered 为幂等 no-op（refresh 重投语义），不同 ref 拒绝；
 *    - `presentation_action_outcome_recorded` 必须与 pending cursor 唯一对账
 *      （sequence_id + ordinal + action_id + kind；孤儿/越序/重复 →
 *      PRESENTATION_CURSOR_MISMATCH——增补 9 的 Step 2 服务端义务）：
 *      · presented → cursor 回 idle；同序列最后一项 presented 且相位
 *        presenting 时 → awaiting_evidence（最后一项 presented 后才能等证据）；
 *      · interrupted → cursor 回 idle，剩余 ordinal 因 presented-集检查天然
 *        锁死（废止由 presentation_sequence_superseded 记录）；
 *      · failed → cursor 停留 failed{同三元组}；已应用的 Workspace 语义不伪
 *        回滚；恢复只能经 supersede(reason=retry_recovery) + 新恢复 sequence；
 *    - `presentation_sequence_superseded` 关闭序列（后续 delivered/validated/
 *      applied 全拒）并清除引用该序列的 cursor（failed 停留亦由此解锁）。
 * 2. `student_input_recorded` 登记原始输入链（sequence → client_request_id）；
 *    `student_intent_recorded` 是后端解释器派生事实，causation_sequence 必须
 *    指向同 session 更早的 student_input_recorded 且 client_request_id 相同
 *    （缺失=canonical 拒；未来引用=store CAUSATION_REF_INVALID；类型/request id
 *    不符=INTENT_CAUSATION_MISMATCH 整批拒绝——增补 10 #2）。
 * 3. `action_outcome_recorded` 收窄为仅 student_command：R0 §5 回执四规则
 *    （orphan / 重复注册 / causation 断链 / resulting_revision 恰 +1 或不变）
 *    逐条保留（CORRUPT_EVENT 家族 fail closed）。v5 的「voice completed →
 *    awaiting_evidence」路径删除——tutor 呈现完成只经浏览器 outcome。
 * 4. 保留分支（decision/gate/inquiry/interpretation/support/失败类/session_
 *    completed）语义与 v5 逐条相同。
 *
 * 跨事件记忆的实现（沿用 v5 模式）：reducer 状态对象是 canonical state/v2
 * （冻结形状，禁止携带私有字段），已提交输入/命令/呈现序列索引经模块级
 * WeakMap 按 state 对象血缘传递。该索引不进入 canonical 输出、不参与语义
 * 比较——只是 fold 累加器的载体，保证 store 预折叠、kernel 在线推进、
 * rebuilder 全量重放三条路径执行同一完整性检查。
 */
import type { z } from "zod";
import { tutorRuntimeStateV2Schema } from "../../../../shared/canonical";
import { resolveSessionPresentationAction } from "./SessionPinnedCapabilityRegistry";
import {
  RuntimeStateReducerV6Error,
  type StoredV6Event,
  type V6PresentationActionAppliedPayload,
  type V6PresentationActionRefPayload,
  type V6PresentationOutcomeRecordedPayload,
  type V6PresentationOrderedAction,
  type V6PresentationSequencePlannedPayload,
  type V6PresentationSequenceSupersededPayload,
  type V6StudentInputRecordedPayload,
} from "./TutorSessionEventV6";
import {
  TutorSessionIntegrityError,
  type V5ActionOutcomePayload,
  V5GateEvaluatedPayload,
  V5InquiryPayload,
  V5PolicyDecisionPayload,
  V5SemanticInterpretationPayload,
  V5SessionStartedPayload,
  V5StudentIntentRecordedPayload,
} from "./TutorSessionEventV5";

/** state/v2 TutorRuntimeState（canonical Zod 推导类型，唯一形状）。 */
export type TutorRuntimeStateV6 = z.infer<typeof tutorRuntimeStateV2Schema>;

/** V6 fold context：session-pinned capability registry（append/rebuild 同源重解析）。 */
export type V6FoldContext = import("./SessionPinnedCapabilityRegistry").SessionPinnedCapabilityRegistry;

/**
 * fold 血缘索引：已提交学生输入链 + student 命令 + presentation 序列状态。
 * 只服务于跨事件完整性检查，不是 canonical state 的一部分。
 *
 * 纯度纪律（F7 Step 2 返工 P1-1）：lineage 一律**不可变复制**（withLineage /
 * withSequenceUpdated 每次返回新对象，绝不原地 .add()）——`State = f(events)`
 * 要求对同一旧 state 重放同一事件幂等、分支归约互不污染；可变集合挂在
 * WeakMap 血缘里原地修改会让第一次归约偷偷改写旧 state 的隐藏记忆。
 */
interface V6FoldLineage {
  readonly studentInputs: ReadonlyMap<number, { clientRequestId: string }>;
  readonly studentCommands: ReadonlyMap<
    string,
    { capability: string; intentSequence: number; expectedWorkspaceRevision: number }
  >;
  readonly intentSequences: ReadonlySet<number>;
  readonly sequences: ReadonlyMap<string, V6PlannedSequenceLineage>;
}

interface V6PlannedSequenceLineage {
  readonly actions: readonly { ordinal: number; kind: "voice" | "workspace"; actionId: string }[];
  readonly superseded: boolean;
  readonly presentedOrdinals: ReadonlySet<number>;
  readonly validatedOrdinals: ReadonlySet<number>;
  readonly appliedOrdinals: ReadonlySet<number>;
}

/** withSequenceUpdated 的可变工作副本（复制后本地修改，落回只读形状）。 */
interface V6WritablePlannedSequence {
  superseded: boolean;
  presentedOrdinals: Set<number>;
  validatedOrdinals: Set<number>;
  appliedOrdinals: Set<number>;
}

/** presentation 序列的不可变更新（调用方已校验 sequence 存在）。 */
function withSequenceUpdated(
  lineage: V6FoldLineage,
  sequenceId: string,
  update: (sequence: V6WritablePlannedSequence) => void,
): V6FoldLineage {
  const existing = lineage.sequences.get(sequenceId);
  if (!existing) {
    throw new RuntimeStateReducerV6Error(
      "PRESENTATION_ORDER_INVALID",
      `internal: withSequenceUpdated called for unregistered sequence ${sequenceId}`,
    );
  }
  const copy: V6WritablePlannedSequence = {
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
    intentSequences: lineage.intentSequences,
    sequences,
  };
}

const foldLineageByState = new WeakMap<object, V6FoldLineage>();

function emptyLineage(): V6FoldLineage {
  return {
    studentInputs: new Map(),
    studentCommands: new Map(),
    intentSequences: new Set(),
    sequences: new Map(),
  };
}

function lineageOf(state: TutorRuntimeStateV6): V6FoldLineage {
  return foldLineageByState.get(state) ?? emptyLineage();
}

function withLineage(state: TutorRuntimeStateV6, lineage: V6FoldLineage): TutorRuntimeStateV6 {
  foldLineageByState.set(state, lineage);
  return state;
}

export function initialStateFromSessionStartedV6(event: StoredV6Event): TutorRuntimeStateV6 {
  if (event.event_type !== "session_started") {
    throw new RuntimeStateReducerV6Error(
      "MISSING_SESSION_START",
      `first committed event must be session_started, got ${event.event_type}`,
      event.sequence,
    );
  }
  const payload = event.payload as unknown as V5SessionStartedPayload;
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

function cloneState(state: TutorRuntimeStateV6): TutorRuntimeStateV6 {
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
// student_input / student_intent 链（增补 10 #2 跨事件门禁）
// --------------------------------------------------------------------------- //

/**
 * student_intent_recorded 的解释器门禁：causation 必须指向同 session 更早的
 * student_input_recorded 且 client_request_id 一致；然后登记 intent（含
 * workspace_command 时注册命令，重复 command_id = corruption——R0 §5 保留）。
 */
function foldStudentIntentV6(lineage: V6FoldLineage, event: StoredV6Event): V6FoldLineage {
  const payload = event.payload as unknown as V5StudentIntentRecordedPayload;
  const causation = event.causation_sequence;
  if (causation === undefined || !lineage.studentInputs.has(causation)) {
    throw new RuntimeStateReducerV6Error(
      "INTENT_CAUSATION_MISMATCH",
      `sequence ${event.sequence}: student_intent_recorded causation_sequence=${String(
        causation,
      )} does not reference an earlier committed student_input_recorded in the same session`,
      event.sequence,
    );
  }
  const sourceInput = lineage.studentInputs.get(causation)!;
  if (sourceInput.clientRequestId !== payload.client_request_id) {
    throw new RuntimeStateReducerV6Error(
      "INTENT_CAUSATION_MISMATCH",
      `sequence ${event.sequence}: student_intent_recorded client_request_id=${payload.client_request_id} differs from the referenced student_input_recorded (${sourceInput.clientRequestId})`,
      event.sequence,
    );
  }
  const intentSequences = new Set(lineage.intentSequences);
  intentSequences.add(event.sequence);
  const command = payload.workspace_command;
  if (!command) {
    return {
      studentInputs: lineage.studentInputs,
      studentCommands: lineage.studentCommands,
      intentSequences,
      sequences: lineage.sequences,
    };
  }
  if (lineage.studentCommands.has(command.command_id)) {
    throw new TutorSessionIntegrityError(
      "CORRUPT_EVENT",
      `sequence ${event.sequence}: student command ${command.command_id} is registered twice (duplicate command_id across committed intents)`,
      event.sequence,
    );
  }
  const studentCommands = new Map(lineage.studentCommands);
  studentCommands.set(command.command_id, {
    capability: command.capability,
    intentSequence: event.sequence,
    expectedWorkspaceRevision: command.expected_workspace_revision,
  });
  return { studentInputs: lineage.studentInputs, studentCommands, intentSequences, sequences: lineage.sequences };
}

/** action_outcome_recorded(student_command) 回执完整性（R0 §5 全部 mismatch 规则，v5 语义保留）。 */
function assertStudentCommandReceiptV6(
  lineage: V6FoldLineage,
  state: TutorRuntimeStateV6,
  event: StoredV6Event,
): void {
  const outcome = event.payload as unknown as V5ActionOutcomePayload;
  const command = lineage.studentCommands.get(outcome.action_id);
  if (!command) {
    throw new TutorSessionIntegrityError(
      "CORRUPT_EVENT",
      `sequence ${event.sequence}: orphan student_command outcome ${outcome.action_id} (no committed student_intent_recorded.workspace_command with this command_id)`,
      event.sequence,
    );
  }
  if (event.causation_sequence === undefined || !lineage.intentSequences.has(event.causation_sequence)) {
    throw new TutorSessionIntegrityError(
      "CORRUPT_EVENT",
      `sequence ${event.sequence}: student_command outcome ${outcome.action_id} causation_sequence=${String(
        event.causation_sequence,
      )} does not point at the command's intent event (or an earlier student input)`,
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
// presentation 家族（有序交付生命周期 + cursor 对账）
// --------------------------------------------------------------------------- //

function actionIdOf(action: V6PresentationOrderedAction): string {
  return action.kind === "voice" ? (action.voice_action?.action_id ?? "") : (action.workspace_action?.action_id ?? "");
}

function requirePlannedAction(
  lineage: V6FoldLineage,
  event: StoredV6Event,
  ref: V6PresentationActionRefPayload,
): { sequence: V6PlannedSequenceLineage } {
  const sequence = lineage.sequences.get(ref.sequence_id);
  if (!sequence) {
    throw new RuntimeStateReducerV6Error(
      "PRESENTATION_ORDER_INVALID",
      `sequence ${event.sequence}: ${event.event_type} references unregistered sequence ${ref.sequence_id}`,
      event.sequence,
    );
  }
  if (sequence.superseded) {
    throw new RuntimeStateReducerV6Error(
      "PRESENTATION_ORDER_INVALID",
      `sequence ${event.sequence}: ${event.event_type} references superseded sequence ${ref.sequence_id}`,
      event.sequence,
    );
  }
  const planned = sequence.actions.find((action) => action.ordinal === ref.ordinal);
  if (!planned) {
    throw new RuntimeStateReducerV6Error(
      "PRESENTATION_ORDER_INVALID",
      `sequence ${event.sequence}: ${event.event_type} ordinal=${ref.ordinal} is outside sequence ${ref.sequence_id} (length ${sequence.actions.length})`,
      event.sequence,
    );
  }
  if (planned.actionId !== ref.action_id || planned.kind !== ref.kind) {
    throw new RuntimeStateReducerV6Error(
      "PRESENTATION_ORDER_INVALID",
      `sequence ${event.sequence}: ${event.event_type} ref ${ref.action_id}/kind=${ref.kind} does not match the planned action ${planned.actionId}/kind=${planned.kind} at ordinal ${ref.ordinal}`,
      event.sequence,
    );
  }
  return { sequence };
}

/** 「全部更早 ordinal 已 presented」——只有浏览器 presented 才推进下一项。 */
function earlierOrdinalsPresented(sequence: V6PlannedSequenceLineage, ordinal: number): boolean {
  return sequence.actions.every((action) => action.ordinal >= ordinal || sequence.presentedOrdinals.has(action.ordinal));
}

function foldSequencePlanned(
  lineage: V6FoldLineage,
  event: StoredV6Event,
  context: V6FoldContext,
): V6FoldLineage {
  const payload = event.payload as unknown as V6PresentationSequencePlannedPayload;
  if (lineage.sequences.has(payload.sequence_id)) {
    throw new RuntimeStateReducerV6Error(
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
      throw new RuntimeStateReducerV6Error(
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
    throw new RuntimeStateReducerV6Error(
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
    intentSequences: lineage.intentSequences,
    sequences,
  };
}

/** 单事件归约（纯函数：返回新 state，不修改入参）。事件须已过 canonical 校验。 */
export function applyV6Event(
  state: TutorRuntimeStateV6,
  event: StoredV6Event,
  context: V6FoldContext,
): TutorRuntimeStateV6 {
  const lineage = lineageOf(state);
  const next = cloneState(state);
  next.state_revision = event.state_revision;
  const payload = event.payload;

  switch (event.event_type) {
    case "student_input_recorded": {
      const input = payload as unknown as V6StudentInputRecordedPayload;
      const studentInputs = new Map(lineage.studentInputs);
      studentInputs.set(event.sequence, { clientRequestId: input.client_request_id });
      return withLineage(next, {
        studentInputs,
        studentCommands: lineage.studentCommands,
        intentSequences: lineage.intentSequences,
        sequences: lineage.sequences,
      });
    }
    case "student_intent_recorded": {
      const nextLineage = foldStudentIntentV6(lineage, event);
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
        throw new RuntimeStateReducerV6Error(
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
        throw new RuntimeStateReducerV6Error(
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
        throw new RuntimeStateReducerV6Error(
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
      const ref = payload as unknown as V6PresentationActionRefPayload;
      const { sequence } = requirePlannedAction(lineage, event, ref);
      if (sequence.validatedOrdinals.has(ref.ordinal)) {
        throw new RuntimeStateReducerV6Error(
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
      const ref = payload as unknown as V6PresentationActionAppliedPayload;
      const { sequence } = requirePlannedAction(lineage, event, ref);
      if (!sequence.validatedOrdinals.has(ref.ordinal)) {
        throw new RuntimeStateReducerV6Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: presentation action ${ref.action_id}@${ref.ordinal} is applied before being validated`,
          event.sequence,
        );
      }
      if (sequence.appliedOrdinals.has(ref.ordinal)) {
        throw new RuntimeStateReducerV6Error(
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
          throw new RuntimeStateReducerV6Error(
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
      const ref = payload as unknown as V6PresentationActionRefPayload;
      const { sequence } = requirePlannedAction(lineage, event, ref);
      if (sequence.presentedOrdinals.has(ref.ordinal)) {
        throw new RuntimeStateReducerV6Error(
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
        throw new RuntimeStateReducerV6Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: delivery for ${ref.action_id}@${ref.ordinal} while ${cursor.action_id}@${cursor.ordinal} of ${cursor.sequence_id} is still awaiting browser outcome`,
          event.sequence,
        );
      }
      if (cursor.status === "failed") {
        throw new RuntimeStateReducerV6Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: delivery for ${ref.action_id}@${ref.ordinal} while the cursor is parked failed at ${cursor.action_id}@${cursor.ordinal} of ${cursor.sequence_id} (recovery requires control.retry_recovery + new sequence)`,
          event.sequence,
        );
      }
      if (!earlierOrdinalsPresented(sequence, ref.ordinal)) {
        throw new RuntimeStateReducerV6Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: delivery for ${ref.action_id}@${ref.ordinal} skips an un-presented earlier ordinal in ${ref.sequence_id} (cursor only advances on browser presented)`,
          event.sequence,
        );
      }
      // workspace 必须先经服务端 validator/reducer 应用（未应用不得交付——
      // 增补 10 #4）；voice 只需 validated（无权威状态转移）。
      if (ref.kind === "workspace" && !sequence.appliedOrdinals.has(ref.ordinal)) {
        throw new RuntimeStateReducerV6Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: workspace action ${ref.action_id}@${ref.ordinal} is delivered before being applied (workspace_revision receipt required)`,
          event.sequence,
        );
      }
      if (ref.kind === "voice" && !sequence.validatedOrdinals.has(ref.ordinal)) {
        throw new RuntimeStateReducerV6Error(
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
      const ref = payload as unknown as V6PresentationOutcomeRecordedPayload;
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
        throw new RuntimeStateReducerV6Error(
          "PRESENTATION_CURSOR_MISMATCH",
          `sequence ${event.sequence}: outcome for ${ref.action_id}@${ref.ordinal} of ${ref.sequence_id} does not match the pending cursor (at ${at})`,
          event.sequence,
        );
      }
      const { sequence } = requirePlannedAction(lineage, event, ref);
      let outcomeLineage: V6FoldLineage = lineage;
      switch (ref.outcome) {
        case "presented": {
          outcomeLineage = withSequenceUpdated(lineage, ref.sequence_id, (copy) => {
            copy.presentedOrdinals.add(ref.ordinal);
          });
          next.presentation_cursor = { status: "idle" };
          // 最后一项 presented 后才能进入 awaiting_evidence（且仅在 presenting
          // 相位——v5 voice completed 规则的 v6 落点）。
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
      const ref = payload as unknown as V6PresentationSequenceSupersededPayload;
      const sequence = lineage.sequences.get(ref.sequence_id);
      if (!sequence) {
        throw new RuntimeStateReducerV6Error(
          "PRESENTATION_ORDER_INVALID",
          `sequence ${event.sequence}: presentation_sequence_superseded references unregistered sequence ${ref.sequence_id}`,
          event.sequence,
        );
      }
      if (sequence.superseded) {
        throw new RuntimeStateReducerV6Error(
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
        throw new RuntimeStateReducerV6Error(
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
      // v6 收窄：仅 student_command（canonical 字面量强制；防御性复核）。
      if (outcome.action_kind !== "student_command") {
        throw new RuntimeStateReducerV6Error(
          "REDUCER_INVARIANT",
          `sequence ${event.sequence}: v6 action_outcome_recorded only admits action_kind=student_command, got ${String(outcome.action_kind)}`,
          event.sequence,
        );
      }
      assertStudentCommandReceiptV6(lineage, next, event);
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
export function foldCommittedV6Events(
  events: readonly StoredV6Event[],
  context: V6FoldContext,
): TutorRuntimeStateV6 {
  if (events.length === 0) {
    throw new RuntimeStateReducerV6Error("MISSING_SESSION_START", "committed event stream is empty");
  }
  let state = initialStateFromSessionStartedV6(events[0]);
  for (const event of events.slice(1)) {
    state = applyV6Event(state, event, context);
  }
  return state;
}
