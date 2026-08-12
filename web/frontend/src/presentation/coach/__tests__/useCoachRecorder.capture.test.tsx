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
