import { describe, expect, it, vi } from "vitest";
import { MediaSessionController } from "../MediaSessionController";

describe("MediaSessionController", () => {
  it("interrupts the prior owner and exposes autoplay blocking", async () => {
    const original = globalThis.Audio;
    const audio = { src: "", preload: "", onplay: null, onpause: null, onended: null, onerror: null, pause: vi.fn(), play: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("blocked")) };
    globalThis.Audio = function Audio() { return audio; } as unknown as typeof Audio;
    const controller = new MediaSessionController();
    await controller.playUrl("narration", "narration.mp3", { autoplay: true, replayKey: "narration" });
    expect(controller.getState()).toMatchObject({ status: "playing", owner: "narration" });
    await controller.playUrl("live", "live.mp3", { autoplay: true });
    expect(audio.pause).toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({ status: "blocked-by-autoplay", owner: "live" });
    controller.dispose();
    globalThis.Audio = original;
  });
});
