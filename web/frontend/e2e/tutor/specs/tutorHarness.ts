/**
 * tutor E2E 共用 harness（Phase 5 remediation 波次 E/F4）。
 *
 * - 读 canonical golden plan 派生输入（与 acceptanceScripts 同规则：不引入
 *   人工标签）；
 * - 拦截 TTS（CI 不访问 CosyVoice；exit run 才走真实链路）；
 * - 断言前端从未收到答案真值（localTruth/teachingInput/expectedValues）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";

const canonicalRoot =
  process.env.TUTOR_E2E_CANONICAL_ROOT ||
  "/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring";

const FORBIDDEN_TRUTH_KEYS = ["localTruth", "teachingInput", "expectedValues"];

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

/** 只拦 TTS（真实 exit run 时 TUTOR_E2E_REAL=1 放行真实 CosyVoice）；
 *  其余网络原样放行并全程嗅探 truth 泄漏。 */
export async function installTutorHarness(page: Page, testInfo: TestInfo): Promise<void> {
  const violations: string[] = [];
  if (!process.env.TUTOR_E2E_REAL) {
    await page.route(/\/api\/action-speech(-stream)?$/, async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TTS_UNAVAILABLE", message: "CI stub" } }) });
    });
  }
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/tutor-sessions") && !url.includes("/api/action-speech")) return;
    try {
      const body = await response.text();
      for (const key of FORBIDDEN_TRUTH_KEYS) {
        if (body.includes(`"${key}"`)) violations.push(`${response.status()} ${url} 含 ${key}`);
      }
    } catch {
      /* 流式/空体忽略 */
    }
  });
  await testInfo.attach("tutor-e2e-harness", { body: "TTS stubbed; truth sniffing active", contentType: "text/plain" });
  (page as unknown as { __truthViolations: string[] }).__truthViolations = violations;
}

export function expectNoTruthLeak(page: Page): void {
  const violations = (page as unknown as { __truthViolations?: string[] }).__truthViolations ?? [];
  expect(violations, `前端收到答案真值：${violations.join("; ")}`).toHaveLength(0);
}

/** 等 tutor 进入某个状态（speaking 瞬态可能跳过，轮询等待）。真实 exit run
 *  的 CosyVoice 播放是真时长——超时按 5× 放宽（TUTOR_E2E_REAL=1）。 */
export const e2eTimeout = (ms: number): number => (process.env.TUTOR_E2E_REAL ? ms * 5 : ms);

export async function waitForTutorState(page: Page, state: string, timeout = 20_000): Promise<void> {
  await expect(page.getByTestId("tutor-state")).toContainText(state === "awaitingInput" ? "等你发言" : stateLabel(state), { timeout: e2eTimeout(timeout) });
}

function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    starting: "正在开始",
    speaking: "讲解中",
    thinking: "思考中",
    workspaceActive: "轮到你操作",
    interrupted: "已打断",
    recovering: "恢复中",
    completed: "完成",
  };
  return labels[state] ?? state;
}

export async function answer(page: Page, text: string): Promise<void> {
  await page.getByLabel("回答输入").fill(text);
  await page.getByTestId("tutor-submit-answer").click();
}

export async function ask(page: Page, text: string): Promise<void> {
  await page.getByLabel("提问输入").fill(text);
  await page.getByTestId("tutor-submit-question").click();
}

/** 提交 workspace 证据（enter-text 文本框或 select-option 按钮）。 */
export async function submitWorkspace(page: Page, value: string): Promise<void> {
  const input = page.getByLabel("workspace 答案输入");
  if (await input.count()) {
    await input.fill(value);
    await page.getByRole("button", { name: "提交这一步" }).click();
    return;
  }
  await page.locator(".tutor-workspace-options button", { hasText: value }).first().click();
}

export async function readTranscriptTexts(page: Page): Promise<string[]> {
  return page.locator("[data-testid=tutor-transcript] p").allInnerTexts();
}

/** 期望 utterance 驱动直至出现 workspace 或超轮数（action 节点前逐 checkpoint）。 */
export async function progressUntilWorkspace(
  page: Page,
  plan: GoldenPlanShape,
  options?: { maxTurns?: number },
): Promise<void> {
  const maxTurns = options?.maxTurns ?? 12;
  for (let index = 0; index < maxTurns; index += 1) {
    if (await page.locator(".tutor-workspace").count()) return;
    const texts = await readTranscriptTexts(page);
    if (texts.some((text) => text.includes("交给你操作"))) {
      await expect(page.locator(".tutor-workspace")).toBeVisible({ timeout: e2eTimeout(15_000) });
      return;
    }
    if ((await page.getByTestId("tutor-state").innerText()).includes("等你发言")) {
      const checkpointText = await page.getByTestId("tutor-checkpoint").innerText();
      const checkpointId = /CP\d+/.exec(checkpointText)?.[0];
      if (!checkpointId) break;
      await answer(page, expectedUtterance(plan, checkpointId));
    }
    await page.waitForTimeout(300);
  }
  await expect(page.locator(".tutor-workspace")).toBeVisible({ timeout: e2eTimeout(15_000) });
}
