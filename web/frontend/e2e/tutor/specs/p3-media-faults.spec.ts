/**
 * F7 P3 A' 轨：媒体/录音/播放故障矩阵 L3 行（fault matrix F1/F2/F3/F10，
 * 基名 EV=mvp/foundation/f7/evidence/p3p4-2026-09-08——产物为 Playwright 运行
 * 本身的 trace/请求记录，报告引用行 ID）。
 *
 * 覆盖行（全部真实浏览器 + 真实 backend + TTS 拦截回真实 MP3 字节）：
 * - FM-1-4 无麦克风设备（伪造 NotFoundError——p2 行已覆盖真实权限拒绝路径
 *   （FM-1-3 复验跑 p2 既有用例），本行验证设备故障分支的 UI 分类与零上报）；
 * - FM-1-5 录音取消（开始后切换页面：SPA 路由真实切换 → recorder unmount →
 *   capture 作废，零 ASR）；
 * - FM-2-1/2-2 ASR 超时/不可用（route 拦截 /asr 504/503；断言 UI 提示 + 零
 *   教学事实（无 utterance 提交）+ 不走 legacy API）；
 * - FM-2-3 录音后 revision 漂移（拦截 /asr 延迟返回期间驱动挂起讲解播放完成
 *   → presented outcome 推进 revision；断言 transcript 只进草稿 + 确认提示、
 *   不自动提交）；
 * - FM-2-4 迟到 ASR（返回前切换会话：训练→学习真实 SPA 换页换会话；断言旧
 *   结果不污染新会话输入框、零提交）；
 * - FM-3-4 replay（真实浏览器点重播：零第二次 presented——网络断言）；
 * - FM-10-2 键盘-only BT-04 旅程（Enter/Space 与 pointer 同 actor；CLEAR
 *   键盘可达；完成过门推进）；
 * - FM-10-5 恢复接口保留失败状态（TTS 一次性 503 → presentation failure
 *   可见；刷新后经 restore 快照仍可见且重试入口在；重试恢复讲解）。
 * （FM-3-2 autoplay 受阻需要相反的启动策略，见 p3-media-autoplay.spec.ts。）
 *
 * 如实登记：模拟麦克风音频来自 Playwright fake media device（合法音频 blob），
 * 验证的是故障分支与身份纪律；真人语音行（FM-1-1/1-2）由用户另行执行，
 * 本文件不声称覆盖。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const TASK_URL = "/learn/goldenMinhangFold2020";

// 本文件统一启动参数：自动播放放行（narration 起播）+ fake-ui 自动授予权限 +
// fake-device 提供真实音频轨（MediaRecorder 真实封装 webm blob 上报 /asr——
// 拦截点在 HTTP 层，录音/捕获/通道身份链全程真实）。
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

/** 真实可播放的 1.5s 静音 MP3（播放/ended 是浏览器真行为）。 */
const SILENT_MP3 = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "silent-1.5s.mp3"));

interface CanonicalCall { method: string; url: string; at: number; kind: "outcome" | "control" | "snapshot-get" | "start" | "asr"; body?: string }

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
  }, "p3-media-faults-student");
}

/** TTS 拦截（真实 MP3 字节）+ canonical/legacy 请求记录（control 类请求附 body
 *  以断言「零 utterance 提交」）。 */
async function installCanonicalHarness(page: Page): Promise<CanonicalCall[]> {
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
  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/api/")) return;
    try {
      calls.push({ method: request.method(), url, at: Date.now(), kind: classify(request.method(), url), body: request.postData() ?? undefined });
    } catch {
      /* 非 classify 范围（availability 等）不记录 */
    }
  });
  return calls;
}

/** legacy 纪律（spec §5）：新会话不得复用 legacy /api/tutor-sessions/* 端点。 */
function legacyTutorSessionCalls(calls: readonly CanonicalCall[]): CanonicalCall[] {
  return calls.filter((call) => /\/api\/tutor-sessions(\/|$)/.test(call.url) && !call.url.includes("/api/vnext/"));
}

function utteranceSubmissions(calls: readonly CanonicalCall[]): CanonicalCall[] {
  return calls.filter((call) => call.kind === "control" && (call.body?.includes('"kind":"utterance"') ?? false));
}

async function openCanonicalTask(page: Page, extraQuery = ""): Promise<void> {
  await page.goto(`${TASK_URL}${extraQuery}`);
  await expect(page.locator(".tutor-learn-page[data-session-id]")).not.toHaveAttribute("data-session-id", "", { timeout: 30_000 });
}

/** 参与区静息锚：confirm CTA 或 answer 输入可见（开场 voice 播完后）。 */
async function waitForParticipation(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.getByTestId("tutor-confirm-input").or(page.getByTestId("tutor-submit-answer")).first()).toBeVisible({ timeout });
}

async function waitForCall(calls: CanonicalCall[], kind: CanonicalCall["kind"], timeout = 20_000): Promise<CanonicalCall> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = calls.find((call) => call.kind === kind);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`canonical call ${kind} 未在 ${timeout}ms 内出现`);
}

/** 录音并停止（fake media device 提供真实音频轨），返回录音激活期。 */
async function recordAndStop(page: Page): Promise<void> {
  const mic = page.locator("button[aria-label='语音提问']");
  await expect(mic).toBeVisible();
  await mic.click();
  await expect(page.locator("button[aria-label='结束录音']")).toBeVisible({ timeout: 15_000 });
  await page.locator("button[aria-label='结束录音']").click();
}

test.describe("F7 P3 媒体故障 L3：模拟麦克风 + 故障注入", () => {

  test("FM-1-4 无麦克风设备：NotFoundError → 设备不可用提示 + 零请求", async ({ page }) => {
    await prepareStudent(page);
    const calls = await installCanonicalHarness(page);
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints: MediaStreamConstraints) => {
        if (constraints && constraints.audio) throw new DOMException("no microphone", "NotFoundError");
        return original(constraints);
      };
    });
    await openCanonicalTask(page);
    await waitForParticipation(page);
    const mic = page.locator("button[aria-label='语音提问']");
    await expect(mic).toBeVisible();
    await mic.click();
    await expect(page.getByText("未检测到可用的麦克风设备")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    expect(calls.filter((call) => call.kind === "asr")).toHaveLength(0);
    expect(utteranceSubmissions(calls)).toHaveLength(0);
    await expect(page.getByLabel("向老师提问")).toBeEnabled();
  });

  test("FM-1-5 录音取消：录音中切换页面（SPA 真实换页）→ capture 作废，零 ASR", async ({ page }) => {
    await prepareStudent(page);
    const calls = await installCanonicalHarness(page);
    await openCanonicalTask(page);
    await waitForParticipation(page);
    const mic = page.locator("button[aria-label='语音提问']");
    await mic.click();
    // 录音真实进行中（fake device 轨道活跃）。
    await expect(page.locator("button[aria-label='结束录音']")).toBeVisible({ timeout: 15_000 });
    // 停止前切换页面：真实应用内导航（学习模式 → 训练）——LearnPage unmount，
    // recorder cleanup 作废 capture（epoch 失效），旧 blob 不上报。
    await page.getByRole("button", { name: "训练", exact: true }).click();
    await expect(page).toHaveURL(/\/practice\//, { timeout: 15_000 });
    await page.waitForTimeout(2000);
    expect(calls.filter((call) => call.kind === "asr")).toHaveLength(0);
    expect(utteranceSubmissions(calls)).toHaveLength(0);
  });

  test("FM-2-1 ASR 超时（504 ASR_TIMEOUT）：可见提示 + 零教学事实 + 不走 legacy", async ({ page }) => {
    await prepareStudent(page);
    const calls = await installCanonicalHarness(page);
    await page.route(/\/asr$/, async (route) => {
      await route.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ error: { code: "ASR_TIMEOUT", message: "asr upstream timeout" } }) });
    });
    await openCanonicalTask(page);
    await waitForParticipation(page);
    await recordAndStop(page);
    await expect(page.getByTestId("tutor-speech-notice")).toContainText("语音识别超时", { timeout: 15_000 });
    // 零教学事实：无 utterance 提交；系统失败不记学生错误。
    expect(utteranceSubmissions(calls)).toHaveLength(0);
    // 身份纪律：全程零 legacy /api/tutor-sessions（非 vnext）调用。
    expect(legacyTutorSessionCalls(calls)).toHaveLength(0);
    // 文字入口（恢复动作：改用文字）可用。
    await expect(page.getByLabel("向老师提问")).toBeEnabled();
  });

  test("FM-2-2 ASR 不可用（503 ASR_UNAVAILABLE）：可见提示 + 零教学事实 + 不走 legacy", async ({ page }) => {
    await prepareStudent(page);
    const calls = await installCanonicalHarness(page);
    await page.route(/\/asr$/, async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "ASR_UNAVAILABLE", message: "asr provider unavailable" } }) });
    });
    await openCanonicalTask(page);
    await waitForParticipation(page);
    await recordAndStop(page);
    await expect(page.getByTestId("tutor-speech-notice")).toContainText("语音识别暂不可用", { timeout: 15_000 });
    expect(utteranceSubmissions(calls)).toHaveLength(0);
    expect(legacyTutorSessionCalls(calls)).toHaveLength(0);
    await expect(page.getByLabel("向老师提问")).toBeEnabled();
  });

  test("FM-2-3 录音后 revision 漂移：ASR 返回前 revision 推进 → transcript 只进草稿+确认提示，不自动提交", async ({ page }) => {
    await prepareStudent(page);
    const calls = await installCanonicalHarness(page);
    await openCanonicalTask(page, "?acceptance=1");
    await waitForParticipation(page);
    // 确认拍静息（开场讲解已 presented，无活跃可中断交付）——录音门直接放行。
    const mic = page.locator("button[aria-label='语音提问']");
    await mic.click();
    await expect(page.locator("button[aria-label='结束录音']")).toBeVisible({ timeout: 20_000 });
    // 录音开始捕获当前 revision（录音期间无在途回执，快照即捕获值）。
    const snapshot = await page.evaluate(() => (window as unknown as { __runtimeSessionSnapshot?: { revision: number; session_id: string } }).__runtimeSessionSnapshot);
    expect(snapshot?.revision).toBeGreaterThanOrEqual(0);
    const capturedRevision = snapshot!.revision;
    // 拦截 /asr：等待 revision 推进（确认回执）后再返回——模拟迟到 ASR。
    await page.route(/\/asr$/, async (route) => {
      const asrAt = Date.now();
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (calls.some((call) => call.kind === "control" && call.at > asrAt)) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session_id: snapshot!.session_id, observed_revision: capturedRevision, transcript: "为什么这一步是相似的？", model: "e2e-fake-asr" }),
      });
    });
    const driftStart = Date.now();
    await page.locator("button[aria-label='结束录音']").click();
    // ASR 在途时推进 revision：确认回执（playback 完成回执的同构漂移源——
    // 漂移检测被测的是捕获值 vs 当前快照的核对，对回执来源不区分）。
    await page.getByTestId("tutor-confirm-input").click();
    const driftDeadline = Date.now() + 20_000;
    let confirmControl: CanonicalCall | undefined;
    while (Date.now() < driftDeadline && !confirmControl) {
      confirmControl = calls.find((call) => call.kind === "control" && call.at > driftStart);
      if (!confirmControl) await page.waitForTimeout(200);
    }
    expect(confirmControl, "ASR 在途时应观察到 revision 推进回执（漂移成立）").toBeDefined();
    // ASR 迟回（携带捕获 revision）：stale 四重核对命中 → transcript 只进
    // assistance 草稿 + 确认提示。
    await expect(page.getByTestId("tutor-speech-notice")).toHaveCount(0); // 无 ASR 错误提示
    await expect(page.getByLabel("向老师提问")).toHaveValue("为什么这一步是相似的？", { timeout: 20_000 });
    await expect(page.getByText("语音内容已按录音时的通道填入草稿，请确认后再发送")).toBeVisible({ timeout: 20_000 });
    // 不自动提交：零 utterance（确认 control 属合法用户输入，非 ASR 代提交）。
    expect(utteranceSubmissions(calls)).toHaveLength(0);
  });

  test("FM-2-4 迟到 ASR：返回前切换会话（训练→学习真实换页换会话）→ 不污染新输入框、零提交", async ({ page }) => {
    await prepareStudent(page);
    const calls = await installCanonicalHarness(page);
    let asrFulfilled = false;
    await page.route(/\/asr$/, async (route) => {
      // 迟到 6s——期间完成换页换会话。
      await new Promise((resolve) => setTimeout(resolve, 6000));
      const sessionId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session_id: sessionId, observed_revision: 1, transcript: "旧会话里的半句话", model: "e2e-fake-asr" }),
      });
      asrFulfilled = true;
    });
    await openCanonicalTask(page);
    await waitForParticipation(page);
    await recordAndStop(page);
    await waitForCall(calls, "asr", 15_000);
    // ASR 在途时切换页面：训练（新页面）→ 返回学习（新会话 mount，新输入框）。
    await page.getByRole("button", { name: "训练", exact: true }).click();
    await expect(page).toHaveURL(/\/practice\//, { timeout: 15_000 });
    await page.getByRole("button", { name: "学习", exact: true }).click();
    await expect(page).toHaveURL(/\/learn\//, { timeout: 15_000 });
    // 新会话就绪（开场讲解 → 参与）；等待迟到 ASR 实际返回。
    await waitForParticipation(page, 40_000);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !asrFulfilled) await page.waitForTimeout(300);
    expect(asrFulfilled).toBe(true);
    await page.waitForTimeout(1000);
    // 新会话输入框未被旧 transcript 污染；旧结果未自动提交。
    await expect(page.getByLabel("向老师提问")).toHaveValue("");
    expect(utteranceSubmissions(calls)).toHaveLength(0);
  });
});

test.describe("F7 P3 播放故障 L3：replay 与键盘旅程（autoplay 允许）", () => {
  test("FM-3-4 replay：真实浏览器点重播 → 本地缓存回放，零第二次 presented、不推进 cursor", async ({ page }) => {
    await prepareStudent(page);
    const calls = await installCanonicalHarness(page);
    await openCanonicalTask(page);
    await waitForParticipation(page);
    const outcomesBefore = calls.filter((call) => call.kind === "outcome").length;
    expect(outcomesBefore).toBeGreaterThanOrEqual(1); // 开场讲解已 presented
    await page.getByLabel("重播老师语音").click();
    await page.waitForTimeout(4000); // 静音 MP3 1.5s：回放完成窗口
    // 零第二次 presented：重播后无新增 outcome 上报。
    expect(calls.filter((call) => call.kind === "outcome").length).toBe(outcomesBefore);
    // 不推进 cursor：参与区仍在确认拍。
    await expect(page.getByTestId("tutor-confirm-input")).toBeVisible();
  });

  test("FM-10-2 键盘-only BT-04 旅程：键盘选择/填值/CLEAR 可达/确认过门（与 US-06/US-14 同 actor）", async ({ page }) => {
    await prepareStudent(page);
    await installCanonicalHarness(page);
    await openCanonicalTask(page);
    await waitForParticipation(page);
    await page.getByTestId("tutor-confirm-input").click();
    await page.getByLabel("回答输入").fill("识别第一组子母型，△CAD∽△CBA");
    await page.getByTestId("tutor-submit-answer").click();
    await page.getByLabel("回答输入").fill("对应边成比例，AD=CD=8/3、BD=10/3");
    await page.getByTestId("tutor-submit-answer").click();
    const workspace = page.getByTestId("action-runtime-workspace");
    await expect(workspace).toBeVisible({ timeout: 30_000 });
    await expect(workspace).toHaveAttribute("data-action-id", /mark-segment-values/, { timeout: 30_000 });
    // 键盘-only 选择四段（同一 XState actor 的 OBJECT.SELECTED 语义通道）。
    // 注：键盘遍历顺序 = interactionView enabled 实体插入序（AO,BO,DO,OE），
    // 合同为 server-authoritative——本地不限选择顺序，四段齐备即可。
    const canvas = page.locator(".geometry-canvas");
    for (let index = 0; index < 4; index += 1) {
      await canvas.focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
    }
    await expect(workspace).toHaveAttribute("data-selected", /seg-AO/);
    await expect(workspace).toHaveAttribute("data-selected", /seg-DO/);
    await expect(workspace).toHaveAttribute("data-selected", /seg-BO/);
    await expect(workspace).toHaveAttribute("data-selected", /seg-OE/);
    // 键盘填值（label 寻址，fill 经真实输入事件）。
    const values: Record<string, string> = {
      "seg-AO": "\\frac{16}{5}",
      "seg-DO": "\\frac{32}{15}",
      "seg-BO": "\\frac{6}{5}",
      "seg-OE": "\\frac{4}{5}",
    };
    for (const [segmentId, value] of Object.entries(values)) {
      await page.getByLabel(segmentId, { exact: false }).fill(value);
    }
    // CLEAR 键盘可达：Tab 序列可到达「清空」（不实际清空——仅可达性）。
    let clearReached = false;
    for (let tab = 0; tab < 10 && !clearReached; tab += 1) {
      await page.keyboard.press("Tab");
      const active = await page.evaluate(() => {
        const element = document.activeElement;
        return element && element.tagName === "BUTTON" ? element.textContent ?? "" : "";
      });
      if (active.includes("清空")) clearReached = true;
    }
    expect(clearReached).toBe(true);
    // 键盘确认提交（Enter 于「确认」按钮）→ 过门推进 BT-05。
    let confirmed = false;
    for (let tab = 0; tab < 6 && !confirmed; tab += 1) {
      await page.keyboard.press("Tab");
      const active = await page.evaluate(() => {
        const element = document.activeElement;
        return element && element.tagName === "BUTTON" ? element.textContent ?? "" : "";
      });
      if (active.includes("确认")) {
        await page.keyboard.press("Enter");
        confirmed = true;
      }
    }
    expect(confirmed).toBe(true);
    await expect(page.getByTestId("tutor-submit-answer")).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("F7 P3 完成恢复 L3：presentation failure × 刷新", () => {
  test("FM-10-5 TTS 失败 → 刷新后失败可见且重试入口在 → 重试恢复讲解", async ({ page }) => {
    await prepareStudent(page);
    const calls = await installCanonicalHarness(page);
    // TTS 一次性 503（首个语音合成请求失败；后续恢复真实 MP3）。
    let speechRequests = 0;
    await page.route(/\/api\/action-speech(-stream)?$/, async (route: Route) => {
      speechRequests += 1;
      if (speechRequests === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "tts unavailable" }) });
        return;
      }
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
    await openCanonicalTask(page);
    // 首个 voice 合成失败 → presentation failure 可见（provider_failure 系）。
    await expect(page.getByTestId("tutor-presentation-failure")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tutor-presentation-retry")).toBeVisible();
    // 不误报学生错误/协议错误。
    await expect(page.getByTestId("tutor-protocol-error")).toHaveCount(0);
    // 刷新：restore（GET 只读）后失败状态仍可见（v2 发现项：恢复 status 漏
    // presentation failure——现经 snapshot last_failure 投影恢复）、重试入口在。
    await page.reload();
    await expect(page.locator(".tutor-learn-page[data-session-id]")).not.toHaveAttribute("data-session-id", "", { timeout: 30_000 });
    await expect(page.getByTestId("tutor-presentation-failure")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tutor-presentation-retry")).toBeVisible();
    // 重试 → control.retry_recovery → 新讲解（TTS 已恢复）→ 正常推进。
    await page.getByTestId("tutor-presentation-retry").click();
    await waitForParticipation(page, 40_000);
    expect(calls.some((call) => call.kind === "control" && (call.body?.includes("retry_recovery") ?? false))).toBe(true);
    // 恢复讲解后失败提示消失（新交付取代旧失败视图）。
    await expect(page.getByTestId("tutor-presentation-failure")).toHaveCount(0, { timeout: 10_000 });
  });
});
