import { defineConfig, devices } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * F7 vNext e2e（canonical TutorLearnExperience 链路；真实 golden root + 脚本化
 * Gate 端口——R3 固定响应口径）。与旧链 tutor 配置互不影响。
 */
const repoRoot = path.resolve(path.dirname(import.meta.url.replace("file://", "")), "..");
const canonicalRoot = process.env.TUTOR_E2E_CANONICAL_ROOT
  || "/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring";
if (!fs.existsSync(path.join(canonicalRoot, "tutor-plan", "TP-SMV-009"))) {
  throw new Error(`vNext e2e: canonical root unreachable: ${canonicalRoot}（设置 TUTOR_E2E_CANONICAL_ROOT）`);
}

const sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), "vnext-e2e-sqlite-"));
const backendPort = Number(process.env.VNEXT_E2E_BACKEND_PORT || 3113);
const frontendPort = Number(process.env.VNEXT_E2E_FRONTEND_PORT || 5178);

export default defineConfig({
  testDir: "./e2e/vnext/specs",
  outputDir: "e2e/vnext/results",
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
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(backendPort),
        HOST: "127.0.0.1",
        SQLITE_PATH: path.join(sqliteDir, "e2e.sqlite"),
        TUTOR_VNEXT_ROOT: canonicalRoot,
        TUTOR_VNEXT_SCRIPTED_GATE: "1",
        TUTOR_TELEMETRY: "off",
        FRONTEND_ORIGIN: `http://127.0.0.1:${frontendPort},http://localhost:${frontendPort}`,
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
  projects: [{ name: "vnext-chromium", use: { ...devices["Desktop Chrome"] } }],
});
