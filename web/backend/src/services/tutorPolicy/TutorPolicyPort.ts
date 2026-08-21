/**
 * TutorPolicyPort（Phase 5 / P5-07，PRD 04 §3 / ADR-006 §3）。
 *
 * `TutorPolicy(plan, state, studentEvent) → TutorMove` 的 provider-neutral 合同：
 * - 输入是只读视图：Approved Plan（routes/checkpoints/resources/constraints）、
 *   当前 TutorRuntimeState 投影、触发事件（学生输入或系统完成）；
 * - 输出是结构化决策草案（教学意图 + purpose + 资源引用 + 可选 mode 变更
 *   + working diagnosis 更新），不是 narration 文本，更不是工具命令；
 * - 决策由 DecideTutorMove 做 plan-constraints 校验 + safe fallback 包装后
 *   才进入呈现与事件流；
 * - Assessment 上下文 fail closed（ADR-006 不变量 6）：返回
 *   ASSESSMENT_FAIL_CLOSED，且不得回退成任何教学 move。
 */
import type { Alignment, InputKind, SessionMode } from "../tutorSession/TutorSessionEvent";
import type { TutorPlanV2Payload } from "../planBuild/canonicalInputs";
import type { TutorRuntimeState } from "../tutorSession/TutorRuntimeStateProjection";
import type { TutorDecisionDraft } from "./TutorMove";

export interface PolicyTrigger {
  kind: "student_input" | "system";
  /** 触发事件 sequence（tutor_move_decided.source_event_sequence）。 */
  event_sequence: number;
  input_kind?: InputKind;
  /** reasoning_alignment 结果（对 reasoning_utterance / action evidence 输入）。 */
  alignment?: Alignment;
  alignment_checkpoint_id?: string;
  /** system 触发说明：session_started / presentation_completed。 */
  system_reason?: "session_started" | "presentation_completed";
  /** presentation_completed 时上一个决策的 move/purpose。 */
  last_move_type?: string;
  last_purpose_code?: string;
}

export interface PolicyContext {
  plan: TutorPlanV2Payload;
  state: TutorRuntimeState;
  trigger: PolicyTrigger;
  /** 仅 tutoring 会话可产生教学决策；assessment 由 port 层 fail closed。 */
  session_kind: "tutoring" | "assessment";
}

export type PolicyErrorCode =
  | "INVALID_MOVE"
  | "TIMEOUT"
  | "UNSUPPORTED"
  | "ASSESSMENT_FAIL_CLOSED";

export type PolicyOutcome =
  | {
      ok: true;
      decision: TutorDecisionDraft | null;
      policy_version: string;
      /** safe fallback 产生该决策时的原始失败类别（policy_failed 事实用）。 */
      fallback_of?: { failure_class: string };
    }
  | { ok: false; error_code: PolicyErrorCode; detail: string; policy_version: string };

export interface TutorPolicyPort {
  readonly policyVersion: string;
  decide(context: PolicyContext): PolicyOutcome | Promise<PolicyOutcome>;
}

export type SessionModeName = SessionMode;
