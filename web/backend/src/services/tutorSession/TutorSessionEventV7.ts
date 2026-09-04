/**
 * TutorSessionEvent v7 词表与内核类型（F7 Step 4 — 统一 HTTP application profile）。
 *
 * canonical 合同（PRDS 真源）：contracts/schemas/runtime/v7/tutor-session-event.
 * schema.json（TS Zod 镜像：web/shared/canonical/schemas.ts tutorSessionEventV7Schema，
 * F7 Step 4 合同波已同步）。本文件不做第二套语义：只固定 21 类事件词表、
 * causation 必带集（镜像 canonical superRefine）、待追加/已存储形状与 V7 内核
 * 错误分类。canonical 判定永远以 validatePayload / tutorSessionEventV7Schema 为准。
 *
 * 相对 v6 的词表差异（ADR-011 修订 2026-09-04，两轮独立复核后定稿——恢复
 * ADR-011 §6 的两条输入因果链并显式记录会话模式）：
 * - 新增 `student_workspace_command_recorded`：学生来源的权威 WorkspaceCommand
 *   事实（payload 与 ai_teaching_student_workspace_command/v1 命令域字段逐字段
 *   同形 + client_request_id 幂等身份 + 可选 source 判别 direct |
 *   accepted_action_evidence）。raw fact：不要求 causation。直接命令与 accepted
 *   action-evidence 派生命令均落本事件；`action_outcome_recorded{student_command}`
 *   的 causation 指向本事件（不再经 student_intent_recorded 内嵌）；
 * - `student_intent_recorded` 移除 submit_workspace_command kind 与内嵌
 *   workspace_command——intent 只表示后端语义解释产物（utterance/control 经
 *   SemanticInterpreter 产生）；intent→input causation 门禁对剩余全部 kind 可达
 *   （v6 缺口登记于 f7-scope-ledger 增补 13 边界 1，门禁本身不动）；
 * - `session_started` 增必填 `session_mode`（teaching|assessment）：assessment
 *   不再由 catalog hash 间接推断；resume 时与 catalog pin（assessment ⇒ locked
 *   变体 hash）双重对账，任一不符 fail closed；
 * - 其余 18 类保留分支 payload 与 v6（进而与 v5）逐字节同形。
 *
 * reader 纪律（v7 是带独立 marker 的新 schema，非超集）：
 * - V6 reader 原样保留（历史测试/诊断/内部审计；不承担新生产写入）；
 * - 按 session 行 `event_schema` 分派：v7 行→v7 reader，v6 行→v6 reader，
 *   v5 行→SESSION_VERSION_UNSUPPORTED（restore 409 集）；
 * - 不以 v7 schema 校验 v6 envelope（marker const 不同）；不做 v6→v7 迁移。
 */

export const V7_EVENT_SCHEMA_CONST = "ai_teaching_tutor_session_event/v7" as const;

export const V7_EVENT_TYPES = [
  "session_started",
  "student_input_recorded",
  "student_workspace_command_recorded",
  "student_intent_recorded",
  "semantic_interpretation_recorded",
  "policy_decision_made",
  "gate_evaluated",
  "presentation_sequence_planned",
  "presentation_action_validated",
  "presentation_action_applied",
  "presentation_action_delivered",
  "presentation_action_outcome_recorded",
  "presentation_sequence_superseded",
  "action_outcome_recorded",
  "external_support_recorded",
  "inquiry_opened",
  "inquiry_returned",
  "student_progressed",
  "policy_failed",
  "runtime_failure",
  "session_completed",
] as const;

export type V7EventType = (typeof V7_EVENT_TYPES)[number];

/**
 * 要求 causation_sequence 的事件集合（镜像 canonical；与 v6 相同集）。
 * student_input_recorded / student_workspace_command_recorded 是 raw fact，
 * 不要求 causation。
 */
export const V7_CAUSATION_REQUIRED: ReadonlySet<V7EventType> = new Set([
  "student_intent_recorded",
  "semantic_interpretation_recorded",
  "policy_decision_made",
  "gate_evaluated",
  "presentation_sequence_planned",
  "presentation_action_validated",
  "presentation_action_applied",
  "presentation_action_delivered",
  "presentation_action_outcome_recorded",
  "presentation_sequence_superseded",
  "action_outcome_recorded",
  "external_support_recorded",
  "inquiry_opened",
  "inquiry_returned",
  "student_progressed",
  "policy_failed",
]);

/** 待追加 v7 事件（sequence/state_revision 由 store 分配，调用方不携带）。 */
export interface PendingV7Event {
  event_type: V7EventType;
  payload: unknown;
  occurred_at: string;
  causation_sequence?: number;
  /** 重试批次应复用首次尝试的 key；未提供时由 store 按 `<session>:<sequence>` 派生。 */
  idempotency_key?: string;
}

/** 已存储 v7 事件（canonical 全形状，replay / rebuild 输入）。 */
export interface StoredV7Event {
  schema: typeof V7_EVENT_SCHEMA_CONST;
  session_id: string;
  sequence: number;
  state_revision: number;
  occurred_at: string;
  event_type: V7EventType;
  payload: Record<string, unknown>;
  causation_sequence?: number;
  idempotency_key: string;
}

// --------------------------------------------------------------------------- //
// 错误分类（store 写侧 / 读侧完整性 / reducer；封闭枚举与 v6 同集，独立类）
// --------------------------------------------------------------------------- //

/** v7 store 写侧错误（v6 同集：v5 六码 + SESSION_VERSION_UNSUPPORTED）。 */
export type V7StoreErrorCode =
  | "SESSION_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "DUPLICATE_EVENT"
  | "VALIDATION_FAILED"
  | "CAUSATION_REF_INVALID"
  | "SESSION_ALREADY_STARTED"
  | "SESSION_VERSION_UNSUPPORTED";

export class TutorSessionEventStoreV7Error extends Error {
  readonly code: V7StoreErrorCode;

  constructor(code: V7StoreErrorCode, message: string) {
    super(message);
    this.name = "TutorSessionEventStoreV7Error";
    this.code = code;
  }
}

/** v7 读侧完整性错误（v6 同集）。 */
export type V7IntegrityErrorCode =
  | "SESSION_NOT_FOUND"
  | "SCHEMA_ISOLATION"
  | "MISSING_SESSION_START"
  | "EVENT_GAP"
  | "CORRUPT_EVENT"
  | "REVISION_INCONSISTENT"
  | "HASH_MISMATCH"
  | "SESSION_VERSION_UNSUPPORTED";

export class TutorSessionIntegrityV7Error extends Error {
  readonly code: V7IntegrityErrorCode;
  readonly relatedSequence?: number;

  constructor(code: V7IntegrityErrorCode, message: string, relatedSequence?: number) {
    super(message);
    this.name = "TutorSessionIntegrityV7Error";
    this.code = code;
    if (relatedSequence !== undefined) {
      this.relatedSequence = relatedSequence;
    }
  }
}

/**
 * v7 reducer 语义校验错误（v6 码集 + COMMAND_CAUSATION_MISMATCH：学生命令回执
 * 的 causation 未指向其 student_workspace_command_recorded 事件——跨事件类型
 * 语义，kernel 级 stream 校验强制[复核 P1：误指 student_input_recorded 负例]）。
 */
export type V7ReducerErrorCode =
  | "MISSING_SESSION_START"
  | "INQUIRY_RETURN_MISMATCH"
  | "GATE_BEAT_MISMATCH"
  | "REDUCER_INVARIANT"
  | "INTENT_CAUSATION_MISMATCH"
  | "CAPABILITY_UNREGISTERED"
  | "PRESENTATION_ORDER_INVALID"
  | "PRESENTATION_CURSOR_MISMATCH"
  | "COMMAND_CAUSATION_MISMATCH"
  | "SESSION_MODE_MISMATCH";

export class RuntimeStateReducerV7Error extends Error {
  readonly code: V7ReducerErrorCode;
  readonly relatedSequence?: number;

  constructor(code: V7ReducerErrorCode, message: string, relatedSequence?: number) {
    super(message);
    this.name = "RuntimeStateReducerV7Error";
    this.code = code;
    if (relatedSequence !== undefined) {
      this.relatedSequence = relatedSequence;
    }
  }
}

// --------------------------------------------------------------------------- //
// reducer 只读的 payload 窄类型（事件已过 canonical 校验；此处仅约束读取形状）
// --------------------------------------------------------------------------- //

/** v7 session_started payload：v5/v6 全字段 + 必填 session_mode。 */
export interface V7SessionStartedPayload {
  task_id: string;
  session_mode: "teaching" | "assessment";
  scenario_id: string;
  question_ref: { artifact_id: string; version: string; content_hash: string };
  approach_set_ref: { artifact_id: string; version: string; content_hash: string };
  solution_graph_ref: { artifact_id: string; version: string; content_hash: string };
  protocol_refs: Array<{ artifact_id: string; version: string; content_hash: string }>;
  tutor_plan_ref: { artifact_id: string; version: string; content_hash: string };
  policy_profile_snapshot: {
    profile_id: string;
    version: string;
    primary_provider: string;
    fallback_provider: string;
    model_id: string;
    prompt_version: string;
  };
  initial_cursor: { protocol_id: string; beat_id: string };
  previous_session_id?: string;
  switch_reason?: "alternate_approach";
  workspace_catalog_pin?: { catalog_schema_version: number; content_hash: string; entry_count?: number };
  model_gate_pin?: { provider: string; model_id: string; prompt_version: string; adjudicator_version: string };
}

/** v7 student_intent_recorded payload（无 submit_workspace_command/内嵌命令）。 */
export interface V7StudentIntentRecordedPayload {
  intent_kind:
    | "submit_answer"
    | "confirm"
    | "continue"
    | "ask_question"
    | "request_scaffold"
    | "request_rephrase"
    | "replay_narration"
    | "barge_in"
    | "return_to_mainline"
    | "retry_recovery";
  text?: string;
  client_request_id: string;
}

/** v7 student_workspace_command_recorded payload（学生来源权威 WorkspaceCommand 事实）。 */
export interface V7StudentWorkspaceCommandRecordedPayload {
  command_id: string;
  surface: "geometry" | "solution_board";
  capability: string;
  origin: "student";
  target_ids: string[];
  params?: Record<string, unknown>;
  expected_workspace_revision: number;
  client_request_id: string;
  source?: "direct" | "accepted_action_evidence";
  evidence_action_id?: string;
  input_evidence_sequence?: number;
}

// --------------------------------------------------------------------------- //
// 与 v6 共享形状的 payload 窄类型（只读复用；canonical 逐字段同形）
// --------------------------------------------------------------------------- //

export type {
  V6StudentInputBody as V7StudentInputBody,
  V6StudentInputRecordedPayload as V7StudentInputRecordedPayload,
  V6PresentationActionRefPayload as V7PresentationActionRefPayload,
  V6PresentationSequencePlannedPayload as V7PresentationSequencePlannedPayload,
  V6PresentationOrderedAction as V7PresentationOrderedAction,
  V6PresentationVoiceItem as V7PresentationVoiceItem,
  V6PresentationSurfaceItem as V7PresentationSurfaceItem,
  V6PresentationActionAppliedPayload as V7PresentationActionAppliedPayload,
  V6PresentationOutcomeRecordedPayload as V7PresentationOutcomeRecordedPayload,
  V6PresentationSequenceSupersededPayload as V7PresentationSequenceSupersededPayload,
} from "./TutorSessionEventV6";

export type {
  V5ArtifactRefLike,
  V5PolicyDecisionPayload,
  V5GateEvaluatedPayload,
  V5ActionOutcomePayload,
  V5InquiryPayload,
  V5SemanticInterpretationPayload,
} from "./TutorSessionEventV5";
