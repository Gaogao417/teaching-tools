import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaSessionController } from "../MediaSessionController";

describe("MediaSessionController incremental streaming", () => {
  let originalAudio: typeof globalThis.Audio;
  let originalMediaSource: typeof globalThis.MediaSource | undefined;
  let audio: {
    src: string; preload: string;
    onplay: (() => void) | null; onpause: (() => void) | null; onended: (() => void) | null; onerror: (() => void) | null;
    pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    originalAudio = globalThis.Audio;
    audio = {
      src: "", preload: "",
      onplay: null, onpause: null, onended: null, onerror: null,
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
    };
    globalThis.Audio = function Audio() { return audio; } as unknown as typeof Audio;
    originalMediaSource = globalThis.MediaSource;
  });

  afterEach(() => {
    globalThis.Audio = originalAudio;
    if (originalMediaSource === undefined) delete (globalThis as { MediaSource?: typeof MediaSource }).MediaSource;
    else globalThis.MediaSource = originalMediaSource;
  });

  it("buffers a turn into one playback when MediaSource is unavailable (single owner, no per-chunk audio)", async () => {
    delete (globalThis as { MediaSource?: typeof MediaSource }).MediaSource;
    const controller = new MediaSessionController();
    const handle = controller.startAudioStream("coach-turn", { correlationId: "c1" });
    handle.appendChunk(new Uint8Array([1, 2, 3]));
    handle.appendChunk(new Uint8Array([4, 5, 6]));
    expect(audio.play).not.toHaveBeenCalled();
    handle.complete();
    // Flushed as a single Blob URL, played exactly once.
    await new Promise((resolve) => setTimeout(resolve, 0)); // playUrl is async
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.src.startsWith("blob:")).toBe(true);
    expect(controller.getState()).toMatchObject({ status: "playing", owner: "coach-turn" });
    controller.dispose();
  });

  it("stop() cancels an open stream: further chunks are ignored and no audio plays", async () => {
    delete (globalThis as { MediaSource?: typeof MediaSource }).MediaSource;
    const controller = new MediaSessionController();
    const handle = controller.startAudioStream("coach-turn", { correlationId: "c2" });
    controller.stop();
    handle.appendChunk(new Uint8Array([1]));
    handle.complete();
    expect(audio.play).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({ status: "idle" });
    controller.dispose();
  });

  it("starting a new coach-turn stream preempts the previous one", async () => {
    delete (globalThis as { MediaSource?: typeof MediaSource }).MediaSource;
    const controller = new MediaSessionController();
    const first = controller.startAudioStream("coach-turn", { correlationId: "c3" });
    const second = controller.startAudioStream("coach-turn", { correlationId: "c4" });
    first.appendChunk(new Uint8Array([1])); // belongs to the now-aborted first stream
    first.complete();
    second.appendChunk(new Uint8Array([9]));
    second.complete();
    // Only the second stream's blob is played once; the first is silenced.
    expect(audio.play).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("appends MP3 chunks in order to one MediaSource and starts playback on the first chunk", async () => {
    const appended: number[][] = [];
    const sourceBuffer = {
      updating: false,
      appendBuffer: vi.fn((data: BufferSource) => {
        appended.push(Array.from(new Uint8Array(data as ArrayBuffer)));
        sourceBuffer.updating = true;
        queueMicrotask(() => { sourceBuffer.updating = false; sourceBufferListeners.updateend?.(); });
      }),
      addEventListener: vi.fn(),
    };
    const sourceBufferListeners: { updateend?: () => void } = {};
    sourceBuffer.addEventListener.mockImplementation((event: string, cb: () => void) => { if (event === "updateend") sourceBufferListeners.updateend = cb; });

    const mediaSourceListeners: { sourceopen?: () => void } = {};
    const mediaSource = {
      readyState: "open",
      addSourceBuffer: vi.fn(() => sourceBuffer),
      endOfStream: vi.fn(),
      addEventListener: vi.fn((event: string, cb: () => void) => { if (event === "sourceopen") mediaSourceListeners.sourceopen = cb; }),
    };
    const createObjectURL = vi.fn(() => "blob:media-source");
    globalThis.MediaSource = function MediaSource() { queueMicrotask(() => mediaSourceListeners.sourceopen?.()); return mediaSource; } as unknown as typeof MediaSource;
    globalThis.MediaSource.isTypeSupported = () => true;
    const originalURL = URL.createObjectURL;
    URL.createObjectURL = createObjectURL;

    const marks: { stage: string; correlationId: string }[] = [];
    const controller = new MediaSessionController((mark) => marks.push({ stage: mark.stage, correlationId: mark.correlationId }));
    const handle = controller.startAudioStream("coach-turn", { correlationId: "c5" });
    handle.appendChunk(new Uint8Array([10, 20]));
    handle.appendChunk(new Uint8Array([30, 40]));
    await new Promise((resolve) => setTimeout(resolve, 0)); // let sourceopen + first append settle
    expect(audio.play).toHaveBeenCalled(); // playback begins on the FIRST chunk, before complete()
    handle.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(appended).toEqual([[10, 20], [30, 40]]); // ordered, single SourceBuffer
    expect(marks.some((mark) => mark.stage === "browser-audio-started" && mark.correlationId === "c5")).toBe(true);

    URL.createObjectURL = originalURL;
    controller.dispose();
  });
});
