/**
 * F7 Step 6 Voice adapter：复用既有 NarrationController + MediaSessionController，
 * 等待**本次播放**的真实 `ended`（ledger 增补 20 偏差 4）。
 *
 * - NarrationController.enter 细分结果：failed → provider_failure；aborted →
 *   interrupted（不误报媒体失败）；playing → 绑定 generation 等待。
 * - 播放完成证据 = 该 generation 的 ended 事件；stopped（本方打断/被替换）→
 *   interrupted；blocked → 暂停等用户手势（resume 走缓存重播）；error →
 *   provider_failure；超时 → timeout。
 * - 聚合状态 idle 不再等价于 ended（waitForPlaybackEnd 的折算仅 legacy）。
 */
import type { MediaPlaybackEvent, MediaSessionController } from "../../audio/MediaSessionController";
import type { NarrationController } from "../../narration/NarrationController";
import type { PresentationAdapterResult, PresentationPresentRequest, PresentationToolAdapter } from "../types";

const VOICE_WAIT_TIMEOUT_MS = 10 * 60_000;

type VoiceCompletion = "ended" | "stopped" | "blocked" | "error" | "timeout";

/** generation 绑定的播放完成等待器：构造即订阅（不漏 blocked），bind 后从
 *  缓冲事件结算；其他 generation 的事件一律忽略。 */
class GenerationPlaybackWaiter {
  private readonly events: MediaPlaybackEvent[] = [];
  private generation?: number;
  private completion?: VoiceCompletion;
  private resolveWait?: (completion: VoiceCompletion) => void;
  private timer?: number;
  private readonly unsubscribe: () => void;

  constructor(private readonly media: MediaSessionController, private readonly timeoutMs: number) {
    this.unsubscribe = media.subscribePlaybackEvents((event) => {
      this.events.push(event);
      this.settle();
    });
  }

  bind(generation: number): void {
    this.generation = generation;
    this.settle();
  }

  wait(): Promise<VoiceCompletion> {
    if (this.completion !== undefined) return Promise.resolve(this.completion);
    this.timer = window.setTimeout(() => this.finish("timeout"), this.timeoutMs);
    return new Promise<VoiceCompletion>((resolve) => {
      this.resolveWait = resolve;
      this.settle();
    });
  }

  dispose(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.unsubscribe();
  }

  private finish(completion: VoiceCompletion): void {
    if (this.completion !== undefined) return;
    this.completion = completion;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.resolveWait?.(completion);
  }

  private settle(): void {
    if (this.completion !== undefined || this.generation === undefined) return;
    for (const event of this.events) {
      if (event.generation !== this.generation) continue;
      if (event.type === "ended") return this.finish("ended");
      if (event.type === "stopped") return this.finish("stopped");
      if (event.type === "blocked") return this.finish("blocked");
      if (event.type === "error") return this.finish("error");
    }
  }
}

export interface VoicePresentationAdapterDependencies {
  narration: NarrationController;
  media: MediaSessionController;
}

interface LastVoice {
  actionId: string;
  cacheKey: string;
}

export function createVoicePresentationAdapter(deps: VoicePresentationAdapterDependencies): PresentationToolAdapter {
  let lastVoice: LastVoice | undefined;

  const describeCompletion = (completion: VoiceCompletion): PresentationAdapterResult => {
    switch (completion) {
      case "ended":
        return { outcome: "presented" };
      case "stopped":
        return { outcome: "interrupted" };
      case "blocked":
        return { outcome: "blocked-by-autoplay" };
      case "error": {
        const state = deps.media.getState();
        return { outcome: "failed", failureClass: "provider_failure", message: state.status === "error" ? state.message : "voice playback ended in media error" };
      }
      case "timeout":
        deps.narration.stop();
        return { outcome: "failed", failureClass: "timeout", message: "voice playback did not end within the timeout" };
    }
  };

  const canReplayAction = (actionId: string): boolean =>
    lastVoice !== undefined
    && lastVoice.actionId === actionId
    && deps.narration.has(lastVoice.cacheKey)
    && deps.media.getState().status === "idle";

  return {
    supports(action) {
      return action.kind === "voice" && action.voice_action !== undefined;
    },
    async present({ delivery, abort }) {
      const voice = delivery.action.voice_action!;
      const cacheKey = `presentation:${delivery.session_id}:${voice.action_id}`;
      lastVoice = { actionId: voice.action_id, cacheKey };
      const waiter = new GenerationPlaybackWaiter(deps.media, VOICE_WAIT_TIMEOUT_MS);
      const onAbort = () => deps.narration.stop();
      abort.addEventListener("abort", onAbort);
      try {
        const entered = await deps.narration.enter(
          { utteranceId: voice.action_id, spokenText: voice.text, cacheKey },
          undefined,
          true,
        );
        if (entered.status === "failed") {
          return { outcome: "failed", failureClass: "provider_failure", message: "voice synthesis or playback start failed" };
        }
        if (entered.status === "aborted") {
          return { outcome: "interrupted" };
        }
        waiter.bind(entered.generation);
        return describeCompletion(await waiter.wait());
      } finally {
        abort.removeEventListener("abort", onAbort);
        waiter.dispose();
      }
    },
    async resume(abort: AbortSignal) {
      // 用户手势触发（autoplay 解锁）；恢复已挂载流，不重置 MediaSource。订阅先于
      // replay 发起——blocked/started 可能在 playUrl 内部就已发射。abort 与
      // present 同语义（打断/销毁 → narration.stop → stopped 事件）。
      const waiter = new GenerationPlaybackWaiter(deps.media, VOICE_WAIT_TIMEOUT_MS);
      const onAbort = () => deps.narration.stop();
      abort.addEventListener("abort", onAbort);
      try {
        const generation = await deps.media.resumeBlockedPlayback();
        if (generation === undefined) {
          return { outcome: "failed", failureClass: "provider_failure", message: "no cached narration available to resume" };
        }
        waiter.bind(generation);
        return describeCompletion(await waiter.wait());
      } finally {
        abort.removeEventListener("abort", onAbort);
        waiter.dispose();
      }
    },
    canReplay(actionId) {
      return canReplayAction(actionId);
    },
    replay(actionId) {
      if (!canReplayAction(actionId)) return false;
      void deps.narration.replay();
      return true;
    },
    lastReplayableActionId() {
      return lastVoice !== undefined && canReplayAction(lastVoice.actionId) ? lastVoice.actionId : undefined;
    },
  };
}
