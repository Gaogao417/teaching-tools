/** Publish an AI-accepted bundle into an explicitly supplied private build root. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
async function main() {
  process.env.SQLITE_PATH = ":memory:";
  const { loadPlanAuthoringInputs } = await import("../src/services/planBuild/authoring/ReviewPlanDraft");
  const { publishApprovedPlanV4 } = await import("../src/services/planBuild/v4/PublishApprovedPlanV4");
  const { publishApprovedPlanV7 } = await import("../src/services/planBuild/v7/PublishApprovedPlanV7");
  const { materializeTutorPlanV5 } = await import("../src/services/planBuild/v5/MaterializeTutorPlanV5");
  const { validatePlanV7WorkspaceBindings } = await import("../src/services/planBuild/v7/ValidatePlanV7WorkspaceBindings");
  const { importApprovedPlanV5 } = await import("../src/services/planBuild/v5/ImportApprovedPlanV5");
  const args = process.argv.slice(2);
  const arg = (key: string) => { const i = args.indexOf(key); if (i < 0 || !args[i + 1]) throw new Error(`${key} required`); return args[i + 1]; };
  const root = resolve(arg("--canonical-root"));
  const { plan, protocols, resource_catalog: catalog } = JSON.parse(readFileSync(resolve(arg("--bundle")), "utf8"));
  const source = loadPlanAuthoringInputs(root, plan.question_ref.artifact_id, plan.solution_graph_ref.artifact_id, plan.approach_set_ref.artifact_id, plan.policy_profile_ref.artifact_id);
  if (!Array.isArray(protocols) || new Set(protocols.map((p: any) => p.protocol_id)).size !== protocols.length) throw new Error("duplicate or invalid protocol bundle");
  const inputs = { ...source, protocols: new Map<string, any>(protocols.map((p: any) => [p.protocol_id, p])) };
  const checked = materializeTutorPlanV5(plan, inputs);
  if (!checked.ok) throw new Error(checked.errors.join("; "));
  const bindingErrors = validatePlanV7WorkspaceBindings({ ...inputs, plan, projection: checked.projection, projection_hash: checked.projection_hash,
    materializer_version: "bundle-preflight", runtime_registry_version: source.snapshot.runtime_registry_version }, catalog);
  if (bindingErrors.length) throw new Error(bindingErrors.join("; "));
  // Preflight the entire bundle before any write; the caller hides the private
  // build root until the final import succeeds.
  for (const p of protocols) {
    const result = publishApprovedPlanV4(root, "teaching-protocol", p, { dryRun: true });
    if (!result.ok) throw new Error(result.errors.join("; "));
  }
  const checkPlan = () => plan.schema === "ai_teaching_tutor_plan_bundle/v7"
    ? publishApprovedPlanV7(root, plan, inputs, plan.content_hash, { dryRun: true, workspaceCatalog: catalog })
    : publishApprovedPlanV4(root, "tutor-plan", plan, { dryRun: true });
  const preview = checkPlan(); if (!preview.ok) throw new Error(preview.errors.join("; "));
  for (const p of protocols) {
    const result = publishApprovedPlanV4(root, "teaching-protocol", p);
    if (!result.ok) throw new Error(result.errors.join("; "));
  }
  const published = plan.schema === "ai_teaching_tutor_plan_bundle/v7"
    ? publishApprovedPlanV7(root, plan, inputs, plan.content_hash, { workspaceCatalog: catalog })
    : publishApprovedPlanV4(root, "tutor-plan", plan);
  if (!published.ok) throw new Error(published.errors.join("; "));
  const imported = importApprovedPlanV5({ canonicalRoot: root, anchored: true }, plan.artifact_id, { workspaceCatalog: catalog });
  if (!imported.ok) throw new Error(imported.errors.join("; "));
  const report = { status: "IMPORT_VERIFIED", plan: plan.artifact_id, projection_hash: imported.imported.projection_hash,
    materializer_version: imported.imported.materializer_version, browser_accepted: false, g7_accepted: false, f8_accepted: false };
  writeFileSync(resolve(arg("--output")), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "publication failed"); process.exitCode = 1; });
