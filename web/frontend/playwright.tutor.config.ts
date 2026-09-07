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
// web/frontend → web（backend 实际位于 web/backend；此前 "../../.." 误指
// develop/、backend cwd 不存在 → 干净环境 execSync ENOENT——被残留 server
// 复用掩盖）。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalRoot = process.env.TUTOR_E2E_CANONICAL_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "tutor-e2e-root-"));
if (!process.env.TUTOR_E2E_CANONICAL_ROOT || !fs.existsSync(path.join(canonicalRoot, "tutor-plan"))) {
  execSync(`npx tsx scripts/build-tutor-e2e-root.ts ${JSON.stringify(canonicalRoot)}`, {
    cwd: path.join(repoRoot, "backend"),
    stdio: "inherit",
  });
}
// 同进程导出合成 root 路径（tutorHarness 等 spec 文件读取；此前仅在 CI 外部
// 预设 env 时可运行——自包含修复）。
process.env.TUTOR_E2E_CANONICAL_ROOT = canonicalRoot;
const sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-e2e-sqlite-"));
const backendPort = Number(process.env.TUTOR_E2E_BACKEND_PORT || 3101);
const frontendPort = Number(process.env.TUTOR_E2E_FRONTEND_PORT || 5174);
/**
 * 波次 E：TUTOR_E2E_REAL=1 时走真实链（真 DeepSeek + 真 CosyVoice TTS +
 * /asr 真key面）——不注入 fake structured model，其余 env（含
 * DEEPSEEK_API_KEY/DASHSCOPE_API_KEY 等真实 key）从启动 shell 透传；
 * 用例内 TTS 拦截按 TUTOR_E2E_REAL 放行（tutorHarness 既有开关）。
 */
const realChain = process.env.TUTOR_E2E_REAL === "1";
/**
 * F7 P2：canonical 链（/api/vnext → TutorLearnExperience runtimeClient）挂载同一
 * backend——TUTOR_VNEXT_ROOT 指向 skills-mvp canonical-authoring（只读消费），
 * 脚本化 Gate 端口（与 playwright.vnext.config.ts 同口径）。legacy 链用例零影响
 * （vnext 路由独立挂载，availability 按 task 判定）。
 */
const vnextRoot = process.env.TUTOR_E2E_VNEXT_ROOT
  || "/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring";
if (!fs.existsSync(path.join(vnextRoot, "tutor-plan", "TP-SMV-009"))) {
  throw new Error(`F7 P2 canonical e2e: vnext root unreachable: ${vnextRoot}（设置 TUTOR_E2E_VNEXT_ROOT）`);
}

export default defineConfig({
  testDir: "./e2e/tutor/specs",
  outputDir: "e2e/tutor/results",
  timeout: realChain ? 180_000 : 90_000,
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
        ...(realChain ? {} : { TUTOR_FAKE_STRUCTURED_MODEL: "1" }),
        // F7 P2：canonical 链（/api/vnext）挂载（脚本化 Gate；golden 任务集）。
        TUTOR_VNEXT_ROOT: vnextRoot,
        TUTOR_VNEXT_SCRIPTED_GATE: "1",
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
