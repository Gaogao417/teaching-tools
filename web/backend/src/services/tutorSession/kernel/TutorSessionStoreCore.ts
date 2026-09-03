/**
 * TutorSessionEventStore core（F7 Step 2 — 版本无关存储内核）。
 *
 * 从 TutorSessionEventStoreV5 抽出的 SQLite append/revision/idempotency/causation
 * 事务逻辑，按 codec 注入（PLAN.md Step 2）。V5 行为逐条保留：
 * - session start 原子完成「行 pin（TP artifact_id/version/content_hash +
 *   event_schema 列值）+ sequence 1 的 session_started 事件（revision 0→1）」；
 *   session_started 只能经 start 写入，append 路径拒绝（SESSION_ALREADY_STARTED）；
 * - append 乐观并发：expectedRevision 与 session.revision 不符 → REVISION_CONFLICT；
 * - sequence 由 store 分配（当前最大值起严格 +1，批内递增）；
 * - idempotency_key 全局 UNIQUE：重复 → DUPLICATE_EVENT，整批回滚，不静默去重；
 * - causation 必带集 + 引用校验：只能指向已提交或同批更早 sequence
 *   → CAUSATION_REF_INVALID；
 * - 每条事件经 canonical Zod（codec 的 schema const 派发）→ VALIDATION_FAILED
 *   （含跨版本合同隔离，错误码由 codec.storeSchemaMismatchCode 决定）；
 * - reducer 预折叠先于持久化：事务内把「已提交历史 + 候选 canonical 批」先纯
 *   折叠（codec.foldCommitted/applyEvent，与在线/重建同一 reducer）；reducer
 *   拒绝则异常逃逸事务 ⇒ 整批回滚（「schema 合法但语义非法」不得毒化会话）；
 * - 一次 append 一个事务：整批成功或整批失败，成功后 revision +1，批内事件
 *   共享提交后 state_revision。
 *
 * fold context（V6 registry）在事务内每次从已提交 session_started pin 重解析
 * （codec.resolveFoldContext）——append 边界自证，不信任调用方缓存。
 */
import { db } from "../../../db/database";
import { validatePayload } from "../../../../../shared/canonical";
import type { SessionKernelCodec } from "./sessionKernelCodec";
import type {
  PendingSessionEvent,
  RawSessionEventRow,
  SessionRow,
  SessionStartedPinLike,
  StoredSessionEvent,
} from "./sessionKernelTypes";

export interface StartSessionInput {
  sessionId: string;
  studentId: string;
  /** canonical session_started payload（含全量 pin refs；行 pin 只读 tutor_plan_ref，
   *  全字段形状由 codec 的 canonical Zod 判定）。 */
  sessionStarted: SessionStartedPinLike;
  occurred_at: string;
  idempotency_key?: string;
}

const SESSION_ID_PATTERN = /^TS-[0-9]{4,}$/;

export function assertSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`invalid tutor session id: ${sessionId}（须匹配 ^TS-[0-9]{4,}$）`);
  }
}

const insertSessionStatement = db.prepare(`
  INSERT INTO tutor_sessions
    (session_id, student_id, plan_artifact_id, plan_version, plan_content_hash, current_mode, revision, started_at, event_schema)
  VALUES (?, ?, ?, ?, ?, 'teach', 1, ?, ?)`);

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

export function getSessionRow(sessionId: string): SessionRow | undefined {
  return getSessionStatement.get(sessionId) as SessionRow | undefined;
}

function requireSessionRow<S, C>(codec: SessionKernelCodec<S, C>, sessionId: string): SessionRow {
  const session = getSessionRow(sessionId);
  if (!session) {
    throw codec.makeStoreError("SESSION_NOT_FOUND", `unknown session: ${sessionId}`);
  }
  if (session.event_schema !== codec.eventSchemaColumn) {
    throw codec.makeStoreError(
      codec.storeSchemaMismatchCode,
      `session ${sessionId} uses ${session.event_schema} contract; ${codec.eventSchemaColumn} store requires event_schema=${codec.eventSchemaColumn}`,
    );
  }
  return session;
}

function maxSequenceFor(sessionId: string): number {
  const row = maxSequenceStatement.get(sessionId) as { max_sequence: number | null };
  return row.max_sequence ?? 0;
}

/** 会话下一个可用 sequence（调用方可作 expected sequence 校对；分配权仍在 store；
 *  与 V5 逐字同行为：不校验会话行，只读事件表 max+1）。 */
export function nextSessionSequence(sessionId: string): number {
  return maxSequenceFor(sessionId) + 1;
}

function mapUniqueViolation<S, C>(codec: SessionKernelCodec<S, C>, error: unknown, idempotencyKey: string): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNIQUE constraint failed: tutor_session_events.idempotency_key")) {
    return codec.makeStoreError("DUPLICATE_EVENT", `idempotency key already used: ${idempotencyKey}`);
  }
  if (message.includes("UNIQUE constraint failed: tutor_session_events.")) {
    return codec.makeStoreError(
      "DUPLICATE_EVENT",
      `duplicate event row (session/sequence/key already used): ${idempotencyKey}`,
    );
  }
  if (message.includes("UNIQUE constraint failed: tutor_sessions.session_id")) {
    return codec.makeStoreError("DUPLICATE_EVENT", `session already exists: ${idempotencyKey}`);
  }
  return error;
}

function insertEventRow<S, C>(
  codec: SessionKernelCodec<S, C>,
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
    throw mapUniqueViolation(codec, error, idempotencyKey);
  }
}

/** 组装 canonical 全形状记录并做 Zod 判定（ok=false 时带 canonical errors）。 */
function canonicalizeEvent<S, C>(
  codec: SessionKernelCodec<S, C>,
  sessionId: string,
  event: { event_type: string; payload: unknown; occurred_at: string; causation_sequence?: number },
  sequence: number,
  stateRevision: number,
  idempotencyKey: string,
): { ok: boolean; errors: readonly string[]; record: Record<string, unknown> } {
  const record: Record<string, unknown> = {
    schema: codec.eventSchemaConst,
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
 * 启动会话：一个事务内写 session 行（TP pin + event_schema 列值）与
 * sequence 1 的 session_started 事件。session_started payload 本身就是全量
 * pin 真源；行内 TP 三元组与之同源（同一 payload 字段），恢复期由 rebuilder 对账。
 */
export function startSession<S, C>(
  codec: SessionKernelCodec<S, C>,
  input: StartSessionInput,
): { revision: number; appendedSequences: number[] } {
  assertSessionId(input.sessionId);
  const startTransaction = db.transaction((): { revision: number; appendedSequences: number[] } => {
    if (getSessionRow(input.sessionId)) {
      throw codec.makeStoreError("DUPLICATE_EVENT", `session already exists: ${input.sessionId}`);
    }
    const idempotencyKey = input.idempotency_key ?? `${input.sessionId}:1`;
    const canonical = canonicalizeEvent(
      codec,
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
      throw codec.makeStoreError(
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
        codec.eventSchemaColumn,
      );
    } catch (error) {
      throw mapUniqueViolation(codec, error, input.sessionId);
    }
    insertEventRow(codec, input.sessionId, 1, {
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

export function appendSessionEvents<S, C>(
  codec: SessionKernelCodec<S, C>,
  sessionId: string,
  expectedRevision: number,
  events: PendingSessionEvent[],
): { revision: number; appendedSequences: number[] } {
  if (!Array.isArray(events) || events.length === 0) {
    throw codec.makeStoreError("VALIDATION_FAILED", "events must be a non-empty array");
  }
  const appendTransaction = db.transaction((): { revision: number; appendedSequences: number[] } => {
    const session = requireSessionRow(codec, sessionId);
    if (session.revision !== expectedRevision) {
      throw codec.makeStoreError(
        "REVISION_CONFLICT",
        `expected revision ${expectedRevision} but session is at ${session.revision}`,
      );
    }
    const existingMax = maxSequenceFor(sessionId);
    if (existingMax === 0) {
      throw codec.makeStoreError(
        "VALIDATION_FAILED",
        `session ${sessionId} has no session_started event; use startSession`,
      );
    }
    const recordedAt = nowIso();
    const nextRevision = expectedRevision + 1;
    // 折叠校验基线 = 从已提交历史纯折叠出的当前 state（同一 reducer；MVP 会话
    // 事件量有界，逐 append 全量折叠是 fail closed 的代价）。历史本身损坏时此处
    // 即 fail closed——不在损坏流上继续堆事实。fold context 从已提交
    // session_started pin 重解析（append 边界自证）。
    const committed = readSessionEvents(codec, sessionId);
    const foldContext = codec.resolveFoldContext(committed[0].payload);
    let candidateState = codec.foldCommitted(committed, foldContext);
    const appended: number[] = [];
    let sequence = existingMax;
    events.forEach((event, index) => {
      sequence += 1;
      if (event.event_type === "session_started") {
        throw codec.makeStoreError(
          "SESSION_ALREADY_STARTED",
          `event at position ${index}: session_started can only be written by startSession`,
        );
      }
      if (codec.causationRequired.has(event.event_type) && event.causation_sequence === undefined) {
        throw codec.makeStoreError(
          "VALIDATION_FAILED",
          `event at position ${index}: event_type=${event.event_type} requires causation_sequence`,
        );
      }
      // causation 只能指向已提交或同批更早的 sequence（跨事件引用范围校验；
      // 引用目标的事件类型/负载一致性由 reducer 跨事件门禁裁决）。
      if (
        event.causation_sequence !== undefined &&
        (event.causation_sequence < 1 || event.causation_sequence > sequence - 1)
      ) {
        throw codec.makeStoreError(
          "CAUSATION_REF_INVALID",
          `event at position ${index}: causation_sequence=${event.causation_sequence} does not reference a committed or earlier-in-batch event (max valid: ${sequence - 1})`,
        );
      }
      const idempotencyKey = event.idempotency_key ?? `${sessionId}:${sequence}`;
      const canonical = canonicalizeEvent(codec, sessionId, event, sequence, nextRevision, idempotencyKey);
      if (!canonical.ok) {
        throw codec.makeStoreError(
          "VALIDATION_FAILED",
          `event at position ${index}: ${canonical.errors.join("; ")}`,
        );
      }
      // 候选事件在落库前先经同一 reducer 纯折叠——reducer 拒绝（语义错误）则
      // 异常逃逸事务，整批回滚，任何行都未写入。错误原样透传，不吞码。
      candidateState = codec.applyEvent(candidateState, canonical.record as unknown as StoredSessionEvent, foldContext);
      insertEventRow(codec, sessionId, sequence, event, idempotencyKey, nextRevision, recordedAt, event.causation_sequence);
      appended.push(sequence);
    });
    bumpRevisionStatement.run(sessionId);
    return { revision: nextRevision, appendedSequences: appended };
  });
  return appendTransaction();
}

// --------------------------------------------------------------------------- //
// 读取（只读组装；深度完整性校验在 RuntimeStateRebuilderCore fail closed）
// --------------------------------------------------------------------------- //

/** 原始行读取（payload_json 不解析）——rebuilder 损坏检测的输入。 */
export function readRawSessionEventRows<S, C>(
  codec: SessionKernelCodec<S, C>,
  sessionId: string,
): RawSessionEventRow[] {
  const session = getSessionRow(sessionId);
  if (!session) {
    throw codec.makeStoreError("SESSION_NOT_FOUND", `unknown session: ${sessionId}`);
  }
  return listRawRowsStatement.all(sessionId) as RawSessionEventRow[];
}

/** canonical 全形状读取（replay / 在线 kernel 折叠输入）。payload_json 解析失败会抛
 *  SyntaxError——需要 fail closed 分类时用 readRawSessionEventRows + rebuilder。 */
export function readSessionEvents<S, C>(codec: SessionKernelCodec<S, C>, sessionId: string): StoredSessionEvent[] {
  return readRawSessionEventRows(codec, sessionId).map((row) => ({
    schema: codec.eventSchemaConst,
    session_id: sessionId,
    sequence: row.sequence,
    state_revision: row.recorded_revision,
    occurred_at: row.occurred_at,
    event_type: row.event_type,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    ...(row.causation_sequence !== null ? { causation_sequence: row.causation_sequence } : {}),
    idempotency_key: row.idempotency_key,
  }));
}

/** 会话当前 revision（在线 kernel 乐观并发的读取端）。 */
export function sessionRevision<S, C>(codec: SessionKernelCodec<S, C>, sessionId: string): number {
  return requireSessionRow(codec, sessionId).revision;
}
