/**
 * makeParallelEngine tests — the backend engine that judges with a private
 * answerKey. Pure (no React, no JSXGraph).
 *
 * Run via: npx tsx src/poc/geometry-actions/__tests__/makeParallelEngine.test.ts
 */
import assert from "node:assert/strict";
import { createMakeParallelEngine } from "../backend/makeParallelEngine.ts";
import type { WorldState } from "../domain/geometry.ts";

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function initialWorld(): WorldState {
  return {
    objects: {
      A: { kind: "point", id: "A", x: 0, y: 4 },
      B: { kind: "point", id: "B", x: -4, y: -2 },
      C: { kind: "point", id: "C", x: -1, y: -2 },
      D: { kind: "point", id: "D", x: 3, y: 1 },
      E: { kind: "point", id: "E", x: 6, y: -3 },
      BC: { kind: "segment", id: "BC", endpoints: ["B", "C"] },
      DE: { kind: "segment", id: "DE", endpoints: ["D", "E"] },
    },
  };
}

function newEngine() {
  // params are public; the answerKey is PRIVATE to the engine.
  return createMakeParallelEngine(
    { through: "A", parallelTo: "BC", intersectionWith: "DE", intersectionPoint: "F" },
    { through: "A", parallelTo: "BC" },
  );
}

function submit(payload: Record<string, unknown>) {
  return { type: "submit" as const, stepId: "make-parallel", value: JSON.stringify(payload) };
}

async function main(): Promise<void> {
  await runTest("init starts at pick-through-point", () => {
    const e = newEngine();
    assert.equal(e.init(initialWorld()).stage, "pick-through-point");
  });

  await runTest("reduce: wrong point rejected, state unchanged", () => {
    const e = newEngine();
    const state = e.init(initialWorld());
    const t = e.reduce(state, submit({ selections: { "through-point": ["B"] } }), initialWorld());
    assert.equal(t.kind, "reject");
    assert.equal(t.state.stage, "pick-through-point");
  });

  await runTest("reduce: correct point advances to pick-parallel-segment", () => {
    const e = newEngine();
    const state = e.init(initialWorld());
    const t = e.reduce(state, submit({ selections: { "through-point": ["A"] } }), initialWorld());
    assert.equal(t.kind, "continue");
    assert.equal(t.state.stage, "pick-parallel-segment");
    assert.equal((t.state as { through: string }).through, "A");
  });

  await runTest("reduce: wrong segment rejected", () => {
    const e = newEngine();
    let state = e.init(initialWorld());
    state = e.reduce(state, submit({ selections: { "through-point": ["A"] } }), initialWorld()).state;
    const t = e.reduce(state, submit({ selections: { "parallel-segment": ["DE"] } }), initialWorld());
    assert.equal(t.kind, "reject");
    assert.equal(t.state.stage, "pick-parallel-segment");
  });

  await runTest("reduce: correct segment completes", () => {
    const e = newEngine();
    let state = e.init(initialWorld());
    state = e.reduce(state, submit({ selections: { "through-point": ["A"] } }), initialWorld()).state;
    const t = e.reduce(state, submit({ selections: { "parallel-segment": ["BC"] } }), initialWorld());
    assert.equal(t.kind, "complete");
    assert.ok(t.result);
    assert.equal(t.result!.lineId, "parallel:A:BC");
  });

  await runTest("commit adds parallel-line + intersection F (no coordinates)", () => {
    const e = newEngine();
    const world = initialWorld();
    const committed = e.commit(world, { through: "A", parallelTo: "BC", lineId: "parallel:A:BC" });
    const line = committed.objects["parallel:A:BC"];
    assert.ok(line);
    assert.equal(line!.kind, "parallel-line");
    const f = committed.objects["F"];
    assert.ok(f);
    assert.equal(f!.kind, "intersection");
    assert.deepEqual((f as { of: [string, string] }).of, ["parallel:A:BC", "DE"]);
    // No coordinates on derived objects.
    assert.equal("x" in f, false);
  });

  await runTest("buildFlow: stage 1 exposes only the through-point as selectable", () => {
    const e = newEngine();
    const flow = e.buildFlow({ stage: "pick-through-point" });
    const active = flow.steps.find((s) => s.status === "active")!;
    assert.equal(active.allowedActions.length, 1);
    assert.equal(active.allowedActions[0].target, "A");
  });

  await runTest("answerKey does NOT leak into the serialized flow", () => {
    const e = newEngine();
    const flow = e.buildFlow({ stage: "pick-through-point" });
    const json = JSON.stringify(flow);
    // The answerKey is { through: "A", parallelTo: "BC" }; "A"/"BC" DO appear as
    // prompt/target text (that's public). What must NOT appear is a field named
    // answerKey or expected. This is the leak guard.
    assert.ok(!json.includes("answerKey"), "answerKey leaked into flow JSON");
    assert.ok(!json.includes("expected"), "expected leaked into flow JSON");
  });
}

void main();
