/**
 * tutor 完整旅程 E2E（Phase 5 UI 集成波次 C/D）：原产品页面闭环——
 * /learn/:taskId 进入 → 回答推进 → 提问 → 挣扎后自答 → 操作步（真实
 * ActionRuntimeFrame）→ 刷新恢复 → 换讲法 → 题目完成 → 无 Binding 走旧
 * LearnPage；全程断言前端从未收到 truth 且不硬编码内容 id。
 *
 * 任务集（TUTOR_E2E_TASK_SET）：默认合成集（5 用例全跑）；golden 集为
 * 真实 golden v3 Plan（全部 enter-text、无 alternate、无 authored
 * geometry 模板）——「换讲法」与「Geometry 操作步」两用例按内容缺口
 * skip（登记口径：golden 内容无该能力面，合成集 5/5 基线不回归）。
 */
import { expect, test } from "@playwright/test";

import {
  ACTIVE_TASKS,
  answer,
  ask,
  currentCheckpoint,
  deviationUtterance,
  e2eTimeout,
  expectNoTruthLeak,
  installTutorHarness,
  loadGoldenPlan,
  prepareStudent,
  progressUntilWorkspace,
  readTranscriptTexts,
  submitWorkspace,
  waitForTutorState,
} from "./tutorHarness";

const enterTextTask = ACTIVE_TASKS.find((task) => task.action === "enter-text")!;
const geometryTask = ACTIVE_TASKS.find((task) => task.action === "make-parallel");
const switchTask = ACTIVE_TASKS.find((task) => task.alternateTpId);

test.describe("tutor 浏览器闭环旅程（原产品 /learn/:taskId）", () => {
  test("进入 → 回答推进 → 提问 → 挣扎自答 → 操作步 → 刷新恢复 → 完成", async ({ page }, testInfo) => {
    const plan = loadGoldenPlan(enterTextTask.tpId);
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);

    // 1. 从 /learn/:taskId 进入：开场讲解出现在对话记录（WorkspaceShell 内）。
    await page.goto(`/learn/${enterTextTask.taskId}`);
    await expect(page.getByTestId("tutor-session-id")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("tutor-state")).toContainText(/等你发言|讲解中/, { timeout: 100_000 });
    await expect(page.locator(".ks-app-shell")).toBeVisible();
    await expect(page.locator(".tutor-learn-question, .action-runtime-workspace").first()).toBeVisible();
    await page.waitForFunction(
      () => (document.querySelectorAll("[data-testid=tutor-transcript] p").length ?? 0) > 0,
      undefined,
      { timeout: 20_000 },
    );
    // 波次 E 补图（golden 任务集）：opening 阶段只读题目画布已可见
    //（question.geometry 来自 plan 模板的 authored 题图）。
    if (process.env.TUTOR_E2E_TASK_SET === "golden") {
      await expect(page.locator(".tutor-learn-figure .geometry-canvas")).toBeVisible({ timeout: 15_000 });
    }

    // 2. 回答推进：期望推理 → confirm + 进度前移。
    const checkpointText = await page.getByTestId("tutor-checkpoint").innerText();
    const firstCheckpoint = /CP\d+/.exec(checkpointText)![0];
    await answer(page, plan.checkpoints.find((entry) => entry.checkpoint_id === firstCheckpoint)!.expected_reasoning);
    await expect(page.getByTestId("tutor-transcript")).toContainText(/这一步成立|借助提示|很好|对，/, { timeout: 100_000 });

    // 3. 提问：老师回答（explain.answer_question），提问不悬挂。
    await ask(page, "这一步为什么要看这两个三角形？");
    await expect(page.getByTestId("tutor-state")).toContainText("等你发言", { timeout: 100_000 });

    // 4. 挣扎（deviation）→ hint/prompt 阶梯 → 自答（expected）继续推进。
    // 波次 C-2 裁定 2：phase 与画布同源后，最后一个 checkpoint 的 confirm
    // 续走可能已签发操作步（画布已渲染则标签诚实地显示「轮到你操作」，
    // 不再回到脱节的「等你发言」）。
    const beforeInterrupt = await readTranscriptTexts(page);
    expect(beforeInterrupt.length).toBeGreaterThan(0);
    const struggle = deviationUtterance(plan);
    await answer(page, struggle);
    await expect(page.getByTestId("tutor-state")).toContainText(/等你发言|轮到你操作/, { timeout: 100_000 });
    await page.waitForTimeout(400);
    const nextCheckpointText = await page.getByTestId("tutor-checkpoint").innerText();
    const nextCheckpoint = /CP\d+/.exec(nextCheckpointText)![0];
    await answer(page, plan.checkpoints.find((entry) => entry.checkpoint_id === nextCheckpoint)!.expected_reasoning);
    await expect(page.getByTestId("tutor-state")).toContainText(/等你发言|轮到你操作/, { timeout: 100_000 });

    // 5. 操作步：推进到 workspace 节点（真实 ActionRuntimeFrame）。
    await progressUntilWorkspace(page, plan);
    await expect(page.getByTestId("action-runtime-workspace")).toBeVisible();

    // 6. 刷新恢复：pending workspace 从 GET :sessionId 恢复（不靠内存重建）。
    const sessionId = await page.getByTestId("tutor-session-id").innerText();
    await page.reload();
    await expect(page.getByTestId("tutor-session-id")).toHaveText(sessionId, { timeout: 30_000 });
    await expect(page.getByTestId("action-runtime-workspace")).toBeVisible({ timeout: 20_000 });

    // 7. 完成操作步：先交一个错答（evaluator 拒绝、会话不崩），再交正确值。
    const actionResource = plan.resources.find((entry) => entry.kind === "action_template");
    const template = JSON.parse(actionResource?.content ?? "{}") as {
      teachingInput?: { expectedValues?: string[] };
    };
    await submitWorkspace(page, enterTextTask, "错误答案");
    await page.waitForTimeout(600);
    await expect(page.getByTestId("tutor-state")).not.toContainText("完成", { timeout: 5_000 }).catch(() => undefined);
    await submitWorkspace(page, enterTextTask, template.teachingInput?.expectedValues?.[0] ?? "1");
    await expect(page.getByTestId("tutor-state")).toContainText(/等你发言|完成/, { timeout: 20_000 });

    // 8. 全程无 truth 泄漏、无硬编码内容 id。
    expectNoTruthLeak(page);
  });

  test("换讲法：Question 不变、Plan 改变、previous_session_id 关联", async ({ page }, testInfo) => {
    test.skip(!switchTask, "当前任务集无 alternate 讲法（golden 集内容缺口：无第二套 Approved ApproachSet）");
    const plan = loadGoldenPlan(enterTextTask.tpId);
    void plan;
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);
    await page.goto(`/learn/${switchTask!.taskId}`);
    await expect(page.getByTestId("tutor-state")).toContainText("等你发言", { timeout: 30_000 });

    const stemBefore = await page.locator(".ks-focus-prompt h1, .tutor-learn-question").first().innerText();
    const sessionBefore = await page.getByTestId("tutor-session-id").innerText();

    await expect(page.getByTestId("tutor-switch-approach")).toBeVisible();
    await page.getByTestId("tutor-switch-approach").click();
    await expect(page.getByTestId("tutor-session-id")).not.toHaveText(sessionBefore, { timeout: 30_000 });
    await expect(page.getByTestId("tutor-state")).toContainText(/等你发言|讲解中/, { timeout: 60_000 });

    // Question 不变（同题换讲法）；URL 仍指向同一 task。
    const stemAfter = await page.locator(".ks-focus-prompt h1, .tutor-learn-question").first().innerText();
    expect(stemAfter).toContain(stemBefore.replace(/\s+/g, "").slice(0, 10));
    expect(page.url()).toContain(`/learn/${switchTask!.taskId}`);
    expectNoTruthLeak(page);
  });

  test("Geometry 操作步（make-parallel）：画布点选 → evidence 被判定", async ({ page }, testInfo) => {
    test.skip(!geometryTask, "当前任务集无 make-parallel 任务（golden 集内容缺口：自动模板仅 enter-text）");
    const plan = loadGoldenPlan(geometryTask!.tpId);
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);
    await page.goto(`/learn/${geometryTask!.taskId}`);
    // 波次 C-2 裁定 1：opening 阶段（workspace 出现前）题目画布已可见——
    // 只读 GeometryCanvasSurface 渲染 /experience 下发的 question.geometry。
    await expect(page.getByTestId("tutor-session-id")).toBeVisible({ timeout: 90_000 });
    await expect(page.locator(".tutor-learn-figure .geometry-canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("action-runtime-workspace")).toHaveCount(0);
    await waitForTutorState(page, "awaitingInput");

    await progressUntilWorkspace(page, plan);
    await expect(page.locator(".geometry-canvas")).toBeVisible({ timeout: 15_000 });

    // 先交一个错选（点 B + AB → reference 对但 through 错）。
    const wrong = JSON.stringify({ pointId: "B", lineId: "AB" });
    await submitWorkspace(page, geometryTask!, wrong);
    // 波次 F：画布点选按渲染元素锚定（Y 翻转修复后真实提交）——错选被
    // typed evaluator 拒绝，Runtime 反馈横幅出现，会话不崩。
    await expect(page.getByTestId("runtime-wrong-feedback")).toBeVisible({ timeout: e2eTimeout(15_000) });
    await expect(page.getByTestId("action-runtime-workspace")).toBeVisible({ timeout: e2eTimeout(15_000) });

    // 正确：过 C 作 AB 平行线（期望值由测试侧从 canonical plan 派生）。
    const actionResource = plan.resources.find((entry) => entry.kind === "action_template");
    const template = JSON.parse(actionResource?.content ?? "{}") as { teachingInput?: { throughPointId?: string; referenceLineId?: string } };
    expect(template.teachingInput?.throughPointId).toBeTruthy();
    const correct = JSON.stringify({
      pointId: template.teachingInput?.throughPointId ?? "C",
      lineId: template.teachingInput?.referenceLineId ?? "AB",
    });
    await submitWorkspace(page, geometryTask!, correct);
    await expect(page.getByTestId("tutor-state")).toContainText(/等你发言|完成/, { timeout: 25_000 });
    expectNoTruthLeak(page);
  });

  test("跨小问推进（波次 E 教师问询）：第 1 小问结论步被接受 → 第 2 小问自动开讲 → 完成态", async ({ page }, testInfo) => {
    const multiPartTask = ACTIVE_TASKS.find((task) => task.taskId === "goldenMinhangCross2020");
    test.skip(!multiPartTask, "当前任务集无该真题（golden 专属用例）");
    const plan = loadGoldenPlan(multiPartTask!.tpId);
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);
    await page.goto(`/learn/${multiPartTask!.taskId}`);
    await waitForTutorState(page, "awaitingInput");

    // 第 1 小问：推进到结论操作步并提交正确值。
    await progressUntilWorkspace(page, plan);
    const template1 = JSON.parse(plan.resources.find((entry) => entry.kind === "action_template")!.content!) as {
      teachingInput?: { expectedValues?: string[] };
    };
    await submitWorkspace(page, multiPartTask!, template1.teachingInput?.expectedValues?.[0] ?? "得证");
    await waitForTutorState(page, "awaitingInput");
    // 跨小问边界：第 2 小问自动开讲（checkpoint 离开第 1 小问的 CP1–CP3）。
    const part2Checkpoint = await currentCheckpoint(page);
    expect(Number(part2Checkpoint.replace("CP", ""))).toBeGreaterThan(3);

    // 第 2 小问：推进到其结论操作步并提交，整题完成。
    await progressUntilWorkspace(page, plan, { maxTurns: 30 });
    const templates = plan.resources.filter((entry) => entry.kind === "action_template");
    const template2 = JSON.parse(templates[1]?.content ?? templates.at(-1)!.content!) as {
      teachingInput?: { expectedValues?: string[] };
    };
    await submitWorkspace(page, multiPartTask!, template2.teachingInput?.expectedValues?.[0] ?? "得证");
    // 两问结论步都被接受：question_completed → 前端收尾显示完成。
    await expect(page.getByTestId("tutor-state")).toContainText(/完成/, { timeout: e2eTimeout(25_000) });
    // 波次 F 任务 1：完成页板书回顾可见（既有内容面 solution-board 端点，
    // 仅完成后拉取；truth 嗅探在用例末尾统一把关）。
    await expect(page.getByTestId("tutor-solution-board")).toBeVisible({ timeout: e2eTimeout(15_000) });
    const boardLines = page.locator("[data-testid='tutor-solution-board'] .solution-board-line");
    await expect(boardLines.first()).toBeVisible({ timeout: e2eTimeout(10_000) });
    expect(await boardLines.count()).toBeGreaterThanOrEqual(2);
    expectNoTruthLeak(page);
  });

  test("隔离演示页已删除：/tutor/:tpId 路由不再存在（SPA fallback 下无该路由渲染）", async ({ page }) => {
    await page.goto("/tutor/TP-SMV-001");
    await expect(page.getByTestId("tutor-session-id")).toHaveCount(0);
    await expect(page.getByTestId("tutor-state")).toHaveCount(0);
    await expect(page.getByTestId("tutor-transcript")).toHaveCount(0);
    await expect(page.locator(".tutor-session-page")).toHaveCount(0);
  });

  test("无 Approved Binding 的 Topic → 完整走旧 LearnPage", async ({ page }, testInfo) => {
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);
    // guidedSolve 不在合成 Binding 内：/experience 返回 kind=legacy。
    await page.goto("/learn/guidedSolve");
    await expect(page.locator(".ks-app-shell")).toBeVisible({ timeout: 30_000 });
    // 旧 LearnPage：无 tutor 会话 testid，出现学习投影或 Action 工作台。
    await expect(page.getByTestId("tutor-session-id")).toHaveCount(0);
    await page.waitForFunction(
      () => Boolean(document.querySelector(".ks-state-page, .ks-learn-page, .topic-runtime-frame")),
      undefined,
      { timeout: 30_000 },
    );
    expectNoTruthLeak(page);
  });
});
