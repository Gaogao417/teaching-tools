import { defineConfig, devices } from "@playwright/test";

const outputDir = process.env.VOICE_BENCHMARK_OUTPUT_DIR || "benchmark-results/voice/latest";
const timeoutMs = Number(process.env.VOICE_BENCHMARK_TIMEOUT_MS || 120_000);

// Fake microphone: when a fixed WAV path is provided, Chromium feeds it as the
// capture device and auto-accepts the permission prompt. This is the ONLY allowed
// fixture; no audio/fetch/cache/provider mocking happens in the page observer.
const fakeMicWav = process.env.VOICE_BENCHMARK_FAKE_MIC_WAV || "";
const launchArgs = ["--autoplay-policy=no-user-gesture-required"];
if (fakeMicWav) {
  launchArgs.push(
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${fakeMicWav}`,
  );
}

/**
 * Real-browser voice benchmark configuration.
 *
 * No webServer is started here on purpose: the benchmark targets an already
 * running frontend/backend pair and is gated by VOICE_BENCHMARK_ENABLED=true,
 * so a normal CI test run can never make paid provider calls accidentally.
 */
export default defineConfig({
  testDir: "./benchmarks/voice/specs",
  outputDir: `${outputDir}/playwright-artifacts`,
  timeout: timeoutMs,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [
    ["line"],
    ["./benchmarks/voice/reporter.ts", { outputDir }],
  ],
  use: {
    baseURL: process.env.VOICE_BENCHMARK_UI_BASE_URL || "http://127.0.0.1:5173",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "voice-chromium",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        launchOptions: {
          args: launchArgs,
        },
      },
    },
  ],
});
