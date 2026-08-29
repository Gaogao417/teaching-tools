/**
 * F2 G2 门禁测试（node 链）：Event / Revision / Replay 内核。
 *
 * 覆盖 f2-scope-ledger 的六类负例义务 + G2 正例：
 * 1. 同一 Pinned Plan + 同一有序 committed events 重建相同 TutorRuntimeState，
 *    且在线 kernel 与重建用同一 reducer（assertReplayParity）；
 * 2. duplicate（幂等键重复 / 重复 session_started）不重复产生事实；
 * 3. stale revision（REVISION_CONFLICT）不产生事实；
 * 4. event gap fail closed（EVENT_GAP）；
 * 5. corrupt payload / revision 非单调 fail closed（CORRUPT_EVENT /
 *    REVISION_INCONSISTENT）；
 * 6. hash/version mismatch fail closed（HASH_MISMATCH）；
 * 7. mid-action crash：issued 无 outcome / interrupted voice 不产生完成副作用；
 * 8. canonical fixtures 消费 + v5/v2 合同隔离 + causation 引用校验。
 *
 * 注：EVENT_GAP / CORRUPT / HASH 负例以测试侧直接 INSERT/UPDATE 模拟存储
 * 损坏（生产代码对事件表只 INSERT/SELECT、对 pin 只经 start 写入——
 * append-only 由 store 的结构保证，测试不受此限）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { ensureSqlite } from "./support";
import {
  SHA,
  REF,
  journeyBatches,
  startInput,
  ev,
  outcomePayload,
  voiceIssuedPayload,
  surfaceIssuedPayload,
  decisionPayload,
} from "./v5KernelSupport";

ensureSqlite("tutor-session-kernel-v5");

const { db } = require("../../../db/database") as typeof import("../../../db/database");
const store5 = require("../TutorSessionEventStoreV5") as typeof import("../TutorSessionEventStoreV5");
const reducer5 = require("../TutorRuntimeStateReducerV5") as typeof import("../TutorRuntimeStateReducerV5");
const rebuilder5 = require("../RuntimeStateRebuilderV5") as typeof import("../RuntimeStateRebuilderV5");
const kernel5 = require("../TutorSessionKernelV5") as typeof import("../TutorSessionKernelV5");
const comparator5 = require("../RuntimeStateSemanticComparatorV5") as typeof import("../RuntimeStateSemanticComparatorV5");
const legacyStore = require("../TutorSessionEventStore") as typeof import("../TutorSessionEventStore");

const insertRawEvent = db.prepare(`
  INSERT INTO tutor_session_events
    (session_id, sequence, event_type, payload_json, occurred_at, idempotency_key, recorded_revision, recorded_at, causation_sequence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

function countEvents(sessionId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events WHERE session_id = ?").get(sessionId) as { n: number }).n;
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

function expectCode(fn: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, `expected error with code ${code}, got ${String(thrown)}`);
  assert.equal(
    (thrown as { code?: string }).code,
    code,
    `expected code ${code}, got ${(thrown as { code?: string }).code}: ${String(thrown)}`,
  );
}

async function main(): Promise<void> {
  await runTest("G2 core: same pinned plan + same ordered committed events rebuild identical TutorRuntimeState", () => {
    const kernel = kernel5.TutorSessionKernelV5.start(startInput("TS-9501"));
    let revision = 1;
    for (const batch of journeyBatches("TS-9501")) {
      revision = kernel.append(revision, batch).revision;
    }
    const rebuilt = kernel.rebuild();
    assert.deepEqual(kernel.state, rebuilt);
    // 独立全量重放（不经 kernel 缓存）也一致：在线与重建共用同一 reducer 的结构性证明。
    const replayed = reducer5.foldCommittedV5Events(store5.readTutorSessionEventsV5("TS-9501"));
    assert.deepEqual(replayed, rebuilt);
    assert.deepEqual(rebuilt, kernel.rebuild(), "rebuild is deterministic");
    const parity = kernel.assertReplayParity();
    assert.equal(parity.equal, true);
    assert.deepEqual(parity.differences, []);
    // 旅程终点状态断言（reducer 约定）。
    assert.equal(rebuilt.completed, true);
    assert.equal(rebuilt.teaching_cursor.beat_id, "BT-02");
    assert.equal(rebuilt.teaching_cursor.phase, "completed");
    assert.equal(rebuilt.workspace_revision, 2);
    assert.equal(rebuilt.inquiry_cursor, null);
    assert.equal(rebuilt.state_revision, revision);
    assert.deepEqual(rebuilt.pinned_plan.tutor_plan_ref, REF.tutorPlan);
  });

  await runTest("journey intermediate phases: issued→completed outcomes drive phases deterministically", () => {
    const kernel = kernel5.TutorSessionKernelV5.start(startInput("TS-9502"));
    assert.equal(kernel.state.teaching_cursor.phase, "presenting");
    kernel.append(1, journeyBatches("TS-9502")[0]); // intent
    kernel.append(2, journeyBatches("TS-9502")[1]); // interpretation + decision
    kernel.append(3, journeyBatches("TS-9502")[2]); // voice + wsa issued（未执行）
    let state = kernel.state;
    assert.equal(state.teaching_cursor.phase, "presenting", "issued without outcome keeps presenting");
    assert.equal(state.workspace_revision, 0);
    kernel.append(4, journeyBatches("TS-9502")[3]); // outcomes completed
    state = kernel.state;
    assert.equal(state.teaching_cursor.phase, "awaiting_evidence", "voice completed → awaiting_evidence");
    assert.equal(state.workspace_revision, 2, "workspace completed outcome advances workspace_revision");
    kernel.append(5, journeyBatches("TS-9502")[4]); // gate satisfied
    state = kernel.state;
    assert.equal(state.teaching_cursor.phase, "gate_satisfied");
    assert.equal(state.teaching_cursor.gate_id, "GT-01");
    kernel.append(6, journeyBatches("TS-9502")[5]); // transition to BT-02
    state = kernel.state;
    assert.equal(state.teaching_cursor.beat_id, "BT-02");
    assert.equal(state.teaching_cursor.phase, "presenting");
    assert.equal(state.teaching_cursor.gate_id, undefined);
    kernel.append(7, journeyBatches("TS-9502")[6]); // inquiry open + return
    state = kernel.state;
    assert.equal(state.inquiry_cursor, null);
    assert.equal(state.teaching_cursor.beat_id, "BT-02");
    assert.equal(kernel.assertReplayParity().equal, true);
  });

  await runTest("duplicate write does not produce duplicate facts", () => {
    const kernel = kernel5.TutorSessionKernelV5.start(startInput("TS-9503"));
    const batch = journeyBatches("TS-9503")[0].map((event) => ({ ...event, idempotency_key: "TS-9503-retry-0001" }));
    kernel.append(1, batch);
    const before = kernel.state;
    expectCode(() => kernel.append(2, batch), "DUPLICATE_EVENT");
    assert.equal(countEvents("TS-9503"), 2);
    assert.equal(store5.tutorSessionRevisionV5("TS-9503"), 2);
    assert.deepEqual(kernel.state, before, "duplicate append leaves online state untouched");
    assert.equal(kernel.assertReplayParity().equal, true);
    // 重复 session_started 只能经 start 写入；append 路径拒绝。
    expectCode(
      () => kernel.append(2, [ev("session_started", startInput("TS-9503").sessionStarted)]),
      "SESSION_ALREADY_STARTED",
    );
    assert.equal(countEvents("TS-9503"), 2);
  });

  await runTest("stale expected revision rejected without producing facts", () => {
    const kernel = kernel5.TutorSessionKernelV5.start(startInput("TS-9504"));
    kernel.append(1, journeyBatches("TS-9504")[0]);
    expectCode(() => kernel.append(1, journeyBatches("TS-9504")[1]), "REVISION_CONFLICT");
    expectCode(() => kernel.append(99, journeyBatches("TS-9504")[1]), "REVISION_CONFLICT");
    assert.equal(countEvents("TS-9504"), 2);
    assert.equal(store5.tutorSessionRevisionV5("TS-9504"), 2);
  });

  await runTest("event gap fails closed on rebuild (EVENT_GAP)", () => {
    kernel5.TutorSessionKernelV5.start(startInput("TS-9505"));
    // 测试侧模拟损坏：直接 INSERT sequence 3（跳过 2）。读取不做深度校验，
    // 完整性由 rebuilder fail closed。
    insertRawEvent.run(
      "TS-9505",
      3,
      "student_intent_recorded",
      JSON.stringify({ intent_kind: "continue", client_request_id: "cr-0009" }),
      new Date().toISOString(),
      "TS-9505:3",
      5,
      new Date().toISOString(),
      null,
    );
    assert.equal(store5.readTutorSessionEventsV5("TS-9505").length, 2);
    expectCode(() => rebuilder5.verifyCommittedStreamV5("TS-9505"), "EVENT_GAP");
    expectCode(() => rebuilder5.rebuildTutorRuntimeStateV5("TS-9505"), "EVENT_GAP");
  });

  await runTest("corrupt payload and non-monotonic revision fail closed (CORRUPT_EVENT / REVISION_INCONSISTENT)", () => {
    kernel5.TutorSessionKernelV5.start(startInput("TS-9506"));
    // (a) payload_json 非法 JSON。
    insertRawEvent.run(
      "TS-9506",
      2,
      "student_intent_recorded",
      "{not-valid-json",
      new Date().toISOString(),
      "TS-9506:2",
      2,
      new Date().toISOString(),
      null,
    );
    expectCode(() => rebuilder5.rebuildTutorRuntimeStateV5("TS-9506"), "CORRUPT_EVENT");
    // (b) 合法 JSON 但 canonical 校验失败（failed 无 failure_class）。
    kernel5.TutorSessionKernelV5.start(startInput("TS-95060"));
    insertRawEvent.run(
      "TS-95060",
      2,
      "action_outcome_recorded",
      JSON.stringify({ action_id: "VA-TS-95060-1", action_kind: "voice", outcome: "failed" }),
      new Date().toISOString(),
      "TS-95060:2",
      2,
      new Date().toISOString(),
      1,
    );
    expectCode(() => rebuilder5.rebuildTutorRuntimeStateV5("TS-95060"), "CORRUPT_EVENT");
    // (c) recorded_revision 非单调（corruption 家族）。
    const resumable = kernel5.TutorSessionKernelV5.start(startInput("TS-95061"));
    resumable.append(1, [ev("student_intent_recorded", { intent_kind: "continue", client_request_id: "cr-0001" })]);
    insertRawEvent.run(
      "TS-95061",
      3,
      "student_intent_recorded",
      JSON.stringify({ intent_kind: "continue", client_request_id: "cr-0002" }),
      new Date().toISOString(),
      "TS-95061:3",
      1,
      new Date().toISOString(),
      null,
    );
    expectCode(() => rebuilder5.rebuildTutorRuntimeStateV5("TS-95061"), "REVISION_INCONSISTENT");
  });

  await runTest("plan hash/version mismatch fails closed (HASH_MISMATCH)", () => {
    kernel5.TutorSessionKernelV5.start(startInput("TS-9507"));
    // (a) 会话行 pin 被篡改（测试侧 UPDATE 模拟）。
    db.prepare("UPDATE tutor_sessions SET plan_version = 'v9' WHERE session_id = ?").run("TS-9507");
    expectCode(() => rebuilder5.rebuildTutorRuntimeStateV5("TS-9507"), "HASH_MISMATCH");
    // (b) 恢复方 expectedPin 与事件流 pin 不符。
    kernel5.TutorSessionKernelV5.start(startInput("TS-95070"));
    expectCode(
      () =>
        rebuilder5.rebuildTutorRuntimeStateV5("TS-95070", {
          expectedTutorPlanRef: { artifact_id: REF.tutorPlan.artifact_id, version: "v1", content_hash: SHA("wrong") },
        }),
      "HASH_MISMATCH",
    );
    // (c) 非法 version 形状的 pin 在 start 即被 canonical 拒绝（fail closed）。
    expectCode(
      () =>
        kernel5.TutorSessionKernelV5.start(
          startInput("TS-95071", {
            tutorPlanRefOverride: { artifact_id: "TP-SMV-002", version: "v0x", content_hash: SHA("tp-f2") },
          }),
        ),
      "VALIDATION_FAILED",
    );
  });

  await runTest("mid-action crash: issued without outcome / interrupted voice produce no completion side effects", () => {
    const kernel = kernel5.TutorSessionKernelV5.start(startInput("TS-9508"));
    kernel.append(1, [ev("student_intent_recorded", { intent_kind: "submit_answer", text: "角相等", client_request_id: "cr-0001" })]);
    kernel.append(2, [ev("policy_decision_made", decisionPayload("TS-9508", 1), { causation_sequence: 2 })]);
    kernel.append(3, [
      ev("voice_action_issued", voiceIssuedPayload("TS-9508", 1, 1), { causation_sequence: 3 }),
      ev("workspace_surface_action_issued", surfaceIssuedPayload("TS-9508", 1, 1), { causation_sequence: 3 }),
    ]);
    // 「崩溃」：无 outcome 提交。进程重启后（新 kernel 实例=resume）重建。
    const afterCrash = kernel5.TutorSessionKernelV5.resume("TS-9508").state;
    assert.equal(afterCrash.teaching_cursor.phase, "presenting", "issued without executed outcome keeps presenting");
    assert.equal(afterCrash.workspace_revision, 0);
    assert.equal(afterCrash.completed, false);
    assert.deepEqual(afterCrash, kernel.state, "resume state equals pre-crash online state");
    // interrupted / rejected outcomes 同样不产生完成副作用。
    const resumed = kernel5.TutorSessionKernelV5.resume("TS-9508");
    resumed.append(4, [
      ev("action_outcome_recorded", outcomePayload("VA-TS-9508-1", "voice", "interrupted"), { causation_sequence: 4 }),
      ev(
        "action_outcome_recorded",
        outcomePayload("WSA-TS-9508-1", "workspace_surface", "rejected", { message: "target not on current figure" }),
        { causation_sequence: 5 },
      ),
    ]);
    const state = resumed.state;
    assert.equal(state.teaching_cursor.phase, "presenting", "interrupted voice does not complete presentation");
    assert.equal(state.workspace_revision, 0, "rejected workspace action does not advance workspace_revision");
    assert.equal(state.completed, false);
    assert.equal(resumed.assertReplayParity().equal, true);
    // 补齐 completed outcome 后效果才出现（六态区分）。
    resumed.append(5, [
      ev(
        "action_outcome_recorded",
        outcomePayload("WSA-TS-9508-1", "workspace_surface", "completed", { resulting_revision: 4 }),
        { causation_sequence: 5 },
      ),
    ]);
    assert.equal(resumed.state.workspace_revision, 4);
    assert.equal(resumed.assertReplayParity().equal, true);
  });

  await runTest("canonical fixtures consumed by the kernel (session-started / state positive)", () => {
    const fixturesDir = path.resolve(process.cwd(), "../shared/canonical/fixtures");
    const sessionStartedFixture = JSON.parse(
      readFileSync(path.join(fixturesDir, "tutor-session-event.v5.positive.session-started.json"), "utf8"),
    ) as { payload: Record<string, unknown> };
    const kernel = kernel5.TutorSessionKernelV5.start({
      sessionId: "TS-4242",
      studentId: "student-f2",
      sessionStarted: sessionStartedFixture.payload as never,
      occurred_at: new Date().toISOString(),
    });
    const row = store5.getTutorSessionV5("TS-4242");
    assert.equal(row?.event_schema, "v5");
    assert.equal(row?.plan_artifact_id, "TP-SMV-002");
    const events = store5.readTutorSessionEventsV5("TS-4242");
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].payload, sessionStartedFixture.payload, "fixture payload round-trips faithfully");
    assert.deepEqual(
      kernel.state.pinned_plan.tutor_plan_ref,
      (sessionStartedFixture.payload as { tutor_plan_ref: unknown }).tutor_plan_ref,
    );
    assert.equal(kernel.assertReplayParity().equal, true);
    // state/v1 canonical fixture 语义消费（comparator 输入面）。
    const stateFixture = JSON.parse(
      readFileSync(path.join(fixturesDir, "tutor-runtime-state.positive.json"), "utf8"),
    ) as Record<string, unknown>;
    const selfComparison = comparator5.compareTutorRuntimeStatesSemantically(stateFixture, stateFixture);
    assert.equal(selfComparison.equal, true);
  });

  await runTest("contract isolation: v5 vs v1-v4 sessions and causation reference validation", () => {
    // v2 会话拒绝 v5 append（合同隔离），反之 v5 会话拒绝 v2 append。
    legacyStore.startTutorSession({
      sessionId: "TS-9510",
      studentId: "s",
      plan: { artifact_id: "TP-SMV-001", version: "v2", content_hash: SHA("legacy") },
      eventSchema: "v2",
    });
    expectCode(
      () =>
        store5.appendTutorSessionEventsV5("TS-9510", 0, [
          ev("student_intent_recorded", { intent_kind: "continue", client_request_id: "cr-0001" }),
        ]),
      "VALIDATION_FAILED",
    );
    const v5 = kernel5.TutorSessionKernelV5.start(startInput("TS-9511"));
    expectCode(
      () =>
        legacyStore.appendTutorSessionEventsV2("TS-9511", 1, [
          {
            event_type: "student_input_recorded",
            payload: { input_kind: "reasoning_utterance", text: "x" },
            occurred_at: new Date().toISOString(),
          } as never,
        ]),
      "VALIDATION_FAILED",
    );
    // causation 引用校验：指向不存在的前驱 → CAUSATION_REF_INVALID。
    expectCode(
      () =>
        v5.append(1, [
          ev(
            "semantic_interpretation_recorded",
            { intent: "x", reasoning_location: "unknown", confidence: 0.5, interpreter_version: "v1" },
            { causation_sequence: 42 },
          ),
        ]),
      "CAUSATION_REF_INVALID",
    );
    // 缺 causation 必带集成员 → VALIDATION_FAILED。
    expectCode(() => v5.append(1, [ev("policy_decision_made", decisionPayload("TS-9511", 1))]), "VALIDATION_FAILED");
    // v5 会话行存在但缺 session_started（start 中途崩溃的模拟）→ append 拒绝。
    db.prepare(
      `INSERT INTO tutor_sessions (session_id, student_id, plan_artifact_id, plan_version, plan_content_hash, current_mode, revision, started_at, event_schema)
       VALUES ('TS-9512', 's', 'TP-SMV-002', 'v6', ?, 'teach', 0, ?, 'v5')`,
    ).run(SHA("tp-f2"), new Date().toISOString());
    expectCode(
      () =>
        store5.appendTutorSessionEventsV5("TS-9512", 0, [
          ev("student_intent_recorded", { intent_kind: "continue", client_request_id: "cr-0001" }),
        ]),
      "VALIDATION_FAILED",
    );
    expectCode(() => rebuilder5.rebuildTutorRuntimeStateV5("TS-9512"), "MISSING_SESSION_START");
  });

  await runTest("resume fails closed through the verified rebuild path (gap / corrupt / revision / schema / pin)", () => {
    // 2026-08-29 复验修复 #1：resume 必须经 verifyCommittedStreamV5 同一完整性
    // 入口，不得对未校验事件行直接折叠。
    // (a) sequence 1→3 断裂流 → EVENT_GAP（修前 resume 静默返回 state_revision=2）。
    kernel5.TutorSessionKernelV5.start(startInput("TS-9513"));
    insertRawEvent.run(
      "TS-9513", 3, "student_intent_recorded",
      JSON.stringify({ intent_kind: "continue", client_request_id: "cr-0001" }),
      new Date().toISOString(), "TS-9513:3", 2, new Date().toISOString(), null,
    );
    expectCode(() => kernel5.TutorSessionKernelV5.resume("TS-9513"), "EVENT_GAP");
    // (b) payload_json 非法 → CORRUPT_EVENT。
    kernel5.TutorSessionKernelV5.start(startInput("TS-9514"));
    insertRawEvent.run(
      "TS-9514", 2, "student_intent_recorded", "{not-valid-json",
      new Date().toISOString(), "TS-9514:2", 2, new Date().toISOString(), null,
    );
    expectCode(() => kernel5.TutorSessionKernelV5.resume("TS-9514"), "CORRUPT_EVENT");
    // (c) revision 跳跃损坏（1→99）→ REVISION_INCONSISTENT。
    kernel5.TutorSessionKernelV5.start(startInput("TS-9515"));
    insertRawEvent.run(
      "TS-9515", 2, "student_intent_recorded",
      JSON.stringify({ intent_kind: "continue", client_request_id: "cr-0001" }),
      new Date().toISOString(), "TS-9515:2", 99, new Date().toISOString(), null,
    );
    expectCode(() => kernel5.TutorSessionKernelV5.resume("TS-9515"), "REVISION_INCONSISTENT");
    // (d) event_schema≠v5 会话 → SCHEMA_ISOLATION。
    db.prepare(
      `INSERT INTO tutor_sessions (session_id, student_id, plan_artifact_id, plan_version, plan_content_hash, current_mode, revision, started_at, event_schema)
       VALUES ('TS-9516', 's', 'TP-SMV-001', 'v2', ?, 'teach', 1, ?, 'v4')`,
    ).run(SHA("legacy"), new Date().toISOString());
    expectCode(() => kernel5.TutorSessionKernelV5.resume("TS-9516"), "SCHEMA_ISOLATION");
    // (e) 会话行 pin 被篡改 → HASH_MISMATCH；恢复方 expectedTutorPlanRef 不符 → HASH_MISMATCH。
    kernel5.TutorSessionKernelV5.start(startInput("TS-9517"));
    db.prepare("UPDATE tutor_sessions SET plan_content_hash = ? WHERE session_id = ?").run(SHA("tampered"), "TS-9517");
    expectCode(() => kernel5.TutorSessionKernelV5.resume("TS-9517"), "HASH_MISMATCH");
    kernel5.TutorSessionKernelV5.start(startInput("TS-95170"));
    expectCode(
      () => kernel5.TutorSessionKernelV5.resume("TS-95170", { expectedTutorPlanRef: { ...REF.tutorPlan, version: "v1" } }),
      "HASH_MISMATCH",
    );
    // 健康流 resume 行为不变：pin 匹配时正常恢复，state 与会话事实一致。
    const healthy = kernel5.TutorSessionKernelV5.start(startInput("TS-95171"));
    healthy.append(1, [ev("inquiry_opened", { inquiry_id: "IQ-TS-95171-0001", return_beat_id: "BT-01" }, { causation_sequence: 1 })]);
    const resumedHealthy = kernel5.TutorSessionKernelV5.resume("TS-95171", { expectedTutorPlanRef: { ...REF.tutorPlan } });
    assert.deepEqual(resumedHealthy.state, healthy.state);
    assert.equal(resumedHealthy.revision, 2);
    assert.equal(resumedHealthy.assertReplayParity().equal, true);
  });

  await runTest("reducer-rejected batch is refused before persistence (no session poisoning)", () => {
    // 2026-08-29 复验修复 #2：schema 合法但 reducer 拒绝的事件，append 必须在
    // 持久化生效之前失败——事件数/revision/缓存 state 全部不变，rebuild 不毒化。
    const kernel = kernel5.TutorSessionKernelV5.start(startInput("TS-9518"));
    kernel.append(1, [ev("inquiry_opened", { inquiry_id: "IQ-TS-9518-0001", return_beat_id: "BT-01" }, { causation_sequence: 1 })]);
    const stateBefore = kernel.state;
    assert.equal(countEvents("TS-9518"), 2);
    assert.equal(store5.tutorSessionRevisionV5("TS-9518"), 2);
    // return point 不匹配（opened BT-01 vs returned BT-99）→ INQUIRY_RETURN_MISMATCH。
    expectCode(
      () => kernel.append(2, [ev("inquiry_returned", { inquiry_id: "IQ-TS-9518-0001", return_beat_id: "BT-99" }, { causation_sequence: 2 })]),
      "INQUIRY_RETURN_MISMATCH",
    );
    assert.equal(countEvents("TS-9518"), 2, "rejected batch must not persist any event row");
    assert.equal(store5.tutorSessionRevisionV5("TS-9518"), 2, "rejected batch must not advance session revision");
    assert.deepEqual(kernel.state, stateBefore, "rejected batch must not mutate kernel cached state");
    assert.deepEqual(kernel.rebuild(), stateBefore, "session rebuilds cleanly after the rejection");
    assert.equal(kernel.assertReplayParity().equal, true);
    // 会话仍可用：匹配的 return 正常提交。
    kernel.append(2, [ev("inquiry_returned", { inquiry_id: "IQ-TS-9518-0001", return_beat_id: "BT-01" }, { causation_sequence: 2 })]);
    assert.equal(store5.tutorSessionRevisionV5("TS-9518"), 3);
    assert.equal(kernel.state.inquiry_cursor, null);
    assert.equal(kernel.assertReplayParity().equal, true);
    // 直接走 store（绕过 kernel）同样被事务内折叠门禁拦截。
    kernel5.TutorSessionKernelV5.start(startInput("TS-95180"));
    store5.appendTutorSessionEventsV5("TS-95180", 1, [
      ev("inquiry_opened", { inquiry_id: "IQ-TS-95180-0001", return_beat_id: "BT-01" }, { causation_sequence: 1 }),
    ]);
    expectCode(
      () =>
        store5.appendTutorSessionEventsV5("TS-95180", 2, [
          ev("inquiry_returned", { inquiry_id: "IQ-TS-95180-0001", return_beat_id: "BT-77" }, { causation_sequence: 2 }),
        ]),
      "INQUIRY_RETURN_MISMATCH",
    );
    assert.equal(countEvents("TS-95180"), 2);
    // 幂等语义保持：已提交语义批的重放命中 idempotency UNIQUE → DUPLICATE_EVENT
    // （折叠门禁不吞幂等错误），重复写不产生新事实。
    const kernel2 = kernel5.TutorSessionKernelV5.start(startInput("TS-9519"));
    const semanticBatch = [
      ev("inquiry_opened", { inquiry_id: "IQ-TS-9519-0001", return_beat_id: "BT-01" }, { causation_sequence: 1, idempotency_key: "TS-9519-open-0001" }),
      ev("inquiry_returned", { inquiry_id: "IQ-TS-9519-0001", return_beat_id: "BT-01" }, { causation_sequence: 2, idempotency_key: "TS-9519-return-0001" }),
    ];
    kernel2.append(1, semanticBatch);
    assert.equal(countEvents("TS-9519"), 3);
    const stateAfterFirst = kernel2.state;
    expectCode(() => kernel2.append(2, semanticBatch), "DUPLICATE_EVENT");
    assert.equal(countEvents("TS-9519"), 3);
    assert.equal(store5.tutorSessionRevisionV5("TS-9519"), 2);
    assert.deepEqual(kernel2.state, stateAfterFirst);
  });

  await runTest("revision allocation is exact: jump / row mismatch rejected, batch-shared revision accepted", () => {
    // 2026-08-29 复验修复 #3：revision 校验从「非递减」收紧为镜像 store 分配语义。
    // (a) 跳跃：session revision=1、sequence 2 recorded_revision=99 → 拒绝
    //     （修前可重建出 state_revision=99）。
    kernel5.TutorSessionKernelV5.start(startInput("TS-9520"));
    insertRawEvent.run(
      "TS-9520", 2, "student_intent_recorded",
      JSON.stringify({ intent_kind: "continue", client_request_id: "cr-0001" }),
      new Date().toISOString(), "TS-9520:2", 99, new Date().toISOString(), null,
    );
    expectCode(() => rebuilder5.verifyCommittedStreamV5("TS-9520"), "REVISION_INCONSISTENT");
    expectCode(() => rebuilder5.rebuildTutorRuntimeStateV5("TS-9520"), "REVISION_INCONSISTENT");
    expectCode(() => kernel5.TutorSessionKernelV5.resume("TS-9520"), "REVISION_INCONSISTENT");
    // (b) 末事件与 session 行不一致：注入 rev2 事件但行 revision 仍为 1 → 拒绝。
    kernel5.TutorSessionKernelV5.start(startInput("TS-9521"));
    insertRawEvent.run(
      "TS-9521", 2, "student_intent_recorded",
      JSON.stringify({ intent_kind: "continue", client_request_id: "cr-0001" }),
      new Date().toISOString(), "TS-9521:2", 2, new Date().toISOString(), null,
    );
    expectCode(() => rebuilder5.verifyCommittedStreamV5("TS-9521"), "REVISION_INCONSISTENT");
    // (b') 反向：健康流 [1,2] 行被改到 99 → 末事件 2 ≠ 行 99 → 拒绝。
    kernel5.TutorSessionKernelV5.start(startInput("TS-95210"));
    kernel5.TutorSessionKernelV5.resume("TS-95210").append(1, [
      ev("student_intent_recorded", { intent_kind: "continue", client_request_id: "cr-0001" }),
    ]);
    db.prepare("UPDATE tutor_sessions SET revision = 99 WHERE session_id = ?").run("TS-95210");
    expectCode(() => rebuilder5.verifyCommittedStreamV5("TS-95210"), "REVISION_INCONSISTENT");
    // (c) 批内共享 revision 的健康流精确通过：[1,2,2] 且行 revision=2。
    const kernel = kernel5.TutorSessionKernelV5.start(startInput("TS-9522"));
    kernel.append(1, [
      ev("student_intent_recorded", { intent_kind: "submit_answer", text: "角相等", client_request_id: "cr-0001" }),
      ev("semantic_interpretation_recorded", { intent: "derive_ratio_via_similarity", reasoning_location: "aligned", confidence: 0.92, interpreter_version: "interpreter/v1" }, { causation_sequence: 2 }),
    ]);
    const verified = rebuilder5.verifyCommittedStreamV5("TS-9522");
    assert.deepEqual(verified.events.map((event: { sequence: number; state_revision: number }) => [event.sequence, event.state_revision]), [[1, 1], [2, 2], [3, 2]]);
    assert.equal(verified.session.revision, 2);
    assert.equal(kernel.assertReplayParity().equal, true);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
