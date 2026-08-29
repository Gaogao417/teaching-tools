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
 * - reducer 约定（f2-scope-ledger「Reducer 约定」）：
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
 *   7. 事实类事件（intent/interpretation/support/失败类）不改 state/v1 字段
 *      （供 F5/F6 消费，stream 即事实）。
 */
import type { z } from "zod";
import { tutorRuntimeStateV1Schema } from "../../../../shared/canonical";
import {
  RuntimeStateReducerV5Error,
  type StoredV5Event,
  type V5ActionOutcomePayload,
  type V5GateEvaluatedPayload,
  type V5InquiryPayload,
  type V5PolicyDecisionPayload,
  type V5SessionStartedPayload,
} from "./TutorSessionEventV5";

/** state/v1 TutorRuntimeState（canonical Zod 推导类型，唯一形状）。 */
export type TutorRuntimeStateV5 = z.infer<typeof tutorRuntimeStateV1Schema>;

export function initialStateFromSessionStarted(event: StoredV5Event): TutorRuntimeStateV5 {
  if (event.event_type !== "session_started") {
    throw new RuntimeStateReducerV5Error(
      "MISSING_SESSION_START",
      `first committed event must be session_started, got ${event.event_type}`,
      event.sequence,
    );
  }
  const payload = event.payload as unknown as V5SessionStartedPayload;
  return {
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
  };
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

/** 单事件归约（纯函数：返回新 state，不修改入参）。事件须已过 canonical 校验。 */
export function applyV5Event(state: TutorRuntimeStateV5, event: StoredV5Event): TutorRuntimeStateV5 {
  const next = cloneState(state);
  next.state_revision = event.state_revision;
  const payload = event.payload;

  switch (event.event_type) {
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
      break;
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
      break;
    }
    case "inquiry_returned": {
      const inquiry = payload as unknown as V5InquiryPayload;
      // 无打开的 inquiry 时 return 只是事实（不虚构回退）；有打开的 inquiry 时
      // return_beat_id 必须与 opened 同值——canonical schema description 指定
      // 的 reducer 校验义务，违反即 fail closed。
      if (!next.inquiry_cursor) break;
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
      break;
    }
    case "gate_evaluated": {
      const gate = payload as unknown as V5GateEvaluatedPayload;
      if (gate.beat_id !== next.teaching_cursor.beat_id) break;
      next.teaching_cursor.gate_id = gate.gate_id;
      next.teaching_cursor.phase = gate.satisfied ? "gate_satisfied" : "awaiting_evidence";
      break;
    }
    case "action_outcome_recorded": {
      const outcome = payload as unknown as V5ActionOutcomePayload;
      if (outcome.outcome !== "completed") break;
      if (outcome.action_kind === "voice") {
        if (next.teaching_cursor.phase === "presenting") {
          next.teaching_cursor.phase = "awaiting_evidence";
        }
        break;
      }
      if (
        typeof outcome.resulting_revision === "number" &&
        outcome.resulting_revision > next.workspace_revision
      ) {
        next.workspace_revision = outcome.resulting_revision;
      }
      break;
    }
    case "session_completed": {
      next.completed = true;
      next.teaching_cursor.phase = "completed";
      break;
    }
    default:
      // student_intent_recorded / semantic_interpretation_recorded /
      // voice_action_issued / workspace_surface_action_issued /
      // external_support_recorded / student_progressed / policy_failed /
      // presentation_failed / runtime_failure / session_started（首事件经
      // initialState 处理，此处到达即为流内重复，不改 state）。
      break;
  }
  return next;
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
