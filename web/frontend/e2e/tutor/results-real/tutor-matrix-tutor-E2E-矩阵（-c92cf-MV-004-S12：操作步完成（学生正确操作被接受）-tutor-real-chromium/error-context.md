# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tutor-matrix.spec.ts >> tutor E2E 矩阵（12 剧本 × 6 plan = 72 场景） >> TP-SMV-004 S12：操作步完成（学生正确操作被接受）
- Location: e2e/tutor/specs/tutor-matrix.spec.ts:184:7

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('tutor-state')
Expected substring: "等你发言"
Received string:    "老师讲解中（可打断）"
Timeout: 125000ms

Call log:
  - Expect "toContainText" with timeout 125000ms
  - waiting for getByTestId('tutor-state')
    252 × locator resolved to <span data-testid="tutor-state">老师讲解中（可打断）</span>
        - unexpected value "老师讲解中（可打断）"

```

```yaml
- text: 老师讲解中（可打断）
```

# Test source

```ts
  1   | /**
  2   |  * tutor E2E 矩阵：12 剧本 × 6 golden plan = 72 场景（Phase 5 remediation §4.4
  3   |  * CI 口径——fake structured model，不访问外部模型、无 skip）。
  4   |  *
  5   |  * 剧本是 acceptanceScripts S1–S12 的浏览器可驱动版本（同一输入派生规则：
  6   |  * 全部来自 canonical plan 数据）。S9/S10 在浏览器面等价为「错答被拒后
  7   |  * 重试」「连续无进度输入走 wait/prompt 阶梯」（注入非法动作/真实超时属
  8   |  * backend 演练，golden runner 已覆盖）——偏差在 exit report 登记。
  9   |  */
  10  | import { expect, test } from "@playwright/test";
  11  | 
  12  | import {
  13  |   e2eTimeout,
  14  |   alternateUtterance,
  15  |   answer,
  16  |   ask,
  17  |   deviationUtterance,
  18  |   expectNoTruthLeak,
  19  |   installTutorHarness,
  20  |   loadGoldenPlan,
  21  |   progressUntilWorkspace,
  22  |   submitWorkspace,
  23  | } from "./tutorHarness";
  24  | 
  25  | const GOLDEN_TP_IDS = ["TP-SMV-001", "TP-SMV-002", "TP-SMV-003", "TP-SMV-004", "TP-SMV-005", "TP-SMV-006"];
  26  | 
  27  | interface ScriptDriver {
  28  |   id: string;
  29  |   title: string;
  30  |   run(page: import("@playwright/test").Page, plan: ReturnType<typeof loadGoldenPlan>): Promise<void>;
  31  | }
  32  | 
  33  | async function waitForAwaitingInput(page: import("@playwright/test").Page): Promise<void> {
> 34  |   await expect(page.getByTestId("tutor-state")).toContainText("等你发言", { timeout: e2eTimeout(25_000) });
      |                                                 ^ Error: expect(locator).toContainText(expected) failed
  35  | }
  36  | 
  37  | async function openSession(page: import("@playwright/test").Page, tpId: string): Promise<void> {
  38  |   await page.goto(`/tutor/${tpId}`);
  39  |   await expect(page.getByTestId("tutor-session-id")).toBeVisible({ timeout: 30_000 });
  40  |   await waitForAwaitingInput(page);
  41  | }
  42  | 
  43  | function currentCheckpoint(page: import("@playwright/test").Page): Promise<string> {
  44  |   return page.getByTestId("tutor-checkpoint").innerText().then((text) => /CP\d+/.exec(text)![0]);
  45  | }
  46  | 
  47  | function expectedFor(plan: ReturnType<typeof loadGoldenPlan>): (checkpointId: string) => string {
  48  |   return (checkpointId: string) => plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)!.expected_reasoning;
  49  | }
  50  | 
  51  | const SCRIPTS: ScriptDriver[] = [
  52  |   {
  53  |     id: "S1",
  54  |     title: "答对→confirm；卡住→prompt/hint 阶梯",
  55  |     async run(page, plan) {
  56  |       const expected = expectedFor(plan);
  57  |       await answer(page, expected(await currentCheckpoint(page)));
  58  |       await expect(page.getByTestId("tutor-transcript")).toContainText(/对，|成立|借助提示|很好/, { timeout: e2eTimeout(20_000) });
  59  |       await answer(page, deviationUtterance(plan));
  60  |       await waitForAwaitingInput(page);
  61  |     },
  62  |   },
  63  |   {
  64  |     id: "S2",
  65  |     title: "提问打断→Explain 回答",
  66  |     async run(page, plan) {
  67  |       void plan;
  68  |       await ask(page, "这一步的关键条件是什么？");
  69  |       await waitForAwaitingInput(page);
  70  |     },
  71  |   },
  72  |   {
  73  |     id: "S3",
  74  |     title: "口述正确路径→最小呈现",
  75  |     async run(page, plan) {
  76  |       const expected = expectedFor(plan);
  77  |       await answer(page, expected(await currentCheckpoint(page)));
  78  |       await waitForAwaitingInput(page);
  79  |       const transcript = await page.locator("[data-testid=tutor-transcript] p").count();
  80  |       expect(transcript).toBeGreaterThan(0);
  81  |     },
  82  |   },
  83  |   {
  84  |     id: "S4",
  85  |     title: "失败尝试后 Hint 利用历史（阶梯不重置）",
  86  |     async run(page, plan) {
  87  |       for (let index = 0; index < 3; index += 1) {
  88  |         await answer(page, deviationUtterance(plan));
  89  |         await waitForAwaitingInput(page);
  90  |       }
  91  |       await answer(page, deviationUtterance(plan));
  92  |       await waitForAwaitingInput(page);
  93  |     },
  94  |   },
  95  |   {
  96  |     id: "S5",
  97  |     title: "推进后因果链在 UI 进度可见",
  98  |     async run(page, plan) {
  99  |       const before = await currentCheckpoint(page);
  100 |       await answer(page, expectedFor(plan)(before));
  101 |       await waitForAwaitingInput(page);
  102 |       const after = await currentCheckpoint(page);
  103 |       expect(after).toBeTruthy();
  104 |     },
  105 |   },
  106 |   {
  107 |     id: "S6",
  108 |     title: "偏差后自答（自我修正不记为 Tutor 纠正）",
  109 |     async run(page, plan) {
  110 |       await answer(page, deviationUtterance(plan));
  111 |       await waitForAwaitingInput(page);
  112 |       await answer(page, expectedFor(plan)(await currentCheckpoint(page)));
  113 |       await waitForAwaitingInput(page);
  114 |     },
  115 |   },
  116 |   {
  117 |     id: "S7",
  118 |     title: "alternate valid 被接受",
  119 |     async run(page) {
  120 |       const plan = (page as unknown as { __plan?: ReturnType<typeof loadGoldenPlan> }).__plan!;
  121 |       const alternate = alternateUtterance(plan);
  122 |       test.skip(!alternate, "无 alternate 路线");
  123 |       await answer(page, alternate!);
  124 |       await waitForAwaitingInput(page);
  125 |     },
  126 |   },
  127 |   {
  128 |     id: "S8",
  129 |     title: "Confirm 只说话、Wait 零动作",
  130 |     async run(page, plan) {
  131 |       await answer(page, expectedFor(plan)(await currentCheckpoint(page)));
  132 |       await waitForAwaitingInput(page);
  133 |       expect(await page.locator(".tutor-workspace").count()).toBe(0);
  134 |     },
```