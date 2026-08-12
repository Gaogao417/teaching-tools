import { describe, expect, it } from "vitest";
import type { MakeParallelAction } from "../../../../shared/actionRuntime";
import type { PageRuntimeSnapshot, ActionSnapshotView } from "../types";
import { projectWorkspaceView } from "../projectWorkspaceView";
import { actionMachineRegistry } from "../registry";

const makeParallelAction: MakeParallelAction = {
  actionId: "mp1", sourceStepId: "s1", kind: "make-parallel", version: 1, title: "平行", instruction: "作平行线",
  input: { throughPointId: "P", referenceLineId: "L", availablePointIds: ["P", "Q"], availableLineIds: ["L", "M"], outputLineId: "OL" },
  localTruth: { throughPointId: "P", referenceLineId: "L" }, capabilities: [], answerSlots: [],
  validationPolicy: "local-training", submitOnComplete: false,
};

const geometry = {
  viewBox: { width: 100, height: 100 },
  points: [{ id: "P", x: 0, y: 0 }, { id: "Q", x: 30, y: 30 }],
  segments: [{ id: "L", from: "P", to: "Q" }, { id: "M", from: "Q", to: "P" }],
};

function pageFor(child: ActionSnapshotView): PageRuntimeSnapshot {
  return {
    plan: {
      planVersion: 5, exerciseId: "ex1", revision: 1, mode: "guided-practice",
      metadata: { taskId: "t1", title: "T", promptLatex: "", skillTags: [] },
      world: { geometry, revision: 1 },
      coach: { profileId: "c1", displayName: "Coach", avatarId: "a1", tone: "supportive" },
      actions: [makeParallelAction],
      currentActionId: "mp1",
      completedActionIds: [],
    },
    currentActionId: "mp1",
    completedActionIds: [],
    evidence: [],
    revision: 1,
    status: "active",
    wrongObjectIds: [],
    world: { committed: { geometry, revision: 1 }, draft: { geometry, revision: 1 }, revision: 1, commandBatches: [] },
  } as unknown as PageRuntimeSnapshot;
}

describe("projectWorkspaceView 3-layer affordance", () => {
  it("a reasonable-but-wrong object is candidate + hitTestable but NOT advanceEnabled", () => {
    const actor = actionMachineRegistry.create(makeParallelAction);
    const child = actor.getSnapshot();
    // Initial state: selecting the through-point; P and Q are both accepting.
    expect(child.enabledByKind.points).toEqual(["P", "Q"]);
    // Machine authored the local-truth advancing target.
    expect(child.advanceObjectIds).toEqual(["P"]);

    const view = projectWorkspaceView(pageFor(child), child);
    const entities = view.canvas.entities;

    // P is the correct advancing target.
    expect(entities["P"]).toMatchObject({ hitTestable: true, candidate: true, advanceEnabled: true, enabled: true });
    // Q is plausible + interactable, but NOT on the correct path — and it still
    // reaches the local guard (enabled stays true, renderer unaffected).
    expect(entities["Q"]).toMatchObject({ hitTestable: true, candidate: true, advanceEnabled: false, enabled: true });
  });

  it("falls back to enabled (advanceEnabled === enabled) when the machine omits local truth", () => {
    // Server-authoritative variant: no local truth → advanceObjectIds falls back
    // to the whole enabled set, preserving the pre-v2 behavior.
    const saAction: MakeParallelAction = { ...makeParallelAction, validationPolicy: "server-authoritative" };
    const actor = actionMachineRegistry.create(saAction);
    const child = actor.getSnapshot();
    expect(child.advanceObjectIds).toEqual(["P", "Q"]);
    const view = projectWorkspaceView(pageFor(child), child);
    expect(view.canvas.entities["P"].advanceEnabled).toBe(true);
    expect(view.canvas.entities["Q"].advanceEnabled).toBe(true);
  });
});
