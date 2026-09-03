/**
 * F7 Step 3 门禁测试（vitest 链）：TutorSessionOrchestratorV6 关键不变量在
 * vitest 进程图（独立 SQLITE_PATH）下的同一裁决：旅程有序对账 + G2 parity、
 * refresh 零事件零模型调用、interrupted 同批 superseded、failed→retry_recovery
 * 恢复序列、V5/V6 隔离。完整义务矩阵在 node 链（tutorSessionOrchestratorV6.test.ts）。
 */
import { describe, expect, it } from "vitest";

import { FixedResponseGateProvider } from "../../tutorNavigator/ModelGateAdjudicatorV5";
import { TutorSessionOrchestratorV6, OrchestratorV6Error } from "../TutorSessionOrchestratorV6";
import { readTutorSessionEventsV6 } from "../../tutorSession/WorkspaceRuntimeReducerV6";
import { TutorTaskBindingResolver } from "../TutorTaskBindingResolver";
import { startTutorSessionV5 } from "../../tutorSession/TutorSessionEventStoreV5";
import { startInput } from "../../tutorSession/__tests__/v5KernelSupport";
import {
  ANSWER_INVARIANTS_OK,
  f6Model,
  realCanonicalRoot,
} from "./f6Support";
import { db } from "../../../db/database";

const ROOT = realCanonicalRoot();
const PASS_GT02 = JSON.stringify({ response_kind: "final_answer", matched_gate_id: "GT-02", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-06"], brief_reason: "ok" });
const PASS_GT03 = JSON.stringify({ response_kind: "final_answer", matched_gate_id: "GT-03", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-10"], brief_reason: "ok" });

const registryProvider = new TutorTaskBindingResolver(ROOT).v6RegistryProvider;

function eventsOf(sessionId: string) {
  return readTutorSessionEventsV6(sessionId, registryProvider);
}

function countEvents(sessionId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events WHERE session_id = ?").get(sessionId) as { n: number }).n;
}

function startOrch(sessionId: string) {
  const provider = new FixedResponseGateProvider([PASS_GT02, PASS_GT03], "fixed-f7-v6-vitest");
  const orchestrator = TutorSessionOrchestratorV6.start({
    sessionId,
    studentId: "student-f7v6",
    taskId: "goldenMinhangFold2020",
    canonicalRoot: ROOT,
    model: f6Model(provider, `fixed-response/${provider.name}`),
  });
  return { orchestrator, provider };
}

function resumeOrch(sessionId: string) {
  const provider = new FixedResponseGateProvider([PASS_GT02, PASS_GT03], "fixed-f7-v6-vitest");
  return TutorSessionOrchestratorV6.resume({
    sessionId,
    canonicalRoot: ROOT,
    model: f6Model(provider, `fixed-response/${provider.name}`),
  });
}

function presentAll(orch: TutorSessionOrchestratorV6) {
  const trajectory = [];
  for (let guard = 0; guard < 32; guard += 1) {
    const pending = orch.snapshot().pending_presentation;
    if (!pending) return trajectory;
    trajectory.push(pending);
    orch.reportPresentationOutcome({
      sequence_id: pending.sequence_id,
      ordinal: pending.ordinal,
      action_id: pending.action_id,
      outcome: "presented",
      client_request_id: `po-${pending.sequence_id}-${pending.ordinal}`,
    });
  }
  throw new Error("presentAll guard exceeded");
}

describe("F7 Step 3 V6 Orchestrator（vitest）", () => {
  it("golden 旅程：有序逐事件对账（Geometry→Voice→Board）+ 末项 presented → awaiting_evidence + G2 parity", async () => {
    const sessionId = "TS-9801";
    const { orchestrator: orch } = startOrch(sessionId);
    presentAll(orch);
    await orch.submitStudentInput({ input: { kind: "control", command: "confirm" }, client_request_id: "cr-1" });
    presentAll(orch);
    await orch.submitStudentInput({ input: { kind: "utterance", channel: "mainline", text: ANSWER_INVARIANTS_OK }, client_request_id: "cr-2" });
    presentAll(orch);
    await orch.submitStudentInput({ input: { kind: "utterance", channel: "mainline", text: ANSWER_INVARIANTS_OK }, client_request_id: "cr-3" });
    const trajectory = presentAll(orch);

    const events = eventsOf(sessionId);
    const planned = events.filter((event) => event.event_type === "presentation_sequence_planned");
    expect(planned.length).toBeGreaterThanOrEqual(4);
    for (const planEvent of planned) {
      const payload = planEvent.payload as { sequence_id: string; actions: Array<{ ordinal: number; kind: string }> };
      payload.actions.forEach((action, index) => expect(action.ordinal).toBe(index));
      const validated = events.filter((event) => event.event_type === "presentation_action_validated"
        && (event.payload as { sequence_id: string }).sequence_id === payload.sequence_id);
      expect(validated.map((event) => (event.payload as { ordinal: number }).ordinal))
        .toEqual(payload.actions.map((action) => action.ordinal));
    }
    // BT-04 轨迹：构造（workspace/geometry）在前、voice 居中。
    const bt04 = trajectory.slice(-7);
    expect(bt04.length).toBeGreaterThanOrEqual(6);
    const kinds = bt04.map((pending) => pending.action.kind);
    const firstVoice = kinds.indexOf("voice");
    expect(firstVoice).toBeGreaterThan(0);
    for (let index = 0; index < firstVoice; index += 1) expect(kinds[index]).toBe("workspace");

    const final = orch.snapshot();
    expect(final.teaching_phase).toBe("awaiting_evidence");
    expect(final.active_action).toBeDefined();
    expect(orch.assertReplayParity().equal).toBe(true);
  });

  it("refresh：pending delivery 原样重投、零新事件", () => {
    const sessionId = "TS-9802";
    const { orchestrator: orch } = startOrch(sessionId);
    const first = orch.snapshot().pending_presentation!;
    orch.reportPresentationOutcome({
      sequence_id: first.sequence_id, ordinal: first.ordinal, action_id: first.action_id,
      outcome: "presented", client_request_id: "po-1",
    });
    const pendingBefore = orch.snapshot().pending_presentation!;
    const eventsBefore = countEvents(sessionId);
    const resumed = resumeOrch(sessionId);
    expect(countEvents(sessionId)).toBe(eventsBefore);
    expect(resumed.snapshot().pending_presentation).toEqual(pendingBefore);
  });

  it("interrupted：同批 superseded；剩余 ordinal 不再可交付", () => {
    const sessionId = "TS-9803";
    const { orchestrator: orch } = startOrch(sessionId);
    const pending = orch.snapshot().pending_presentation!;
    const eventsBefore = countEvents(sessionId);
    const outcome = orch.reportPresentationOutcome({
      sequence_id: pending.sequence_id, ordinal: pending.ordinal, action_id: pending.action_id,
      outcome: "interrupted", client_request_id: "po-1",
    });
    expect(countEvents(sessionId)).toBe(eventsBefore + 2);
    expect(outcome.snapshot.pending_presentation).toBeUndefined();
    expect(() =>
      orch.reportPresentationOutcome({
        sequence_id: pending.sequence_id, ordinal: pending.ordinal + 1, action_id: `VA-${sessionId}-ghost`,
        outcome: "presented", client_request_id: "po-2",
      }),
    ).toThrowError(OrchestratorV6Error);
  });

  it("failed 停留 + retry_recovery 恢复序列", async () => {
    const sessionId = "TS-9804";
    const { orchestrator: orch } = startOrch(sessionId);
    const pending = orch.snapshot().pending_presentation!;
    const failed = orch.reportPresentationOutcome({
      sequence_id: pending.sequence_id, ordinal: pending.ordinal, action_id: pending.action_id,
      outcome: "failed", failure_class: "provider_failure",
      client_request_id: "po-1",
    });
    expect(failed.snapshot.presentation_cursor.status).toBe("failed");
    await expect(() =>
      orch.submitStudentInput({ input: { kind: "control", command: "continue" }, client_request_id: "cr-1" }),
    ).rejects.toThrowError(/PRESENTATION_FAILED_PENDING_RECOVERY|retry_recovery/);
    const recovery = await orch.submitStudentInput({
      input: { kind: "control", command: "retry_recovery" },
      client_request_id: "cr-2",
    });
    expect(recovery.presentations[0].sequence_id).not.toBe(pending.sequence_id);
    expect(recovery.snapshot.presentation_cursor.status).toBe("awaiting_browser");
  });

  it("V5/V6 隔离：V6 resume 撞 v5 会话行 fail closed", () => {
    startTutorSessionV5(startInput("TS-9805"));
    expect(() => resumeOrch("TS-9805")).toThrowError(/v5 contract|SESSION_VERSION_UNSUPPORTED/);
  });

  it("start 显式 task 解析：unknown task fail closed（零会话行）", () => {
    let unknownTask: unknown;
    try {
      TutorSessionOrchestratorV6.start({
        sessionId: "TS-9806",
        studentId: "s",
        taskId: "no-such-task",
        canonicalRoot: ROOT,
        model: f6Model(new FixedResponseGateProvider([], "x"), "x"),
      });
    } catch (error) {
      unknownTask = error;
    }
    expect(unknownTask).toBeInstanceOf(OrchestratorV6Error);
    expect((unknownTask as OrchestratorV6Error).code).toBe("UNKNOWN_TASK");
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM tutor_sessions WHERE session_id = ?").get("TS-9806") as { n: number }).n,
    ).toBe(0);
  });
});
