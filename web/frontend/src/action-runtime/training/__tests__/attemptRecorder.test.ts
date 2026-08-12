import { describe, expect, it } from "vitest";
import type { SelectOptionAction } from "../../../../../shared/actionRuntime";
import { AttemptRecorder } from "../attemptRecorder";

const action: SelectOptionAction = {
  actionId: "a1", sourceStepId: "s1", kind: "select-option", version: 1, title: "选择", instruction: "选",
  input: { options: [], expectedValue: "A" }, localTruth: { expectedValue: "A" }, capabilities: [], answerSlots: [],
  validationPolicy: "local-training", submitOnComplete: true,
};

describe("AttemptRecorder", () => {
  it("keeps semantic accuracy, first try and assistance distinct", () => {
    let now = 100;
    let seq = 0;
    const recorder = new AttemptRecorder("session", "exercise", () => now, () => `id-${++seq}`);
    recorder.start(action);
    now = 150;
    recorder.record(action, { kind: "answer", slotId: "choice", value: "B" }, "wrong");
    recorder.useAssistance("hint", action);
    now = 220;
    recorder.record(action, { kind: "answer", slotId: "choice", value: "A" }, "correct-complete");
    const snapshot = recorder.snapshot();
    expect(snapshot.attempts.map((event) => event.outcome)).toEqual(["wrong", "correct-complete"]);
    expect(snapshot.attempts[1].assistance).toBe("hint");
    expect(snapshot.actionMetrics[0]).toMatchObject({ durationMs: 120, attemptCount: 2, wrongAttemptCount: 1, firstTryCorrect: false, completed: true });
  });
});
