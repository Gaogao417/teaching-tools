/**
 * markSegmentValue tests — pure (no React, no JSXGraph).
 *
 * Run via:  npx tsx src/poc/geometry-actions/__tests__/markSegmentValue.test.ts
 *
 * These also assert the EXTENSIBILITY invariant: this second action runs
 * through the SAME generic runtime with zero per-action branching.
 */
import assert from "node:assert/strict";
import { markSegmentValue } from "../actions/markSegmentValue.ts";
import { initRuntime, dispatch, viewOf } from "../engine/runtime.ts";
import { sequence } from "../engine/program.ts";
import type { RuntimeSnapshot } from "../engine/runtime.ts";
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

function startMarkSegmentValue(): RuntimeSnapshot {
  return initRuntime(
    sequence(markSegmentValue({ segment: "BC", expected: "3" })),
    initialWorld(),
  );
}

async function main(): Promise<void> {
  await runTest("initial view expects click on BC", () => {
    const snap = startMarkSegmentValue();
    const v = viewOf(snap);
    assert.ok(v);
    assert.deepEqual(v!.clickableSegments, ["BC"]);
    assert.equal(v!.inputs?.length ?? 0, 0);
    assert.equal(snap.program[0].actionKind, "mark-segment-value");
  });

  await runTest("clicking the wrong segment is rejected", () => {
    let snap = startMarkSegmentValue();
    snap = dispatch(snap, { kind: "segment-click", id: "DE" });
    const v = viewOf(snap);
    assert.deepEqual(v!.clickableSegments, ["BC"]); // still stage 1
    assert.equal(snap.feedback?.kind, "error");
  });

  await runTest("clicking BC reveals the input field", () => {
    let snap = startMarkSegmentValue();
    snap = dispatch(snap, { kind: "segment-click", id: "BC" });
    const v = viewOf(snap);
    assert.equal(v!.clickableSegments.length, 0);
    assert.equal(v!.inputs?.length, 1);
    assert.equal(v!.inputs![0].objectId, "value:BC");
    assert.equal(v!.inputs![0].value, "");
    assert.equal(v!.canSubmit, true);
  });

  await runTest("input-change updates the echoed value without completing", () => {
    let snap = startMarkSegmentValue();
    snap = dispatch(snap, { kind: "segment-click", id: "BC" });
    snap = dispatch(snap, {
      kind: "input-change",
      objectId: "value:BC",
      value: "2",
    });
    const v = viewOf(snap);
    assert.equal(v!.inputs![0].value, "2");
    assert.equal(snap.finished, false);
  });

  await runTest("submitting the wrong value is rejected", () => {
    let snap = startMarkSegmentValue();
    snap = dispatch(snap, { kind: "segment-click", id: "BC" });
    snap = dispatch(snap, { kind: "input-change", objectId: "value:BC", value: "2" });
    snap = dispatch(snap, { kind: "submit" });
    assert.equal(snap.finished, false);
    assert.equal(snap.feedback?.kind, "error");
  });

  await runTest("submitting the correct value completes and commits", () => {
    let snap = startMarkSegmentValue();
    snap = dispatch(snap, { kind: "segment-click", id: "BC" });
    snap = dispatch(snap, { kind: "input-change", objectId: "value:BC", value: "3" });
    snap = dispatch(snap, { kind: "submit" });
    assert.equal(snap.finished, true);
    assert.equal(snap.feedback?.kind, "success");
    const committed = snap.world.objects["value:BC"];
    assert.ok(committed);
    assert.equal(committed!.kind, "segment-value");
    assert.equal((committed as { value: string }).value, "3");
  });
}

void main();
