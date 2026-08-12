import { describe, expect, it } from "vitest";
import type { MakeParallelAction, SelectOptionAction } from "../../../../../shared/actionRuntime";
import type { ActionSnapshotView } from "../../types";
import type { ActionRuntimeEvent } from "../../events";
import { TrainingGuard } from "../trainingGuard";

function snapshot(overrides: Partial<ActionSnapshotView> = {}): ActionSnapshotView {
  return {
    state: "editing",
    selectedObjectIds: [],
    selectedByKind: { points: [], lines: [], angles: [] },
    answers: {},
    ready: false,
    done: false,
    commands: [],
    diagramPreviewCommands: [],
    enabledByKind: { points: [], lines: [], angles: [] },
    projectedAnswerSlots: [],
    ...overrides,
  };
}

const selectAction: SelectOptionAction = {
  actionId: "a1", sourceStepId: "s1", kind: "select-option", version: 1, title: "选择", instruction: "选",
  input: { options: [], expectedValue: "A" }, localTruth: { expectedValue: "A" }, capabilities: [], answerSlots: [],
  validationPolicy: "local-training", submitOnComplete: true,
};

const makeParallelAction: MakeParallelAction = {
  actionId: "mp1", sourceStepId: "s1", kind: "make-parallel", version: 1, title: "平行", instruction: "作平行线",
  input: { throughPointId: "P", referenceLineId: "L", availablePointIds: ["P", "Q"], availableLineIds: ["L", "M"], outputLineId: "OL" },
  localTruth: { throughPointId: "P", referenceLineId: "L" }, capabilities: [], answerSlots: [],
  validationPolicy: "local-training", submitOnComplete: false,
};

describe("TrainingGuard", () => {
  const guard = new TrainingGuard();

  it("classifies a non-candidate event as ignored-illegal (not recorded)", () => {
    const before = snapshot();
    const result = guard.classify(selectAction, { type: "BACK" }, before, before);
    expect(result.decision.kind).toBe("ignored-illegal");
    expect(result.candidate).toBeUndefined();
  });

  it("classifies a SUBMIT that did nothing (form not ready) as ignored-illegal", () => {
    const before = snapshot({ state: "editing" });
    const after = snapshot({ state: "editing" }); // no transition, no wrongMessage
    const result = guard.classify(selectAction, { type: "SUBMIT" }, before, after);
    expect(result.decision.kind).toBe("ignored-illegal");
  });

  it("classifies a wrong SUBMIT as wrong with feedback", () => {
    const before = snapshot({ state: "editing", answers: {} });
    const after = snapshot({ state: "editing", answers: { choice: "B" }, wrongMessage: "答案不对。" });
    const result = guard.classify(selectAction, { type: "SUBMIT" }, before, after);
    expect(result.decision.kind).toBe("wrong");
    if (result.decision.kind !== "wrong") return;
    expect(result.decision.feedback.messageLatex).toBe("答案不对。");
    expect(result.candidate).toBeDefined();
  });

  it("classifies a correct-completion SUBMIT and carries evidence + commands", () => {
    const before = snapshot({ state: "editing" });
    const evidence = { actionId: "a1", sourceStepId: "s1", kind: "select-option", version: 1, value: "A" } as const;
    const after = snapshot({ state: "completed", done: true, evidence, commands: [] });
    const result = guard.classify(selectAction, { type: "SUBMIT" }, before, after);
    expect(result.decision.kind).toBe("correct-completion");
    expect(result.evidence).toEqual(evidence);
    expect(result.commands).toEqual([]);
  });

  it("treats an object outside the accepting set as ignored-illegal (not wrong)", () => {
    // Action is selecting points; availablePointIds = [P, Q]. Clicking line "L"
    // (not in the points accepting set) is an illegal click, not a wrong attempt.
    const before = snapshot({
      enabledByKind: { points: ["P", "Q"], lines: [], angles: [] },
    });
    const after = snapshot({
      enabledByKind: { points: ["P", "Q"], lines: [], angles: [] },
      wrongObjectId: "L", wrongMessage: "不是当前动作需要的对象。",
    });
    const event: ActionRuntimeEvent = { type: "OBJECT.SELECTED", objectKind: "line", objectId: "L" };
    const result = guard.classify(makeParallelAction, event, before, after);
    expect(result.decision.kind).toBe("ignored-illegal");
  });

  it("treats a plausible-but-wrong object in the accepting set as wrong", () => {
    // availablePointIds includes Q; Q is a plausible candidate but not the truth.
    const before = snapshot({
      enabledByKind: { points: ["P", "Q"], lines: [], angles: [] },
    });
    const after = snapshot({
      enabledByKind: { points: ["P", "Q"], lines: [], angles: [] },
      wrongObjectId: "Q", wrongMessage: "这个对象不是当前动作需要的对象。",
    });
    const event: ActionRuntimeEvent = { type: "OBJECT.SELECTED", objectKind: "point", objectId: "Q" };
    const result = guard.classify(makeParallelAction, event, before, after);
    expect(result.decision.kind).toBe("wrong");
    if (result.decision.kind !== "wrong") return;
    expect(result.decision.feedback.wrongObjectIds).toEqual(["Q"]);
  });

  it("classifies a correct advancing object selection as correct-partial", () => {
    const before = snapshot({
      enabledByKind: { points: ["P", "Q"], lines: [], angles: [] },
    });
    // Machine accepted P (no wrongObjectId, not done) → partial progress.
    const after = snapshot({
      enabledByKind: { points: [], lines: ["L", "M"], angles: [] },
      selectedObjectIds: ["P"],
    });
    const event: ActionRuntimeEvent = { type: "OBJECT.SELECTED", objectKind: "point", objectId: "P" };
    const result = guard.classify(makeParallelAction, event, before, after);
    expect(result.decision.kind).toBe("correct-partial");
  });
});
