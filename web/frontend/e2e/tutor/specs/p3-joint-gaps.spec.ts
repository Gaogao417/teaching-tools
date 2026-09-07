/**
 * F7 P4 JR5：覆盖表补位浏览器行（协调者轮）。
 *
 * 关闭覆盖表中「浏览器矩阵行缺」且当前可工程化的四行：
 * - US-03 listen_only：呈现期间无主线输入误触面，Coach assistance 仍可用；
 * - US-04 confirm 唯一 typed control：点击唯一 CTA → POST student-inputs
 *   携带 input.kind=control + command=confirm（前端不产语义猜测）；
 * - US-09 assistance/mainline 分离：coach 提问走 assistance 通道，主线 Beat 不漂移
 *   （合成链若支持 inquiry 则断言 return point；否则断言补讲后主线继续）；
 * - D1 Voice×录音互斥：播放中开 coach mic → 真实停播 + interrupted outcome 回执。
 */
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const TASK_URL = "/learn/goldenMinhangFold2020";
const SILENT_MP3 = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "silent-1.5s.mp3"));

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

async function installTtsIntercept(page: Page): Promise<void> {
  await page.route(/\/api\/action-speech(-stream)?$/, async (route: Route) => {
    if (route.request().url().endsWith("-stream")) {
      await route.fulfill({ status: 200, contentType: "audio/mpeg", body: SILENT_MP3 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
}

async function prepareStudent(page: Page): Promise<void> {
  await page.addInitScript((name) => {
    window.localStorage.setItem("trig-web-student-name", name);
  }, "jr5-gaps-student");
}

interface InputPost { kind?: string; command?: string; channel?: string }

function trackInputPosts(page: Page): InputPost[] {
  const posts: InputPost[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/student-inputs$/.test(new URL(request.url()).pathname)) {
      const body = request.postDataJSON() as { input?: { kind?: string; control?: string; command?: string; channel?: string } };
      posts.push({ kind: body?.input?.kind, command: body?.input?.control ?? body?.input?.command, channel: body?.input?.channel });
    }
  });
  return posts;
}

test("JR5-a US-03/US-04：呈现期零主线输入面 + confirm 唯一 typed control", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await prepareStudent(page);
  await installTtsIntercept(page);
  const posts = trackInputPosts(page);
  await page.goto(TASK_URL);
  await expect(page.getByTestId("tutor-presentation")).toBeVisible({ timeout: 60_000 });
  // US-03：voice 呈现中——主线输入不可操作（listen_only 状态面：无 enabled 输入/提交），coach assistance 可用
  await expect(page.locator('[data-testid="tutor-presentation"][data-presentation-phase="presenting"]')).toBeVisible({ timeout: 30_000 });
  const participationInputs = page.getByTestId("tutor-participation").locator("input, button[type=submit]");
  const inputCount = await participationInputs.count();
  for (let i = 0; i < inputCount; i++) {
    await expect(participationInputs.nth(i)).toBeDisabled({ timeout: 1_000 }).catch(async () => {
      throw new Error(`呈现期间主线参与控件 #${i} 不应可操作（US-03 listen_only）`);
    });
  }
  await expect(page.getByTestId("tutor-participation").locator("input:enabled")).toHaveCount(0);
  await expect(page.getByPlaceholder("文字或语音问老师")).toBeEditable();
  // 等呈现完成进入确认拍
  await expect(page.getByTestId("tutor-confirm-input").or(page.getByTestId("tutor-submit-answer")).first()).toBeVisible({ timeout: 60_000 });
  // US-04：confirm CTA 唯一且点击后是 typed control（非文本猜测）
  const confirm = page.getByTestId("tutor-confirm-input");
  if (await confirm.isVisible().catch(() => false)) {
    await expect(confirm).toHaveCount(1);
    const before = posts.length;
    await confirm.click();
    await page.waitForTimeout(2_000);
    const added = posts.slice(before);
    expect(added.length, "confirm 恰产生一个输入请求").toBe(1);
    expect(added[0].kind, "confirm 是 typed control").toBe("control");
    expect(added[0].command, "control 命令为 confirm").toBe("confirm");
  }
});

test("JR5-b US-09：assistance 提问走独立通道、主线 Beat 不漂移", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await prepareStudent(page);
  await installTtsIntercept(page);
  const posts = trackInputPosts(page);
  await page.goto(TASK_URL);
  await expect(page.getByTestId("coach-prompt")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("tutor-presentation")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("tutor-confirm-input").or(page.getByTestId("tutor-submit-answer")).first()).toBeVisible({ timeout: 60_000 });
  const progressBefore = await page.getByTestId("coach-progress").textContent().catch(() => "");
  const ask = page.getByPlaceholder("文字或语音问老师");
  await ask.fill("这一步为什么要作辅助线？");
  await ask.press("Enter");
  const deadline = Date.now() + 90_000;
  let assistancePosted = false;
  while (Date.now() < deadline) {
    assistancePosted = posts.some((p) => p.kind === "utterance" && p.channel === "assistance");
    if (assistancePosted) break;
    await page.waitForTimeout(500);
  }
  expect(assistancePosted, "coach 提问以 assistance 通道提交").toBe(true);
  // 主线不因提问漂移：完成后进度区可回到原教学位（inquiry 行出现则验证 return point）
  const inquiryRow = page.getByTestId("tutor-inquiry-row");
  if (await inquiryRow.first().isVisible({ timeout: 30_000 }).catch(() => false)) {
    const ret = page.getByTestId("tutor-inquiry-return").first();
    await expect(ret).toBeVisible();
    await ret.click();
    await page.waitForTimeout(3_000);
  }
  await expect(page.getByTestId("tutor-confirm-input").or(page.getByTestId("tutor-submit-answer")).or(page.getByTestId("coach-prompt")).first()).toBeVisible({ timeout: 60_000 });
  const progressAfter = await page.getByTestId("coach-progress").textContent().catch(() => "");
  expect(progressAfter, "提问/返回不漂移主线进度").toBe(progressBefore);
});

test("JR5-c D1：播放中开 coach mic → 真实停播 + interrupted outcome 回执（先握手后录音）", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await prepareStudent(page);
  await installTtsIntercept(page);
  let asrCalls = 0;
  await page.route(/\/api\/vnext\/tutor-sessions\/[^/]+\/asr$/, async (route) => {
    asrCalls++;
    const sid = new URL(route.request().url()).pathname.split("/").at(-2)!;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session_id: sid, observed_revision: 1, transcript: "请问这一步为什么相似？", model: "jr5-fake-asr" }),
    });
  });
  const outcomes: string[] = [];
  page.on("request", (request) => {
    if (/\/presentation-actions\/[^/]+\/outcomes$/.test(new URL(request.url()).pathname) && request.method() === "POST") {
      outcomes.push(request.postData() ?? "");
    }
  });

  await page.goto(TASK_URL);
  const presenting = page.locator('[data-testid="tutor-presentation"][data-presentation-phase="presenting"]');
  await expect(presenting).toBeVisible({ timeout: 60_000 });
  // 播放中启动 coach mic：先完成 barge-in 握手（停播+interrupted 回执），再真正录音
  const coachMic = page.getByRole("button", { name: /语音提问|问老师/ }).first();
  await coachMic.click();
  await expect(page.locator('[data-testid="tutor-presentation"][data-presentation-phase="presenting"]')).toBeHidden({ timeout: 30_000 });
  const interruptedAppeared = outcomes.some((body) => body.includes('"interrupted"'));
  expect(interruptedAppeared, "播放中断产生 interrupted outcome 回执").toBe(true);
  // 停止录音 → ASR 恰一次（observed_revision 故意偏离捕获 → stale 草稿路径也是合法产物，不自动提交）
  await page.getByRole("button", { name: /结束录音/ }).first().click();
  await page.waitForTimeout(5_000);
  expect(asrCalls, "停止后 ASR 恰一次").toBe(1);
});
