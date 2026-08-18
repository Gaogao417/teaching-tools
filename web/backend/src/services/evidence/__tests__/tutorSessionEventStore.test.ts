/**
 * P1-07/P1-08：tutor_sessions / tutor_session_events 表 + append revision/idempotency。
 * 退出门禁 4：event store 抵御重复 append 与 revision conflict（双向测试）。
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import * as path from "node:path";

const sqlitePath = path.resolve(process.cwd(), ".tutor-session-event-store.test.sqlite");
if (existsSync(sqlitePath)) rmSync(sqlitePath, { force: true });
process.env.SQLITE_PATH = sqlitePath;

const { db } = require("../../../db/database") as typeof import("../../../db/database");
const store = require("../tutorSessionEventStore") as typeof import("../tutorSessionEventStore");
const {
  TutorSessionEventStoreError,
  appendTutorSessionEvents,
  getTutorSession,
  readTutorSessionEvents,
  startTutorSession,
} = store;

type PendingEvent = import("../tutorSessionEventStore").PendingTutorSessionEvent;

function revisionOf(sessionId: string): number {
  const session = getTutorSession(sessionId);
  assert.ok(session, `session ${sessionId} missing`);
  return session.revision as number;
}

const PLAN = {
  artifact_id: "TP-SMV-001",
  version: "v1",
  content_hash: "sha256:0712c3d4e5f60718293a4b5c6d7e8f9012345678901234567890abcdefab0123",
};

function bootEvent(): PendingEvent {
  return {
    event_type: "session_started",
    payload: { plan: PLAN },
    occurred_at: "2026-08-18T09:00:00Z",
  };
}

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main(): Promise<void> {
  await runTest("tables exist (P1-07)", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tutor_sessions','tutor_session_events')",
      )
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      tables.map((table) => table.name).sort(),
      ["tutor_session_events", "tutor_sessions"],
    );
    const eventColumns = db.prepare("PRAGMA table_info(tutor_session_events)").all() as Array<{
      name: string;
    }>;
    for (const column of [
      "session_id",
      "sequence",
      "event_type",
      "payload_json",
      "occurred_at",
      "idempotency_key",
    ]) {
      assert.ok(eventColumns.some((column_) => column_.name === column), column);
    }
  });

  await runTest("start + append assigns sequences and bumps revision", () => {
    startTutorSession({ sessionId: "TS-9001", studentId: "student-001", plan: PLAN });
    const result = appendTutorSessionEvents("TS-9001", 0, [bootEvent()]);
    assert.equal(result.revision, 1);
    assert.deepEqual(result.appendedSequences, [1]);
    const result2 = appendTutorSessionEvents("TS-9001", 1, [
      {
        event_type: "student_utterance_recorded",
        payload: { input_kind: "reasoning_utterance", text: "AD=AE 因为翻折" },
        occurred_at: "2026-08-18T09:00:05Z",
      },
      {
        event_type: "reasoning_aligned",
        payload: { alignment: "expected_checkpoint", checkpoint_id: "CP1" },
        occurred_at: "2026-08-18T09:00:07Z",
      },
      {
        event_type: "hint_issued",
        payload: { checkpoint_id: "CP1", level: 1 },
        occurred_at: "2026-08-18T09:00:10Z",
      },
    ]);
    assert.equal(result2.revision, 2);
    assert.deepEqual(result2.appendedSequences, [2, 3, 4]);
    const events = readTutorSessionEvents("TS-9001");
    assert.equal(events.length, 4);
    assert.deepEqual(
      events.map((event: { sequence: number }) => event.sequence),
      [1, 2, 3, 4],
    );
    assert.equal(events[3].event_type, "hint_issued");
    assert.deepEqual((events[3].payload as { level: number }).level, 1);
    assert.equal(revisionOf("TS-9001"), 2);
  });

  await runTest("stale expectedRevision is rejected (revision conflict)", () => {
    // 用旧 revision 重放已完成批次 → 拒绝且不产生新行
    const before = readTutorSessionEvents("TS-9001").length;
    assert.throws(
      () => appendTutorSessionEvents("TS-9001", 0, [bootEvent()]),
      (error: unknown) =>
        error instanceof TutorSessionEventStoreError && error.code === "REVISION_CONFLICT",
    );
    assert.equal(readTutorSessionEvents("TS-9001").length, before);
    // 未来 revision 同样拒绝
    assert.throws(
      () => appendTutorSessionEvents("TS-9001", 99, [bootEvent()]),
      (error: unknown) =>
        error instanceof TutorSessionEventStoreError && error.code === "REVISION_CONFLICT",
    );
  });

  await runTest("duplicate idempotency key is rejected and batch rolls back", () => {
    startTutorSession({ sessionId: "TS-9002", studentId: "student-002", plan: PLAN });
    const first = appendTutorSessionEvents("TS-9002", 0, [
      { ...bootEvent(), idempotency_key: "TS-9002:boot:1" },
    ]);
    assert.equal(first.revision, 1);
    // 重试同一批次（同 key、revision 已正确）→ DUPLICATE_EVENT，整批回滚
    assert.throws(
      () =>
        appendTutorSessionEvents("TS-9002", 1, [
          {
            event_type: "tutor_narrated",
            payload: { segment_id: "seg-1" },
            occurred_at: "2026-08-18T09:01:00Z",
            idempotency_key: "TS-9002:boot:1",
          },
        ]),
      (error: unknown) =>
        error instanceof TutorSessionEventStoreError && error.code === "DUPLICATE_EVENT",
    );
    // 回滚检查：没有新事件、revision 没变
    assert.equal(readTutorSessionEvents("TS-9002").length, 1);
    assert.equal(revisionOf("TS-9002"), 1);
  });

  await runTest("server-derived idempotency keys are unique per session:sequence", () => {
    startTutorSession({ sessionId: "TS-9003", studentId: "student-003", plan: PLAN });
    appendTutorSessionEvents("TS-9003", 0, [bootEvent()]);
    // 未显式带 key 的批次由 store 派生 <session>:<sequence>，跨批次严格递增不碰撞；
    // 因此「同一逻辑批次重放」总是先撞 revision（上一测试）或在带自定义 key 时撞
    // 幂等键（TS-9002 测试）——不存在静默重复写入路径。
    appendTutorSessionEvents("TS-9003", 1, [
      {
        event_type: "student_utterance_recorded",
        payload: { input_kind: "reasoning_utterance", text: "再试一次" },
        occurred_at: "2026-08-18T09:02:00Z",
      },
    ]);
    const events = readTutorSessionEvents("TS-9003");
    assert.deepEqual(
      events.map((event: { idempotency_key: string }) => event.idempotency_key),
      ["TS-9003:1", "TS-9003:2"],
    );
    const keys = new Set(events.map((event: { idempotency_key: string }) => event.idempotency_key));
    assert.equal(keys.size, events.length);
    // 显式 key 不得伪装成已存在的派生 key 重放
    assert.throws(
      () =>
        appendTutorSessionEvents("TS-9003", 2, [
          { ...bootEvent(), idempotency_key: "TS-9003:1" },
        ]),
      (error: unknown) =>
        error instanceof TutorSessionEventStoreError && error.code === "DUPLICATE_EVENT",
    );
    assert.equal(readTutorSessionEvents("TS-9003").length, 2);
  });

  await runTest("non-canonical event payloads are rejected (fail closed)", () => {
    startTutorSession({ sessionId: "TS-9004", studentId: "student-004", plan: PLAN });
    // hint_issued 缺 level；event_type 非法
    assert.throws(
      () =>
        appendTutorSessionEvents("TS-9004", 0, [
          {
            event_type: "hint_issued",
            payload: { checkpoint_id: "CP1" },
            occurred_at: "2026-08-18T09:00:00Z",
          },
        ]),
      (error: unknown) =>
        error instanceof TutorSessionEventStoreError && error.code === "VALIDATION_FAILED",
    );
    assert.throws(
      () =>
        appendTutorSessionEvents("TS-9004", 0, [
          {
            event_type: "not_a_real_event",
            payload: {},
            occurred_at: "2026-08-18T09:00:00Z",
          },
        ]),
      (error: unknown) =>
        error instanceof TutorSessionEventStoreError && error.code === "VALIDATION_FAILED",
    );
    assert.throws(
      () => appendTutorSessionEvents("TS-9004", 0, []),
      (error: unknown) =>
        error instanceof TutorSessionEventStoreError && error.code === "VALIDATION_FAILED",
    );
    assert.equal(readTutorSessionEvents("TS-9004").length, 0);
  });

  await runTest("unknown session append is rejected", () => {
    assert.throws(
      () => appendTutorSessionEvents("TS-9999", 0, [bootEvent()]),
      (error: unknown) =>
        error instanceof TutorSessionEventStoreError && error.code === "SESSION_NOT_FOUND",
    );
  });

  await runTest("batch is atomic: failure at position N rolls back earlier events", () => {
    startTutorSession({ sessionId: "TS-9005", studentId: "student-005", plan: PLAN });
    assert.throws(
      () =>
        appendTutorSessionEvents("TS-9005", 0, [
          {
            event_type: "tutor_narrated",
            payload: { segment_id: "seg-1" },
            occurred_at: "2026-08-18T09:00:00Z",
          },
          {
            event_type: "student_self_corrected",
            payload: { checkpoint_id: "CP1" },
            occurred_at: "2026-08-18T09:00:01Z",
          },
        ]),
      (error: unknown) =>
        error instanceof TutorSessionEventStoreError && error.code === "VALIDATION_FAILED",
    );
    assert.equal(readTutorSessionEvents("TS-9005").length, 0);
    assert.equal(revisionOf("TS-9005"), 0);
  });

  await runTest("event store module issues no UPDATE/DELETE against tutor_session_events (append-only)", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/services/evidence/tutorSessionEventStore.ts"),
      "utf8",
    );
    for (const statement of ["UPDATE tutor_session_events", "DELETE FROM tutor_session_events", "DROP TABLE"]) {
      assert.ok(!source.includes(statement), `append-only violated: ${statement}`);
    }
    assert.ok(source.includes("INSERT INTO tutor_session_events"));
  });

  db.close();
  rmSync(sqlitePath, { force: true });
}

void main().catch((error) => {
  console.error("FAIL tutorSessionEventStore", error);
  db.close();
  throw error;
});
