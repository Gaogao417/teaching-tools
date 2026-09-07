/** C3 browser UI + exact HTTP payload evidence. Route responses are scripted;
 * this suite does NOT prove backend semantics, approval, real model, mic or ASR quality.
 */
import { expect, test, type Page } from "@playwright/test";
import { validRuntimeSnapshot, RUNTIME_TASK_ID } from "../../../src/action-runtime/tutor/__tests__/runtimeSnapshotFixture";
import { parseSessionSnapshotHttp } from "../../../../shared/tutorHttpProfile";

type Snapshot = ReturnType<typeof validRuntimeSnapshot>;
interface InputRequest { input: { kind: string; channel?: string; text?: string; command?: string }; expected_revision: number; client_request_id: string }
function confirmSnapshot(beat = 1, revision = 12): Snapshot {
  const snapshot = validRuntimeSnapshot({ participationKind: "confirm_input", revision });
  const gate = `GT-0${beat}`; const beatId = `BT-0${beat}`;
  if (snapshot.views.participation.kind !== "confirm_input" || snapshot.views.student_workspace_view.participation.kind !== "confirm_input") throw new Error("Expected confirm fixture");
  snapshot.views.participation.gate_id = gate;
  snapshot.views.student_workspace_view.participation.gate_id = gate;
  snapshot.views.coach_panel_view.mainline = { kind: "awaiting_confirmation", beat_id: beatId, gate_id: gate };
  snapshot.views.coach_panel_view.teaching_context = { beat_id: beatId, waiting_for: "学生理解反馈" };
  snapshot.views.coach_panel_view.transcript = [{ turn_id: `DT-C3-000${beat}`, role: "tutor", content: `浏览器测试第 ${beat} 拍：说说你是否跟上。` }];
  const parsed = parseSessionSnapshotHttp(snapshot);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.snapshot as Snapshot;
}
async function installHarness(page: Page, initial: Snapshot, next: (request: InputRequest, index: number) => Snapshot) {
  let current = initial;
  const inputs: InputRequest[] = [];
  const otherPosts: string[] = [];
  await page.addInitScript(() => localStorage.setItem("trig-web-student-name", "C3 UI harness"));
  await page.route("**/api/vnext/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.includes("/availability/")) {
      await route.fulfill({ json: { task_id: RUNTIME_TASK_ID, enabled: true, profile: "f7-tutor-runtime-http/v1" } }); return;
    }
    if (request.method() === "GET" || path.endsWith("/tutor-sessions")) {
      await route.fulfill({ status: request.method() === "POST" ? 201 : 200, json: current }); return;
    }
    if (path.endsWith("/student-inputs")) {
      const body = request.postDataJSON() as InputRequest; inputs.push(body);
      current = next(body, inputs.length - 1);
      await route.fulfill({ json: current }); return;
    }
    otherPosts.push(path);
    await route.fulfill({ status: 500, json: { error: { code: "UNEXPECTED_UI_REQUEST", message: path } } });
  });
  return { inputs, otherPosts };
}
async function open(page: Page) {
  await page.goto(`/learn/${RUNTIME_TASK_ID}`);
  await expect(page.getByTestId("tutor-protocol-error")).toHaveCount(0);
}

test("six mocked confirm Beats accept natural text without fixed action controls and preserve every utterance", async ({ page }, testInfo) => {
  const texts = ["这一步懂了，继续", "对应角相等，所以两个三角形相似，这个关系我接上了", "比例这一步听懂了", "我跟上了这四段长度的关系", "这里的蝶形相似我理解了", "整条推理我能跟上了"];
  const harness = await installHarness(page, confirmSnapshot(), (_request, index) =>
    index === 5 ? validRuntimeSnapshot({ participationKind: "read_only_completed", revision: 18 }) : confirmSnapshot(index + 2, 13 + index));
  await open(page);
  for (const [index, text] of texts.entries()) {
    await expect(page.getByRole("textbox", { name: "理解反馈输入" })).toBeEnabled();
    await expect(page.getByTestId("tutor-confirm-input")).toBeEnabled();
    await expect(page.getByTestId("tutor-submit-answer")).toHaveCount(0);
    await expect(page.locator(".action-runtime-frame, .action-runtime-workspace")).toHaveCount(0);
    await page.getByRole("textbox", { name: "理解反馈输入" }).fill(text);
    if (index % 2 === 0) await page.getByRole("textbox", { name: "理解反馈输入" }).press("Enter");
    else await page.getByTestId("tutor-submit-feedback").click();
    await expect.poll(() => harness.inputs.length).toBe(index + 1);
    expect(harness.inputs[index]).toEqual({ input: { kind: "utterance", channel: "mainline", text }, expected_revision: 12 + index, client_request_id: expect.any(String) });
    if (index < 5) await expect(page.getByRole("textbox", { name: "理解反馈输入" })).toBeEnabled();
  }
  await expect(page.getByTestId("tutor-completed")).toBeVisible();
  expect(harness.otherPosts).toEqual([]);
  expect(new Set(harness.inputs.map((input) => input.client_request_id)).size).toBe(6);
  await testInfo.attach("mock-http-utterances", { body: JSON.stringify(harness.inputs, null, 2), contentType: "application/json" });
});

test("ambiguous, contradictory and not-understood text stays raw; only mocked server response changes participation", async ({ page }, testInfo) => {
  const texts = ["这一步还没懂", "懂了，所以这两条边是相等的", "不会算，你算给我看", "跳过这一段"];
  const harness = await installHarness(page, confirmSnapshot(), () => confirmSnapshot());
  await open(page);
  for (const [index, text] of texts.entries()) {
    await page.getByRole("textbox", { name: "理解反馈输入" }).fill(text);
    await page.getByTestId("tutor-submit-feedback").click();
    await expect.poll(() => harness.inputs.length).toBe(index + 1);
    expect(harness.inputs[index].input).toEqual({ kind: "utterance", channel: "mainline", text });
    await expect(page.getByTestId("tutor-submit-feedback")).toBeVisible();
    await expect(page.getByTestId("tutor-completed")).toHaveCount(0);
  }
  expect(harness.otherPosts).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("confirm-natural-feedback.png"), fullPage: true });
});

test("convenience confirm and separate question composer remain optional usable entries", async ({ page }) => {
  const harness = await installHarness(page, confirmSnapshot(), () => confirmSnapshot());
  await open(page);
  await page.getByTestId("tutor-confirm-input").click();
  await expect.poll(() => harness.inputs.length).toBe(1);
  expect(harness.inputs[0].input).toEqual({ kind: "control", command: "confirm" });
  await page.locator(".topic-coach-question input").fill("这个比例怎么来的？");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await expect.poll(() => harness.inputs.length).toBe(2);
  expect(harness.inputs[1].input).toEqual({ kind: "utterance", channel: "assistance", text: "这个比例怎么来的？" });
  await expect(page.getByTestId("tutor-feedback-mic")).toBeEnabled();
  expect(harness.otherPosts).toEqual([]);
});

for (const participationKind of ["answer_input", "workspace_input"]) {
  test(`practice ${participationKind} does not gain a Teach confirmation bypass`, async ({ page }) => {
    const harness = await installHarness(page, validRuntimeSnapshot({ participationKind }), () => validRuntimeSnapshot({ participationKind }));
    await open(page);
    if (participationKind === "answer_input") await expect(page.getByTestId("tutor-submit-answer")).toBeVisible();
    else await expect(page.getByRole("region", { name: "Action 驱动学习工作台", exact: true })).toBeVisible();
    await expect(page.getByTestId("tutor-confirm-input")).toHaveCount(0);
    await expect(page.getByTestId("tutor-submit-feedback")).toHaveCount(0);
    await expect(page.getByTestId("tutor-feedback-mic")).toHaveCount(0);
    expect(harness.inputs).toEqual([]); expect(harness.otherPosts).toEqual([]);
  });
}
