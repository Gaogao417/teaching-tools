/**
 * P2-09 CLI：对 C-INT/C-TRU 8 个 case 跑 deterministic 判定并写 Run JSONL。
 *
 * 用法（在 web/backend 下）：
 *   tsx scripts/run-intake-truth-cases.ts \
 *     --candidates /abs/packA/canonical/candidates.json \
 *     --candidates /abs/packB/canonical/candidates.json \
 *     --truth-registry /abs/teaching-skills-mvp/artifacts/canonical-authoring/question-truth \
 *     --source-pack /abs/teaching-skills-mvp/documents/初三/2025届-…黄浦… \
 *     --run-id BR-0003 --sut sut-a-claudecode-glm52-qwen \
 *     --out data/benchmark-runs/intake-truth.jsonl
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { buildIntakeTruthRun, type CandidateExport } from "../src/services/benchmark/intakeTruthCases";
import { writeBenchmarkRunJsonl } from "../src/services/benchmark/benchmarkRunSkeleton";

function parseArgs(argv: string[]): Record<string, string[]> {
  const args: Record<string, string[]> = {};
  let current: string | null = null;
  for (const token of argv) {
    if (token.startsWith("--")) {
      current = token.slice(2);
      args[current] = args[current] ?? [];
    } else if (current) {
      args[current].push(token);
    }
  }
  return args;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const candidatePaths = args["candidates"] ?? [];
  const truthRegistry = (args["truth-registry"] ?? [])[0];
  const sourcePack = (args["source-pack"] ?? [])[0];
  const out = (args["out"] ?? ["data/benchmark-runs/intake-truth.jsonl"])[0];
  const runId = (args["run-id"] ?? ["BR-0003"])[0];
  const sutId = (args["sut"] ?? ["sut-a-claudecode-glm52-qwen"])[0];
  if (!candidatePaths.length || !truthRegistry || !sourcePack) {
    console.error("--candidates/--truth-registry/--source-pack are required");
    return 2;
  }
  const candidates = candidatePaths.map((file) =>
    JSON.parse(readFileSync(path.resolve(file), "utf8")) as CandidateExport,
  );
  const result = buildIntakeTruthRun({
    runId,
    sutId,
    datasetId: "similarity-mvp-benchmark-v1",
    datasetVersion: "v1",
    inputs: {
      candidates,
      truthRegistryDir: path.resolve(truthRegistry),
      sourcePackDir: path.resolve(sourcePack),
    },
  });
  if (!result.ok) {
    console.error(`validation failed: ${result.errors.join("; ")}`);
    return 1;
  }
  const written = writeBenchmarkRunJsonl(result.record, out);
  const record = result.record as {
    summary?: Record<string, number>;
    case_results?: Array<{ case_id: string; status: string; failure_class?: string }>;
  };
  console.log(
    `INTAKE/TRUTH RUN ${runId} (${sutId}): passed=${record.summary?.passed ?? 0} failed=${record.summary?.failed ?? 0} -> ${written}`,
  );
  for (const caseResult of record.case_results ?? []) {
    console.log(`  ${caseResult.case_id}: ${caseResult.status}${caseResult.failure_class ? ` (${caseResult.failure_class})` : ""}`);
  }
  return 0;
}

main();
