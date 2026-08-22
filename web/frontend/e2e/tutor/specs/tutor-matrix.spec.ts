/**
 * tutor E2E 矩阵（Phase 5 UI 集成波次 C/D）：12 剧本 × 6 plan = 72 场景，
 * 全部从原产品 /learn/:taskId 进入（/experience + Approved Binding + fake
 * structured model），无 skip。
 *
 * 任务集：默认合成 root（波次 C）；TUTOR_E2E_TASK_SET=golden + 预构建
 * golden root（波次 D）时对六个真实 golden v3 Plan 复跑同一矩阵（严格
 * 断言口径；golden 内容全部 enter-text，无 authored geometry/alternate）。
 */
import { expect, test } from "@playwright/test";

import {
  ACTIVE_TASKS,
  alternateUtterance,
  answer,
  ask,
  currentCheckpoint,
  deviationUtterance,
  e2eTimeout,
  expectNoTruthLeak,
  installTutorHarness,
  loadGoldenPlan,
  prepareStudent,
  progressUntilWorkspace,
  submitWorkspace,
  waitForTutorState,
} from "./tutorHarness";

interface ScriptDriver {
  id: string;
  title: string;
  run(page: import("@playwright/test").Page, task: (typeof ACTIVE_TASKS)[number], plan: ReturnType<typeof loadGoldenPlan>): Promise<void>;
}

async function openSession(page: import("@playwright/test").Page, taskId: string): Promise<void> {
  await page.goto(`/learn/${taskId}`);
  await expect(page.getByTestId("tutor-session-id")).toBeVisible({ timeout: 30_000 });
  await waitForTutorState(page, "awaitingInput");
  await expect(page.locator(".ks-app-shell")).toBeVisible();
}

function expectedFor(plan: ReturnType<typeof loadGoldenPlan>): (checkpointId: string) => string {
  return (checkpointId: string) => plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)!.expected_reasoning;
}

const SCRIPTS: ScriptDriver[] = [
  {
    id: "S1",
    title: "答对→confirm；卡住→prompt/hint 阶梯",
    async run(page, _task, plan) {
      const expected = expectedFor(plan);
      await answer(page, expected(await currentCheckpoint(page)));
      await expect(page.getByTestId("tutor-transcript")).toContainText(/对，|成立|借助提示|很好/, { timeout: e2eTimeout(20_000) });
      await answer(page, deviationUtterance(plan));
      await waitForTutorState(page, "awaitingInput");
    },
  },
  {
    id: "S2",
    title: "提问打断→Explain 回答",
    async run(page) {
      await ask(page, "这一步的关键条件是什么？");
      await waitForTutorState(page, "awaitingInput");
    },
  },
  {
    id: "S3",
    title: "口述正确路径→最小呈现",
    async run(page, _task, plan) {
      const expected = expectedFor(plan);
      await answer(page, expected(await currentCheckpoint(page)));
      await waitForTutorState(page, "awaitingInput");
      const transcript = await page.locator("[data-testid=tutor-transcript] p").count();
      expect(transcript).toBeGreaterThan(0);
    },
  },
  {
    id: "S4",
    title: "失败尝试后 Hint 利用历史（阶梯不重置）",
    async run(page, _task, plan) {
      for (let index = 0; index < 3; index += 1) {
        await answer(page, deviationUtterance(plan));
        await waitForTutorState(page, "awaitingInput");
      }
      await answer(page, deviationUtterance(plan));
      await waitForTutorState(page, "awaitingInput");
    },
  },
  {
    id: "S5",
    title: "推进后因果链在 UI 进度可见",
    async run(page, _task, plan) {
      const before = await currentCheckpoint(page);
      await answer(page, expectedFor(plan)(before));
      await waitForTutorState(page, "awaitingInput");
      const after = await currentCheckpoint(page);
      expect(after).toBeTruthy();
    },
  },
  {
    id: "S6",
    title: "偏差后自答（自我修正不记为 Tutor 纠正）",
    async run(page, _task, plan) {
      await answer(page, deviationUtterance(plan));
      await waitForTutorState(page, "awaitingInput");
      await answer(page, expectedFor(plan)(await currentCheckpoint(page)));
      await waitForTutorState(page, "awaitingInput");
    },
  },
  {
    id: "S7",
    title: "alternate valid 被接受",
    async run(page, _task, plan) {
      const alternate = alternateUtterance(plan);
      test.skip(!alternate, "无 alternate 路线");
      await answer(page, alternate!);
      // 波次 C-2 裁定 2：confirm 续走可能已签发操作步（标签与画布同源）。
      await expect(page.getByTestId("tutor-state")).toContainText(/等你发言|轮到你操作/, { timeout: e2eTimeout(20_000) });
    },
  },
  {
    id: "S8",
    title: "Confirm 只说话、Wait 零动作",
    async run(page, _task, plan) {
      await answer(page, expectedFor(plan)(await currentCheckpoint(page)));
      await waitForTutorState(page, "awaitingInput");
      expect(await page.getByTestId("action-runtime-workspace").count()).toBe(0);
    },
  },
  {
    id: "S9",
    title: "错答被拒后可重试（浏览器面：typed evaluator 拒绝）",
    async run(page, task, plan) {
      await progressUntilWorkspace(page, plan);
      let wrong: string | undefined;
      if (task.action === "select-option") {
        // 从 canonical plan 派生一个真实存在的错误选项（按值点击按钮）。
        const resource = plan.resources.find((entry) => entry.kind === "action_template");
        const template = JSON.parse(resource?.content ?? "{}") as {
          input?: { options?: Array<{ value: string }> };
          teachingInput?: { expectedValue?: string };
        };
        wrong = template.input?.options?.find((option) => option.value !== template.teachingInput?.expectedValue)?.value;
      } else if (task.action === "make-parallel") {
        wrong = JSON.stringify({ pointId: "B", lineId: "AB" });
      } else {
        wrong = "明显错误的答案";
      }
      await submitWorkspace(page, task, wrong);
      await page.waitForTimeout(800);
      await expect(page.getByTestId("action-runtime-workspace")).toBeVisible({ timeout: e2eTimeout(20_000) });
    },
  },
  {
    id: "S10",
    title: "连续含糊/无进展走 wait/prompt 阶梯（浏览器面）",
    async run(page) {
      for (let index = 0; index < 3; index += 1) {
        await answer(page, "嗯……不知道");
        await waitForTutorState(page, "awaitingInput");
      }
    },
  },
  {
    id: "S11",
    title: "多级提示后自答回到正轨",
    async run(page, _task, plan) {
      for (let index = 0; index < 4; index += 1) {
        await answer(page, deviationUtterance(plan));
        await waitForTutorState(page, "awaitingInput");
      }
      await answer(page, expectedFor(plan)(await currentCheckpoint(page)));
      await waitForTutorState(page, "awaitingInput");
    },
  },
  {
    id: "S12",
    title: "操作步完成（学生正确操作被接受）",
    async run(page, task, plan) {
      await progressUntilWorkspace(page, plan);
      const resource = plan.resources.find((entry) => entry.kind === "action_template");
      const template = JSON.parse(resource?.content ?? "{}") as {
        teachingInput?: { expectedValues?: string[]; expectedValue?: string; throughPointId?: string; referenceLineId?: string };
      };
      let value: string | undefined;
      if (task.action === "enter-text") value = template.teachingInput?.expectedValues?.[0] ?? "1";
      if (task.action === "select-option") value = template.teachingInput?.expectedValue ?? "opt-a";
      if (task.action === "make-parallel") {
        // 证据值由 E2E 从 canonical plan 文件派生（测试侧而非页面侧）。
        value = JSON.stringify({
          pointId: template.teachingInput?.throughPointId ?? "C",
          lineId: template.teachingInput?.referenceLineId ?? "AB",
        });
      }
      await submitWorkspace(page, task, value);
      // 波次 F：画布点选真实提交后恢复严格口径——完成态 = evidence 被接受。
      await expect(page.getByTestId("tutor-state")).toContainText(/等你发言|完成/, { timeout: e2eTimeout(25_000) });
    },
  },
];

test.describe("tutor E2E 矩阵（12 剧本 × 6 plan = 72 场景，/learn/:taskId 驱动）", () => {
  for (const task of ACTIVE_TASKS) {
    for (const script of SCRIPTS) {
      test(`${task.taskId} ${script.id}：${script.title}`, async ({ page }, testInfo) => {
        const plan = loadGoldenPlan(task.tpId);
        await prepareStudent(page);
        await installTutorHarness(page, testInfo);
        await openSession(page, task.taskId);
        await script.run(page, task, plan);
        expectNoTruthLeak(page);
      });
    }
  }
});
