import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MediaSessionController } from "../../audio/MediaSessionController";
import { useCoachRecorder } from "../useCoachRecorder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const originalDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    stop() { this.state = "inactive"; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(["recorded audio"]) }); this.onstop?.(); }); }
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

/** FM-1 recorder failure matrix: real hook/lease, fake device callbacks only. */
async function recorderFailureHarness() {
  const stopped = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopped }] })) } });
  class Recorder {
    static instances: Recorder[] = [];
    static isTypeSupported() { return false; }
    state = "inactive"; mimeType = "audio/webm"; throwsOnStop = false;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    constructor() { Recorder.instances.push(this); }
    start() { this.state = "recording"; }
    stop() { if (this.throwsOnStop) throw new DOMException("device lost", "InvalidStateError"); this.state = "inactive"; this.onstop?.(); }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("FileReader", class {
    result = "data:audio/webm;base64,YXVkaW8="; onload: (() => void) | null = null;
    readAsDataURL() { this.onload?.(); }
  });
  const media = new MediaSessionController();
  const onAudio = vi.fn(); const onError = vi.fn();
  let current!: ReturnType<typeof useCoachRecorder>;
  const root = createRoot(document.createElement("div"));
  function Harness() { current = useCoachRecorder({ disabled: false, media, onAudio, onError }); return null; }
  await act(async () => root.render(<Harness />));
  return { media, onAudio, onError, stopped, instances: Recorder.instances,
    current: () => current,
    toggle: async () => { await act(async () => { await current.toggle(); }); },
    unmount: async () => { await act(async () => root.unmount()); },
  };
}

it.each(["error-before-data", "error-after-data", "stop-throws", "empty-audio"] as const)("%s invalidates capture, releases lease/device, suppresses old callbacks and permits retry", async mode => {
  vi.useFakeTimers();
  const h = await recorderFailureHarness();
  await h.toggle();
  const broken = h.instances[0];
  const lateStop = broken.onstop; const lateData = broken.ondataavailable; const lateError = broken.onerror;
  await act(async () => {
    if (mode === "error-after-data") broken.ondataavailable?.({ data: new Blob(["partial"]) });
    if (mode === "stop-throws") { broken.throwsOnStop = true; h.current().stop(); }
    else if (mode === "empty-audio") h.current().stop();
    else broken.onerror?.();
  });
  expect(h.onError).toHaveBeenCalledTimes(1);
  expect(h.onAudio).not.toHaveBeenCalled();
  expect(h.current().recording).toBe(false);
  expect(h.media.getCaptureOwner()).toBeUndefined();
  expect(h.stopped).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  await h.toggle();
  expect(h.instances).toHaveLength(2);
  await act(async () => { lateData?.({ data: new Blob(["late partial"]) }); lateError?.(); lateStop?.(); });
  expect(h.current().recording).toBe(true);
  expect(h.media.getCaptureOwner()).toBe("coach-turn");
  expect(h.onError).toHaveBeenCalledTimes(1);
  expect(h.onAudio).not.toHaveBeenCalled();
  await act(async () => { h.instances[1].ondataavailable?.({ data: new Blob(["valid audio"]) }); h.current().stop(); });
  expect(h.onAudio).toHaveBeenCalledTimes(1);
  await h.unmount(); h.media.dispose();
});

it("cancel by unmount discards queued recorder events without releasing the next owner's lease", async () => {
  const h = await recorderFailureHarness(); await h.toggle();
  const old = h.instances[0]; const late = { stop: old.onstop, error: old.onerror, data: old.ondataavailable };
  await h.unmount();
  const next = h.media.acquireCapture("live");
  await act(async () => { late.data?.({ data: new Blob(["old audio"]) }); late.error?.(); late.stop?.(); });
  expect(h.onAudio).not.toHaveBeenCalled(); expect(h.onError).not.toHaveBeenCalled();
  expect(h.media.getCaptureOwner()).toBe("live");
  next?.release(); h.media.dispose();
});
