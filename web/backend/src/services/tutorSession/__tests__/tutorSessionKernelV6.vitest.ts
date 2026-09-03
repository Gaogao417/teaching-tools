/**
 * F7 Step 2 门禁测试（vitest 链）：V6 Session Kernel。
 *
 * node 链（tutorSessionKernelV6.test.ts）承载完整义务矩阵；本文件复盖关键
 * 不变量在 vitest 进程图（独立 SQLITE_PATH）下的同一裁决：G2 parity、
 * intent causation、capability fail closed、cursor 对账、failed/retry、
 * V5/V6 隔离、pending 重投幂等。
 */
import { describe, expect, it } from "vitest";

import {
  actionRefV6,
  appliedV6,
  decisionPayloadV6,
  ev6,
  outcomeV6,
  plannedPayloadV6,
  startInputV6,
  syntheticRegistry,
  syntheticRegistryProvider,
} from "./v6KernelSupport";
import { ev, startInput } from "./v5KernelSupport";
import { db } from "../../../db/database";
import { applyV6Event } from "../TutorRuntimeStateReducerV6";
import { TutorSessionKernelV6 } from "../TutorSessionKernelV6";
import { TutorSessionKernelV5 } from "../TutorSessionKernelV5";
import { appendTutorSessionEventsV5 } from "../TutorSessionEventStoreV5";
import { makeV6SessionCodec } from "../RuntimeStateRebuilderV6";
import { appendSessionEvents } from "../kernel/TutorSessionStoreCore";

/** 走到「sequence planned、ordinal 0 validated/applied/delivered」的公共前置。 */
function deliveredAtOrdinalZero(sessionId: string) {
  const kernel = TutorSessionKernelV6.start(startInputV6(sessionId), syntheticRegistryProvider);
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

describe("F7 Step 2 V6 Session Kernel（vitest）", () => {
  it("G2 parity：在线缓存 state 与全量重建一致（cursor 含在内）", () => {
    const { kernel } = deliveredAtOrdinalZero("TS-9701");
    kernel.append(5, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9701", 1, 0, "workspace", "presented"), { causation_sequence: 9 })]);
    const parity = kernel.assertReplayParity();
    expect(parity.equal).toBe(true);
    expect(parity.differences).toEqual([]);
    expect(kernel.state.workspace_revision).toBe(1);
    expect(kernel.state.presentation_cursor).toEqual({ status: "idle" });
    expect(kernel.state.teaching_cursor.phase).toBe("presenting");
  });

  it("intent causation：错误事件类型 / request id 不一致 → 整批拒绝，零事件落库", () => {
    const { kernel, revision } = deliveredAtOrdinalZero("TS-9702");
    const inputSeq = kernel.append(revision, [ev6("student_input_recorded", { input: { kind: "control", command: "confirm" }, client_request_id: "cr-0002" })]).appendedSequences[0];
    expect(() =>
      kernel.append(revision + 1, [ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0002" }, { causation_sequence: 5 })]),
    ).toThrowError(/INTENT_CAUSATION_MISMATCH|does not reference an earlier committed student_input_recorded/);
    expect(() =>
      kernel.append(revision + 1, [ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-other" }, { causation_sequence: inputSeq })]),
    ).toThrowError(/INTENT_CAUSATION_MISMATCH|differs from the referenced student_input_recorded/);
    expect(kernel.revision).toBe(revision + 1);
    expect(kernel.state.presentation_cursor.status).toBe("awaiting_browser");
  });

  it("capability 门禁：unknown capability/target → 零事件、零状态、零 delivery", () => {
    const kernel = TutorSessionKernelV6.start(startInputV6("TS-9703"), syntheticRegistryProvider);
    kernel.append(1, [ev6("student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "嗯" }, client_request_id: "cr-0001" })]);
    kernel.append(2, [
      ev6("semantic_interpretation_recorded", { intent: "ack", reasoning_location: "aligned", confidence: 0.9, interpreter_version: "i/v1" }, { causation_sequence: 2 }),
      ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0001" }, { causation_sequence: 2 }),
      ev6("policy_decision_made", decisionPayloadV6("TS-9703", 1), { causation_sequence: 4 }),
    ]);
    const stateBefore = JSON.parse(JSON.stringify(kernel.state));
    expect(() =>
      kernel.append(3, [
        ev6("presentation_sequence_planned", plannedPayloadV6("TS-9703", 1, { actions: [{ ordinal: 0, kind: "workspace", workspace_action: { action_id: "WSA-TS-9703-x1", decision_id: "TD-TS-9703-1", surface: "geometry", capability: "no.such-capability", origin: "tutor", target_ids: ["seg-AB"], reveal_scope: "none" } }] }), { causation_sequence: 5 }),
      ]),
    ).toThrowError(/CAPABILITY_UNREGISTERED|not registered in the session-pinned registry/);
    expect(JSON.parse(JSON.stringify(kernel.state))).toEqual(stateBefore);
    expect(kernel.revision).toBe(3);
  });

  it("cursor 对账：未应用先交付 / 孤儿 outcome / 双重 presented 均 fail closed", () => {
    const kernel = TutorSessionKernelV6.start(startInputV6("TS-9704"), syntheticRegistryProvider);
    kernel.append(1, [ev6("student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "嗯" }, client_request_id: "cr-0001" })]);
    kernel.append(2, [
      ev6("semantic_interpretation_recorded", { intent: "ack", reasoning_location: "aligned", confidence: 0.9, interpreter_version: "i/v1" }, { causation_sequence: 2 }),
      ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0001" }, { causation_sequence: 2 }),
      ev6("policy_decision_made", decisionPayloadV6("TS-9704", 1), { causation_sequence: 4 }),
    ]);
    kernel.append(3, [ev6("presentation_sequence_planned", plannedPayloadV6("TS-9704", 1), { causation_sequence: 5 })]);
    expect(() =>
      kernel.append(4, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9704", 1, 0, "workspace", "presented"), { causation_sequence: 6 })]),
    ).toThrowError(/PRESENTATION_CURSOR_MISMATCH|does not match the pending cursor/);
    expect(() =>
      kernel.append(4, [
        ev6("presentation_action_validated", actionRefV6("TS-9704", 1, 0, "workspace"), { causation_sequence: 6 }),
        ev6("presentation_action_delivered", actionRefV6("TS-9704", 1, 0, "workspace"), { causation_sequence: 6 }),
      ]),
    ).toThrowError(/PRESENTATION_ORDER_INVALID|delivered before being applied/);
    kernel.append(4, [
      ev6("presentation_action_validated", actionRefV6("TS-9704", 1, 0, "workspace"), { causation_sequence: 6 }),
      ev6("presentation_action_applied", appliedV6("TS-9704", 1, 0, 1), { causation_sequence: 6 }),
      ev6("presentation_action_delivered", actionRefV6("TS-9704", 1, 0, "workspace"), { causation_sequence: 6 }),
    ]);
    kernel.append(5, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9704", 1, 0, "workspace", "presented"), { causation_sequence: 9 })]);
    expect(() =>
      kernel.append(6, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9704", 1, 0, "workspace", "presented"), { causation_sequence: 9 })]),
    ).toThrowError(/PRESENTATION_CURSOR_MISMATCH|does not match the pending cursor/);
  });

  it("failed 停留 + retry_recovery 新恢复 sequence；pending 重投幂等", () => {
    const { kernel, revision } = deliveredAtOrdinalZero("TS-9705");
    // 同一 pending ref 的重复 delivered = 幂等 no-op（refresh 重投语义）。
    const cursorPending = JSON.parse(JSON.stringify(kernel.state.presentation_cursor));
    kernel.append(revision, [ev6("presentation_action_delivered", actionRefV6("TS-9705", 1, 0, "workspace"), { causation_sequence: 6 })]);
    expect(JSON.parse(JSON.stringify(kernel.state.presentation_cursor))).toEqual(cursorPending);

    const failedSeq = kernel.append(revision + 1, [ev6("presentation_action_outcome_recorded", outcomeV6("TS-9705", 1, 0, "workspace", "failed", { failure_class: "timeout" }), { causation_sequence: 9 })]).appendedSequences[0];
    expect(kernel.state.presentation_cursor).toEqual({ status: "failed", sequence_id: "PS-0001", ordinal: 0, action_id: "WSA-TS-9705-10" });
    expect(() =>
      kernel.append(revision + 2, [
        ev6("presentation_action_validated", actionRefV6("TS-9705", 1, 1, "voice"), { causation_sequence: 6 }),
        ev6("presentation_action_delivered", actionRefV6("TS-9705", 1, 1, "voice"), { causation_sequence: 6 }),
      ]),
    ).toThrowError(/PRESENTATION_ORDER_INVALID|cursor is parked failed/);

    const retryInputSeq = failedSeq + 1;
    kernel.append(revision + 2, [
      ev6("student_input_recorded", { input: { kind: "control", command: "retry_recovery" }, client_request_id: "cr-retry" }),
      ev6("presentation_sequence_superseded", { sequence_id: "PS-0001", reason: "retry_recovery", pending_ordinal: 0, pending_action_id: "WSA-TS-9705-10" }, { causation_sequence: retryInputSeq }),
    ]);
    expect(kernel.state.presentation_cursor).toEqual({ status: "idle" });
    kernel.append(revision + 3, [
      ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-retry" }, { causation_sequence: retryInputSeq }),
      ev6("policy_decision_made", decisionPayloadV6("TS-9705", 2), { causation_sequence: retryInputSeq + 2 }),
    ]);
    kernel.append(revision + 4, [ev6("presentation_sequence_planned", plannedPayloadV6("TS-9705", 2), { causation_sequence: retryInputSeq + 3 })]);
    kernel.append(revision + 5, [
      ev6("presentation_action_validated", actionRefV6("TS-9705", 2, 0, "workspace"), { causation_sequence: retryInputSeq + 4 }),
      ev6("presentation_action_applied", appliedV6("TS-9705", 2, 0, 1), { causation_sequence: retryInputSeq + 4 }),
      ev6("presentation_action_delivered", actionRefV6("TS-9705", 2, 0, "workspace"), { causation_sequence: retryInputSeq + 4 }),
    ]);
    expect(kernel.state.presentation_cursor).toMatchObject({ status: "awaiting_browser", sequence_id: "PS-0002", ordinal: 0 });
    expect(kernel.assertReplayParity().equal).toBe(true);
  });

  it("V5/V6 隔离：双向写入互拒（SESSION_VERSION_UNSUPPORTED / VALIDATION_FAILED）", () => {
    const v5 = TutorSessionKernelV5.start(startInput("TS-9706"));
    v5.append(1, [ev("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0001" })]);
    expect(() =>
      appendSessionEvents(makeV6SessionCodec(syntheticRegistryProvider), "TS-9706", 2, [
        ev6("student_input_recorded", { input: { kind: "control", command: "confirm" }, client_request_id: "cr-x001" }),
      ]),
    ).toThrowError(expect.objectContaining({ code: "SESSION_VERSION_UNSUPPORTED" }) as never);
    expect(() => TutorSessionKernelV6.resume("TS-9706", syntheticRegistryProvider)).toThrowError(
      expect.objectContaining({ code: "SESSION_VERSION_UNSUPPORTED" }) as never,
    );

    const v6 = TutorSessionKernelV6.start(startInputV6("TS-9707"), syntheticRegistryProvider);
    expect(() =>
      appendTutorSessionEventsV5("TS-9707", 1, [ev("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0001" })]),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }) as never);
    expect(v6.revision).toBe(1);
  });

  it("start pin 校验失败：零会话行、零事件（fail closed before persistence）", () => {
    expect(() =>
      TutorSessionKernelV6.start(startInputV6("TS-9709", { catalogPinHashOverride: "sha256:wrong" }), syntheticRegistryProvider),
    ).toThrowError(/workspace_catalog_pin missing or mismatched/);
    const sessions = (db.prepare("SELECT COUNT(*) AS n FROM tutor_sessions WHERE session_id = ?").get("TS-9709") as { n: number }).n;
    const events = (db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events WHERE session_id = ?").get("TS-9709") as { n: number }).n;
    expect(sessions).toBe(0);
    expect(events).toBe(0);
    expect(() =>
      TutorSessionKernelV6.start(startInputV6("TS-9710", { withCatalogPin: false }), syntheticRegistryProvider),
    ).toThrowError(/workspace_catalog_pin missing or mismatched/);
  });

  it("reducer 纯性：同 state+事件两次归约一致；分支互不污染；旧 state 可继续使用", () => {
    const sid = "TS-9711";
    const kernel = TutorSessionKernelV6.start(startInputV6(sid), syntheticRegistryProvider);
    kernel.append(1, [ev6("student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "嗯" }, client_request_id: "cr-0001" })]);
    kernel.append(2, [
      ev6("semantic_interpretation_recorded", { intent: "ack", reasoning_location: "aligned", confidence: 0.9, interpreter_version: "i/v1" }, { causation_sequence: 2 }),
      ev6("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-0001" }, { causation_sequence: 2 }),
      ev6("policy_decision_made", decisionPayloadV6(sid, 1), { causation_sequence: 4 }),
    ]);
    kernel.append(3, [ev6("presentation_sequence_planned", plannedPayloadV6(sid, 1), { causation_sequence: 5 })]);
    const baseState = kernel.state;
    const registry = syntheticRegistry();
    const probe = (ordinal: number, kind: "voice" | "workspace") =>
      ({ schema: "ai_teaching_tutor_session_event/v6", session_id: sid, sequence: 7, state_revision: 5, occurred_at: new Date().toISOString(), event_type: "presentation_action_validated", payload: actionRefV6(sid, 1, ordinal, kind), causation_sequence: 6, idempotency_key: "probe-x001" }) as never;
    const first = applyV6Event(baseState, probe(0, "workspace"), registry);
    const replay = applyV6Event(baseState, probe(0, "workspace"), registry);
    expect(replay).toEqual(first);
    // 分支探针：validated 只写 lineage（canonical state 不变是设计事实）；
    // 污染检测改为「分支重放」——旧可变血缘实现会因 Set 被分支偷偷写入，
    // 在第二次 baseState+E1 归约时抛 validated twice。
    const branch = applyV6Event(baseState, probe(1, "voice"), registry);
    const branchReplay = applyV6Event(baseState, probe(1, "voice"), registry);
    expect(branchReplay).toEqual(branch);
    expect(applyV6Event(baseState, probe(2, "workspace"), registry)).toBeTruthy();
    expect(kernel.assertReplayParity().equal).toBe(true);
  });

  it("refresh：纯重建返回同一 pending cursor，零新事件（重投来自已提交 delivered）", () => {
    const { kernel, revision } = deliveredAtOrdinalZero("TS-9708");
    const resumed = TutorSessionKernelV6.resume("TS-9708", syntheticRegistryProvider);
    expect(resumed.state.presentation_cursor).toEqual({
      status: "awaiting_browser",
      sequence_id: "PS-0001",
      ordinal: 0,
      action_id: "WSA-TS-9708-10",
    });
    expect(resumed.revision).toBe(revision);
    expect(kernel.assertReplayParity().equal).toBe(true);
  });
});
