/**
 * RuntimeStateRebuilder core（F7 Step 2 — 版本无关重建内核）。
 *
 * 从 RuntimeStateRebuilderV5 抽出的 fail closed 完整性校验，按 codec 注入：
 * - 版本隔离（V5 = SCHEMA_ISOLATION；V6 = SESSION_VERSION_UNSUPPORTED——spec
 *   §2.4：V6 client 恢复到 v5 会话返回 SESSION_VERSION_UNSUPPORTED）；
 * - MISSING_SESSION_START：流为空或首事件不是 session_started；
 * - EVENT_GAP：sequence 必须从 1 起连续（跳号=存储损坏）；
 * - CORRUPT_EVENT：payload_json 非法 JSON，或组装后过不了 canonical Zod；
 * - REVISION_INCONSISTENT：recorded_revision 违反 store 的精确分配语义
 *   （首事件必须为 1；其后每条只能与前一事件同批同值或恰 +1 开新批；
 *   流末事件必须等于会话行 revision）；
 * - HASH_MISMATCH：会话行 TP pin（artifact_id/version/content_hash）与
 *   session_started payload 不符，或调用方 expectedPin 与事件流 pin 不符；
 * - 折叠（codec.foldCommitted + fold context 从 session_started pin 重解析）与
 *   canonical 状态 Zod 收口。
 */
import type { SessionKernelCodec } from "./sessionKernelCodec";
import type {
  RawSessionEventRow,
  SessionRow,
  SessionStartedPinLike,
  StoredSessionEvent,
} from "./sessionKernelTypes";
import { getSessionRow, readRawSessionEventRows } from "./TutorSessionStoreCore";

export interface RebuildOptions {
  /** 恢复方声明的期望 TP pin（artifact_id/version/content_hash 三元组对账）。 */
  expectedTutorPlanRef?: SessionStartedPinLike["tutor_plan_ref"];
  /** 从指定 sequence 之后截断重建（默认全量；对账/调试用）。 */
  throughSequence?: number;
}

export interface VerifiedCommittedStream {
  session: SessionRow;
  events: StoredSessionEvent[];
  sessionStartedPayload: Record<string, unknown> & SessionStartedPinLike;
}

function parseRowPayload<S, C>(codec: SessionKernelCodec<S, C>, row: RawSessionEventRow, index: number): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload is not a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw codec.makeIntegrityError(
      "CORRUPT_EVENT",
      `sequence ${row.sequence} (row ${index}): payload_json is not valid JSON (${reason})`,
      row.sequence,
    );
  }
}

/** 逐行组装 canonical 形状并做 Zod 判定（corruption fail closed）。 */
function assembleCanonicalEvent<S, C>(codec: SessionKernelCodec<S, C>, sessionId: string, row: RawSessionEventRow, index: number): StoredSessionEvent {
  const candidate: Record<string, unknown> = {
    schema: codec.eventSchemaConst,
    session_id: sessionId,
    sequence: row.sequence,
    state_revision: row.recorded_revision,
    occurred_at: row.occurred_at,
    event_type: row.event_type,
    payload: parseRowPayload(codec, row, index),
    idempotency_key: row.idempotency_key,
  };
  if (row.causation_sequence !== null) {
    candidate.causation_sequence = row.causation_sequence;
  }
  const result = codec.eventEnvelopeSchema.safeParse(candidate);
  if (!result.success) {
    throw codec.makeIntegrityError(
      "CORRUPT_EVENT",
      `sequence ${row.sequence} (row ${index}) fails canonical validation: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
      row.sequence,
    );
  }
  return result.data;
}

/**
 * 读取并完整校验 committed 事件流（版本隔离 / gap / corruption / revision 单调 /
 * pin 对账）。返回 canonical 事件数组（reducer 与对账工具共用的输入）。
 */
export function verifyCommittedStream<S, C>(
  codec: SessionKernelCodec<S, C>,
  sessionId: string,
  options?: RebuildOptions,
): VerifiedCommittedStream {
  const session = getSessionRow(sessionId);
  if (!session) {
    throw codec.makeIntegrityError("SESSION_NOT_FOUND", `unknown session: ${sessionId}`);
  }
  if (session.event_schema !== codec.eventSchemaColumn) {
    throw codec.makeIntegrityError(
      codec.integritySchemaMismatchCode,
      `session ${sessionId} uses ${session.event_schema} contract; ${codec.eventSchemaColumn} rebuild requires event_schema=${codec.eventSchemaColumn}`,
    );
  }
  const rawRows = readRawSessionEventRows(codec, sessionId);
  if (rawRows.length === 0 || rawRows[0].event_type !== "session_started") {
    throw codec.makeIntegrityError(
      "MISSING_SESSION_START",
      `session ${sessionId} has ${rawRows.length} events and/or does not start with session_started`,
    );
  }

  const events: StoredSessionEvent[] = [];
  // revision 精确分配语义（镜像 store 写侧冻结规则：start 写会话行 revision=1 +
  // sequence 1 的 session_started@recorded_revision=1；此后每次 append 一个事务
  // = revision 恰 +1，批内事件共享提交后 revision，并同步 bump 会话行）：
  // - 首事件 recorded_revision 必须为 1；
  // - 其后每条只能等于前一事件（同批续批）或恰 +1（新批首事件），禁止跳跃/回退；
  // - 流末事件 recorded_revision 必须等于会话行 revision。
  // 任一违反均属 corruption 家族，fail closed。
  let lastRevision = 0;
  rawRows.forEach((row, index) => {
    if (row.sequence !== index + 1) {
      throw codec.makeIntegrityError(
        "EVENT_GAP",
        `expected sequence ${index + 1} at row ${index} but found ${row.sequence}（gap/corruption：不得跳号重建）`,
        row.sequence,
      );
    }
    const revisionAllowed = index === 0 ? row.recorded_revision === 1 : row.recorded_revision === lastRevision || row.recorded_revision === lastRevision + 1;
    if (!revisionAllowed) {
      throw codec.makeIntegrityError(
        "REVISION_INCONSISTENT",
        `sequence ${row.sequence} (row ${index}): recorded_revision ${row.recorded_revision} violates exact allocation (${index === 0 ? "first event must be 1" : `must be ${lastRevision} (same batch) or ${lastRevision + 1} (next batch)`})`,
        row.sequence,
      );
    }
    lastRevision = row.recorded_revision;
    events.push(assembleCanonicalEvent(codec, sessionId, row, index));
  });
  const lastRow = rawRows[rawRows.length - 1];
  if (lastRow.recorded_revision !== session.revision) {
    throw codec.makeIntegrityError(
      "REVISION_INCONSISTENT",
      `last event (sequence ${lastRow.sequence}) recorded_revision ${lastRow.recorded_revision} does not match session row revision ${session.revision}`,
      lastRow.sequence,
    );
  }

  const sessionStartedPayload = events[0].payload as Record<string, unknown> & SessionStartedPinLike;
  const rowPin: SessionStartedPinLike["tutor_plan_ref"] = {
    artifact_id: session.plan_artifact_id,
    version: session.plan_version,
    content_hash: session.plan_content_hash,
  };
  if (
    rowPin.artifact_id !== sessionStartedPayload.tutor_plan_ref.artifact_id ||
    rowPin.version !== sessionStartedPayload.tutor_plan_ref.version ||
    rowPin.content_hash !== sessionStartedPayload.tutor_plan_ref.content_hash
  ) {
    throw codec.makeIntegrityError(
      "HASH_MISMATCH",
      `session row pin ${rowPin.artifact_id}@${rowPin.version} does not match session_started tutor_plan_ref ${sessionStartedPayload.tutor_plan_ref.artifact_id}@${sessionStartedPayload.tutor_plan_ref.version}`,
    );
  }
  if (options?.expectedTutorPlanRef) {
    const expected = options.expectedTutorPlanRef;
    if (
      expected.artifact_id !== sessionStartedPayload.tutor_plan_ref.artifact_id ||
      expected.version !== sessionStartedPayload.tutor_plan_ref.version ||
      expected.content_hash !== sessionStartedPayload.tutor_plan_ref.content_hash
    ) {
      throw codec.makeIntegrityError(
        "HASH_MISMATCH",
        `expected pin ${expected.artifact_id}@${expected.version} does not match committed tutor_plan_ref ${sessionStartedPayload.tutor_plan_ref.artifact_id}@${sessionStartedPayload.tutor_plan_ref.version}`,
      );
    }
  }

  const throughSequence = options?.throughSequence;
  const effectiveEvents =
    throughSequence !== undefined ? events.filter((event) => event.sequence <= throughSequence) : events;
  return { session, events: effectiveEvents, sessionStartedPayload };
}

/**
 * 重建运行时状态：Pinned Plan（session pin）+ 有序 committed events
 * → 同一领域 reducer（codec.foldCommitted，fold context 从 session_started pin
 * 重解析）→ canonical 状态 Zod 收口。
 */
export function rebuildSessionState<S, C>(
  codec: SessionKernelCodec<S, C>,
  sessionId: string,
  options?: RebuildOptions,
): S {
  const { events } = verifyCommittedStream(codec, sessionId, options);
  const state = codec.foldCommitted(events, codec.resolveFoldContext(events[0].payload));
  const canonical = codec.stateSchema.safeParse(state);
  if (!canonical.success) {
    throw codec.makeIntegrityError(
      "CORRUPT_EVENT",
      `rebuilt state fails canonical state validation: ${canonical.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
      events[events.length - 1]?.sequence,
    );
  }
  return state;
}
