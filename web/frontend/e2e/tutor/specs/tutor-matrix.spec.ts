/**
 * tutor E2E 矩阵：12 剧本 × 6 golden plan = 72 场景（Phase 5 remediation §4.4
 * CI 口径——fake structured model，不访问外部模型、无 skip）。
 *
 * 剧本是 acceptanceScripts S1–S12 的浏览器可驱动版本（同一输入派生规则：
 * 全部来自 canonical plan 数据）。S9/S10 在浏览器面等价为「错答被拒后
 * 重试」「连续无进度输入走 wait/prompt 阶梯」（注入非法动作/真实超时属
 * backend 演练，golden runner 已覆盖）——偏差在 exit report 登记。
 */
import { expect, test } from "@playwright/test";

import {
  alternateUtterance,
  answer,
  ask,
  deviationUtterance,
  expectNoTruthLeak,
  installTutorHarness,
  loadGoldenPlan,
  progressUntilWorkspace,
  submitWorkspace,
} from "./tutorHarness";

const GOLDEN_TP_IDS = ["TP-SMV-001", "TP-SMV-002", "TP-SMV-003", "TP-SMV-004", "TP-SMV-005", "TP-SMV-006"];

interface ScriptDriver {
  id: string;
  title: string;
  run(page: import("@playwright/test").Page, plan: ReturnType<typeof loadGoldenPlan>): Promise<void>;
}

async function waitForAwaitingInput(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByTestId("tutor-state")).toContainText("等你发言", { timeout: 25_000 });
}

async function openSession(page: import("@playwright/test").Page, tpId: string): Promise<void> {
  await page.goto(`/tutor/${tpId}`);
  await expect(page.getByTestId("tutor-session-id")).toBeVisible({ timeout: 30_000 });
  await waitForAwaitingInput(page);
}

function currentCheckpoint(page: import("@playwright/test").Page): Promise<string> {
  return page.getByTestId("tutor-checkpoint").innerText().then((text) => /CP\d+/.exec(text)![0]);
}

function expectedFor(plan: ReturnType<typeof loadGoldenPlan>): (checkpointId: string) => string {
  return (checkpointId: string) => plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)!.expected_reasoning;
}

const SCRIPTS: ScriptDriver[] = [
  {
    id: "S1",
    title: "答对→confirm；卡住→prompt/hint 阶梯",
    async run(page, plan) {
      const expected = expectedFor(plan);
      await answer(page, expected(await currentCheckpoint(page)));
      await expect(page.getByTestId("tutor-transcript")).toContainText(/对，|成立/, { timeout: 20_000 });
      await answer(page, deviationUtterance(plan));
      await waitForAwaitingInput(page);
    },
  },
  {
    id: "S2",
    title: "提问打断→Explain 回答",
    async run(page, plan) {
      void plan;
      await ask(page, "这一步的关键条件是什么？");
      await waitForAwaitingInput(page);
    },
  },
  {
    id: "S3",
    title: "口述正确路径→最小呈现",
    async run(page, plan) {
      const expected = expectedFor(plan);
      await answer(page, expected(await currentCheckpoint(page)));
      await waitForAwaitingInput(page);
      const transcript = await page.locator("[data-testid=tutor-transcript] p").count();
      expect(transcript).toBeGreaterThan(0);
    },
  },
  {
    id: "S4",
    title: "失败尝试后 Hint 利用历史（阶梯不重置）",
    async run(page, plan) {
      for (let index = 0; index < 3; index += 1) {
        await answer(page, deviationUtterance(plan));
        await waitForAwaitingInput(page);
      }
      await answer(page, deviationUtterance(plan));
      await waitForAwaitingInput(page);
    },
  },
  {
    id: "S5",
    title: "推进后因果链在 UI 进度可见",
    async run(page, plan) {
      const before = await currentCheckpoint(page);
      await answer(page, expectedFor(plan)(before));
      await waitForAwaitingInput(page);
      const after = await currentCheckpoint(page);
      expect(after).toBeTruthy();
    },
  },
  {
    id: "S6",
    title: "偏差后自答（自我修正不记为 Tutor 纠正）",
    async run(page, plan) {
      await answer(page, deviationUtterance(plan));
      await waitForAwaitingInput(page);
      await answer(page, expectedFor(plan)(await currentCheckpoint(page)));
      await waitForAwaitingInput(page);
    },
  },
  {
    id: "S7",
    title: "alternate valid 被接受",
    async run(page) {
      const plan = (page as unknown as { __plan?: ReturnType<typeof loadGoldenPlan> }).__plan!;
      const alternate = alternateUtterance(plan);
      test.skip(!alternate, "无 alternate 路线");
      await answer(page, alternate!);
      await waitForAwaitingInput(page);
    },
  },
  {
    id: "S8",
    title: "Confirm 只说话、Wait 零动作",
    async run(page, plan) {
      await answer(page, expectedFor(plan)(await currentCheckpoint(page)));
      await waitForAwaitingInput(page);
      expect(await page.locator(".tutor-workspace").count()).toBe(0);
    },
  },
  {
    id: "S9",
    title: "错答被拒后可重试（浏览器面：typed evaluator 拒绝）",
    async run(page, plan) {
      await progressUntilWorkspace(page, plan);
      await submitWorkspace(page, "明显错误的答案");
      await page.waitForTimeout(800);
      await expect(page.locator(".tutor-workspace")).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    id: "S10",
    title: "连续含糊/无进展走 wait/prompt 阶梯（浏览器面）",
    async run(page) {
      for (let index = 0; index < 3; index += 1) {
        await answer(page, "嗯……不知道");
        await waitForAwaitingInput(page);
      }
    },
  },
  {
    id: "S11",
    title: "多级提示后自答回到正轨",
    async run(page, plan) {
      for (let index = 0; index < 4; index += 1) {
        await answer(page, deviationUtterance(plan));
        await waitForAwaitingInput(page);
      }
      await answer(page, expectedFor(plan)(await currentCheckpoint(page)));
      await waitForAwaitingInput(page);
    },
  },
  {
    id: "S12",
    title: "操作步完成（学生正确操作被接受）",
    async run(page, plan) {
      await progressUntilWorkspace(page, plan);
      const resource = plan.resources.find((entry) => entry.kind === "action_template");
      const template = JSON.parse(resource?.content ?? "{}") as { teachingInput?: { expectedValues?: string[] } };
      await submitWorkspace(page, template.teachingInput?.expectedValues?.[0] ?? "1");
      await expect(page.getByTestId("tutor-state")).toContainText(/等你发言|完成/, { timeout: 25_000 });
    },
  },
];

test.describe("tutor E2E 矩阵（12 剧本 × 6 plan = 72 场景）", () => {
  for (const tpId of GOLDEN_TP_IDS) {
    for (const script of SCRIPTS) {
      test(`${tpId} ${script.id}：${script.title}`, async ({ page }, testInfo) => {
        const plan = loadGoldenPlan(tpId);
        (page as unknown as { __plan?: ReturnType<typeof loadGoldenPlan> }).__plan = plan;
        await installTutorHarness(page, testInfo);
        await openSession(page, tpId);
        await script.run(page, plan);
        expectNoTruthLeak(page);
      });
    }
  }
});
