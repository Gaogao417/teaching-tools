import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useTutorLearning } from "../useTutorLearning";
import { ActionRuntimeFrame } from "../../../presentation/runtime/ActionRuntimeFrame";
import * as pageRuntime from "../../pageRuntime";
import * as runtimeHook from "../../react/useActionPageRuntime";
import { actionMachineRegistry } from "../../registry";
import type { TutorRuntimeClient } from "../../../api/tutorRuntimeClient";
import type { TaskId } from "../../../../../shared/contracts";
import { RUNTIME_TASK_ID, validRuntimeSnapshot, rejectedEvaluation } from "./runtimeSnapshotFixture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.sessionStorage.clear(); });

it.each(["evidence-rejected", "revision-conflict", "command-rejected", "runtime-failure"] as const)("真实 Frame/XState %s：actor-first/输入保留/系统失败不评价/StrictMode 去重", async (status) => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected legacy request"));
  const initial = validRuntimeSnapshot({ participationKind: "workspace_input", revision: 30 });
  const submit = vi.fn<TutorRuntimeClient["submitActionEvidence"]>()
    .mockResolvedValueOnce(status === "evidence-rejected"
      ? { snapshot: initial, actionSubmission: { revision: 30, status, evaluation: rejectedEvaluation() } }
      : { snapshot: initial, actionSubmission: { revision: 30, status, failure: { category: "system", failure_class: status, retryable: true } } })
    .mockResolvedValueOnce({ snapshot: validRuntimeSnapshot({ participationKind: "answer_input", revision: 31, workspaceRevision: 4 }), actionSubmission: { revision: 31, status: "workspace-committed", evaluation: { outcome: "accepted", evaluation: "correct", revision: 31, phase: "correct_pause", nextIndex: 0 } } });
  const client: TutorRuntimeClient = {
    start: vi.fn().mockResolvedValue(initial), restore: vi.fn(), availability: vi.fn(),
    submitStudentInput: vi.fn(), submitActionEvidence: submit, submitWorkspaceCommand: vi.fn(),
    reportPresentationOutcome: vi.fn(), transcribe: vi.fn(),
  };
  const realHook = runtimeHook.useActionPageRuntime;
  const calls: string[] = [];
  let runtime!: ReturnType<typeof pageRuntime.createActionPageRuntime>;
  const observed = new WeakSet<object>();
  vi.spyOn(runtimeHook, "useActionPageRuntime").mockImplementation((...args) => {
    const result = realHook(...args);
    runtime = result.runtime;
    if (!observed.has(runtime)) {
      observed.add(runtime);
      const evaluate = runtime.applyEvaluation.bind(runtime);
      vi.spyOn(runtime, "applyEvaluation").mockImplementation((evaluation) => { calls.push("evaluate"); evaluate(evaluation); });
    }
    return result;
  });
  const createChild = vi.spyOn(actionMachineRegistry, "create");
  let tutor!: ReturnType<typeof useTutorLearning>;
  function Harness() {
    tutor = useTutorLearning({ taskId: RUNTIME_TASK_ID as TaskId, studentId: "actor-test", runtimeClient: client });
    const operation = tutor.activeOperation;
    return operation ? <ActionRuntimeFrame response={{ sessionId: tutor.sessionId!, plan: operation.plan }} transport={tutor.transport} legacyMediaDisabled
      onEvaluation={(evaluation) => { calls.push(`adopt:${runtime.getSnapshot().status}`); tutor.adoptPendingEvaluationSnapshot(evaluation); }} /> : <div>no action</div>;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  dispose = () => { act(() => root.unmount()); container.remove(); };
  await act(async () => { root.render(<StrictMode><Harness /></StrictMode>); });
  await act(async () => { await tutor.start(); });
  const originalRuntime = runtime;
  const childCount = createChild.mock.calls.length;
  const segments = ["seg-AO", "seg-DO", "seg-BO", "seg-OE"];
  await act(async () => {
    for (const id of segments) {
      runtime.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: id });
      runtime.send({ type: "ANSWER.CHANGED", slotId: id, value: "9" });
    }
  });
  const originalChild = createChild.mock.results.map((result) => result.value).find((child) => child.getSnapshot().selectedObjectIds.length === 4);
  expect(originalChild).toBeDefined();
  await act(async () => { runtime.send({ type: "SUBMIT" }); });
  await act(async () => { await Promise.resolve(); });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(fetchSpy).not.toHaveBeenCalled();
  if (status !== "evidence-rejected") {
    expect(calls).toEqual([]);
    expect(runtime.getSnapshot().status).toBe("transport-error");
    expect(runtime.getSnapshot().wrongObjectIds).toEqual([]);
    expect(tutor.runtimeSnapshot?.revision).toBe(30);
    expect(originalChild.getSnapshot().selectedObjectIds).toEqual(segments);
    return;
  }
  expect(calls).toEqual(["evaluate", "adopt:wrong"]);
  expect(runtime).toBe(originalRuntime);
  expect(createChild).toHaveBeenCalledTimes(childCount);
  expect(originalChild.getSnapshot().selectedObjectIds).toEqual(segments);
  expect(originalChild.getSnapshot().answers).toEqual(Object.fromEntries(segments.map((id) => [id, "9"])));
  expect(tutor.runtimeSnapshot?.revision).toBe(30);
  await act(async () => {
    for (const id of segments) runtime.send({ type: "ANSWER.CHANGED", slotId: id, value: "1" });
    runtime.send({ type: "SUBMIT" });
  });
  await act(async () => { await Promise.resolve(); });
  expect(submit).toHaveBeenCalledTimes(2);
  expect(submit.mock.calls[0][1].clientRequestId).not.toBe(submit.mock.calls[1][1].clientRequestId);
  expect(calls).toEqual(["evaluate", "adopt:wrong", "evaluate", "adopt:complete"]);
  expect(tutor.runtimeSnapshot?.revision).toBe(31);
  expect(tutor.activeOperation).toBeUndefined();
});
