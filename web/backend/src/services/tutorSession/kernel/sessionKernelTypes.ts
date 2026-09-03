/**
 * Session kernel 版本无关形状（F7 Step 2 — V6 Session Kernel 抽取的公共类型）。
 *
 * TutorSessionEventStore / RuntimeStateRebuilder / TutorSessionKernel 的核心
 * 事务与完整性逻辑按 codec + reducer 注入复用（PLAN.md Step 2「先抽公共基础
 * 设施，避免复制 V5」）。本文件只固定跨版本同构的存储形状：
 * - `event_type` 在 core 层是 string（词表封闭性由各版本 codec 的 canonical
 *   Zod 判定保证，store 写侧 VALIDATION_FAILED / 读侧 CORRUPT_EVENT）；
 * - `RawSessionEventRow` 的 payload_json 不解析（rebuilder 损坏检测输入）；
 * - `SessionRow.event_schema` 是 per-session 合同版本标记（v5/v6 写入纪律）。
 */

/** 待追加事件（sequence/state_revision 由 store 分配，调用方不携带）。 */
export interface PendingSessionEvent {
  event_type: string;
  payload: unknown;
  occurred_at: string;
  causation_sequence?: number;
  /** 重试批次应复用首次尝试的 key；未提供时由 store 按 `<session>:<sequence>` 派生。 */
  idempotency_key?: string;
}

/** 已存储事件（canonical 全形状，replay / rebuild 输入；schema const 由 codec 收窄）。 */
export interface StoredSessionEvent {
  schema: string;
  session_id: string;
  sequence: number;
  state_revision: number;
  occurred_at: string;
  event_type: string;
  payload: Record<string, unknown>;
  causation_sequence?: number;
  idempotency_key: string;
}

/** 事件表原始行（rebuilder 的损坏检测输入；payload_json 未解析）。 */
export interface RawSessionEventRow {
  sequence: number;
  event_type: string;
  payload_json: string;
  occurred_at: string;
  idempotency_key: string;
  recorded_revision: number;
  recorded_at: string;
  causation_sequence: number | null;
}

/** tutor_sessions 会话行（TP pin + revision + event_schema 版本标记）。 */
export interface SessionRow {
  session_id: string;
  student_id: string;
  plan_artifact_id: string;
  plan_version: string;
  plan_content_hash: string;
  current_mode: string;
  revision: number;
  started_at: string;
  completed_at: string | null;
  event_schema: string;
}

/** session_started payload 的 pin 读取形状（行 pin 对账用；全字段由各版本 codec 判定）。 */
export interface SessionStartedPinLike {
  tutor_plan_ref: {
    artifact_id: string;
    version: string;
    content_hash: string;
  };
}
