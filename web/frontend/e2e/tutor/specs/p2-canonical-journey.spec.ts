/**
 * F7 P2 canonical 浏览器旅程（Step 8 + S1 接线；PLAN §4 Playwright G7 清单的
 * P2 增量——真实浏览器、真实 backend、真实 permission 路径）。
 *
 * 覆盖（P2 义务）：
 * - canonical 链启用（/api/vnext availability → runtimeClient → TutorLearn
 *   Experience 唯一页面）+ voice 真实播放完成后才推进（TTS 用例内拦截回真实
 *   MP3 字节——播放/ended 是浏览器真行为，不是 mock View）；
 * - barge-in 因果（①中断 ②interrupted outcome ③control.barge_in——按请求
 *   顺序断言 outcome 请求先于 control 请求；语义级 invocationCallOrder 由
 *   hook 单测锁定）；
 * - refresh/reconnect 恢复同一会话（URL session + 服务端 verified rebuild）；
 * - 390px 窄屏无横向裁切（关键面可见）；
 * - 录音权限拒绝（真实 getUserMedia 权限路径——Playwright 默认拒绝权限；
 *   不用 fake media stream 冒充真实 mic 门禁；等待失败零录音零 asr——R5）；
 * - generation 状态显示与只读轮询（S1 冻结投影注入真实快照 GET——B 的
 *   server projector 属 RT4 待交付，此处验证前端 decoder/view-model/轮询契约；
 *   注入只加字段不改既有快照内容，且只在无交付/无 active_action 的静息快照）。
 *
 * 如实登记的受阻范围（真实环境门禁，不得以 stub 冒充通过）：
 * - 真实录音→ASR→自动提交（需真实 mic 采集 + ASR key 面——P3 联合接线）；
 * - 真实模型生成序列/动态板书端到端（B 轨 RT3/RT4 + 批准资产——P3/P4）；
 * - presentation failed/revision conflict 的完整浏览器矩阵（P4 联合验收）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const TASK_URL = "/learn/goldenMinhangFold2020";

/** 真实可播放的 1.5s 静音 MP3（ffmpeg 生成；Chromium MediaSource audio/mpeg
 *  可解码——ended 事件由浏览器真实发出，播放完成才上报 presented）。 */
const SILENT_MP3 = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "silent-1.5s.mp3"));

interface CanonicalCall { method: string; url: string; at: number; kind: "outcome" | "control" | "snapshot-get" | "start" | "asr" }

function classify(method: string, url: string): CanonicalCall["kind"] {
  if (url.includes("/presentation-actions/") && method === "POST") return "outcome";
  if (url.endsWith("/student-inputs") && method === "POST") return "control";
  if (/\/tutor-sessions\/[^/]+$/.test(url) && method === "GET") return "snapshot-get";
  if (url.endsWith("/tutor-sessions") && method === "POST") return "start";
  if (url.endsWith("/asr") && method === "POST") return "asr";
  throw new Error(`unclassified canonical call: ${method} ${url}`);
}

async function prepareStudent(page: Page): Promise<void> {
  await page.addInitScript((name) => {
    window.localStorage.setItem("trig-web-student-name", name);
  }, "p2-e2e-student");
}

/** TTS 拦截（真实 MP3 字节）+ canonical 请求记录。 */
async function installCanonicalHarness(page: Page, options: { record?: boolean } = {}): Promise<CanonicalCall[]> {
  const calls: CanonicalCall[] = [];
  await page.route(/\/api\/action-speech(-stream)?$/, async (route: Route) => {
    if (route.request().url().endsWith("-stream")) {
      await route.fulfill({ status: 200, contentType: "audio/mpeg", body: SILENT_MP3 });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ audioUrl: `data:audio/mpeg;base64,${SILENT_MP3.toString("base64")}` }),
    });
  });
  if (options.record !== false) {
    page.on("request", (request) => {
      const url = request.url();
      if (!url.includes("/api/vnext/")) return;
      try {
        calls.push({ method: request.method(), url, at: Date.now(), kind: classify(request.method(), url) });
      } catch {
        /* 非 classify 范围的 vnext 调用（availability 等）不记录 */
      }
    });
  }
  return calls;
}

async function openCanonicalTask(page: Page): Promise<void> {
  await page.goto(TASK_URL);
  await expect(page.locator(".tutor-learn-page[data-session-id]")).not.toHaveAttribute("data-session-id", "", { timeout: 30_000 });
}

/** 等待某类 canonical 调用出现。 */
async function waitForCall(page: Page, calls: CanonicalCall[], kind: CanonicalCall["kind"], timeout = 20_000): Promise<CanonicalCall> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = calls.find((call) => call.kind === kind);
    if (found) return found;
    await page.waitForTimeout(200);
  }
  throw new Error(`canonical call ${kind} 未在 ${timeout}ms 内出现`);
}

/** 参与区静息锚：confirm CTA 或 answer 输入可见（开场 voice 播完后）。 */
async function waitForParticipation(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.getByTestId("tutor-confirm-input").or(page.getByTestId("tutor-submit-answer")).first()).toBeVisible({ timeout });
}

test.describe("F7 P2 canonical 浏览器旅程", () => {
  test("主旅程：canonical 链 + voice 真实播放完成后才上报 → 确认/作答（两拍）", async ({ page }) => {
    await prepareStudent(page);
    const calls = await installCanonicalHarness(page);
    await openCanonicalTask(page);
    // canonical 链启用：start 走 /api/vnext/tutor-sessions（非 legacy /experience）。
    await waitForCall(page, calls, "start");
    // 开场 voice 交付：真实呈现状态（浏览器内 NarrationController + MediaSession）。
    await expect(page.locator('[data-testid="tutor-presentation"][data-presentation-phase="presenting"][data-presentation-kind="voice"]')).toBeVisible({ timeout: 20_000 });
    // voice 真实播放完成（ended → presented outcome 上报）。
    await waitForCall(page, calls, "outcome", 20_000);
    await waitForParticipation(page);
    await page.getByTestId("tutor-confirm-input").click();
    // BT-02：answer_input（脚本化 Gate 放行）。
    await expect(page.getByTestId("tutor-submit-answer")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("回答输入").fill("识别第一组子母型，△CAD∽△CBA");
    await page.getByTestId("tutor-submit-answer").click();
    await expect(page.getByTestId("tutor-submit-answer")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("回答输入").fill("对应边成比例，AD=CD=8/3、BD=10/3");
    await page.getByTestId("tutor-submit-answer").click();
    // 两拍作答已提交（canonical 输入链闭环；BT-04 挂载缺陷见下方 fixme 登记）。
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && calls.filter((call) => call.kind === "control").length < 3) {
      await page.waitForTimeout(200);
    }
    expect(calls.filter((call) => call.kind === "control").length).toBeGreaterThanOrEqual(3);
  });

  /**
   * B 轨缺陷登记（本旅程实测发现，2026-09-07）：BT-04 挂载时 V7 server 投影
   * coach_panel_view.mainline(awaiting_workspace).action_id = "similarity.mark-
   * known-segments"（capability 串）≠ active_action.action_id = "tp:TP-SMV-009:1:
   * mark-segment-values-bt04"（模板键）——违反 spec §1.3 #8 对账，前端 adopt
   * 门禁 fail closed（协议错误提示 + 重试），workspace 无法挂载。修复归 B
   *（ActiveActionProjector/coach 投影统一 action_id 口径）；修复后启用本用例。
   */
  test.fixme("BT-04 画布挂载（受阻：B 轨 coach awaiting_workspace.action_id 投影与 active_action 不一致）", async ({ page }) => {
    await prepareStudent(page);
    await installCanonicalHarness(page);
    await openCanonicalTask(page);
    await waitForParticipation(page);
    await page.getByTestId("tutor-confirm-input").click();
    await page.getByLabel("回答输入").fill("识别第一组子母型，△CAD∽△CBA");
    await page.getByTestId("tutor-submit-answer").click();
    await page.getByLabel("回答输入").fill("对应边成比例，AD=CD=8/3、BD=10/3");
    await page.getByTestId("tutor-submit-answer").click();
    await expect(page.getByTestId("action-runtime-workspace")).toBeVisible({ timeout: 25_000 });
    await expect(page.locator(".geometry-canvas__board")).toBeVisible();
  });

  test("barge-in 因果：②interrupted/presented outcome 先于 ③control.barge_in；④新 sequence 再呈现", async ({ page }) => {
    await prepareStudent(page);
    const calls = await installCanonicalHarness(page);
    await openCanonicalTask(page);
    const presenting = page.locator('[data-testid="tutor-presentation"][data-presentation-phase="presenting"]');
    await expect(presenting).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("tutor-barge-in")).toBeVisible();
    await page.getByTestId("tutor-barge-in").click();
    const outcome = await waitForCall(page, calls, "outcome");
    const control = await waitForCall(page, calls, "control");
    // 因果顺序：outcome 请求先于 control.barge_in 请求。
    expect(outcome.at).toBeLessThan(control.at);
    // ④ Navigator 新 sequence 经同一 adopt 流程进入呈现/参与（listen 为
    // 间隙静息态——新决策在途时的合法参与投影）。
    await expect(
      page.locator('[data-testid="tutor-presentation"][data-presentation-phase="presenting"]')
        .or(page.getByTestId("tutor-confirm-input"))
        .or(page.getByTestId("tutor-submit-answer"))
        .or(page.getByTestId("tutor-participation"))
        .first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("refresh/reconnect：刷新后恢复同一会话（URL session + 服务端 rebuild）", async ({ page }) => {
    await prepareStudent(page);
    await installCanonicalHarness(page);
    await openCanonicalTask(page);
    await waitForParticipation(page);
    const sessionId = new URL(page.url()).searchParams.get("session");
    expect(sessionId).toMatch(/^TS-[0-9]{4,}$/);
    await page.reload();
    await expect(page.locator(".tutor-learn-page[data-session-id]")).not.toHaveAttribute("data-session-id", "", { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("session")).toBe(sessionId);
    await waitForParticipation(page);
  });

  test("390px 窄屏：无横向裁切，关键面可用", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepareStudent(page);
    await installCanonicalHarness(page);
    await openCanonicalTask(page);
    await waitForParticipation(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator("[data-testid='page-lifecycle']")).toBeVisible();
  });

  test("录音权限拒绝：真实 getUserMedia 权限路径 → 可见提示（非学生错误）+ 零 asr（R5 等待失败不录音）", async ({ page }) => {
    await prepareStudent(page);
    const calls = await installCanonicalHarness(page);
    await openCanonicalTask(page);
    await waitForParticipation(page);
    // Playwright 默认拒绝权限请求（未 grantPermissions）——getUserMedia 真实拒绝。
    const mic = page.locator("button[aria-label='语音提问']");
    await expect(mic).toBeVisible();
    await mic.click();
    await expect(page.locator("text=没有获得麦克风权限")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    expect(calls.filter((call) => call.kind === "asr")).toHaveLength(0);
  });

  test("generation 状态显示与只读轮询（S1 投影注入真实 GET 快照；B projector 待交付如实登记）", async ({ page }) => {
    await prepareStudent(page);
    await installCanonicalHarness(page, { record: false });
    type InjectMode = "pending-running" | "waiting-retry" | "none";
    let inject: InjectMode = "pending-running";
    await page.route(/\/api\/vnext\/tutor-sessions\/[^/]+$/, async (route: Route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      // 仅在无 pending 交付/无 active_action 的静息快照注入（一致性门禁 #15）。
      const quiescent = !("pending_presentation" in body) && !("active_action" in body);
      if (quiescent && inject === "pending-running") {
        body.generation = { status: "pending", request_id: "GR-E2E-0001", phase: "running", attempt: 1, max_attempts: 3 };
        body.scope = { kind: "approved", protocol_id: "PR-SMV-002", beat_id: "BT-03" };
      } else if (quiescent && inject === "waiting-retry") {
        body.generation = { status: "pending", request_id: "GR-E2E-0001", phase: "waiting_retry", attempt: 1, max_attempts: 3, retry_at: new Date(Date.now() + 2500).toISOString() };
        body.scope = { kind: "approved", protocol_id: "PR-SMV-002", beat_id: "BT-03" };
      }
      await route.fulfill({ response, json: body });
    });
    let snapshotGets = 0;
    page.on("request", (request) => {
      if (request.method() === "GET" && /\/api\/vnext\/tutor-sessions\/[^/]+$/.test(request.url())) snapshotGets += 1;
    });
    await openCanonicalTask(page);
    await waitForParticipation(page);
    // 轮询引导：刷新 → restore GET 携带注入投影 → 前端进入 pending 只读轮询。
    await page.reload();
    await expect(page.getByTestId("tutor-generation-status")).toHaveAttribute("data-generation-phase", "running", { timeout: 20_000 });
    await expect(page.getByTestId("tutor-generation-status")).toContainText("正在生成讲解");
    const getsAfterBootstrap = snapshotGets;
    await page.waitForTimeout(5200);
    expect(snapshotGets - getsAfterBootstrap).toBeGreaterThanOrEqual(1); // 只读轮询持续（GET）
    // waiting_retry 投影：文案带重试进度（第 n/(max-1) 次）。
    inject = "waiting-retry";
    await expect(page.getByTestId("tutor-generation-status")).toContainText("正在重试（第 1/2 次）", { timeout: 15_000 });
    // 停止注入（无字段）→ 状态消失、轮询停止。
    inject = "none";
    await expect(page.getByTestId("tutor-generation-status")).toHaveCount(0, { timeout: 15_000 });
    const getsAfterIdle = snapshotGets;
    await page.waitForTimeout(4500);
    expect(snapshotGets - getsAfterIdle).toBe(0);
  });
});
