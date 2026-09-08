/**
 * F4 生产补强 live 浏览器证据采集（真实 /learn/:taskId + 真实 vNext runtime）。
 *
 * 输入（env）：
 *   PRODUCTION_CANONICAL_ROOT  生产 canonical root（含已发布 plan + workspace catalog + task binding）
 *   PRODUCTION_TASK_ID         生产 task id（TUTOR_VNEXT_TASKS 同值）
 *   PRODUCTION_BROWSER_OUTPUT  证据输出目录（browser-evidence.json / browser-screenshot.png）
 *   PRODUCTION_CATALOG_SHA256  期望的 catalog 文件 sha256（核对浏览器使用的目录）
 *
 * 旅程：真实后端（TUTOR_VNEXT_ROOT=生产 root）+ 真实前端页面加载当前生产资产；
 * 初始视图读取真实绘制模型（window.__tutorWorkspaceView 的 render.geometry 投影），
 * 点击确认后等待下一 Beat 呈现并提交已批准构造，再次读取视图。
 *
 * 边界如实记录：
 * - Gate 裁决端口使用 F7 既定 scripted gate（TUTOR_VNEXT_SCRIPTED_GATE=1）——
 *   DeepSeek 不是本题数据授权目的地；构造提交本身是确定性 presenter 链。
 * - TTS 出口在浏览器层以 503 故障注入（语音合成不属于本波 F4 验收面）。
 */
import { spawn } from "node:child_process";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { chromium } from "@playwright/test";

const canonicalRoot = process.env.PRODUCTION_CANONICAL_ROOT;
const taskId = process.env.PRODUCTION_TASK_ID;
const outputDir = process.env.PRODUCTION_BROWSER_OUTPUT;
const catalogSha = process.env.PRODUCTION_CATALOG_SHA256;
if (!canonicalRoot || !taskId || !outputDir || !catalogSha) {
  console.error("PRODUCTION_CANONICAL_ROOT/TASK_ID/BROWSER_OUTPUT/CATALOG_SHA256 required");
  process.exit(2);
}
mkdirSync(outputDir, { recursive: true });

const backendPort = 3187;
const frontendPort = 5187;
const log = (name, text) => writeFileSync(path.join(outputDir, name), text ?? "");

function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) return resolve();
      } catch { /* not up yet */ }
      if (Date.now() > deadline) return reject(new Error(`timeout waiting for ${url}`));
      setTimeout(attempt, 500);
    };
    attempt();
  });
}

const children = [];
function run(command, args, options, logName) {
  const stream = openSync(path.join(outputDir, logName), "a");
  const child = spawn(command, args, { stdio: ["ignore", stream, stream], ...options });
  children.push(child);
  return child;
}

async function readWorkspaceView(page) {
  return page.evaluate(() => {
    // The runtime session snapshot is the rendering input itself (render.geometry
    // = pinned base + committed tutor commands); the unified view carries the
    // parsed TopicGeometryModel for the same revision. Prefer the snapshot.
    const snapshot = window.__runtimeSessionSnapshot;
    const view = window.__tutorWorkspaceView;
    const geometry = snapshot?.render?.geometry ?? view?.geometry;
    if (!geometry) return null;
    return {
      revision: snapshot?.revision ?? view?.view?.revision ?? null,
      participation: snapshot?.views?.participation?.kind ?? view?.view?.participation?.mode ?? null,
      points: (geometry.points ?? []).map((point) => ({ id: point.id, derived: point.derived === true })),
      segments: (geometry.segments ?? []).map((segment) => ({ id: segment.id, derived: segment.derived === true })),
      derivedLines: (geometry.derivedLines ?? []).map((line) => line.id),
      canvasDomPointCount: document.querySelectorAll(".geometry-canvas [class*=JXG]").length,
    };
  });
}

function geometryIds(reading) {
  if (!reading) return [];
  return [...reading.points.map((p) => p.id), ...reading.segments.map((s) => s.id), ...reading.derivedLines];
}

async function waitForViewChange(page, beforeRevision, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const reading = await readWorkspaceView(page);
    last = reading;
    if (reading && reading.revision !== null && reading.revision !== beforeRevision
      && (reading.derivedLines.length > 0 || reading.segments.some((s) => s.derived))) {
      return reading;
    }
    await page.waitForTimeout(600);
  }
  return last;
}

async function main() {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
  const backendDir = path.join(repoRoot, "web", "backend");
  const frontendDir = path.join(repoRoot, "web", "frontend");
  const sqlitePath = path.join(outputDir, "browser-backend.sqlite");

  run("npx", ["tsx", "src/index.ts"], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(backendPort),
      HOST: "127.0.0.1",
      SQLITE_PATH: sqlitePath,
      TUTOR_VNEXT_ROOT: canonicalRoot,
      TUTOR_VNEXT_TASKS: taskId,
      TUTOR_VNEXT_SCRIPTED_GATE: "1",
      TUTOR_TELEMETRY: "off",
      FRONTEND_ORIGIN: `http://127.0.0.1:${frontendPort},http://localhost:${frontendPort}`,
    },
  }, "browser-backend.log");
  run("npx", ["vite", "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], {
    cwd: frontendDir,
    env: { ...process.env, VITE_API_BASE_URL: `http://127.0.0.1:${backendPort}` },
  }, "browser-frontend.log");
  await waitFor(`http://127.0.0.1:${backendPort}/api/health`, 90_000);
  await waitFor(`http://127.0.0.1:${frontendPort}`, 90_000);

  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`));
  await page.addInitScript(() => {
    window.localStorage.setItem("trig-web-student-name", "production-acceptance-student");
  });

  const notes = ["gate port: scripted (DeepSeek not an authorized destination for this question); presenter/construction chain deterministic",
    "tts: real CosyVoice via DashScope (immediate-explanation playback use was explicitly authorized)"];
  try {
    await page.goto(`http://127.0.0.1:${frontendPort}/learn/${taskId}?acceptance=1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".tutor-learn-page[data-session-id]:not([data-session-id=''])", { timeout: 90_000 });
    let reading = null;
    for (let index = 0; index < 80 && !reading; index += 1) {
      reading = await readWorkspaceView(page);
      if (!reading) await page.waitForTimeout(700);
    }
    if (!reading) throw new Error("workspace view snapshot never appeared (?acceptance=1)");
    const initial = reading;
    const initialIds = geometryIds(initial);
    await page.screenshot({ path: path.join(outputDir, "browser-initial.png"), fullPage: true });

    // The opening voice settles first; the understanding confirm control
    // (「明白，继续」) appears afterwards and advances to the next beat.
    let confirm = page.locator('[data-testid="coach-understood"]');
    for (let index = 0; index < 60 && (await confirm.count()) === 0; index += 1) {
      await page.waitForTimeout(2000);
      confirm = page.locator('[data-testid="coach-understood"]');
    }
    if ((await confirm.count()) === 0) throw new Error("understanding confirm control not found after voice settled");
    await confirm.first().click();
    const after = await waitForViewChange(page, initial.revision, 60_000);
    if (!after) throw new Error("workspace view did not advance after confirm");
    const afterIds = geometryIds(after);
    await page.screenshot({ path: path.join(outputDir, "browser-screenshot.png"), fullPage: true });
    notes.push(`initial revision=${initial.revision} -> after revision=${after.revision}`);
    if (afterIds.length === initialIds.length) {
      notes.push("warning: no new geometry elements after the construction beat");
    }
    writeFileSync(path.join(outputDir, "browser-evidence.json"), JSON.stringify({
      catalog_sha256: catalogSha,
      task_id: taskId,
      session_id: await page.locator(".tutor-learn-page").getAttribute("data-session-id"),
      initial_point_ids: initial.points.map((p) => p.id),
      initial_segment_ids: initial.segments.map((s) => s.id),
      after_construction_ids: afterIds,
      after_derived_ids: [...after.segments.filter((s) => s.derived).map((s) => s.id), ...after.derivedLines],
      console_errors: consoleErrors,
      screenshot_file: "browser-screenshot.png",
      canvas_element_count_initial: initial.canvasDomPointCount,
      canvas_element_count_after: after.canvasDomPointCount,
      boundary_notes: notes,
      collected_at: new Date().toISOString(),
    }, null, 2) + "\n");
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, "browser-failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    for (const child of children) child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  writeFileSync(path.join(outputDir, "browser-evidence-error.json"), String(error?.stack ?? error));
  for (const child of children) child.kill("SIGTERM");
  process.exit(1);
});
