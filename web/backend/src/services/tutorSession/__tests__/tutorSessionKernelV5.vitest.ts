/**
 * F2 kernel Vitest 套件（Event / Revision / Replay 内核）。
 *
 * node 链（tutorSessionKernelV5.test.ts）覆盖 G2 六类负例 + 正例门禁；本套件
 * 补充：comparator 单元语义、reducer fail-closed 分支、fixture 事件消费、
 * 独立会话语义比较与 resume 语义。SQLITE_PATH 由 vitest.setup.ts 前置。
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { db } from "../../../db/database";
import {
  appendTutorSessionEventsV5,
  getTutorSessionV5,
  readTutorSessionEventsV5,
  readRawTutorSessionEventRowsV5,
  startTutorSessionV5,
  tutorSessionRevisionV5,
} from "../TutorSessionEventStoreV5";
import {
  RuntimeStateReducerV5Error,
  type PendingV5Event,
  type StoredV5Event,
} from "../TutorSessionEventV5";
import {
  applyV5Event,
  foldCommittedV5Events,
  initialStateFromSessionStarted,
} from "../TutorRuntimeStateReducerV5";
import { rebuildTutorRuntimeStateV5, verifyCommittedStreamV5 } from "../RuntimeStateRebuilderV5";
import { TutorSessionKernelV5 } from "../TutorSessionKernelV5";
import {
  SEMANTICALLY_IGNORED_EVENT_FIELDS,
  SEMANTICALLY_IGNORED_STATE_FIELDS,
  compareCommittedEventStreamsSemantically,
  compareTutorRuntimeStatesSemantically,
} from "../RuntimeStateSemanticComparatorV5";
import { validatePayload } from "../../../../../shared/canonical";
import {
  REF,
  SHA,
  decisionPayload,
  ev,
  journeyBatches,
  outcomePayload,
  sessionStartedPayload,
  startInput,
  surfaceIssuedPayload,
  voiceIssuedPayload,
} from "./v5KernelSupport";

const insertRawEvent = db.prepare(`
  INSERT INTO tutor_session_events
    (session_id, sequence, event_type, payload_json, occurred_at, idempotency_key, recorded_revision, recorded_at, causation_sequence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

function countEvents(sessionId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events WHERE session_id = ?").get(sessionId) as { n: number }).n;
}

function expectCode(fn: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as { code?: string }).code).toBe(code);
}

function runJourney(sessionId: string): TutorSessionKernelV5 {
  const kernel = TutorSessionKernelV5.start(startInput(sessionId));
  let revision = 1;
  for (const batch of journeyBatches(sessionId)) {
    revision = kernel.append(revision, batch).revision;
  }
  return kernel;
}

describe("F2 kernel: store append semantics", () => {
  it("start pins plan/version/hash on the session row and stamps sequence 1 at revision 1", () => {
    startTutorSessionV5(startInput("TS-9601"));
    const row = getTutorSessionV5("TS-9601");
    expect(row).toMatchObject({
      event_schema: "v5",
      revision: 1,
      plan_artifact_id: REF.tutorPlan.artifact_id,
      plan_version: REF.tutorPlan.version,
      plan_content_hash: REF.tutorPlan.content_hash,
    });
    const events = readTutorSessionEventsV5("TS-9601");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sequence: 1, state_revision: 1, event_type: "session_started" });
    expect(validatePayload(events[0])).toEqual({ ok: true, errors: [] });
  });

  it("batch shares post-commit state_revision and bump session revision once", () => {
    startTutorSessionV5(startInput("TS-9602"));
    const result = appendTutorSessionEventsV5("TS-9602", 1, [
      ev("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0001" }),
      ev("semantic_interpretation_recorded", { intent: "confirm", reasoning_location: "aligned", confidence: 1, interpreter_version: "v1" }, { causation_sequence: 2 }),
    ]);
    expect(result).toEqual({ revision: 2, appendedSequences: [2, 3] });
    const events = readTutorSessionEventsV5("TS-9602");
    expect(events.map((event) => [event.sequence, event.state_revision])).toEqual([[1, 1], [2, 2], [3, 2]]);
    expect(tutorSessionRevisionV5("TS-9602")).toBe(2);
  });

  it("duplicate idempotency key rolls the whole batch back", () => {
    startTutorSessionV5(startInput("TS-9603"));
    const batch: PendingV5Event[] = [
      { ...journeyBatches("TS-9603")[0][0], idempotency_key: "TS-9603-dup-0001" },
    ];
    appendTutorSessionEventsV5("TS-9603", 1, batch);
    expectCode(() => appendTutorSessionEventsV5("TS-9603", 2, batch), "DUPLICATE_EVENT");
    expect(countEvents("TS-9603")).toBe(2);
    expect(tutorSessionRevisionV5("TS-9603")).toBe(2);
  });

  it("stale expected revision and cross-schema append are rejected", () => {
    startTutorSessionV5(startInput("TS-9604"));
    expectCode(() => appendTutorSessionEventsV5("TS-9604", 5, journeyBatches("TS-9604")[0]), "REVISION_CONFLICT");
    expectCode(() => appendTutorSessionEventsV5("TS-9999", 0, journeyBatches("TS-9999")[0]), "SESSION_NOT_FOUND");
    expect(countEvents("TS-9604")).toBe(1);
  });

  it("causation must reference a committed or earlier-in-batch sequence", () => {
    startTutorSessionV5(startInput("TS-9605"));
    expectCode(
      () =>
        appendTutorSessionEventsV5("TS-9605", 1, [
          ev("policy_decision_made", decisionPayload("TS-9605", 1), { causation_sequence: 9 }),
        ]),
      "CAUSATION_REF_INVALID",
    );
    // 同批更早的 sequence 是合法引用。
    appendTutorSessionEventsV5("TS-9605", 1, [
      ev("student_intent_recorded", { intent_kind: "continue", client_request_id: "cr-0001" }),
      ev("policy_decision_made", decisionPayload("TS-9605", 1), { causation_sequence: 2 }),
    ]);
    expect(tutorSessionRevisionV5("TS-9605")).toBe(2);
  });
});

describe("F2 kernel: reducer determinism and fail-closed branches", () => {
  it("fold is pure: same events produce the same state object content", () => {
    const kernel = runJourney("TS-9610");
    const events = readTutorSessionEventsV5("TS-9610");
    expect(foldCommittedV5Events(events)).toEqual(foldCommittedV5Events([...events].map((event) => ({ ...event }))));
    expect(foldCommittedV5Events(events)).toEqual(kernel.state);
  });

  it("initialStateFromSessionStarted rejects non-start first events", () => {
    const events = readTutorSessionEventsV5("TS-9610");
    expect(() => initialStateFromSessionStarted(events[events.length - 1])).toThrow(RuntimeStateReducerV5Error);
    expect(() => foldCommittedV5Events([])).toThrow(RuntimeStateReducerV5Error);
  });

  it("inquiry_returned with a different return point fails closed", () => {
    const base = TutorSessionKernelV5.start(startInput("TS-9611"));
    base.append(1, [ev("inquiry_opened", { inquiry_id: "IQ-TS-9611-0001", return_beat_id: "BT-01" }, { causation_sequence: 1 })]);
    const tampered: StoredV5Event = {
      ...readTutorSessionEventsV5("TS-9611")[1],
      event_type: "inquiry_returned",
      payload: { inquiry_id: "IQ-TS-9611-0001", return_beat_id: "BT-09" },
    };
    expect(() => applyV5Event(base.state, tampered)).toThrow(RuntimeStateReducerV5Error);
    try {
      applyV5Event(base.state, tampered);
    } catch (error) {
      expect((error as RuntimeStateReducerV5Error).code).toBe("INQUIRY_RETURN_MISMATCH");
    }
  });

  it("continue_inquiry / inquiry_returned without an open inquiry are facts without state mutation (committed stream stays recoverable)", () => {
    const kernel = TutorSessionKernelV5.start(startInput("TS-9612"));
    const before = kernel.state;
    kernel.append(1, [
      ev("policy_decision_made", decisionPayload("TS-9612", 1, {
        decision_kind: "continue_inquiry",
        inquiry: { inquiry_id: "IQ-TS-9612-0001", return_beat_id: "BT-01" },
      }), { causation_sequence: 1 }),
      ev("inquiry_returned", { inquiry_id: "IQ-TS-9612-0001", return_beat_id: "BT-01" }, { causation_sequence: 2 }),
    ]);
    expect(kernel.state).toEqual({ ...before, state_revision: before.state_revision + 1 });
    expect(kernel.assertReplayParity().equal).toBe(true);
    // 经合法路径打开后再 continue 不误伤。
    const opened = TutorSessionKernelV5.start(startInput("TS-96120"));
    opened.append(1, [ev("inquiry_opened", { inquiry_id: "IQ-TS-96120-0001", return_beat_id: "BT-01" }, { causation_sequence: 1 })]);
    opened.append(2, [ev("policy_decision_made", decisionPayload("TS-96120", 2, {
      decision_kind: "continue_inquiry",
      inquiry: { inquiry_id: "IQ-TS-96120-0001", return_beat_id: "BT-01" },
    }), { causation_sequence: 2 })]);
    expect(opened.state.inquiry_cursor?.inquiry_id).toBe("IQ-TS-96120-0001");
  });

  it("R3 (2026-08-31): wrong-beat gate_evaluated fails closed (GATE_BEAT_MISMATCH; was silent no-op)", () => {
    // 用户授权第二轮 reducer 编辑：wrong/future/stale beat 的 gate 事实不再静默
    // break——append 边界整批回滚、零转移、零游标变化（原断言=静默不动，改写为
    // fail closed 断言；语义变更登记 r3-scope-ledger 偏差清单）。
    const kernel = TutorSessionKernelV5.start(startInput("TS-9613", { initialBeat: "BT-01" }));
    expectCode(
      () => kernel.append(1, [ev("gate_evaluated", { gate_id: "GT-02", beat_id: "BT-05", satisfied: true }, { causation_sequence: 1 })]),
      "GATE_BEAT_MISMATCH",
    );
    expect(kernel.state.teaching_cursor.gate_id).toBeUndefined();
    expect(kernel.state.teaching_cursor.phase).toBe("presenting");
    expect(kernel.state.teaching_cursor.beat_id).toBe("BT-01");
    // 正确绑定当前 Beat 的 gate 事实照常折叠（satisfied → gate_satisfied）。
    kernel.append(kernel.revision, [ev("gate_evaluated", { gate_id: "GT-01", beat_id: "BT-01", satisfied: true }, { causation_sequence: 1 })]);
    expect(kernel.state.teaching_cursor.gate_id).toBe("GT-01");
    expect(kernel.state.teaching_cursor.phase).toBe("gate_satisfied");
    expect(kernel.assertReplayParity().equal).toBe(true);
  });
});

describe("F2 kernel: rebuild integrity (fail closed)", () => {
  it("event gap fails closed", () => {
    TutorSessionKernelV5.start(startInput("TS-9620"));
    insertRawEvent.run("TS-9620", 3, "student_intent_recorded", JSON.stringify({ intent_kind: "continue", client_request_id: "cr-0001" }), new Date().toISOString(), "TS-9620:3", 2, new Date().toISOString(), null);
    expectCode(() => verifyCommittedStreamV5("TS-9620"), "EVENT_GAP");
  });

  it("corrupt payload and non-monotonic revision fail closed", () => {
    TutorSessionKernelV5.start(startInput("TS-9621"));
    insertRawEvent.run("TS-9621", 2, "student_intent_recorded", "]]]not-json", new Date().toISOString(), "TS-9621:2", 2, new Date().toISOString(), null);
    expectCode(() => rebuildTutorRuntimeStateV5("TS-9621"), "CORRUPT_EVENT");

    TutorSessionKernelV5.start(startInput("TS-96210"));
    insertRawEvent.run("TS-96210", 2, "student_intent_recorded", JSON.stringify({ intent_kind: "continue", client_request_id: "cr-0001" }), new Date().toISOString(), "TS-96210:2", 0, new Date().toISOString(), null);
    expectCode(() => rebuildTutorRuntimeStateV5("TS-96210"), "REVISION_INCONSISTENT");
  });

  it("plan pin mismatch fails closed (row tamper and expectedPin)", () => {
    TutorSessionKernelV5.start(startInput("TS-9622"));
    db.prepare("UPDATE tutor_sessions SET plan_content_hash = ? WHERE session_id = ?").run(SHA("tampered"), "TS-9622");
    expectCode(() => rebuildTutorRuntimeStateV5("TS-9622"), "HASH_MISMATCH");

    TutorSessionKernelV5.start(startInput("TS-96220"));
    expectCode(
      () => rebuildTutorRuntimeStateV5("TS-96220", { expectedTutorPlanRef: { ...REF.tutorPlan, version: "v1" } }),
      "HASH_MISMATCH",
    );
    // 匹配的 expectedPin 正常重建。
    expect(() => rebuildTutorRuntimeStateV5("TS-96220", { expectedTutorPlanRef: { ...REF.tutorPlan } })).not.toThrow();
  });

  it("v1-v4 sessions are schema-isolated from v5 rebuild", () => {
    db.prepare(
      `INSERT INTO tutor_sessions (session_id, student_id, plan_artifact_id, plan_version, plan_content_hash, current_mode, revision, started_at, event_schema)
       VALUES ('TS-9623', 's', 'TP-SMV-001', 'v2', ?, 'teach', 0, ?, 'v4')`,
    ).run(SHA("legacy"), new Date().toISOString());
    expectCode(() => rebuildTutorRuntimeStateV5("TS-9623"), "SCHEMA_ISOLATION");
  });
});

describe("F2 kernel: G2 invariants", () => {
  it("same pinned plan + same ordered committed events rebuild identical state (online vs rebuilt share one reducer)", () => {
    const kernel = runJourney("TS-9630");
    const parity = kernel.assertReplayParity();
    expect(parity.equal).toBe(true);
    expect(parity.differences).toEqual([]);
    expect(kernel.state).toEqual(rebuildTutorRuntimeStateV5("TS-9630"));
  });

  it("resume from scratch equals pre-crash online state; issued-without-outcome has no completion side effects", () => {
    const kernel = TutorSessionKernelV5.start(startInput("TS-9631"));
    kernel.append(1, [
      ev("policy_decision_made", decisionPayload("TS-9631", 1), { causation_sequence: 1 }),
      ev("voice_action_issued", voiceIssuedPayload("TS-9631", 1, 1), { causation_sequence: 2 }),
      ev("workspace_surface_action_issued", surfaceIssuedPayload("TS-9631", 1, 1), { causation_sequence: 2 }),
    ]);
    const resumed = TutorSessionKernelV5.resume("TS-9631");
    expect(resumed.state).toEqual(kernel.state);
    expect(resumed.state.teaching_cursor.phase).toBe("presenting");
    expect(resumed.state.workspace_revision).toBe(0);
    expect(resumed.state.completed).toBe(false);
    // interrupted / failed voice、rejected workspace 均无完成副作用。
    resumed.append(2, [
      ev("action_outcome_recorded", outcomePayload(`VA-TS-9631-1`, "voice", "interrupted"), { causation_sequence: 3 }),
      ev("action_outcome_recorded", outcomePayload(`WSA-TS-9631-1`, "workspace_surface", "failed", { failure_class: "provider_failure" }), { causation_sequence: 4 }),
    ]);
    expect(resumed.state.teaching_cursor.phase).toBe("presenting");
    expect(resumed.state.workspace_revision).toBe(0);
    expect(resumed.assertReplayParity().equal).toBe(true);
  });

  it("canonical v5 event fixtures (policy-decision / support-evidence) are appendable facts", () => {
    const fixturesDir = path.resolve(process.cwd(), "../shared/canonical/fixtures");
    const decisionFixture = JSON.parse(
      readFileSync(path.join(fixturesDir, "tutor-session-event.v5.positive.policy-decision.json"), "utf8"),
    ) as StoredV5Event;
    const supportFixture = JSON.parse(
      readFileSync(path.join(fixturesDir, "tutor-session-event.v5.positive.support-evidence.json"), "utf8"),
    ) as StoredV5Event;
    const kernel = TutorSessionKernelV5.start(startInput("TS-9632"));
    kernel.append(1, [
      ev("policy_decision_made", decisionFixture.payload, { causation_sequence: 1 }),
      ev("external_support_recorded", supportFixture.payload, { causation_sequence: 2 }),
    ]);
    const events = readTutorSessionEventsV5("TS-9632");
    expect(events[1].payload).toEqual(decisionFixture.payload);
    expect(events[2].payload).toEqual(supportFixture.payload);
    expect(kernel.assertReplayParity().equal).toBe(true);
  });
});

describe("F2 kernel: semantic comparator", () => {
  it("state ignore list is explicitly empty; any canonical field difference is visible", () => {
    expect(SEMANTICALLY_IGNORED_STATE_FIELDS).toEqual([]);
    const kernel = runJourney("TS-9640");
    const rebuilt = rebuildTutorRuntimeStateV5("TS-9640");
    expect(compareTutorRuntimeStatesSemantically(kernel.state, rebuilt).equal).toBe(true);
    const mutated = { ...rebuilt, teaching_cursor: { ...rebuilt.teaching_cursor, phase: "presenting" as const } };
    const comparison = compareTutorRuntimeStatesSemantically(rebuilt, mutated);
    expect(comparison.equal).toBe(false);
    expect(comparison.differences).toEqual([
      { path: "teaching_cursor.phase", left: "completed", right: "presenting", ignored: false },
    ]);
  });

  it("event stream comparison ignores only recorded_at (DB write-time metadata)", () => {
    expect(SEMANTICALLY_IGNORED_EVENT_FIELDS).toEqual(["recorded_at"]);
    const left = readRawTutorSessionEventRowsV5("TS-9640");
    const right = left.map((row, index) => ({ ...row, recorded_at: index === 0 ? "2099-01-01T00:00:00.000Z" : row.recorded_at }));
    const comparison = compareCommittedEventStreamsSemantically(left, right);
    expect(comparison.equal).toBe(true);
    expect(comparison.differences.every((difference) => difference.ignored)).toBe(true);
    // idempotency_key 差异必须可见（不在白名单）。
    const tampered = left.map((row, index) => (index === 1 ? { ...row, idempotency_key: "TS-9640:tampered" } : row));
    expect(compareCommittedEventStreamsSemantically(left, tampered).equal).toBe(false);
  });

  it("two independent sessions with identical journeys differ exactly on session-scoped fields", () => {
    const a = runJourney("TS-9641").state;
    const b = runJourney("TS-9642").state;
    const comparison = compareTutorRuntimeStatesSemantically(a, b);
    expect(comparison.equal).toBe(false);
    expect(comparison.differences.map((difference) => difference.path)).toEqual(["session_id"]);
  });

  it("state/v1 canonical fixture is semantically consumable", () => {
    const fixturesDir = path.resolve(process.cwd(), "../shared/canonical/fixtures");
    const stateFixture = JSON.parse(
      readFileSync(path.join(fixturesDir, "tutor-runtime-state.positive.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(compareTutorRuntimeStatesSemantically(stateFixture, stateFixture).equal).toBe(true);
    const negative = JSON.parse(
      readFileSync(path.join(fixturesDir, "tutor-runtime-state.negative.inquiry-without-return.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(validatePayload(negative).ok).toBe(false);
  });
});

describe("F2 kernel: 2026-08-29 re-verification fixes", () => {
  it("resume() fails closed on gap / corrupt / revision / schema / pin corruption (verified rebuild path)", () => {
    // 修复 #1：resume 与 rebuildTutorRuntimeStateV5 同一完整性入口。
    TutorSessionKernelV5.start(startInput("TS-9660"));
    insertRawEvent.run("TS-9660", 3, "student_intent_recorded", JSON.stringify({ intent_kind: "continue", client_request_id: "cr-0001" }), new Date().toISOString(), "TS-9660:3", 2, new Date().toISOString(), null);
    expectCode(() => TutorSessionKernelV5.resume("TS-9660"), "EVENT_GAP");

    TutorSessionKernelV5.start(startInput("TS-9661"));
    insertRawEvent.run("TS-9661", 2, "student_intent_recorded", "{not-json", new Date().toISOString(), "TS-9661:2", 2, new Date().toISOString(), null);
    expectCode(() => TutorSessionKernelV5.resume("TS-9661"), "CORRUPT_EVENT");

    TutorSessionKernelV5.start(startInput("TS-9662"));
    insertRawEvent.run("TS-9662", 2, "student_intent_recorded", JSON.stringify({ intent_kind: "continue", client_request_id: "cr-0001" }), new Date().toISOString(), "TS-9662:2", 99, new Date().toISOString(), null);
    expectCode(() => TutorSessionKernelV5.resume("TS-9662"), "REVISION_INCONSISTENT");

    db.prepare(
      `INSERT INTO tutor_sessions (session_id, student_id, plan_artifact_id, plan_version, plan_content_hash, current_mode, revision, started_at, event_schema)
       VALUES ('TS-9663', 's', 'TP-SMV-001', 'v2', ?, 'teach', 1, ?, 'v3')`,
    ).run(SHA("legacy"), new Date().toISOString());
    expectCode(() => TutorSessionKernelV5.resume("TS-9663"), "SCHEMA_ISOLATION");

    TutorSessionKernelV5.start(startInput("TS-9664"));
    db.prepare("UPDATE tutor_sessions SET plan_content_hash = ? WHERE session_id = ?").run(SHA("tampered"), "TS-9664");
    expectCode(() => TutorSessionKernelV5.resume("TS-9664"), "HASH_MISMATCH");

    // 健康流行为不变：正常恢复 + 匹配 expectedTutorPlanRef。
    const kernel = TutorSessionKernelV5.start(startInput("TS-9665"));
    kernel.append(1, [ev("inquiry_opened", { inquiry_id: "IQ-TS-9665-0001", return_beat_id: "BT-01" }, { causation_sequence: 1 })]);
    const resumed = TutorSessionKernelV5.resume("TS-9665", { expectedTutorPlanRef: { ...REF.tutorPlan } });
    expect(resumed.state).toEqual(kernel.state);
    expect(resumed.revision).toBe(2);
    expect(resumed.assertReplayParity().equal).toBe(true);
  });

  it("reducer-rejected batch never persists: event count / revision / cache / rebuild all unchanged", () => {
    // 修复 #2：折叠校验在持久化生效之前（store 事务内），毒化不可能发生。
    const kernel = TutorSessionKernelV5.start(startInput("TS-9666"));
    kernel.append(1, [ev("inquiry_opened", { inquiry_id: "IQ-TS-9666-0001", return_beat_id: "BT-01" }, { causation_sequence: 1 })]);
    const before = kernel.state;
    expectCode(
      () => kernel.append(2, [ev("inquiry_returned", { inquiry_id: "IQ-TS-9666-0001", return_beat_id: "BT-99" }, { causation_sequence: 2 })]),
      "INQUIRY_RETURN_MISMATCH",
    );
    expect(countEvents("TS-9666")).toBe(2);
    expect(tutorSessionRevisionV5("TS-9666")).toBe(2);
    expect(kernel.state).toEqual(before);
    expect(() => rebuildTutorRuntimeStateV5("TS-9666")).not.toThrow();
    expect(kernel.assertReplayParity().equal).toBe(true);
    // 会话未毒化：正确的 return 仍可提交。
    kernel.append(2, [ev("inquiry_returned", { inquiry_id: "IQ-TS-9666-0001", return_beat_id: "BT-01" }, { causation_sequence: 2 })]);
    expect(tutorSessionRevisionV5("TS-9666")).toBe(3);
    expect(kernel.state.inquiry_cursor).toBeNull();
    expect(kernel.assertReplayParity().equal).toBe(true);
  });

  it("store-level append pre-folds candidate batches (guarantee holds for direct store callers)", () => {
    startTutorSessionV5(startInput("TS-9667"));
    appendTutorSessionEventsV5("TS-9667", 1, [
      ev("inquiry_opened", { inquiry_id: "IQ-TS-9667-0001", return_beat_id: "BT-01" }, { causation_sequence: 1 }),
    ]);
    expectCode(
      () =>
        appendTutorSessionEventsV5("TS-9667", 2, [
          ev("inquiry_returned", { inquiry_id: "IQ-TS-9667-0001", return_beat_id: "BT-77" }, { causation_sequence: 2 }),
        ]),
      "INQUIRY_RETURN_MISMATCH",
    );
    expect(countEvents("TS-9667")).toBe(2);
    expect(tutorSessionRevisionV5("TS-9667")).toBe(2);
    // 多事件批第二个事件被拒时，第一个候选行的 INSERT 也随事务回滚。
    expectCode(
      () =>
        appendTutorSessionEventsV5("TS-9667", 2, [
          ev("student_intent_recorded", { intent_kind: "continue", client_request_id: "cr-0001" }),
          ev("inquiry_returned", { inquiry_id: "IQ-TS-9667-0001", return_beat_id: "BT-88" }, { causation_sequence: 2 }),
        ]),
      "INQUIRY_RETURN_MISMATCH",
    );
    expect(countEvents("TS-9667")).toBe(2);
    expect(tutorSessionRevisionV5("TS-9667")).toBe(2);
  });

  it("idempotent retry of a committed semantic batch surfaces DUPLICATE_EVENT (fold gate does not mask it)", () => {
    const kernel = TutorSessionKernelV5.start(startInput("TS-9668"));
    const batch: PendingV5Event[] = [
      ev("inquiry_opened", { inquiry_id: "IQ-TS-9668-0001", return_beat_id: "BT-01" }, { causation_sequence: 1, idempotency_key: "TS-9668-open-0001" }),
      ev("inquiry_returned", { inquiry_id: "IQ-TS-9668-0001", return_beat_id: "BT-01" }, { causation_sequence: 2, idempotency_key: "TS-9668-return-0001" }),
    ];
    kernel.append(1, batch);
    expect(countEvents("TS-9668")).toBe(3);
    const afterFirst = kernel.state;
    expectCode(() => kernel.append(2, batch), "DUPLICATE_EVENT");
    expect(countEvents("TS-9668")).toBe(3);
    expect(tutorSessionRevisionV5("TS-9668")).toBe(2);
    expect(kernel.state).toEqual(afterFirst);
  });

  it("revision allocation is exact: jump / last-vs-row mismatch rejected, batch-shared revision accepted", () => {
    // 修复 #3：1→99 跳跃拒绝。
    TutorSessionKernelV5.start(startInput("TS-9669"));
    insertRawEvent.run("TS-9669", 2, "student_intent_recorded", JSON.stringify({ intent_kind: "continue", client_request_id: "cr-0001" }), new Date().toISOString(), "TS-9669:2", 99, new Date().toISOString(), null);
    expectCode(() => verifyCommittedStreamV5("TS-9669"), "REVISION_INCONSISTENT");
    expectCode(() => rebuildTutorRuntimeStateV5("TS-9669"), "REVISION_INCONSISTENT");
    // 末事件与 session 行不一致（注入 rev2 事件但行 revision 未动）拒绝。
    TutorSessionKernelV5.start(startInput("TS-96690"));
    insertRawEvent.run("TS-96690", 2, "student_intent_recorded", JSON.stringify({ intent_kind: "continue", client_request_id: "cr-0001" }), new Date().toISOString(), "TS-96690:2", 2, new Date().toISOString(), null);
    expectCode(() => verifyCommittedStreamV5("TS-96690"), "REVISION_INCONSISTENT");
    // 健康批内共享 revision 精确通过：[1,2,2] 且行 revision=2。
    const kernel = TutorSessionKernelV5.start(startInput("TS-96691"));
    kernel.append(1, [
      ev("student_intent_recorded", { intent_kind: "submit_answer", text: "角相等", client_request_id: "cr-0001" }),
      ev("semantic_interpretation_recorded", { intent: "derive_ratio_via_similarity", reasoning_location: "aligned", confidence: 0.92, interpreter_version: "interpreter/v1" }, { causation_sequence: 2 }),
    ]);
    const verified = verifyCommittedStreamV5("TS-96691");
    expect(verified.events.map((event) => [event.sequence, event.state_revision])).toEqual([[1, 1], [2, 2], [3, 2]]);
    expect(verified.session.revision).toBe(2);
    expect(kernel.assertReplayParity().equal).toBe(true);
  });
});

describe("F2 kernel: sessionStarted payload surface", () => {
  it("previous_session_id / switch_reason round-trip when present", () => {
    const payload = {
      ...sessionStartedPayload(),
      previous_session_id: "TS-9649",
      switch_reason: "alternate_approach" as const,
    };
    startTutorSessionV5({ sessionId: "TS-9650", studentId: "s", sessionStarted: payload, occurred_at: new Date().toISOString() });
    const events = readTutorSessionEventsV5("TS-9650");
    expect(events[0].payload).toEqual(payload);
    expect(validatePayload(events[0]).ok).toBe(true);
    expect(rebuildTutorRuntimeStateV5("TS-9650").pinned_plan.tutor_plan_ref).toEqual(payload.tutor_plan_ref);
  });
});

