/**
 * F7 P3/P4 JR4：浏览器级系统失败注入（US-08 浏览器行 / PLAN §4 L399 三行 /
 * FM-5 竞争族 / F-08 granted+ASR 成功链 L3）。
 *
 * 真实浏览器 + 合成 root 后端（scripted gate，与 p2-canonical-journey 同一
 * harness）。行协议注入采用「真实响应改写 action_submission」——保证注入体
 * 通过共享 schema（parseActionEvidenceResponseHttp），不是手拼畸形 body。
 * 恒成立断言：失败可见、可恢复、无 wrong/correct 评价消费、Beat 不推进。
 *
 * JR4-d（granted+ASR）沿用 p3-media-faults 的 fake-device 纪律：fake media
 * device 提供真实音频轨、拦截点在 HTTP 层；验证 granted 权限链+自动提交身份
 * 纪律与空转写 422——不冒充真人语音验收（FM-1-1/1-2 归用户）。
 */
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";

const TASK_URL = "/learn/goldenMinhangFold2020";
const SILENT_MP3 = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "silent-1.5s.mp3"));

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

async function installTtsIntercept(page: Page): Promise<void> {
  await page.route(/\/api\/action-speech(-stream)?$/, async (route: Route) => {
    if (route.request().url().endsWith("-stream")) {
      await route.fulfill({ status: 200, contentType: "audio/mpeg", body: SILENT_MP3 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });
}

async function prepareStudent(page: Page): Promise<void> {
  await page.addInitScript((name) => {
    window.localStorage.setItem("trig-web-student-name", name);
  }, "jr4-fault-student");
}

/** 与 p2 主旅程同链：开场 voice → confirm → 两拍作答（scripted Gate 放行）。 */
async function driveToAnswerFlow(page: Page): Promise<void> {
  await page.goto(TASK_URL);
  await expect(page.getByTestId("coach-prompt")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("tutor-presentation")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("tutor-confirm-input").or(page.getByTestId("tutor-submit-answer")).first()).toBeVisible({ timeout: 60_000 });
  const confirm = page.getByTestId("tutor-confirm-input");
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  }
  await expect(page.getByTestId("tutor-submit-answer")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("回答输入").fill("识别第一组子母型，△CAD∽△CBA");
  await page.getByTestId("tutor-submit-answer").click();
  await expect(page.getByTestId("tutor-submit-answer")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("回答输入").fill("对应边成比例，AD=CD=8/3、BD=10/3");
  await page.getByTestId("tutor-submit-answer").click();
}

test("JR4-a 输入 REVISION_CONFLICT：失败可见、零评价、可恢复后旅程继续", async ({ page }) => {
  test.setTimeout(6 * 60_000);
  await prepareStudent(page);
  await installTtsIntercept(page);
  let injected = false;
  await page.route(/\/api\/vnext\/tutor-sessions\/[^/]+\/student-inputs$/, async (route) => {
    if (!injected && (route.request().postDataJSON() as { input?: { kind?: string } })?.input?.kind === "utterance") {
      injected = true;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "REVISION_CONFLICT", message: "injected revision conflict (JR4-a)" } }),
      });
      return;
    }
    await route.continue();
  });

  await driveToAnswerFlow(page);

  // 注入的 409 已被消费：协议错误可见（或状态 alert），且不是学生答错/答对
  expect(injected, "注入的冲突请求确实发生").toBe(true);
  await expect(page.getByTestId("tutor-protocol-error").or(page.getByRole("alert"))).toBeVisible({ timeout: 30_000 });
  const wrongText = await page.getByText(/答错|不对|再想想|答对了|回答正确/).count();
  expect(wrongText, "revision conflict 不显示学生答错/答对").toBe(0);

  // 恢复：显式重试（或再次提交）后协议错误消失、参与区可用（旅程继续）
  const retry = page.getByTestId("tutor-protocol-retry");
  if (await retry.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await retry.click();
  } else {
    const composer = page.getByTestId("tutor-participation").locator("input").first();
    if (await composer.isEditable({ timeout: 10_000 }).catch(() => false)) {
      await composer.fill("我认为两条边相等");
      await page.getByTestId("tutor-participation").locator("button[type=submit]").click();
    }
  }
  await expect(page.getByTestId("tutor-protocol-error")).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId("tutor-participation").or(page.getByTestId("action-runtime-workspace"))).toBeVisible({ timeout: 60_000 });
});

/**
 * JR4-b/c：action-evidence 三类 system failure 的浏览器消费（P0-1 浏览器行）。
 * 注入方式：放行真实请求，改写响应中的 action_submission 判别（保留其余快照
 * 字段），保证 schema 可解析、结构上无 evaluation（错误 oracle 由后端套件锁定）。
 */
async function driveToWorkspaceAndInject(page: Page, status: "runtime-failure" | "command-rejected"): Promise<void> {
  await prepareStudent(page);
  await installTtsIntercept(page);
  let injected = false;
  await page.route(/\/api\/vnext\/tutor-sessions\/[^/]+\/action-evidence$/, async (route) => {
    if (injected) { await route.continue(); return; }
    const response = await route.fetch();
    const body = (await response.json()) as { action_submission?: Record<string, unknown> };
    if (!body.action_submission) { await route.fulfill({ response }); return; }
    injected = true;
    const mutated = {
      ...body.action_submission,
      status,
      failure: {
        category: "command",
        failure_class: status === "command-rejected" ? "COMMAND_REJECTED" : "RUNTIME_FAILURE",
        message: `injected ${status} (JR4)`,
        retryable: false,
      },
    };
    delete mutated.evaluation;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...body, action_submission: mutated }),
    });
  });
  await driveToAnswerFlow(page);
  // BT-04 操作拍挂载：与 p2 永久用例同一交互链（键盘+鼠标选段 → 按 label 填值）
  const workspace = page.getByTestId("action-runtime-workspace");
  await expect(workspace).toBeVisible({ timeout: 60_000 });
  await expect(workspace).toHaveAttribute("data-action-id", /mark-segment-values/, { timeout: 30_000 });
  const board = page.locator(".geometry-canvas__board");
  const canvas = page.locator(".geometry-canvas");
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(workspace).toHaveAttribute("data-selected", "seg-AO");
  for (const segmentId of ["seg-DO", "seg-BO", "seg-OE"]) {
    const entity = board.locator(`[data-geometry-id="${segmentId}"]`);
    const rect = await entity.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await expect(workspace.getAttribute("data-selected")).resolves.toContain(segmentId);
  }
  const values: Record<string, string> = {
    "seg-AO": "\\frac{16}{5}",
    "seg-DO": "\\frac{32}{15}",
    "seg-BO": "\\frac{6}{5}",
    "seg-OE": "\\frac{4}{5}",
  };
  for (const [segmentId, value] of Object.entries(values)) {
    await page.getByLabel(segmentId, { exact: false }).fill(value);
  }
  await page.getByRole("button", { name: "确认" }).last().click();
  // action-evidence 拦截经 route.fetch 改写——等待注入确实发生（而非点击后立即断言）
  const injectDeadline = Date.now() + 30_000;
  while (Date.now() < injectDeadline && !injected) await page.waitForTimeout(300);
  expect(injected, `${status} 注入已发生`).toBe(true);
}

for (const scenario of ["runtime-failure", "command-rejected"] as const) {
  test(`JR4-${scenario === "command-rejected" ? "c" : "b"} 作答提交 ${scenario}：失败可见、零评价、选择保留`, async ({ page }) => {
    test.setTimeout(6 * 60_000);
    await driveToWorkspaceAndInject(page, scenario);
    // 失败可见（turn failure 通知 role=status），不出现学生答错/答对
    await expect(page.getByTestId("tutor-turn-failure")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tutor-turn-failure")).toContainText(/未生效|请重试/);
    const wrongText = await page.getByText(/答错|不对|再想想|答对了|回答正确/).count();
    expect(wrongText, `${scenario} 不评价学生`).toBe(0);
    // 选择保留：workspace 仍挂载（不推进、不消失）
    await expect(page.getByTestId("action-runtime-workspace")).toBeVisible({ timeout: 10_000 });
  });
}

/**
 * JR4-e（US-07/FM-10-6 浏览器行）：错值→wrong 诊断可见+选择保留+零推进→
 * 修改为正确值→过门推进 BT-05。附 a11y snapshot 留档（INT §3.1 类型 7）。
 */
test("JR4-e 错值 retain→修改→correct 过门（US-07 浏览器旅程）", async ({ page }) => {
  test.setTimeout(6 * 60_000);
  await prepareStudent(page);
  await installTtsIntercept(page);
  await driveToAnswerFlow(page);
  const workspace = page.getByTestId("action-runtime-workspace");
  await expect(workspace).toBeVisible({ timeout: 60_000 });
  await expect(workspace).toHaveAttribute("data-action-id", /mark-segment-values/, { timeout: 30_000 });
  const board = page.locator(".geometry-canvas__board");
  const canvas = page.locator(".geometry-canvas");
  const selectAll = async (): Promise<void> => {
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(workspace).toHaveAttribute("data-selected", "seg-AO");
    for (const segmentId of ["seg-DO", "seg-BO", "seg-OE"]) {
      const entity = board.locator(`[data-geometry-id="${segmentId}"]`);
      const rect = await entity.evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
      await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2);
      await expect(workspace.getAttribute("data-selected")).resolves.toContain(segmentId);
    }
  };
  await selectAll();
  const evidencePosts: { status: number; body: string }[] = [];
  page.on("response", async (response) => {
    if (/\/action-evidence$/.test(new URL(response.url()).pathname) && response.request().method() === "POST") {
      evidencePosts.push({ status: response.status(), body: (await response.text()).slice(0, 0) || "ok" });
      console.log(`JR4-E-EVIDENCE #${evidencePosts.length} status=${response.status()}`);
    }
  });
  // —— 第一轮：错值 → wrong 诊断可见、选择保留、不推进 ——
  const wrongValues: Record<string, string> = { "seg-AO": "1", "seg-DO": "2", "seg-BO": "3", "seg-OE": "4" };
  for (const [sid, v] of Object.entries(wrongValues)) await page.getByLabel(sid, { exact: false }).fill(v);
  await page.getByRole("button", { name: "确认" }).last().click();
  await expect(page.getByTestId("runtime-wrong-feedback")).toBeVisible({ timeout: 30_000 });
  await expect(workspace).toBeVisible({ timeout: 30_000 }); // actor 保留（不卸载、不推进）
  await expect(page.getByTestId("tutor-submit-answer")).toBeHidden({ timeout: 5_000 }).catch(async () => {
    // 若已推进（不应发生），失败并留证
    throw new Error("wrong 值不应推进 Beat");
  });
  // —— 第二轮：修改为正确值 → 过门推进 ——
  const correctValues: Record<string, string> = { "seg-AO": "\\frac{16}{5}", "seg-DO": "\\frac{32}{15}", "seg-BO": "\\frac{6}{5}", "seg-OE": "\\frac{4}{5}" };
  for (const [sid, v] of Object.entries(correctValues)) await page.getByLabel(sid, { exact: false }).fill(v);
  await page.getByRole("button", { name: "确认" }).last().click();
  await expect(page.getByTestId("tutor-submit-answer").or(page.getByTestId("tutor-participation"))).toBeVisible({ timeout: 30_000 });
  // a11y snapshot 留档（非穷尽审计：结构快照证据）
  const snapshot = await page.locator("main").ariaSnapshot();
  expect(snapshot.length, "a11y snapshot 非空").toBeGreaterThan(200);
});

test("JR4-d granted 权限 + ASR 成功自动提交 / 空转写 422（fake-device L3 行）", async ({ page }) => {
  test.setTimeout(6 * 60_000);
  await prepareStudent(page);
  await installTtsIntercept(page);
  let asrMode: "success" | "empty" = "success";
  let asrCalls = 0;
  let latestRevision = 0;
  // 跟踪服务端当前 revision——ASR success 响应必须回传与捕获一致的
  // observed_revision（否则 stale 防护正确地拒绝自动提交）。快照 revision
  // 同时来自 GET restore 与各 mutation 响应，两者都跟踪。
  page.on("response", async (response) => {
    if (!response.url().includes("/api/vnext")) return;
    try {
      const body = (await response.json()) as { revision?: number };
      if (typeof body.revision === "number" && body.revision >= latestRevision) latestRevision = body.revision;
    } catch { /* ignore */ }
  });
  let submittedUtterances: { channel?: string; text?: string }[] = [];
  const distinctUtteranceKeys = new Set<string>();
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/student-inputs$/.test(new URL(request.url()).pathname)) {
      const body = request.postDataJSON() as { client_request_id?: string; input?: { kind?: string; channel?: string; text?: string } };
      if (body?.input?.kind === "utterance") {
        if (body.client_request_id) distinctUtteranceKeys.add(body.client_request_id);
        console.log(`JR4-D-UTTERANCE key=${body.client_request_id} channel=${body.input.channel} text=${body.input.text}`);
        submittedUtterances.push({ channel: body.input.channel, text: body.input.text });
      }
    }
  });
  await page.route(/\/api\/vnext\/tutor-sessions\/[^/]+\/asr$/, async (route) => {
    asrCalls++;
    const sid = new URL(route.request().url()).pathname.split("/").at(-2)!;
    if (asrMode === "success") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session_id: sid, observed_revision: latestRevision, transcript: "为什么这一步是相似的？", model: "jr4-fake-asr" }),
      });
      return;
    }
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "EMPTY_TRANSCRIPT", message: "injected empty transcript (JR4-d)" } }),
    });
  });

  // 开场拍静息（首 voice 完成、确认 CTA 可见、无在途交付）——录音→ASR 成功
  // 的自动提交要求捕获 revision 与响应一致且期间无漂移（BT-04 拍呈现在途会
  // 合法地触发 stale 草稿路径，那是 FM-2-3 的行为）。
  await page.goto(TASK_URL);
  await expect(page.getByTestId("coach-prompt")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("tutor-presentation")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("tutor-confirm-input").or(page.getByTestId("tutor-submit-answer")).first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_000);
  // granted（fake-ui 自动授权）+ fake-device 真实音频轨：coach mic 录音→停止。
  // 录音中按钮改名「结束录音」——用同一元素定位器二连击。
  const keysBeforeRecording = distinctUtteranceKeys.size;
  const coachMic = page.getByRole("button", { name: /语音提问|问老师/ }).first();
  await expect(coachMic).toBeVisible({ timeout: 30_000 });
  await coachMic.click();
  await expect(page.getByRole("button", { name: /结束录音/ }).first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /结束录音/ }).first().click(); // 停止 → 真实 webm blob → /asr
  // 成功链：自动提交按录音开始锁定的 assistance 通道（capture 身份一致）。
  // 同 payload 幂等重试算一次逻辑提交——按 client_request_id 去重后断言恰一新增。
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && distinctUtteranceKeys.size <= keysBeforeRecording) await page.waitForTimeout(500);
  expect(distinctUtteranceKeys.size - keysBeforeRecording, "granted+成功 ASR 自动提交恰一个幂等键").toBe(1);
  const recorded = submittedUtterances[submittedUtterances.length - 1];
  expect(recorded.channel, "coach mic 锁定 assistance 通道").toBe("assistance");
  expect(recorded.text, "提交原始 transcript").toBe("为什么这一步是相似的？");

  // 空转写：再录一段 → /asr 422 → 可见提示、零新增提交、教学状态不变
  asrMode = "empty";
  submittedUtterances = [];
  const keysBeforeEmpty = distinctUtteranceKeys.size;  await page.waitForTimeout(1_000);
  await coachMic.click();
  await expect(page.getByRole("button", { name: /结束录音/ }).first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /结束录音/ }).first().click();
  await page.waitForTimeout(5_000);
  expect(asrCalls, "两次 /asr 调用").toBeGreaterThanOrEqual(2);
  expect(distinctUtteranceKeys.size, "空转写零自动提交").toBe(keysBeforeEmpty);
  expect(submittedUtterances.length, "空转写零提交请求").toBe(0);
  await expect(page.locator("[role=alert], [role=status]").filter({ hasText: /没有识别|识别.*内容|请再试|未能|稍后/ }).first()).toBeVisible({ timeout: 15_000 });
});
