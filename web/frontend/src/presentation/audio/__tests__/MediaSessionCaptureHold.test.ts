/**
 * F7 P2（S1 裁定① delivered≠presented）— MediaSessionController narration 挂起。
 *
 * 与 interruptPlaybackOnStart 合并为媒体 session 单一互斥规则：
 * - 录音占用 capture 期间到达的 narration playUrl → 挂起（held-for-capture），
 *   预留 generation、不起播（audio.play 零调用）；
 * - capture lease 释放 → 同一 generation 自动起播（started/ended 按预留代数）；
 * - 挂起被新挂起顶替 / 被 stop("narration") / dispose → 为预留代数补发
 *   stopped（等待者不悬挂）；
 * - 互斥只作用于 owner=narration：coach-turn 播放不受挂起影响（legacy/
 *   practice 行为零变化）；未启用（默认）时旧行为零变化。
 */
import { describe, expect, it, vi } from "vitest";
import { MediaSessionController, type MediaPlaybackEvent } from "../MediaSessionController";

function withMockedAudio<T>(test: (audio: { src: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; fireEnded: () => void }) => Promise<T>): Promise<T> {
  return (async () => {
    const original = globalThis.Audio;
    const audio = {
      src: "",
      preload: "",
      onplay: null as null | (() => void),
      onpause: null as null | (() => void),
      onended: null as null | (() => void),
      onerror: null as null | (() => void),
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      fireEnded() { audio.onended?.(); },
    };
    globalThis.Audio = function Audio() { return audio; } as unknown as typeof Audio;
    try {
      return await test(audio);
    } finally {
      globalThis.Audio = original;
    }
  })();
}

describe("MediaSessionController F7 P2：narration 挂起（S1 裁定①）", () => {
  it("默认未启用：capture 占用期间 playUrl 照常起播（legacy/practice 行为零变化）", async () => {
    await withMockedAudio(async (audio) => {
      const controller = new MediaSessionController();
      const lease = controller.acquireCapture("coach-turn");
      expect(lease).not.toBeNull();
      await controller.playUrl("narration", "narration.mp3", { autoplay: true });
      expect(audio.play).toHaveBeenCalledTimes(1);
      expect(controller.getState().status).toBe("playing");
      lease!.release();
      controller.dispose();
    });
  });

  it("启用后：capture 占用期间 narration playUrl 挂起（零 audio.play），释放 lease 后同代数自动起播", async () => {
    await withMockedAudio(async (audio) => {
      const controller = new MediaSessionController();
      controller.setNarrationHoldDuringCapture(true);
      const lease = controller.acquireCapture("coach-turn");
      const events: MediaPlaybackEvent[] = [];
      controller.subscribePlaybackEvents((event) => events.push(event));
      const generation = await controller.playUrl("narration", "narration.mp3", { autoplay: true });
      expect(controller.getState()).toMatchObject({ status: "held-for-capture", owner: "narration" });
      expect(audio.play).not.toHaveBeenCalled();
      expect(controller.hasHeldNarration()).toBe(true);

      lease!.release();
      await Promise.resolve();
      await Promise.resolve();
      expect(audio.play).toHaveBeenCalledTimes(1);
      expect(controller.getState()).toMatchObject({ status: "playing", owner: "narration" });
      expect(controller.hasHeldNarration()).toBe(false);
      // started 事件按预留 generation 发射（等待者绑定不漂移）。
      expect(events).toContainEqual({ type: "started", owner: "narration", generation });
      audio.fireEnded();
      expect(events).toContainEqual({ type: "ended", owner: "narration", generation });
      controller.dispose();
    });
  });

  it("互斥只作用于 narration：capture 占用期间 coach-turn playUrl 照常起播", async () => {
    await withMockedAudio(async (audio) => {
      const controller = new MediaSessionController();
      controller.setNarrationHoldDuringCapture(true);
      const lease = controller.acquireCapture("coach-turn");
      await controller.playUrl("coach-turn", "answer.mp3", { autoplay: true });
      expect(audio.play).toHaveBeenCalledTimes(1);
      expect(controller.getState()).toMatchObject({ status: "playing", owner: "coach-turn" });
      lease!.release();
      controller.dispose();
    });
  });

  it("挂起被新挂起顶替：旧预留代数补发 stopped（单槽，与 playUrl 接管语义一致）", async () => {
    await withMockedAudio(async (audio) => {
      const controller = new MediaSessionController();
      controller.setNarrationHoldDuringCapture(true);
      const lease = controller.acquireCapture("coach-turn");
      const events: MediaPlaybackEvent[] = [];
      controller.subscribePlaybackEvents((event) => events.push(event));
      const first = await controller.playUrl("narration", "a.mp3", { autoplay: true });
      const second = await controller.playUrl("narration", "b.mp3", { autoplay: true });
      expect(second).toBeGreaterThan(first);
      expect(events).toContainEqual({ type: "stopped", owner: "narration", generation: first });
      expect(audio.play).not.toHaveBeenCalled();

      lease!.release();
      await Promise.resolve();
      await Promise.resolve();
      expect(audio.play).toHaveBeenCalledTimes(1);
      expect(audio.src).toContain("b.mp3");
      controller.dispose();
    });
  });

  it("stop(\"narration\") 清挂起：预留代数补发 stopped，等待者不悬挂", async () => {
    await withMockedAudio(async (audio) => {
      const controller = new MediaSessionController();
      controller.setNarrationHoldDuringCapture(true);
      controller.acquireCapture("coach-turn");
      const events: MediaPlaybackEvent[] = [];
      controller.subscribePlaybackEvents((event) => events.push(event));
      const generation = await controller.playUrl("narration", "a.mp3", { autoplay: true });
      controller.stop("narration");
      expect(events).toContainEqual({ type: "stopped", owner: "narration", generation });
      expect(controller.hasHeldNarration()).toBe(false);
      expect(controller.getState().status).toBe("idle");
      expect(audio.play).not.toHaveBeenCalled();
      controller.dispose();
    });
  });

  it("releaseCapture 同样冲刷挂起；停用挂起开关时现存挂起立即起播", async () => {
    await withMockedAudio(async (audio) => {
      const controller = new MediaSessionController();
      controller.setNarrationHoldDuringCapture(true);
      controller.acquireCapture("live");
      await controller.playUrl("narration", "a.mp3", { autoplay: true });
      expect(controller.hasHeldNarration()).toBe(true);
      controller.releaseCapture("live");
      await Promise.resolve();
      await Promise.resolve();
      expect(audio.play).toHaveBeenCalledTimes(1);
      expect(controller.hasHeldNarration()).toBe(false);

      // 停用开关冲刷：重新挂起后停用 → 立即起播。
      controller.acquireCapture("coach-turn");
      await controller.playUrl("narration", "b.mp3", { autoplay: true });
      expect(controller.hasHeldNarration()).toBe(true);
      controller.setNarrationHoldDuringCapture(false);
      await Promise.resolve();
      await Promise.resolve();
      expect(audio.play).toHaveBeenCalledTimes(2);
      controller.dispose();
    });
  });
});
