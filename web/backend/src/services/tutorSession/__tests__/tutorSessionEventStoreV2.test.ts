/**
 * P5-01：v2 事件合同 store 语义测试（state_revision 盖章 / causation 必填 /
 * v1-v2 合同隔离 / canonical 校验 fail closed / 老 v1 会话继续可读）。
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import * as path from "node:path";

import { ensureSqlite } from "./support";

const sqlitePath = ensureSqlite("tutor-session-event-store-v2");

const { db } = require("../../../db/database") as typeof import("../../../db/database");
const store = require("../TutorSessionEventStore") as typeof import("../TutorSessionEventStore");

function revisionOf(sessionId: string): number {
  const session = store.getTutorSession(sessionId) as { revision: number } | undefined;
  return session?.revision ?? -1;
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
  const plan = { artifact_id: "TP-SMV-001", version: "v2", content_hash: "sha256:" + "a".repeat(64) };
  const at = () => new Date().toISOString();

  await runTest("v2 session appends stamp state_revision = post-commit revision", () => {
    store.startTutorSession({ sessionId: "TS-9101", studentId: "s", plan, eventSchema: "v2" });
    const first = store.appendTutorSessionEventsV2("TS-9101", 0, [
      { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
    ]);
    assert.equal(first.revision, 1);
    const second = store.appendTutorSessionEventsV2("TS-9101", 1, [
      { event_type: "student_input_recorded", payload: { input_kind: "reasoning_utterance", text: "看等角" }, occurred_at: at() },
      {
        event_type: "reasoning_aligned",
        payload: { alignment: "expected_checkpoint", checkpoint_id: "CP1" },
        occurred_at: at(),
        causation_sequence: 2,
      },
    ]);
    assert.equal(second.revision, 2);
    assert.deepEqual(second.appendedSequences, [2, 3]);
    const events = store.readTutorSessionEventsV2("TS-9101");
    assert.equal(events.length, 3);
    assert.deepEqual(
      events.map((event) => [event.sequence, event.state_revision]),
      [[1, 1], [2, 2], [3, 2]],
      "同批事件共享提交后 state_revision",
    );
    assert.equal(events[2].causation_sequence, 2);
    assert.equal(events[0].schema, "ai_teaching_tutor_session_event/v2");
  });

  await runTest("v2 append enforces causation_sequence on required event types", () => {
    store.startTutorSession({ sessionId: "TS-9102", studentId: "s", plan, eventSchema: "v2" });
    store.appendTutorSessionEventsV2("TS-9102", 0, [
      { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
    ]);
    assert.throws(
      () =>
        store.appendTutorSessionEventsV2("TS-9102", 1, [
          {
            event_type: "tutor_move_decided",
            payload: {
              decision_id: "TD-TS-9102-1",
              move_type: "hint",
              purpose_code: "hint.escalate",
              policy_version: "tutor-policy-deterministic-rules/v1",
              source_event_sequence: 1,
              source_state_revision: 1,
              checkpoint_id: "CP1",
              assistance_level: 1,
            },
            occurred_at: at(),
          },
        ]),
      (error: unknown) =>
        error instanceof store.TutorSessionEventStoreError && error.code === "VALIDATION_FAILED",
    );
  });

  await runTest("v2 append validates canonical payloads (invalid hint move rejected)", () => {
    store.startTutorSession({ sessionId: "TS-9103", studentId: "s", plan, eventSchema: "v2" });
    store.appendTutorSessionEventsV2("TS-9103", 0, [
      { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
    ]);
    assert.throws(
      () =>
        store.appendTutorSessionEventsV2("TS-9103", 1, [
          {
            event_type: "tutor_move_decided",
            payload: {
              decision_id: "TD-TS-9103-1",
              move_type: "hint",
              // 缺 assistance_level / checkpoint_id → canonical superRefine 拒绝
              purpose_code: "hint.escalate",
              policy_version: "tutor-policy-deterministic-rules/v1",
              source_event_sequence: 1,
              source_state_revision: 1,
            },
            occurred_at: at(),
            causation_sequence: 1,
          },
        ]),
      (error: unknown) =>
        error instanceof store.TutorSessionEventStoreError && error.code === "VALIDATION_FAILED",
    );
    assert.equal(store.readTutorSessionEventsV2("TS-9103").length, 1);
  });

  await runTest("contract isolation: v2 append rejected on v1 session and vice versa", () => {
    store.startTutorSession({ sessionId: "TS-9104", studentId: "s", plan, eventSchema: "v1" });
    assert.throws(
      () =>
        store.appendTutorSessionEventsV2("TS-9104", 0, [
          { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
        ]),
      (error: unknown) =>
        error instanceof store.TutorSessionEventStoreError && error.code === "VALIDATION_FAILED",
    );
    store.startTutorSession({ sessionId: "TS-9105", studentId: "s", plan, eventSchema: "v2" });
    assert.throws(
      () =>
        store.appendTutorSessionEvents("TS-9105", 0, [
          { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
        ]),
      (error: unknown) =>
        error instanceof store.TutorSessionEventStoreError && error.code === "VALIDATION_FAILED",
    );
  });

  await runTest("optimistic concurrency and idempotency keep v1 semantics on v2 path", () => {
    store.startTutorSession({ sessionId: "TS-9106", studentId: "s", plan, eventSchema: "v2" });
    store.appendTutorSessionEventsV2("TS-9106", 0, [
      { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
    ]);
    assert.throws(
      () =>
        store.appendTutorSessionEventsV2("TS-9106", 0, [
          {
            event_type: "student_input_recorded",
            payload: { input_kind: "silence_observed", duration_ms: 3000 },
            occurred_at: at(),
          },
        ]),
      (error: unknown) =>
        error instanceof store.TutorSessionEventStoreError && error.code === "REVISION_CONFLICT",
    );
    assert.throws(
      () =>
        store.appendTutorSessionEventsV2("TS-9106", 1, [
          {
            event_type: "student_input_recorded",
            payload: { input_kind: "silence_observed", duration_ms: 3000 },
            occurred_at: at(),
            idempotency_key: "TS-9106:1",
          },
        ]),
      (error: unknown) =>
        error instanceof store.TutorSessionEventStoreError && error.code === "DUPLICATE_EVENT",
    );
    assert.equal(revisionOf("TS-9106"), 1);
  });

  await runTest("legacy v1 session remains readable (gate 6：老 session 继续可恢复)", () => {
    store.startTutorSession({ sessionId: "TS-9107", studentId: "s", plan, eventSchema: "v1" });
    store.appendTutorSessionEvents("TS-9107", 0, [
      {
        event_type: "session_started",
        payload: { plan },
        occurred_at: at(),
      },
      {
        event_type: "hint_issued",
        payload: { checkpoint_id: "CP1", level: 1 },
        occurred_at: at(),
      },
    ]);
    const legacy = store.readTutorSessionEvents("TS-9107");
    assert.equal(legacy.length, 2);
    assert.deepEqual(legacy.map((event) => event.event_type), ["session_started", "hint_issued"]);
    const row = store.getTutorSession("TS-9107") as { event_schema: string };
    assert.equal(row.event_schema, "v1");
  });

  db.close();
  if (existsSync(sqlitePath)) rmSync(sqlitePath, { force: true });
}

void main().catch((error) => {
  console.error("FAIL tutorSessionEventStoreV2", error);
  db.close();
  if (existsSync(sqlitePath)) rmSync(sqlitePath, { force: true });
  throw error;
});
console.log(`(sqlite: ${path.basename(sqlitePath)})`);
