/**
 * Turn-based Coach benchmark: request-response vs the real streaming pipeline.
 *
 * Streams are measured end to end against the provider-neutral event stream:
 *   request_started → llm_first_text → first_spoken_segment → tts_first_audio → completed
 * The request-response path is blocking, so only its total time is reported.
 *
 * The first generated-answer audio is reported separately from any
 * acknowledgement audio. The current pipeline emits NO fixed acknowledgement,
 * so `ackFirstAudioMs` is always absent — the browser's first audio is a
 * generated segment.
 *
 * This makes REAL provider calls (Claude Code + CosyVoice). It needs the same
 * environment as the backend (DASHSCOPE_API_KEY, DEEPSEEK_API_KEY). It never
 * fabricates timings: a provider failure is reported as a failed run, not a zero.
 *
 *   tsx scripts/benchmark-coach-turn.ts                  # warm(5) + cold(3), both modes
 *   tsx scripts/benchmark-coach-turn.ts --warm 8 --cold 0 --mode stream
 *   tsx scripts/benchmark-coach-turn.ts --single stream  # one run, prints one JSON line (used for cold runs)
 *   tsx scripts/benchmark-coach-turn.ts --warm 30 --cold 20 --mode stream --jsonl out/runs.jsonl
 *                                                        # also append one raw JSON line per attempt
 *                                                        # (phase: priming|warm|cold) + a provider identity line
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import type { CoachTurnEvent } from "../../shared/coachMedia";
import type { CoachTurnRequest } from "../../shared/actionRuntime";
import { getLearningActionPlan } from "../src/services/learningService";
import { conductCoachTurn } from "../src/services/coach/coachTurnService";
import { coachTurnApplication } from "../src/services/coach/composition";
import { createTextCoachEngine } from "../src/services/coach/textCoachEngineFactory";

const taskId = "auxiliaryTwoRatios" as never;
const question = "我没听懂这一步，请换一种说法，并说明为什么这样做。";
const plan = getLearningActionPlan(taskId);
const action = plan.actions.find((candidate) => candidate.actionId === plan.currentActionId) || plan.actions[0];
const baseRequest: CoachTurnRequest = {
  context: { kind: "learn", taskId },
  exerciseId: plan.exerciseId,
  trace: {
    exerciseId: plan.exerciseId,
    currentActionId: action.actionId,
    actionState: "idle",
    selectedObjectIds: [],
    answerDraft: {},
    recentEvents: [],
    wrongAttempts: 0,
    revision: plan.revision,
  },
  studentMessage: question,
  conversation: [],
  synthesizeSpeech: true,
};

interface StreamResult {
  mode: "stream";
  ok: boolean;
  error?: string;
  firstTextMs?: number;
  firstSegmentMs?: number;
  firstAudioMs?: number; // generated-answer first audio (no acknowledgement exists)
  completeMs?: number;
  characters?: number;
}
interface RRResult { mode: "request-response"; ok: boolean; error?: string; totalMs?: number; }

function ms(start: number): number { return Math.round((performance.now() - start) * 10) / 10; }

function silenceTimeline(): () => void {
  const original = console.info;
  console.info = () => undefined;
  return () => { console.info = original; };
}

async function runStream(): Promise<StreamResult> {
  const restore = silenceTimeline();
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const result = await coachTurnApplication.start({ ...baseRequest }, controller.signal);
    if (!result.ok) return { mode: "stream", ok: false, error: result.error.code };
    let firstTextMs: number | undefined;
    let firstSegmentMs: number | undefined;
    let firstAudioMs: number | undefined;
    let completeMs: number | undefined;
    let characters = 0;
    while (true) {
      const { value, done } = await result.value.next();
      if (done) break;
      const event = value as CoachTurnEvent;
      if (event.type === "turn.transcript.delta" && event.role === "coach") {
        firstTextMs ??= ms(started);
        characters += event.text.length;
      } else if (event.type === "turn.segment.started") {
        firstSegmentMs ??= ms(started);
      } else if (event.type === "turn.audio.delta") {
        firstAudioMs ??= ms(started);
      } else if (event.type === "turn.completed") {
        completeMs = ms(started);
      } else if (event.type === "turn.error") {
        return { mode: "stream", ok: false, error: event.code };
      } else if (event.type === "turn.cancelled") {
        return { mode: "stream", ok: false, error: "cancelled" };
      }
    }
    if (completeMs === undefined) return { mode: "stream", ok: false, error: "no-completion" };
    return { mode: "stream", ok: true, firstTextMs, firstSegmentMs, firstAudioMs, completeMs, characters };
  } catch (error) {
    return { mode: "stream", ok: false, error: (error as Error).message.slice(0, 120) };
  } finally {
    clearTimeout(timer);
    restore();
  }
}

async function runRequestResponse(): Promise<RRResult> {
  const restore = silenceTimeline();
  const started = performance.now();
  try {
    await conductCoachTurn({ ...baseRequest });
    return { mode: "request-response", ok: true, totalMs: ms(started) };
  } catch (error) {
    return { mode: "request-response", ok: false, error: (error as Error).message.slice(0, 120) };
  } finally {
    restore();
  }
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)) * 10) / 10;
}

function stats(values: number[]): Record<string, number> {
  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0], p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted[sorted.length - 1] };
}

function summarizeStream(results: StreamResult[]): void {
  const ok = results.filter((r) => r.ok);
  const metric = (pick: (r: StreamResult) => number | undefined) => stats(ok.map(pick).filter((v): v is number => v !== undefined));
  console.log(JSON.stringify({
    label: "stream",
    runs: results.length,
    successes: ok.length,
    failures: results.length - ok.length,
    acknowledgementFirstAudioMs: "not applicable (no fixed acknowledgement; first audio is a generated segment)",
    llmFirstTextMs: metric((r) => r.firstTextMs),
    firstSpokenSegmentMs: metric((r) => r.firstSegmentMs),
    ttsFirstAudioMs: metric((r) => r.firstAudioMs),
    generatedAnswerFirstAudioMs: metric((r) => r.firstAudioMs),
    completeMs: metric((r) => r.completeMs),
  }, null, 2));
}

function summarizeRR(results: RRResult[]): void {
  const ok = results.filter((r) => r.ok);
  console.log(JSON.stringify({
    label: "request-response (blocking; no first-token/first-audio)",
    runs: results.length,
    successes: ok.length,
    failures: results.length - ok.length,
    totalMs: stats(ok.map((r) => r.totalMs!).filter((v): v is number => v !== undefined)),
  }, null, 2));
}

function parseArgs(): { warm: number; cold: number; mode: "stream" | "request-response" | "both"; single?: string; jsonlPath?: string } {
  const args = process.argv.slice(2);
  const warm = Number(args[args.indexOf("--warm") + 1]) || 5;
  const cold = Number(args[args.indexOf("--cold") + 1]);
  const coldIdx = args.indexOf("--cold");
  const coldCount = coldIdx >= 0 ? (Number(args[coldIdx + 1]) || 0) : 3;
  const modeIdx = args.indexOf("--mode");
  const mode = (modeIdx >= 0 ? args[modeIdx + 1] : "both") as "stream" | "request-response" | "both";
  const singleIdx = args.indexOf("--single");
  const single = singleIdx >= 0 ? args[singleIdx + 1] : undefined;
  const jsonlIdx = args.indexOf("--jsonl");
  const jsonlPath = jsonlIdx >= 0 ? args[jsonlIdx + 1] : undefined;
  void warm; void cold;
  return { warm, cold: coldCount, mode, single, jsonlPath };
}

/** Append one lossless per-run record (never a secret; provider identity only).
 * Benchmark-only addition so raw samples are traceable, matching the browser
 * benchmark's runs.jsonl contract. */
function logRun(jsonlPath: string | undefined, phase: "priming" | "warm" | "cold", result: StreamResult | RRResult): void {
  if (!jsonlPath) return;
  appendFileSync(jsonlPath, `${JSON.stringify({ ts: new Date().toISOString(), phase, ...result })}\n`, "utf8");
}

async function runSingle(mode: string): Promise<void> {
  const result = mode === "request-response" ? await runRequestResponse() : await runStream();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function runColdChild(mode: string): Promise<StreamResult | RRResult> {
  return new Promise((resolve) => {
    const tsxBin = path.resolve(process.cwd(), "node_modules", ".bin", "tsx");
    const child = spawn(tsxBin, ["scripts/benchmark-coach-turn.ts", "--single", mode], {
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env,
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.on("close", () => {
      const line = stdout.trim().split("\n").pop() || "";
      try { resolve(JSON.parse(line) as StreamResult | RRResult); }
      catch { resolve({ mode: mode as "stream", ok: false, error: "child produced no result" }); }
    });
  });
}

async function main(): Promise<void> {
  const { warm, cold, mode, single, jsonlPath } = parseArgs();
  if (single) { await runSingle(single); return; }

  // Provider proof for every round: log the engine's telemetry identity (no
  // secrets). With COACH_TEXT_PROVIDER=deepseek this must print deepseek-api.
  const identity = createTextCoachEngine().telemetryIdentity;
  const identityLine = JSON.stringify({ meta: "provider", provider: identity.provider, model: identity.model, ts: new Date().toISOString() });
  console.log(identityLine);
  if (jsonlPath) appendFileSync(jsonlPath, `${identityLine}\n`, "utf8");

  const doStream = mode === "stream" || mode === "both";
  const doRR = mode === "request-response" || mode === "both";

  console.log(`benchmark: ${warm} warm run(s) in-process, ${cold} cold run(s) in fresh child processes\n`);

  if (doStream) {
    console.log("=== stream (priming, then warm) ===");
    logRun(jsonlPath, "priming", await runStream()); // discard (warm caches)
    const warmResults: StreamResult[] = [];
    for (let i = 0; i < warm; i += 1) {
      const result = await runStream();
      warmResults.push(result);
      logRun(jsonlPath, "warm", result);
    }
    summarizeStream(warmResults);
    if (cold > 0) {
      console.log("\n=== stream (cold) ===");
      const coldResults: StreamResult[] = [];
      for (let i = 0; i < cold; i += 1) {
        const result = await runColdChild("stream") as StreamResult;
        coldResults.push(result);
        logRun(jsonlPath, "cold", result);
      }
      summarizeStream(coldResults);
    }
  }

  if (doRR) {
    console.log("\n=== request-response (priming, then warm) ===");
    logRun(jsonlPath, "priming", await runRequestResponse());
    const warmResults: RRResult[] = [];
    for (let i = 0; i < warm; i += 1) {
      const result = await runRequestResponse();
      warmResults.push(result);
      logRun(jsonlPath, "warm", result);
    }
    summarizeRR(warmResults);
    if (cold > 0) {
      console.log("\n=== request-response (cold) ===");
      const coldResults: RRResult[] = [];
      for (let i = 0; i < cold; i += 1) {
        const result = await runColdChild("request-response") as RRResult;
        coldResults.push(result);
        logRun(jsonlPath, "cold", result);
      }
      summarizeRR(coldResults);
    }
  }

  console.log("\nNote: real provider calls. If successes < runs, the provider/network was unavailable — do not treat failed runs as zero-latency successes.");
}

void main().catch((error) => { console.error(error); process.exit(1); });
