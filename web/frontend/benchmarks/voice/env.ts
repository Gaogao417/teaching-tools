export interface VoiceBenchmarkEnvironment {
  enabled: boolean;
  uiBaseUrl: string;
  apiBaseUrl: string;
  taskId: string;
  iterations: number;
  timeoutMs: number;
  narrationScenario: string;
  turnScenario: string;
  recordedScenario: string;
  liveScenario: string;
  arbitrationScenario: string;
  coachQuestion: string;
  /** Hint only: the request-response path is only exercisable if the served
   *  action plan declares runtimeCapabilities.coachTurnTransport="request-response". */
  coachTransport: "stream" | "request-response";
  /** Absolute path to a fixed WAV fed via Chromium fake-audio-capture. Empty
   *  string disables fake-mic (recorded-turn/live specs skip themselves). */
  fakeMicWav: string;
  /** Benchmark-only ACTION_SPEECH_CACHE_DIR exposed by the backend operator, so
   *  concurrency specs can count provider calls by counting .mp3 files. Empty
   *  string disables the file-count assertion (marked "Not executed"). */
  cacheDir: string;
  concurrencyClients: number;
  runId: string;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function voiceBenchmarkEnvironment(): VoiceBenchmarkEnvironment {
  return {
    enabled: process.env.VOICE_BENCHMARK_ENABLED === "true",
    uiBaseUrl: (process.env.VOICE_BENCHMARK_UI_BASE_URL || "http://127.0.0.1:5173").replace(/\/$/, ""),
    apiBaseUrl: (process.env.VOICE_BENCHMARK_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, ""),
    taskId: process.env.VOICE_BENCHMARK_TASK_ID || "auxiliaryTwoRatios",
    iterations: positiveInteger(process.env.VOICE_BENCHMARK_ITERATIONS, 3),
    timeoutMs: positiveInteger(process.env.VOICE_BENCHMARK_TIMEOUT_MS, 120_000),
    narrationScenario: process.env.VOICE_BENCHMARK_NARRATION_SCENARIO || "page-load",
    turnScenario: process.env.VOICE_BENCHMARK_TURN_SCENARIO || "text-stream",
    recordedScenario: process.env.VOICE_BENCHMARK_RECORDED_SCENARIO || "recorded-short",
    liveScenario: process.env.VOICE_BENCHMARK_LIVE_SCENARIO || "live-open",
    arbitrationScenario: process.env.VOICE_BENCHMARK_ARBITRATION_SCENARIO || "arbitration-basic",
    coachQuestion: process.env.VOICE_BENCHMARK_COACH_QUESTION || "我没听懂这一步，请换一种说法，并说明为什么这样做。",
    coachTransport: (process.env.VOICE_BENCHMARK_COACH_TRANSPORT === "request-response" ? "request-response" : "stream"),
    fakeMicWav: process.env.VOICE_BENCHMARK_FAKE_MIC_WAV || "",
    cacheDir: process.env.VOICE_BENCHMARK_CACHE_DIR || "",
    concurrencyClients: positiveInteger(process.env.VOICE_BENCHMARK_CONCURRENCY_CLIENTS, 5),
    runId: process.env.VOICE_BENCHMARK_RUN_ID || `voice-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  };
}
