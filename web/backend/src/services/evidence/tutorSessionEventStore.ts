/**
 * TutorSession 事实事件存储（P1-08）。
 *
 * Append 语义（09 架构 §8 TutorSessionEventStore + Phase 1 退出门禁 4）：
 * - 乐观并发：Append 带 expectedRevision，与当前 revision 不符 → REVISION_CONFLICT；
 * - 幂等键：idempotency_key 全局唯一。调用方可为重试批次自带 key（如
 *   `TS-0001:boot:1`）；未提供时由 store 按 `<session>:<sequence>` 派生。
 *   重复 append（同 key 再次插入）→ DUPLICATE_EVENT，整批回滚，不静默去重；
 * - 事件先经 canonical TutorSessionEvent schema（Zod）校验，不合法 → VALIDATION_FAILED；
 * - 批内 sequence 由 store 分配（当前最大值起严格递增），调用方不自带；
 * - 一次 Append 是一个事务：整批成功或整批失败，成功后 session revision +1。
 *
 * 表结构见 src/db/database.ts 的 tutor_sessions / tutor_session_events（P1-07）。
 * 该模块对事件表只发 INSERT/SELECT——append-only 由测试结构性自证。
 */
import { validatePayload, type ValidationOutcome } from "../../../../shared/canonical";

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
}

/** 待追加事件。idempotency_key 可选：重试批次应复用首次尝试的 key。 */
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

const { db } = require("../../db/database") as typeof import("../../db/database");

const insertSessionStatement = db.prepare(`
  INSERT INTO tutor_sessions
    (session_id, student_id, plan_artifact_id, plan_version, plan_content_hash, current_mode, revision, started_at)
  VALUES (?, ?, ?, ?, ?, 'teach', 0, ?)`);

const getSessionStatement = db.prepare(`
  SELECT session_id, student_id, plan_artifact_id, plan_version, plan_content_hash,
         current_mode, revision, started_at, completed_at
  FROM tutor_sessions WHERE session_id = ?`);

const bumpRevisionStatement = db.prepare(`
  UPDATE tutor_sessions SET revision = revision + 1 WHERE session_id = ?`);

const insertEventStatement = db.prepare(`
  INSERT INTO tutor_session_events
    (session_id, sequence, event_type, payload_json, occurred_at, idempotency_key, recorded_revision, recorded_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

const maxSequenceStatement = db.prepare(`
  SELECT MAX(sequence) AS max_sequence FROM tutor_session_events WHERE session_id = ?`);

const listEventsStatement = db.prepare(`
  SELECT session_id, sequence, event_type, payload_json, occurred_at, idempotency_key
  FROM tutor_session_events WHERE session_id = ? ORDER BY sequence ASC`);

const nowIso = (): string => new Date().toISOString();

function canonicalizeEvent(
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

export function startTutorSession(input: StartTutorSessionInput): void {
  insertSessionStatement.run(
    input.sessionId,
    input.studentId,
    input.plan.artifact_id,
    input.plan.version,
    input.plan.content_hash,
    nowIso(),
  );
}

export function getTutorSession(sessionId: string): Record<string, unknown> | undefined {
  return getSessionStatement.get(sessionId) as Record<string, unknown> | undefined;
}

export interface AppendResult {
  revision: number;
  appendedSequences: number[];
}

export function appendTutorSessionEvents(
  sessionId: string,
  expectedRevision: number,
  events: PendingTutorSessionEvent[],
): AppendResult {
  if (!Array.isArray(events) || events.length === 0) {
    throw new TutorSessionEventStoreError("VALIDATION_FAILED", "events must be a non-empty array");
  }
  const appendTransaction = db.transaction((): AppendResult => {
    const session = getSessionStatement.get(sessionId) as { revision: number } | undefined;
    if (!session) {
      throw new TutorSessionEventStoreError("SESSION_NOT_FOUND", `unknown session: ${sessionId}`);
    }
    if (session.revision !== expectedRevision) {
      throw new TutorSessionEventStoreError(
        "REVISION_CONFLICT",
        `expected revision ${expectedRevision} but session is at ${session.revision}`,
      );
    }
    const maxRow = maxSequenceStatement.get(sessionId) as { max_sequence: number | null };
    let sequence = maxRow.max_sequence ?? 0;
    const recordedAt = nowIso();
    const appended: number[] = [];
    const nextRevision = expectedRevision + 1;
    events.forEach((event, index) => {
      sequence += 1;
      const canonical = canonicalizeEvent(sessionId, event, sequence);
      if (!canonical.ok) {
        throw new TutorSessionEventStoreError(
          "VALIDATION_FAILED",
          `event at position ${index}: ${canonical.errors.join("; ")}`,
        );
      }
      try {
        insertEventStatement.run(
          sessionId,
          sequence,
          event.event_type,
          JSON.stringify(event.payload),
          event.occurred_at,
          canonical.idempotencyKey,
          nextRevision,
          recordedAt,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("UNIQUE constraint failed: tutor_session_events.idempotency_key")) {
          throw new TutorSessionEventStoreError(
            "DUPLICATE_EVENT",
            `idempotency key already used: ${canonical.idempotencyKey}`,
          );
        }
        if (message.includes("UNIQUE constraint failed: tutor_session_events.")) {
          throw new TutorSessionEventStoreError(
            "DUPLICATE_EVENT",
            `duplicate event row (session/sequence/key already used): ${canonical.idempotencyKey}`,
          );
        }
        throw error;
      }
      appended.push(sequence);
    });
    bumpRevisionStatement.run(sessionId);
    return { revision: nextRevision, appendedSequences: appended };
  });
  return appendTransaction();
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
