/**
 * TutorSession 事实事件存储（P1-08 → Phase 5 / P5-01 升 v2）。
 *
 * Append 语义（09 架构 §8 TutorSessionEventStore + ADR-006 因果链）：
 * - 乐观并发：Append 带 expectedRevision，与当前 revision 不符 → REVISION_CONFLICT；
 * - 幂等键：idempotency_key 全局唯一。调用方可为重试批次自带 key；未提供时由
 *   store 按 `<session>:<sequence>` 派生。重复 append（同 key 再次插入）→
 *   DUPLICATE_EVENT，整批回滚，不静默去重；
 * - 事件先经 canonical TutorSessionEvent schema（Zod）校验，不合法 → VALIDATION_FAILED；
 * - 批内 sequence 由 store 分配（当前最大值起严格递增），调用方不自带；
 * - 一次 Append 是一个事务：整批成功或整批失败，成功后 session revision +1；
 * - v2 合同：state_revision = 提交后 revision（同批共享），causation_sequence
 *   由调用方按因果前驱携带；v1 会话（Phase 1 遗留）保持 v1 合同可读可追加。
 *
 * 表结构见 src/db/database.ts 的 tutor_sessions / tutor_session_events。
 * 该模块对事件表只发 INSERT/SELECT——append-only 由测试结构性自证。
 */
import { validatePayload, type ValidationOutcome } from "../../../../shared/canonical";
import {
  CAUSATION_REQUIRED,
  type PendingV2Event,
  type StoredV2Event,
  type V2EventType,
} from "./TutorSessionEvent";

export type EventStoreErrorCode =
  | "SESSION_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "DUPLICATE_EVENT"
  | "VALIDATION_FAILED";

export class TutorSessionEventStoreError extends Error {
  readonly code: EventStoreErrorCode;

  constructor(code: EventStoreErrorCode, message: string) {
    super(message);
    this.name = "TutorSessionEventStoreError";
    this.code = code;
  }
}

export interface StartTutorSessionInput {
  sessionId: string;
  studentId: string;
  plan: { artifact_id: string; version: string; content_hash: string };
  /** Phase 5：v2 会话写 ADR-006 因果链事件；默认 v2，v1 仅供遗留兼容路径。 */
  eventSchema?: "v1" | "v2";
}

/** 待追加事件（v1 合同，遗留）。idempotency_key 可选：重试批次应复用首次尝试的 key。 */
export interface PendingTutorSessionEvent {
  event_type: string;
  payload: unknown;
  occurred_at: string;
  idempotency_key?: string;
}

export interface StoredTutorSessionEvent {
  session_id: string;
  sequence: number;
  event_type: string;
  payload: unknown;
  occurred_at: string;
  idempotency_key: string;
}

interface SessionRow {
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

const { db } = require("../../db/database") as typeof import("../../db/database");

const insertSessionStatement = db.prepare(`
  INSERT INTO tutor_sessions
    (session_id, student_id, plan_artifact_id, plan_version, plan_content_hash, current_mode, revision, started_at, event_schema)
  VALUES (?, ?, ?, ?, ?, 'teach', 0, ?, ?)`);

const getSessionStatement = db.prepare(`
  SELECT session_id, student_id, plan_artifact_id, plan_version, plan_content_hash,
         current_mode, revision, started_at, completed_at, event_schema
  FROM tutor_sessions WHERE session_id = ?`);

const bumpRevisionStatement = db.prepare(`
  UPDATE tutor_sessions SET revision = revision + 1 WHERE session_id = ?`);

const setModeStatement = db.prepare(`
  UPDATE tutor_sessions SET current_mode = ? WHERE session_id = ?`);

const insertEventStatement = db.prepare(`
  INSERT INTO tutor_session_events
    (session_id, sequence, event_type, payload_json, occurred_at, idempotency_key, recorded_revision, recorded_at, causation_sequence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const maxSequenceStatement = db.prepare(`
  SELECT MAX(sequence) AS max_sequence FROM tutor_session_events WHERE session_id = ?`);

const listEventsStatement = db.prepare(`
  SELECT session_id, sequence, event_type, payload_json, occurred_at, idempotency_key, recorded_revision, causation_sequence
  FROM tutor_session_events WHERE session_id = ? ORDER BY sequence ASC`);

const nowIso = (): string => new Date().toISOString();

function getSessionRow(sessionId: string): SessionRow | undefined {
  return getSessionStatement.get(sessionId) as SessionRow | undefined;
}

function mapUniqueViolation(error: unknown, idempotencyKey: string): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNIQUE constraint failed: tutor_session_events.idempotency_key")) {
    return new TutorSessionEventStoreError(
      "DUPLICATE_EVENT",
      `idempotency key already used: ${idempotencyKey}`,
    );
  }
  if (message.includes("UNIQUE constraint failed: tutor_session_events.")) {
    return new TutorSessionEventStoreError(
      "DUPLICATE_EVENT",
      `duplicate event row (session/sequence/key already used): ${idempotencyKey}`,
    );
  }
  return error;
}

function insertEventRow(
  sessionId: string,
  sequence: number,
  event: { event_type: string; payload: unknown; occurred_at: string },
  idempotencyKey: string,
  nextRevision: number,
  recordedAt: string,
  causationSequence: number | undefined,
): void {
  try {
    insertEventStatement.run(
      sessionId,
      sequence,
      event.event_type,
      JSON.stringify(event.payload),
      event.occurred_at,
      idempotencyKey,
      nextRevision,
      recordedAt,
      causationSequence ?? null,
    );
  } catch (error) {
    throw mapUniqueViolation(error, idempotencyKey);
  }
}

function nextSequenceFor(sessionId: string): number {
  const maxRow = maxSequenceStatement.get(sessionId) as { max_sequence: number | null };
  return maxRow.max_sequence ?? 0;
}

// --------------------------------------------------------------------------- //
// v1 遗留路径（Phase 1 合同，保持原语义；老 session 继续可恢复）
// --------------------------------------------------------------------------- //

function canonicalizeV1Event(
  sessionId: string,
  event: PendingTutorSessionEvent,
  sequence: number,
): { record: Record<string, unknown>; idempotencyKey: string } & ValidationOutcome {
  const idempotencyKey = event.idempotency_key ?? `${sessionId}:${sequence}`;
  const record = {
    schema: "ai_teaching_tutor_session_event/v1",
    session_id: sessionId,
    sequence,
    occurred_at: event.occurred_at,
    event_type: event.event_type,
    payload: event.payload,
    idempotency_key: idempotencyKey,
  };
  const outcome = validatePayload(record);
  return { record, idempotencyKey, ...outcome };
}

export function appendTutorSessionEvents(
  sessionId: string,
  expectedRevision: number,
  events: PendingTutorSessionEvent[],
): { revision: number; appendedSequences: number[] } {
  if (!Array.isArray(events) || events.length === 0) {
    throw new TutorSessionEventStoreError("VALIDATION_FAILED", "events must be a non-empty array");
  }
  const appendTransaction = db.transaction((): { revision: number; appendedSequences: number[] } => {
    const session = getSessionRow(sessionId);
    if (!session) {
      throw new TutorSessionEventStoreError("SESSION_NOT_FOUND", `unknown session: ${sessionId}`);
    }
    if (session.event_schema !== "v1") {
      throw new TutorSessionEventStoreError(
        "VALIDATION_FAILED",
        `session ${sessionId} uses ${session.event_schema} contract; v1 append is legacy-only`,
      );
    }
    if (session.revision !== expectedRevision) {
      throw new TutorSessionEventStoreError(
        "REVISION_CONFLICT",
        `expected revision ${expectedRevision} but session is at ${session.revision}`,
      );
    }
    let sequence = nextSequenceFor(sessionId);
    const recordedAt = nowIso();
    const appended: number[] = [];
    const nextRevision = expectedRevision + 1;
    events.forEach((event, index) => {
      sequence += 1;
      const canonical = canonicalizeV1Event(sessionId, event, sequence);
      if (!canonical.ok) {
        throw new TutorSessionEventStoreError(
          "VALIDATION_FAILED",
          `event at position ${index}: ${canonical.errors.join("; ")}`,
        );
      }
      insertEventRow(sessionId, sequence, event, canonical.idempotencyKey, nextRevision, recordedAt, undefined);
      appended.push(sequence);
    });
    bumpRevisionStatement.run(sessionId);
    return { revision: nextRevision, appendedSequences: appended };
  });
  return appendTransaction();
}

// --------------------------------------------------------------------------- //
// v2 路径（Phase 5 / ADR-006 因果链）
// --------------------------------------------------------------------------- //

function canonicalizeV2Event(
  sessionId: string,
  event: PendingV2Event,
  sequence: number,
  stateRevision: number,
): { record: Record<string, unknown>; idempotencyKey: string } & ValidationOutcome {
  const idempotencyKey = event.idempotency_key ?? `${sessionId}:${sequence}`;
  const record: Record<string, unknown> = {
    schema: "ai_teaching_tutor_session_event/v2",
    session_id: sessionId,
    sequence,
    state_revision: stateRevision,
    occurred_at: event.occurred_at,
    event_type: event.event_type,
    payload: event.payload,
    idempotency_key: idempotencyKey,
  };
  if (event.causation_sequence !== undefined) {
    record.causation_sequence = event.causation_sequence;
  }
  const outcome = validatePayload(record);
  return { record, idempotencyKey, ...outcome };
}

/**
 * 追加一批 v2 事件。state_revision 由 store 统一盖章为提交后 revision；
 * causation_sequence 必须指向已存在（或同批更早）事件的 sequence——本 store
 * 不做跨事件引用校验（由 coordinator 层保证），仅透传给 canonical 合同。
 */
export function appendTutorSessionEventsV2(
  sessionId: string,
  expectedRevision: number,
  events: PendingV2Event[],
): { revision: number; appendedSequences: number[] } {
  if (!Array.isArray(events) || events.length === 0) {
    throw new TutorSessionEventStoreError("VALIDATION_FAILED", "events must be a non-empty array");
  }
  const appendTransaction = db.transaction((): { revision: number; appendedSequences: number[] } => {
    const session = getSessionRow(sessionId);
    if (!session) {
      throw new TutorSessionEventStoreError("SESSION_NOT_FOUND", `unknown session: ${sessionId}`);
    }
    if (session.event_schema !== "v2") {
      throw new TutorSessionEventStoreError(
        "VALIDATION_FAILED",
        `session ${sessionId} uses ${session.event_schema} contract; v2 append requires event_schema=v2`,
      );
    }
    if (session.revision !== expectedRevision) {
      throw new TutorSessionEventStoreError(
        "REVISION_CONFLICT",
        `expected revision ${expectedRevision} but session is at ${session.revision}`,
      );
    }
    let sequence = nextSequenceFor(sessionId);
    const recordedAt = nowIso();
    const appended: number[] = [];
    const nextRevision = expectedRevision + 1;
    events.forEach((event, index) => {
      sequence += 1;
      if (CAUSATION_REQUIRED.has(event.event_type as V2EventType) && event.causation_sequence === undefined) {
        throw new TutorSessionEventStoreError(
          "VALIDATION_FAILED",
          `event at position ${index}: event_type=${event.event_type} requires causation_sequence`,
        );
      }
      const canonical = canonicalizeV2Event(sessionId, event, sequence, nextRevision);
      if (!canonical.ok) {
        throw new TutorSessionEventStoreError(
          "VALIDATION_FAILED",
          `event at position ${index}: ${canonical.errors.join("; ")}`,
        );
      }
      insertEventRow(sessionId, sequence, event, canonical.idempotencyKey, nextRevision, recordedAt, event.causation_sequence);
      appended.push(sequence);
    });
    bumpRevisionStatement.run(sessionId);
    return { revision: nextRevision, appendedSequences: appended };
  });
  return appendTransaction();
}

// --------------------------------------------------------------------------- //
// 会话与读取
// --------------------------------------------------------------------------- //

export function startTutorSession(input: StartTutorSessionInput): void {
  insertSessionStatement.run(
    input.sessionId,
    input.studentId,
    input.plan.artifact_id,
    input.plan.version,
    input.plan.content_hash,
    nowIso(),
    input.eventSchema ?? "v2",
  );
}

export function getTutorSession(sessionId: string): Record<string, unknown> | undefined {
  return getSessionStatement.get(sessionId) as Record<string, unknown> | undefined;
}

/** 会话行维护（mode 投影缓存）；事件本身 append-only，不经此路径修改。 */
export function setTutorSessionMode(sessionId: string, mode: string): void {
  setModeStatement.run(mode, sessionId);
}

export function readTutorSessionEvents(sessionId: string): StoredTutorSessionEvent[] {
  const rows = listEventsStatement.all(sessionId) as Array<{
    session_id: string;
    sequence: number;
    event_type: string;
    payload_json: string;
    occurred_at: string;
    idempotency_key: string;
  }>;
  return rows.map((row) => ({
    session_id: row.session_id,
    sequence: row.sequence,
    event_type: row.event_type,
    payload: JSON.parse(row.payload_json) as unknown,
    occurred_at: row.occurred_at,
    idempotency_key: row.idempotency_key,
  }));
}

/** v2 canonical 全形状读取（replay / state projection 输入）。 */
export function readTutorSessionEventsV2(sessionId: string): StoredV2Event[] {
  const session = getSessionRow(sessionId);
  if (!session) {
    throw new TutorSessionEventStoreError("SESSION_NOT_FOUND", `unknown session: ${sessionId}`);
  }
  if (session.event_schema !== "v2") {
    throw new TutorSessionEventStoreError(
      "VALIDATION_FAILED",
      `session ${sessionId} is ${session.event_schema}; canonical v2 read requires a v2 session`,
    );
  }
  const rows = listEventsStatement.all(sessionId) as Array<{
    session_id: string;
    sequence: number;
    event_type: string;
    payload_json: string;
    occurred_at: string;
    idempotency_key: string;
    recorded_revision: number;
    causation_sequence: number | null;
  }>;
  return rows.map(
    (row) =>
      ({
        schema: "ai_teaching_tutor_session_event/v2",
        session_id: row.session_id,
        sequence: row.sequence,
        state_revision: row.recorded_revision,
        occurred_at: row.occurred_at,
        event_type: row.event_type as V2EventType,
        payload: JSON.parse(row.payload_json) as PendingV2Event["payload"],
        ...(row.causation_sequence !== null ? { causation_sequence: row.causation_sequence } : {}),
        idempotency_key: row.idempotency_key,
      }) as StoredV2Event,
  );
}

/** 会话当前 revision（coordinator 乐观并发的读取端）。 */
export function tutorSessionRevision(sessionId: string): number {
  const session = getSessionRow(sessionId);
  if (!session) {
    throw new TutorSessionEventStoreError("SESSION_NOT_FOUND", `unknown session: ${sessionId}`);
  }
  return session.revision;
}
