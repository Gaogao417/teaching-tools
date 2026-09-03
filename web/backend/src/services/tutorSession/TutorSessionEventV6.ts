/**
 * TutorSessionEvent v6 词表与内核类型（F7 Step 2 — V6 Session Kernel）。
 *
 * canonical 合同（PRDS 真源）：contracts/schemas/runtime/v6/tutor-session-event.
 * schema.json（TS Zod 镜像：web/shared/canonical/schemas.ts tutorSessionEventV6Schema，
 * F7 Step 1 已同步）。本文件不做第二套语义：只固定 20 类事件词表、causation
 * 必带集（镜像 canonical superRefine）、待追加/已存储形状与 V6 内核错误分类。
 * canonical 判定永远以 validatePayload / tutorSessionEventV6Schema 为准。
 *
 * 相对 v5 的词表差异（ADR-011）：
 * - 新增 `student_input_recorded`（原始学生输入事实：utterance{channel,text} |
 *   control 七值——前端不提交 intent 标签，解释属后端 SemanticInterpreter）；
 * - 新增 presentation 家族六事件：sequence_planned / action_validated /
 *   action_applied / action_delivered / action_outcome_recorded /
 *   sequence_superseded；
 * - 移除 voice_action_issued / workspace_surface_action_issued /
 *   presentation_failed；
 * - `action_outcome_recorded` 收窄为仅 student_command（学生命令回执链，
 *   R0 §5 语义保留）；tutor 呈现完成改经 presentation_action_outcome_recorded；
 * - 其余 12 保留分支 payload 逐字节同 v5（canonical 复用 v5 payload 镜像）。
 *
 * V5/V6 会话共存纪律（spec §2.4，ADR-011 Decision 2）：
 * - V5 历史会话不原地迁移，保留 reader 到 F8；
 * - V6 client 写入/恢复到 v5 会话（event_schema=v5）→ SESSION_VERSION_UNSUPPORTED
 *   （restore 409 集成员；UI 明示重新开始）；
 * - 不把 v5 的「服务端已完成 Voice」伪装成 v6 浏览器 presented outcome——
 *   两类事实分属不同事件合同，不建迁移/伪装 adapter。
 */

export const V6_EVENT_SCHEMA_CONST = "ai_teaching_tutor_session_event/v6" as const;

export const V6_EVENT_TYPES = [
  "session_started",
  "student_input_recorded",
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

export type V6EventType = (typeof V6_EVENT_TYPES)[number];

/** 要求 causation_sequence 的事件集合（镜像 canonical V6_CAUSATION_REQUIRED）。 */
export const V6_CAUSATION_REQUIRED: ReadonlySet<V6EventType> = new Set([
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

/** 待追加 v6 事件（sequence/state_revision 由 store 分配，调用方不携带）。 */
export interface PendingV6Event {
  event_type: V6EventType;
  payload: unknown;
  occurred_at: string;
  causation_sequence?: number;
  /** 重试批次应复用首次尝试的 key；未提供时由 store 按 `<session>:<sequence>` 派生。 */
  idempotency_key?: string;
}

/** 已存储 v6 事件（canonical 全形状，replay / rebuild 输入）。 */
export interface StoredV6Event {
  schema: typeof V6_EVENT_SCHEMA_CONST;
  session_id: string;
  sequence: number;
  state_revision: number;
  occurred_at: string;
  event_type: V6EventType;
  payload: Record<string, unknown>;
  causation_sequence?: number;
  idempotency_key: string;
}

/** 事件表原始行（rebuilder 的损坏检测输入；payload_json 未解析）。 */
export interface RawV6EventRow {
  sequence: number;
  event_type: string;
  payload_json: string;
  occurred_at: string;
  idempotency_key: string;
  recorded_revision: number;
  recorded_at: string;
  causation_sequence: number | null;
}

// --------------------------------------------------------------------------- //
// 错误分类（store 写侧 / 读侧完整性 / reducer 各一套封闭枚举，fail closed）
// --------------------------------------------------------------------------- //

/**
 * v6 store 写侧错误：v5 六码 + SESSION_VERSION_UNSUPPORTED（V6 写入/恢复撞
 * 非 v6 会话行——spec §2.4 409 集）。
 */
export type V6StoreErrorCode =
  | "SESSION_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "DUPLICATE_EVENT"
  | "VALIDATION_FAILED"
  | "CAUSATION_REF_INVALID"
  | "SESSION_ALREADY_STARTED"
  | "SESSION_VERSION_UNSUPPORTED";

export class TutorSessionEventStoreV6Error extends Error {
  readonly code: V6StoreErrorCode;

  constructor(code: V6StoreErrorCode, message: string) {
    super(message);
    this.name = "TutorSessionEventStoreV6Error";
    this.code = code;
  }
}

/**
 * v6 读侧完整性错误：v5 七码 + SESSION_VERSION_UNSUPPORTED（V6 verified
 * rebuild 撞 v5 会话行——restore 409）。
 */
export type V6IntegrityErrorCode =
  | "SESSION_NOT_FOUND"
  | "SCHEMA_ISOLATION"
  | "MISSING_SESSION_START"
  | "EVENT_GAP"
  | "CORRUPT_EVENT"
  | "REVISION_INCONSISTENT"
  | "HASH_MISMATCH"
  | "SESSION_VERSION_UNSUPPORTED";

export class TutorSessionIntegrityV6Error extends Error {
  readonly code: V6IntegrityErrorCode;
  readonly relatedSequence?: number;

  constructor(code: V6IntegrityErrorCode, message: string, relatedSequence?: number) {
    super(message);
    this.name = "TutorSessionIntegrityV6Error";
    this.code = code;
    if (relatedSequence !== undefined) {
      this.relatedSequence = relatedSequence;
    }
  }
}

/**
 * v6 reducer 语义校验错误（同一事件流内部不变量被破坏时 fail closed）。
 * v5 四码保留（student_command 回执链沿用）；新增 presentation/input 门禁：
 * - INTENT_CAUSATION_MISMATCH：student_intent_recorded 未指向同 session 更早
 *   student_input_recorded 或 client_request_id 不一致（ledger 增补 10 #2——
 *   缺失=canonical 拒、未来引用=store CAUSATION_REF_INVALID、类型/request id
 *   不符=本码整批拒绝）；
 * - CAPABILITY_UNREGISTERED：presentation workspace action 的 capability 或
 *   target 不在 session-pinned capability registry（ledger 增补 10 #3——零事件、
 *   零状态变更、零 delivery）；
 * - PRESENTATION_ORDER_INVALID：validated/applied/delivered 越序（未应用先交付、
 *   跳过 ordinal、重复 delivered、重复注册 sequence）；
 * - PRESENTATION_CURSOR_MISMATCH：outcome 与服务端 pending cursor 不对账
 *   （孤儿 / 越序 / 重复不同 payload，ledger 增补 9 的 Step 2 服务端义务）。
 */
export type V6ReducerErrorCode =
  | "MISSING_SESSION_START"
  | "INQUIRY_RETURN_MISMATCH"
  | "GATE_BEAT_MISMATCH"
  | "REDUCER_INVARIANT"
  | "INTENT_CAUSATION_MISMATCH"
  | "CAPABILITY_UNREGISTERED"
  | "PRESENTATION_ORDER_INVALID"
  | "PRESENTATION_CURSOR_MISMATCH";

export class RuntimeStateReducerV6Error extends Error {
  readonly code: V6ReducerErrorCode;
  readonly relatedSequence?: number;

  constructor(code: V6ReducerErrorCode, message: string, relatedSequence?: number) {
    super(message);
    this.name = "RuntimeStateReducerV6Error";
    this.code = code;
    if (relatedSequence !== undefined) {
      this.relatedSequence = relatedSequence;
    }
  }
}

// --------------------------------------------------------------------------- //
// reducer 只读的 payload 窄类型（事件已过 canonical 校验；此处仅约束读取形状）
// --------------------------------------------------------------------------- //

/** runtime/v6 student-input body（utterance{channel,text} | control 七值判别联合）。 */
export interface V6StudentInputBody {
  kind: "utterance" | "control";
  channel?: "mainline" | "assistance";
  text?: string;
  command?:
    | "confirm"
    | "continue"
    | "request_scaffold"
    | "request_rephrase"
    | "barge_in"
    | "return_to_mainline"
    | "retry_recovery";
}

/** student_input_recorded payload（原始输入事实 + client_request_id）。 */
export interface V6StudentInputRecordedPayload {
  input: V6StudentInputBody;
  client_request_id: string;
}

/** presentation 家族共用的 action 引用三元组 + kind。 */
export interface V6PresentationActionRefPayload {
  sequence_id: string;
  ordinal: number;
  action_id: string;
  kind: "voice" | "workspace";
}

/** presentation_sequence_planned payload（单一有序 actions[]，ordinal==下标）。 */
export interface V6PresentationSequencePlannedPayload {
  sequence_id: string;
  decision_id: string;
  protocol_id: string;
  beat_id: string;
  actions: V6PresentationOrderedAction[];
}

/** 有序判别联合 action（kind=voice 携 voice_action；kind=workspace 携 workspace_action）。 */
export interface V6PresentationOrderedAction {
  ordinal: number;
  kind: "voice" | "workspace";
  voice_action?: V6PresentationVoiceItem;
  workspace_action?: V6PresentationSurfaceItem;
}

export interface V6PresentationVoiceItem {
  action_id: string;
  decision_id: string;
  text: string;
  source: "approved-resource" | "model-generated" | "deterministic-scaffold";
  resource_ref?: string;
  generation_id?: string;
  interruptible?: boolean;
  intent?: "narrate" | "question" | "feedback";
}

export interface V6PresentationSurfaceItem {
  action_id: string;
  decision_id: string;
  surface: "geometry" | "solution_board";
  capability: string;
  origin: "tutor";
  target_ids?: string[];
  command_payload?: string;
  reveal_scope: "none" | "target_highlight" | "step_narration" | "intermediate_result" | "final_result";
  presentation_only?: boolean;
}

/** presentation_action_applied payload（workspace 必带 resulting_workspace_revision）。 */
export interface V6PresentationActionAppliedPayload extends V6PresentationActionRefPayload {
  resulting_workspace_revision?: number;
}

/** presentation_action_outcome_recorded payload（浏览器真实执行结果）。 */
export interface V6PresentationOutcomeRecordedPayload extends V6PresentationActionRefPayload {
  outcome: "presented" | "interrupted" | "failed";
  failure_class?: string;
  message?: string;
}

/** presentation_sequence_superseded payload。 */
export interface V6PresentationSequenceSupersededPayload {
  sequence_id: string;
  reason: "interrupted" | "retry_recovery" | "superseded_by_decision";
  pending_ordinal?: number;
  pending_action_id?: string;
}

// --------------------------------------------------------------------------- //
// 保留分支的 payload 窄类型复用 v5（canonical 逐字节同 v5；见文件头）
// --------------------------------------------------------------------------- //

export type {
  V5ArtifactRefLike,
  V5SessionStartedPayload,
  V5StudentIntentRecordedPayload,
  V5PolicyDecisionPayload,
  V5GateEvaluatedPayload,
  V5ActionOutcomePayload,
  V5InquiryPayload,
  V5SemanticInterpretationPayload,
} from "./TutorSessionEventV5";
