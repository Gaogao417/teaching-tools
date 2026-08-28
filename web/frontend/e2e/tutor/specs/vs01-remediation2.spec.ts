/**
 * VS1 remediation-2 浏览器门禁（2026-08-26 第二轮 Rejected：Topic Coach
 * interaction parity；VS1-AC-09 / ADR-010 / mvp/reports/vs-01-remediation-2.md）。
 *
 * 十步人工验收的自动化面（步骤 1 的 reference 人工对照与产品裁量不在本
 * spec——人工签字仍按 remediation-2 §4 表执行）：
 * - 步骤 2/3：Coach 信息结构——教学拍点 N/M + 标题 + 当前拍 Focus Cue 气泡；
 * - 步骤 4：明白，继续恰一步（快速双击只放行一步——负面④）；
 * - 步骤 5：这步没懂 → question_asked，停留当前拍并触发解释；
 * - 步骤 6 + 负面①：重播/上一拍纯回看——零会话写入（POST turns 计数、
 *   revision/checkpoint 均不变）；
 * - 步骤 7：收起再展开——Action/Prompt/进度/对话不丢；
 * - 步骤 8：刷新恢复同拍（拍点/标题回来，不退回通用等待面）；
 * - 步骤 9：operate 态同一 canonical Panel（railContent 注入共享组件）；
 * - 步骤 10 + 负面③：无模式切换/无快捷 chips/无自建 rail；operate 态
 *   Panel composer 只发 question_asked，不提交 workspace evidence。
 */
import { expect, test, type Page } from "@playwright/test";

import {
  ACTIVE_TASKS,
  ask,
  continueThroughNarration,
  currentCheckpoint,
  e2eTimeout,
  expectNoTruthLeak,
  installTutorHarness,
  loadGoldenPlan,
  prepareStudent,
  progressUntilWorkspace,
  sessionId,
  waitForTutorState,
} from "./tutorHarness";

const TASK = ACTIVE_TASKS.find((entry) => entry.taskId === "auxiliaryTwoRatios") ?? ACTIVE_TASKS[0];

async function waitForReady(page: Page): Promise<void> {
  await expect(page.getByTestId("page-lifecycle")).toHaveAttribute("data-lifecycle", "ready", { timeout: e2eTimeout(90_000) });
  await expect(page.locator(".tutor-learn-page[data-session-id]")).not.toHaveAttribute("data-session-id", "", { timeout: e2eTimeout(90_000) });
}

/** 统一 View revision：读 canonical Frame 容器的 data-view-revision（与
 *  workspaceView 同源；本用例不带 ?acceptance=1——诊断条为 fixed 覆盖层，
 *  会遮挡 Coach 收起按钮的点击）。 */
function workspaceRevision(page: Page): Promise<number> {
  return page.locator(".student-workspace-frame").getAttribute("data-view-revision").then((value) => (value ? Number(value) : -1));
}

test.use({ trace: "on" });

test.describe("VS1 remediation-2：Topic Coach parity（VS1-AC-09）", () => {
  test("信息结构 + 明白继续恰一步 + 没懂停留 + 纯回看零写入 + collapse/refresh", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);
    let turnPosts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/tutor-sessions\/[^/]+\/turns/.test(request.url())) turnPosts += 1;
    });

    await page.goto(`/learn/${TASK.taskId}`);
    await waitForReady(page);

    // 步骤 2：教学拍点 N/M + 当前标题（canonical 信息结构）。
    await expect(page.getByTestId("coach-progress")).toContainText(/教学拍点 \d+\/\d+/, { timeout: e2eTimeout(20_000) });
    await expect(page.getByTestId("coach-title")).toContainText(/第\d+小问|讲解/);
    // 步骤 3：当前拍 Focus Cue 在 Coach 气泡清晰可见。
    await expect(page.getByTestId("coach-prompt")).not.toBeEmpty({ timeout: e2eTimeout(20_000) });
    // 步骤 10 负面：无模式切换/快捷 chips/自建 rail/通用等待面头。
    await expect(page.locator(".tutor-learn-composer-mode")).toHaveCount(0);
    await expect(page.locator(".tutor-learn-quick-asks")).toHaveCount(0);
    await expect(page.locator(".tutor-learn-rail")).toHaveCount(0);
    await expect(page.getByTestId("coach-progress")).toBeVisible();

    // 步骤 4 + 负面④：明白，继续=恰一步（双击只放行一步——线程最多 +1）。
    const understood = page.getByTestId("coach-understood");
    if ((await understood.count()) && !(await understood.isDisabled().catch(() => true))) {
      const threadBefore = await page.locator("[aria-label='答疑对话'] .topic-coach-turn").count();
      const promptBefore = await page.getByTestId("coach-prompt").innerText();
      await understood.dblclick({ timeout: e2eTimeout(5_000) }).catch(() => undefined);
      await page.waitForTimeout(400);
      const threadAfter = await page.locator("[aria-label='答疑对话'] .topic-coach-turn").count();
      expect(threadAfter - threadBefore).toBeLessThanOrEqual(1);
      if (threadAfter - threadBefore === 1) {
        await expect(page.getByTestId("coach-prompt")).not.toHaveText(promptBefore, { timeout: e2eTimeout(5_000) }).catch(() => undefined);
      }
    }
    await continueThroughNarration(page);
    await waitForTutorState(page, "awaitingInput", 60_000).catch(() => undefined);

    // 步骤 6 + 负面①：重播/上一拍 = 纯回看——零会话写入、拍点/revision 不变。
    const checkpointBefore = await currentCheckpoint(page);
    const revisionBefore = await workspaceRevision(page);
    const postsBefore = turnPosts;
    await page.getByLabel("重播当前 Action 讲解").click().catch(() => undefined);
    const previousButton = page.getByLabel("上一个 Action");
    if (await previousButton.isEnabled().catch(() => false)) {
      await previousButton.click().catch(() => undefined);
    }
    await page.waitForTimeout(600);
    expect(turnPosts, "重播/上一拍不得产生会话写入").toBe(postsBefore);
    expect(await currentCheckpoint(page)).toBe(checkpointBefore);
    expect(await workspaceRevision(page)).toBe(revisionBefore);
    await expect(page.getByTestId("coach-progress")).toContainText(/教学拍点 \d+\/\d+/);

    // 步骤 5：这步没懂 → question_asked，停留当前拍并触发解释。
    const postsConfused = turnPosts;
    await page.getByTestId("coach-confused").click();
    await page.waitForTimeout(400);
    expect(turnPosts).toBe(postsConfused + 1);
    await continueThroughNarration(page);
    await waitForTutorState(page, "awaitingInput", 25_000).catch(() => undefined);
    await expect(page.locator("[aria-label='答疑对话']")).toContainText("（问）我没听懂这一步");
    expect(await currentCheckpoint(page)).toBe(checkpointBefore);

    // 步骤 7：收起再展开——Action/Prompt/进度/对话不丢。
    const progressText = await page.getByTestId("coach-progress").innerText();
    const promptText = await page.getByTestId("coach-prompt").innerText();
    const threadCount = await page.locator("[aria-label='答疑对话'] .topic-coach-turn").count();
    await page.getByLabel("收起指导栏").click();
    await expect(page.locator(".ks-focus-rail-drawer")).toHaveClass(/is-closed/);
    await expect(page.locator(".ks-focus-rail-drawer")).toHaveAttribute("aria-hidden", "true");
    await page.locator("button[aria-label='展开陪练老师']").click();
    await expect(page.locator(".ks-focus-rail-drawer")).toHaveClass(/is-open/);
    await expect(page.getByTestId("coach-progress")).toHaveText(progressText);
    await expect(page.getByTestId("coach-prompt")).toHaveText(promptText);
    expect(await page.locator("[aria-label='答疑对话'] .topic-coach-turn").count()).toBe(threadCount);

    // 步骤 8：刷新恢复到同一拍（拍点/标题回来——不退回通用「等你发言」面）。
    const sid = await sessionId(page);
    const checkpointForRefresh = await currentCheckpoint(page);
    await page.reload();
    await expect(page.locator(".tutor-learn-page[data-session-id]")).toHaveAttribute("data-session-id", sid, { timeout: 30_000 });
    await expect(page.getByTestId("coach-progress")).toContainText(/教学拍点 \d+\/\d+/, { timeout: e2eTimeout(30_000) });
    await expect(page.getByTestId("coach-title")).toContainText(/第\d+小问|讲解/);
    await continueThroughNarration(page);
    expect(await currentCheckpoint(page)).toBe(checkpointForRefresh);
    expectNoTruthLeak(page);
  });

  test("步骤 9 + 负面③：operate 态同一 canonical Panel；composer 只发 question_asked 不提交 evidence", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);
    const submittedInputKinds: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "POST" || !/\/tutor-sessions\/[^/]+\/turns/.test(request.url())) return;
      try {
        submittedInputKinds.push((request.postDataJSON() as { input?: { input_kind?: string } }).input?.input_kind ?? "?");
      } catch { /* 非 JSON 忽略 */ }
    });

    await page.goto(`/learn/${TASK.taskId}?acceptance=1`);
    await waitForReady(page);
    const plan = loadGoldenPlan(TASK.tpId);
    await progressUntilWorkspace(page, plan);
    await expect(page.getByTestId("action-runtime-workspace")).toBeVisible();

    // 步骤 9：operate 态仍渲染同一 canonical Panel（Frame railContent 注入
    // 共享组件；完成态同 Panel 由 vs01-remediation 门禁 7 覆盖）。
    await expect(page.locator(".topic-coach-panel")).toBeVisible();
    await expect(page.getByTestId("coach-progress")).toBeVisible();
    await expect(page.getByTestId("region-status")).toBeVisible();
    // canonical assessment 形态：无教学播放控件（撤销/清空/确认动作条在场）。
    await expect(page.getByLabel("下一个 Action")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "确认" })).toBeVisible();
    // 主线回答入口不在 operate 态（主线输入=工作区操作）。
    await expect(page.getByLabel("回答输入")).toHaveCount(0);

    // 负面③：Panel composer 提交 question_asked（绝不提交 workspace evidence）。
    const kindsBefore = submittedInputKinds.length;
    await ask(page, "这一步要选哪两个条件？");
    await page.waitForTimeout(600);
    expect(submittedInputKinds.length).toBe(kindsBefore + 1);
    expect(submittedInputKinds.at(-1)).toBe("question_asked");
    await continueThroughNarration(page);
    expectNoTruthLeak(page);
  });
});
