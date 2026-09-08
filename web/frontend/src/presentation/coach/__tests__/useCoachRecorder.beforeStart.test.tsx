/**
 * F7 P2（R5 裁定时序）— useCoachRecorder beforeStart 录音前置门。
 *
 * - beforeStart 在 getUserMedia/占麦克风**之前**执行（先 barge-in 再录音）；
 * - 返回 false（等待失败）→ 不占 mic、不 getUserMedia、不开录、不触发
 *   onRecordingStart（不捕获通道/revision）；
 * - beforeStart 抛异常按 false 处理，并经 onError 给出可见提示（hardening：
 *   不静默吞异常，也不误用权限拒绝文案）；
 * - beforeStart 为 true → 既有链路不变（lease → getUserMedia → start →
 *   onRecordingStart → interruptPlaybackOnStart 兜底停播）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MediaSessionController } from "../../audio/MediaSessionController";
import { useCoachRecorder } from "../useCoachRecorder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const originalDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalDevices) Object.defineProperty(navigator, "mediaDevices", originalDevices);
  else delete (navigator as { mediaDevices?: unknown }).mediaDevices;
});

async function setup(beforeStart?: () => Promise<boolean>) {
  let resolve!: (stream: MediaStream) => void;
  const permission = new Promise<MediaStream>((done) => { resolve = done; });
  const getUserMedia = vi.fn(() => permission);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const started = vi.fn();
  vi.stubGlobal("MediaRecorder", class {
    state = "inactive";
    static isTypeSupported() { return false; }
    start() { started(); this.state = "recording"; }
    onstop: (() => void) | null = null;
    stop() { this.state = "inactive"; queueMicrotask(() => this.onstop?.()); }
  });
  const media = new MediaSessionController();
  const stopped = vi.fn();
  const stream = { getTracks: () => [{ stop: stopped }] } as unknown as MediaStream;
  const onAudio = vi.fn(); const onError = vi.fn(); const onRecordingStart = vi.fn();
  let toggle!: () => Promise<void>;
  let cancel!: () => void;
  function Harness() {
    ({ toggle, cancel } = useCoachRecorder({
      disabled: false,
      media,
      ...(beforeStart !== undefined ? { beforeStart } : {}),
      interruptPlaybackOnStart: true,
      onAudio,
      onError,
      onRecordingStart,
    }));
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(<Harness />); });
  return {
    media, stopped, started, onAudio, onError, onRecordingStart, getUserMedia,
    start: () => { void toggle(); },
    cancel: () => { cancel(); },
    resolve: async () => { await act(async () => { resolve(stream); }); },
    unmount: async () => { await act(async () => { root.unmount(); }); },
  };
}

it("beforeStart 先于 getUserMedia 执行；false → 零 mic 占用、零开录、零通道捕获", async () => {
  const order: string[] = [];
  const h = await setup(async () => { order.push("beforeStart"); return false; });
  const originalGetUserMedia = h.getUserMedia;
  void originalGetUserMedia;
  await act(async () => { h.start(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(order).toEqual(["beforeStart"]);
  expect(h.getUserMedia).not.toHaveBeenCalled();
  expect(h.media.getCaptureOwner()).toBeUndefined();
  expect(h.started).not.toHaveBeenCalled();
  expect(h.onRecordingStart).not.toHaveBeenCalled();
  expect(h.onError).not.toHaveBeenCalled(); // 提示由调用方（hook）负责
  // 门失败后可再次尝试（starting 已复位）。
  await act(async () => { h.start(); });
  expect(order).toEqual(["beforeStart", "beforeStart"]);
  await h.unmount(); h.media.dispose();
});

it("beforeStart 抛异常按 false 处理 + 可见提示（hardening：不静默吞，也不落入权限拒绝文案）", async () => {
  const h = await setup(async () => { throw new Error("unexpected"); });
  await act(async () => { h.start(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(h.getUserMedia).not.toHaveBeenCalled();
  // 异常路径的可见提示与 settle.failed 的提示路径一致（P2-A 返工附带加固）。
  expect(h.onError).toHaveBeenCalledTimes(1);
  expect(h.onError).toHaveBeenCalledWith("录音前的打断握手出现问题，请再试一次或改用文字输入。");
  expect(h.media.getCaptureOwner()).toBeUndefined();
  await h.unmount(); h.media.dispose();
});

it("beforeStart=true → 既有链路不变：lease → getUserMedia → start → onRecordingStart（兜底停播保留）", async () => {
  const order: string[] = [];
  const h = await setup(async () => { order.push("beforeStart"); return true; });
  // 在播 narration（capture-first 兜底路径：录音开始即停播）。
  const original = globalThis.Audio;
  const audio = { src: "", preload: "", onplay: null, onpause: null, onended: null, onerror: null, pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined) };
  globalThis.Audio = function Audio() { return audio; } as unknown as typeof Audio;
  try {
    await h.media.playUrl("narration", "n.mp3", { autoplay: true });
    expect(h.media.getState().status).toBe("playing");
    await act(async () => { h.start(); });
    await h.resolve();
    expect(order).toEqual(["beforeStart"]);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.media.getCaptureOwner()).toBe("coach-turn");
    expect(h.started).toHaveBeenCalledTimes(1);
    expect(h.onRecordingStart).toHaveBeenCalledTimes(1);
    // interruptPlaybackOnStart 兜底：录音开始即在播 narration 被停。
    expect(h.media.getState().status).toBe("idle");
    await h.unmount();
  } finally {
    globalThis.Audio = original;
  }
  h.media.dispose();
});

it("explicit session/owner cancellation fences a pending beforeStart without acquiring devices",async()=>{
 let finish!: (value:boolean)=>void;const h=await setup(()=>new Promise(resolve=>finish=resolve));
 await act(async()=>h.start());await act(async()=>h.cancel());await act(async()=>finish(true));
 expect(h.getUserMedia).not.toHaveBeenCalled();expect(h.started).not.toHaveBeenCalled();expect(h.onAudio).not.toHaveBeenCalled();expect(h.media.getCaptureOwner()).toBeUndefined();await h.unmount();h.media.dispose();
});
it("explicit cancellation during permission acquisition releases a late device and submits nothing",async()=>{
 const h=await setup(async()=>true);await act(async()=>h.start());expect(h.getUserMedia).toHaveBeenCalledOnce();await act(async()=>h.cancel());await h.resolve();expect(h.stopped).toHaveBeenCalledOnce();expect(h.started).not.toHaveBeenCalled();expect(h.onAudio).not.toHaveBeenCalled();expect(h.media.getCaptureOwner()).toBeUndefined();await h.unmount();h.media.dispose();
});
