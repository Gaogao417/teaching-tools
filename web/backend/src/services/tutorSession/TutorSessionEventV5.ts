/**
 * TutorSessionEvent v5 词表与内核类型（F2 — Event / Revision / Replay 内核）。
 *
 * canonical 合同（PRDS 真源）：contracts/schemas/runtime/v5/tutor-session-event.schema.json
 * （TS Zod 镜像：web/shared/canonical/schemas.ts tutorSessionEventV5Schema）。
 * 本文件不做第二套语义：只固定 16 类事件词表、causation 必带集（镜像
 * canonical superRefine 规则，供 store 提前给出可读错误）、待追加/已存储形状
 * 与内核错误分类。canonical 判定永远以 validatePayload / tutorSessionEventV5Schema
 * 为准。
 *
 * F2 语义（f2-scope-ledger）：
 * - append 事务成功 = committed；issued/executed/rejected/interrupted/failed
 *   由事件类型与 action_outcome_recorded.outcome 区分，不得压成同一种完成事实；
 * - state_revision = 提交后 revision（与 v1–v4 envelope 同构，同批共享）；
 * - causation_sequence 必须指向已存在（或同批更早）事件的 sequence——
 *   v2 store 不做跨事件引用校验（coordinator 层保证），v5 kernel 在 store
 *   层 fail closed（CAUSATION_REF_INVALID）；
 * - 读侧完整性（gap / corrupt / revision 非单调 / pin 不符）由
 *   RuntimeStateRebuilderV5 fail closed，见该文件。
 */

export const V5_EVENT_SCHEMA_CONST = "ai_teaching_tutor_session_event/v5" as const;

export const V5_EVENT_TYPES = [
  "session_started",
  "student_intent_recorded",
  "semantic_interpretation_recorded",
  "policy_decision_made",
  "gate_evaluated",
  "voice_action_issued",
  "workspace_surface_action_issued",
  "action_outcome_recorded",
  "external_support_recorded",
  "inquiry_opened",
  "inquiry_returned",
  "student_progressed",
  "policy_failed",
  "presentation_failed",
  "runtime_failure",
  "session_completed",
] as const;

export type V5EventType = (typeof V5_EVENT_TYPES)[number];

/** 要求 causation_sequence 的事件集合（镜像 canonical V5_CAUSATION_REQUIRED）。 */
export const V5_CAUSATION_REQUIRED: ReadonlySet<V5EventType> = new Set([
  "semantic_interpretation_recorded",
  "policy_decision_made",
  "gate_evaluated",
  "voice_action_issued",
  "workspace_surface_action_issued",
  "action_outcome_recorded",
  "external_support_recorded",
  "inquiry_opened",
  "inquiry_returned",
  "student_progressed",
  "policy_failed",
  "presentation_failed",
]);

/** action_outcome_recorded.outcome 的完成语义（G2：非 completed 不产生完成副作用）。 */
export const V5_OUTCOME_KINDS = ["completed", "rejected", "interrupted", "failed"] as const;
export type V5OutcomeKind = (typeof V5_OUTCOME_KINDS)[number];

/** 待追加 v5 事件（sequence/state_revision 由 store 分配，调用方不携带）。 */
export interface PendingV5Event {
  event_type: V5EventType;
  payload: unknown;
  occurred_at: string;
  causation_sequence?: number;
  /** 重试批次应复用首次尝试的 key；未提供时由 store 按 `<session>:<sequence>` 派生。 */
  idempotency_key?: string;
}

/** 已存储 v5 事件（canonical 全形状，replay / rebuild 输入）。 */
export interface StoredV5Event {
  schema: typeof V5_EVENT_SCHEMA_CONST;
  session_id: string;
  sequence: number;
  state_revision: number;
  occurred_at: string;
  event_type: V5EventType;
  payload: Record<string, unknown>;
  causation_sequence?: number;
  idempotency_key: string;
}

/** 事件表原始行（rebuilder 的损坏检测输入；payload_json 未解析）。 */
export interface RawV5EventRow {
  sequence: number;
  event_type: string;
  payload_json: string;
  occurred_at: string;
  idempotency_key: string;
  recorded_revision: number;
  recorded_at: string;
  causation_sequence: number | null;
}

const SESSION_ID_PATTERN = /^TS-[0-9]{4,}$/;

export function assertV5SessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`invalid tutor session id: ${sessionId}（须匹配 ^TS-[0-9]{4,}$）`);
  }
}

// --------------------------------------------------------------------------- //
// 错误分类（store 写侧 / 读侧完整性 / reducer 各一套封闭枚举，fail closed）
// --------------------------------------------------------------------------- //

/** v5 store 写侧错误（与 v1–v4 store 的四码对齐，新增 causation/起始事件两码）。 */
export type V5StoreErrorCode =
  | "SESSION_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "DUPLICATE_EVENT"
  | "VALIDATION_FAILED"
  | "CAUSATION_REF_INVALID"
  | "SESSION_ALREADY_STARTED";

export class TutorSessionEventStoreV5Error extends Error {
  readonly code: V5StoreErrorCode;

  constructor(code: V5StoreErrorCode, message: string) {
    super(message);
    this.name = "TutorSessionEventStoreV5Error";
    this.code = code;
  }
}

/**
 * 读侧完整性错误（rebuild fail closed 分类）。EVENT_GAP / CORRUPT_EVENT /
 * REVISION_INCONSISTENT / HASH_MISMATCH 均属 corruption 家族：不得默认跳过、
 * 不得部分重建（计划 §5 F2：gap/corruption fail closed）。
 */
export type V5IntegrityErrorCode =
  | "SESSION_NOT_FOUND"
  | "SCHEMA_ISOLATION"
  | "MISSING_SESSION_START"
  | "EVENT_GAP"
  | "CORRUPT_EVENT"
  | "REVISION_INCONSISTENT"
  | "HASH_MISMATCH";

export class TutorSessionIntegrityError extends Error {
  readonly code: V5IntegrityErrorCode;
  readonly relatedSequence?: number;

  constructor(code: V5IntegrityErrorCode, message: string, relatedSequence?: number) {
    super(message);
    this.name = "TutorSessionIntegrityError";
    this.code = code;
    if (relatedSequence !== undefined) {
      this.relatedSequence = relatedSequence;
    }
  }
}

/** reducer 语义校验错误（同一事件流内部不变量被破坏时 fail closed）。 */
export type V5ReducerErrorCode = "MISSING_SESSION_START" | "INQUIRY_RETURN_MISMATCH" | "REDUCER_INVARIANT";

export class RuntimeStateReducerV5Error extends Error {
  readonly code: V5ReducerErrorCode;
  readonly relatedSequence?: number;

  constructor(code: V5ReducerErrorCode, message: string, relatedSequence?: number) {
    super(message);
    this.name = "RuntimeStateReducerV5Error";
    this.code = code;
    if (relatedSequence !== undefined) {
      this.relatedSequence = relatedSequence;
    }
  }
}

// --------------------------------------------------------------------------- //
// reducer 只读的 payload 窄类型（事件已过 canonical 校验；此处仅约束读取形状）
// --------------------------------------------------------------------------- //

export interface V5ArtifactRefLike {
  artifact_id: string;
  version: string;
  content_hash: string;
}

export interface V5SessionStartedPayload {
  task_id: string;
  scenario_id: string;
  question_ref: V5ArtifactRefLike;
  approach_set_ref: V5ArtifactRefLike;
  solution_graph_ref: V5ArtifactRefLike;
  protocol_refs: V5ArtifactRefLike[];
  tutor_plan_ref: V5ArtifactRefLike;
  policy_profile_snapshot?: {
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
}

export interface V5PolicyDecisionPayload {
  decision_id: string;
  decision_kind: string;
  protocol_id: string;
  beat_id: string;
  to_beat_id?: string;
  policy_version: string;
  source_event_sequence: number;
  source_state_revision: number;
  inquiry?: { inquiry_id: string; inquiry_protocol_id?: string; return_beat_id: string };
}

export interface V5GateEvaluatedPayload {
  gate_id: string;
  beat_id: string;
  satisfied: boolean;
  evidence_sequence?: number;
}

export interface V5ActionOutcomePayload {
  action_id: string;
  action_kind: "voice" | "workspace_surface" | "student_command";
  outcome: V5OutcomeKind;
  failure_class?: string;
  message?: string;
  resulting_revision?: number;
}

export interface V5InquiryPayload {
  inquiry_id: string;
  inquiry_protocol_id?: string;
  return_beat_id: string;
  local?: boolean;
  trigger?: string;
}
