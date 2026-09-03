/**
 * TutorSessionEventStore v5（F2 — Event / Revision / Replay 内核）。
 *
 * F7 Step 2（PLAN.md）：SQLite append/revision/idempotency/causation 事务逻辑
 * 已抽成按 codec 注入的版本无关内核（kernel/TutorSessionStoreCore.ts）；本文件
 * 是 v5 codec 装配 + 薄委托层——**导出面与语义逐字保留**（V5 消费者与测试零
 * 改动，行为不变由既有测试全绿锁定）。
 *
 * 复用现有 SQLite 表（f0 dependency ledger §2.1：`tutor_sessions` /
 * `tutor_session_events` 的 PK(session_id,sequence)、UNIQUE idempotency_key、
 * causation_sequence、recorded_revision、`tutor_sessions.event_schema` 列均已
 * 存在——F2 无 DDL 变更，只登记 event_schema='v5' 写入纪律）。本模块对事件表
 * 只发 INSERT/SELECT（append-only 结构性自证，与 v1–v4 store 同规则）。
 *
 * Append 语义（f2-scope-ledger，实现于 core）：
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
 *   VALIDATION_FAILED（含 v5 会话与 v1–v4/v6 会话的合同隔离）；
 * - reducer 折叠校验先于持久化生效：事务内把「已提交历史 + 候选 canonical 批」
 *   先纯折叠（applyV5Event，与在线/重建同一 reducer）；reducer 拒绝
 *   （RuntimeStateReducerV5Error）则异常逃逸事务 ⇒ 整批回滚不落库；
 * - 一次 append 一个事务：整批成功或整批失败，成功后 session revision +1，
 *   批内事件共享提交后 state_revision（与 v1–v4 envelope 同构）。
 */
import type { SessionKernelCodec } from "./kernel/sessionKernelCodec";
import {
  appendSessionEvents,
  getSessionRow,
  nextSessionSequence,
  readRawSessionEventRows,
  readSessionEvents,
  sessionRevision,
  startSession,
} from "./kernel/TutorSessionStoreCore";
import { tutorRuntimeStateV1Schema, tutorSessionEventV5Schema } from "../../../../shared/canonical";
import {
  applyV5Event,
  foldCommittedV5Events,
  initialStateFromSessionStarted,
  type TutorRuntimeStateV5,
} from "./TutorRuntimeStateReducerV5";
import { compareTutorRuntimeStatesSemantically } from "./RuntimeStateSemanticComparatorV5";
import {
  TutorSessionEventStoreV5Error,
  TutorSessionIntegrityError,
  V5_CAUSATION_REQUIRED,
  V5_EVENT_SCHEMA_CONST,
  type PendingV5Event,
  type RawV5EventRow,
  type StoredV5Event,
  type V5IntegrityErrorCode,
  type V5SessionStartedPayload,
  type V5StoreErrorCode,
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

/** v5 codec：旧词表 + 旧 reducer 装进版本无关内核（行为与测试不变）。 */
export const V5_SESSION_CODEC: SessionKernelCodec<TutorRuntimeStateV5, undefined> = {
  eventSchemaColumn: "v5",
  eventSchemaConst: V5_EVENT_SCHEMA_CONST,
  causationRequired: V5_CAUSATION_REQUIRED as ReadonlySet<string>,
  storeSchemaMismatchCode: "VALIDATION_FAILED",
  integritySchemaMismatchCode: "SCHEMA_ISOLATION",
  makeStoreError: (code, message) => new TutorSessionEventStoreV5Error(code as V5StoreErrorCode, message),
  makeIntegrityError: (code, message, relatedSequence) =>
    new TutorSessionIntegrityError(code as V5IntegrityErrorCode, message, relatedSequence),
  eventEnvelopeSchema: tutorSessionEventV5Schema,
  stateSchema: tutorRuntimeStateV1Schema,
  applyEvent: (state, event) => applyV5Event(state, event as unknown as StoredV5Event),
  foldCommitted: (events) => foldCommittedV5Events(events as unknown as readonly StoredV5Event[]),
  initialStateFromSessionStarted: (event) => initialStateFromSessionStarted(event as unknown as StoredV5Event),
  resolveFoldContext: () => undefined,
  compareStates: compareTutorRuntimeStatesSemantically,
};

export function getTutorSessionV5(sessionId: string): SessionRowV5 | undefined {
  return getSessionRow(sessionId) as SessionRowV5 | undefined;
}

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
  return startSession(V5_SESSION_CODEC, input);
}

export function appendTutorSessionEventsV5(
  sessionId: string,
  expectedRevision: number,
  events: PendingV5Event[],
): { revision: number; appendedSequences: number[] } {
  return appendSessionEvents(V5_SESSION_CODEC, sessionId, expectedRevision, events);
}

/** 原始行读取（payload_json 不解析）——rebuilder 损坏检测的输入。 */
export function readRawTutorSessionEventRowsV5(sessionId: string): RawV5EventRow[] {
  return readRawSessionEventRows(V5_SESSION_CODEC, sessionId) as RawV5EventRow[];
}

/** canonical 全形状读取（replay / 在线 kernel 折叠输入）。payload_json 解析失败会抛
 *  SyntaxError——需要 fail closed 分类时用 readRawTutorSessionEventRowsV5 + rebuilder。 */
export function readTutorSessionEventsV5(sessionId: string): StoredV5Event[] {
  return readSessionEvents(V5_SESSION_CODEC, sessionId) as unknown as StoredV5Event[];
}

/** 会话下一个可用 sequence（调用方可作 expected sequence 校对；分配权仍在 store）。 */
export function nextTutorSessionSequenceV5(sessionId: string): number {
  return nextSessionSequence(sessionId);
}

/** 会话当前 revision（在线 kernel 乐观并发的读取端）。 */
export function tutorSessionRevisionV5(sessionId: string): number {
  return sessionRevision(V5_SESSION_CODEC, sessionId);
}
