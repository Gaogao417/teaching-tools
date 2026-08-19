/**
 * P3-10 CLI：对 C-APP 4 个 case 跑 deterministic 判定并写 Run JSONL。
 *
 * 用法（在 web/backend 下）：
 *   tsx scripts/run-approach-cases.ts \
 *     --approach-registry /abs/teaching-skills-mvp/artifacts/canonical-authoring/teaching-approach \
 *     --truth-registry /abs/teaching-skills-mvp/artifacts/canonical-authoring/question-truth \
 *     --canonical-root /abs/teaching-skills-mvp/artifacts/canonical-authoring \
 *     --run-id BR-0004 --sut sut-a-claudecode-glm52-qwen \
 *     --out data/benchmark-runs/approach.jsonl
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { buildApproachRun } from "../src/services/benchmark/approachCases";
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
  const approachRegistry = (args["approach-registry"] ?? [])[0];
  const truthRegistry = (args["truth-registry"] ?? [])[0];
  const canonicalRoot = (args["canonical-root"] ?? [])[0];
  const out = (args["out"] ?? ["data/benchmark-runs/approach.jsonl"])[0];
  const runId = (args["run-id"] ?? ["BR-0004"])[0];
  const sutId = (args["sut"] ?? ["sut-a-claudecode-glm52-qwen"])[0];
  if (!approachRegistry || !truthRegistry || !canonicalRoot) {
    console.error("--approach-registry/--truth-registry/--canonical-root are required");
    return 2;
  }
  const result = buildApproachRun({
    runId,
    sutId,
    datasetId: "similarity-mvp-benchmark-v1",
    datasetVersion: "v1",
    inputs: {
      approachRegistryDir: path.resolve(approachRegistry),
      truthRegistryDir: path.resolve(truthRegistry),
      canonicalRoot: path.resolve(canonicalRoot),
    },
  });
  if (!result.ok) {
    console.error(`validation failed: ${result.errors.join("; ")}`);
    return 1;
  }
  const written = writeBenchmarkRunJsonl(result.record, out);
  const record = result.record as {
    summary?: Record<string, number>;
    case_results?: Array<{ case_id: string; status: string; failure_class?: string; metrics?: { detail?: string } }>;
  };
  console.log(
    `APPROACH RUN ${runId} (${sutId}): passed=${record.summary?.passed ?? 0} failed=${record.summary?.failed ?? 0} -> ${written}`,
  );
  for (const caseResult of record.case_results ?? []) {
    console.log(
      `  ${caseResult.case_id}: ${caseResult.status}` +
        `${caseResult.failure_class ? ` (${caseResult.failure_class})` : ""}` +
        `${caseResult.metrics?.detail ? ` — ${caseResult.metrics.detail}` : ""}`,
    );
  }
  return 0;
}

void main();
