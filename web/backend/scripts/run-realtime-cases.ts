/**
 * Phase 5 评测 CLI：C-RT 5 个 realtime case 跑 deterministic 判定并写 Run JSONL。
 *
 * 用法（在 web/backend 下）：
 *   tsx scripts/run-realtime-cases.ts \
 *     --canonical-root /abs/teaching-skills-mvp/artifacts/canonical-authoring \
 *     --run-id BR-0007 --sut sut-a-claudecode-glm52-qwen \
 *     --out data/benchmark-runs/realtime.jsonl \
 *     [--sqlite data/benchmark-realtime.sqlite]
 */
import { rmSync } from "node:fs";
import * as path from "node:path";

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

const args = parseArgs(process.argv.slice(2));
const canonicalRootArg = (args["canonical-root"] ?? [])[0];
if (!canonicalRootArg) {
  console.error("--canonical-root is required");
  process.exit(2);
}
const canonicalRoot = path.resolve(canonicalRootArg);
const out = (args["out"] ?? ["data/benchmark-runs/realtime.jsonl"])[0];
const runId = (args["run-id"] ?? ["BR-0007"])[0];
const sutId = (args["sut"] ?? ["sut-a-claudecode-glm52-qwen"])[0];
const sqlitePath = path.resolve((args["sqlite"] ?? ["data/benchmark-realtime.sqlite"])[0]);
for (const suffix of ["", "-wal", "-shm"]) {
  try {
    rmSync(`${sqlitePath}${suffix}`, { force: true });
  } catch {
    /* 不存在即跳过 */
  }
}
process.env.SQLITE_PATH = sqlitePath;

const { buildRealtimeRun } = require("../src/services/benchmark/realtimeCases") as typeof import("../src/services/benchmark/realtimeCases");
const { createTutorSessionCoordinator } = require("../src/services/tutorSession/TutorSession") as typeof import("../src/services/tutorSession/TutorSession");
const { writeBenchmarkRunJsonl } = require("../src/services/benchmark/benchmarkRunSkeleton") as typeof import("../src/services/benchmark/benchmarkRunSkeleton");
const { db } = require("../src/db/database") as typeof import("../src/db/database");

async function main(): Promise<number> {
  const coordinator = createTutorSessionCoordinator({ canonicalRoot });
  let sessionCounter = 8000;
  const result = await buildRealtimeRun({
    runId,
    sutId,
    datasetId: "similarity-mvp-benchmark-v1",
    datasetVersion: "v1",
    inputs: {
      canonicalRoot,
      coordinator,
      nextSessionId: () => `TS-${(sessionCounter += 1)}`,
    },
  });
  if (!result.ok) {
    console.error(`validation failed: ${result.errors.join("; ")}`);
    db.close();
    return 1;
  }
  const written = writeBenchmarkRunJsonl(result.record, out);
  const record = result.record as { summary: { passed: number; failed: number } };
  for (const caseResult of result.record.case_results as Array<{
    case_id: string;
    status: string;
    failure_class?: string;
    metrics?: { detail?: string };
  }>) {
    console.log(
      `${caseResult.status.toUpperCase()} ${caseResult.case_id}${caseResult.metrics?.detail ? `: ${caseResult.metrics.detail}` : ""}`,
    );
    if (caseResult.failure_class) console.error(`  ↳ ${caseResult.failure_class}`);
  }
  console.log(`run ${runId}: ${record.summary.passed} pass / ${record.summary.failed} fail → ${written}`);
  db.close();
  return record.summary.failed > 0 ? 1 : 0;
}

void main().then((code) => process.exit(code));
