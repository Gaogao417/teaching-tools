/** Usage: tsx scripts/prepare-plan-v7-candidate.ts ROOT TP_ID NEW_VERSION BINDINGS_JSON OUTPUT_DIR */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { preparePlanV7Candidate } from "../src/services/planBuild/v7/PreparePlanV7Candidate";
const [root, tpId, version, bindingsFile, output] = process.argv.slice(2);
if (!root || !tpId || !version || !bindingsFile || !output) throw new Error("Required: ROOT TP_ID NEW_VERSION BINDINGS_JSON OUTPUT_DIR");
const outputDir = resolve(output);
const canonicalRoot = resolve(root);
if (outputDir === canonicalRoot || outputDir.startsWith(canonicalRoot + "/")) throw new Error("Candidate output must be outside canonical assets");
if (existsSync(join(canonicalRoot, "tutor-plan", tpId, `${version}.json`))) throw new Error("Target artifact version already exists");
const result = preparePlanV7Candidate({ canonicalRoot }, tpId, version, JSON.parse(readFileSync(bindingsFile, "utf8")), new Date().toISOString());
mkdirSync(outputDir, { recursive: true });
for (const [name, value] of Object.entries(result)) writeFileSync(join(outputDir, `${name}.json`), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ outputDir, ...result.review }, null, 2));
