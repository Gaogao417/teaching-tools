/**
 * P1-10：BenchmarkRun JSONL skeleton builder 测试。
 * 用 evaluationScopeSnapshot（= evaluation-scope.yaml 的 20-case 清单）构建
 * run 记录，经 canonical Zod schema 校验后写 JSONL 并回读。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import * as path from "node:path";

const {
  CASE_DISTRIBUTION,
  evaluationScopeSnapshot,
} = require("../evaluationScopeSnapshot") as typeof import("../evaluationScopeSnapshot");
const {
  SKELETON_RUNNER_VERSION,
  buildSkeletonRun,
  writeBenchmarkRunJsonl,
} = require("../benchmarkRunSkeleton") as typeof import("../benchmarkRunSkeleton");
const {
  benchmarkRunSchema,
  validatePayload,
} = require("../../../../../shared/canonical") as typeof import("../../../../../shared/canonical");

const jsonlPath = path.resolve(process.cwd(), ".benchmark-skeleton.test.jsonl");
if (existsSync(jsonlPath)) rmSync(jsonlPath, { force: true });

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main(): Promise<void> {
  await runTest("snapshot matches frozen 20-case distribution", () => {
    assert.equal(evaluationScopeSnapshot.datasetId, "similarity-mvp-benchmark-v1");
    assert.equal(evaluationScopeSnapshot.suts.length, 2);
    const byStage = new Map<string, number>();
    for (const entry of evaluationScopeSnapshot.cases) {
      byStage.set(entry.stage, (byStage.get(entry.stage) ?? 0) + 1);
    }
    assert.deepEqual(Object.fromEntries(byStage), CASE_DISTRIBUTION);
    assert.equal(evaluationScopeSnapshot.cases.length, 20);
    const ids = new Set(evaluationScopeSnapshot.cases.map((entry) => entry.case_id));
    assert.equal(ids.size, 20, "case_id 不得重复");
    for (const id of ids) {
      assert.match(id, /^C-(INT|TRU|APP|PLN|RT)-[0-9]{2}$/);
    }
  });

  await runTest("skeleton run for every registered SUT is schema-valid", () => {
    for (const sutId of evaluationScopeSnapshot.suts) {
      const result = buildSkeletonRun({
        scope: evaluationScopeSnapshot,
        runId: "BR-9001",
        sutId,
        startedAt: "2026-08-18T05:00:00Z",
        environment: "darwin 25.2.0 arm64",
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      const validation = validatePayload((result as { record: unknown }).record);
      assert.equal(validation.ok, true, validation.errors.join("; "));
      const record = (result as { record: Record<string, unknown> }).record;
      assert.equal(record.status, "running");
      assert.equal(record.runner_version, SKELETON_RUNNER_VERSION);
      assert.equal((record.sut as { sut_id: string }).sut_id, sutId);
      const caseResults = record.case_results as Array<{ status: string; case_id: string }>;
      assert.equal(caseResults.length, 20);
      assert.ok(caseResults.every((entry) => entry.status === "not_executed"));
      // running 状态不携带 summary（completed 才强制）
      assert.equal(record.summary, undefined);
    }
  });

  await runTest("unknown SUT is rejected", () => {
    const result = buildSkeletonRun({
      scope: evaluationScopeSnapshot,
      runId: "BR-9002",
      sutId: "sut-x-not-registered",
    });
    assert.equal(result.ok, false);
    assert.match((result as { errors: readonly string[] }).errors[0], /unknown sut_id/);
  });

  await runTest("jsonl write + reread round-trip stays canonical", () => {
    const result = buildSkeletonRun({
      scope: evaluationScopeSnapshot,
      runId: "BR-9003",
      sutId: "sut-a-claudecode-glm52-qwen",
      startedAt: "2026-08-18T05:00:00Z",
    });
    assert.equal(result.ok, true);
    const written = writeBenchmarkRunJsonl((result as { record: unknown }).record, jsonlPath);
    assert.ok(existsSync(written));
    const lines = readFileSync(jsonlPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const reloaded = JSON.parse(lines[0]);
    benchmarkRunSchema.parse(reloaded);
    assert.equal(reloaded.case_results.length, 20);
    // 第二次调用追加一行（JSONL 语义）
    writeBenchmarkRunJsonl((result as { record: unknown }).record, jsonlPath);
    assert.equal(readFileSync(jsonlPath, "utf8").trim().split("\n").length, 2);
  });

  rmSync(jsonlPath, { force: true });
}

void main().catch((error) => {
  console.error("FAIL benchmarkRunSkeleton", error);
  throw error;
});
