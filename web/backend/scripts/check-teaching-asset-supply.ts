/** Read-only production handoff. Uses the real Approved loaders/materializer.
 * No task IDs, geometry seeds, fixture providers or implicit canonical roots.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
async function main() {
// Legacy registry snapshot imports initialize a database. Keep it in memory.
process.env.SQLITE_PATH = ":memory:";
const { loadApprovedTruth, loadApprovedSolutionGraph } = await import("../src/services/planBuild/canonicalInputs");
const { importApprovedPlanV5 } = await import("../src/services/planBuild/v5/ImportApprovedPlanV5");

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${name} required`);
  return args[i + 1];
};
const root = resolve(value("--canonical-root"));
const question = value("--question");
const graphId = value("--graph");
const planId = value("--plan");
for (const [id, prefix] of [[question, "QT"], [graphId, "RG"], [planId, "TP"]]) {
  if (!new RegExp(`^${prefix}-[A-Z0-9]+-[0-9]{3,}$`).test(id)) throw new Error("invalid artifact identity");
}
const started = performance.now();
const deps = { canonicalRoot: root, anchored: true };
const truth = loadApprovedTruth(deps, question);
const graph = loadApprovedSolutionGraph(deps, graphId);
const plan = importApprovedPlanV5(deps, planId);
const errors = [truth, graph, plan].flatMap(r => r.ok ? [] : r.errors);
if (truth.ok && graph.ok && (graph.payload.question_ref.artifact_id !== question ||
  graph.payload.question_ref.version !== truth.payload.version ||
  graph.payload.question_ref.content_hash !== truth.payload.content_hash)) errors.push("graph does not bind current requested QuestionTruth");
if (plan.ok && (plan.imported.truth.artifact_id !== question || plan.imported.graph.graph_id !== graphId)) {
  errors.push("plan does not bind requested question/graph");
}
const report = { status: errors.length ? "BLOCKED" : "IMPORT_VERIFIED", question, graph: graphId, plan: planId,
  errors, machine_seconds: (performance.now() - started) / 1000,
  browser_accepted: false, g7_accepted: false, f8_accepted: false,
  ...(plan.ok && !errors.length ? { projection_hash: plan.imported.projection_hash,
    materializer_version: plan.imported.materializer_version } : {}) };
const output = args.includes("--output") ? resolve(value("--output")) : null;
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
process.exitCode = errors.length ? 1 : 0;

}
main().catch(error => { console.error(String(error)); process.exitCode = 1; });
