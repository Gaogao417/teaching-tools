import { describe, expect, it } from "vitest";
import type { ActionEvaluationResponse, ExercisePlan } from "../../../../shared/actionRuntime";
import { createActionPageRuntime } from "../pageRuntime";

function plan(): ExercisePlan {
  return {
    planVersion: 4,
    exerciseId: "exercise-1",
    revision: 0,
    mode: "guided-practice",
    metadata: { taskId: "auxiliaryTwoRatios", title: "test", promptLatex: "prompt", skillTags: [] },
    world: {
      revision: 0,
      geometry: {
        viewBox: { width: 10, height: 10 },
        points: [{ id: "T", x: 0, y: 1 }, { id: "C0", x: 0, y: 0 }, { id: "C1", x: 1, y: 0 }, { id: "R0", x: 0, y: 2 }, { id: "R1", x: 1, y: 3 }],
        segments: [{ id: "S", from: "R0", to: "R1" }],
      },
    },
    coach: { profileId: "coach", displayName: "老师", avatarId: "school", tone: "supportive" },
    actions: [
      {
        actionId: "step/make", sourceStepId: "step", kind: "make-parallel", version: 1,
        title: "作平行线", instruction: "选点和线", input: { throughPointId: "T", referenceLineId: "S", availablePointIds: ["T", "C0", "C1"], availableLineIds: ["S"], outputLineId: "P", outputLineLabel: "TP" },
        capabilities: ["agent:select-object", "agent:back", "agent:clear"], answerSlots: [], validationPolicy: "server-authoritative", submitOnComplete: false,
      },
      {
        actionId: "step/intersect", sourceStepId: "step", kind: "intersect-carriers", version: 1,
        title: "求交", instruction: "选两个点", input: { carrierPointIds: ["C0", "C1"], availablePointIds: ["T", "C0", "C1"], parallelLineId: "P", outputCarrierLineId: "C", outputPointId: "X" },
        capabilities: ["agent:select-object", "agent:back", "agent:clear"], answerSlots: [], validationPolicy: "server-authoritative", submitOnComplete: true,
      },
    ],
    currentActionId: "step/make",
    completedActionIds: [],
  };
}

/** Drive make-parallel to completion (selects the through point then the reference line). */
function completeMakeParallel(runtime: ReturnType<typeof createActionPageRuntime>) {
  runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "T" });
  runtime.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "S" });
}

const rejectedEvaluation: ActionEvaluationResponse = {
  outcome: "rejected", evaluation: "wrong", revision: 0,
  diagnosis: { messageLatex: "不一致", wrongObjectIds: [], wrongActionIds: ["step/make"] },
  phase: "wrong_feedback", nextIndex: 0,
};

const conflictEvaluation: ActionEvaluationResponse = {
  outcome: "conflict", evaluation: "wrong", revision: 1, phase: "answering", nextIndex: 0,
};

describe("PageRuntime transient emphasis lifecycle", () => {
  it("highlights the produced canvas entity on completion", () => {
    const runtime = createActionPageRuntime(plan());
    expect(runtime.getView().transientEmphasis).toBeUndefined();
    completeMakeParallel(runtime);
    const emphasis = runtime.getView().transientEmphasis;
    expect(emphasis?.targets).toContainEqual({ surface: "canvas", kind: "entity", id: "P" });
    runtime.stop();
  });

  it("keeps the same key across repeated getView reads", () => {
    const runtime = createActionPageRuntime(plan());
    completeMakeParallel(runtime);
    const first = runtime.getView().transientEmphasis!.key;
    // Re-reading the view (a plain React re-render path) must not mint a new key.
    expect(runtime.getView().transientEmphasis!.key).toBe(first);
    expect(runtime.getView().transientEmphasis!.key).toBe(first);
    runtime.stop();
  });

  it("mints a fresh key after undo and recomplete so the animation can replay", () => {
    const runtime = createActionPageRuntime(plan());
    completeMakeParallel(runtime);
    const firstKey = runtime.getView().transientEmphasis!.key;
    expect(runtime.getSnapshot().currentActionId).toBe("step/intersect");

    // Undo: BACK with an empty child rolls back the completed action.
    runtime.send({ type: "BACK" });
    expect(runtime.getSnapshot().currentActionId).toBe("step/make");
    expect(runtime.getView().transientEmphasis).toBeUndefined();

    completeMakeParallel(runtime);
    const secondKey = runtime.getView().transientEmphasis!.key;
    expect(secondKey).not.toBe(firstKey);
    runtime.stop();
  });

  it("clears emphasis on a rejected evaluation", () => {
    const runtime = createActionPageRuntime(plan());
    completeMakeParallel(runtime);
    expect(runtime.getView().transientEmphasis).toBeDefined();
    runtime.applyEvaluation(rejectedEvaluation);
    expect(runtime.getView().transientEmphasis).toBeUndefined();
    runtime.stop();
  });

  it("clears emphasis on CLEAR, conflict and reset, leaving nothing stale", () => {
    const runtime = createActionPageRuntime(plan());
    completeMakeParallel(runtime);
    expect(runtime.getView().transientEmphasis).toBeDefined();
    runtime.send({ type: "CLEAR" });
    expect(runtime.getView().transientEmphasis).toBeUndefined();
    runtime.stop();

    const conflictRuntime = createActionPageRuntime(plan());
    completeMakeParallel(conflictRuntime);
    conflictRuntime.applyEvaluation(conflictEvaluation);
    expect(conflictRuntime.getView().transientEmphasis).toBeUndefined();
    conflictRuntime.stop();

    const resetRuntime = createActionPageRuntime(plan());
    completeMakeParallel(resetRuntime);
    resetRuntime.resetFromPlan(plan());
    expect(resetRuntime.getView().transientEmphasis).toBeUndefined(); // restore never replays
    resetRuntime.stop();
  });

  it("never carries emphasis in the persisted snapshot shape", () => {
    const runtime = createActionPageRuntime(plan());
    completeMakeParallel(runtime);
    // Emphasis is closure-only; the snapshot that feeds checkpoints must not expose it.
    expect(Object.keys(runtime.getSnapshot())).not.toContain("transientEmphasis");
    expect(runtime.getTrace()).not.toHaveProperty("transientEmphasis");
    runtime.stop();
  });

  it("emphasizes the accepted SolutionBoard expression", () => {
    const runtime = createActionPageRuntime(plan());
    const accepted: ActionEvaluationResponse = {
      outcome: "accepted", evaluation: "correct", revision: 1,
      phase: "correct_pause", nextIndex: 1,
      committedWorld: { revision: 1, geometry: plan().world.geometry },
      solutionBoardContext: {
        actionId: "step/make", stage: "accepted", solutionRevision: "rev-1",
        board: {
          schemaVersion: 1, documentId: "d", headingLatex: "解：",
          expressions: [{ expressionId: "expr-1", sourceStepId: "step", latexTemplate: "x", slotValues: {}, phase: "complete" }],
        },
      },
    };
    runtime.applyEvaluation(accepted);
    expect(runtime.getView().transientEmphasis?.targets).toContainEqual({ surface: "solution-board", kind: "expression", id: "expr-1" });
    runtime.stop();
  });
});
