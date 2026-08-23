/**
 * tutor E2E 共用 harness（Phase 5 UI 集成波次 C：/learn/:taskId 驱动）。
 *
 * - 隔离演示页 /tutor/:tpId 已删除：所有场景从原产品学习页进入
 *   （/experience + Approved Binding；合成 canonical root，plan 数据派生输入）；
 * - 拦截 TTS（CI 不访问 CosyVoice；exit run 才走真实链路）；
 * - 断言前端从未收到答案真值（localTruth/teachingInput/expectedValues），
 *   且前端请求中不出现硬编码 TP/QT/AS id。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";

const canonicalRoot = process.env.TUTOR_E2E_CANONICAL_ROOT || "";
if (!canonicalRoot || !fs.existsSync(path.join(canonicalRoot, "tutor-plan"))) {
  throw new Error(`TUTOR_E2E_CANONICAL_ROOT 未指向含 tutor-plan 的合成 root：${canonicalRoot}`);
}

const FORBIDDEN_TRUTH_KEYS = ["localTruth", "teachingInput", "expectedValues"];
/** 前端不得硬编码内容对象 id（计划 §5：ScenarioSelector 是选择权威）。 */
const FORBIDDEN_ID_PREFIXES = ["TP-", "QT-", "AS-", "TB-"];

export interface E2eTaskSpec {
  taskId: string;
  scenarioId: string;
  qtId: string;
  tpId: string;
  alternateTpId?: string;
  action: "enter-text" | "select-option" | "make-parallel";
}

/** 与 backend scripts/build-tutor-e2e-root.ts 的 E2E_TASKS 保持一致。 */
export const E2E_TASKS: E2eTaskSpec[] = [
  { taskId: "parallelLineRatios", scenarioId: "SC-E2E-001", qtId: "QT-E2E-001", tpId: "TP-E2E-001", alternateTpId: "TP-E2E-101", action: "enter-text" },
  { taskId: "auxiliaryTwoRatios", scenarioId: "SC-E2E-002", qtId: "QT-E2E-002", tpId: "TP-E2E-002", action: "enter-text" },
  { taskId: "reverseASimilarity", scenarioId: "SC-E2E-003", qtId: "QT-E2E-003", tpId: "TP-E2E-003", action: "enter-text" },
  { taskId: "nestedSimilarity", scenarioId: "SC-E2E-004", qtId: "QT-E2E-004", tpId: "TP-E2E-004", action: "enter-text" },
  { taskId: "butterflySimilarity", scenarioId: "SC-E2E-005", qtId: "QT-E2E-005", tpId: "TP-E2E-005", action: "select-option" },
  { taskId: "reverseAFourSimilarity", scenarioId: "SC-E2E-006", qtId: "QT-E2E-006", tpId: "TP-E2E-006", action: "make-parallel" },
];

/**
 * 波次 D golden 任务集：与 backend scripts/build-tutor-golden-root.ts 的
 * GOLDEN_TASKS 保持一致（真实 golden v3 Plan——全部 enter-text、无
 * alternate 讲法、无 authored geometry 模板）。TUTOR_E2E_TASK_SET=golden
 * 时启用（TUTOR_E2E_CANONICAL_ROOT 需指向预构建 golden root）；默认合成集。
 * task id 为测试借位（教师裁定 2026-08-23：每个 golden 题是独立新 Topic，
 * 不绑定既有 topic；/learn/:taskId 驱动需要真实 TaskDefinition，新 Topic
 * 创建前暂借既有相似 task 作浏览器入口）。
 */
export const GOLDEN_TASKS: E2eTaskSpec[] = [
  { taskId: "parallelLineRatios", scenarioId: "SC-GOLDEN-001", qtId: "QT-SMV-001", tpId: "TP-SMV-001", action: "enter-text" },
  { taskId: "butterflySimilarity", scenarioId: "SC-GOLDEN-002", qtId: "QT-SMV-002", tpId: "TP-SMV-002", action: "enter-text" },
  { taskId: "nestedSimilarity", scenarioId: "SC-GOLDEN-003", qtId: "QT-SMV-003", tpId: "TP-SMV-003", action: "enter-text" },
  { taskId: "reverseASimilarity", scenarioId: "SC-GOLDEN-004", qtId: "QT-SMV-004", tpId: "TP-SMV-004", action: "enter-text" },
  { taskId: "auxiliaryTwoRatios", scenarioId: "SC-GOLDEN-005", qtId: "QT-SMV-005", tpId: "TP-SMV-005", action: "enter-text" },
  { taskId: "reverseAFourSimilarity", scenarioId: "SC-GOLDEN-006", qtId: "QT-SMV-006", tpId: "TP-SMV-006", action: "enter-text" },
];

/** 当前任务集（TUTOR_E2E_TASK_SET=golden → golden 真实内容；否则合成集）。 */
export const ACTIVE_TASKS: E2eTaskSpec[] =
  process.env.TUTOR_E2E_TASK_SET === "golden" ? GOLDEN_TASKS : E2E_TASKS;

export interface GoldenPlanShape {
  artifact_id: string;
  checkpoints: Array<{
    checkpoint_id: string;
    part_id: string;
    expected_reasoning: string;
    accepted_alternatives?: string[];
    common_deviations?: string[];
  }>;
  resources: Array<{ resource_id: string; kind: string; checkpoint_id?: string; assistance_level?: number; content?: string }>;
  recommended_routes: Array<{ route_id: string; role: string; part_id?: string; entry_condition?: string; checkpoint_ids: string[] }>;
}

export function loadGoldenPlan(tpId: string): GoldenPlanShape {
  const dir = path.join(canonicalRoot, "tutor-plan", tpId);
  const versions = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return JSON.parse(fs.readFileSync(path.join(dir, versions.at(-1)!), "utf8")) as GoldenPlanShape;
}

export function expectedUtterance(plan: GoldenPlanShape, checkpointId: string): string {
  return plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)!.expected_reasoning;
}

export function deviationUtterance(plan: GoldenPlanShape): string {
  const checkpoint = plan.checkpoints.find((entry) => (entry.common_deviations ?? []).length > 0);
  return checkpoint?.common_deviations?.[0] ?? "嗯……我不太确定这一步该怎么下手";
}

export function alternateUtterance(plan: GoldenPlanShape): string | undefined {
  const route = plan.recommended_routes.find((entry) => entry.role === "alternate" && entry.entry_condition);
  return route?.entry_condition;
}

/** 学生身份预置（WorkspaceShell AuthModal 需要 studentName）。 */
export async function prepareStudent(page: Page, studentName = "e2e-student"): Promise<void> {
  await page.addInitScript((name) => {
    window.localStorage.setItem("trig-web-student-name", name);
  }, studentName);
}

/** 只拦 TTS（真实 exit run 时 TUTOR_E2E_REAL=1 放行真实 CosyVoice）；
 *  其余网络原样放行并全程嗅探 truth 泄漏与硬编码内容 id。 */
export async function installTutorHarness(page: Page, testInfo: TestInfo): Promise<void> {
  const violations: string[] = [];
  if (process.env.TUTOR_E2E_DEBUG) {
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.startsWith("[tutor-page]")) console.log(text);
    });
  }
  if (!process.env.TUTOR_E2E_REAL) {
    await page.route(/\/api\/action-speech(-stream)?$/, async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TTS_UNAVAILABLE", message: "CI stub" } }) });
    });
  }
  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/api/learn") && !url.includes("/api/tutor-sessions")) return;
    for (const prefix of FORBIDDEN_ID_PREFIXES) {
      if (url.includes(`=${prefix}`) || url.includes(`/${prefix}`)) violations.push(`请求硬编码内容 id：${url}`);
    }
  });
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/learn") && !url.includes("/api/tutor-sessions") && !url.includes("/api/action-speech")) return;
    try {
      const body = await response.text();
      if (process.env.TUTOR_E2E_DEBUG) {
        try {
          const parsed = JSON.parse(body) as { decision?: { purpose_code?: string } | null; workspace?: unknown[]; current_checkpoint?: { checkpoint_id?: string } };
          if (parsed && (parsed.decision !== undefined || parsed.workspace !== undefined)) {
            console.log(`[tutor] ${response.status()} ${url.split("/api")[-1] ?? url} ${parsed.decision?.purpose_code ?? "-"} ws:${parsed.workspace?.length ?? "-"} ${parsed.current_checkpoint?.checkpoint_id ?? ""}`);
          }
        } catch {
          /* 非 JSON 忽略 */
        }
      }
      for (const key of FORBIDDEN_TRUTH_KEYS) {
        if (body.includes(`"${key}"`)) violations.push(`${response.status()} ${url} 含 ${key}`);
      }
    } catch {
      /* 流式/空体忽略 */
    }
  });
  await testInfo.attach("tutor-e2e-harness", { body: "TTS stubbed; truth & hardcoded-id sniffing active", contentType: "text/plain" });
  (page as unknown as { __truthViolations: string[] }).__truthViolations = violations;
}

export function expectNoTruthLeak(page: Page): void {
  const violations = (page as unknown as { __truthViolations?: string[] }).__truthViolations ?? [];
  expect(violations, `前端收到答案真值或硬编码 id：${violations.join("; ")}`).toHaveLength(0);
}

/** 等 tutor 进入某个状态（speaking 瞬态可能跳过，轮询等待）。真实 exit run
 *  的 CosyVoice 播放是真时长——超时按 5× 放宽（TUTOR_E2E_REAL=1）。 */
export const e2eTimeout = (ms: number): number => (process.env.TUTOR_E2E_REAL ? ms * 5 : ms);

const STATE_LABELS: Record<string, string> = {
  starting: "正在开始",
  speaking: "讲解中",
  thinking: "思考中",
  workspaceActive: "轮到你操作",
  interrupted: "已打断",
  recovering: "恢复中",
  completed: "完成",
};

export async function waitForTutorState(page: Page, state: string, timeout = 20_000): Promise<void> {
  await expect(page.getByTestId("tutor-state")).toContainText(state === "awaitingInput" ? "等你发言" : STATE_LABELS[state] ?? state, { timeout: e2eTimeout(timeout) });
}

/** 从学习地图入口进 /learn/:taskId（始终在原 WorkspaceShell 内）。 */
export async function openLearnTask(page: Page, taskId: string): Promise<void> {
  await page.goto(`/learn/${taskId}`);
  await expect(page.getByTestId("tutor-session-id")).toBeVisible({ timeout: 30_000 });
  await waitForTutorState(page, "awaitingInput");
  await expect(page.locator(".ks-app-shell")).toBeVisible();
}

export function currentCheckpoint(page: Page): Promise<string> {
  return page.getByTestId("tutor-checkpoint").innerText().then((text) => /CP\d+/.exec(text)![0]);
}

export async function answer(page: Page, text: string): Promise<void> {
  // composer 是「回答/提问」单输入切换：先确保回答模式（提问后回答回用）。
  await page.getByRole("button", { name: "回答", exact: true }).first().click();
  await page.getByLabel("回答输入").fill(text);
  await page.getByTestId("tutor-submit-answer").click();
}

export async function ask(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: "提问", exact: true }).first().click();
  await page.getByLabel("提问输入").fill(text);
  await page.getByTestId("tutor-submit-question").click();
}

export async function readTranscriptTexts(page: Page): Promise<string[]> {
  return page.locator("[data-testid=tutor-transcript] p").allInnerTexts();
}

/** workspace 步出现（真实 ActionRuntimeFrame 挂载）。 */
export async function waitForWorkspace(page: Page, timeout = 15_000): Promise<void> {
  await expect(page.getByTestId("action-runtime-workspace")).toBeVisible({ timeout: e2eTimeout(timeout) });
}

/** 期望 utterance 驱动直至出现 workspace 或超轮数（action 节点前逐 checkpoint）。 */
export async function progressUntilWorkspace(
  page: Page,
  plan: GoldenPlanShape,
  options?: { maxTurns?: number },
): Promise<void> {
  const maxTurns = options?.maxTurns ?? 24;
  for (let index = 0; index < maxTurns; index += 1) {
    if (await page.getByTestId("action-runtime-workspace").count()) return;
    const state = await page.getByTestId("tutor-state").innerText();
    if (state.includes("轮到你操作")) {
      await waitForWorkspace(page);
      return;
    }
    if (state.includes("等你发言")) {
      // checkpoint 显示随回合异步更新：等一拍再读，避免拿到上一个 checkpoint。
      await page.waitForTimeout(400);
      const checkpointText = await page.getByTestId("tutor-checkpoint").innerText();
      const checkpointId = /CP\d+/.exec(checkpointText)?.[0];
      if (!checkpointId) break;
      await answer(page, expectedUtterance(plan, checkpointId));
      await waitForTutorState(page, "awaitingInput", 25_000).catch(() => undefined);
    }
    await page.waitForTimeout(300);
  }
  await waitForWorkspace(page);
}

/** 提交 workspace 证据（真实 ActionRuntimeFrame）：
 *  enter-text → 答案槽输入 + 确认；select-option → 选项按钮（value 缺省
 *  点第一个——正确值应由调用方从 canonical plan 派生）；make-parallel →
 *  画布实体点选（through point + reference line）。 */
export async function submitWorkspace(page: Page, task: E2eTaskSpec, value?: string): Promise<void> {
  await waitForWorkspace(page);
  const input = page.locator("input[id^='action-slot-']");
  if (await input.count()) {
    await input.first().fill(value ?? "1");
    await page.getByRole("button", { name: "确认" }).click();
    return;
  }
  const options = page.locator(".topic-choice-grid button");
  if (await options.count()) {
    if (value) {
      await page.locator(`.topic-choice-grid button[data-option-value="${value}"]`).first().click();
    } else {
      await options.first().click();
    }
    // select-option 走 form 机：选项后需「确认」提交（submitOnComplete 的
    // 机型会先行自提交，确认按钮消失则跳过）。
    await page.getByRole("button", { name: "确认" }).click().catch(() => undefined);
    return;
  }
  await submitGeometry(page, value);
}

/** make-parallel：先点 through point，再点 reference line。value 为
 *  `{ pointId, lineId }` JSON（e2e 从 canonical plan 的 teachingInput 派生
 *  正误——测试侧不持 truth，页面侧更不持）。 */
async function submitGeometry(page: Page, value?: string): Promise<void> {
  const parsed = value
    ? (JSON.parse(value) as { pointId: string; lineId: string })
    : { pointId: "C", lineId: "AB" };
  await clickRenderedEntity(page, parsed.pointId);
  await page.waitForTimeout(250);
  await clickRenderedEntity(page, parsed.lineId);
}

/** 波次 F：按 `data-geometry-id` 锚定真实渲染位置点击——不再重算
 *  world→pixel 坐标约定（旧公式 Y 轴翻转，曾致画布点选长期空转并被
 *  脱节标签误绿）。点：元素 rect 中心；线：rect 中心（线段外接矩形
 *  的中心必在线上——水平/垂直线有一维为 0，不能用 Playwright 的
 *  visibility 判定）。 */
async function clickRenderedEntity(page: Page, geometryId: string): Promise<void> {
  const canvas = page.locator(".geometry-canvas__board");
  await expect(canvas).toBeVisible();
  const entity = canvas.locator(`[data-geometry-id="${geometryId}"]`);
  await expect(entity).toBeAttached({ timeout: 15_000 });
  const rect = await entity.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  if (rect.width <= 0 && rect.height <= 0) {
    throw new Error(`geometry entity ${geometryId} 渲染尺寸为零`);
  }
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}
