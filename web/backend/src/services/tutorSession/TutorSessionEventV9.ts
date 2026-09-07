/**
 * TutorSessionEvent v9 词表与内核类型（F7 RT4 — 生成生命周期波）。
 *
 * canonical 合同（PRDS 真源）：contracts/schemas/runtime/v9/tutor-session-event.
 * schema.json（TS Zod 镜像：tutorSessionEventV9Schema——payload 按 event_type
 * 分派，生成事件族 payload=GenerationRequestRecord 快照 + status/phase 判别）。
 * 本文件不建第二套语义：固定 26 类事件词表、causation 必带集、v9 payload 窄
 * 类型与错误分类；canonical 判定永远以 tutorSessionEventV9Schema 为准。
 *
 * 相对 v7 的词表差异（简化架构终态）：
 * - 新增生成事件族 5 类：presentation_generation_requested / attempt_started /
 *   retry_scheduled / failed / invalidated（全部要求 causation；payload 携带完整
 *   请求记录快照，status/phase 演化由 reducer 对账）；
 * - presentation_sequence_planned payload 升 v4 形状：scope（TeachingScopeRef）
 *   取代 protocol_id+beat_id；可选 generation（GR provenance + epoch + pin）、
 *   explanation_fragments（EF- 正文表）、existing_fragment_refs（恢复引用）；
 * - session_started 增可选 presenter_generation_pin（state/v4 会话级 pin 必填
 *   ——reducer 初始态 fail closed 强制）；
 * - 其余 20 类事件 payload 与 v7 逐字段同形（v9 codec 直接委托 V7 fold）。
 *
 * reader 纪律（v9 是带独立 marker 的新 schema）：
 * - v7/v6 reader 原样保留（历史测试/诊断；不承担新生产写入）；
 * - 按 session 行 event_schema 分派：v9 行→v9 reader；v7 行→v7 reader；
 * - 不做 v7→v9 迁移；半升级组合显式拒绝（RT0 清单 4）。
 */
export const V9_EVENT_SCHEMA_CONST = "ai_teaching_tutor_session_event/v9" as const;

export const V9_EVENT_TYPES = [
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
  "presentation_generation_requested",
  "presentation_generation_attempt_started",
  "presentation_generation_retry_scheduled",
  "presentation_generation_failed",
  "presentation_generation_invalidated",
] as const;

export type V9EventType = (typeof V9_EVENT_TYPES)[number];

/** 生成事件族（payload = GenerationRequestRecord 快照）。 */
export const V9_GENERATION_EVENT_TYPES = [
  "presentation_generation_requested",
  "presentation_generation_attempt_started",
  "presentation_generation_retry_scheduled",
  "presentation_generation_failed",
  "presentation_generation_invalidated",
] as const;

export type V9GenerationEventType = (typeof V9_GENERATION_EVENT_TYPES)[number];

export function isV9GenerationEventType(eventType: string): eventType is V9GenerationEventType {
  return (V9_GENERATION_EVENT_TYPES as readonly string[]).includes(eventType);
}

/** causation 必带集 = v7 集 + 生成事件族（镜像 canonical superRefine）。 */
export const V9_CAUSATION_REQUIRED: ReadonlySet<V9EventType> = new Set<V9EventType>([
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
  "presentation_generation_requested",
  "presentation_generation_attempt_started",
  "presentation_generation_retry_scheduled",
  "presentation_generation_failed",
  "presentation_generation_invalidated",
]);

/** 待追加 v9 事件（sequence/state_revision 由 store 分配）。 */
export interface PendingV9Event {
  event_type: V9EventType;
  payload: unknown;
  occurred_at: string;
  causation_sequence?: number;
  idempotency_key?: string;
}

/** 已存储 v9 事件（canonical 全形状）。 */
export interface StoredV9Event {
  schema: typeof V9_EVENT_SCHEMA_CONST;
  session_id: string;
  sequence: number;
  state_revision: number;
  occurred_at: string;
  event_type: V9EventType;
  payload: Record<string, unknown>;
  causation_sequence?: number;
  idempotency_key: string;
}

// --------------------------------------------------------------------------- //
// 错误分类（封闭枚举；store/integrity 与 v7 同集，reducer 增生成族码）
// --------------------------------------------------------------------------- //

export type V9StoreErrorCode =
  | "SESSION_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "DUPLICATE_EVENT"
  | "VALIDATION_FAILED"
  | "CAUSATION_REF_INVALID"
  | "SESSION_ALREADY_STARTED"
  | "SESSION_VERSION_UNSUPPORTED";

export class TutorSessionEventStoreV9Error extends Error {
  readonly code: V9StoreErrorCode;
  constructor(code: V9StoreErrorCode, message: string) {
    super(message);
    this.name = "TutorSessionEventStoreV9Error";
    this.code = code;
  }
}

export type V9IntegrityErrorCode =
  | "SESSION_NOT_FOUND"
  | "SCHEMA_ISOLATION"
  | "MISSING_SESSION_START"
  | "EVENT_GAP"
  | "CORRUPT_EVENT"
  | "REVISION_INCONSISTENT"
  | "HASH_MISMATCH"
  | "SESSION_VERSION_UNSUPPORTED";

export class TutorSessionIntegrityV9Error extends Error {
  readonly code: V9IntegrityErrorCode;
  readonly relatedSequence?: number;
  constructor(code: V9IntegrityErrorCode, message: string, relatedSequence?: number) {
    super(message);
    this.name = "TutorSessionIntegrityV9Error";
    this.code = code;
    if (relatedSequence !== undefined) this.relatedSequence = relatedSequence;
  }
}

/** v9 reducer 语义错误（v7 语义 + 生成族跨事件不变量）。 */
export type V9ReducerErrorCode =
  | "MISSING_SESSION_START"
  | "INQUIRY_RETURN_MISMATCH"
  | "GATE_BEAT_MISMATCH"
  | "REDUCER_INVARIANT"
  | "INTENT_CAUSATION_MISMATCH"
  | "CAPABILITY_UNREGISTERED"
  | "PRESENTATION_ORDER_INVALID"
  | "PRESENTATION_CURSOR_MISMATCH"
  | "COMMAND_CAUSATION_MISMATCH"
  | "SESSION_MODE_MISMATCH"
  | "GENERATION_REQUEST_DUPLICATE"
  | "GENERATION_SLOT_MISMATCH"
  | "GENERATION_REQUEST_STATE_INVALID"
  | "GENERATION_BUDGET_INVALID"
  | "PRESENTER_PIN_MISMATCH";

export class RuntimeStateReducerV9Error extends Error {
  readonly code: V9ReducerErrorCode;
  readonly relatedSequence?: number;
  constructor(code: V9ReducerErrorCode, message: string, relatedSequence?: number) {
    super(message);
    this.name = "RuntimeStateReducerV9Error";
    this.code = code;
    if (relatedSequence !== undefined) this.relatedSequence = relatedSequence;
  }
}

// --------------------------------------------------------------------------- //
// payload 窄类型（canonical 已校验；此处约束读取形状）
// --------------------------------------------------------------------------- //

/** 生成事件 payload = GenerationRequestRecord 快照（state/v4 同构）。 */
export interface V9GenerationEventPayload {
  request_id: string;
  source_request_id: string;
  decision_id: string;
  scope:
    | { kind: "approved"; protocol_id: string; beat_id: string }
    | {
        kind: "local";
        inquiry_id: string;
        local_protocol_id: string;
        local_beat_id: string;
        anchor: { protocol_id: string; beat_id: string };
      };
  reservation_revision: number;
  epoch: number;
  attempt: number;
  max_attempts: number;
  retry_policy_version: string;
  timeout_ms: number;
  retry_delays_ms: number[];
  context: {
    plan_ref: { artifact_id: string; version: string; content_hash: string };
    graph_ref: { artifact_id: string; version: string; content_hash: string };
    selected_fact_ids: string[];
    selected_inference_ids: string[];
    resource_ids: string[];
    event_cutoff: number;
    workspace_revision: number;
  };
  input_digest: string;
  presenter_pin: {
    provider: string;
    model_id: string;
    prompt_version: string;
    context_builder_version: string;
    tool_catalog_version: string;
  };
  status: "pending" | "committed" | "failed" | "cancelled";
  phase?: "running" | "waiting_retry";
  retry_at?: string;
  error_class?:
    | "provider_failure"
    | "timeout"
    | "draft_invalid"
    | "preflight_failed"
    | "context_irreproducible"
    | "internal_error"
    | "RETRY_EXHAUSTED";
  sequence_id?: string;
  cancel_reason?: "cancelled" | "superseded_by_new_input" | "revision_changed" | "session_closing";
}

/** v9 presentation_sequence_planned payload（scope + 可选 generation/fragments）。 */
export interface V9PresentationSequencePlannedPayload {
  sequence_id: string;
  decision_id: string;
  scope:
    | { kind: "approved"; protocol_id: string; beat_id: string }
    | {
        kind: "local";
        inquiry_id: string;
        local_protocol_id: string;
        local_beat_id: string;
        anchor: { protocol_id: string; beat_id: string };
      };
  generation?: {
    request_id: string;
    attempt: number;
    input_digest: string;
    presenter_pin: V9GenerationEventPayload["presenter_pin"];
    epoch: number;
  };
  actions: Array<{
    ordinal: number;
    kind: "voice" | "workspace";
    basis_refs?: string[];
    voice_action?: Record<string, unknown>;
    workspace_action?: Record<string, unknown>;
  }>;
  explanation_fragments?: Array<{
    fragment_id: string;
    kind: "approved_math_note" | "relation_note" | "explanation_text";
    content: string;
    basis_refs: string[];
    origin_generation: string;
    attach_to_entry?: string;
  }>;
  existing_fragment_refs?: Array<{ fragment_id: string; source_sequence_id: string; content_hash: string }>;
}
