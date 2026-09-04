/**
 * F7 Step 5 — useTutorLearning canonical Runtime 分支（单一 ValidatedSessionSnapshot）。
 * 覆盖：原子采用与派生面、协议错误保留最后合法快照 + retrySync、200+显式
 * turn 失败采用、submitUtterance/submitControl 请求语义、transport actor-first
 * stash/adopt 顺序、system failure 不产 evaluation、restore 404/409、
 * task_id 漂移与 active_action 校验 fail closed。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTutorLearning } from "../useTutorLearning";
import type { TutorRuntimeClient } from "../../../api/tutorRuntimeClient";
import { ProtocolParseError, TutorRuntimeHttpError } from "../../../api/tutorRuntimeClient";
import {
  RUNTIME_SESSION_ID,
  RUNTIME_TASK_ID,
  rejectedEvaluation,
  validRuntimeSnapshot,
} from "./runtimeSnapshotFixture";
import type { TaskId } from "../../../../../shared/contracts";
import type { ActionEvaluationResponse } from "../../../../../shared/actionRuntime";

// 无需 vi.mock 模块：client 经 props 注入（LearnPage 同形），错误类取自真实
// adapter 模块（hook 的 instanceof 判定同源）。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeClient(): { client: TutorRuntimeClient; mocks: Record<string, ReturnType<typeof vi.fn>> } {
  const mocks = {
    availability: vi.fn(),
    start: vi.fn(),
    restore: vi.fn(),
    submitStudentInput: vi.fn(),
    submitActionEvidence: vi.fn(),
    submitWorkspaceCommand: vi.fn(),
    reportPresentationOutcome: vi.fn(),
    transcribe: vi.fn(),
  };
  return { client: mocks as unknown as TutorRuntimeClient, mocks };
}

type Tutor = ReturnType<typeof useTutorLearning>;

function mountHarness(client: TutorRuntimeClient, restoreSessionId?: string): {
  tutor: () => Tutor;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latest: Tutor | undefined;
  function Harness() {
    const tutor = useTutorLearning({ taskId: RUNTIME_TASK_ID as TaskId, studentId: "runtime-test-student", ...(restoreSessionId ? { restoreSessionId } : {}), runtimeClient: client });
    latest = tutor;
    return <div data-testid="phase">{tutor.phase}</div>;
  }
  void act(() => root.render(<Harness />));
  return { tutor: () => latest!, unmount: () => { void act(() => root.unmount()); container.remove(); } };
}

describe("useTutorLearning（canonical Runtime 数据源）", () => {
  let harness: ReturnType<typeof mountHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    harness?.unmount();
  });

  it("start 采用快照：单一 snapshot 派生 participation/question/transcript；legacy API 零调用", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input" }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ taskId: RUNTIME_TASK_ID, clientRequestId: expect.any(String) }));
    const tutor = harness.tutor();
    expect(tutor.runtimeSnapshot?.session_id).toBe(RUNTIME_SESSION_ID);
    expect(tutor.runtimeParticipation?.kind).toBe("confirm_input");
    expect(tutor.question?.stem).toContain("翻折");
    expect(tutor.transcript.map((entry) => entry.role)).toEqual(["tutor"]);
    expect(tutor.activeOperation).toBeUndefined();
    expect(tutor.phase).toBe("awaitingInput");
  });

  it("start 协议错误：快照未采用 + protocolError（recoverable）；重试同幂等键", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockRejectedValueOnce(new ProtocolParseError(["render: Required"]));
    mocks.start.mockResolvedValueOnce(validRuntimeSnapshot({ participationKind: "answer_input" }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    expect(harness.tutor().protocolError).toContain("fail closed");
    expect(harness.tutor().runtimeSnapshot).toBeUndefined();
    expect(harness.tutor().phase).toBe("recovering");
    await act(async () => { await harness.tutor().start(); });
    expect(harness.tutor().protocolError).toBeUndefined();
    expect(harness.tutor().runtimeParticipation?.kind).toBe("answer_input");
    const first = mocks.start.mock.calls[0][0];
    const second = mocks.start.mock.calls[1][0];
    expect(second.clientRequestId).toBe(first.clientRequestId);
  });

  it("submitUtterance/submitControl：expected_revision 取自当前快照；utterance trim 后非空才提交", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    mocks.submitStudentInput.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 13 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => { await harness.tutor().submitUtterance("mainline", "  识别第一组子母型  "); });
    expect(mocks.submitStudentInput).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "utterance", channel: "mainline", text: "识别第一组子母型" },
      12,
      expect.any(String),
    );
    expect(harness.tutor().runtimeSnapshot?.revision).toBe(13);
    await act(async () => { await harness.tutor().submitUtterance("mainline", "   "); });
    expect(mocks.submitStudentInput).toHaveBeenCalledTimes(1);
    await act(async () => { await harness.tutor().submitControl("confirm"); });
    expect(mocks.submitStudentInput).toHaveBeenLastCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "control", command: "confirm" },
      13,
      expect.any(String),
    );
  });

  it("200 + revision-conflict 显式 turn：快照照常采用 + turnFailure 派生；下一轮成功清除", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    mocks.submitStudentInput.mockResolvedValueOnce(validRuntimeSnapshot({
      participationKind: "answer_input",
      revision: 12,
      turn: { status: "revision-conflict", failure: { category: "turn", failure_class: "STALE_REVISION", retryable: true } },
    }));
    mocks.submitStudentInput.mockResolvedValueOnce(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 14 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => { await harness.tutor().submitUtterance("mainline", "答"); });
    const conflicted = harness.tutor();
    expect(conflicted.runtimeTurnFailure).toBe("STALE_REVISION");
    expect(conflicted.runtimeSnapshot?.revision).toBe(12);
    await act(async () => { await harness.tutor().submitUtterance("mainline", "答"); });
    expect(harness.tutor().runtimeTurnFailure).toBeUndefined();
  });

  it("transport actor-first：evidence-rejected 返回真实 evaluation 且 snapshot 未采用；adoptPendingEvaluationSnapshot 才采用", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "workspace_input", revision: 30 }));
    const nextSnapshot = validRuntimeSnapshot({ participationKind: "workspace_input", revision: 31 });
    mocks.submitActionEvidence.mockResolvedValue({
      snapshot: nextSnapshot,
      actionSubmission: { revision: 31, status: "evidence-rejected", evaluation: rejectedEvaluation() },
    });
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    let evaluation: ActionEvaluationResponse | undefined;
    await act(async () => {
      evaluation = await harness.tutor().transport.submitEvidence({
        sessionId: RUNTIME_SESSION_ID,
        exerciseId: "tutor:TP-SMV-009:1:bt04",
        sourceStepId: "BT-04",
        revision: 30,
        evidence: [{ actionId: "tp:TP-SMV-009:1:mark-segment-values-bt04", sourceStepId: "BT-04", kind: "mark-segment-values", version: 1, values: { "seg-AO": "9" } } as never],
        idempotencyKey: "idem-evidence-0001",
      });
    });
    expect(evaluation?.evaluation).toBe("wrong");
    expect(evaluation?.revision).toBe(31);
    expect(mocks.submitActionEvidence).toHaveBeenCalledWith(RUNTIME_SESSION_ID, expect.objectContaining({
      expectedRevision: 30,
      clientRequestId: "idem-evidence-0001",
    }));
    // actor 尚未消费 evaluation：快照停留在旧 revision（先评价后采用，spec §4.6）。
    expect(harness.tutor().runtimeSnapshot?.revision).toBe(30);
    await act(async () => { harness.tutor().adoptPendingEvaluationSnapshot(); });
    expect(harness.tutor().runtimeSnapshot?.revision).toBe(31);
  });

  it("transport system failure：结构上无 evaluation——reject + 失败提示；快照不动（绝不映射 wrong）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "workspace_input", revision: 30 }));
    mocks.submitActionEvidence.mockResolvedValue({
      snapshot: validRuntimeSnapshot({ participationKind: "workspace_input", revision: 30 }),
      actionSubmission: {
        revision: 30,
        status: "command-rejected",
        failure: { category: "turn", failure_class: "WORKSPACE_APPLY_REJECTED", retryable: false },
      },
    });
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    let failure: unknown;
    await act(async () => {
      failure = await harness.tutor().transport.submitEvidence({
        sessionId: RUNTIME_SESSION_ID,
        exerciseId: "e",
        sourceStepId: "BT-04",
        revision: 30,
        evidence: [{ actionId: "a", sourceStepId: "BT-04", kind: "mark-segment-values", version: 1, values: {} } as never],
        idempotencyKey: "idem-evidence-0002",
      }).catch((error: unknown) => error);
    });
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("command-rejected");
    expect(harness.tutor().runtimeFailureNotice).toContain("WORKSPACE_APPLY_REJECTED");
    expect(harness.tutor().runtimeSnapshot?.revision).toBe(30);
    expect(harness.tutor().adoptPendingEvaluationSnapshot()).toBeUndefined();
  });

  it("restore：404 SESSION_NOT_FOUND → missing（可重开）；409 SESSION_VERSION_UNSUPPORTED → invalid + 明示重新开始", async () => {
    const { client, mocks } = makeClient();
    mocks.restore.mockRejectedValueOnce(new TutorRuntimeHttpError(404, "SESSION_NOT_FOUND", "no row"));
    mocks.restore.mockRejectedValueOnce(new TutorRuntimeHttpError(409, "SESSION_VERSION_UNSUPPORTED", "v6 row"));
    mocks.start.mockResolvedValue(validRuntimeSnapshot({}));
    harness = mountHarness(client, RUNTIME_SESSION_ID);
    let outcome: string | undefined;
    await act(async () => { outcome = await harness.tutor().restore(RUNTIME_SESSION_ID); });
    expect(outcome).toBe("missing");
    await act(async () => { outcome = await harness.tutor().restore(RUNTIME_SESSION_ID); });
    expect(outcome).toBe("invalid");
    expect(harness.tutor().error).toContain("重新开始");
  });

  it("task_id 漂移：快照拒绝采用（protocolError fail closed，spec §1.3 #3 前端侧）", async () => {
    const { client, mocks } = makeClient();
    const drifted = validRuntimeSnapshot({});
    mocks.start.mockResolvedValue({ ...drifted, task_id: "otherTask2020" } as typeof drifted);
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    expect(harness.tutor().protocolError).toContain("task_id");
    expect(harness.tutor().runtimeSnapshot).toBeUndefined();
  });

  it("active_action 校验 fail closed：action_plan 非法 / target 不在 render geometry → 拒绝采用", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValueOnce(validRuntimeSnapshot({ participationKind: "workspace_input", actionPlanOverride: { planVersion: 5 } }));
    mocks.start.mockResolvedValueOnce(validRuntimeSnapshot({ participationKind: "workspace_input", targetIdsOverride: ["seg-AO", "seg-GHOST"] }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    expect(harness.tutor().protocolError).toContain("ExercisePlan");
    expect(harness.tutor().activeOperation).toBeUndefined();
    await act(async () => { await harness.tutor().start(); });
    expect(harness.tutor().protocolError).toContain("seg-GHOST");
  });

  it("合法 workspace_input：activeOperation 派生（零 cast，plan 过 isExercisePlan）+ phase=workspaceActive", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "workspace_input" }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    const tutor = harness.tutor();
    expect(tutor.activeOperation?.actionId).toBe("tp:TP-SMV-009:1:mark-segment-values-bt04");
    expect(tutor.activeOperation?.plan.actions[0]?.kind).toBe("mark-segment-values");
    expect(tutor.phase).toBe("workspaceActive");
  });

  it("completed：read_only_completed 快照 → phase=completed；finishQuestion 不触 legacy API", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "read_only_completed" }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    const tutor = harness.tutor();
    expect(tutor.runtimeCompleted).toBe(true);
    expect(tutor.phase).toBe("completed");
    await act(async () => { await tutor.finishQuestion(); });
    expect(tutor.completed).toBe(true);
  });

  it("协议错误后 retrySync：GET restore 重新对账并恢复", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    mocks.submitStudentInput.mockRejectedValueOnce(new ProtocolParseError(["turn: boom"]));
    mocks.restore.mockResolvedValueOnce(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => { await harness.tutor().submitControl("confirm"); });
    expect(harness.tutor().protocolError).toBeDefined();
    expect(harness.tutor().runtimeSnapshot?.revision).toBe(12);
    await act(async () => { await harness.tutor().retrySync(); });
    expect(harness.tutor().protocolError).toBeUndefined();
  });
});
