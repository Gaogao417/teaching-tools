/**
 * RuntimeStateRebuilder（F2 — Event / Revision / Replay 内核）。
 *
 * 对应 09-target-architecture 的 TutorRuntimeStateRebuilder 抽象：
 * `Pinned Plan（session pin）+ TutorSessionEvent[] → TutorRuntimeState`。
 * 只在启动 / 恢复 / 对账时使用（在线主链不经此）。
 *
 * Fail closed 规则（f2-scope-ledger 负例义务；未知损坏不得默认跳过/部分重建）：
 * - SCHEMA_ISOLATION：会话行 event_schema ≠ v5；
 * - MISSING_SESSION_START：流为空或首事件不是 session_started；
 * - EVENT_GAP：sequence 必须从 1 起连续（跳号=存储损坏）；
 * - CORRUPT_EVENT：payload_json 非法 JSON，或组装后过不了 canonical v5 Zod；
 * - REVISION_INCONSISTENT：recorded_revision 违反 store 的精确分配语义
 *   （首事件必须为 1；其后每条只能与前一事件同批同值或恰 +1 开新批；
 *   流末事件必须等于会话行 revision——2026-08-29 复验修复 #3：原先只查
 *   非递减，session revision=1 时注入 recorded_revision=99 可通过并重建出
 *   state_revision=99）；
 * - HASH_MISMATCH：会话行 TP pin（artifact_id/version/content_hash）与
 *   session_started payload 不符，或调用方 expectedPin 与事件流 pin 不符；
 * - REDUCER_INVARIANT：折叠结果过不了 canonical state/v1 校验（防御性收口）。
 */
import { tutorRuntimeStateV1Schema, tutorSessionEventV5Schema } from "../../../../shared/canonical";
import {
  TutorSessionIntegrityError,
  V5_EVENT_SCHEMA_CONST,
  type RawV5EventRow,
  type StoredV5Event,
  type V5ArtifactRefLike,
  type V5SessionStartedPayload,
} from "./TutorSessionEventV5";
import { foldCommittedV5Events, type TutorRuntimeStateV5 } from "./TutorRuntimeStateReducerV5";
import {
  getTutorSessionV5,
  readRawTutorSessionEventRowsV5,
  type SessionRowV5,
} from "./TutorSessionEventStoreV5";

export interface RebuildV5Options {
  /** 恢复方声明的期望 TP pin（artifact_id/version/content_hash 三元组对账）。 */
  expectedTutorPlanRef?: V5ArtifactRefLike;
  /** 从指定 sequence 之后截断重建（默认全量；对账/调试用）。 */
  throughSequence?: number;
}

export interface VerifiedCommittedStream {
  session: SessionRowV5;
  events: StoredV5Event[];
  sessionStartedPayload: V5SessionStartedPayload;
}

function parseRowPayload(row: RawV5EventRow, index: number): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload is not a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TutorSessionIntegrityError(
      "CORRUPT_EVENT",
      `sequence ${row.sequence} (row ${index}): payload_json is not valid JSON (${reason})`,
      row.sequence,
    );
  }
}

/** 逐行组装 canonical v5 形状并做 Zod 判定（corruption fail closed）。 */
function assembleCanonicalEvent(sessionId: string, row: RawV5EventRow, index: number): StoredV5Event {
  const candidate: Record<string, unknown> = {
    schema: V5_EVENT_SCHEMA_CONST,
    session_id: sessionId,
    sequence: row.sequence,
    state_revision: row.recorded_revision,
    occurred_at: row.occurred_at,
    event_type: row.event_type,
    payload: parseRowPayload(row, index),
    idempotency_key: row.idempotency_key,
  };
  if (row.causation_sequence !== null) {
    candidate.causation_sequence = row.causation_sequence;
  }
  const result = tutorSessionEventV5Schema.safeParse(candidate);
  if (!result.success) {
    throw new TutorSessionIntegrityError(
      "CORRUPT_EVENT",
      `sequence ${row.sequence} (row ${index}) fails canonical v5 validation: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
      row.sequence,
    );
  }
  return result.data as StoredV5Event;
}

/**
 * 读取并完整校验 committed 事件流（gap / corruption / revision 单调 / pin 对账）。
 * 返回 canonical 事件数组（reducer 与对账工具共用的输入）。
 */
export function verifyCommittedStreamV5(sessionId: string, options?: RebuildV5Options): VerifiedCommittedStream {
  const session = getTutorSessionV5(sessionId);
  if (!session) {
    throw new TutorSessionIntegrityError("SESSION_NOT_FOUND", `unknown session: ${sessionId}`);
  }
  if (session.event_schema !== "v5") {
    throw new TutorSessionIntegrityError(
      "SCHEMA_ISOLATION",
      `session ${sessionId} uses ${session.event_schema} contract; v5 rebuild requires event_schema=v5`,
    );
  }
  const rawRows = readRawTutorSessionEventRowsV5(sessionId);
  if (rawRows.length === 0 || rawRows[0].event_type !== "session_started") {
    throw new TutorSessionIntegrityError(
      "MISSING_SESSION_START",
      `session ${sessionId} has ${rawRows.length} events and/or does not start with session_started`,
    );
  }

  const events: StoredV5Event[] = [];
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
      throw new TutorSessionIntegrityError(
        "EVENT_GAP",
        `expected sequence ${index + 1} at row ${index} but found ${row.sequence}（gap/corruption：不得跳号重建）`,
        row.sequence,
      );
    }
    const revisionAllowed = index === 0 ? row.recorded_revision === 1 : row.recorded_revision === lastRevision || row.recorded_revision === lastRevision + 1;
    if (!revisionAllowed) {
      throw new TutorSessionIntegrityError(
        "REVISION_INCONSISTENT",
        `sequence ${row.sequence} (row ${index}): recorded_revision ${row.recorded_revision} violates exact allocation (${index === 0 ? "first event must be 1" : `must be ${lastRevision} (same batch) or ${lastRevision + 1} (next batch)`})`,
        row.sequence,
      );
    }
    lastRevision = row.recorded_revision;
    events.push(assembleCanonicalEvent(sessionId, row, index));
  });
  const lastRow = rawRows[rawRows.length - 1];
  if (lastRow.recorded_revision !== session.revision) {
    throw new TutorSessionIntegrityError(
      "REVISION_INCONSISTENT",
      `last event (sequence ${lastRow.sequence}) recorded_revision ${lastRow.recorded_revision} does not match session row revision ${session.revision}`,
      lastRow.sequence,
    );
  }

  const sessionStartedPayload = events[0].payload as unknown as V5SessionStartedPayload;
  const rowPin: V5ArtifactRefLike = {
    artifact_id: session.plan_artifact_id,
    version: session.plan_version,
    content_hash: session.plan_content_hash,
  };
  if (
    rowPin.artifact_id !== sessionStartedPayload.tutor_plan_ref.artifact_id ||
    rowPin.version !== sessionStartedPayload.tutor_plan_ref.version ||
    rowPin.content_hash !== sessionStartedPayload.tutor_plan_ref.content_hash
  ) {
    throw new TutorSessionIntegrityError(
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
      throw new TutorSessionIntegrityError(
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
 * 重建 TutorRuntimeState：Pinned Plan（session pin）+ 有序 committed events
 * → 同一领域 reducer（foldCommittedV5Events）→ canonical state/v1 校验。
 */
export function rebuildTutorRuntimeStateV5(sessionId: string, options?: RebuildV5Options): TutorRuntimeStateV5 {
  const { events } = verifyCommittedStreamV5(sessionId, options);
  const state = foldCommittedV5Events(events);
  const canonical = tutorRuntimeStateV1Schema.safeParse(state);
  if (!canonical.success) {
    throw new TutorSessionIntegrityError(
      "CORRUPT_EVENT",
      `rebuilt state fails canonical state/v1 validation: ${canonical.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
      events[events.length - 1]?.sequence,
    );
  }
  return state;
}
