import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaSessionController } from "../MediaSessionController";

/**
 * ADR-005 §Observability Contract — the browser-first-audio reporter is
 * best-effort above all else. These tests prove:
 *   1. the reporter fires `browser-audio-started` (i.e. `browser_first_audio_at`
 *      via `browserTimeMs`) on the first playback moment for a correlationId;
 *   2. a throwing / failing telemetry callback NEVER propagates into the
 *      playback path, so attempt/world and training metrics cannot change.
 */
describe("MediaSessionController voice reporter (ADR-005 §Observability)", () => {
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

  it("reports browser_first_audio (browser-audio-started) on the first playback for a correlationId", async () => {
    delete (globalThis as { MediaSource?: typeof MediaSource }).MediaSource;
    const marks: { correlationId: string; owner: string; stage: string; browserTimeMs: number }[] = [];
    const controller = new MediaSessionController((mark) => marks.push({ ...mark }));
    const handle = controller.startAudioStream("coach-turn", { correlationId: "turn-1" });
    handle.appendChunk(new Uint8Array([1, 2, 3]));
    handle.complete();
    await new Promise((resolve) => setTimeout(resolve, 0)); // playUrl flush is async

    // playback started despite the reporter, and the first-audio mark fired once
    expect(controller.getState()).toMatchObject({ status: "playing", owner: "coach-turn" });
    const started = marks.filter((mark) => mark.stage === "browser-audio-started");
    expect(started).toHaveLength(1);
    expect(started[0].correlationId).toBe("turn-1");
    expect(started[0].owner).toBe("turn"); // coach-turn maps to the "turn" flow kind
    expect(typeof started[0].browserTimeMs).toBe("number");
    expect(started[0].browserTimeMs).toBeGreaterThan(0);
    controller.dispose();
  });

  it("never throws into the playback path when the telemetry callback throws (best-effort, attempt/world unchanged)", async () => {
    delete (globalThis as { MediaSource?: typeof MediaSource }).MediaSource;
    const controller = new MediaSessionController(() => { throw new Error("reporter down"); });
    const handle = controller.startAudioStream("coach-turn", { correlationId: "turn-2" });
    // Must not throw even though the synchronous callback throws.
    expect(() => handle.appendChunk(new Uint8Array([1]))).not.toThrow();
    handle.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Playback still reaches "playing" — the reporter failure did not break it,
    // so no caller (coach/training) observes a telemetry-driven state change.
    expect(controller.getState()).toMatchObject({ status: "playing", owner: "coach-turn" });
    controller.dispose();
  });

  it("an autoplay-block reports the block mark and still does not throw or change owner arbitration", async () => {
    audio.play = vi.fn().mockRejectedValue(new Error("not-allowed"));
    const marks: { stage: string; correlationId: string }[] = [];
    const controller = new MediaSessionController((mark) => marks.push({ stage: mark.stage, correlationId: mark.correlationId }));
    await controller.playUrl("narration", "narration.mp3", { autoplay: true, correlationId: "narr-1" });
    // Autoplay block surfaces as state + a mark, never as a thrown error.
    expect(controller.getState()).toMatchObject({ status: "blocked-by-autoplay", owner: "narration" });
    expect(marks.some((mark) => mark.stage === "blocked-by-autoplay" && mark.correlationId === "narr-1")).toBe(true);
    controller.dispose();
  });
});
