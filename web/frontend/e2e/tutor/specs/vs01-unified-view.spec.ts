/**
 * VS1 统一 Workspace View E2E（mvp/vs-01-unified-workspace-view.md）。
 *
 * 全部用例走真实 `/learn/:taskId`（golden reference task 优先
 * auxiliaryTwoRatios；golden 任务集运行时回落第一个 active task）：
 *
 * - AC-01/03：讲解与操作两分支 Geometry/Board 双 surface 同 revision
 *   （data-view-revision == diagnostics workspaceRevision == 会话 revision）；
 * - AC-02/04/06（REQ-06）：刷新前后统一 View 深比较一致（?session= 恢复，
 *   GET session view 同一构建入口）；
 * - AC-06（REQ-07）：View snapshot 与 response 无 truth 键/hidden 行；
 * - AC-07（REQ-08）：session view 剥掉 workspace_view（schema 非法）→
 *   recoverable error，不静默重开新会话、不回旧渲染链；
 * - AC-08（REQ-04）：冻结的 legacy 字段仍在 response（L-04 冻结证据），
 *   但页面只从统一 View 渲染（consumer scan 见证据包）。
 */
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
const writeEvidence = (name: string, body: string): void => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), body);
};

/** ADR-009 golden reference task；golden 任务集运行时无该 task 则回落。 */
const TASK = ACTIVE_TASKS.find((entry) => entry.taskId === "auxiliaryTwoRatios") ?? ACTIVE_TASKS[0];

const diagnostics = (page: Page) => page.getByTestId("acceptance-diagnostics");

async function waitForReadyTutor(page: Page, timeout = 90_000): Promise<void> {
  await expect(page.getByTestId("page-lifecycle")).toHaveAttribute("data-lifecycle", "ready", { timeout: e2eTimeout(timeout) });
  await expect(page.locator(".tutor-learn-page[data-session-id]")).not.toHaveAttribute("data-session-id", "", { timeout: e2eTimeout(timeout) });
}

/** 读取 window.__tutorWorkspaceView（?acceptance=1 暴露的统一 View 快照）。 */
function readTutorWorkspaceView(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const view = (window as unknown as { __tutorWorkspaceView?: unknown }).__tutorWorkspaceView;
    return view ? JSON.stringify(view) : null;
  });
}

/** 等待统一 View 静息：revision 连续两次采样不变且页面不在瞬态标签
 *  （voice 完成链的续走回合会推进 revision——深比较必须在两侧同一
 *  稳定态上采样）。 */
async function waitForSettledView(page: Page, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  let stable = 0;
  while (Date.now() < deadline) {
    const state = (await page.locator("[data-tutor-phase]").getAttribute("data-tutor-phase").catch(() => "")) ?? "";
    const view = await readTutorWorkspaceView(page);
    if (view && view === last && !/speaking|thinking|starting/.test(state)) {
      stable += 1;
      if (stable >= 2) return view;
    } else {
      stable = 0;
    }
    last = view ?? "";
    await page.waitForTimeout(700);
  }
  throw new Error(`统一 View 未在 ${timeoutMs}ms 内静息（最后快照：${last.slice(0, 120)}）`);
}

/** 统一 View 的 truth/hidden 断言（REQ-07/AC-06）。 */
function expectViewStudentSafe(viewJson: string): void {
  for (const forbidden of ["localTruth", "teachingInput", "expectedValues", '"phase":"hidden"', "phase\": \"hidden"]) {
    expect(viewJson, `统一 View 含禁止内容 ${forbidden}`).not.toContain(forbidden);
  }
}

test.use({ trace: "on" });

test.describe("VS1 统一 Workspace View（真实 /learn/:taskId）", () => {
  test("AC-01/03/06：讲解与操作分支双 surface 同 revision + 证据采集 + truth 隔离", async ({ page }, testInfo) => {
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);

    /** AC-08 冻结证据：响应同时含 legacy 字段与统一 View（L-04 冻结不删除）。 */
    let sawFrozenLegacyField = false;
    let sawUnifiedField = false;
    page.on("response", async (response) => {
      if (!/\/api\/(learn|tutor-sessions)/.test(response.url())) return;
      try {
        const body = await response.text();
        if (body.includes("\"pending_workspace\"") || /"workspace":\s*\[/.test(body)) sawFrozenLegacyField = true;
        if (body.includes("\"workspace_view\"")) sawUnifiedField = true;
      } catch { /* 非 JSON 忽略 */ }
    });

    // 1. 讲解分支：双 surface 存在（Board 是明确 empty surface 或已披露内容），
    //    revision 三方一致（板书面 data-view-revision == diagnostics）。
    await page.goto(`/learn/${TASK.taskId}?acceptance=1`);
    await waitForReadyTutor(page);
    await expect(diagnostics(page)).toHaveAttribute("data-route", "tutor-vnext");
    // 静息后比对（开场 voice 链的续走回合会推进 revision——三方一致性断言
    // 必须在同一稳定态上读取）。
    await waitForTutorState(page, "awaitingInput", 60_000).catch(() => undefined);
    await page.waitForTimeout(400);
    const sessionRevision = await diagnostics(page).getAttribute("data-view-revision");
    // VS1 remediation：revision 锚点在 canonical StudentWorkspaceFrame 容器
    //（Geometry/Board 两 surface 的共同父）。
    const teachFrame = page.locator(".student-workspace-frame").first();
    await expect(teachFrame).toBeVisible({ timeout: e2eTimeout(20_000) });
    const teachFrameRevision = await teachFrame.getAttribute("data-view-revision");
    expect(teachFrameRevision, "讲解分支 Frame 与统一 View revision 一致").toBe(sessionRevision);

    const openingView = await readTutorWorkspaceView(page);
    expect(openingView, "统一 View 快照未暴露（?acceptance=1）").toBeTruthy();
    expectViewStudentSafe(openingView!);
    const opening = JSON.parse(openingView!) as { revision: number; sessionId: string };
    expect(opening.revision.toString()).toBe(sessionRevision);
    expect(opening.sessionId).toBe(await page.locator(".tutor-learn-page[data-session-id]").getAttribute("data-session-id"));

    // 2. 推进到操作步：操作分支双 surface 同 revision（板书不因操作回合消失）。
    const plan = loadGoldenPlan(TASK.tpId);
    await progressUntilWorkspace(page, plan);
    await expect(page.getByTestId("action-runtime-workspace")).toBeVisible();
    await expect(page.getByTestId("region-geometry")).toBeVisible();
    await expect(page.locator("[data-testid='region-solution-board']").first()).toBeVisible();
    const workspaceZoneRevision = await page.getByTestId("action-runtime-workspace").getAttribute("data-view-revision");
    const operateDiagnosticsRevision = await diagnostics(page).getAttribute("data-view-revision");
    expect(workspaceZoneRevision, "操作分支 Frame revision 与 diagnostics 一致").toBe(operateDiagnosticsRevision);

    const operateView = await readTutorWorkspaceView(page);
    expect(operateView).toBeTruthy();
    expectViewStudentSafe(operateView!);
    const operate = JSON.parse(operateView!) as { revision: number; participation: { mode: string; activeAction?: unknown } };
    expect(operate.revision.toString()).toBe(operateDiagnosticsRevision);
    expect(operate.participation.mode).toBe("operate");
    expect(operate.participation.activeAction).toBeTruthy();

    // 3. desktop screenshot + a11y snapshot + View snapshot 落盘（证据）。
    await page.screenshot({ path: "e2e/tutor/results/vs01-desktop-operate.png", fullPage: true });
    await testInfo.attach("vs01-desktop-screenshot", { path: "e2e/tutor/results/vs01-desktop-operate.png", contentType: "image/png" });
    writeEvidence("vs01-workspace-view.json", operateView!);
    await testInfo.attach("vs01-workspace-view-snapshot", { path: "e2e/tutor/results/vs01-workspace-view.json", contentType: "application/json" });
    const ariaSnapshot = await page.locator(".ks-app-shell").ariaSnapshot();
    writeEvidence("vs01-aria-snapshot.yml", ariaSnapshot);
    await testInfo.attach("vs01-aria-snapshot", { path: "e2e/tutor/results/vs01-aria-snapshot.yml", contentType: "text/plain" });

    // 4. AC-08 冻结证据：legacy 字段仍在响应（删除在 VS7），新 UI 不消费。
    expect(sawUnifiedField, "响应未携带 workspace_view").toBe(true);
    expect(sawFrozenLegacyField, "冻结的 legacy 字段应仍在响应（L-04 冻结期）").toBe(true);
    expectNoTruthLeak(page);
  });

  test("AC-02/04/06（REQ-06）：刷新前后统一 View 深比较一致（?session= 恢复）", async ({ page }, testInfo) => {
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);

    await page.goto(`/learn/${TASK.taskId}?acceptance=1`);
    await waitForReadyTutor(page);
    const sessionId = (await page.locator(".tutor-learn-page[data-session-id]").getAttribute("data-session-id")) ?? "";

    // 推进至操作步（持久语义最有分量的一致性面），等待静息：voice 完成
    // 链的续走回合会推进 revision——深比较的两侧都必须在同一稳定态采样。
    const plan = loadGoldenPlan(TASK.tpId);
    await progressUntilWorkspace(page, plan);
    await waitForTutorState(page, "workspaceActive");
    const before = await waitForSettledView(page);
    expectViewStudentSafe(before);

    await page.reload();
    await waitForReadyTutor(page, 60_000);
    await expect(page.locator(".tutor-learn-page[data-session-id]")).toHaveAttribute("data-session-id", sessionId, { timeout: 30_000 });
    await expect(page.getByTestId("action-runtime-workspace")).toBeVisible({ timeout: e2eTimeout(30_000) });
    const after = await waitForSettledView(page);
    expectViewStudentSafe(after);

    // 持久语义深比较（REQ-06：刷新不丢、不重置、不多 reveal——同一构建
    // 入口的确定性投影，逐字段一致而非子集断言）。
    expect(after).toBe(before);
    writeEvidence("vs01-refresh-parity.json", JSON.stringify({ before: JSON.parse(before!), after: JSON.parse(after!) }, null, 2));
    await testInfo.attach("vs01-refresh-parity", { path: "e2e/tutor/results/vs01-refresh-parity.json", contentType: "application/json" });
    expectNoTruthLeak(page);
  });

  test("AC-07（REQ-08）：session view 缺 workspace_view → recoverable error，不静默重开", async ({ page }, testInfo) => {
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);

    // 建立会话并推进到稳定态。
    await page.goto(`/learn/${TASK.taskId}`);
    await waitForReadyTutor(page);
    const sessionId = (await page.locator(".tutor-learn-page[data-session-id]").getAttribute("data-session-id")) ?? "";

    // 注入：GET session view 剥掉 workspace_view（schema 非法——旧形状响应）。
    await page.route(/\/api\/tutor-sessions\/[^/]+$/, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      delete body.workspace_view;
      await route.fulfill({ status: response.status(), contentType: "application/json", body: JSON.stringify(body) });
    });
    let experienceRestarts = 0;
    page.on("request", (request) => {
      if (/\/api\/learn\/[^/]+\/experience$/.test(request.url())) experienceRestarts += 1;
    });

    await page.reload();
    // fail-closed：显示 recoverable error（不静默重开新会话、不回旧渲染链）。
    await expect(page.locator(".tutor-learn-error")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".tutor-learn-error")).toContainText("Invalid tutor session view");
    await expect(page.locator(".tutor-learn-page[data-session-id]")).toHaveAttribute("data-session-id", sessionId, { timeout: 10_000 });
    expect(experienceRestarts, "schema 非法不得触发静默重开").toBe(0);
    // phase=recovering（Panel 头部重试入口可见）。
    await expect(page.locator("[data-tutor-phase]")).toHaveAttribute("data-tutor-phase", "recovering", { timeout: 10_000 });
    await expect(page.getByTestId("tutor-retry")).toBeVisible({ timeout: 10_000 });
    expectNoTruthLeak(page);
  });

  test("AC-01 narrow：讲解分支双 surface 窄屏可读（语义顺序不变）", async ({ page }, testInfo) => {
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`/learn/${TASK.taskId}?acceptance=1`);
    await waitForReadyTutor(page);
    // VS1 remediation：题目一体化在 region-question（.tutor-learn-question 已删），
    // 讲解分支双 surface 在 canonical Frame 内。
    await expect(page.getByTestId("region-question")).toBeVisible({ timeout: e2eTimeout(20_000) });
    await expect(page.locator(".student-workspace-frame").first()).toBeVisible({ timeout: e2eTimeout(20_000) });
    await expect(page.getByTestId("region-solution-board").first()).toBeVisible({ timeout: e2eTimeout(20_000) });

    await page.screenshot({ path: "e2e/tutor/results/vs01-narrow-teach.png", fullPage: true });
    await testInfo.attach("vs01-narrow-screenshot", { path: "e2e/tutor/results/vs01-narrow-teach.png", contentType: "image/png" });
    expectNoTruthLeak(page);
  });
});
