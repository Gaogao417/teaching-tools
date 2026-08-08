/**
 * markSegmentValueEngine tests — second backend engine (consumes input value).
 * Pure (no React, no JSXGraph).
 *
 * Run via: npx tsx src/poc/geometry-actions/__tests__/markSegmentValueEngine.test.ts
 */
import assert from "node:assert/strict";
import { createMarkSegmentValueEngine, segmentValueId } from "../backend/markSegmentValueEngine.ts";
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
  return createMarkSegmentValueEngine({ segment: "BC" }, { expected: "3" });
}

function submit(payload: Record<string, unknown>) {
  return { type: "submit" as const, stepId: "mark-segment-value", value: JSON.stringify(payload) };
}

async function main(): Promise<void> {
  await runTest("init starts at pick-segment", () => {
    assert.equal(newEngine().init(initialWorld()).stage, "pick-segment");
  });

  await runTest("reduce: wrong segment rejected", () => {
    const e = newEngine();
    const t = e.reduce(e.init(initialWorld()), submit({ selections: { segment: ["DE"] } }), initialWorld());
    assert.equal(t.kind, "reject");
    assert.equal(t.state.stage, "pick-segment");
  });

  await runTest("reduce: correct segment advances to enter-value", () => {
    const e = newEngine();
    const t = e.reduce(e.init(initialWorld()), submit({ selections: { segment: ["BC"] } }), initialWorld());
    assert.equal(t.kind, "continue");
    assert.equal(t.state.stage, "enter-value");
  });

  await runTest("reduce: wrong value rejected", () => {
    const e = newEngine();
    const state = e.reduce(e.init(initialWorld()), submit({ selections: { segment: ["BC"] } }), initialWorld()).state;
    const t = e.reduce(state, submit({ inputs: { [segmentValueId("BC")]: "2" } }), initialWorld());
    assert.equal(t.kind, "reject");
  });

  await runTest("reduce: correct value completes", () => {
    const e = newEngine();
    const state = e.reduce(e.init(initialWorld()), submit({ selections: { segment: ["BC"] } }), initialWorld()).state;
    const t = e.reduce(state, submit({ inputs: { [segmentValueId("BC")]: "3" } }), initialWorld());
    assert.equal(t.kind, "complete");
    assert.equal(t.result!.value, "3");
  });

  await runTest("commit adds segment-value object", () => {
    const e = newEngine();
    const committed = e.commit(initialWorld(), { segment: "BC", value: "3" });
    const v = committed.objects["value:BC"];
    assert.ok(v);
    assert.equal(v!.kind, "segment-value");
    assert.equal((v as { value: string }).value, "3");
  });

  await runTest("answerKey '3' (expected) does NOT leak into flow JSON", () => {
    const e = newEngine();
    const flow = e.buildFlow({ stage: "pick-segment" });
    const json = JSON.stringify(flow);
    assert.ok(!json.includes("expected"), "expected leaked into flow JSON");
    assert.ok(!json.includes("\"3\""), "answer value leaked into flow JSON");
  });
}

void main();
