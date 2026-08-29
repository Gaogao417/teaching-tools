/**
 * FE 准备轨（fe-prep，2026-08-28）：canonical view/v1 renderer 的浏览器
 * harness 冒烟/断言——**fixtures 驱动，非集成**。
 *
 * - 只驱动 dev-only harness 路由 `/__fe-prep__/canonical-view`（canonical
 *   fixtures 经 import.meta.glob 自驱动），不进入 `/learn/:taskId`，不依赖
 *   后端 response；F6 真实链接入前不得据此宣称集成完成（计划 §4）；
 * - 断言语义与 vitest（src/presentation/canonicalView/__tests__）同源：
 *   六区域稳定命名、同 session/revision 投影组合、受控 participation、
 *   inquiry return point、负例 fail-closed 且泄漏文本零出现；
 * - 键盘路径从 body 自然焦点起连续 Tab（2026-08-29 复验修复 P3：不使用
 *   任何程序化 focus，replay/assistance 入口必须按真实 Tab 顺序可达）；
 * - 不修改既有 specs；本文件是新增 spec（fe-prep scope ledger C4）。
 */
import { expect, test, type Page } from "@playwright/test";

const HARNESS = "/__fe-prep__/canonical-view";

async function gotoHarness(page: Page, query: string): Promise<void> {
  await page.goto(`${HARNESS}?${query}`);
  await expect(page.getByTestId("canonical-view-harness")).toBeVisible();
}

/**
 * 从 body（页面自然初始焦点，无任何程序化 focus）开始连续 Tab，记录每个
 * 停靠元素的 data-testid，直至见到 lastTestId。中间停靠点（nav 链接、可
 * 聚焦滚动容器等）一并记录——由调用方断言目标元素的**相对顺序与可达性**。
 */
async function tabStopsFromBody(page: Page, lastTestId: string, maxPresses = 16): Promise<string[]> {
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
  const stops: string[] = [];
  for (let index = 0; index < maxPresses; index += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
    stops.push(stop);
    if (stop === lastTestId) return stops;
  }
  return stops;
}

test.describe("fe-prep canonical view harness（fixtures-driven，未集成）", () => {
  test("positive fixtures render the six ADR-009 regions at one revision", async ({ page }) => {
    await gotoHarness(page, "workspace=student-workspace-view.positive&coach=coach-panel-view.positive");
    // 六区域稳定命名（ADR-009 布局不变量 1）
    for (const region of ["region-question", "region-tutor", "region-geometry", "region-solution-board", "region-participation", "region-status"]) {
      await expect(page.getByTestId(region), region).toBeVisible();
    }
    // 同 session 同 revision 投影（ADR-010 不变量 4）
    await expect(page.getByTestId("canonical-student-workspace")).toHaveAttribute("data-view-revision", "6");
    await expect(page.getByTestId("canonical-coach-panel")).toHaveAttribute("data-view-revision", "6");
    await expect(page.getByTestId("canonical-student-workspace")).toHaveAttribute("data-session-id", "TS-4242");
    // Workspace：canvas 语义摘要 + Board 内容
    await expect(page.getByTestId("region-geometry")).toHaveAttribute("aria-label", "几何画布");
    await expect(page.locator('[data-element-id="seg-AD"]')).toBeVisible();
    await expect(page.getByTestId("region-solution-board")).toHaveAttribute("data-board-mode", "building");
    await expect(page.getByTestId("region-solution-board")).toContainText("AD/AB = DE/BC");
    // Coach：受控 mainline 状态（非通用聊天）+ focus cue + 当前话术
    await expect(page.getByTestId("coach-mainline-status")).toContainText("等待你在画布上操作");
    await expect(page.getByTestId("coach-focus-cue")).toContainText("在画布上标出你已知长度的线段");
    await expect(page.getByTestId("coach-current-turn")).toContainText("把已知长度的线段在图上标出来。");
    // 主线 participation：workspace_input 单一受控入口
    await expect(page.getByTestId("region-participation")).toHaveAttribute("data-participation-kind", "workspace_input");
    await expect(page.getByTestId("region-participation")).toHaveAttribute("data-gate-id", "GT-01");
    // Assistance 与主线 participation 是两个 channel：面板求助入口存在，
    // 但主线参与区没有任何输入框冒充主线入口
    await expect(page.getByTestId("coach-assistance")).toBeVisible();
    await expect(page.getByTestId("region-participation").locator("input")).toHaveCount(0);
    await expect(page.getByTestId("region-error")).toHaveCount(0);
  });

  test("keyboard path: replay → ask → hint → rephrase reachable by natural Tab order from body", async ({ page }) => {
    await gotoHarness(page, "coach=coach-panel-view.positive");
    // 不做任何程序化 focus：初始焦点就是 body，连续 Tab 后四个入口按
    // replay→ask→hint→rephrase 的真实 Tab 顺序可达（中间停靠点不限）
    const stops = await tabStopsFromBody(page, "coach-rephrase");
    const assistanceStops = stops.filter((id) =>
      id === "coach-replay" || id === "coach-ask" || id === "coach-hint" || id === "coach-rephrase",
    );
    expect(assistanceStops).toEqual(["coach-replay", "coach-ask", "coach-hint", "coach-rephrase"]);
    // fe-prep：无回调接线——键盘操作零副作用、不推进教学状态（ADR-010 不变量 5）
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("region-error")).toHaveCount(0);
    await expect(page.getByTestId("canonical-coach-panel")).toHaveAttribute("data-view-revision", "6");
  });

  test("truth-leak fixture is rejected at the render layer with zero payload echo", async ({ page }) => {
    await gotoHarness(page, "workspace=student-workspace-view.negative.truth-leak");
    const errorRegion = page.getByTestId("region-error");
    await expect(errorRegion).toBeVisible();
    await expect(errorRegion).toHaveAttribute("data-guard-scope", "student-workspace-view");
    await expect(errorRegion).toHaveAttribute("role", "alert");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText, "泄漏答案文本不得出现在 DOM").not.toContain("EF = 4");
    expect(page.locator("text=canonical_answer")).toHaveCount(0);
    await expect(page.getByTestId("canonical-student-workspace")).toHaveCount(0);
  });

  test("slice-revision fixture is rejected (single workspace revision only)", async ({ page }) => {
    await gotoHarness(page, "workspace=student-workspace-view.negative.slice-revision");
    await expect(page.getByTestId("region-error")).toHaveAttribute("data-guard-scope", "student-workspace-view");
    await expect(page.getByTestId("canonical-student-workspace")).toHaveCount(0);
  });

  test("untyped-mainline coach fixture is rejected (no generic chat panel)", async ({ page }) => {
    await gotoHarness(page, "coach=coach-panel-view.negative.untyped-mainline");
    await expect(page.getByTestId("region-error")).toHaveAttribute("data-guard-scope", "coach-panel-view");
    await expect(page.getByTestId("canonical-coach-panel")).toHaveCount(0);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("generic_chat");
  });

  test("paused-for-inquiry participation shows the explicit return point", async ({ page }) => {
    await gotoHarness(page, "participation=mainline-participation.positive");
    const participation = page.getByTestId("region-participation");
    await expect(participation).toHaveAttribute("data-participation-kind", "temporarily_paused_for_inquiry");
    await expect(participation).toHaveAttribute("data-return-checkpoint-id", "BT-03");
    await expect(participation).toContainText("返回主线检查点 BT-03");
  });

  test("unknown-kind participation fixture is rejected", async ({ page }) => {
    await gotoHarness(page, "participation=mainline-participation.negative.unknown-kind");
    await expect(page.getByTestId("region-error")).toHaveAttribute("data-guard-scope", "mainline-participation");
    await expect(page.getByTestId("region-participation")).toHaveCount(0);
  });
});
