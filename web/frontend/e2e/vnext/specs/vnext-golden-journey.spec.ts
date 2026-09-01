/**
 * F7 G7 门禁旅程：golden task（goldenMinhangFold2020）真实 Runtime 链的
 * 浏览器全旅程——mainline、answer/workspace participation、inquiry/return、
 * refresh/reconnect、completion/reopen、一次安全失败（revision 冲突可见且
 * 可恢复）。断言锚点全部来自 canonical 三视图的 data 属性（服务端事实），
 * 不读前端本地状态。
 */
import { expect, test, type Page } from "@playwright/test";

const TASK_URL = "/learn/goldenMinhangFold2020";

/** 学生身份预置（WorkspaceShell AuthModal 需要 studentName——同 tutorHarness）。 */
async function prepareStudent(page: Page): Promise<void> {
  await page.addInitScript((name) => {
    window.localStorage.setItem("trig-web-student-name", name);
  }, "vnext-e2e-student");
}

test.describe("F7 vNext golden 旅程", () => {
  test("完整用户旅程：开场确认 → 四拍作答 + 画布操作 → 完成 → 只读回顾", async ({ page }) => {
    await prepareStudent(page);
    await page.goto(TASK_URL);
    const pageRoot = page.locator(".vnext-learn-page");
    await expect(pageRoot).toBeVisible();
    // 开场：BT-01 awaiting confirmation（canonical participation 事实）。
    const participation = page.locator('[data-testid="region-participation"]');
    await expect(participation).toHaveAttribute("data-participation-kind", "confirm_input");
    await expect(page.locator('[data-testid="canonical-coach-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="canonical-student-workspace"]')).toBeVisible();
    // 题面来自 canonical 链（同一真源）。
    await expect(page.getByText("翻折", { exact: false }).first()).toBeVisible();

    // 确认开场 → BT-02 answer_input（第一组子母型识别）。
    await page.locator('[data-testid="canonical-participation-confirm"]').click();
    await expect(participation).toHaveAttribute("data-participation-kind", "answer_input");

    // workspace participation：画布标记已知线段（typed command → F3 执行 →
    // 回执入账；BT-02 是 answer gate，不旁路推进）。
    await page.locator('[data-testid="vnext-segment-AD"]').click();
    await page.locator('[data-testid="vnext-segment-value-AD"]').fill("t");
    await page.locator('[data-testid="vnext-submit-mark-known"]').click();
    await expect(participation).toHaveAttribute("data-participation-kind", "answer_input");

    // 四拍作答（GT-02..GT-05 均为 answer 拍；脚本 Gate pass）→ 最终确认 → completed。
    for (const [step, nextGate] of ["GT-03", "GT-04", "GT-05", "GT-06"].entries()) {
      const input = page.locator('[data-testid="region-participation"] input');
      await input.fill("子母型相似，对应边成比例");
      await page.locator('[data-testid="canonical-submit-answer"]').click();
      // 每拍提交后等待 gate 前进（GT-02→03→04→05；末拍 BT-06 为确认拍 GT-01）。
      await page.waitForFunction(
        (expected) => document.querySelector('[data-testid="region-participation"]')?.getAttribute("data-gate-id") === expected,
        nextGate,
        { timeout: 20_000 },
      );
      void step;
    }
    await expect(participation).toHaveAttribute("data-participation-kind", "confirm_input");
    await page.locator('[data-testid="canonical-participation-confirm"]').click();
    await expect(participation).toHaveAttribute("data-participation-kind", "read_only_completed");
    // 完成态：同一 Workspace 只读回顾（板书 review 模式 + 画布锁定）。
    await expect(page.locator('[data-testid="region-solution-board"]')).toHaveAttribute("data-board-mode", "review");
    await expect(page.locator('[data-testid="vnext-geometry"]')).toHaveAttribute("data-interaction-enabled", "false");
    await expect(page.locator('[data-testid="canonical-coach-panel"]')).toHaveAttribute("data-mainline-kind", "completed");
  });

  test("refresh/reconnect：F5 后从服务端 rebuilt state 恢复（不本地推导）", async ({ page }) => {
    await prepareStudent(page);
    await page.goto(TASK_URL);
    const participation = page.locator('[data-testid="region-participation"]');
    await expect(participation).toHaveAttribute("data-participation-kind", "confirm_input");
    await page.locator('[data-testid="canonical-participation-confirm"]').click();
    await expect(participation).toHaveAttribute("data-participation-kind", "answer_input");
    const sessionId = await page.locator(".vnext-learn-page").getAttribute("data-session-id");
    expect(sessionId).toMatch(/^TS-[0-9]{4,}$/);
    // 刷新：URL ?session= → GET restore；进度（BT-02 answer_input）保持。
    await page.reload();
    await expect(page.locator(".vnext-learn-page")).toBeVisible();
    await expect(page.locator(".vnext-learn-page")).toHaveAttribute("data-session-id", sessionId!);
    await expect(participation).toHaveAttribute("data-participation-kind", "answer_input");
  });

  test("inquiry/return：提问打开分支（主线冻结 + 返回点可见），分支收尾回主线", async ({ page }) => {
    await prepareStudent(page);
    await page.goto(TASK_URL);
    const participation = page.locator('[data-testid="region-participation"]');
    await expect(participation).toHaveAttribute("data-participation-kind", "confirm_input");
    // Assistance → ask_question（类型化 intent，打开 Approved inquiry）。
    await page.locator('[data-testid="coach-ask"]').click();
    await page.locator('[data-testid="vnext-assistance-composer"] input').fill("这道题问的是什么？");
    await page.locator('[data-testid="vnext-submit-question"]').click();
    await expect(participation).toHaveAttribute("data-participation-kind", "temporarily_paused_for_inquiry");
    await expect(page.locator('[data-testid="coach-inquiry"]')).toBeVisible();
    // 分支内作答（scaffold BT-01 student_answer）。
    const dialog = page.locator('[data-testid="vnext-inquiry-dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.locator("input").fill("我卡在第一组子母型");
    await page.locator('[data-testid="vnext-inquiry-answer"]').click();
    // 分支收尾（确认到末拍自动返回）→ 回到主线确认拍（D-1 修复语义）。
    for (let step = 0; step < 4; step += 1) {
      const kind = await participation.getAttribute("data-participation-kind");
      if (kind === "confirm_input") break;
      await page.locator('[data-testid="vnext-inquiry-confirm"]').click().catch(() => undefined);
      await page.waitForTimeout(300);
    }
    await expect(participation).toHaveAttribute("data-participation-kind", "confirm_input");
    await expect(page.locator('[data-testid="coach-inquiry"]')).toHaveCount(0);
  });

  test("安全失败：另一客户端推进后本页旧 revision 提交 → 显式失败可见，刷新恢复可继续（不毒化）", async ({ page }) => {
    await prepareStudent(page);
    await page.goto(TASK_URL);
    const participation = page.locator('[data-testid="region-participation"]');
    await expect(participation).toHaveAttribute("data-participation-kind", "confirm_input");
    const sessionId = await page.locator(".vnext-learn-page").getAttribute("data-session-id");
    expect(sessionId).toMatch(/^TS-[0-9]{4,}$/);
    // 另一客户端（模拟第二标签页）先确认了开场：读当前 revision → 提交 confirm。
    const backendPort = Number(process.env.VNEXT_E2E_BACKEND_PORT || 3111);
    const base = `http://127.0.0.1:${backendPort}`;
    const restored = await (await fetch(`${base}/api/vnext/tutor-sessions/${sessionId}`)).json();
    const advanced = await (
      await fetch(`${base}/api/vnext/tutor-sessions/${sessionId}/student-intents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent_kind: "confirm", client_request_id: "e2e-other-tab", expected_revision: restored.revision }),
      })
    ).json();
    expect(advanced.views.participation.kind).toBe("answer_input");
    // 本页仍持旧 revision（还停在开场确认拍）：提交确认 → 服务端显式
    // revision_conflict（committed failure 事实，HTTP 200）→ 页面出现可恢复
    // 提示，不崩、不伪成功。
    await page.locator('[data-testid="canonical-participation-confirm"]').click();
    await expect(page.locator('[data-testid="vnext-turn-failure"]')).toBeVisible();
    // 冲突响应携带服务端当前投影（页面自愈到另一客户端推进后的 answer 拍），
    // 无需刷新即可用新 revision 继续作答——失败不毒化会话。
    await expect(participation).toHaveAttribute("data-participation-kind", "answer_input");
    // 刷新 → GET restore（服务端真源）→ 页面与另一客户端的进度一致，可继续。
    await page.reload();
    await expect(page.locator(".vnext-learn-page")).toBeVisible();
    await expect(participation).toHaveAttribute("data-participation-kind", "answer_input");
  });
});
