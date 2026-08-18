/**
 * BenchmarkRun JSONL skeleton builder（P1-10）。
 *
 * Phase 1 只要求：从 evaluation-scope 的 case 清单产出一条 schema 合法的
 * Run 记录（全部 case 标 not_executed、run 状态 running），写入 JSONL。
 * 真正的 SUT 执行、evaluator 接入与 summary 汇总属 Phase 7（P7-02…）。
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";

import {
  benchmarkRunSchema,
  validatePayload,
} from "../../../../shared/canonical";

import type { EvaluationScopeSummary } from "./evaluationScopeSnapshot";

export const SKELETON_RUNNER_VERSION = "benchmark-runner-skeleton-0.1.0";

export interface SkeletonRunInput {
  scope: EvaluationScopeSummary;
  runId: string;
  sutId: string;
  startedAt?: string;
  environment?: string;
}

export type SkeletonRunResult =
  | { ok: true; record: Record<string, unknown> }
  | { ok: false; errors: readonly string[] };

/** SUT config artifact 尚未注册（Phase 7 registry）；骨架阶段对 sut 声明做确定哈希。 */
export function skeletonSutConfigHash(sutId: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ sut_id: sutId, provenance: "skeleton-unregistered" }))
    .digest("hex");
}

export function buildSkeletonRun(input: SkeletonRunInput): SkeletonRunResult {
  const { scope, runId, sutId } = input;
  if (!scope.suts.includes(sutId)) {
    return { ok: false, errors: [`unknown sut_id: ${sutId} (scope has ${scope.suts.join(", ")})`] };
  }
  const record = {
    schema: "ai_teaching_benchmark_run/v1",
    run_id: runId,
    dataset_id: scope.datasetId,
    dataset_version: scope.datasetVersion,
    sut: {
      sut_id: sutId,
      config_hash: `sha256:${skeletonSutConfigHash(sutId)}`,
      config_artifact_uri: `artifact://sut-config/${sutId.replace(/^sut-/, "")}@v1`,
    },
    status: "running",
    case_results: scope.cases.map((entry) => ({
      case_id: entry.case_id,
      stage: entry.stage,
      status: "not_executed",
    })),
    runner_version: SKELETON_RUNNER_VERSION,
    environment: input.environment ?? `node ${process.version}`,
    started_at: input.startedAt ?? new Date().toISOString(),
  };
  const validation = validatePayload(record);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, record };
}

export function assertValidBenchmarkRun(record: unknown): void {
  const parsed = benchmarkRunSchema.parse(record);
  if (!parsed) {
    throw new Error("benchmark run record failed schema validation");
  }
}

/** 追加一行 JSON（JSONL：一行 = 一次 run）；返回写入的绝对路径。 */
export function writeBenchmarkRunJsonl(record: unknown, outFile: string): string {
  assertValidBenchmarkRun(record);
  const absolute = path.resolve(outFile);
  mkdirSync(path.dirname(absolute), { recursive: true });
  appendFileSync(absolute, `${JSON.stringify(record)}\n`, "utf8");
  return absolute;
}
