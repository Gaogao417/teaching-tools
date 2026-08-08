/**
 * projector tests — the frontend projection layer (spec → WorldState /
 * InteractionView, GeometryEvent → RuntimeActionEvent).
 * Pure (no React, no JSXGraph).
 *
 * Run via: npx tsx src/poc/geometry-actions/__tests__/projector.test.ts
 */
import assert from "node:assert/strict";
import { projectSpecToWorld } from "../projector/specToWorld.ts";
import { projectSpecToInteraction } from "../projector/specToInteraction.ts";
import { applyEvent, buildSubmitAction, emptyDraft } from "../projector/eventAdapter.ts";
import type { PocRuntimeSpec } from "../shared/runtimeContracts.ts";

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

/** A minimal spec with the two sub-steps of makeParallel, stage = pick-through-point. */
function sampleSpec(): PocRuntimeSpec {
  return {
    instanceId: "x",
    taskId: "poc",
    prompt: "过 A 作 BC 的平行线",
    scene: {
      sceneKind: "geometry",
      viewBox: [-6, 6, 8, -4],
      entities: [
        { kind: "vertex", id: "A", x: 0, y: 4 },
        { kind: "vertex", id: "B", x: -4, y: -2 },
        { kind: "edge", id: "BC", from: "B", to: "C" },
      ],
      zones: [],
      anchors: [],
    },
    flow: {
      currentStepId: "make-parallel",
      completionPolicy: "multi-step",
      steps: [
        {
          id: "make-parallel/pick-through-point",
          title: "选经过点",
          goal: "选择点 A",
          status: "active",
          submitMode: "immediate",
          allowedActions: [{ type: "select", target: "A", selectionKind: "single" }],
        },
        {
          id: "make-parallel/pick-parallel-segment",
          title: "选平行线段",
          goal: "选择线段 BC",
          status: "locked",
          submitMode: "immediate",
          allowedActions: [],
        },
      ],
    },
    runtimeState: {
      phase: "answering",
      currentStepId: "make-parallel",
      completedStepIds: [],
      problemStatus: "pending",
      attempts: 0,
    },
  };
}

async function main(): Promise<void> {
  await runTest("projectSpecToWorld: vertex→point, edge→segment", () => {
    const world = projectSpecToWorld(sampleSpec());
    assert.equal(world.objects["A"].kind, "point");
    assert.equal(world.objects["BC"].kind, "segment");
    assert.deepEqual((world.objects["BC"] as { endpoints: [string, string] }).endpoints, ["B", "C"]);
  });

  await runTest("projectSpecToWorld: derived entities map to derived MathObjects", () => {
    const spec = sampleSpec();
    spec.scene.entities.push({ kind: "parallel-line", id: "parallel:A:BC", through: "A", parallelTo: "BC" });
    spec.scene.entities.push({ kind: "intersection", id: "F", of: ["parallel:A:BC", "DE"] });
    const world = projectSpecToWorld(spec);
    assert.equal(world.objects["parallel:A:BC"].kind, "parallel-line");
    assert.equal(world.objects["F"].kind, "intersection");
    assert.equal("x" in world.objects["F"], false); // no coordinates
  });

  await runTest("projectSpecToInteraction: active select→clickablePoints", () => {
    const iv = projectSpecToInteraction(sampleSpec());
    assert.deepEqual(iv.clickablePoints, ["A"]);
    assert.deepEqual(iv.clickableSegments, []);
  });

  await runTest("projectSpecToInteraction: active select on edge→clickableSegments", () => {
    const spec = sampleSpec();
    spec.flow.steps[0].status = "done";
    spec.flow.steps[1].status = "active";
    spec.flow.steps[1].allowedActions = [{ type: "select", target: "BC", selectionKind: "single" }];
    const iv = projectSpecToInteraction(spec);
    assert.deepEqual(iv.clickableSegments, ["BC"]);
    assert.deepEqual(iv.clickablePoints, []);
  });

  await runTest("projectSpecToInteraction: input action→inputs + canSubmit (explicit)", () => {
    const spec = sampleSpec();
    spec.flow.steps[0].status = "done";
    spec.flow.steps[1].status = "active";
    spec.flow.steps[1].submitMode = "explicit";
    spec.flow.steps[1].allowedActions = [{ type: "input", target: "value:BC", valueKind: "integer" }];
    const iv = projectSpecToInteraction(spec);
    assert.equal(iv.inputs!.length, 1);
    assert.equal(iv.inputs![0].objectId, "value:BC");
    assert.equal(iv.canSubmit, true);
  });

  await runTest("eventAdapter: point-click accumulates into selection slot", () => {
    let draft = emptyDraft();
    draft = applyEvent(draft, { kind: "point-click", id: "A" }, "through-point");
    assert.deepEqual(draft.selections["through-point"], ["A"]);
  });

  await runTest("eventAdapter: input-change writes to inputs", () => {
    let draft = emptyDraft();
    draft = applyEvent(draft, { kind: "input-change", objectId: "value:BC", value: "3" });
    assert.equal(draft.inputs["value:BC"], "3");
  });

  await runTest("eventAdapter: buildSubmitAction serializes draft into value", () => {
    let draft = emptyDraft();
    draft = applyEvent(draft, { kind: "point-click", id: "A" }, "through-point");
    const action = buildSubmitAction("make-parallel/pick-through-point", draft);
    assert.equal(action.type, "submit");
    assert.equal(action.stepId, "make-parallel/pick-through-point");
    const parsed = JSON.parse(action.value!) as { selections: Record<string, string[]> };
    assert.deepEqual(parsed.selections["through-point"], ["A"]);
  });
}

void main();
