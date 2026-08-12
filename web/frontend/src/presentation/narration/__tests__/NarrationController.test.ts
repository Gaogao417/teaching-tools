import { describe, expect, it, vi } from "vitest";
import { NarrationController } from "../NarrationController";

describe("NarrationController", () => {
  it("caches current/next and cancels stale action narration", async () => {
    const media = { stop: vi.fn(), playUrl: vi.fn().mockResolvedValue(undefined), replay: vi.fn() };
    const synthesize = vi.fn(async (text: string) => ({ audioUrl: `${text}.mp3` }));
    const controller = new NarrationController({ synthesize }, media as never);
    await controller.enter({ utteranceId: "a", spokenText: "A", cacheKey: "v1:A" }, { utteranceId: "b", spokenText: "B", cacheKey: "v1:B" }, true);
    await Promise.resolve();
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(controller.has("v1:A")).toBe(true);
    expect(controller.has("v1:B")).toBe(true);
    await controller.enter({ utteranceId: "b", spokenText: "B", cacheKey: "v1:B" }, undefined, true);
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(media.stop).toHaveBeenCalledWith("narration");
  });
});
