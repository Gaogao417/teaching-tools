/**
 * F7 P3（FM-3-2 autoplay 受阻）：组件级证据。
 *
 * 此处用 mock play() 拒绝锁定组件接线，不计真实浏览器证据。
 * 浏览器策略与真实恢复单列于 p3-media-autoplay.spec.ts：完整 Chromium、
 * 有效 MP3、无 trace 激活干扰，只有真实 NotAllowedError 才满足前置条件。
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

it("outcome network failure exposes retry button; click resends receipt without replay",async()=>{
 const {client,mocks}=makeClient();
 mocks.start.mockResolvedValue(validRuntimeSnapshot({pendingPresentation:true,revision:12}));
 mocks.reportPresentationOutcome.mockRejectedValueOnce(new TypeError("Failed to fetch"));
 let acknowledge!: (value:unknown)=>void;
 mocks.reportPresentationOutcome.mockImplementationOnce(()=>new Promise(resolve=>acknowledge=resolve));
 const play=vi.fn(function(this:HTMLMediaElement){queueMicrotask(()=>this.dispatchEvent(new Event("ended")));return Promise.resolve();});
 HTMLMediaElement.prototype.play=play;
 mountExperience(client);
 await waitForDom(()=>container!.querySelector('[data-testid="tutor-outcome-retry"]')!==null);
 expect(container!.querySelector('[data-testid="tutor-protocol-error"]')).toBeNull();
 const first=structuredClone(mocks.reportPresentationOutcome.mock.calls[0]);
 await act(async()=>{(container!.querySelector('[data-testid="tutor-outcome-retry"]') as HTMLButtonElement).click();});
 await waitForDom(()=>mocks.reportPresentationOutcome.mock.calls.length===2);
 expect(container!.querySelector('[data-testid="tutor-outcome-retry"]')).toBeNull();
 expect(mocks.reportPresentationOutcome.mock.calls[1]).toEqual(first);
 await act(async()=>acknowledge(validRuntimeSnapshot({revision:13})));
 expect(play).toHaveBeenCalledTimes(1);expect(mocks.restore).not.toHaveBeenCalled();
});


it("restored confirm kind cannot expose mainline input until pending presentation is acknowledged", async () => {
  const { client, mocks } = makeClient();
  mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, participationKind: "confirm_input", revision: 12 }));
  let nativeAudio: HTMLMediaElement | undefined;
  HTMLMediaElement.prototype.play = vi.fn(function (this: HTMLMediaElement) {
    nativeAudio = this;
    return Promise.resolve();
  });
  let acknowledge!: (value: unknown) => void;
  mocks.reportPresentationOutcome.mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
  mountExperience(client);
  await waitForDom(() => nativeAudio !== undefined);
  expect(container!.querySelector('[data-testid="tutor-confirm-input"]')).toBeNull();
  expect(container!.querySelector('[aria-label="理解反馈输入"]')).toBeNull();
  await act(async () => { nativeAudio!.dispatchEvent(new Event("ended")); });
  await waitForDom(() => mocks.reportPresentationOutcome.mock.calls.length === 1);
  // ended alone does not enable confirmation: the acknowledgement is still pending.
  expect(container!.querySelector('[data-testid="tutor-confirm-input"]')).toBeNull();
  await act(async () => { acknowledge(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 13 })); });
  await waitForDom(() => container!.querySelector('[data-testid="tutor-confirm-input"]') !== null);
  expect(mocks.submitStudentInput).not.toHaveBeenCalled();
});
