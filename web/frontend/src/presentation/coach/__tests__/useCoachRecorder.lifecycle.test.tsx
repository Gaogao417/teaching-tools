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

async function setup(failStart = false) {
  let resolve!: (stream: MediaStream) => void;
  const permission = new Promise<MediaStream>((done) => { resolve = done; });
  const getUserMedia = vi.fn(() => permission);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const started = vi.fn();
  vi.stubGlobal("MediaRecorder", class {
    state = "inactive";
    static isTypeSupported() { return false; }
    start() { started(); if (failStart) throw new Error("Device unavailable"); this.state = "recording"; }
    onstop: (() => void) | null = null;
    stop() { this.state = "inactive"; queueMicrotask(() => this.onstop?.()); }
  });
  const media = new MediaSessionController();
  const stopped = vi.fn();
  const stream = { getTracks: () => [{ stop: stopped }] } as unknown as MediaStream;
  const onAudio = vi.fn(); const onError = vi.fn(); const onRecordingStart = vi.fn();
  let toggle!: () => Promise<void>;
  function Harness() {
    ({ toggle } = useCoachRecorder({ disabled: false, media, onAudio, onError, onRecordingStart }));
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(<Harness />); });
  return { media, stopped, started, onAudio, onError, onRecordingStart, getUserMedia,
    start: () => { void toggle(); },
    resolve: async () => { await act(async () => { resolve(stream); }); },
    unmount: async () => { await act(async () => { root.unmount(); }); },
  };
}

it("late permission after unmount stops tracks and cannot start recording or acquire another owner's lease", async () => {
  const h = await setup();
  await act(async () => { h.start(); });
  await h.unmount();
  const nextLease = h.media.acquireCapture("live");
  await h.resolve();
  expect(h.started).not.toHaveBeenCalled();
  expect(h.stopped).toHaveBeenCalledTimes(1);
  expect(h.onRecordingStart).not.toHaveBeenCalled();
  expect(h.onAudio).not.toHaveBeenCalled();
  expect(h.media.getCaptureOwner()).toBe("live");
  nextLease?.release(); h.media.dispose();
});

it("MediaRecorder start failure closes the acquired device as well as releasing the lease", async () => {
  const h = await setup(true);
  await act(async () => { h.start(); });
  await h.resolve();
  expect(h.stopped).toHaveBeenCalledTimes(1);
  expect(h.media.getCaptureOwner()).toBeUndefined();
  expect(h.onRecordingStart).not.toHaveBeenCalled();
  expect(h.onError).toHaveBeenCalledTimes(1);
  await h.unmount(); h.media.dispose();
});

it("repeated start clicks during permission request do not report a competing recorder", async () => {
  const h = await setup();
  await act(async () => { h.start(); h.start(); });
  expect(h.getUserMedia).toHaveBeenCalledTimes(1);
  expect(h.onError).not.toHaveBeenCalled();
  await h.unmount(); await h.resolve(); h.media.dispose();
});

it("output conversion cannot call onAudio after unmount or let another capture replace its channel", async () => {
  let finish!: () => void;
  vi.stubGlobal("FileReader", class {
    result = "data:audio/webm;base64,AAAA";
    onload: (() => void) | null = null;
    readAsDataURL() { finish = () => this.onload?.(); }
  });
  const h = await setup();
  await act(async () => { h.start(); });
  await h.resolve();
  await act(async () => { h.start(); }); // stop, then begin asynchronous conversion
  await act(async () => { h.start(); }); // not a new permission/capture attempt
  expect(h.getUserMedia).toHaveBeenCalledTimes(1);
  await h.unmount();
  await act(async () => { finish(); });
  expect(h.onAudio).not.toHaveBeenCalled();
  h.media.dispose();
});
