/** F4 多分辨率补救：真实 v5 artifact 全链与细图闭包负例。 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import * as path from "node:path";

import { canonicalHash, type TutorPlanV5Payload } from "../canonicalInputs";
import { buildRuntimeRegistrySnapshot } from "../RuntimeRegistrySnapshot";
import { importApprovedPlanV5 } from "../v5/ImportApprovedPlanV5";
import { validateApprovedPlanV5 } from "../v5/MaterializeTutorPlanV5";

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  console.log(`PASS ${name}`);
}

function canonicalRoot(): string | null {
  const configured = process.env.AI_TEACHING_CANONICAL_ROOT;
  const candidate = configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), "../../..", "teaching-skills-mvp/artifacts/canonical-authoring");
  return existsSync(path.join(candidate, "tutor-plan/TP-SMV-009/registry.yaml")) ? candidate : null;
}

async function main(): Promise<void> {
  const root = canonicalRoot();
  if (!root) {
    console.log("PASS planBuildV5 skipped: canonical-authoring sibling unavailable");
    return;
  }
  const imported = importApprovedPlanV5({ canonicalRoot: root }, "TP-SMV-009");
  assert.equal(imported.ok, true, imported.ok ? "" : imported.errors.join("\n"));
  if (!imported.ok) return;

  await runTest("v5 real artifact imports with fine graph and two resolutions", () => {
    assert.equal(imported.imported.plan.schema, "ai_teaching_tutor_plan_bundle/v5");
    assert.equal(imported.imported.graph.facts.length, 36);
    assert.equal(imported.imported.graph.inferences.length, 26);
    assert.deepEqual(imported.imported.plan.resolution_profiles.map((profile) => profile.default_view), ["beat", "chunk"]);
    assert.ok(imported.imported.projection_hash.startsWith("sha256:"));

    const inferenceById = new Map(imported.imported.graph.inferences.map((inference) => [inference.inference_id, inference]));
    assert.deepEqual(inferenceById.get("IF-01")?.premises, ["FN-06", "FN-07"]);
    assert.equal(inferenceById.get("IF-01")?.conclusion, "FN-08");
    assert.deepEqual(inferenceById.get("IF-08")?.premises, ["FN-16", "FN-17"]);
    assert.equal(inferenceById.get("IF-08")?.conclusion, "FN-18");
    assert.deepEqual(inferenceById.get("IF-16")?.premises, ["FN-24", "FN-25", "FN-26"]);
    assert.equal(inferenceById.get("IF-16")?.conclusion, "FN-27");
    const inferenceText = JSON.stringify(imported.imported.graph.inferences);
    for (const forbidden of ["共线", "同向射线", "射线重合"]) assert.ok(!inferenceText.includes(forbidden));

    const groups = new Map(
      imported.imported.plan.chunks.flatMap((chunk) => chunk.presentation_groups).map((group) => [group.group_id, group]),
    );
    assert.equal(groups.get("PG-01")?.label, "证明 △CAD 与 △CBA 子母型相似");
    assert.equal(groups.get("PG-03")?.label, "证明 △DAO 与 △DBA 子母型相似");
    assert.equal(groups.get("PG-05")?.label, "证明 △BOE 与 △AOD 蝶形相似");
  });

  const inputs = {
    truth: imported.imported.truth,
    approachSet: imported.imported.approachSet,
    graph: imported.imported.graph,
    protocols: imported.imported.protocols,
    profile: imported.imported.profile,
    snapshot: buildRuntimeRegistrySnapshot(),
  };

  await runTest("v5 rejects presentation group whose inference loses a premise", () => {
    const plan = structuredClone(imported.imported.plan) as TutorPlanV5Payload;
    const group = plan.chunks[1].presentation_groups.find((entry) => entry.group_id === "PG-04");
    assert.ok(group);
    group.fine_refs.fact_ids = group.fine_refs.fact_ids.filter((factId) => factId !== "FN-13");
    plan.content_hash = canonicalHash(plan as unknown as Record<string, unknown>, "plan");
    const result = validateApprovedPlanV5(plan, inputs);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((error) => error.includes("IF-13") && error.includes("premise FN-13")));
  });

  await runTest("v5 rejects a learner resolution that keeps the goal but drops mainline reasoning", () => {
    const plan = structuredClone(imported.imported.plan) as TutorPlanV5Payload;
    plan.resolution_profiles[0].chunk_ids = ["CH-03"];
    plan.content_hash = canonicalHash(plan as unknown as Record<string, unknown>, "plan");
    const result = validateApprovedPlanV5(plan, inputs);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((error) => error.includes("压缩丢失主路线")));
  });

  await runTest("v5 rejects gate fact outside its Beat fine references", () => {
    const plan = structuredClone(imported.imported.plan) as TutorPlanV5Payload;
    const protocol = structuredClone(imported.imported.protocols.get("PR-SMV-001")!);
    const target = protocol.beats.find((beat) => beat.beat_id === "BT-05")!;
    target.solution_refs.fact_ids = target.solution_refs.fact_ids.filter((factId) => factId !== "FN-29");
    const protocols = new Map(imported.imported.protocols);
    protocols.set(protocol.protocol_id, protocol);
    const result = validateApprovedPlanV5(plan, { ...inputs, protocols });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((error) => error.includes("不在当前 Beat solution_refs")));
  });
}

void main();
