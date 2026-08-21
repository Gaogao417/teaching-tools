import { defineConfig, devices } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Phase 5 remediation 真实 exit-run 配置：真 DeepSeek（无 fake model）+
 * 真 CosyVoice TTS + 真 Qwen ASR（DASHSCOPE_API_KEY/DEEPSEEK_API_KEY 来自
 * 环境）。只跑 12 条真实浏览器端到端（6 plan × S1/S12 journey 抽样）。
 */
const canonicalRoot =
  process.env.TUTOR_E2E_CANONICAL_ROOT ||
  "/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring";
const sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-real-e2e-"));
const backendPort = Number(process.env.TUTOR_E2E_BACKEND_PORT || 3102);
const frontendPort = Number(process.env.TUTOR_E2E_FRONTEND_PORT || 5175);

export default defineConfig({
  testDir: "./e2e/tutor/specs",
  outputDir: "e2e/tutor/results-real",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [["line"]],
  grep: /journey|S12：/,
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  webServer: [
    {
      command: "npx tsx src/index.ts",
      cwd: "../backend",
      url: `http://127.0.0.1:${backendPort}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(backendPort),
        HOST: "127.0.0.1",
        SQLITE_PATH: path.join(sqliteDir, "real-e2e.sqlite"),
        TUTOR_CANONICAL_ROOT: canonicalRoot,
        TUTOR_POLICY_PROVIDER: "deepseek-langgraph",
        TUTOR_TELEMETRY: "off",
      },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_BASE_URL: `http://127.0.0.1:${backendPort}` },
    },
  ],
  projects: [{ name: "tutor-real-chromium", use: { ...devices["Desktop Chrome"] } }],
});
