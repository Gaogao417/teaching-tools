import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  ACTIVE_TASKS,
  e2eTimeout,
  expectNoTruthLeak,
  installTutorHarness,
  loadGoldenPlan,
  prepareStudent,
  progressUntilWorkspace,
  waitForTutorState,
} from "./tutorHarness";

const EVIDENCE_DIR = path.join("e2e", "tutor", "results");
const TASK = ACTIVE_TASKS.find((entry) => entry.taskId === "goldenMinhangCross2020") ?? ACTIVE_TASKS[0];

async function waitForReadyTutor(page: Page, timeout = 90_000): Promise<void> {
  await expect(page.getByTestId("page-lifecycle")).toHaveAttribute("data-lifecycle", "ready", { timeout: e2eTimeout(timeout) });
  await expect(page.locator(".tutor-learn-page[data-session-id]")).not.toHaveAttribute("data-session-id", "", { timeout: e2eTimeout(timeout) });
}

/** 一次性证据采集（golden 内容态）：第 1 小问教完 + 结论操作步提交 →
 *  讲解分支统一 View 带已披露板书行 + 只读画布（AC-01 内容面证据）。 */
test("vs01 内容态证据：披露后统一 View 板书行 + 画布", async ({ page }, testInfo) => {
  test.skip(!ACTIVE_TASKS.some((entry) => entry.taskId === "goldenMinhangCross2020"), "golden 专属（真实场景内容）");
  await prepareStudent(page);
  await installTutorHarness(page, testInfo);

  await page.goto(`/learn/${TASK.taskId}?acceptance=1`);
  await waitForReadyTutor(page);
  const plan = loadGoldenPlan(TASK.tpId);

  // 推进到结论操作步并提交正确值（第 1 小问完成 → 披露打开）。
  await progressUntilWorkspace(page, plan);
  const template = JSON.parse(plan.resources.find((entry) => entry.kind === "action_template")!.content!) as {
    teachingInput?: { expectedValues?: string[] };
  };
  const input = page.locator("input[id^='action-slot-']");
  await input.first().fill(template.teachingInput?.expectedValues?.[0] ?? "得证");
  await page.getByRole("button", { name: "确认" }).click();
  await waitForTutorState(page, "awaitingInput", 30_000).catch(() => undefined);

  // 讲解分支：统一 View 板书面有已披露行（region-solution-board 非 empty）。
  const board = page.locator("[data-testid='region-solution-board']").first();
  await expect(board).toBeVisible({ timeout: e2eTimeout(20_000) });
  await expect(board.locator(".solution-board-line").first()).toBeVisible({ timeout: e2eTimeout(20_000) });
  const rows = await board.locator(".solution-board-line").count();
  expect(rows).toBeGreaterThanOrEqual(1);

  const view = await page.evaluate(() => {
    const snapshot = (window as unknown as { __tutorWorkspaceView?: unknown }).__tutorWorkspaceView;
    return snapshot ? JSON.stringify(snapshot, null, 2) : null;
  });
  expect(view).toBeTruthy();
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "vs01-golden-board-view.json"), view!);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "vs01-golden-teach-board.png"), fullPage: true });
  await testInfo.attach("vs01-golden-board-view", { path: path.join(EVIDENCE_DIR, "vs01-golden-board-view.json"), contentType: "application/json" });
  // truth 隔离复核（内容态）。
  for (const forbidden of ["localTruth", "teachingInput", "expectedValues"]) {
    expect(view).not.toContain(`"${forbidden}"`);
  }
  expectNoTruthLeak(page);
});
