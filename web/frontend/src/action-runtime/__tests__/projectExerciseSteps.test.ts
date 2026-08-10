import { describe, expect, it } from "vitest";
import type { ActionContract, ActionEvidence, ExercisePlan } from "../../../../shared/actionRuntime";
import { projectExerciseSteps } from "../projection/projectExerciseSteps";
import { actionMachineRegistry } from "../registry";
import type { ActionSnapshotView, PageRuntimeSnapshot } from "../types";

const actions: ActionContract[] = [
  {
    actionId: "step-1/make",
    sourceStepId: "step-1",
    kind: "make-parallel",
    version: 1,
    title: "作平行辅助线",
    instruction: "先作平行线",
    input: { throughPointId: "C", referenceLineId: "AD", availablePointIds: ["C"], availableLineIds: ["AD"], outputLineId: "parallel", outputLineLabel: "CF" },
    capabilities: [],
    answerSlots: [],
    validationPolicy: "local-teaching",
    submitOnComplete: false,
  },
  {
    actionId: "step-1/intersect",
    sourceStepId: "step-1",
    kind: "intersect-carriers",
    version: 1,
    title: "延长相交",
    instruction: "再连接并延长",
    input: { carrierPointIds: ["B", "E"], resultPointId: "F", availablePointIds: ["B", "E"], parallelLineId: "parallel", outputCarrierLineId: "carrier", outputPointId: "F" },
    capabilities: [],
    answerSlots: [],
    validationPolicy: "local-teaching",
    submitOnComplete: true,
  },
  {
    actionId: "step-2/mark",
    sourceStepId: "step-2",
    kind: "mark-segment-values",
    version: 1,
    title: "标第一组份数",
    instruction: "标出 AP 与 CF",
    input: { labels: [], availableSegmentIds: ["AP", "CF"], autoFocusSequence: true },
    capabilities: [],
    answerSlots: [],
    validationPolicy: "local-teaching",
    submitOnComplete: true,
  },
];

const plan = {
  actions,
  currentActionId: actions[0].actionId,
  completedActionIds: [],
} as unknown as ExercisePlan;

function page(overrides: Partial<PageRuntimeSnapshot> = {}): PageRuntimeSnapshot {
  return {
    plan,
    currentActionId: plan.currentActionId,
    completedActionIds: [],
    evidence: [],
    ...overrides,
  } as PageRuntimeSnapshot;
}

function child(points: string[] = [], lines: string[] = []): ActionSnapshotView {
  return {
    selectedByKind: { points, lines, angles: [] },
    selectedObjectIds: [...points, ...lines],
  } as unknown as ActionSnapshotView;
}

const slotValues = (record: ReturnType<typeof projectExerciseSteps>[number]["record"]) => Object.fromEntries(
  (record || []).filter((token) => token.kind === "slot").map((token) => [token.slotId, token.value]),
);

const makeEvidence: ActionEvidence = {
  actionId: "step-1/make",
  sourceStepId: "step-1",
  kind: "make-parallel",
  version: 1,
  throughPointId: "C",
  referenceLineId: "AD",
};

describe("projectExerciseSteps", () => {
  it("groups registry projections by source step without inspecting Action kinds", () => {
    const steps = projectExerciseSteps(page(), child(), actionMachineRegistry);
    expect(steps).toHaveLength(2);
    expect(steps[0].actionIds).toEqual(["step-1/make", "step-1/intersect"]);
    expect(steps[1]).toMatchObject({ sourceStepId: "step-2", status: "pending" });
  });

  it("merges Action-owned construction fields into the step record progressively", () => {
    const selectedPoint = projectExerciseSteps(page(), child(["C"]), actionMachineRegistry);
    expect(slotValues(selectedPoint[0].record)).toEqual({
      "through-point": "C",
      "helper-line": undefined,
      "reference-line": undefined,
      "carrier-line": undefined,
      "intersection-point": undefined,
    });

    const madeParallel = projectExerciseSteps(page({
      currentActionId: "step-1/intersect",
      completedActionIds: ["step-1/make"],
      evidence: [makeEvidence],
    }), child(["B"]), actionMachineRegistry);
    expect(slotValues(madeParallel[0].record)).toEqual({
      "through-point": "C",
      "helper-line": "CF",
      "reference-line": "AD",
      "carrier-line": undefined,
      "intersection-point": undefined,
    });

    const intersectionEvidence: ActionEvidence = {
      actionId: "step-1/intersect",
      sourceStepId: "step-1",
      kind: "intersect-carriers",
      version: 1,
      carrierPointIds: ["B", "E"],
    };
    const completed = projectExerciseSteps(page({
      currentActionId: "step-2/mark",
      completedActionIds: ["step-1/make", "step-1/intersect"],
      evidence: [makeEvidence, intersectionEvidence],
    }), child(), actionMachineRegistry);
    expect(completed[0]).toMatchObject({ status: "complete" });
    expect(slotValues(completed[0].record)).toEqual({
      "through-point": "C",
      "helper-line": "CF",
      "reference-line": "AD",
      "carrier-line": "BE",
      "intersection-point": "F",
    });
  });
});
