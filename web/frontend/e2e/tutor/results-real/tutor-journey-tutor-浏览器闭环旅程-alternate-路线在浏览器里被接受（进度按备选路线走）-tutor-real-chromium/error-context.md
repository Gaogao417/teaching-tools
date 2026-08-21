# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tutor-journey.spec.ts >> tutor 浏览器闭环旅程 >> alternate 路线在浏览器里被接受（进度按备选路线走）
- Location: e2e/tutor/specs/tutor-journey.spec.ts:88:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('tutor-state')
Expected substring: "等你发言"
Received string:    "老师讲解中（可打断）"
Timeout: 30000ms

Call log:
  - Expect "toContainText" with timeout 30000ms
  - waiting for getByTestId('tutor-state')
    63 × locator resolved to <span data-testid="tutor-state">老师讲解中（可打断）</span>
       - unexpected value "老师讲解中（可打断）"

```

```yaml
- text: 老师讲解中（可打断）
```

# Test source

```ts
  1   | /**
  2   |  * tutor 完整旅程 E2E（Phase 5 remediation 波次 E §3.6）：
  3   |  * 进入会话 → 回答推进 → 提问打断 → hint 后自答 → 操作步完成 → 刷新恢复；
  4   |  * 全程断言前端从未收到 localTruth/teachingInput/expectedValues。
  5   |  */
  6   | import { expect, test } from "@playwright/test";
  7   | 
  8   | import {
  9   |   alternateUtterance,
  10  |   answer,
  11  |   ask,
  12  |   deviationUtterance,
  13  |   expectNoTruthLeak,
  14  |   installTutorHarness,
  15  |   loadGoldenPlan,
  16  |   progressUntilWorkspace,
  17  |   readTranscriptTexts,
  18  |   submitWorkspace,
  19  | } from "./tutorHarness";
  20  | 
  21  | test.describe("tutor 浏览器闭环旅程", () => {
  22  |   test("进入 → 回答推进 → 提问 → 打断 → hint 后自答 → 操作步 → 刷新恢复", async ({ page }, testInfo) => {
  23  |     const plan = loadGoldenPlan("TP-SMV-001");
  24  |     await installTutorHarness(page, testInfo);
  25  | 
  26  |     // 1. 进入会话：开场讲解出现在对话记录。
  27  |     await page.goto("/tutor/TP-SMV-001");
  28  |     await expect(page.getByTestId("tutor-session-id")).toBeVisible({ timeout: 90_000 });
  29  |     await expect(page.getByTestId("tutor-state")).toContainText(/等你发言|讲解中/, { timeout: 100_000 });
  30  |     await page.waitForFunction(
  31  |       () => (document.querySelectorAll("[data-testid=tutor-transcript] p").length ?? 0) > 0,
  32  |       undefined,
  33  |       { timeout: 20_000 },
  34  |     );
  35  | 
  36  |     // 2. 回答推进：期望推理 → confirm + 进度前移。
  37  |     const checkpointText = await page.getByTestId("tutor-checkpoint").innerText();
  38  |     const firstCheckpoint = /CP\d+/.exec(checkpointText)![0];
  39  |     await answer(page, plan.checkpoints.find((entry) => entry.checkpoint_id === firstCheckpoint)!.expected_reasoning);
  40  |     // 模型无关断言：fake 的 model-generated 文案与 deterministic 降级脚手架都接受。
  41  |     await expect(page.getByTestId("tutor-transcript")).toContainText(/这一步成立|借助提示|很好|对，/, { timeout: 100_000 });
  42  | 
  43  |     // 3. 提问：老师回答（explain.answer_question），提问不悬挂。
  44  |     await ask(page, "这一步为什么要看这两个三角形？");
  45  |     await expect(page.getByTestId("tutor-state")).toContainText("等你发言", { timeout: 100_000 });
  46  | 
  47  |     // 4. 打断（barge-in 按钮）：老师讲解时可打断，之后能继续。
  48  |     //    （TTS 被 CI stub 成 failed，speaking 瞬态；用恢复面验证打断语义可用。）
  49  |     const beforeInterrupt = await readTranscriptTexts(page);
  50  |     expect(beforeInterrupt.length).toBeGreaterThan(0);
  51  | 
  52  |     // 5. 挣扎（deviation）→ hint/prompt 阶梯 → 自答（expected）继续推进。
  53  |     const struggle = deviationUtterance(plan);
  54  |     await answer(page, struggle);
  55  |     await page.waitForTimeout(800);
  56  |     const nextCheckpointText = await page.getByTestId("tutor-checkpoint").innerText();
  57  |     const nextCheckpoint = /CP\d+/.exec(nextCheckpointText)![0];
  58  |     await answer(page, plan.checkpoints.find((entry) => entry.checkpoint_id === nextCheckpoint)!.expected_reasoning);
  59  |     await expect(page.getByTestId("tutor-state")).toContainText("等你发言", { timeout: 100_000 });
  60  | 
  61  |     // 6. 操作步：推进到 workspace 节点，学生正确操作被接受。
  62  |     await progressUntilWorkspace(page, plan);
  63  |     await expect(page.locator(".tutor-workspace")).toBeVisible();
  64  | 
  65  |     // 7. 刷新恢复：pending workspace 从 GET :sessionId 恢复（不靠内存重建）。
  66  |     const sessionId = await page.getByTestId("tutor-session-id").innerText();
  67  |     await page.reload();
  68  |     await expect(page.getByTestId("tutor-session-id")).toHaveText(sessionId, { timeout: 30_000 });
  69  |     await expect(page.locator(".tutor-workspace")).toBeVisible({ timeout: 20_000 });
  70  | 
  71  |     // 8. 完成操作步：读 plan 的期望值从服务端判定（前端不持有 truth——
  72  |     //    证据值由 E2E 从 canonical plan 文件派生，属测试侧而非页面侧）。
  73  |     const actionResource = plan.resources.find((entry) => entry.kind === "action_template");
  74  |     const template = JSON.parse(actionResource?.content ?? "{}") as {
  75  |       teachingInput?: { expectedValues?: string[] };
  76  |     };
  77  |     // 先交一个错答（evaluator 拒绝、会话不崩），再交正确值。
  78  |     await submitWorkspace(page, "错误答案");
  79  |     await page.waitForTimeout(600);
  80  |     await expect(page.getByTestId("tutor-state")).not.toContainText("完成", { timeout: 5_000 }).catch(() => undefined);
  81  |     await submitWorkspace(page, template.teachingInput?.expectedValues?.[0] ?? "1");
  82  |     await expect(page.getByTestId("tutor-state")).toContainText(/等你发言|完成/, { timeout: 20_000 });
  83  | 
  84  |     // 9. 全程无 truth 泄漏。
  85  |     expectNoTruthLeak(page);
  86  |   });
  87  | 
  88  |   test("alternate 路线在浏览器里被接受（进度按备选路线走）", async ({ page }, testInfo) => {
  89  |     const plan = loadGoldenPlan("TP-SMV-001");
  90  |     const alternate = alternateUtterance(plan);
  91  |     test.skip(!alternate, "plan 无 alternate entry_condition");
  92  |     await installTutorHarness(page, testInfo);
  93  |     await page.goto("/tutor/TP-SMV-001");
> 94  |     await expect(page.getByTestId("tutor-state")).toContainText("等你发言", { timeout: 30_000 });
      |                                                   ^ Error: expect(locator).toContainText(expected) failed
  95  |     await answer(page, alternate!);
  96  |     await page.waitForTimeout(800);
  97  |     const checkpointText = await page.getByTestId("tutor-checkpoint").innerText();
  98  |     expect(checkpointText).toContain("路线 R2");
  99  |     expectNoTruthLeak(page);
  100 |   });
  101 | });
  102 | 
```