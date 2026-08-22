import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Phase 5 UI 集成波次 C tutor E2E 配置（fake structured model，不访问外部模型）。
 *
 * - canonical root：backend scripts/build-tutor-e2e-root.ts 构建的合成 v3 体验
 *   （6 个真实 Topic task id 的 Approved Binding；真实 golden root 复跑留给
 *   波次 D/E）；
 * - backend：tsx 起 src/index.ts（TUTOR_POLICY_PROVIDER=deepseek-langgraph +
 *   TUTOR_FAKE_STRUCTURED_MODEL=1 + 合成 root + 临时 sqlite）；
 * - frontend：vite dev server，API 指向本地 backend（/learn/:taskId 驱动）；
 * - TTS：用例内 route 拦截 /api/action-speech*（真实 CosyVoice 属 exit run）。
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const canonicalRoot = process.env.TUTOR_E2E_CANONICAL_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "tutor-e2e-root-"));
if (!process.env.TUTOR_E2E_CANONICAL_ROOT || !fs.existsSync(path.join(canonicalRoot, "tutor-plan"))) {
  execSync(`npx tsx scripts/build-tutor-e2e-root.ts ${JSON.stringify(canonicalRoot)}`, {
    cwd: path.join(repoRoot, "backend"),
    stdio: "inherit",
  });
}
const sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-e2e-sqlite-"));
const backendPort = Number(process.env.TUTOR_E2E_BACKEND_PORT || 3101);
const frontendPort = Number(process.env.TUTOR_E2E_FRONTEND_PORT || 5174);

export default defineConfig({
  testDir: "./e2e/tutor/specs",
  outputDir: "e2e/tutor/results",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["line"]],
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    actionTimeout: 20_000,
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
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: String(backendPort),
        HOST: "127.0.0.1",
        SQLITE_PATH: path.join(sqliteDir, "e2e.sqlite"),
        TUTOR_CANONICAL_ROOT: canonicalRoot,
        TUTOR_POLICY_PROVIDER: "deepseek-langgraph",
        TUTOR_FAKE_STRUCTURED_MODEL: "1",
        TUTOR_TELEMETRY: "off",
        FRONTEND_ORIGIN: `http://127.0.0.1:${frontendPort},http://localhost:${frontendPort}`,
      },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VITE_API_BASE_URL: `http://127.0.0.1:${backendPort}` },
    },
  ],
  projects: [{ name: "tutor-chromium", use: { ...devices["Desktop Chrome"] } }],
});
