/**
 * P1-10：BenchmarkRun JSONL skeleton CLI。
 *
 * 用法（web/backend 下）：
 *   npm run benchmark:skeleton -- [--sut sut-a-claudecode-glm52-qwen]
 *                                [--run-id BR-0001]
 *                                [--scope path/to/evaluation-scope.yaml]
 *                                [--out path/to/runs.jsonl]
 *
 * 默认从 PRDS 仓路径找 evaluation-scope.yaml，缺失时退回 vendored 快照
 * （scripts/data/evaluation-scope.yaml，sha256 见 EXPECTED_SCOPE_SHA256）。
 * 输出一行合法的 BenchmarkRun JSONL（全部 case not_executed、run running）。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import yaml from "yaml";

import {
  buildSkeletonRun,
  writeBenchmarkRunJsonl,
} from "../src/services/benchmark/benchmarkRunSkeleton";
import type { EvaluationScopeSummary } from "../src/services/benchmark/evaluationScopeSnapshot";

const PRDS_SCOPE_FALLBACKS = [
  path.resolve(process.cwd(), "../../../ai_teaching_prds_v2_00-07/migration/manifests/evaluation-scope.yaml"),
];
const VENDORED_SCOPE = path.resolve(process.cwd(), "scripts/data/evaluation-scope.yaml");
export const EXPECTED_SCOPE_SHA256 =
  "sha256:2e19555d7bea63cc47b690b5a0e34f59df608eea81eb010f1bf666afc240949e";

interface ScopeYaml {
  dataset_id: string;
  suts:
    | Record<string, { sut_id?: string }>
    | Array<{ sut_id?: string }>;
  cases: Array<{ case_id: string; stage: string }>;
}

function sha256File(file: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
}

function resolveScopeFile(explicit?: string): string {
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`--scope file not found: ${explicit}`);
    }
    return explicit;
  }
  for (const candidate of PRDS_SCOPE_FALLBACKS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  if (!existsSync(VENDORED_SCOPE)) {
    throw new Error(`evaluation-scope.yaml not found (tried PRDS fallbacks and ${VENDORED_SCOPE})`);
  }
  const digest = sha256File(VENDORED_SCOPE);
  if (digest !== EXPECTED_SCOPE_SHA256) {
    throw new Error(
      `vendored evaluation-scope.yaml sha256 drift: ${digest} != ${EXPECTED_SCOPE_SHA256}（与 PRDS manifest 不同步）`,
    );
  }
  return VENDORED_SCOPE;
}

function parseScope(file: string): EvaluationScopeSummary {
  const parsed = yaml.parse(readFileSync(file, "utf8")) as ScopeYaml;
  // evaluation-scope.yaml 的 suts 是映射（sut_a: / sut_b:），各含 sut_id
  const suts = Array.isArray(parsed.suts)
    ? (parsed.suts.map((sut) => sut.sut_id).filter(Boolean) as string[])
    : (Object.values(parsed.suts ?? {})
        .map((sut) => sut?.sut_id)
        .filter(Boolean) as string[]);
  const cases = (parsed.cases ?? []).map((entry) => ({
    case_id: entry.case_id,
    stage: entry.stage as EvaluationScopeSummary["cases"][number]["stage"],
  }));
  if (suts.length === 0 || cases.length === 0) {
    throw new Error(`evaluation-scope.yaml malformed (suts=${suts.length}, cases=${cases.length})`);
  }
  return { datasetId: parsed.dataset_id, datasetVersion: "v1", suts, cases };
}

function main(): void {
  const args = process.argv.slice(2);
  const readArg = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const scopeFile = resolveScopeFile(readArg("scope"));
  const scope = parseScope(scopeFile);
  const sutId = readArg("sut") ?? scope.suts[0];
  const runId = readArg("run-id") ?? "BR-0001";
  const outFile = readArg("out") ?? path.resolve(process.cwd(), "data/benchmark-runs/skeleton.jsonl");

  const result = buildSkeletonRun({ scope, runId, sutId });
  if (!result.ok) {
    console.error(`FAIL build skeleton run: ${result.errors.join("; ")}`);
    process.exit(1);
  }
  const written = writeBenchmarkRunJsonl(result.record, outFile);
  console.log(
    `PASS skeleton run ${runId} (${sutId}, ${scope.cases.length} cases not_executed) -> ${written}`,
  );
}

main();
