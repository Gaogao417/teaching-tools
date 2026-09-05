import type { MediaSessionController } from "../audio/MediaSessionController";

export interface NarrationUtterance { utteranceId: string; spokenText: string; cacheKey: string }
export interface NarrationClient { synthesize(text: string, signal: AbortSignal, correlationId?: string): Promise<{ audioUrl: string }> }
const sharedNarrationCache = new Map<string, string>();
export function clearNarrationCacheForTests(): void { sharedNarrationCache.clear(); }

/**
 * F7 Step 6：enter 的细分结果。旧签名只回 `audioUrl | undefined`，把
 * 「被取消/被替换」与「合成失败」折成同一个 undefined——canonical
 * PresentationRuntime 必须区分二者（aborted 不是 provider failure）。
 */
export type NarrationEnterResult =
  | { status: "playing"; audioUrl: string; generation: number }
  | { status: "aborted" }
  | { status: "failed" };

/** Bounded deterministic narration prefetch/cache. It never calls a language model. */
export class NarrationController {
  private readonly cache = sharedNarrationCache;
  private abort?: AbortController;
  private current?: NarrationUtterance;

  constructor(private readonly client: NarrationClient, private readonly media: MediaSessionController, private readonly capacity = 8) {}

  async enter(current: NarrationUtterance, next: NarrationUtterance | undefined, autoplay: boolean): Promise<NarrationEnterResult> {
    this.abort?.abort();
    this.media.stop("narration");
    this.current = current;
    const abort = new AbortController();
    this.abort = abort;
    try {
      const url = await this.load(current, abort.signal);
      if (abort.signal.aborted || this.current?.utteranceId !== current.utteranceId) return { status: "aborted" };
      // ADR-005 §Observability Contract: thread the utterance id as the
      // correlationId so the server-side narration timeline merges with the
      // browser-reported `browser_first_audio_at` under one id.
      const generation = await this.media.playUrl("narration", url, { autoplay, replayKey: "action-narration", correlationId: current.utteranceId });
      if (next) void this.load(next, abort.signal).catch(() => undefined);
      return { status: "playing", audioUrl: url, generation };
    } catch {
      if (abort.signal.aborted || this.current?.utteranceId !== current.utteranceId) return { status: "aborted" };
      return { status: "failed" };
    }
  }

  /** 重播最近一次播放的缓存（用户手势触发 autoplay 可解锁）；返回新播放
   *  generation（无缓存句柄时 undefined）。 */
  replay(): Promise<number | undefined> { return this.media.replay("action-narration"); }
  stop(): void { this.abort?.abort(); this.media.stop("narration"); }
  has(cacheKey: string): boolean { return this.cache.has(cacheKey); }

  private async load(utterance: NarrationUtterance, signal: AbortSignal): Promise<string> {
    const cached = this.cache.get(utterance.cacheKey);
    if (cached) return cached;
    const speech = await this.client.synthesize(utterance.spokenText, signal, utterance.utteranceId);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    this.cache.set(utterance.cacheKey, speech.audioUrl);
    while (this.cache.size > this.capacity) {
      const oldestKey = this.cache.keys().next().value!;
      const oldestUrl = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      if (oldestUrl?.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(oldestUrl);
    }
    return speech.audioUrl;
  }
}
