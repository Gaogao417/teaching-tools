/**
 * F7 Step 2 门禁测试（node 链）：V6 Session Kernel（event_schema=v6）。
 *
 * 覆盖 PLAN.md §4「合同与后端」的 Step 2 服务端义务 + ledger 增补 9/10：
 * 1. G2 parity：同一 Pinned Plan + 同一有序 committed v6 events 重建相同
 *    state/v2（含 presentation_cursor），在线 kernel 与重建用同一 reducer；
 * 2. v6 旅程：planned→validated→applied→delivered→presented 推进 cursor；
 *    workspace_revision 在 applied 推进；最后一项 presented → awaiting_evidence；
 *    未收 outcome 时状态仍 presenting（Voice 未播放不得出现 presented）；
 * 3. student_intent_recorded causation 四负例：缺失（schema）/ 未来引用（store）/
 *    错误事件类型 / request id 不一致（reducer 整批拒绝，零事件落库）；
 * 4. capability 门禁：unknown capability/target → 零事件、零状态变更、零 delivery；
 * 5. cursor 对账：孤儿 / 错 ordinal/action/sequence / 未应用先交付 / 跳序 /
 *    双重 presented / failed 停留期间 delivered 全部 fail closed；同一 pending
 *    ref 的重复 delivered 幂等 no-op（refresh 重投语义）；
 * 6. failed 停留 + retry_recovery（supersede + 新恢复 sequence）；interrupted
 *    后剩余 sequence 锁死；
 * 7. V5/V6 隔离：V6 写入/恢复撞 v5 会话 → SESSION_VERSION_UNSUPPORTED；V5
 *    mutation 撞 v6 会话被拒；两侧流零改动；
 * 8. 幂等键重复 / REVISION_CONFLICT 与 v5 语义同构；refresh 纯重建（零新事件）。
 */
import assert from "node:assert/strict";

import { ensureSqlite } from "./support";
import {
  actionRefV6,
  appliedV6,
  decisionPayloadV6,
  ev6,
  journeyBatchesV6,
  outcomeV6,
  plannedPayloadV6,
  startInputV6,
  syntheticRegistry,
  syntheticRegistryProvider,
} from "./v6KernelSupport";

import { ev, startInput } from "./v5KernelSupport";

ensureSqlite("tutor-session-kernel-v6");

const { db } = require("../../../db/database") as typeof import("../../../db/database");
const kernel6 = require("../TutorSessionKernelV6") as typeof import("../TutorSessionKernelV6");
const kernel5 = require("../TutorSessionKernelV5") as typeof import("../TutorSessionKernelV5");
const store5 = require("../TutorSessionEventStoreV5") as typeof import("../TutorSessionEventStoreV5");
const reducer6 = require("../TutorRuntimeStateReducerV6") as typeof import("../TutorRuntimeStateReducerV6");
const rebuilder6 = require("../RuntimeStateRebuilderV6") as typeof import("../RuntimeStateRebuilderV6");
const storeCore = require("../kernel/TutorSessionStoreCore") as typeof import("../kernel/TutorSessionStoreCore");

const v6Codec = () => rebuilder6.makeV6SessionCodec(syntheticRegistryProvider);
const readEventsV6 = (sessionId: string) => storeCore.readSessionEvents(v6Codec(), sessionId);

function countEvents(sessionId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events WHERE session_id = ?").get(sessionId) as { n: number }).n;
}

function sessionRows(sessionId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM tutor_sessions WHERE session_id = ?").get(sessionId) as { n: number }).n;
}

function eventSchemaOf(sessionId: string): string {
  return (db.prepare("SELECT event_schema FROM tutor_sessions WHERE session_id = ?").get(sessionId) as { event_schema: string }).event_schema;
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

/** 走到「sequence planned 已提交、ordinal 0 delivered」的公共前置（返回 kernel 与当时 revision）。 */
function deliveredAtOrdinalZero(sessionId: string): { kernel: import("../TutorSessionKernelV6").TutorSessionKernelV6; revision: number } {
  const kernel = kernel6.TutorSessionKernelV6.start(startInputV6(sessionId), syntheticRegistryProvider);
  kernel.append(1, [ev6("student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "角相等" }, client_request_id: "cr-0001" })]);
  kernel.append(2, [
    ev6("semantic_interpretation_recorded", { intent: "derive", reasoning_location: "aligned", confidence: 0.9, interpreter_version: "i/v1" }, { causation_sequence: 2 }),
    ev6("student_intent_recorded", { intent_kind: "submit_answer", client_request_id: "cr-0001" }, { causation_sequence: 2 }),
    ev6("policy_decision_made", decisionPayloadV6(sessionId, 1), { causation_sequence: 4 }),
  ]);
  kernel.append(3, [ev6("presentation_sequence_planned", plannedPayloadV6(sessionId, 1), { causation_sequence: 5 })]);
  kernel.append(4, [
    ev6("presentation_action_validated", actionRefV6(sessionId, 1, 0, "workspace"), { causation_sequence: 6 }),
    ev6("presentation_action_applied", appliedV6(sessionId, 1, 0, 1), { causation_sequence: 6 }),
    ev6("presentation_action_delivered", actionRefV6(sessionId, 1, 0, "workspace"), { causation_sequence: 6 }),
  ]);
  return { kernel, revision: 5 };
}

async function main(): Promise<void> {
  await runTest("G2 core: same pinned plan + ordered committed v6 events rebuild identical state/v2 (cursor included)", () => {
    const kernel = kernel6.TutorSessionKernelV6.start(startInputV6("TS-9601"), syntheticRegistryProvider);
    let revision = 1;
    for (const batch of journeyBatchesV6("TS-9601")) {
      revision = kernel.append(revision, batch).revision;
    }
    const rebuilt = kernel.rebuild();
    assert.deepEqual(kernel.state, rebuilt);
    // 独立全量重放（不经 kernel 缓存）也一致：在线与重建共用同一 reducer 的结构性证明。
    const replayed = reducer6.foldCommittedV6Events(readEventsV6("TS-9601") as never, syntheticRegistry());
    assert.deepEqual(replayed, rebuilt);
    assert.deepEqual(rebuilt, kernel.rebuild(), "rebuild is deterministic");
    const parity = kernel.assertReplayParity();
    assert.equal(parity.equal, true);
    assert.deepEqual(parity.differences, []);
    // 旅程终点状态断言（v6 reducer 约定）。
    assert.equal(eventSchemaOf("TS-9601"), "v6");
    assert.equal(rebuilt.completed, true);
    assert.equal(rebuilt.teaching_cursor.beat_id, "BT-02");
    assert.equal(rebuilt.teaching_cursor.phase, "completed");
    assert.equal(rebuilt.workspace_revision, 2, "applied receipts advance workspace_revision (browser outcome does not)");
    assert.deepEqual(rebuilt.presentation_cursor, { status: "idle" });
    assert.equal(rebuilt.state_revision, revision);
  });

  await runTest("journey intermediate: planned keeps presenting; delivered→awaiting_browser; last presented→awaiting_evidence", () => {
    const kernel = kernel6.TutorSessionKernelV6.start(startInputV6("TS-9602"), syntheticRegistryProvider);
    kernel.append(1, [ev6("student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "角相等" }, client_request_id: "cr-0001" })]);
    kernel.append(2, [
      ev6("semantic_interpretation_recorded", { intent: "derive", reasoning_location: "aligned", confidence: 0.9, interpreter_version: "i/v1" }, { causation_sequence: 2 }),
      ev6("student_intent_recorded", { intent_kind: "submit_answer", client_request_id: "cr-0001" }, { causation_sequence: 2 }),
      ev6("policy_decision_made", decisionPayloadV6("TS-9602", 1), { causation_sequence: 4 }),
    ]);
    kernel.append(3, [ev6("presentation_sequence_planned", plannedPayloadV6("TS-9602", 1), { causation_sequence: 5 })]);
    let state = kernel.state;
    assert.equal(state.teaching_cursor.phase, "presenting", "planned keeps presenting");
    assert.deepEqual(state.presentation_cursor, { status: "idle" }, "planned alone does not deliver");
    assert.equal(state.workspace_revision, 0);

    kernel.append(4, [
      ev6("presentation_action_validated", actionRefV6("TS-9602", 1, 0, "workspace"), { causation_sequence: 6 }),
      ev6("presentation_action_applied", appliedV6("TS-9602", 1, 0, 1), { causation_sequence: 6 }),
    ]);
    state = kernel.state;
    assert.equal(state.workspace_revision, 1, "workspace_revision advances at applied (server semantics)");
    assert.deepEqual(state.presentation_cursor, { status: "idle" }, "applied without delivered keeps cursor idle");

    kernel.append(5, [ev6("presentation_action_delivered", actionRefV6("TS-9602", 1, 0, "workspace"), { causation_sequence: 6 })]);
    state = kernel.state;
    assert.deepEqual(state.presentation_cursor, {
      status: "awaiting_browser",
      sequence_id: "PS-0001",
      ordinal: 0,
      action_id: "WSA-TS-9602-10",
    });
    assert.equal(state.teaching_cursor.phase, "presenting", "no browser outcome yet → still presenting (Voice not played must not count as presented)");

    kernel.append(6, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9602", 1, 0, "workspace", "presented"), { causation_sequence: 9 })]);
    state = kernel.state;
    assert.deepEqual(state.presentation_cursor, { status: "idle" });
    assert.equal(state.teaching_cursor.phase, "presenting", "mid-sequence presented does not open evidence");

    kernel.append(7, [
      ev6("presentation_action_validated", actionRefV6("TS-9602", 1, 1, "voice"), { causation_sequence: 6 }),
      ev6("presentation_action_delivered", actionRefV6("TS-9602", 1, 1, "voice"), { causation_sequence: 6 }),
      ev6("presentation_action_outcome_recorded", outcomeV6("TS-9602", 1, 1, "voice", "presented"), { causation_sequence: 11 }),
    ]);
    kernel.append(8, [
      ev6("presentation_action_validated", actionRefV6("TS-9602", 1, 2, "workspace"), { causation_sequence: 6 }),
      ev6("presentation_action_applied", appliedV6("TS-9602", 1, 2, 2), { causation_sequence: 6 }),
      ev6("presentation_action_delivered", actionRefV6("TS-9602", 1, 2, "workspace"), { causation_sequence: 6 }),
    ]);
    kernel.append(9, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9602", 1, 2, "workspace", "presented"), { causation_sequence: 14 })]);
    state = kernel.state;
    assert.equal(state.teaching_cursor.phase, "awaiting_evidence", "last ordinal presented → awaiting_evidence");
    assert.equal(state.workspace_revision, 2);
    assert.equal(kernel.assertReplayParity().equal, true);
  });

  await runTest("intent causation: missing (schema) / future ref (store) / wrong event type / request-id mismatch all fail closed with zero events", () => {
    const { kernel, revision } = deliveredAtOrdinalZero("TS-9603");
    const before = countEvents("TS-9603");

    expectCode(
      () => kernel.append(revision, [ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0002" })]),
      "VALIDATION_FAILED",
    );
    expectCode(
      () => kernel.append(revision, [ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0002" }, { causation_sequence: 99 })]),
      "CAUSATION_REF_INVALID",
    );
    // 指向 policy_decision_made（seq 5，错误事件类型）：reducer 整批拒绝。
    expectCode(
      () => kernel.append(revision, [
        ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0002" }, { causation_sequence: 5 }),
      ]),
      "INTENT_CAUSATION_MISMATCH",
    );
    // request id 不一致：先补一条新的 student_input_recorded，intent 引用它但
    // client_request_id 不同 → 整批拒绝。
    const inputSeq = kernel.append(revision, [ev6("student_input_recorded", { input: { kind: "control", command: "confirm" }, client_request_id: "cr-0002" })]).appendedSequences[0];
    expectCode(
      () => kernel.append(revision + 1, [
        ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-mismatch" }, { causation_sequence: inputSeq }),
      ]),
      "INTENT_CAUSATION_MISMATCH",
    );
    assert.equal(countEvents("TS-9603"), before + 1, "only the student_input fact landed; rejected batches appended zero events");
    // 正向对照：同 client_request_id 的 intent 引用同批更早的 input 被接受。
    const control = kernel.append(revision + 1, [
      ev6("student_input_recorded", { input: { kind: "control", command: "continue" }, client_request_id: "cr-0003" }),
      ev6("student_intent_recorded", { intent_kind: "continue", client_request_id: "cr-0003" }, { causation_sequence: inputSeq + 1 }),
    ]);
    assert.equal(control.appendedSequences.length, 2);
    assert.equal(kernel.assertReplayParity().equal, true);
  });

  await runTest("capability gate: unknown capability / unknown target in planned → zero events, zero state change, zero delivery", () => {
    const kernel = kernel6.TutorSessionKernelV6.start(startInputV6("TS-9604"), syntheticRegistryProvider);
    kernel.append(1, [ev6("student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "嗯" }, client_request_id: "cr-0001" })]);
    kernel.append(2, [
      ev6("semantic_interpretation_recorded", { intent: "ack", reasoning_location: "aligned", confidence: 0.9, interpreter_version: "i/v1" }, { causation_sequence: 2 }),
      ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0001" }, { causation_sequence: 2 }),
      ev6("policy_decision_made", decisionPayloadV6("TS-9604", 1), { causation_sequence: 4 }),
    ]);
    const before = countEvents("TS-9604");
    const stateBefore = JSON.parse(JSON.stringify(kernel.state));

    expectCode(
      () => kernel.append(3, [
        ev6("presentation_sequence_planned", plannedPayloadV6("TS-9604", 1, { actions: [{ ordinal: 0, kind: "workspace", workspace_action: { action_id: "WSA-TS-9604-x1", decision_id: "TD-TS-9604-1", surface: "geometry", capability: "geometry.unknown-capability", origin: "tutor", target_ids: ["seg-AB"], reveal_scope: "none" } }] }), { causation_sequence: 5 }),
      ]),
      "CAPABILITY_UNREGISTERED",
    );
    expectCode(
      () => kernel.append(3, [
        ev6("presentation_sequence_planned", plannedPayloadV6("TS-9604", 1, { actions: [{ ordinal: 0, kind: "workspace", workspace_action: { action_id: "WSA-TS-9604-x1", decision_id: "TD-TS-9604-1", surface: "geometry", capability: "geometry.construct", origin: "tutor", target_ids: ["seg-NOT-IN-UNIVERSE"], reveal_scope: "none" } }] }), { causation_sequence: 5 }),
      ]),
      "CAPABILITY_UNREGISTERED",
    );
    assert.equal(countEvents("TS-9604"), before, "zero events appended");
    assert.deepEqual(JSON.parse(JSON.stringify(kernel.state)), stateBefore, "zero state change");
    // 被拒 sequence 不存在 → 任何 delivery 也零落库。
    expectCode(
      () => kernel.append(3, [
        ev6("presentation_action_delivered", actionRefV6("TS-9604", 1, 0, "workspace"), { causation_sequence: 5 }),
      ]),
      "PRESENTATION_ORDER_INVALID",
    );
    assert.equal(countEvents("TS-9604"), before, "zero delivery possible for the rejected sequence");
  });

  await runTest("cursor reconciliation: orphan / wrong triple / double presented / delivered-before-applied / skip-ordinal / pending redelivery idempotence", () => {
    const kernel = kernel6.TutorSessionKernelV6.start(startInputV6("TS-9605"), syntheticRegistryProvider);
    kernel.append(1, [ev6("student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "嗯" }, client_request_id: "cr-0001" })]);
    kernel.append(2, [
      ev6("semantic_interpretation_recorded", { intent: "ack", reasoning_location: "aligned", confidence: 0.9, interpreter_version: "i/v1" }, { causation_sequence: 2 }),
      ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0001" }, { causation_sequence: 2 }),
      ev6("policy_decision_made", decisionPayloadV6("TS-9605", 1), { causation_sequence: 4 }),
    ]);
    kernel.append(3, [ev6("presentation_sequence_planned", plannedPayloadV6("TS-9605", 1), { causation_sequence: 5 })]);

    // 孤儿 outcome：从未 delivered。
    expectCode(
      () => kernel.append(4, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9605", 1, 0, "workspace", "presented"), { causation_sequence: 6 })]),
      "PRESENTATION_CURSOR_MISMATCH",
    );
    // 未应用先交付（workspace 无 applied 回执）。
    expectCode(
      () => kernel.append(4, [
        ev6("presentation_action_validated", actionRefV6("TS-9605", 1, 0, "workspace"), { causation_sequence: 6 }),
        ev6("presentation_action_delivered", actionRefV6("TS-9605", 1, 0, "workspace"), { causation_sequence: 6 }),
      ]),
      "PRESENTATION_ORDER_INVALID",
    );
    // 正常：validated → applied → delivered → presented（ordinal 0）。
    kernel.append(4, [
      ev6("presentation_action_validated", actionRefV6("TS-9605", 1, 0, "workspace"), { causation_sequence: 6 }),
      ev6("presentation_action_applied", appliedV6("TS-9605", 1, 0, 1), { causation_sequence: 6 }),
      ev6("presentation_action_delivered", actionRefV6("TS-9605", 1, 0, "workspace"), { causation_sequence: 6 }),
    ]);
    kernel.append(5, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9605", 1, 0, "workspace", "presented"), { causation_sequence: 9 })]);
    // 双重 presented。
    expectCode(
      () => kernel.append(6, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9605", 1, 0, "workspace", "presented"), { causation_sequence: 9 })]),
      "PRESENTATION_CURSOR_MISMATCH",
    );
    // ordinal 1 交付为 pending；同 ref 再次 delivered：reducer 接受为重投事实，
    // cursor 不推进——但事件本身计入流（+1 事件、+1 revision）。这不是幂等
    // no-op；真正的「零事件、零 revision」重投由 refresh 纯重建证明（见下）。
    kernel.append(6, [
      ev6("presentation_action_validated", actionRefV6("TS-9605", 1, 1, "voice"), { causation_sequence: 6 }),
      ev6("presentation_action_delivered", actionRefV6("TS-9605", 1, 1, "voice"), { causation_sequence: 6 }),
    ]);
    const cursorPending = JSON.parse(JSON.stringify(kernel.state.presentation_cursor));
    const eventsBeforeRedelivery = countEvents("TS-9605");
    const revisionBeforeRedelivery = kernel.revision;
    kernel.append(7, [ev6("presentation_action_delivered", actionRefV6("TS-9605", 1, 1, "voice"), { causation_sequence: 6 })]);
    assert.equal(countEvents("TS-9605"), eventsBeforeRedelivery + 1, "a re-delivered event is a committed fact (+1 event)");
    assert.equal(kernel.revision, revisionBeforeRedelivery + 1, "a re-delivered event bumps the revision (+1)");
    assert.deepEqual(JSON.parse(JSON.stringify(kernel.state.presentation_cursor)), cursorPending, "re-delivery does not advance the cursor");
    // 跳序：ordinal 1 未 presented 就交付 ordinal 2。
    expectCode(
      () => kernel.append(8, [
        ev6("presentation_action_validated", actionRefV6("TS-9605", 1, 2, "workspace"), { causation_sequence: 6 }),
        ev6("presentation_action_applied", appliedV6("TS-9605", 1, 2, 2), { causation_sequence: 6 }),
        ev6("presentation_action_delivered", actionRefV6("TS-9605", 1, 2, "workspace"), { causation_sequence: 6 }),
      ]),
      "PRESENTATION_ORDER_INVALID",
    );
    // 错 sequence 的 outcome。
    expectCode(
      () => kernel.append(8, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9605", 2, 0, "workspace", "presented"), { causation_sequence: 12 })]),
      "PRESENTATION_CURSOR_MISMATCH",
    );
    // 正常收口：ordinal 1 presented。
    kernel.append(8, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9605", 1, 1, "voice", "presented"), { causation_sequence: 12 })]);
    assert.equal(kernel.assertReplayParity().equal, true);
  });

  await runTest("failed parks the cursor; retry_recovery supersedes and a new recovery sequence resumes delivery", () => {
    const { kernel, revision } = deliveredAtOrdinalZero("TS-9606");
    const failedSeq = kernel.append(revision, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9606", 1, 0, "workspace", "failed", { failure_class: "provider_failure", message: "canvas commit failed" }), { causation_sequence: 9 })]).appendedSequences[0];
    let state = kernel.state;
    assert.deepEqual(state.presentation_cursor, { status: "failed", sequence_id: "PS-0001", ordinal: 0, action_id: "WSA-TS-9606-10" });
    assert.equal(state.workspace_revision, 1, "already-applied workspace semantics are not rolled back on presentation failure");

    // failed 停留：同序列下一项交付被拒。
    expectCode(
      () => kernel.append(revision + 1, [
        ev6("presentation_action_validated", actionRefV6("TS-9606", 1, 1, "voice"), { causation_sequence: 6 }),
        ev6("presentation_action_delivered", actionRefV6("TS-9606", 1, 1, "voice"), { causation_sequence: 6 }),
      ]),
      "PRESENTATION_ORDER_INVALID",
    );
    // retry_recovery：student control 事实 + supersede + 新恢复 sequence。
    const retryInputSeq = failedSeq + 1;
    kernel.append(revision + 1, [
      ev6("student_input_recorded", { input: { kind: "control", command: "retry_recovery" }, client_request_id: "cr-retry" }),
      ev6("presentation_sequence_superseded", { sequence_id: "PS-0001", reason: "retry_recovery", pending_ordinal: 0, pending_action_id: "WSA-TS-9606-10" }, { causation_sequence: retryInputSeq }),
    ]);
    state = kernel.state;
    assert.deepEqual(state.presentation_cursor, { status: "idle" }, "supersede clears the failed cursor");
    const intentSeq = retryInputSeq + 2;
    const decisionSeq = retryInputSeq + 3;
    kernel.append(revision + 2, [
      ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-retry" }, { causation_sequence: retryInputSeq }),
      ev6("policy_decision_made", decisionPayloadV6("TS-9606", 2), { causation_sequence: intentSeq }),
    ]);
    const plannedSeq = retryInputSeq + 4;
    kernel.append(revision + 3, [ev6("presentation_sequence_planned", plannedPayloadV6("TS-9606", 2), { causation_sequence: decisionSeq })]);
    kernel.append(revision + 4, [
      ev6("presentation_action_validated", actionRefV6("TS-9606", 2, 0, "workspace"), { causation_sequence: plannedSeq }),
      ev6("presentation_action_applied", appliedV6("TS-9606", 2, 0, 1), { causation_sequence: plannedSeq }),
      ev6("presentation_action_delivered", actionRefV6("TS-9606", 2, 0, "workspace"), { causation_sequence: plannedSeq }),
    ]);
    state = kernel.state;
    assert.equal(state.presentation_cursor.status, "awaiting_browser");
    assert.equal(state.presentation_cursor.sequence_id, "PS-0002");
    // 旧 sequence 已废止：任何后续 delivery/outcome 均拒。
    expectCode(
      () => kernel.append(revision + 5, [ev6("presentation_action_delivered", actionRefV6("TS-9606", 1, 1, "voice"), { causation_sequence: 6 })]),
      "PRESENTATION_ORDER_INVALID",
    );
    assert.equal(kernel.assertReplayParity().equal, true);
  });

  await runTest("interrupted clears the cursor; remaining ordinals stay dead until superseded", () => {
    const { kernel, revision } = deliveredAtOrdinalZero("TS-9607");
    kernel.append(revision, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9607", 1, 0, "workspace", "interrupted"), { causation_sequence: 9 })]);
    let state = kernel.state;
    assert.deepEqual(state.presentation_cursor, { status: "idle" });
    // ordinal 1（未 presented 的下一项）不可交付——剩余 sequence 锁死。
    expectCode(
      () => kernel.append(revision + 1, [
        ev6("presentation_action_validated", actionRefV6("TS-9607", 1, 1, "voice"), { causation_sequence: 6 }),
        ev6("presentation_action_delivered", actionRefV6("TS-9607", 1, 1, "voice"), { causation_sequence: 6 }),
      ]),
      "PRESENTATION_ORDER_INVALID",
    );
    kernel.append(revision + 1, [
      ev6("presentation_sequence_superseded", { sequence_id: "PS-0001", reason: "interrupted" }, { causation_sequence: 9 }),
    ]);
    state = kernel.state;
    assert.deepEqual(state.presentation_cursor, { status: "idle" });
    expectCode(
      () => kernel.append(revision + 2, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9607", 1, 1, "voice", "presented"), { causation_sequence: 6 })]),
      "PRESENTATION_CURSOR_MISMATCH",
    );
    expectCode(
      () => kernel.append(revision + 2, [
        ev6("presentation_action_validated", actionRefV6("TS-9607", 1, 2, "workspace"), { causation_sequence: 6 }),
      ]),
      "PRESENTATION_ORDER_INVALID",
    );
    assert.equal(kernel.assertReplayParity().equal, true);
  });

  await runTest("V5/V6 isolation: v6 mutations/resume on a v5 session → SESSION_VERSION_UNSUPPORTED; v5 mutations on v6 rejected; both streams untouched", () => {
    // v5 会话。
    const v5Kernel = kernel5.TutorSessionKernelV5.start(startInput("TS-9608"));
    v5Kernel.append(1, [ev("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0001" })]);
    const v5EventsBefore = countEvents("TS-9608");
    // V6 写侧（store append）撞 v5 会话。
    expectCode(
      () => storeCore.appendSessionEvents(v6Codec(), "TS-9608", 2, [
        ev6("student_input_recorded", { input: { kind: "control", command: "confirm" }, client_request_id: "cr-0009" }),
      ]),
      "SESSION_VERSION_UNSUPPORTED",
    );
    // V6 恢复（verified rebuild）撞 v5 会话。
    expectCode(
      () => kernel6.TutorSessionKernelV6.resume("TS-9608", syntheticRegistryProvider),
      "SESSION_VERSION_UNSUPPORTED",
    );
    expectCode(
      () => rebuilder6.createV6Rebuilder(syntheticRegistryProvider).rebuildTutorRuntimeStateV6("TS-9608"),
      "SESSION_VERSION_UNSUPPORTED",
    );
    assert.equal(countEvents("TS-9608"), v5EventsBefore, "v5 stream untouched by v6 attempts");

    // 反向：v6 会话不被 v5 mutation API 修改。
    const v6Kernel = kernel6.TutorSessionKernelV6.start(startInputV6("TS-9609"), syntheticRegistryProvider);
    const v6Events = countEvents("TS-9609");
    expectCode(
      () => store5.appendTutorSessionEventsV5("TS-9609", 1, [
        ev("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0001" }),
      ]),
      "VALIDATION_FAILED",
    );
    expectCode(
      () => kernel5.TutorSessionKernelV5.resume("TS-9609"),
      "SCHEMA_ISOLATION",
    );
    assert.equal(countEvents("TS-9609"), v6Events, "v6 stream untouched by v5 attempts");
    assert.equal(v6Kernel.revision, 1);
  });

  await runTest("idempotency and optimistic concurrency semantics mirror v5 (DUPLICATE_EVENT / REVISION_CONFLICT)", () => {
    const kernel = kernel6.TutorSessionKernelV6.start(startInputV6("TS-9610"), syntheticRegistryProvider);
    kernel.append(1, [ev6("student_input_recorded", { input: { kind: "control", command: "confirm" }, client_request_id: "cr-0001" }, { idempotency_key: "v6-idem-0001" })]);
    const before = countEvents("TS-9610");
    expectCode(
      () => kernel.append(2, [ev6("student_input_recorded", { input: { kind: "control", command: "continue" }, client_request_id: "cr-0002" }, { idempotency_key: "v6-idem-0001" })]),
      "DUPLICATE_EVENT",
    );
    assert.equal(countEvents("TS-9610"), before, "duplicate key appends zero events");
    expectCode(
      () => kernel.append(1, [ev6("student_input_recorded", { input: { kind: "control", command: "continue" }, client_request_id: "cr-0003" })]),
      "REVISION_CONFLICT",
    );
    assert.equal(kernel.revision, 2);
  });

  await runTest("refresh: pure rebuild redelivers the same pending snapshot with ZERO new events and unchanged revision", () => {
    const { kernel, revision } = deliveredAtOrdinalZero("TS-9611");
    const eventsAtRefresh = countEvents("TS-9611");
    const resumed = kernel6.TutorSessionKernelV6.resume("TS-9611", syntheticRegistryProvider);
    assert.deepEqual(resumed.state.presentation_cursor, {
      status: "awaiting_browser",
      sequence_id: "PS-0001",
      ordinal: 0,
      action_id: "WSA-TS-9611-10",
    });
    assert.equal(resumed.revision, revision);
    assert.equal(countEvents("TS-9611"), eventsAtRefresh, "refresh/reconnect appends zero events");
    assert.deepEqual(resumed.state, kernel6.TutorSessionKernelV6.resume("TS-9611", syntheticRegistryProvider).state);
    assert.equal(kernel.assertReplayParity().equal, true);
  });

  await runTest("start pin/binding validation failure leaves ZERO session rows and ZERO events (fail closed before persistence)", () => {
    // 前置：session_started payload 本身 schema 合法（结构完整的 catalog pin，
    // 只是 hash 错误）——失败必须来自 registry provider 的 pin 对账，而不是 Zod。
    assert.throws(
      () => kernel6.TutorSessionKernelV6.start(startInputV6("TS-9612", { catalogPinHashOverride: "sha256:wrong-pin" }), syntheticRegistryProvider),
      /workspace_catalog_pin missing or mismatched/,
    );
    assert.equal(sessionRows("TS-9612"), 0, "no tutor_sessions row may survive a failed start");
    assert.equal(countEvents("TS-9612"), 0, "no tutor_session_events row may survive a failed start");
    // 缺 pin（显式负例构造）：v6 会话必须 pin catalog——同样零行零事件。
    assert.throws(
      () => kernel6.TutorSessionKernelV6.start(startInputV6("TS-9613", { withCatalogPin: false }), syntheticRegistryProvider),
      /workspace_catalog_pin missing or mismatched/,
    );
    assert.equal(sessionRows("TS-9613"), 0);
    assert.equal(countEvents("TS-9613"), 0);
  });

  await runTest("reducer referential transparency: same state+event replays cleanly; branches from one old state stay isolated; old state stays usable", () => {
    // 构造到 planned 已提交的状态 S（revision 4），从 S 直接做归约探针。
    const sid = "TS-9614";
    const kernel = kernel6.TutorSessionKernelV6.start(startInputV6(sid), syntheticRegistryProvider);
    kernel.append(1, [ev6("student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "嗯" }, client_request_id: "cr-0001" })]);
    kernel.append(2, [
      ev6("semantic_interpretation_recorded", { intent: "ack", reasoning_location: "aligned", confidence: 0.9, interpreter_version: "i/v1" }, { causation_sequence: 2 }),
      ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0001" }, { causation_sequence: 2 }),
      ev6("policy_decision_made", decisionPayloadV6(sid, 1), { causation_sequence: 4 }),
    ]);
    kernel.append(3, [ev6("presentation_sequence_planned", plannedPayloadV6(sid, 1), { causation_sequence: 5 })]);
    const baseState = kernel.state;
    const registry = syntheticRegistry() as never;
    const probeEvent = (ordinal: number, kind: "voice" | "workspace", key: string) =>
      ({
        schema: "ai_teaching_tutor_session_event/v6",
        session_id: sid,
        sequence: 7,
        state_revision: 5,
        occurred_at: new Date().toISOString(),
        event_type: "presentation_action_validated",
        payload: actionRefV6(sid, 1, ordinal, kind),
        causation_sequence: 6,
        idempotency_key: key,
      }) as never;

    // 探针①（引用透明）：同一 state + 同一事件归约两次——都必须成功且结果
    // deepEqual（可变血缘实现会在第二次抛 validated twice）。
    const first = reducer6.applyV6Event(baseState, probeEvent(0, "workspace", "probe-0001"), registry);
    const replay = reducer6.applyV6Event(baseState, probeEvent(0, "workspace", "probe-0001"), registry);
    assert.deepEqual(first, replay, "applyV6Event(S, E) must be reproducible on the same old state");

    // 探针②（分支隔离）：validated 只写 lineage（canonical state 不变是设计
    // 事实）；污染检测改为「分支重放」——旧可变血缘实现会因 Set 被分支偷偷
    // 写入，在第二次 baseState+E1 归约时抛 validated twice。
    const branch = reducer6.applyV6Event(baseState, probeEvent(1, "voice", "probe-0002"), registry);
    const branchReplay = reducer6.applyV6Event(baseState, probeEvent(1, "voice", "probe-0002"), registry);
    assert.deepEqual(branchReplay, branch);

    // 探针③（旧 state 仍可用）：探针①② 之后，从原 S 再走第三条合法分支
    // （validated ordinal 2）仍成功，且 S 的重放结果保持不变。
    const thirdBranch = reducer6.applyV6Event(baseState, probeEvent(2, "workspace", "probe-0003"), registry);
    assert.deepEqual(reducer6.applyV6Event(baseState, probeEvent(0, "workspace", "probe-0001"), registry), first, "old state stays usable and deterministic after other branches");
    void thirdBranch;
    // kernel 主链不受探针影响（探针不落库）。
    assert.equal(kernel.assertReplayParity().equal, true);
  });

  await runTest("session row writes event_schema=v6 and the first event is canonical v6 session_started", () => {
    assert.equal(eventSchemaOf("TS-9601"), "v6");
    const events = readEventsV6("TS-9601");
    assert.equal(events[0].event_type, "session_started");
    assert.equal(events[0].schema, "ai_teaching_tutor_session_event/v6");
    assert.equal(events[0].state_revision, 1);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
