/**
 * P4-10 CLI：对 C-PLN 3 个 case 跑 deterministic 判定并写 Run JSONL。
 *
 * 用法（在 web/backend 下）：
 *   tsx scripts/run-plan-cases.ts \
 *     --canonical-root /abs/teaching-skills-mvp/artifacts/canonical-authoring \
 *     --run-id BR-0006 --sut sut-a-claudecode-glm52-qwen \
 *     --out data/benchmark-runs/plan.jsonl
 */
import * as path from "node:path";

import { buildPlanRun } from "../src/services/benchmark/planCases";
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
  const canonicalRoot = (args["canonical-root"] ?? [])[0];
  const out = (args["out"] ?? ["data/benchmark-runs/plan.jsonl"])[0];
  const runId = (args["run-id"] ?? ["BR-0006"])[0];
  const sutId = (args["sut"] ?? ["sut-a-claudecode-glm52-qwen"])[0];
  if (!canonicalRoot) {
    console.error("--canonical-root is required");
    return 2;
  }
  const result = buildPlanRun({
    runId,
    sutId,
    datasetId: "similarity-mvp-benchmark-v1",
    datasetVersion: "v1",
    inputs: { canonicalRoot: path.resolve(canonicalRoot) },
  });
  if (!result.ok) {
    console.error(`validation failed: ${result.errors.join("; ")}`);
    return 1;
  }
  const written = writeBenchmarkRunJsonl(result.record, out);
  const record = result.record as {
    run_id: string;
    summary: { passed: number; failed: number };
  };
  for (const caseResult of result.record.case_results as Array<{
    case_id: string;
    status: string;
    failure_class?: string;
    metrics?: { detail?: string };
  }>) {
    console.log(`${caseResult.status.toUpperCase()} ${caseResult.case_id}${caseResult.metrics?.detail ? `: ${caseResult.metrics.detail}` : ""}`);
  }
  console.log(
    `run ${record.run_id}: ${record.summary.passed} pass / ${record.summary.failed} fail → ${written}`,
  );
  return record.summary.failed > 0 ? 1 : 0;
}

process.exit(main());
