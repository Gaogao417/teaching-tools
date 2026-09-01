import { defineConfig, devices } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * F7 vNext golden 旅程 E2E 配置（真实 golden canonical root + 脚本化 Gate 端口）。
 *
 * - backend：tsx 起 src/index.ts（TUTOR_VNEXT_ROOT=teaching-skills-mvp 真源 +
 *   TUTOR_VNEXT_SCRIPTED_GATE=1——R3 口径的确定性固定响应；模型真实性证据由
 *   R3 真模型实证覆盖，不在此重复）+ 临时 sqlite；
 * - frontend：vite dev server，/learn/goldenMinhangFold2020 驱动；
 * - 与 playwright.tutor.config.ts（旧链合成 root）互不影响——本配置不建
 *   合成 root，锚定唯一真实 golden 链（TP-SMV-009@v4 anchored import）。
 */
const repoRoot = path.resolve(path.dirname(import.meta.url.replace("file://", "")), "..");
const canonicalRoot = process.env.TUTOR_E2E_CANONICAL_ROOT
  || "/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring";
if (!fs.existsSync(path.join(canonicalRoot, "tutor-plan", "TP-SMV-009"))) {
  throw new Error(`vNext e2e: canonical root unreachable: ${canonicalRoot}（设置 TUTOR_E2E_CANONICAL_ROOT）`);
}

const sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), "vnext-e2e-sqlite-"));
const backendPort = Number(process.env.VNEXT_E2E_BACKEND_PORT || 3111);
const frontendPort = Number(process.env.VNEXT_E2E_FRONTEND_PORT || 5176);

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
