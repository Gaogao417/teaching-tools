/**
 * F7 P3 A' 轨：FM-3-2 autoplay 受阻（fault matrix F3）——浏览器级条件用例。
 *
 * 如实登记（2026-09-08 实测）：本机 Playwright headless Chromium 无法通过启动
 * 策略强制 autoplay 阻塞——`--autoplay-policy=user-gesture-required`（及
 * document-user-activation-required）下 headless 的 play() 仍放行（文件内
 * probe 用例复测）。任务纪律禁止伪造 play() 拒绝冒充浏览器证据，因此：
 * - 默认（策略无效）→ 本文件 skip 并指向组件级证据：
 *   src/pages/learn/__tests__/TutorLearnExperience.autoplayBlocked.test.tsx
 *   （UI 接线：awaiting-gesture+恢复入口+零 failure 误报+同链恢复）与
 *   voicePresentationAdapter.test / PresentationRuntimeController.test
 *   （blocked→resume→presented outcome 链）。
 * - 若未来环境（如有头/CDP 真机）策略生效 → probe 放行后执行完整浏览器断言。
 *
 * 运行方式（playwright.tutor.config.ts 的 env 门控——test.use launchOptions
 * 无法覆盖 config 级参数）：
 *
 *   TUTOR_E2E_AUTOPLAY_BLOCKED=1 npx playwright test --config=playwright.tutor.config.ts \
 *     e2e/tutor/specs/p3-media-autoplay.spec.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const TASK_URL = "/learn/goldenMinhangFold2020";
const SILENT_MP3 = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "silent-1.5s.mp3"));

test("FM-3-2 前置 probe：本环境启动策略能否强制 autoplay 阻塞", async ({ page }) => {
  test.skip(process.env.TUTOR_E2E_AUTOPLAY_BLOCKED !== "1", "需 TUTOR_E2E_AUTOPLAY_BLOCKED=1（config 翻转启动策略）");
  await page.goto("about:blank");
  const result = await page.evaluate(async () => {
    const audio = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=");
    try { await audio.play(); return "played"; } catch (error) { return `rejected:${(error as Error).name}`; }
  });
  test.skip(result === "played", `headless Chromium 未强制 autoplay 阻塞（probe=${result}）——FM-3-2 以组件级证据登记（TutorLearnExperience.autoplayBlocked.test.tsx），不伪造浏览器证据`);
});

test("FM-3-2 autoplay blocked：暂停+手势恢复入口，恢复后继续；单 audio 元素零重挂；不误报 failure", async ({ page }) => {
  test.skip(true, "本环境策略无效（见 probe 用例）；完整断言留待有头/真机环境——组件级证据见 TutorLearnExperience.autoplayBlocked.test.tsx");
  await prepareStudent(page);
  await page.route(/\/api\/action-speech(-stream)?$/, async (route: Route) => {
    if (route.request().url().endsWith("-stream")) { await route.fulfill({ status: 200, contentType: "audio/mpeg", body: SILENT_MP3 }); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ audioUrl: `data:audio/mpeg;base64,${SILENT_MP3.toString("base64")}` }) });
  });
  await openCanonicalTask(page);
  const gesture = page.locator('[data-testid="tutor-presentation"][data-presentation-phase="awaiting-gesture"]');
  await expect(gesture).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("tutor-presentation-resume")).toBeVisible();
  await expect(page.getByTestId("tutor-presentation-failure")).toHaveCount(0);
  await expect(page.getByTestId("tutor-protocol-error")).toHaveCount(0);
  await expect(page.getByTestId("tutor-error")).toHaveCount(0);
  const audioCount = await page.evaluate(() => document.querySelectorAll("audio").length);
  expect(audioCount).toBeLessThanOrEqual(1);
  await page.getByTestId("tutor-presentation-resume").click();
  await expect(page.locator('[data-testid="tutor-presentation"][data-presentation-phase="presenting"]')
    .or(page.getByTestId("tutor-confirm-input")).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("tutor-confirm-input").or(page.getByTestId("tutor-submit-answer")).first()).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => document.querySelectorAll("audio").length)).toBe(audioCount);
  await expect(page.getByTestId("tutor-presentation-failure")).toHaveCount(0);
});

async function prepareStudent(page: Page): Promise<void> {
  await page.addInitScript((name) => {
    window.localStorage.setItem("trig-web-student-name", name);
  }, "p3-autoplay-student");
}

async function openCanonicalTask(page: Page): Promise<void> {
  await page.goto(TASK_URL);
  await expect(page.locator(".tutor-learn-page[data-session-id]")).not.toHaveAttribute("data-session-id", "", { timeout: 30_000 });
}
