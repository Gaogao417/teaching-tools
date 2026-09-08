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

const lifetimes=vi.hoisted(()=>({mounts:0,unmounts:0,cancels:0}));
vi.mock('../../../presentation/coach/useCoachRecorder',async()=>{const{useEffect,useCallback}=await import('react');return{useCoachRecorder:(options:{owner:string})=>{useEffect(()=>{if(options.owner==='answer')lifetimes.mounts++;return()=>{if(options.owner==='answer')lifetimes.unmounts++;};},[]);const cancel=useCallback(()=>{if(options.owner==='answer')lifetimes.cancels++;},[]);return{recording:false,toggle:async()=>{},stop:()=>{},cancel};}};});
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


it('mainline recorder persists across temporary listen UI and cancels only real unmount',async()=>{
 const{client,mocks}=makeClient();mocks.start.mockResolvedValue(validRuntimeSnapshot({participationKind:'confirm_input',revision:12}));mocks.submitStudentInput.mockResolvedValue(validRuntimeSnapshot({participationKind:'listen_only',revision:13}));mountExperience(client);
 await waitForDom(()=>!!container?.querySelector('[data-testid="tutor-feedback-mic"]'));const mounted=lifetimes.mounts,unmounted=lifetimes.unmounts;
 await act(async()=>{(container!.querySelector('[data-testid="tutor-confirm-input"]') as HTMLButtonElement).click();});
 await waitForDom(()=>!container?.querySelector('[data-testid="tutor-feedback-mic"]'));expect(lifetimes.mounts).toBe(mounted);expect(lifetimes.unmounts).toBe(unmounted);
 await act(async()=>root!.unmount());root=undefined;expect(lifetimes.unmounts).toBe(unmounted+1);
});
