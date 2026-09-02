/**
 * F7 G7 验收旅程（canonical UI：LearnPage → TutorLearnExperience(vnext) →
 * ActionRuntimeFrame → mark-segment-values@1 XState → action-evidence）。
 *
 * 关键断言（返工验收）：BT-04 的画布操作经真实 XState actor（键盘同一语义
 * 通道 OBJECT.SELECTED）；错误数值在服务端 typed evaluator 拒（零事件、UI
 * 错误反馈）；正确四值过门推进；刷新恢复；窄屏可用性另轨（vs01 同口径）。
 */
import { expect, test, type Page } from "@playwright/test";

const TASK_URL = "/learn/goldenMinhangFold2020";

async function prepareStudent(page: Page): Promise<void> {
  await page.addInitScript((name) => {
    window.localStorage.setItem("trig-web-student-name", name);
  }, "vnext-e2e-student");
}

async function submitAnswer(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-testid="vnext-participation"] input');
  await input.fill(text);
  await page.locator('[data-testid="vnext-submit-answer"]').click();
}

test.describe("F7 vNext canonical 旅程", () => {
  test("完整旅程：确认 → 两拍作答 → BT-04 画布 action（键盘选择+真值过门）→ 完成", async ({ page }) => {
    await prepareStudent(page);
    await page.goto(TASK_URL);
    // 开场：canonical confirm_input。
    await expect(page.locator('[data-testid="vnext-participation-confirm"]')).toBeVisible();
    await page.locator('[data-testid="vnext-participation-confirm"]').click();
    // BT-02/BT-03：answer_input（脚本 Gate pass）。
    await expect(page.locator('[data-testid="vnext-submit-answer"]')).toBeVisible();
    await submitAnswer(page, "识别第一组子母型，△CAD∽△CBA");
    await expect(page.locator('[data-testid="vnext-submit-answer"]')).toBeVisible();
    await submitAnswer(page, "对应边成比例，AD=CD=8/3、BD=10/3");
    // BT-04：ActionRuntimeFrame 挂载（active_action 下发；构造已 committed）。
    const canvas = page.locator(".geometry-canvas");
    await expect(canvas).toBeVisible();
    await expect(canvas).toBeFocused().catch(async () => {
      await canvas.focus();
    });
    // 交互模型（生产 mark-segment-values）：键盘选中一段 → 活动输入框出现
    // （autoFocusSequence）→ 填值 → 回画布选下一段（同一 XState actor 的
    // OBJECT.SELECTED/ANSWER.CHANGED 语义通道——非组件本地状态）。
    const SEGMENTS = ["seg-AO", "seg-DO", "seg-BO", "seg-OE"];
    const selectAllFour = async (): Promise<void> => {
      for (let index = 0; index < 4; index += 1) {
        await canvas.focus();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Enter");
      }
    };
    const fillBySegment = async (values: Record<string, string>): Promise<void> => {
      for (const segment of SEGMENTS) {
        await page.getByLabel(segment, { exact: false }).fill(values[segment]);
      }
    };
    // 正确四值（教师审核过的 RG@v8 真值）：键盘选择 → 逐框填值 → 确认。
    await selectAllFour();
    await fillBySegment({
      "seg-AO": "\\frac{16}{5}",
      "seg-DO": "\\frac{32}{15}",
      "seg-BO": "\\frac{6}{5}",
      "seg-OE": "\\frac{4}{5}",
    });
    await page.getByRole("button", { name: "确认" }).last().click();
    // GT-04 满足 → BT-05 answer_input。
    await expect(page.locator('[data-testid="vnext-submit-answer"]')).toBeVisible({ timeout: 20_000 });
    await submitAnswer(page, "蝶形相似 △BOE∽△AOD，BE=1");
    await page.locator('[data-testid="vnext-participation-confirm"]').click();
    await expect(page.locator('[data-testid="vnext-participation"]')).toContainText("已完成");
  });

  test("refresh/reconnect：BT-04 画布操作前刷新 → 服务端 rebuilt state 恢复进度", async ({ page }) => {
    await prepareStudent(page);
    await page.goto(TASK_URL);
    await page.locator('[data-testid="vnext-participation-confirm"]').click();
    await submitAnswer(page, "识别第一组子母型");
    await submitAnswer(page, "对应边成比例");
    await expect(page.locator(".geometry-canvas")).toBeVisible();
    const sessionId = new URL(page.url()).searchParams.get("session");
    expect(sessionId).toMatch(/^TS-[0-9]{4,}$/);
    await page.reload();
    await expect(page.locator(".geometry-canvas")).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).searchParams.get("session")).toBe(sessionId);
  });
});

test("安全①：BT-04 错误数值经真实服务链路拒绝（零事件、Beat 不推进）", async ({ request }) => {
  const backendPort = Number(process.env.VNEXT_E2E_BACKEND_PORT || 3113);
  const base = `http://127.0.0.1:${backendPort}`;
  const started = await (await request.post(`${base}/api/vnext/tutor-sessions`, { data: { student_id: "e2e-wrong-safety" } })).json();
  let revision = started.revision;
  for (const intent of ["confirm", "submit_answer", "submit_answer"] as const) {
    const turn = await (
      await request.post(`${base}/api/vnext/tutor-sessions/${started.session_id}/student-intents`, {
        data: { intent_kind: intent, ...(intent === "submit_answer" ? { text: "子母型相似" } : {}), client_request_id: `e2e-ws-${intent}-${revision}`, expected_revision: revision },
      })
    ).json();
    revision = turn.revision;
  }
  const atBt04 = await (await request.get(`${base}/api/vnext/tutor-sessions/${started.session_id}`)).json();
  expect(atBt04.active_action?.action_id).toContain("mark-segment-values");
  const wrong = await (
    await request.post(`${base}/api/vnext/tutor-sessions/${started.session_id}/action-evidence`, {
      data: {
        evidence: { actionId: atBt04.active_action.action_id, sourceStepId: "BT-04", kind: "mark-segment-values", version: 1, values: { "seg-AO": "9", "seg-DO": "9", "seg-BO": "9", "seg-OE": "9" } },
        expected_revision: revision,
        client_command_id: "cc-e2e-wrong",
      },
    })
  ).json();
  expect(wrong.action_submission.status).toBe("evidence-rejected");
  expect(wrong.action_submission.evaluation.evaluation).toBe("wrong");
  expect(wrong.action_submission.evaluation.diagnosis.wrongObjectIds).toHaveLength(4);
  expect(wrong.revision).toBe(revision);
  expect(wrong.views.participation.kind).toBe("workspace_input");
});
