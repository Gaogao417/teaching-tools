/**
 * F7 Step 6：Voice adapter 完成证据锁定（ledger 增补 20 偏差 4）。
 *
 * 用真实 MediaSessionController + NarrationController（fake Audio/synthesize）：
 * - 只有本次播放 generation 的 `ended` 才产生 presented；
 * - stopped（打断/替换）→ interrupted；blocked → 暂停（手势 resume 走缓存）；
 * - synthesize 失败 → provider_failure；abort（取消）→ interrupted 不误报失败；
 * - replay：核对 actionId + 缓存 + 播放互斥，零上报。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { MediaSessionController } from "../../audio/MediaSessionController";
import { NarrationController, type NarrationClient } from "../../narration/NarrationController";
import { clearNarrationCacheForTests } from "../../narration/NarrationController";
import { createVoicePresentationAdapter } from "../adapters/voicePresentationAdapter";
import type { PendingPresentationDelivery } from "../types";
import { pendingVoicePresentation, runtimeSnapshotRaw, validFromRaw } from "../../../action-runtime/tutor/__tests__/runtimeSnapshotFixture";
import type { ValidatedSessionSnapshot } from "../../../api/tutorRuntimeClient";

interface FakeAudio {
  src: string;
  preload: string;
  onplay: (() => void) | null;
  onpause: (() => void) | null;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
}

describe("voicePresentationAdapter（generation 绑定的真实 ended）", () => {
  let originalAudio: typeof Audio;
  let audio: FakeAudio;
  let media: MediaSessionController;
  let synthesize: Mock<NarrationClient["synthesize"]>;
  let narration: NarrationController;

  beforeEach(() => {
    originalAudio = globalThis.Audio;
    audio = {
      src: "",
      preload: "",
      onplay: null,
      onpause: null,
      onended: null,
      onerror: null,
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
    };
    globalThis.Audio = function Audio() { return audio; } as unknown as typeof Audio;
    clearNarrationCacheForTests();
    media = new MediaSessionController();
    synthesize = vi.fn().mockResolvedValue({ audioUrl: "https://example/voice.mp3" });
    narration = new NarrationController({ synthesize }, media);
  });

  afterEach(() => {
    media.dispose();
    globalThis.Audio = originalAudio;
  });

  function pendingSnapshot(): { snapshot: ValidatedSessionSnapshot; delivery: PendingPresentationDelivery } {
    const snapshot = validFromRaw(runtimeSnapshotRaw({ pendingPresentation: true }));
    return { snapshot, delivery: snapshot.pending_presentation as PendingPresentationDelivery };
  }

  it("本次播放的 ended → presented（ended 前 not settled）", async () => {
    const adapter = createVoicePresentationAdapter({ narration, media });
    const { snapshot, delivery } = pendingSnapshot();
    const presented = adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalled());
    const beforeEnd = await Promise.race([presented, new Promise((resolve) => setTimeout(() => resolve("pending"), 15))]);
    expect(beforeEnd).toBe("pending"); // 播放中不得提前 presented
    audio.onended?.();
    await expect(presented).resolves.toEqual({ outcome: "presented" });
  });

  it("打断（abort → narration.stop）→ stopped 事件 → interrupted（不误报失败）", async () => {
    const adapter = createVoicePresentationAdapter({ narration, media });
    const { snapshot, delivery } = pendingSnapshot();
    const abort = new AbortController();
    const presented = adapter.present({ delivery, snapshot, abort: abort.signal });
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalled());
    abort.abort();
    await expect(presented).resolves.toEqual({ outcome: "interrupted" });
  });

  it("autoplay 阻塞 → blocked-by-autoplay（暂停）；resume（用户手势重播缓存）→ ended → presented", async () => {
    audio.play.mockRejectedValueOnce(new Error("blocked")); // 第一次 autoplay 被拦截
    const adapter = createVoicePresentationAdapter({ narration, media });
    const { snapshot, delivery } = pendingSnapshot();
    const presented = adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    await expect(presented).resolves.toEqual({ outcome: "blocked-by-autoplay" });
    expect(media.getState().status).toBe("blocked-by-autoplay");
    const resume = adapter.resume!(new AbortController().signal);
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2)); // 缓存重播
    audio.onended?.();
    await expect(resume).resolves.toEqual({ outcome: "presented" });
  });

  it("REVIEW 回归：resume 后打断仍生效（abort → narration.stop → stopped → interrupted；媒体回 idle）", async () => {
    audio.play.mockRejectedValueOnce(new Error("blocked"));
    const adapter = createVoicePresentationAdapter({ narration, media });
    const { snapshot, delivery } = pendingSnapshot();
    const presented = adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    await expect(presented).resolves.toEqual({ outcome: "blocked-by-autoplay" });
    const abort = new AbortController();
    const resumed = adapter.resume!(abort.signal);
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));
    expect(media.getState().status).toBe("playing");
    abort.abort();
    await expect(resumed).resolves.toEqual({ outcome: "interrupted" });
    expect(media.getState().status).toBe("idle");
  });

  it("synthesize 失败 → failed(provider_failure)", async () => {
    synthesize.mockRejectedValueOnce(new Error("tts unavailable"));
    const adapter = createVoicePresentationAdapter({ narration, media });
    const { snapshot, delivery } = pendingSnapshot();
    await expect(adapter.present({ delivery, snapshot, abort: new AbortController().signal }))
      .resolves.toEqual({ outcome: "failed", failureClass: "provider_failure", message: expect.stringContaining("synthesis") });
  });

  it("合成中 abort（取消，非失败）→ interrupted", async () => {
    synthesize.mockImplementation((_text: string, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
    const adapter = createVoicePresentationAdapter({ narration, media });
    const { snapshot, delivery } = pendingSnapshot();
    const abort = new AbortController();
    const presented = adapter.present({ delivery, snapshot, abort: abort.signal });
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalled());
    abort.abort();
    await expect(presented).resolves.toEqual({ outcome: "interrupted" });
  });

  it("播放中媒体 error 事件 → failed(provider_failure)", async () => {
    const adapter = createVoicePresentationAdapter({ narration, media });
    const { snapshot, delivery } = pendingSnapshot();
    const presented = adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalled());
    audio.onerror?.();
    await expect(presented).resolves.toMatchObject({ outcome: "failed", failureClass: "provider_failure" });
  });

  it("replay：presented 后（media idle + 缓存在）canReplay；replay 零 outcome 语义由 controller 保证（adapter 只回放缓存）", async () => {
    const adapter = createVoicePresentationAdapter({ narration, media });
    const { snapshot, delivery } = pendingSnapshot();
    const presented = adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalled());
    audio.onended?.();
    await expect(presented).resolves.toEqual({ outcome: "presented" });
    expect(adapter.canReplay?.("VA-bt01-narrate")).toBe(true);
    expect(adapter.canReplay?.("VA-other")).toBe(false);
    expect(adapter.lastReplayableActionId?.()).toBe("VA-bt01-narrate");
    expect(adapter.replay?.("VA-bt01-narrate")).toBe(true);
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2)); // 纯缓存重播
  });

  it("播放进行中（media 非 idle）canReplay=false（播放互斥）", async () => {
    const adapter = createVoicePresentationAdapter({ narration, media });
    const { snapshot, delivery } = pendingSnapshot();
    const presented = adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalled());
    expect(adapter.canReplay?.("VA-bt01-narrate")).toBe(false);
    audio.onended?.();
    await expect(presented).resolves.toEqual({ outcome: "presented" });
  });
});
