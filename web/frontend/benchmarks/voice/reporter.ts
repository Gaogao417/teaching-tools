import fs from "node:fs";
import path from "node:path";
import type { FullConfig, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import type { VoiceBenchmarkRecord } from "./types";

interface ReporterOptions { outputDir?: string }

interface MetricStats { count: number; min: number; mean: number; p50: number; p95: number; max: number }

function round(value: number): number { return Math.round(value * 10) / 10; }

function percentile(sorted: number[], percentileValue: number): number {
  const rank = (percentileValue / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return round(sorted[low] + ((sorted[high] - sorted[low]) * (rank - low)));
}

function stats(values: number[]): MetricStats | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
  };
}

function summarize(records: VoiceBenchmarkRecord[]): Record<string, unknown> {
  const groups = new Map<string, VoiceBenchmarkRecord[]>();
  for (const record of records) {
    const key = `${record.flow}|${record.scenario}|${record.cacheSource || "unknown"}`;
    groups.set(key, [...(groups.get(key) || []), record]);
  }
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    runs: records.length,
    successes: records.filter((record) => record.status === "ok").length,
    failures: records.filter((record) => record.status === "failed").length,
    cancelled: records.filter((record) => record.status === "cancelled").length,
    autoplayBlocked: records.filter((record) => record.status === "autoplay-blocked").length,
    groups: [...groups.entries()].map(([key, values]) => {
      const metricNames = [...new Set(values.flatMap((record) => Object.keys(record.latencyMs || {})))];
      const metrics = metricNames.reduce<Record<string, MetricStats>>((acc, metric) => {
        const samples = values
          .map((record) => record.latencyMs[metric as keyof VoiceBenchmarkRecord["latencyMs"]])
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        const metricStats = stats(samples);
        if (metricStats) acc[metric] = metricStats;
        return acc;
      }, {});
      return {
        key,
        flow: values[0].flow,
        scenario: values[0].scenario,
        cacheSource: values[0].cacheSource || "unknown",
        runs: values.length,
        successes: values.filter((record) => record.status === "ok").length,
        cacheStagesMs: {
          memoryLookup: stats(values.map((record) => record.server?.memoryCacheLookupMs).filter((value): value is number => typeof value === "number")),
          persistentLookup: stats(values.map((record) => record.server?.persistentCacheLookupMs).filter((value): value is number => typeof value === "number")),
          singleFlightWait: stats(values.map((record) => record.server?.singleFlightWaitMs).filter((value): value is number => typeof value === "number")),
          providerSynthesis: stats(values.map((record) => record.server?.providerSynthesisMs).filter((value): value is number => typeof value === "number")),
        },
        metrics,
      };
    }),
  };
}

export default class VoiceBenchmarkReporter implements Reporter {
  private readonly outputDir: string;
  private readonly records: VoiceBenchmarkRecord[] = [];
  private jsonlPath = "";

  constructor(options: ReporterOptions = {}) {
    this.outputDir = path.resolve(process.cwd(), options.outputDir || process.env.VOICE_BENCHMARK_OUTPUT_DIR || "benchmark-results/voice/latest");
  }

  onBegin(_config: FullConfig): void {
    fs.mkdirSync(this.outputDir, { recursive: true });
    this.jsonlPath = path.join(this.outputDir, "runs.jsonl");
    fs.writeFileSync(this.jsonlPath, "", "utf8");
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments.filter((item) => item.name === "voice-benchmark-result")) {
      try {
        const body = attachment.body ?? (attachment.path ? fs.readFileSync(attachment.path) : undefined);
        if (!body) continue;
        const record = JSON.parse(body.toString("utf8")) as VoiceBenchmarkRecord;
        this.records.push(record);
        fs.appendFileSync(this.jsonlPath, `${JSON.stringify(record)}\n`, "utf8");
      } catch (error) {
        process.stderr.write(`voice benchmark reporter ignored an invalid attachment: ${(error as Error).message}\n`);
      }
    }
  }

  onEnd(): void {
    fs.writeFileSync(path.join(this.outputDir, "summary.json"), `${JSON.stringify(summarize(this.records), null, 2)}\n`, "utf8");
  }
}
