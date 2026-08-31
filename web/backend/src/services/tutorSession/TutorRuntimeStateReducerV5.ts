/**
 * TutorRuntimeState v1 纯 reducer（F2 — Event / Revision / Replay 内核）。
 *
 * State = f(Pinned Plan + 有序 committed v5 events) 的纯函数：
 * - 输出合同：state/v1/tutor-runtime-state（PRDS 真源 contracts/schemas/state/v1/
 *   tutor-runtime-state.schema.json；TS 镜像 tutorRuntimeStateV1Schema）；
 * - 在线 state 与 rebuilt state 使用同一领域 reducer（G2 不变量）：在线 kernel
 *   （TutorSessionKernelV5）与 RuntimeStateRebuilderV5 都只经
 *   foldCommittedV5Events / applyV5Event 推进，无第二条 state machine；
 * - reducer 不产生决策、不读 Plan 内容（F2 只有 pin refs；beat 合法性属 F5
 *   Navigator），只把 committed 事实确定性地落到 state/v1 字段；
 * - 六态区分（G2）：issued（voice/workspace_surface_action_issued）本身不产生
 *   完成副作用；只有 action_outcome_recorded outcome=completed 才推进
 *   workspace_revision / phase；rejected / interrupted / failed 一律无完成副作用；
 * - reducer 约定（f2-scope-ledger「Reducer 约定」+ 2026-08-31 R1 增补）：
 *   1. session_started → initial_cursor 起步（phase=presenting）；
 *   2. decision 的 transition/revisit/return_to_mainline → 游标到 to_beat_id、
 *      清 gate、phase=presenting；open_inquiry/open_scaffold → inquiry 游标
 *      （clarifying/supporting），主线游标冻结；complete_beat → phase=completed；
 *   3. gate_evaluated 仅对当前 beat 生效：satisfied→gate_satisfied，否则
 *      awaiting_evidence，并记录 gate_id；
 *   4. inquiry_returned 必须与 opened 同 return_beat_id（schema description 的
 *      reducer 校验义务），返回后游标回返回点；
 *   5. voice completed 仅在 presenting 相位把 phase 推进到 awaiting_evidence
 *      （呈现完成=开始等学生证据）；workspace_surface/student_command completed
 *      且携带 resulting_revision 时 workspace_revision 取 max；
 *   6. session_completed → completed=true、phase=completed；
 *   7. 事实类事件（intent/support/失败类）不改 state/v1 字段（供 F5/F6 消费，
 *      stream 即事实）。**例外（2026-08-31 R0 合同增补，用户已授权）**：
 *      semantic_interpretation_recorded 携带可选 reasoning_focus 时，reducer
 *      用它**整体覆写** state/v1 reasoning_focus（主线 TeachingCursor 不动——
 *      学生追问旧推理区域是焦点转移，不是主线推进）；缺省时 reasoning_focus
 *      不变（全部存量流行为不变）。
 *
 * ## student_command 回执完整性（2026-08-31 R1，R0 §5 规则的 reducer 落点）
 *
 * `action_outcome_recorded(action_kind=student_command)` 是 F3 Action Runtime
 * 执行回执的事实表达；Navigator（F5）只能消费已提交回执，不得自报。跨事件
 * 完整性规则放进本 reducer（授权文件）即同时获得两层强制：
 * - **持久化边界（append 拒绝）**：store append 事务内先纯折叠候选批
 *   （TutorSessionEventStoreV5「复验修复 #2」），本 reducer 拒绝 ⇒ 异常逃逸
 *   事务 ⇒ 整批回滚，任何行未写入；
 * - **重建边界（fold/verify 抛错）**：foldCommittedV5Events / rebuild 家族走
 *   同一 reducer，绕过 store 直写 DB 的孤儿/不匹配回执在重建时 fail closed
 *   （TutorSessionIntegrityError CORRUPT_EVENT 家族——与 workspace 侧
 *   WORKSPACE_STREAM_INVARIANT → CORRUPT_EVENT 同型）。
 *
 * 规则（R0 §5 精确定义，mismatch 任一命中即 fail closed）：
 * - orphan：流内不存在先于（或同批早于）E 的 student_intent_recorded S，使
 *   S.payload.workspace_command.command_id === E.payload.action_id；
 * - 重复注册：同一 command_id 出现在两个 intent 事件中；
 * - causation 断链：E.causation_sequence 不指向学生输入链（该命令的 intent
 *   事件或更早的 student_intent_recorded）；
 * - revision 不符：outcome=completed 且携带 resulting_revision r 时，
 *   r ∉ {命令 expected_workspace_revision, expected+1}（F3「恰 +1 或不变」
 *   语义），或 r 小于流内已到达的 workspace_revision（回退）。
 *
 * 跨事件记忆的实现：reducer 状态对象是 canonical state/v1（冻结形状，禁止
 * 携带私有字段），因此已提交 student 命令索引经模块级 WeakMap 按 state 对象
 * 血缘传递（fold/apply 链上每个 next state 都重新登记；对象不可达即回收）。
 * 该索引不进入 canonical 输出、不参与语义比较、不影响 Zod 判定——只是
 * fold 累加器的载体，保证 applyV5Event 逐事件调用（store 预折叠、kernel
 * 在线推进、rebuild 全量重放三条路径）都执行同一完整性检查。
 */
import type { z } from "zod";
import { tutorRuntimeStateV1Schema } from "../../../../shared/canonical";
import {
  RuntimeStateReducerV5Error,
  TutorSessionIntegrityError,
  type StoredV5Event,
  type V5ActionOutcomePayload,
  type V5GateEvaluatedPayload,
  type V5InquiryPayload,
  type V5PolicyDecisionPayload,
  type V5SemanticInterpretationPayload,
  type V5SessionStartedPayload,
  type V5StudentIntentRecordedPayload,
} from "./TutorSessionEventV5";

/** state/v1 TutorRuntimeState（canonical Zod 推导类型，唯一形状）。 */
export type TutorRuntimeStateV5 = z.infer<typeof tutorRuntimeStateV1Schema>;

/**
 * fold 血缘索引：已提交 student workspace 命令 + 学生输入链 sequence。
 * 只服务于跨事件完整性检查（R0 §5），不是 canonical state 的一部分。
 */
interface V5FoldLineage {
  readonly studentCommands: ReadonlyMap<
    string,
    { capability: string; intentSequence: number; expectedWorkspaceRevision: number }
  >;
  readonly intentSequences: ReadonlySet<number>;
}

const foldLineageByState = new WeakMap<object, V5FoldLineage>();

function emptyLineage(): V5FoldLineage {
  return { studentCommands: new Map(), intentSequences: new Set() };
}

function lineageOf(state: TutorRuntimeStateV5): V5FoldLineage {
  return foldLineageByState.get(state) ?? emptyLineage();
}

function withLineage(state: TutorRuntimeStateV5, lineage: V5FoldLineage): TutorRuntimeStateV5 {
  foldLineageByState.set(state, lineage);
  return state;
}

export function initialStateFromSessionStarted(event: StoredV5Event): TutorRuntimeStateV5 {
  if (event.event_type !== "session_started") {
    throw new RuntimeStateReducerV5Error(
      "MISSING_SESSION_START",
      `first committed event must be session_started, got ${event.event_type}`,
      event.sequence,
    );
  }
  const payload = event.payload as unknown as V5SessionStartedPayload;
  return withLineage(
    {
      schema: "ai_teaching_tutor_runtime_state/v1",
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
    },
    emptyLineage(),
  );
}

function cloneState(state: TutorRuntimeStateV5): TutorRuntimeStateV5 {
  return {
    ...state,
    pinned_plan: { ...state.pinned_plan },
    teaching_cursor: { ...state.teaching_cursor },
    inquiry_cursor: state.inquiry_cursor ? { ...state.inquiry_cursor } : null,
    ...(state.reasoning_focus ? { reasoning_focus: { ...state.reasoning_focus } } : {}),
  };
}

/**
 * student_intent_recorded 的 fold 侧登记（R0 §5）：workspace_command 携带时
 * 注册命令（重复 command_id = corruption）；学生输入链 sequence 全量记账
 * （outcome 回执的 causation 对账用）。
 */
function foldStudentIntent(
  lineage: V5FoldLineage,
  event: StoredV5Event,
): V5FoldLineage {
  const payload = event.payload as unknown as V5StudentIntentRecordedPayload;
  const intentSequences = new Set(lineage.intentSequences);
  intentSequences.add(event.sequence);
  const command = payload.workspace_command;
  if (!command) {
    return { studentCommands: lineage.studentCommands, intentSequences };
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
  return { studentCommands, intentSequences };
}

/**
 * action_outcome_recorded(student_command) 的回执完整性（R0 §5 全部 mismatch
 * 规则）：orphan / capability 无承载（事件形状无 capability 字段，消费方必须
 * 取自所引命令——Navigator 消费 API 落实）/ causation 断链 / resulting_revision
 * 不符。任一命中即 fail closed（append 边界=整批回滚；重建边界=CORRUPT_EVENT）。
 */
function assertStudentCommandReceipt(
  lineage: V5FoldLineage,
  state: TutorRuntimeStateV5,
  event: StoredV5Event,
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

/** 单事件归约（纯函数：返回新 state，不修改入参）。事件须已过 canonical 校验。 */
export function applyV5Event(state: TutorRuntimeStateV5, event: StoredV5Event): TutorRuntimeStateV5 {
  const lineage = lineageOf(state);
  const next = cloneState(state);
  next.state_revision = event.state_revision;
  const payload = event.payload;

  switch (event.event_type) {
    case "student_intent_recorded": {
      const nextLineage = foldStudentIntent(lineage, event);
      return withLineage(next, nextLineage);
    }
    case "semantic_interpretation_recorded": {
      // R0 §1 / 用户拍板 1：携带 reasoning_focus ⇒ 整体覆写 state/v1
      // reasoning_focus；缺省不动；主线 TeachingCursor 不动（焦点转移≠主线推进）。
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
        case "continue_inquiry": {
          // 无打开的 inquiry 时 continue 只是事实（coordinator 侧缺陷由 F5
          // 写入门禁拦截；已 committed 的怪流不毒化会话——reducer 不虚构状态）。
          break;
        }
        default:
          // accept_alternate_path / change_stance / request_clarification / pause /
          // safe_fallback：事实入流，不改游标。
          break;
      }
      return withLineage(next, lineage);
    }
    case "inquiry_opened": {
      const inquiry = payload as unknown as V5InquiryPayload;
      if (next.inquiry_cursor && next.inquiry_cursor.inquiry_id !== inquiry.inquiry_id) {
        throw new RuntimeStateReducerV5Error(
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
      // 无打开的 inquiry 时 return 只是事实（不虚构回退）；有打开的 inquiry 时
      // return_beat_id 必须与 opened 同值——canonical schema description 指定
      // 的 reducer 校验义务，违反即 fail closed。
      if (!next.inquiry_cursor) return withLineage(next, lineage);
      if (next.inquiry_cursor.return_beat_id !== inquiry.return_beat_id) {
        throw new RuntimeStateReducerV5Error(
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
      if (gate.beat_id !== next.teaching_cursor.beat_id) break;
      next.teaching_cursor.gate_id = gate.gate_id;
      next.teaching_cursor.phase = gate.satisfied ? "gate_satisfied" : "awaiting_evidence";
      return withLineage(next, lineage);
    }
    case "action_outcome_recorded": {
      const outcome = payload as unknown as V5ActionOutcomePayload;
      if (outcome.action_kind === "student_command") {
        // R0 §5：孤儿/不匹配 student_command 回执在持久化/重建边界 fail closed
        // （不得只在 GateEvaluator 忽略）。rejected/failed 不做 revision 检查
        // （零状态效果），但 orphan/causation 检查同样适用。
        assertStudentCommandReceipt(lineage, next, event);
      }
      if (outcome.outcome !== "completed") return withLineage(next, lineage);
      if (outcome.action_kind === "voice") {
        if (next.teaching_cursor.phase === "presenting") {
          next.teaching_cursor.phase = "awaiting_evidence";
        }
        return withLineage(next, lineage);
      }
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
      // voice_action_issued / workspace_surface_action_issued /
      // external_support_recorded / student_progressed / policy_failed /
      // presentation_failed / runtime_failure / session_started（首事件经
      // initialState 处理，此处到达即为流内重复，不改 state）。
      return withLineage(next, lineage);
  }
  return withLineage(next, lineage);
}

/** 全量折叠：session_started 起步 + 逐事件归约（在线与重建共用）。 */
export function foldCommittedV5Events(events: readonly StoredV5Event[]): TutorRuntimeStateV5 {
  if (events.length === 0) {
    throw new RuntimeStateReducerV5Error("MISSING_SESSION_START", "committed event stream is empty");
  }
  let state = initialStateFromSessionStarted(events[0]);
  for (const event of events.slice(1)) {
    state = applyV5Event(state, event);
  }
  return state;
}
