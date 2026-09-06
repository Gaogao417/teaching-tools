import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaSessionController } from "../../audio/MediaSessionController";
import { useCoachRecorder } from "../useCoachRecorder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function RecorderHarness({ media, onError }: { media?: MediaSessionController; onError: (msg: string) => void }) {
  const { recording, toggle } = useCoachRecorder({
    disabled: false,
    media,
    onAudio: () => undefined,
    onError,
  });
  return (
    <button type="button" data-testid="toggle" data-recording={recording} onClick={() => { void toggle(); }} />
  );
}

async function renderHarness(media?: MediaSessionController) {
  const onError = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<RecorderHarness media={media} onError={onError} />));
  const toggle = () => container.querySelector<HTMLButtonElement>('[data-testid="toggle"]')!;
  return {
    onError,
    toggleButton: toggle,
    click: async () => { await act(async () => { toggle().click(); }); },
    unmount: async () => { await act(async () => root.unmount()); document.body.removeChild(container); },
  };
}

describe("useCoachRecorder capture lease (ADR-005 §Exclusive media session)", () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  let originalMediaRecorder: typeof globalThis.MediaRecorder | undefined;

  beforeEach(() => {
    originalMediaRecorder = globalThis.MediaRecorder;
    // A non-undefined MediaRecorder placeholder is enough to pass the support
    // guard; the permission/mutex paths reject before any MediaRecorder is built.
    globalThis.MediaRecorder = class DummyMediaRecorder { static isTypeSupported() { return false; } } as unknown as typeof MediaRecorder;
  });

  afterEach(() => {
    if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    if (originalMediaRecorder === undefined) delete (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    else globalThis.MediaRecorder = originalMediaRecorder;
  });

  function stubGetUserMedia(fn: () => Promise<MediaStream>) {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(fn) },
    });
  }

  it("a permission failure releases the lease and surfaces a message without throwing", async () => {
    const media = new MediaSessionController();
    stubGetUserMedia(() => Promise.reject(new Error("Permission denied")));

    const harness = await renderHarness(media);
    await harness.click();
    // Let the rejected getUserMedia microtask settle.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(harness.onError).toHaveBeenCalledWith("没有获得麦克风权限，请允许录音或改用文字提问。");
    // The mic is free again — the failed attempt did not strand the lease.
    expect(media.getCaptureOwner()).toBeUndefined();
    await harness.unmount();
    media.dispose();
  });

  it("does not call getUserMedia while a live session holds the mic (capture mutex)", async () => {
    const media = new MediaSessionController();
    const liveLease = media.acquireCapture("live");
    expect(liveLease).not.toBeNull();
    const getUserMedia = vi.fn(() => Promise.resolve(new MediaStream()));
    stubGetUserMedia(getUserMedia);

    const harness = await renderHarness(media);
    await harness.click();

    // The loser MUST NOT touch the microphone; it surfaces a message instead.
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(harness.onError).toHaveBeenCalledWith("实时通话正在进行，无法同时录音，请先结束通话。");
    // Live still owns the mic — the recorder did not steal or release it.
    expect(media.getCaptureOwner()).toBe("live");
    await harness.unmount();
    media.dispose();
  });

  it("acquires and releases the mic across a successful record stop (no stranded lease)", async () => {
    const media = new MediaSessionController();
    const tracks = [{ stop: vi.fn() }];
    const stream = { getTracks: () => tracks } as unknown as MediaStream;
    stubGetUserMedia(() => Promise.resolve(stream));
    // Provide a real-enough MediaRecorder so onstop fires and releases the lease.
    let onstop: (() => void) | null = null;
    globalThis.MediaRecorder = class {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor() { onstop = null; }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        // Mirror the recorder wiring: it assigns onstop then we invoke it.
        queueMicrotask(() => this.onstop?.());
      }
      static isTypeSupported() { return true; }
    } as unknown as typeof MediaRecorder;

    const harness = await renderHarness(media);
    await harness.click(); // start
    expect(media.getCaptureOwner()).toBe("coach-turn");
    await harness.click(); // stop -> onstop fires asynchronously
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(media.getCaptureOwner()).toBeUndefined();
    await harness.unmount();
    media.dispose();
  });
});

/** F7 Step 8：录音开始回调 / MIME 载荷 / 播放互斥 / 双 mic capture busy 文案。 */
describe("useCoachRecorder Step 8 media wiring", () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  let originalMediaRecorder: typeof globalThis.MediaRecorder | undefined;

  interface Recording {
    onRecordingStart: (() => void) | undefined;
    onAudio: (audio: { dataUrl: string; durationMs?: number; mimeType?: string }) => void;
    onError: (message: string) => void;
  }

  function installWorkingRecorder(recording: Recording): void {
    const tracks = [{ stop: vi.fn() }];
    const stream = { getTracks: () => tracks } as unknown as MediaStream;
    stubGetUserMedia(() => Promise.resolve(stream));
    globalThis.MediaRecorder = class {
      state = "inactive";
      mimeType = "audio/webm;codecs=opus";
      ondataavailable: ((event: { data: { size: number } & Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        queueMicrotask(() => {
          this.ondataavailable?.({ data: { size: 4 } as unknown as Blob });
          this.onstop?.();
        });
      }
      static isTypeSupported() { return true; }
    } as unknown as typeof MediaRecorder;
    void recording;
  }

  beforeEach(() => {
    originalMediaRecorder = globalThis.MediaRecorder;
    globalThis.MediaRecorder = class DummyMediaRecorder { static isTypeSupported() { return false; } } as unknown as typeof MediaRecorder;
  });

  afterEach(() => {
    if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    if (originalMediaRecorder === undefined) delete (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    else globalThis.MediaRecorder = originalMediaRecorder;
  });

  function stubGetUserMedia(fn: () => Promise<MediaStream>): void {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(fn) } });
  }

  async function renderOptionsHarness(options: {
    disabled: boolean;
    media: MediaSessionController;
    interruptPlaybackOnStart?: boolean;
    captureBusyMessage?: string;
    onRecordingStart?: () => void;
    onAudio: (audio: { dataUrl: string; durationMs?: number; mimeType?: string }) => void;
    onError: (message: string) => void;
  }): Promise<{ click: () => Promise<void>; unmount: () => Promise<void> }> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function Harness() {
      const { recording, toggle } = useCoachRecorder(options);
      return <button type="button" data-testid="toggle" data-recording={recording} onClick={() => { void toggle(); }} />;
    }
    await act(async () => root.render(<Harness />));
    return {
      click: async () => { await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="toggle"]')!.click(); }); },
      unmount: async () => { await act(async () => root.unmount()); document.body.removeChild(container); },
    };
  }

  it("录音真正开始时触发 onRecordingStart（权限拒绝不触发）；onAudio 携带 mimeType", async () => {
    const media = new MediaSessionController();
    const started = vi.fn();
    const onAudio = vi.fn();
    installWorkingRecorder({ onRecordingStart: started, onAudio, onError: vi.fn() });
    const harness = await renderOptionsHarness({ disabled: false, media, onRecordingStart: started, onAudio, onError: vi.fn() });
    await harness.click();
    expect(started).toHaveBeenCalledTimes(1);
    // 停止 → onstop（微任务）→ onAudio 携带 recorder 封装 MIME。
    await harness.click();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(onAudio).toHaveBeenCalledTimes(1);
    expect(onAudio.mock.calls[0][0]).toMatchObject({ mimeType: "audio/webm;codecs=opus" });
    expect(typeof onAudio.mock.calls[0][0].dataUrl).toBe("string");
    await harness.unmount();
    media.dispose();
  });

  it("权限拒绝：onRecordingStart 不触发、无 onAudio（不进入提交链）", async () => {
    const media = new MediaSessionController();
    const started = vi.fn();
    const onAudio = vi.fn();
    const onError = vi.fn();
    stubGetUserMedia(() => Promise.reject(new Error("NotAllowedError")));
    const harness = await renderOptionsHarness({ disabled: false, media, onRecordingStart: started, onAudio, onError });
    await harness.click();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(started).not.toHaveBeenCalled();
    expect(onAudio).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("没有获得麦克风权限，请允许录音或改用文字提问。");
    await harness.unmount();
    media.dispose();
  });

  it("interruptPlaybackOnStart：录音开始即停止当前 narration 播放（共享媒体 session 的互斥）；未开启时不停止", async () => {
    const stopSpyMedia = new MediaSessionController();
    const stopSpy = vi.spyOn(stopSpyMedia, "stop");
    installWorkingRecorder({ onRecordingStart: undefined, onAudio: vi.fn(), onError: vi.fn() });
    const harness = await renderOptionsHarness({ disabled: false, media: stopSpyMedia, interruptPlaybackOnStart: true, onAudio: vi.fn(), onError: vi.fn() });
    await harness.click();
    expect(stopSpy).toHaveBeenCalledWith("narration");
    await harness.unmount();
    stopSpyMedia.dispose();

    const quietMedia = new MediaSessionController();
    const quietSpy = vi.spyOn(quietMedia, "stop");
    const quietHarness = await renderOptionsHarness({ disabled: false, media: quietMedia, onAudio: vi.fn(), onError: vi.fn() });
    await quietHarness.click();
    // 互斥只由显式 opt-in（canonical）；默认（legacy）不停止播放。
    expect(quietSpy).not.toHaveBeenCalledWith("narration");
    await quietHarness.unmount();
    quietMedia.dispose();
  });

  it("双 mic 互斥：另一 recorder 持有 capture 时使用 captureBusyMessage 文案", async () => {
    const media = new MediaSessionController();
    const coachLease = media.acquireCapture("coach-turn");
    expect(coachLease).not.toBeNull();
    const getUserMedia = vi.fn(() => Promise.resolve(new MediaStream()));
    stubGetUserMedia(getUserMedia);
    const onError = vi.fn();
    const harness = await renderOptionsHarness({ disabled: false, media, captureBusyMessage: "已有录音进行中，请先停止当前录音。", onAudio: vi.fn(), onError });
    await harness.click();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("已有录音进行中，请先停止当前录音。");
    expect(media.getCaptureOwner()).toBe("coach-turn"); // 未抢走/未误释放
    await harness.unmount();
    media.dispose();
  });
});
