/**
 * P5-01（Vitest 迁移版）：v2/v3 事件合同 store 语义测试——state_revision 盖章 /
 * causation 必填 / v1-v2/v3 合同隔离 / canonical 校验 fail closed /
 * 老 v1 会话继续可读；v3 增量字段往返。
 */
import { describe, expect, it } from "vitest";

import * as store from "../TutorSessionEventStore";
import type { V2EventPayload } from "../TutorSessionEvent";

const plan = { artifact_id: "TP-SMV-001", version: "v2", content_hash: `sha256:${"a".repeat(64)}` };
const at = () => new Date().toISOString();

function revisionOf(sessionId: string): number {
  const session = store.getTutorSession(sessionId) as { revision: number } | undefined;
  return session?.revision ?? -1;
}

function expectStoreError(fn: () => unknown, code: store.EventStoreErrorCode): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof store.TutorSessionEventStoreError)) {
    throw new Error(`expected TutorSessionEventStoreError, got ${String(thrown)}`);
  }
  expect(thrown.code).toBe(code);
}

describe("TutorSessionEventStore v2/v3", () => {
  it("v2 session appends stamp state_revision = post-commit revision", () => {
    store.startTutorSession({ sessionId: "TS-9101", studentId: "s", plan, eventSchema: "v2" });
    const first = store.appendTutorSessionEventsV2("TS-9101", 0, [
      { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
    ]);
    expect(first.revision).toBe(1);
    const second = store.appendTutorSessionEventsV2("TS-9101", 1, [
      { event_type: "student_input_recorded", payload: { input_kind: "reasoning_utterance", text: "看等角" }, occurred_at: at() },
      {
        event_type: "reasoning_aligned",
        payload: { alignment: "expected_checkpoint", checkpoint_id: "CP1" },
        occurred_at: at(),
        causation_sequence: 2,
      },
    ]);
    expect(second.revision).toBe(2);
    expect(second.appendedSequences).toEqual([2, 3]);
    const events = store.readTutorSessionEventsV2("TS-9101");
    expect(events.map((event) => [event.sequence, event.state_revision])).toEqual([[1, 1], [2, 2], [3, 2]]);
    expect(events[2].causation_sequence).toBe(2);
    expect(events[0].schema).toBe("ai_teaching_tutor_session_event/v2");
  });

  it("v3 session round-trips 智能链 provenance 增量字段", () => {
    store.startTutorSession({ sessionId: "TS-9151", studentId: "s", plan, eventSchema: "v3" });
    store.appendTutorSessionEventsV2("TS-9151", 0, [
      { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
    ]);
    store.appendTutorSessionEventsV2("TS-9151", 1, [
      {
        event_type: "student_input_recorded",
        payload: { input_kind: "reasoning_utterance", text: "看等角", client_turn_id: "turn-x-01" },
        occurred_at: at(),
      },
      {
        event_type: "reasoning_aligned",
        payload: {
          alignment: "alternate_valid",
          checkpoint_id: "CP2",
          route_id: "R2",
          confidence: 0.92,
          aligner_version: "aligner/v1",
          workflow_version: "graph/v1",
          grounding_refs: ["route.R2.entry"],
        },
        occurred_at: at(),
        causation_sequence: 2,
      },
      {
        event_type: "tutor_move_decided",
        payload: {
          decision_id: "TD-TS-9151-1",
          move_type: "prompt",
          purpose_code: "prompt.action_step",
          policy_version: "graph/v1",
          source_event_sequence: 3,
          source_state_revision: 1,
          checkpoint_id: "CP2",
          resource_ids: ["RES4"],
          model: "deepseek-v4-flash",
          workflow_version: "graph/v1",
          prompt_versions: ["a/v1", "b/v1"],
          voice_source: "model-generated",
          workspace_resource_ids: ["RES4"],
        },
        occurred_at: at(),
        causation_sequence: 3,
      },
      {
        event_type: "voice_action_issued",
        payload: {
          action_id: "VA-TS-9151-1",
          decision_id: "TD-TS-9151-1",
          text: "这一步你来试试看。",
          interruptible: true,
          voice_source: "model-generated",
          generation_id: "VG-TS-9151-1",
        },
        occurred_at: at(),
        causation_sequence: 4,
      },
    ]);
    const events = store.readTutorSessionEventsV2("TS-9151");
    expect(events.every((event) => event.schema === "ai_teaching_tutor_session_event/v3")).toBe(true);
    expect(events[1].payload).toMatchObject({ client_turn_id: "turn-x-01" });
    expect(events[2].payload).toMatchObject({ route_id: "R2", confidence: 0.92, grounding_refs: ["route.R2.entry"] });
    expect(events[3].payload).toMatchObject({ model: "deepseek-v4-flash", voice_source: "model-generated" });
    expect(events[4].payload).toMatchObject({ generation_id: "VG-TS-9151-1" });
  });

  it("v3 会话拒绝 chain_of_thought（strict fail closed）", () => {
    store.startTutorSession({ sessionId: "TS-9152", studentId: "s", plan, eventSchema: "v3" });
    store.appendTutorSessionEventsV2("TS-9152", 0, [
      { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
    ]);
    expectStoreError(
      () =>
        store.appendTutorSessionEventsV2("TS-9152", 1, [
          {
            event_type: "voice_action_issued",
            payload: {
              action_id: "VA-TS-9152-1",
              decision_id: "TD-TS-9152-1",
              text: "x",
              chain_of_thought: "不得进入事件流",
            } as unknown as V2EventPayload,
            occurred_at: at(),
            causation_sequence: 1,
          },
        ]),
      "VALIDATION_FAILED",
    );
  });

  it("v2 append enforces causation_sequence on required event types", () => {
    store.startTutorSession({ sessionId: "TS-9102", studentId: "s", plan, eventSchema: "v2" });
    store.appendTutorSessionEventsV2("TS-9102", 0, [
      { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
    ]);
    expectStoreError(
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
      "VALIDATION_FAILED",
    );
  });

  it("v2 append validates canonical payloads (invalid hint move rejected)", () => {
    store.startTutorSession({ sessionId: "TS-9103", studentId: "s", plan, eventSchema: "v2" });
    store.appendTutorSessionEventsV2("TS-9103", 0, [
      { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
    ]);
    expectStoreError(
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
      "VALIDATION_FAILED",
    );
    expect(store.readTutorSessionEventsV2("TS-9103").length).toBe(1);
  });

  it("contract isolation: v2 append rejected on v1 session and vice versa", () => {
    store.startTutorSession({ sessionId: "TS-9104", studentId: "s", plan, eventSchema: "v1" });
    expectStoreError(
      () =>
        store.appendTutorSessionEventsV2("TS-9104", 0, [
          { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
        ]),
      "VALIDATION_FAILED",
    );
    store.startTutorSession({ sessionId: "TS-9105", studentId: "s", plan, eventSchema: "v2" });
    expectStoreError(
      () =>
        store.appendTutorSessionEvents("TS-9105", 0, [
          { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
        ]),
      "VALIDATION_FAILED",
    );
  });

  it("optimistic concurrency and idempotency keep v1 semantics on v2 path", () => {
    store.startTutorSession({ sessionId: "TS-9106", studentId: "s", plan, eventSchema: "v2" });
    store.appendTutorSessionEventsV2("TS-9106", 0, [
      { event_type: "session_started", payload: { plan, initial_mode: "teach" }, occurred_at: at() },
    ]);
    expectStoreError(
      () =>
        store.appendTutorSessionEventsV2("TS-9106", 0, [
          { event_type: "student_input_recorded", payload: { input_kind: "silence_observed", duration_ms: 3000 }, occurred_at: at() },
        ]),
      "REVISION_CONFLICT",
    );
    expectStoreError(
      () =>
        store.appendTutorSessionEventsV2("TS-9106", 1, [
          {
            event_type: "student_input_recorded",
            payload: { input_kind: "silence_observed", duration_ms: 3000 },
            occurred_at: at(),
            idempotency_key: "TS-9106:1",
          },
        ]),
      "DUPLICATE_EVENT",
    );
    expect(revisionOf("TS-9106")).toBe(1);
  });

  it("legacy v1 session remains readable (gate 6：老 session 继续可恢复)", () => {
    store.startTutorSession({ sessionId: "TS-9107", studentId: "s", plan, eventSchema: "v1" });
    store.appendTutorSessionEvents("TS-9107", 0, [
      { event_type: "session_started", payload: { plan }, occurred_at: at() },
      { event_type: "hint_issued", payload: { checkpoint_id: "CP1", level: 1 }, occurred_at: at() },
    ]);
    const legacy = store.readTutorSessionEvents("TS-9107");
    expect(legacy.map((event) => event.event_type)).toEqual(["session_started", "hint_issued"]);
    const row = store.getTutorSession("TS-9107") as { event_schema: string };
    expect(row.event_schema).toBe("v1");
  });
});
