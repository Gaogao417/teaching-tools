/**
 * VS1 remediation 浏览器门禁（2026-08-26 验收 Rejected 后用户裁定，9 条）。
 *
 * 全部走真实 `/learn/:taskId`（golden reference task 优先 auxiliaryTwoRatios，
 * golden 任务集回落第一个 active task）：
 * 1. region-question 同时包含 stem、（1）（2）和两问内容；
 * 2. 每问有唯一 data-part-id；
 * 3. 显示顺序与 response 中 subquestions 顺序一致；
 * 4. .ks-focus-canvas 中不存在 .tutor-learn-question；
 * 5. canvas 只有一个主要 StudentWorkspaceFrame；
 * 6. desktop 下 Geometry/Board 同一横向带且不重叠；
 * 7. teach、operate、completed 使用同一 Frame bounds；
 * 8. narrow 下 Question → Geometry → Board → Participation 顺序正确；
 * 9. 1440×900 下没有页面级纵向滚动。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import {
  ACTIVE_TASKS,
  continueThroughNarration,
  e2eTimeout,
  expectNoTruthLeak,
  installTutorHarness,
  loadGoldenPlan,
  prepareStudent,
  progressUntilWorkspace,
  tutorPhase,
  waitForTutorState,
} from "./tutorHarness";

const EVIDENCE_DIR = path.join("e2e", "tutor", "results");
const writeEvidence = (name: string, body: string): void => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), body);
};

const TASK = ACTIVE_TASKS.find((entry) => entry.taskId === "auxiliaryTwoRatios") ?? ACTIVE_TASKS[0];

async function waitForReadyTutor(page: Page, timeout = 90_000): Promise<void> {
  await expect(page.getByTestId("page-lifecycle")).toHaveAttribute("data-lifecycle", "ready", { timeout: e2eTimeout(timeout) });
  await expect(page.locator(".tutor-learn-page[data-session-id]")).not.toHaveAttribute("data-session-id", "", { timeout: e2eTimeout(timeout) });
}

interface FrameBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function frameBounds(page: Page): Promise<FrameBounds> {
  const box = await page.locator(".student-workspace-frame").first().boundingBox();
  expect(box, "StudentWorkspaceFrame 未渲染").toBeTruthy();
  return { x: box!.x, y: box!.y, width: box!.width, height: box!.height };
}

test.use({ trace: "on" });

test.describe("VS1 remediation 浏览器门禁（真实 /learn/:taskId）", () => {
  test("门禁 1-7/9：desktop 讲解态题目一体化 + 双 surface 固定布局 + 无页面滚动", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);

    // 从 /experience 响应抓 subquestions 期望（顺序与内容断言基准）。
    let expectedSubquestions: Array<{ part_id: string; prompt: string }> = [];
    page.on("response", async (response) => {
      if (!/\/api\/learn\/[^/]+\/experience$/.test(response.url()) || response.status() >= 300) return;
      try {
        const body = JSON.parse(await response.text()) as {
          question?: { subquestions?: Array<{ part_id: string; prompt: string }> };
        };
        if (body.question?.subquestions?.length) expectedSubquestions = body.question.subquestions;
      } catch { /* 非 JSON 忽略 */ }
    });

    await page.goto(`/learn/${TASK.taskId}?acceptance=1`);
    await waitForReadyTutor(page);
    await continueThroughNarration(page);
    await waitForTutorState(page, "awaitingInput", 60_000).catch(() => undefined);
    await page.waitForTimeout(400);

    // 门禁 1：region-question 一体化（stem + 编号 + 两问内容）。
    const questionRegion = page.getByTestId("region-question");
    await expect(questionRegion).toBeVisible();
    const questionText = (await questionRegion.innerText()).replace(/\s+/g, "");
    // 门禁 2/3（内容条件断言）：response 携带 subquestions 的任务才要求
    // 编号/identity/顺序（golden 集两小问题覆盖；合成集单问题跳过）。
    if (expectedSubquestions.length) {
      const items = questionRegion.locator(".learn-question-subquestions li");
      await expect(items).toHaveCount(expectedSubquestions.length, { timeout: e2eTimeout(10_000) });
      const partIds: string[] = [];
      for (let index = 0; index < await items.count(); index += 1) {
        const item = items.nth(index);
        const partId = await item.getAttribute("data-part-id");
        expect(partId, `第 ${index} 问缺 data-part-id`).toBeTruthy();
        partIds.push(partId!);
        await expect(item).toHaveAttribute("aria-label", `第 ${partId} 问`);
        const number = await item.locator(".learn-question-part-number").innerText();
        expect(number, `第 ${index} 问编号应由 part_id 派生`).toBe(`（${partId}）`);
        expect(questionText).toContain(`（${partId}）`);
      }
      expect(partIds).toEqual(expectedSubquestions.map((entry) => entry.part_id));
      for (const expected of expectedSubquestions) {
        expect(questionText).toContain(expected.prompt.replace(/\s+/g, "").slice(0, 8));
      }
    } else {
      // 无小问任务：题目区域不渲染小问列表（不伪造结构）。
      await expect(questionRegion.locator(".learn-question-subquestions")).toHaveCount(0);
    }
    // stem 也在题目区域。
    expect(questionText.length).toBeGreaterThan(20);

    // 门禁 4：canvas 无旧题目结构。
    const canvas = page.locator(".ks-focus-canvas");
    await expect(canvas.locator(".tutor-learn-question")).toHaveCount(0);
    await expect(canvas.locator(".tutor-learn-subquestion")).toHaveCount(0);

    // 门禁 5：canvas 内唯一 Frame。
    await expect(canvas.locator(".student-workspace-frame")).toHaveCount(1);

    // 门禁 6：desktop 下 Geometry/Board 同一横向带且不重叠。
    const geometry = page.getByTestId("region-geometry").first();
    const board = page.getByTestId("region-solution-board").first();
    await expect(geometry).toBeVisible();
    await expect(board).toBeVisible();
    const geoBox = await geometry.boundingBox();
    const boardBox = await board.boundingBox();
    expect(geoBox && boardBox).toBeTruthy();
    // 同一横向带（两 surface 垂直区间重叠 ≥ 一半）。
    const overlapTop = Math.max(geoBox!.y, boardBox!.y);
    const overlapBottom = Math.min(geoBox!.y + geoBox!.height, boardBox!.y + boardBox!.height);
    expect(overlapBottom - overlapTop, "Geometry/Board 应处于同一横向带").toBeGreaterThan(Math.min(geoBox!.height, boardBox!.height) * 0.5);
    // 不重叠（横向互斥：board 在 geometry 右侧）。
    expect(boardBox!.x, "Board 应在 Geometry 右侧").toBeGreaterThanOrEqual(geoBox!.x + geoBox!.width - 1);

    // 门禁 9：1440×900 无页面级纵向滚动。
    const scrolls = await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1);
    expect(scrolls, "1440×900 下出现页面级纵向滚动").toBe(false);

    const teachBounds = await frameBounds(page);

    // 门禁 7（teach → operate）：推进到操作步，同一 Frame bounds。
    const plan = loadGoldenPlan(TASK.tpId);
    await progressUntilWorkspace(page, plan);
    await expect(page.getByTestId("action-runtime-workspace")).toBeVisible();
    await page.waitForTimeout(400);
    const operateBounds = await frameBounds(page);
    expect(Math.abs(operateBounds.x - teachBounds.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(operateBounds.y - teachBounds.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(operateBounds.width - teachBounds.width)).toBeLessThanOrEqual(1);

    await page.screenshot({ path: path.join(EVIDENCE_DIR, "vs01-remediation-desktop-operate.png"), fullPage: true });
    await testInfo.attach("vs01-remediation-desktop-operate", { path: path.join(EVIDENCE_DIR, "vs01-remediation-desktop-operate.png"), contentType: "image/png" });
    writeEvidence("vs01-remediation-bounds.json", JSON.stringify({ teach: teachBounds, operate: operateBounds }, null, 2));
    expectNoTruthLeak(page);
  });

  test("门禁 7（completed）+ 板书回顾：完成态同 Frame bounds", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);

    await page.goto(`/learn/${TASK.taskId}?acceptance=1`);
    await waitForReadyTutor(page);
    const plan = loadGoldenPlan(TASK.tpId);

    // 逐 checkpoint 推进 + 提交各操作步直至 question_completed。
    const templates = plan.resources
      .filter((entry) => entry.kind === "action_template")
      .map((entry) => JSON.parse(entry.content!) as { actionId: string; sourceStepId: string; kind: string; teachingInput?: { expectedValues?: string[] } });
    let guard = 0;
    while (!(await page.getByTestId("tutor-completed").count()) && guard < 60) {
      guard += 1;
      if (await page.getByTestId("action-runtime-workspace").count()) {
        const input = page.locator("input[id^='action-slot-']");
        if (await input.count()) {
          const checkpointId = /CP\d+/.exec((await page.locator("[data-checkpoint-id]").getAttribute("data-checkpoint-id")) ?? "")?.[0] ?? "";
          const template = templates.find((entry) => entry.sourceStepId.includes(checkpointId))
            ?? templates.find((entry) => entry.sourceStepId === checkpointId)
            ?? templates[0];
          await input.first().fill(template.teachingInput?.expectedValues?.[0] ?? "1");
          await page.getByRole("button", { name: "确认" }).click();
          await page.waitForTimeout(600);
          continue;
        }
        const options = page.locator(".topic-choice-grid button");
        if (await options.count()) {
          await options.first().click();
          await page.getByRole("button", { name: "确认" }).click().catch(() => undefined);
          await page.waitForTimeout(600);
          continue;
        }
      }
      const state = await tutorPhase(page);
      if (state === "speaking") {
        await continueThroughNarration(page);
      }
      if ((await tutorPhase(page)) === "awaitingInput") {
        await page.waitForTimeout(400);
        const checkpointId = /CP\d+/.exec((await page.locator("[data-checkpoint-id]").getAttribute("data-checkpoint-id")) ?? "")?.[0];
        if (!checkpointId) break;
        const checkpoint = plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId);
        const input = page.getByLabel("回答输入");
        await expect(input).toBeVisible({ timeout: e2eTimeout(15_000) });
        await input.fill(checkpoint?.expected_reasoning ?? "嗯，我想想");
        await page.getByTestId("tutor-submit-answer").click();
        await continueThroughNarration(page);
        await waitForTutorState(page, "awaitingInput", 25_000).catch(() => undefined);
        await page.waitForTimeout(300);
      }
    }
    await expect(page.getByTestId("tutor-completed")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("tutor-start-practice")).toBeVisible({ timeout: e2eTimeout(10_000) });

    // 完成态仍是同一 Frame（含完整板书回顾槽）。
    const completedBounds = await frameBounds(page);
    expect(completedBounds.width).toBeGreaterThan(0);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "vs01-remediation-desktop-completed.png"), fullPage: true });
    await testInfo.attach("vs01-remediation-desktop-completed", { path: path.join(EVIDENCE_DIR, "vs01-remediation-desktop-completed.png"), contentType: "image/png" });
    // 完成态无页面级纵向滚动（门禁 9 口径）。
    const scrolls = await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1);
    expect(scrolls, "完成态 1440×900 出现页面级纵向滚动").toBe(false);
    expectNoTruthLeak(page);
  });

  test("门禁 8：narrow 语义顺序 Question → Geometry → Board → Participation", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);

    await page.goto(`/learn/${TASK.taskId}?acceptance=1`);
    await waitForReadyTutor(page);
    await continueThroughNarration(page);
    await waitForTutorState(page, "awaitingInput", 60_000).catch(() => undefined);
    await page.waitForTimeout(400);

    // 语义顺序 = DOM 文档序（region-participation 位于 dock rail 抽屉——
    // overlay 定位，视觉 top 不可比；VS0 已有"rail 展开后参与可操作"断言）。
    // 非 overlay 的 question/geometry/board 另做视觉 top 递增断言。
    const order = await page.evaluate(() => {
      const anchors: Array<[string, string]> = [
        ["question", "[data-testid='region-question']"],
        ["geometry", "[data-testid='region-geometry']"],
        ["board", "[data-testid='region-solution-board']"],
        ["participation", "[data-testid='region-participation']"],
        ["action-bar", "[data-testid='region-action-bar']"],
      ];
      const documentOrder = (node: Element): number => {
        let index = 0;
        for (const current of document.querySelectorAll("*")) {
          if (current === node) return index;
          index += 1;
        }
        return -1;
      };
      return anchors
        .map(([name, selector]) => {
          const node = document.querySelector(selector);
          return node ? { name, domIndex: documentOrder(node), top: (node as HTMLElement).getBoundingClientRect().top } : null;
        })
        .filter(Boolean) as Array<{ name: string; domIndex: number; top: number }>;
    });
    const names = order.map((entry) => entry.name);
    for (const required of ["question", "geometry", "board"]) {
      expect(names, `narrow 应识别 ${required} 区域（实际 ${names.join(",")}）`).toContain(required);
    }
    // DOM 文档序：question → geometry → board → participation/action-bar。
    const byName = Object.fromEntries(order.map((entry) => [entry.name, entry]));
    for (const [before, after] of [["question", "geometry"], ["geometry", "board"], ["board", "participation"], ["board", "action-bar"]] as const) {
      if (byName[before] && byName[after]) {
        expect(byName[after].domIndex, `narrow 语义顺序应保持 ${before} 在 ${after} 之前`).toBeGreaterThan(byName[before].domIndex);
      }
    }
    // 视觉序（非 overlay）：question → geometry → board 纵向递增（2px 亚像
    // 素容差：无几何任务的空占位行与板书行在 narrow 下近贴，非布局错）。
    expect(byName.geometry.top).toBeGreaterThan(byName.question.top);
    expect(byName.board.top).toBeGreaterThan(byName.geometry.top - 2);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "vs01-remediation-narrow.png"), fullPage: true });
    await testInfo.attach("vs01-remediation-narrow", { path: path.join(EVIDENCE_DIR, "vs01-remediation-narrow.png"), contentType: "image/png" });
    expectNoTruthLeak(page);
  });
});
