import fs from "node:fs";
import path from "node:path";

const input = path.resolve(process.argv[2] || process.env.VOICE_BENCHMARK_JSONL || "benchmark-results/voice/latest/runs.jsonl");
const output = path.resolve(process.argv[3] || process.env.VOICE_BENCHMARK_SUMMARY || path.join(path.dirname(input), "summary.json"));

const lines = fs.existsSync(input) ? fs.readFileSync(input, "utf8").split("\n").filter(Boolean) : [];
const records = lines.map((line, index) => {
  try { return JSON.parse(line); }
  catch (error) { throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`); }
});

const round = (value) => Math.round(value * 10) / 10;
const stats = (samples) => {
  if (!samples.length) return undefined;
  const values = [...samples].sort((a, b) => a - b);
  const percentile = (p) => {
    const rank = (p / 100) * (values.length - 1);
    const low = Math.floor(rank); const high = Math.ceil(rank);
    return round(values[low] + ((values[high] - values[low]) * (rank - low)));
  };
  return { count: values.length, min: values[0], mean: round(values.reduce((a, b) => a + b, 0) / values.length), p50: percentile(50), p95: percentile(95), max: values.at(-1) };
};
const groups = new Map();
for (const record of records) {
  const key = `${record.flow}|${record.scenario}|${record.cacheSource || "unknown"}`;
  groups.set(key, [...(groups.get(key) || []), record]);
}
const summary = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  source: input,
  runs: records.length,
  successes: records.filter((record) => record.status === "ok").length,
  cancelled: records.filter((record) => record.status === "cancelled").length,
  groups: [...groups.entries()].map(([key, values]) => {
    const metricNames = [...new Set(values.flatMap((record) => Object.keys(record.latencyMs || {})))];
    return {
      key,
      runs: values.length,
      successes: values.filter((record) => record.status === "ok").length,
      metrics: Object.fromEntries(metricNames.map((name) => [name, stats(values.map((record) => record.latencyMs?.[name]).filter(Number.isFinite))]).filter(([, value]) => value)),
    };
  }),
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
process.stdout.write(`${output}\n`);
