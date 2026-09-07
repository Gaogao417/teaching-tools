/**
 * F7 P3（FM-3-2 autoplay 受阻）：组件级证据。
 *
 * 如实登记（为什么不是 L3 浏览器证据）：本机 Playwright headless Chromium
 * 无法通过启动策略强制 autoplay 阻塞——`--autoplay-policy=user-gesture-required`
 * 与 `--autoplay-policy=document-user-activation-required` 下 headless 播放仍
 * 放行（probe 实测，见 p3-media-autoplay.spec.ts 头注）；伪造 play() 拒绝冒充
 * 浏览器证据被任务纪律禁止。本文件在组件级锁定 UI 接线：
 * - pending voice 呈现时 play() 被拒 → awaiting-gesture 状态 + 「开始播放」
 *   手势恢复入口（不误报 presentation failure / 协议错误 / 学生错误）；
 * - 点击恢复 → 同一播放链继续（presenting，MediaSource/audio 元素复用——
 *   不重挂）。adapter/runtime 层的 blocked→resume→presented outcome 链已由
 *   voicePresentationAdapter.test / PresentationRuntimeController.test 锁定。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../../api/client", () => ({
  api: {
    startLearnExperience: vi.fn(),
    getTutorSession: vi.fn(),
    submitTutorTurn: vi.fn(),
    completeTutorVoice: vi.fn(),
    completeTutorSession: vi.fn(),
    tutorAsr: vi.fn(),
    streamActionSpeech: vi.fn().mockResolvedValue({ audioUrl: "blob:narration-test" }),
    recordSimilarityLearnProgress: vi.fn().mockResolvedValue({ ok: true }),
  },
  ResponseSchemaError: class extends Error {},
}));

const { TutorLearnExperience } = await import("../TutorLearnExperience");
import type { TutorRuntimeClient } from "../../../api/tutorRuntimeClient";
const { RUNTIME_TASK_ID, validRuntimeSnapshot } = await import("../../../action-runtime/tutor/__tests__/runtimeSnapshotFixture");
import type { TaskId } from "../../../../../shared/contracts";

function makeClient(): { client: TutorRuntimeClient; mocks: Record<string, ReturnType<typeof vi.fn>> } {
  const mocks = {
    availability: vi.fn(),
    start: vi.fn(),
    restore: vi.fn(),
    submitStudentInput: vi.fn(),
    submitActionEvidence: vi.fn(),
    submitWorkspaceCommand: vi.fn(),
    reportPresentationOutcome: vi.fn(),
    transcribe: vi.fn(),
  };
  return { client: mocks as unknown as TutorRuntimeClient, mocks };
}

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;
const originalPlay = HTMLMediaElement.prototype.play;

function mountExperience(client: TutorRuntimeClient): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  void act(() => root!.render(
    <BrowserRouter>
      <TutorLearnExperience
        taskId={RUNTIME_TASK_ID as TaskId}
        studentId="autoplay-component-student"
        onLegacy={() => undefined}
        runtimeClient={client}
      />
    </BrowserRouter>,
  ));
}

async function waitForDom(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = undefined;
  container?.remove();
  container = undefined;
  HTMLMediaElement.prototype.play = originalPlay;
});

describe("TutorLearnExperience：autoplay 受阻 UI 接线（FM-3-2 组件级）", () => {
  it("play() 被拒 → awaiting-gesture + 手势恢复入口；零 failure 误报；恢复后同链继续", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    // 首次 play() 被浏览器策略拒绝（autoplay blocked）；恢复后放行。
    const play = vi.fn()
      .mockRejectedValueOnce(new DOMException("play() failed because the user didn't interact", "NotAllowedError"))
      .mockResolvedValue(undefined);
    HTMLMediaElement.prototype.play = play as unknown as typeof HTMLMediaElement.prototype.play;
    mountExperience(client);
    // 阻塞 → awaiting-gesture 状态（暂停，非 failure）+ 恢复入口。
    await waitForDom(() => container!.querySelector('[data-testid="tutor-presentation"][data-presentation-phase="awaiting-gesture"]') !== null);
    expect(container!.querySelector('[data-testid="tutor-presentation-resume"]')).not.toBeNull();
    // 不误报 failure（blocked 不计 failure——fault matrix FM-3-2「禁止」列）。
    expect(container!.querySelector('[data-testid="tutor-presentation-failure"]')).toBeNull();
    expect(container!.querySelector('[data-testid="tutor-protocol-error"]')).toBeNull();
    expect(container!.querySelector('[data-testid="tutor-error"]')).toBeNull();
    // 零 outcome 上报（未 presented、也未 failed）。
    expect(mocks.reportPresentationOutcome).not.toHaveBeenCalled();
    // 手势恢复：点击「开始播放」→ 同一播放链继续（presenting）。
    await act(async () => {
      (container!.querySelector('[data-testid="tutor-presentation-resume"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await waitForDom(() => container!.querySelector('[data-testid="tutor-presentation"][data-presentation-phase="presenting"]') !== null);
    expect(play).toHaveBeenCalledTimes(2); // 同一 audio 元素复用（无重挂新流）
    // 恢复后仍零 failure 误报。
    expect(container!.querySelector('[data-testid="tutor-presentation-failure"]')).toBeNull();
  });
});
