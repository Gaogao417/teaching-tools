/**
 * TutorSessionEventStore v5（F2 — Event / Revision / Replay 内核）。
 *
 * 复用现有 SQLite 表（f0 dependency ledger §2.1：`tutor_sessions` /
 * `tutor_session_events` 的 PK(session_id,sequence)、UNIQUE idempotency_key、
 * causation_sequence、recorded_revision、`tutor_sessions.event_schema` 列均已
 * 存在——F2 无 DDL 变更，只登记 event_schema='v5' 写入纪律）。本模块对事件表
 * 只发 INSERT/SELECT（append-only 结构性自证，与 v1–v4 store 同规则）。
 *
 * Append 语义（f2-scope-ledger）：
 * - session start 原子完成「行 pin（TP artifact_id/version/content_hash +
 *   event_schema='v5'）+ sequence 1 的 session_started 事件（revision 0→1）」；
 *   session_started 只能经 start 写入，append 路径拒绝（SESSION_ALREADY_STARTED）；
 * - append 乐观并发：expectedRevision 与 session.revision 不符 → REVISION_CONFLICT；
 * - sequence 由 store 分配（当前最大值起严格 +1，批内递增），调用方不自带；
 * - idempotency_key 全局 UNIQUE：重复 append（同 key 或同 sequence）→
 *   DUPLICATE_EVENT，整批回滚，不静默去重；
 * - causation_sequence 必带集（镜像 canonical）+ 引用校验：只能指向已提交或
 *   同批更早的 sequence → CAUSATION_REF_INVALID；
 * - 每条事件经 canonical ai_teaching_tutor_session_event/v5（Zod）校验 →
 *   VALIDATION_FAILED（含 v5 会话与 v1–v4 会话的合同隔离）；
 * - reducer 折叠校验先于持久化生效（2026-08-29 复验修复 #2）：事务内把
 *   「已提交历史 + 候选 canonical 批」先纯折叠（applyV5Event，与在线/重建
 *   同一 reducer）；reducer 拒绝（RuntimeStateReducerV5Error，如
 *   INQUIRY_RETURN_MISMATCH）则异常逃逸事务 ⇒ 整批回滚不落库，事件数/
 *   revision/调用方缓存 state 全部不变——「schema 合法但语义非法」的事件
 *   不得毒化会话（此前先提交后 reduce，append 抛错但事实已落库、后续
 *   rebuild 持续失败）；
 * - 一次 append 一个事务：整批成功或整批失败，成功后 session revision +1，
 *   批内事件共享提交后 state_revision（与 v1–v4 envelope 同构）。
 */
import { db } from "../../db/database";
import { validatePayload } from "../../../../shared/canonical";
import { applyV5Event, foldCommittedV5Events } from "./TutorRuntimeStateReducerV5";
import {
  assertV5SessionId,
  TutorSessionEventStoreV5Error,
  V5_CAUSATION_REQUIRED,
  V5_EVENT_SCHEMA_CONST,
  type PendingV5Event,
  type RawV5EventRow,
  type StoredV5Event,
  type V5EventType,
  type V5SessionStartedPayload,
} from "./TutorSessionEventV5";

export interface SessionRowV5 {
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

export interface StartTutorSessionV5Input {
  sessionId: string;
  studentId: string;
  /** canonical v5 session_started payload（含全量 pin refs 与 initial_cursor）。 */
  sessionStarted: V5SessionStartedPayload;
  occurred_at: string;
  idempotency_key?: string;
}

const insertSessionStatement = db.prepare(`
  INSERT INTO tutor_sessions
    (session_id, student_id, plan_artifact_id, plan_version, plan_content_hash, current_mode, revision, started_at, event_schema)
  VALUES (?, ?, ?, ?, ?, 'teach', 1, ?, 'v5')`);

const getSessionStatement = db.prepare(`
  SELECT session_id, student_id, plan_artifact_id, plan_version, plan_content_hash,
         current_mode, revision, started_at, completed_at, event_schema
  FROM tutor_sessions WHERE session_id = ?`);

const bumpRevisionStatement = db.prepare(`
  UPDATE tutor_sessions SET revision = revision + 1 WHERE session_id = ?`);

const insertEventStatement = db.prepare(`
  INSERT INTO tutor_session_events
    (session_id, sequence, event_type, payload_json, occurred_at, idempotency_key, recorded_revision, recorded_at, causation_sequence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const maxSequenceStatement = db.prepare(`
  SELECT MAX(sequence) AS max_sequence FROM tutor_session_events WHERE session_id = ?`);

const listRawRowsStatement = db.prepare(`
  SELECT sequence, event_type, payload_json, occurred_at, idempotency_key, recorded_revision, recorded_at, causation_sequence
  FROM tutor_session_events WHERE session_id = ? ORDER BY sequence ASC`);

const nowIso = (): string => new Date().toISOString();

export function getTutorSessionV5(sessionId: string): SessionRowV5 | undefined {
  return getSessionStatement.get(sessionId) as SessionRowV5 | undefined;
}

function requireV5SessionRow(sessionId: string): SessionRowV5 {
  const session = getTutorSessionV5(sessionId);
  if (!session) {
    throw new TutorSessionEventStoreV5Error("SESSION_NOT_FOUND", `unknown session: ${sessionId}`);
  }
  if (session.event_schema !== "v5") {
    throw new TutorSessionEventStoreV5Error(
      "VALIDATION_FAILED",
      `session ${sessionId} uses ${session.event_schema} contract; v5 append requires event_schema=v5`,
    );
  }
  return session;
}

function maxSequenceFor(sessionId: string): number {
  const row = maxSequenceStatement.get(sessionId) as { max_sequence: number | null };
  return row.max_sequence ?? 0;
}

/** 会话下一个可用 sequence（调用方可作 expected sequence 校对；分配权仍在 store）。 */
export function nextTutorSessionSequenceV5(sessionId: string): number {
  return maxSequenceFor(sessionId) + 1;
}

function mapUniqueViolation(error: unknown, idempotencyKey: string): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNIQUE constraint failed: tutor_session_events.idempotency_key")) {
    return new TutorSessionEventStoreV5Error(
      "DUPLICATE_EVENT",
      `idempotency key already used: ${idempotencyKey}`,
    );
  }
  if (message.includes("UNIQUE constraint failed: tutor_session_events.")) {
    return new TutorSessionEventStoreV5Error(
      "DUPLICATE_EVENT",
      `duplicate event row (session/sequence/key already used): ${idempotencyKey}`,
    );
  }
  if (message.includes("UNIQUE constraint failed: tutor_sessions.session_id")) {
    return new TutorSessionEventStoreV5Error("DUPLICATE_EVENT", `session already exists: ${idempotencyKey}`);
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

/** 组装 canonical 全形状记录并做 Zod 判定（ok=false 时带 canonical errors）。 */
function canonicalizeV5Event(
  sessionId: string,
  event: { event_type: string; payload: unknown; occurred_at: string; causation_sequence?: number },
  sequence: number,
  stateRevision: number,
  idempotencyKey: string,
): { ok: boolean; errors: readonly string[]; record: Record<string, unknown> } {
  const record: Record<string, unknown> = {
    schema: V5_EVENT_SCHEMA_CONST,
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
  return { ok: outcome.ok, errors: outcome.errors, record };
}

// --------------------------------------------------------------------------- //
// session start：固定 Plan/version/hash（G2 前置）
// --------------------------------------------------------------------------- //

/**
 * 启动 v5 会话：一个事务内写 session 行（TP pin + event_schema='v5'）与
 * sequence 1 的 session_started 事件。session_started payload 本身就是全量
 * pin 真源（solution_graph_ref / protocol_refs / policy_profile_snapshot）；
 * 行内 TP 三元组与之同源（同一 payload 字段），恢复期由 rebuilder 对账。
 */
export function startTutorSessionV5(input: StartTutorSessionV5Input): {
  revision: number;
  appendedSequences: number[];
} {
  assertV5SessionId(input.sessionId);
  const startTransaction = db.transaction((): { revision: number; appendedSequences: number[] } => {
    if (getTutorSessionV5(input.sessionId)) {
      throw new TutorSessionEventStoreV5Error(
        "DUPLICATE_EVENT",
        `session already exists: ${input.sessionId}`,
      );
    }
    const idempotencyKey = input.idempotency_key ?? `${input.sessionId}:1`;
    const canonical = canonicalizeV5Event(
      input.sessionId,
      {
        event_type: "session_started",
        payload: input.sessionStarted,
        occurred_at: input.occurred_at,
      },
      1,
      1,
      idempotencyKey,
    );
    if (!canonical.ok) {
      throw new TutorSessionEventStoreV5Error(
        "VALIDATION_FAILED",
        `session_started payload invalid: ${canonical.errors.join("; ")}`,
      );
    }
    try {
      insertSessionStatement.run(
        input.sessionId,
        input.studentId,
        input.sessionStarted.tutor_plan_ref.artifact_id,
        input.sessionStarted.tutor_plan_ref.version,
        input.sessionStarted.tutor_plan_ref.content_hash,
        input.occurred_at,
      );
    } catch (error) {
      throw mapUniqueViolation(error, input.sessionId);
    }
    insertEventRow(input.sessionId, 1, {
      event_type: "session_started",
      payload: input.sessionStarted,
      occurred_at: input.occurred_at,
    }, idempotencyKey, 1, nowIso(), undefined);
    return { revision: 1, appendedSequences: [1] };
  });
  return startTransaction();
}

// --------------------------------------------------------------------------- //
// append：expected revision + store 分配 sequence + idempotency + causation 校验
// --------------------------------------------------------------------------- //

export function appendTutorSessionEventsV5(
  sessionId: string,
  expectedRevision: number,
  events: PendingV5Event[],
): { revision: number; appendedSequences: number[] } {
  if (!Array.isArray(events) || events.length === 0) {
    throw new TutorSessionEventStoreV5Error("VALIDATION_FAILED", "events must be a non-empty array");
  }
  const appendTransaction = db.transaction((): { revision: number; appendedSequences: number[] } => {
    const session = requireV5SessionRow(sessionId);
    if (session.revision !== expectedRevision) {
      throw new TutorSessionEventStoreV5Error(
        "REVISION_CONFLICT",
        `expected revision ${expectedRevision} but session is at ${session.revision}`,
      );
    }
    const existingMax = maxSequenceFor(sessionId);
    if (existingMax === 0) {
      throw new TutorSessionEventStoreV5Error(
        "VALIDATION_FAILED",
        `session ${sessionId} has no session_started event; use startTutorSessionV5`,
      );
    }
    const recordedAt = nowIso();
    const nextRevision = expectedRevision + 1;
    // 复验修复 #2：折叠校验基线 = 从已提交历史纯折叠出的当前 state（同一
    // reducer；MVP 会话事件量有界，逐 append 全量折叠是 fail closed 的代价）。
    // 历史本身损坏时此处即 fail closed——不在损坏流上继续堆事实。
    let candidateState = foldCommittedV5Events(readTutorSessionEventsV5(sessionId));
    const appended: number[] = [];
    let sequence = existingMax;
    events.forEach((event, index) => {
      sequence += 1;
      if (event.event_type === "session_started") {
        throw new TutorSessionEventStoreV5Error(
          "SESSION_ALREADY_STARTED",
          `event at position ${index}: session_started can only be written by startTutorSessionV5`,
        );
      }
      if (V5_CAUSATION_REQUIRED.has(event.event_type as V5EventType) && event.causation_sequence === undefined) {
        throw new TutorSessionEventStoreV5Error(
          "VALIDATION_FAILED",
          `event at position ${index}: event_type=${event.event_type} requires causation_sequence`,
        );
      }
      // v5 kernel 强化（相对 v2 store 的「不做跨事件引用校验」）：
      // causation 只能指向已提交或同批更早的 sequence。
      if (
        event.causation_sequence !== undefined &&
        (event.causation_sequence < 1 || event.causation_sequence > sequence - 1)
      ) {
        throw new TutorSessionEventStoreV5Error(
          "CAUSATION_REF_INVALID",
          `event at position ${index}: causation_sequence=${event.causation_sequence} does not reference a committed or earlier-in-batch event (max valid: ${sequence - 1})`,
        );
      }
      const idempotencyKey = event.idempotency_key ?? `${sessionId}:${sequence}`;
      const canonical = canonicalizeV5Event(sessionId, event, sequence, nextRevision, idempotencyKey);
      if (!canonical.ok) {
        throw new TutorSessionEventStoreV5Error(
          "VALIDATION_FAILED",
          `event at position ${index}: ${canonical.errors.join("; ")}`,
        );
      }
      // 复验修复 #2：候选事件在落库前先经同一 reducer 纯折叠——reducer 拒绝
      // （RuntimeStateReducerV5Error）则异常逃逸事务，整批回滚，任何行都
      // 未写入。错误原样透传（语义家族见 TutorSessionEventV5），不吞码。
      candidateState = applyV5Event(candidateState, canonical.record as unknown as StoredV5Event);
      insertEventRow(sessionId, sequence, event, idempotencyKey, nextRevision, recordedAt, event.causation_sequence);
      appended.push(sequence);
    });
    bumpRevisionStatement.run(sessionId);
    return { revision: nextRevision, appendedSequences: appended };
  });
  return appendTransaction();
}

// --------------------------------------------------------------------------- //
// 读取（只读组装；深度完整性校验在 RuntimeStateRebuilderV5 fail closed）
// --------------------------------------------------------------------------- //

/** 原始行读取（payload_json 不解析）——rebuilder 损坏检测的输入。 */
export function readRawTutorSessionEventRowsV5(sessionId: string): RawV5EventRow[] {
  const session = getTutorSessionV5(sessionId);
  if (!session) {
    throw new TutorSessionEventStoreV5Error("SESSION_NOT_FOUND", `unknown session: ${sessionId}`);
  }
  return listRawRowsStatement.all(sessionId) as RawV5EventRow[];
}

/** canonical 全形状读取（replay / 在线 kernel 折叠输入）。payload_json 解析失败会抛
 *  SyntaxError——需要 fail closed 分类时用 readRawTutorSessionEventRowsV5 + rebuilder。 */
export function readTutorSessionEventsV5(sessionId: string): StoredV5Event[] {
  return readRawTutorSessionEventRowsV5(sessionId).map((row) => ({
    schema: V5_EVENT_SCHEMA_CONST,
    session_id: sessionId,
    sequence: row.sequence,
    state_revision: row.recorded_revision,
    occurred_at: row.occurred_at,
    event_type: row.event_type as V5EventType,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    ...(row.causation_sequence !== null ? { causation_sequence: row.causation_sequence } : {}),
    idempotency_key: row.idempotency_key,
  }));
}

/** 会话当前 revision（在线 kernel 乐观并发的读取端）。 */
export function tutorSessionRevisionV5(sessionId: string): number {
  return requireV5SessionRow(sessionId).revision;
}
