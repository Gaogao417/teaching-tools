/** Publish an AI-accepted bundle into an explicitly supplied private build root.
 *
 * F4 题图/生产补强：可选 --task-id 把生产 resource_catalog（题图 baseGeometry +
 * RG 板书目录）作为 workspace-catalog/<planId> 发布进本 root，并登记
 * vnext-task-bindings.yaml（append-only 本地布局，非新跨仓合同）。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

function publishWorkspaceCatalog(root: string, planId: string, taskIdentity: string, catalog: unknown): void {
  if (!catalog || typeof catalog !== "object") throw new Error("--task-id requires the bundle resource_catalog (workspace catalog)");
  const dir = resolve(root, "workspace-catalog", planId);
  mkdirSync(dir, { recursive: true });
  const versionFile = resolve(dir, "v1.json");
  if (existsSync(versionFile)) throw new Error("workspace catalog version v1 already exists (append-only)");
  writeFileSync(versionFile, JSON.stringify(catalog, null, 2) + "\n", { flag: "wx" });
  writeFileSync(resolve(dir, "registry.yaml"), [
    `artifact_id: ${planId}`,
    "current_version: v1",
    "versions:",
    "- {version: v1, status: Approved, task_id: " + taskIdentity + "}",
    "",
  ].join("\n"), { flag: "wx" });
  const bindingFile = resolve(root, "vnext-task-bindings.yaml");
  let doc: { bindings?: Record<string, unknown> } = {};
  if (existsSync(bindingFile)) {
    doc = parseYaml(readFileSync(bindingFile, "utf8")) || {};
    if (typeof doc !== "object" || Array.isArray(doc)) throw new Error("vnext-task-bindings.yaml is corrupted");
  }
  doc.bindings = doc.bindings ?? {};
  if (doc.bindings[taskIdentity] && doc.bindings[taskIdentity].tp_id !== planId) {
    throw new Error(`task ${taskIdentity} is already bound to another plan (append-only; use a new task id)`);
  }
  doc.bindings[taskIdentity] = { tp_id: planId, scenario_id: `production:${planId}`, catalog: `workspace-catalog/${planId}/v1.json` };
  writeFileSync(bindingFile, stringifyYaml(doc));
}

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
  const optional = (key: string) => { const i = args.indexOf(key); return i >= 0 && args[i + 1] ? args[i + 1] : undefined; };
  const root = resolve(arg("--canonical-root"));
  const taskIdentity = optional("--task-id");
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
  if (taskIdentity) {
    publishWorkspaceCatalog(root, plan.artifact_id, taskIdentity, catalog);
  }
  const report = { status: "IMPORT_VERIFIED", plan: plan.artifact_id, projection_hash: imported.imported.projection_hash,
    materializer_version: imported.imported.materializer_version, browser_accepted: false, g7_accepted: false, f8_accepted: false,
    ...(taskIdentity ? { task_id: taskIdentity, workspace_catalog: `workspace-catalog/${plan.artifact_id}/v1.json` } : {}) };
  writeFileSync(resolve(arg("--output")), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "publication failed"); process.exitCode = 1; });
