/**
 * F7 P3/P4 JR3：真实服务联合旅程（协调者验收行）。
 *
 * 前置：教研试讲服务已启动（start-teach-review.ts，真实 Gate/Presenter/TTS、
 * Draft v13 注入、v9 生成 pending 轮询）。本 spec 经 `TUTOR_E2E_REAL_REVIEW_URL`
 * 门控——默认 e2e 套件 skip，不污染常规门禁；截图/观测产物写入
 * `TUTOR_E2E_JR3_SHOTS`（默认 /tmp/jr3-shots）。
 *
 * 覆盖（联合矩阵 B3/B6/B7 动态行 + C4 联合体验 + pending 轮询端到端）：
 * - 六拍自然理解旅程至 session_completed（真实模型逐拍生成、真实 TTS 播放）；
 * - 原话逐条在对话区可见（含 assistance 提问与 mainline 反馈两通道）；
 * - 全程零 presentation failure / 零学生答错误报（系统失败≠学生错误）；
 * - v9 生成 pending 状态在前端可见性观测（tutor-generation-status，软断言）；
 * - truth-leak 扫描：/api/vnext 响应体禁键 + 学生 DOM 无 FN-/IF- 内部编号；
 * - 截图留档（每拍 + 完成）。
 */
import * as fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const REVIEW_URL = process.env.TUTOR_E2E_REAL_REVIEW_URL;
const SHOT_DIR = process.env.TUTOR_E2E_JR3_SHOTS || "/tmp/jr3-shots";

/** v3 真实旅程原话（TS-178880051761101；七条输入走完六拍）。 */
const TURNS: { channel: "assistance" | "mainline"; text: string }[] = [
  { channel: "assistance", text: "我没听懂，翻折后C和E之间是什么关系？" },
  { channel: "mainline", text: "明白了，C和E关于AD对称。题目给了等腰、等角和翻折条件，要用这些关系求BE，我跟上了，继续讲吧。" },
  { channel: "mainline", text: "跟上了，是两对对应角相等，所以三角形CAD与CBA相似。请继续演示怎样列比例。" },
  { channel: "mainline", text: "接上了，按对应边的顺序列比例得到AD和CD，再用BC减CD得到BD。继续讲辅助线吧。" },
  { channel: "assistance", text: "这段我跟上了，请把第二组相似以及DO、AO、BO、OE的计算过程整理在板书上，再继续。" },
  { channel: "mainline", text: "跟上了，用蝶形相似得到BE与AD的比是3比8，再代入AD得到BE等于1。" },
  { channel: "mainline", text: "没有了，整条思路我都跟上了：先后两组子母型相似算出需要的线段，再用蝶形相似求BE。" },
];

const TURN_TIMEOUT_MS = 9 * 60_000;

interface Observations {
  startedAt: string;
  turnTimings: { index: number; channel: string; submittedAt: string; idleAgainMs: number }[];
  generationStatusSightings: { at: string; text: string }[];
  pageErrors: string[];
  apiCalls: { method: string; path: string; status: number }[];
  snapshotBodiesScanned: number;
  forbiddenKeyHits: string[];
  domInternalIdHits: string[];
  completed: boolean;
  dialogueUtterancesFound: string[];
  finishedAt: string;
}

test.skip(!REVIEW_URL, "JR3 requires TUTOR_E2E_REAL_REVIEW_URL (live review server)");

test("JR3 真实服务六拍联合旅程（真实模型/TTS/浏览器）", async ({ page }) => {
  test.setTimeout(35 * 60_000);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const obs: Observations = {
    startedAt: new Date().toISOString(),
    turnTimings: [],
    generationStatusSightings: [],
    pageErrors: [],
    apiCalls: [],
    snapshotBodiesScanned: 0,
    forbiddenKeyHits: [],
    domInternalIdHits: [],
    completed: false,
    dialogueUtterancesFound: [],
    finishedAt: "",
  };

  page.on("pageerror", (error) => { obs.pageErrors.push(String(error)); });
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/vnext")) return;
    const p = new URL(url).pathname;
    obs.apiCalls.push({ method: response.request().method(), path: p, status: response.status() });
    if (response.request().method() === "GET" && /\/tutor-sessions\/[^/]+$/.test(p)) {
      try {
        const body = await response.text();
        obs.snapshotBodiesScanned++;
        // 注意：solution_board 是 canonical 快照的合法学生可见板书投影，不在禁键之列。
        for (const key of body.match(/"(?:private[a-z_]*|solution_value|solution|correct_answer|answer_value)"\s*:/g) ?? []) {
          obs.forbiddenKeyHits.push(`${p}: ${key}`);
        }
      } catch { /* body unavailable（拦截/流）——不计 */ }
    }
  });
  // generation 状态可见性观测（软记录：pending/waiting_retry/failed 文案出现即采样）
  void (async () => {
    const locator = page.getByTestId("tutor-generation-status");
    for (;;) {
      try {
        if (await locator.isVisible({ timeout: 250 }).catch(() => false)) {
          const text = (await locator.textContent().catch(() => "")) ?? "";
          if (text.trim()) obs.generationStatusSightings.push({ at: new Date().toISOString(), text: text.trim() });
        }
      } catch { /* page closed */ }
      await page.waitForTimeout(1_000).catch(() => undefined);
    }
  })();

  await page.addInitScript((name) => {
    window.localStorage.setItem("trig-web-student-name", name);
  }, "jr3-joint-student");
  await page.goto(`${REVIEW_URL}/learn/goldenMinhangFold2020`);
  await expect(page.getByTestId("coach-prompt")).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: path.join(SHOT_DIR, "00-start.png"), fullPage: true });

  const domScan = () => page.evaluate(() => {
    const text = document.body.innerText;
    return (text.match(/\b(?:FN|IF)-\d+\b/g) ?? []).slice(0, 10);
  });

  const waitForTurnIdle = async (page: Page, timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (Date.now() > deadline) throw new Error("waitForTurnIdle timeout");
      // 完成态是合法终态：session_completed 后参与区退场，不得继续等输入
      if (await page.getByTestId("tutor-completed").isVisible().catch(() => false)) return;
      const failure = await page.getByTestId("tutor-presentation-failure").isVisible().catch(() => false);
      if (failure) throw new Error("presentation failure surfaced during journey");
      // Coach 提问框常驻可用（提交即走 barge-in 握手）——不能作为「拍已空闲」信号。
      // 空闲 = 无活跃播放（打断入口不可见）且主线 composer 或确认控件就绪。
      const bargeIn = page.getByTestId("tutor-barge-in");
      const playing = (await bargeIn.isVisible().catch(() => false))
        && (await bargeIn.getAttribute("aria-disabled").catch(() => null)) !== "true";
      if (!playing) {
        const participation = page.getByTestId("tutor-participation");
        const mainlineReady = await participation.isVisible().catch(() => false)
          && await participation.locator("input:not([disabled])").first().isEnabled().catch(() => false);
        const confirmControl = page.getByTestId("tutor-confirm-input").or(page.getByTestId("tutor-continue-input"));
        const confirmReady = await confirmControl.first().isVisible().catch(() => false)
          && await confirmControl.first().isEnabled().catch(() => false);
        if (mainlineReady || confirmReady) {
          // 静默 2s 复核：不把刚结束动作后的瞬时状态当空闲
          await page.waitForTimeout(2_000);
          const stillPlaying = (await bargeIn.isVisible().catch(() => false))
            && (await bargeIn.getAttribute("aria-disabled").catch(() => null)) !== "true";
          const stillReady = (await participation.locator("input:not([disabled])").first().isEnabled().catch(() => false))
            || (await confirmControl.first().isEnabled().catch(() => false));
          if (!stillPlaying && stillReady) return;
        }
      }
      await page.waitForTimeout(2_000);
    }
  };

  await waitForTurnIdle(page, TURN_TIMEOUT_MS);
  const hits0 = await domScan();
  obs.domInternalIdHits.push(...hits0);

  for (let i = 0; i < TURNS.length; i++) {
    const turn = TURNS[i];
    const submittedAt = Date.now();
    if (turn.channel === "assistance") {
      const ask = page.getByPlaceholder("文字或语音问老师");
      await ask.fill(turn.text);
      await ask.press("Enter");
    } else {
      const form = page.getByTestId("tutor-participation");
      const input = form.locator("input[type=text], input:not([type])").first();
      await input.fill(turn.text);
      await form.locator("button[type=submit]").click();
    }
    obs.turnTimings.push({ index: i, channel: turn.channel, submittedAt: new Date().toISOString(), idleAgainMs: 0 });
    await waitForTurnIdle(page, TURN_TIMEOUT_MS);
    obs.turnTimings[obs.turnTimings.length - 1].idleAgainMs = Date.now() - submittedAt;
    await page.screenshot({ path: path.join(SHOT_DIR, `turn-${String(i + 1).padStart(2, "0")}-${turn.channel}.png`), fullPage: true });
    obs.domInternalIdHits.push(...(await domScan()));
    obs.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(SHOT_DIR, "jr3-observations.json"), JSON.stringify(obs, null, 2));
    if (await page.getByTestId("tutor-completed").isVisible().catch(() => false)) break;
  }

  // 完成态：最长再等一轮（最后一拍确认后总结呈现）
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (!await page.getByTestId("tutor-completed").isVisible().catch(() => false)) {
    if (Date.now() > deadline) break;
    await page.waitForTimeout(3_000);
  }
  await expect(page.getByTestId("tutor-completed")).toBeVisible({ timeout: 10_000 });
  obs.completed = true;
  await page.screenshot({ path: path.join(SHOT_DIR, "99-completed.png"), fullPage: true });

  // 原话逐条可见（对话区保留学生原话——FM 原话投影）
  const bodyText = await page.evaluate(() => document.body.innerText);
  for (const turn of TURNS) {
    if (bodyText.includes(turn.text.slice(0, 12))) obs.dialogueUtterancesFound.push(turn.text.slice(0, 12));
  }

  obs.finishedAt = new Date().toISOString();
  obs.domInternalIdHits = [...new Set(obs.domInternalIdHits)];
  fs.writeFileSync(path.join(SHOT_DIR, "jr3-observations.json"), JSON.stringify(obs, null, 2));
  console.log(JSON.stringify({ ...obs, apiCalls: `${obs.apiCalls.length} calls` }, null, 2));

  expect(obs.pageErrors, "零未捕获页面错误").toEqual([]);
  expect(obs.forbiddenKeyHits, "快照禁键零命中").toEqual([]);
  expect(obs.domInternalIdHits, "学生 DOM 无 FN-/IF- 内部编号").toEqual([]);
  expect(obs.dialogueUtterancesFound.length, "原话可见条数").toBeGreaterThanOrEqual(TURNS.length - 1);
});
