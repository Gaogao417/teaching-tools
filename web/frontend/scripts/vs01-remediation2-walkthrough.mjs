/**
 * VS1 remediation-2 人工验收取证脚本（mvp/reports/vs-01-remediation-2.md §4/§5）。
 *
 * 按用户十步验收清单在真实浏览器采集证据（截图 + aria snapshot + 交互事实
 * JSON + 网络写入计数），产物落 PRD 仓库 vs-01-evidence/remediation2/。
 * 这是取证工具，不是 CI 门禁（门禁在 e2e/tutor/specs/vs01-remediation2.spec.ts）。
 *
 * 前置（复现命令）：
 *   # candidate 链（golden root 后端 + 前端）
 *   (cd web/backend && FRONTEND_ORIGIN="http://localhost:5175,..." PORT=3001 \
 *      TUTOR_CANONICAL_ROOT=<golden root> npx tsx src/index.ts &)
 *   (cd web/frontend && npx vite --host 127.0.0.1 --port 5175 --strictPort &)
 *   # reference 链（无 canonical root → legacy canonical Coach）
 *   (cd web/backend && FRONTEND_ORIGIN="http://localhost:5199,..." PORT=3222 npx tsx src/index.ts &)
 *   (cd web/frontend && VITE_API_BASE_URL=http://localhost:3222 npx vite --port 5199 --strictPort &)
 *   node scripts/vs01-remediation2-walkthrough.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const EVIDENCE_DIR = "/Users/gaochong/develop/ai_teaching_prds_v2_00-07/mvp/reports/vs-01-evidence/remediation2";
const CANDIDATE_BASE = process.env.WALKTHROUGH_CANDIDATE ?? "http://localhost:5175";
const REFERENCE_BASE = process.env.WALKTHROUGH_REFERENCE ?? "http://localhost:5199";
const CANDIDATE_TASK = "goldenMinhangCross2020";
const GOLDEN_PLAN_DIR = process.env.WALKTHROUGH_GOLDEN_PLAN ?? "/tmp/vs01-golden-root-ety9/tutor-plan/TP-SMV-002";

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const facts = { generatedAt: new Date().toISOString(), candidate: {}, reference: {}, steps: {} };
const write = (name, body) => fs.writeFileSync(path.join(EVIDENCE_DIR, name), body);

function loadGoldenPlan() {
  const versions = fs.readdirSync(GOLDEN_PLAN_DIR).filter((name) => name.endsWith(".json")).sort();
  return JSON.parse(fs.readFileSync(path.join(GOLDEN_PLAN_DIR, versions.at(-1)), "utf8"));
}

const expectedUtterance = (plan, checkpointId) =>
  plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)?.expected_reasoning ?? "嗯，我想想";

async function continueThroughNarration(page, maxClicks = 30) {
  for (let index = 0; index < maxClicks; index += 1) {
    const understood = page.getByTestId("coach-understood");
    if (!(await understood.count())) return;
    if (await understood.isDisabled().catch(() => true)) return;
    await understood.click();
    await page.waitForTimeout(300);
  }
}

async function tutorPhase(page) {
  return (await page.locator("[data-tutor-phase]").getAttribute("data-tutor-phase")) ?? "";
}

async function coachFacts(page) {
  return {
    phase: await tutorPhase(page),
    session: await page.locator(".tutor-learn-page[data-session-id]").getAttribute("data-session-id"),
    checkpoint: await page.locator("[data-checkpoint-id]").getAttribute("data-checkpoint-id"),
    progress: await page.getByTestId("coach-progress").innerText().catch(() => null),
    title: await page.getByTestId("coach-title").innerText().catch(() => null),
    prompt: await page.getByTestId("coach-prompt").innerText().catch(() => null),
  };
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.addInitScript(
  (name) => localStorage.setItem("trig-web-student-name", name),
  "vs01-remediation2",
);
let turnPosts = 0;
const inputKinds = [];
page.on("request", (request) => {
  if (request.method() !== "POST" || !/\/tutor-sessions\/[^/]+\/turns/.test(request.url())) return;
  turnPosts += 1;
  try {
    inputKinds.push((request.postDataJSON()).input?.input_kind ?? "?");
  } catch { /* 非 JSON 忽略 */ }
});

try {
  // ---------------------------------------------------------------- reference
  // VS0-REQ-09 交互基线：点击结果与状态断言（不只截图）。
  await page.goto(`${REFERENCE_BASE}/learn/auxiliaryTwoRatios?acceptance=1`);
  await page.locator(".topic-coach-panel").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  facts.reference.initial = {
    progress: await page.locator(".topic-coach-panel small").first().innerText().catch(() => null),
    title: await page.locator(".topic-coach-panel strong").first().innerText().catch(() => null),
  };
  const referenceBefore = await page.locator(".topic-action-playback-position").innerText().catch(() => null);
  // reference 的「明白，继续」= runtime.advanceTeaching（本地 presentation advance）。
  await page.getByRole("button", { name: "明白，继续" }).click().catch(() => undefined);
  await page.waitForTimeout(800);
  facts.reference.advance = {
    positionBefore: referenceBefore,
    positionAfter: await page.locator(".topic-action-playback-position").innerText().catch(() => null),
  };
  await page.getByRole("button", { name: "这步没懂" }).click().catch(() => undefined);
  await page.waitForTimeout(600);
  facts.reference.confused = {
    threadTurns: await page.locator(".topic-coach-turn").count(),
  };
  await page.getByRole("button", { name: "收起指导栏" }).click().catch(() => undefined);
  await page.waitForTimeout(400);
  const referenceExpandLabel = (await page.locator(".topic-coach-dock-avatar").getAttribute("aria-label")) ?? null;
  await page.locator(".topic-coach-dock-avatar").click().catch(() => undefined);
  await page.waitForTimeout(400);
  facts.reference.collapseExpand = {
    collapsedTriggerLabel: referenceExpandLabel,
    reopened: await page.locator(".topic-coach-panel").isVisible(),
  };
  write("vs01-r2-reference-coach.png", await page.screenshot({ fullPage: true }));
  write("vs01-r2-reference-aria.yml", await page.locator(".ks-app-shell").ariaSnapshot());

  // ---------------------------------------------------------------- candidate
  await page.goto(`${CANDIDATE_BASE}/learn/${CANDIDATE_TASK}?acceptance=1`);
  await page.locator(".tutor-learn-page[data-session-id]").waitFor({ timeout: 60_000 });
  await page.getByTestId("coach-progress").waitFor({ timeout: 30_000 });

  // 步骤 2/3：信息结构 + 步骤 10 负面。
  const initial = await coachFacts(page);
  facts.candidate.initial = initial;
  facts.steps.negatives = {
    modeToggle: await page.locator(".tutor-learn-composer-mode").count(),
    quickAsks: await page.locator(".tutor-learn-quick-asks").count(),
    customRail: await page.locator(".tutor-learn-rail").count(),
  };
  write("vs01-r2-candidate-teach.png", await page.screenshot({ fullPage: true }));
  write("vs01-r2-candidate-teach-aria.yml", await page.locator(".ks-app-shell").ariaSnapshot());

  // 步骤 4：明白，继续恰一步（开场多段话术）。
  const understood = page.getByTestId("coach-understood");
  const promptBeforeAdvance = initial.prompt;
  if ((await understood.count()) && !(await understood.isDisabled().catch(() => true))) {
    await understood.click();
    await page.waitForTimeout(800);
    facts.steps.advanceOnce = {
      promptBefore: promptBeforeAdvance,
      promptAfter: (await coachFacts(page)).prompt,
      stillGated: !(await understood.isDisabled().catch(() => true)),
    };
  }
  await continueThroughNarration(page);
  await page.locator("[data-tutor-phase]").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);

  // 步骤 5：这步没懂 → 停留当前拍 + 解释。
  const beforeConfused = await coachFacts(page);
  const postsBeforeConfused = turnPosts;
  await page.getByTestId("coach-confused").click();
  await page.waitForTimeout(600);
  facts.steps.confused = {
    before: beforeConfused,
    inputKind: inputKinds.at(-1),
    posts: turnPosts - postsBeforeConfused,
  };
  await continueThroughNarration(page);
  await page.waitForTimeout(600);
  facts.steps.confused.after = await coachFacts(page);
  facts.steps.confused.threadHasQuestion = await page
    .locator("[aria-label='答疑对话']").innerText().then((t) => t.includes("（问）我没听懂这一步")).catch(() => false);

  // 步骤 6 + 负面①：重播/上一拍纯回看（零写入）。
  const beforeReview = await coachFacts(page);
  const revisionBefore = await page.evaluate(() =>
    (window).__tutorWorkspaceView?.revision ?? -1);
  const postsBeforeReview = turnPosts;
  await page.getByLabel("重播当前 Action 讲解").click().catch(() => undefined);
  const prevButton = page.getByLabel("上一个 Action");
  if (await prevButton.isEnabled().catch(() => false)) await prevButton.click().catch(() => undefined);
  await page.waitForTimeout(600);
  facts.steps.reviewOnly = {
    before: beforeReview,
    revisionBefore,
    revisionAfter: await page.evaluate(() => (window).__tutorWorkspaceView?.revision ?? -1),
    posts: turnPosts - postsBeforeReview,
    after: await coachFacts(page),
  };

  // 步骤 7：收起/展开状态保持。
  const beforeCollapse = await coachFacts(page);
  const threadCountBefore = await page.locator("[aria-label='答疑对话'] .topic-coach-turn").count();
  await page.getByLabel("收起指导栏").click();
  await page.waitForTimeout(400);
  const collapsed = await page.locator(".ks-focus-rail-drawer").getAttribute("class");
  await page.locator("button[aria-label='展开陪练老师']").click();
  await page.waitForTimeout(400);
  facts.steps.collapseExpand = {
    before: beforeCollapse,
    drawerClassWhenCollapsed: collapsed,
    after: await coachFacts(page),
    threadCountBefore,
    threadCountAfter: await page.locator("[aria-label='答疑对话'] .topic-coach-turn").count(),
  };

  // 步骤 8：刷新恢复同拍。
  await page.reload();
  await page.locator(".tutor-learn-page[data-session-id]").waitFor({ timeout: 60_000 });
  await page.getByTestId("coach-progress").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  facts.steps.refresh = await coachFacts(page);
  write("vs01-r2-candidate-refresh.png", await page.screenshot({ fullPage: true }));

  // 步骤 9：推进到操作步（同 Panel）。
  const plan = loadGoldenPlan();
  for (let index = 0; index < 40 && !(await page.getByTestId("action-runtime-workspace").count()); index += 1) {
    // 真 TTS 时长下每回合音频较长：等静息（awaitingInput/操作步）再动。
    await page.waitForFunction(() => {
      const phase = document.querySelector(".tutor-learn-page")?.getAttribute("data-tutor-phase") ?? "";
      return phase === "awaitingInput" || phase === "workspaceActive";
    }, undefined, { timeout: 45_000 }).catch(() => undefined);
    if (await page.getByTestId("action-runtime-workspace").count()) break;
    if ((await tutorPhase(page)) === "speaking") { await continueThroughNarration(page); continue; }
    if ((await tutorPhase(page)) !== "awaitingInput") continue;
    await page.waitForTimeout(400);
    const checkpointId = /CP\d+/.exec((await page.locator("[data-checkpoint-id]").getAttribute("data-checkpoint-id")) ?? "")?.[0];
    if (!checkpointId) break;
    const input = page.getByLabel("回答输入");
    await input.waitFor({ timeout: 30_000 });
    await input.fill(expectedUtterance(plan, checkpointId));
    await page.getByTestId("tutor-submit-answer").click();
    await continueThroughNarration(page);
  }
  await page.getByTestId("action-runtime-workspace").waitFor({ timeout: 30_000 });
  facts.steps.operate = await coachFacts(page);
  facts.steps.operatePanelVisible = await page.locator(".topic-coach-panel").isVisible();
  facts.steps.operateAnswerEntryAbsent = (await page.getByLabel("回答输入").count()) === 0;
  write("vs01-r2-candidate-operate.png", await page.screenshot({ fullPage: true }));
  write("vs01-r2-candidate-operate-aria.yml", await page.locator(".ks-app-shell").ariaSnapshot());

  facts.candidate.inputKinds = inputKinds;
  facts.candidate.turnPosts = turnPosts;
  write("vs01-r2-walkthrough-facts.json", JSON.stringify(facts, null, 2));
  console.log(JSON.stringify({ ok: true, steps: Object.keys(facts.steps), negatives: facts.steps.negatives }, null, 2));
} catch (error) {
  facts.error = String(error);
  write("vs01-r2-walkthrough-facts.json", JSON.stringify(facts, null, 2));
  console.error("WALKTHROUGH FAILED:", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
