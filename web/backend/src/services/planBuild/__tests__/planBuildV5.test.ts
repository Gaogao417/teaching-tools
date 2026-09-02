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
    assert.equal(imported.imported.graph.facts.length, 29);
    assert.equal(imported.imported.graph.inferences.length, 26);
    assert.deepEqual(imported.imported.plan.resolution_profiles.map((profile) => profile.default_view), ["beat", "chunk"]);
    assert.ok(imported.imported.projection_hash.startsWith("sha256:"));

    const inferenceById = new Map(imported.imported.graph.inferences.map((inference) => [inference.inference_id, inference]));
    assert.deepEqual(inferenceById.get("IF-01")?.premises, ["FN-01", "FN-02", "FN-03"]);
    assert.equal(inferenceById.get("IF-01")?.conclusion, "FN-05");
    assert.deepEqual(inferenceById.get("IF-08")?.premises, ["FN-02", "FN-04"]);
    assert.equal(inferenceById.get("IF-08")?.conclusion, "FN-12");
    assert.deepEqual(inferenceById.get("IF-16")?.premises, ["FN-18", "FN-17", "FN-19", "FN-16", "FN-12"]);
    assert.equal(inferenceById.get("IF-16")?.conclusion, "FN-20");
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
    group.fine_refs.fact_ids = group.fine_refs.fact_ids.filter((factId) => factId !== "FN-16");
    plan.content_hash = canonicalHash(plan as unknown as Record<string, unknown>, "plan");
    const result = validateApprovedPlanV5(plan, inputs);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((error) => error.includes("IF-14") && error.includes("premise FN-16")));
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
    target.solution_refs.fact_ids = target.solution_refs.fact_ids.filter((factId) => factId !== "FN-23");
    const protocols = new Map(imported.imported.protocols);
    protocols.set(protocol.protocol_id, protocol);
    const result = validateApprovedPlanV5(plan, { ...inputs, protocols });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((error) => error.includes("不在当前 Beat solution_refs")));
  });
}

void main();

// F7 Step 3：action_template 投影与 materializer registry 负例（TP@v11）。
async function runActionTemplateCasesSafe(): Promise<void> {
  const root = canonicalRoot();
  if (!root) return;
  await runActionTemplateCases(root);
}
void runActionTemplateCasesSafe();


function buildInputsFromImported(imp: Extract<ReturnType<typeof importApprovedPlanV5>, { ok: true }>["imported"]) {
  const snapshot = buildRuntimeRegistrySnapshot();
  return {
    truth: imp.truth,
    approachSet: imp.approachSet,
    graph: imp.graph,
    protocols: imp.protocols,
    profile: imp.profile,
    snapshot,
  } as Parameters<typeof validateApprovedPlanV5>[1];
}

async function runActionTemplateCases(root: string): Promise<void> {
  const imported = importApprovedPlanV5({ canonicalRoot: root }, "TP-SMV-009");
  assert.equal(imported.ok, true);
  if (!imported.ok) return;

  await runTest("v5 action_template projects into action_contracts (truth only in teachingInput; assessment strips it)", () => {
    const contracts = (imported.imported.projection as { action_contracts?: Array<{ resource_id: string; action_ref: string; learn: { kind: string; input: Record<string, unknown> }; assessment: { kind: string; input: Record<string, unknown> } }> }).action_contracts ?? [];
    const bt04 = contracts.find((contract) => contract.resource_id === "RES8");
    assert.ok(bt04, "TP@v11 RES8 action_template must project into action_contracts");
    assert.equal(bt04.action_ref, "tp:TP-SMV-009:1:mark-segment-values-bt04");
    assert.equal(bt04.assessment.kind, "mark-segment-values");
    assert.deepEqual(bt04.assessment.input.labels ?? [], [], "assessment student view carries NO truth labels (input.labels=[])");
    assert.deepEqual(bt04.assessment.input.availableSegmentIds, ["seg-AO", "seg-DO", "seg-BO", "seg-OE"]);
    // learn 投影保留 teachingInput 合并（教研/评估侧）；assessment 剥离（truth 隔离）。
    const learnLabels = (bt04.learn.input.labels as Array<{ segmentId: string }> | undefined) ?? [];
    assert.equal(learnLabels.length, 4, "learn projection merges teachingInput.labels");
  });

  await runTest("v5 materializer rejects an action_template whose kind is outside the runtime registry (fail closed)", () => {
    const inputs2 = buildInputsFromImported(imported.imported);
    const plan = structuredClone(imported.imported.plan) as TutorPlanV5Payload;
    for (const resource of plan.resources) {
      if (resource.kind !== "action_template" || !resource.content) continue;
      const template = JSON.parse(resource.content) as { kind: string };
      template.kind = "not-a-registered-kind";
      resource.content = JSON.stringify(template);
      break;
    }
    const result = validateApprovedPlanV5(plan, inputs2);
    assert.ok(
      !result.ok && result.errors.some((error: string) => error.includes("不在 registry")),
      `materializer must reject unknown action kind, got: ${result.ok ? "ok" : result.errors.join("; ")}`,
    );
  });
}