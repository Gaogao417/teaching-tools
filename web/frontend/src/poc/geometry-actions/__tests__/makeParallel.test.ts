/**
 * makeParallel tests — pure (no React, no JSXGraph).
 *
 * Run via:  npx tsx src/poc/geometry-actions/__tests__/makeParallel.test.ts
 */
import assert from "node:assert/strict";
import { makeParallel } from "../actions/makeParallel.ts";
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

function startMakeParallel(): RuntimeSnapshot {
  return initRuntime(
    sequence(
      makeParallel({
        through: "A",
        parallelTo: "BC",
        intersectionWith: "DE",
        intersectionPoint: "F",
      }),
    ),
    initialWorld(),
  );
}

async function main(): Promise<void> {
  await runTest("initial view expects click on A", () => {
    const snap = startMakeParallel();
    const v = viewOf(snap);
    assert.ok(v);
    assert.deepEqual(v!.clickablePoints, ["A"]);
    assert.deepEqual(v!.clickableSegments, []);
    assert.equal(snap.actionIndex, 0);
    assert.equal(snap.program[0].actionKind, "make-parallel");
  });

  await runTest("clicking B (wrong point) is rejected and state does not advance", () => {
    let snap = startMakeParallel();
    snap = dispatch(snap, { kind: "point-click", id: "B" });
    const v = viewOf(snap);
    // Still stage 1: only A clickable.
    assert.deepEqual(v!.clickablePoints, ["A"]);
    assert.equal(snap.actionIndex, 0);
    assert.equal(snap.feedback?.kind, "error");
  });

  await runTest("clicking A advances to stage 2 (pick parallel segment)", () => {
    let snap = startMakeParallel();
    snap = dispatch(snap, { kind: "point-click", id: "A" });
    const v = viewOf(snap);
    assert.deepEqual(v!.clickablePoints, []);
    assert.deepEqual(v!.clickableSegments, ["BC"]);
    assert.deepEqual(v!.highlightedObjects, ["A"]);
    // No error feedback on success-continue.
    assert.equal(snap.feedback?.kind, undefined);
  });

  await runTest("stage 2: clicking wrong segment is rejected", () => {
    let snap = startMakeParallel();
    snap = dispatch(snap, { kind: "point-click", id: "A" }); // -> stage 2
    snap = dispatch(snap, { kind: "segment-click", id: "DE" }); // wrong
    const v = viewOf(snap);
    assert.deepEqual(v!.clickableSegments, ["BC"]); // still stage 2
    assert.equal(snap.actionIndex, 0);
    assert.equal(snap.feedback?.kind, "error");
  });

  await runTest("stage 2: clicking BC completes the action", () => {
    let snap = startMakeParallel();
    snap = dispatch(snap, { kind: "point-click", id: "A" }); // -> stage 2
    snap = dispatch(snap, { kind: "segment-click", id: "BC" }); // complete
    assert.equal(snap.finished, true);
    assert.equal(snap.feedback?.kind, "success");
  });

  await runTest("commit adds a parallel-line object with dependency-only shape", () => {
    let snap = startMakeParallel();
    snap = dispatch(snap, { kind: "point-click", id: "A" });
    snap = dispatch(snap, { kind: "segment-click", id: "BC" });
    const parallel = snap.world.objects["parallel:A:BC"];
    assert.ok(parallel, "expected parallel-line object");
    assert.equal(parallel!.kind, "parallel-line");
    assert.equal((parallel as { through: string }).through, "A");
    assert.equal((parallel as { parallelTo: string }).parallelTo, "BC");
    // No coordinates on the derived line.
    assert.equal("x" in parallel, false);
    assert.equal("y" in parallel, false);
  });

  await runTest("commit adds intersection F as a dependency, not coordinates", () => {
    let snap = startMakeParallel();
    snap = dispatch(snap, { kind: "point-click", id: "A" });
    snap = dispatch(snap, { kind: "segment-click", id: "BC" });
    const f = snap.world.objects["F"];
    assert.ok(f, "expected intersection point F");
    assert.equal(f!.kind, "intersection");
    assert.deepEqual((f as { of: [string, string] }).of, ["parallel:A:BC", "DE"]);
    assert.equal("x" in f, false);
    assert.equal("y" in f, false);
  });
}

void main();
