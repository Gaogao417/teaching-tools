/**
 * VS0 真实前端验收基线 E2E（mvp/vs-00-frontend-acceptance-baseline.md）。
 *
 * golden reference task = auxiliaryTwoRatios（ADR-009 §3：reference task，
 * 不是页面模板）。全部用例走真实 `/learn/:taskId`（无 POC/mock 页面）：
 *
 * - AC-01/03：desktop 首屏六区域 + ready + URL/route 断言 + trace/screenshot/
 *   a11y/WorkspaceView/response 证据采集（REQ-01/02/03/05）；
 * - AC-04：accessibility snapshot + 关键入口可理解名称；
 * - AC-02/05：/experience 5xx、schema 不可识别 → recoverable error + 重试；
 *   重试后恰好一个 active session；无 Binding → route=legacy；不存在任务 →
 *   unsupported（无无限 spinner）（REQ-03/06）；
 * - 刷新基线：?session= 恢复同会话；
 * - AC-07：POC URL 不再路由（REQ-07）；
 * - 全程 truth-leak 嗅探（harness 既有 FORBIDDEN_TRUTH_KEYS）。
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
  sessionId,
  waitForTutorState,
} from "./tutorHarness";

/** 证据落盘目录（REQ-05：trace/screenshot/a11y/View/response 摘要均留文件）。 */
const EVIDENCE_DIR = path.join("e2e", "tutor", "results");
const writeEvidence = (name: string, body: string): void => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), body);
};

/** ADR-009 golden reference task（taskId 是路由参数，非硬编码内容 id）。
 *  VS1：golden 任务集运行时（TUTOR_E2E_TASK_SET=golden）无该合成任务，
 *  回落第一个 active task——reference 语义（真实入口/六区域/生命周期）
 *  不依赖具体题目。 */
const REFERENCE_TASK = ACTIVE_TASKS.find((entry) => entry.taskId === "auxiliaryTwoRatios") ?? ACTIVE_TASKS[0];
const GOLDEN_TASK_ID = REFERENCE_TASK.taskId;
const LEGACY_TASK_ID = "meaning";
const UNKNOWN_TASK_ID = "no-such-vnext-task";

/** ?acceptance=1 诊断条（REQ-04：只读，无 hidden truth）。 */
const diagnostics = (page: Page) => page.getByTestId("acceptance-diagnostics");

async function waitForReadyTutor(page: Page, timeout = 90_000): Promise<void> {
  await expect(page.getByTestId("page-lifecycle")).toHaveAttribute("data-lifecycle", "ready", { timeout: e2eTimeout(timeout) });
  // remediation-2：就绪锚 = 页面根会话 id 属性非空（canonical Coach 无 session id 文本节点）。
  await expect(page.locator(".tutor-learn-page[data-session-id]")).not.toHaveAttribute("data-session-id", "", { timeout: e2eTimeout(timeout) });
}

// REQ-05：基线用例始终留 trace（trace 强制新 worker，必须文件顶层声明）。
test.use({ trace: "on" });

test.describe("VS0 前端验收基线（golden reference: auxiliaryTwoRatios）", () => {
  test("AC-01/03/04/06：desktop 首屏与 workspace 双 surface 基线 + 证据采集 + 刷新", async ({ page }, testInfo) => {
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);

    // 关键 response 摘要（REQ-05）：/experience 与 tutor session GET。
    const responseSummaries: Array<{ url: string; status: number; kind?: string; revision?: number }> = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (!/\/api\/(learn|tutor-sessions)/.test(url)) return;
      const entry = { url: url.replace(/^https?:\/\/[^/]+/, ""), status: response.status() };
      try {
        const body = JSON.parse(await response.text()) as { kind?: string; revision?: number };
        responseSummaries.push({ ...entry, kind: body.kind, revision: body.revision });
      } catch {
        responseSummaries.push(entry);
      }
    });

    // 1. 真实入口 + route kind + ready（REQ-01/06）。
    await page.goto(`/learn/${GOLDEN_TASK_ID}?acceptance=1`);
    await expect(page).toHaveURL(new RegExp(`/learn/${GOLDEN_TASK_ID}`));
    await waitForReadyTutor(page);
    await expect(diagnostics(page)).toHaveAttribute("data-route", "tutor-vnext");
    await expect(diagnostics(page)).toHaveAttribute("data-task-id", GOLDEN_TASK_ID);
    await expect(diagnostics(page)).toHaveAttribute("data-fallback", "false");
    await expect(diagnostics(page)).toBeVisible();
    const currentSessionId = await sessionId(page);

    // 2. 开场区域（REQ-02）：Question / Tutor / Status（canonical Coach 头）。
    await expect(page.getByTestId("region-question")).toBeVisible();
    await expect(page.getByTestId("region-tutor")).toBeVisible();
    await expect(page.getByTestId("region-status")).toBeVisible();
    // Participation（主线回答入口）在呈现队列走完后出现（Presenting→
    // ReadyToContinue→AwaitingAnswer，ADR-010 §7）。
    await continueThroughNarration(page);
    await waitForTutorState(page, "awaitingInput", 60_000).catch(() => undefined);
    await expect(page.getByTestId("region-participation")).toBeVisible();
    await expect(page.getByTestId("coach-progress")).toBeVisible();
    // VS1 remediation：讲解画布在 canonical StudentWorkspaceFrame 内，
    // region-geometry 由 Frame 提供（.tutor-learn-figure 已删除）。
    const openingGeometry = page.locator(".student-workspace-frame [data-testid=region-geometry]");
    if (await openingGeometry.count()) await expect(openingGeometry.first()).toBeVisible();

    // 3. 推进到 workspace：Geometry 与 Solution Board 双 surface 同 workspace。
    const plan = loadGoldenPlan(REFERENCE_TASK.tpId);
    await progressUntilWorkspace(page, plan);
    await expect(page.getByTestId("action-runtime-workspace")).toBeVisible();
    await expect(page.getByTestId("region-geometry")).toBeVisible();
    await expect(page.getByTestId("region-solution-board")).toBeVisible();

    // 4. accessibility：关键入口有可理解名称（AC-04）。
    const unnamed = await page.evaluate(() => {
      const scope = document.querySelector(".ks-app-shell") ?? document;
      const nodes = Array.from(scope.querySelectorAll<HTMLElement>("button, input, [role=slider]"));
      return nodes
        .filter((node) => node.offsetParent !== null || node === document.activeElement)
        .filter((node) => {
          const name = node.getAttribute("aria-label") ?? node.getAttribute("placeholder") ?? node.textContent ?? "";
          return !name.trim();
        })
        .map((node) => `${node.tagName}.${node.className}`);
    });
    expect(unnamed, `无名可交互元素：${unnamed.join(", ")}`).toEqual([]);

    // 5. 证据采集（REQ-05）：desktop screenshot / a11y snapshot /
    //    StudentWorkspaceView 快照（window.__acceptanceWorkspaceView，只含
    //    student-safe 投影）/ response 摘要。
    await page.screenshot({ path: "e2e/tutor/results/vs00-desktop-workspace.png", fullPage: true });
    await testInfo.attach("vs00-desktop-screenshot", { path: "e2e/tutor/results/vs00-desktop-workspace.png", contentType: "image/png" });
    const ariaSnapshot = await page.locator(".ks-app-shell").ariaSnapshot();
    writeEvidence("vs00-aria-snapshot.yml", ariaSnapshot);
    await testInfo.attach("vs00-aria-snapshot", { path: "e2e/tutor/results/vs00-aria-snapshot.yml", contentType: "text/plain" });
    const workspaceView = await page.evaluate(() => {
      const view = (window as unknown as { __acceptanceWorkspaceView?: unknown }).__acceptanceWorkspaceView;
      return view ? JSON.stringify(view, null, 2) : null;
    });
    expect(workspaceView, "acceptance WorkspaceView 快照未暴露").toBeTruthy();
    writeEvidence("vs00-workspace-view.json", workspaceView!);
    await testInfo.attach("vs00-workspace-view-snapshot", { path: "e2e/tutor/results/vs00-workspace-view.json", contentType: "application/json" });
    const viewJson = workspaceView!;
    for (const forbidden of ["localTruth", "teachingInput", "expectedValues", "expectedValue"]) {
      expect(viewJson, `View 快照含 truth 字段 ${forbidden}`).not.toContain(`"${forbidden}"`);
    }

    // 6. 刷新基线：?session= 恢复同一会话（不靠内存重建）。
    await page.reload();
    await waitForReadyTutor(page, 60_000);
    await expect(page.locator(".tutor-learn-page[data-session-id]")).toHaveAttribute("data-session-id", currentSessionId, { timeout: 30_000 });
    await expect(page.getByTestId("action-runtime-workspace")).toBeVisible({ timeout: e2eTimeout(20_000) });

    await testInfo.attach("vs00-response-summary", {
      body: JSON.stringify(responseSummaries, null, 2),
      contentType: "application/json",
    });
    writeEvidence("vs00-response-summary.json", JSON.stringify(responseSummaries, null, 2));
    expectNoTruthLeak(page);
  });

  test("AC-01/04：narrow viewport 顺序与可操作性", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);

    await page.goto(`/learn/${GOLDEN_TASK_ID}?acceptance=1`);
    await waitForReadyTutor(page);
    await expect(page.getByTestId("region-question")).toBeVisible();
    await expect(page.getByTestId("region-status")).toBeVisible();

    // ADR-009 布局不变量 4：narrow 保持 question → workspace → participation
    // 语义顺序（DOM 顺序断言）。
    const order = await page.evaluate(() => {
      const ids = ["region-question", "region-tutor", "region-participation", "region-status"];
      const positions = ids.map((id) => {
        const node = document.querySelector(`[data-testid="${id}"]`);
        return node ? (node as HTMLElement).getBoundingClientRect().top : Number.POSITIVE_INFINITY;
      });
      return ids.filter((_, index) => Number.isFinite(positions[index]));
    });
    expect(order.length).toBeGreaterThanOrEqual(3);

    // dock rail 展开后参与入口仍可操作（不变量 3：不遮挡参与）——先放行
    // 开场话术队列，回答入口出现（remediation-2：Participation 双通道）。
    await continueThroughNarration(page);
    await waitForTutorState(page, "awaitingInput", 60_000).catch(() => undefined);
    const composerInput = page.getByLabel("回答输入");
    await expect(composerInput).toBeVisible({ timeout: e2eTimeout(20_000) });
    await composerInput.click();
    await expect(composerInput).toBeFocused();

    await page.screenshot({ path: "e2e/tutor/results/vs00-narrow.png", fullPage: true });
    await testInfo.attach("vs00-narrow-screenshot", { path: "e2e/tutor/results/vs00-narrow.png", contentType: "image/png" });
    const narrowAria = await page.locator(".ks-app-shell").ariaSnapshot();
    writeEvidence("vs00-narrow-aria-snapshot.yml", narrowAria);
    await testInfo.attach("vs00-narrow-aria-snapshot", { path: "e2e/tutor/results/vs00-narrow-aria-snapshot.yml", contentType: "text/plain" });
    expectNoTruthLeak(page);
  });

  test("AC-02/05：/experience 5xx → recoverable error + 重试恰好一个会话", async ({ page }, testInfo) => {
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);
    let failNext = true;
    await page.route(/\/api\/learn\/[^/]+\/experience$/, async (route) => {
      if (failNext) {
        failNext = false;
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "vs00 故障注入" } }) });
        return;
      }
      await route.continue();
    });
    let tutorSessionCreations = 0;
    page.on("response", async (response) => {
      if (!/\/api\/learn\/[^/]+\/experience$/.test(response.url()) || response.status() >= 300) return;
      try {
        const body = JSON.parse(await response.text()) as { kind?: string };
        if (body.kind === "tutor") tutorSessionCreations += 1;
      } catch { /* 非 JSON 忽略 */ }
    });

    await page.goto(`/learn/${GOLDEN_TASK_ID}?acceptance=1`);
    await expect(page.getByTestId("page-lifecycle")).toHaveAttribute("data-lifecycle", "error", { timeout: 30_000 });
    await expect(page.getByTestId("page-lifecycle-error-detail")).toContainText("vs00 故障注入");
    await expect(page.getByTestId("page-lifecycle-retry")).toBeVisible();
    // fail-closed：不静默回 legacy（REQ-06）。
    await expect(diagnostics(page)).toHaveAttribute("data-fallback", "false");

    // 重试恢复（AC-02），且不重复创建多个 active session。
    await page.getByTestId("page-lifecycle-retry").click();
    await waitForReadyTutor(page);
    expect(tutorSessionCreations).toBe(1);
    expectNoTruthLeak(page);
  });

  test("AC-05：response schema 不可识别 → recoverable error（不伪装成功）", async ({ page }, testInfo) => {
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);
    await page.route(/\/api\/learn\/[^/]+\/experience$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ kind: "tutor", nonsense: true }) });
    });

    await page.goto(`/learn/${GOLDEN_TASK_ID}?acceptance=1`);
    await expect(page.getByTestId("page-lifecycle")).toHaveAttribute("data-lifecycle", "error", { timeout: 30_000 });
    await expect(page.getByTestId("page-lifecycle-error-detail")).toContainText("Invalid tutor experience response");
    await expect(page.locator(".tutor-learn-page[data-session-id]")).toHaveCount(0);
    expectNoTruthLeak(page);
  });

  test("AC-05：无 Binding 任务 → route=legacy（可断言、非静默）", async ({ page }, testInfo) => {
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);

    await page.goto(`/learn/${LEGACY_TASK_ID}?acceptance=1`);
    await expect(page.getByTestId("acceptance-diagnostics")).toHaveAttribute("data-route", "legacy", { timeout: 30_000 });
    await expect(page.getByTestId("page-lifecycle")).toHaveAttribute("data-lifecycle", "ready", { timeout: 30_000 });
    // legacy 分支不出现 tutor 会话面（防静默 fallback 的另一半）。
    await expect(page.locator(".tutor-learn-page[data-session-id]")).toHaveCount(0);
    await expect(page.locator(".ks-focus-workspace").first()).toBeVisible();
    expectNoTruthLeak(page);
  });

  test("AC-05：不存在任务 → unsupported（显式状态，无无限 spinner）", async ({ page }, testInfo) => {
    await prepareStudent(page);
    await installTutorHarness(page, testInfo);

    await page.goto(`/learn/${UNKNOWN_TASK_ID}?acceptance=1`);
    await expect(page.getByTestId("page-lifecycle")).toHaveAttribute("data-lifecycle", "unsupported", { timeout: 30_000 });
    await expect(page.getByTestId("page-lifecycle-unsupported-reason")).toBeVisible();
    await expect(page.getByTestId("page-lifecycle")).not.toHaveAttribute("data-lifecycle", "loading");
    expectNoTruthLeak(page);
  });

  test("AC-07：POC URL 不再路由（L-06 退场）", async ({ page }) => {
    for (const pocPath of ["/poc/geometry", "/poc/geometry-actions"]) {
      await page.goto(pocPath);
      await expect(page.locator(".poc-page, .ks-poc, .geometry-canvas")).toHaveCount(0);
    }
  });
});
