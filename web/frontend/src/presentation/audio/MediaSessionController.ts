export type MediaOwner = "narration" | "coach-turn" | "live";
export type MediaSessionState =
  | { status: "idle" }
  | { status: "loading" | "playing"; owner: MediaOwner; replayKey?: string }
  | { status: "blocked-by-autoplay"; owner: MediaOwner; replayKey?: string }
  | { status: "error"; owner: MediaOwner; message: string };

interface UrlHandle { owner: MediaOwner; url: string; replayKey?: string; correlationId?: string; started?: boolean }
export interface MediaTelemetryMark { correlationId: string; owner: "narration" | "turn" | "live"; stage: "requested" | "browser-audio-started" | "blocked-by-autoplay" | "cancelled" | "completed" | "error"; browserTimeMs: number }

/** Owns every browser playback path and guarantees that only one media owner is audible. */
export class MediaSessionController {
  private audio?: HTMLAudioElement;
  private state: MediaSessionState = { status: "idle" };
  private readonly listeners = new Set<(state: MediaSessionState) => void>();
  private readonly replayHandles = new Map<string, UrlHandle>();
  private generation = 0;
  private active?: UrlHandle;
  private externalStop?: () => void;
  private queue: UrlHandle[] = [];

  constructor(private readonly telemetry?: (mark: MediaTelemetryMark) => void) {}

  getState(): MediaSessionState { return this.state; }
  subscribe(listener: (state: MediaSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async playUrl(owner: MediaOwner, url: string, options: { autoplay: boolean; replayKey?: string; correlationId?: string } = { autoplay: true }): Promise<void> {
    const generation = ++this.generation;
    this.externalStop?.();
    this.externalStop = undefined;
    this.queue = [];
    this.stopAudio();
    const handle = { owner, url, replayKey: options.replayKey, correlationId: options.correlationId };
    this.active = handle;
    if (options.replayKey) this.replayHandles.set(options.replayKey, handle);
    const audio = this.ensureAudio();
    audio.src = url;
    this.setState({ status: "loading", owner, replayKey: options.replayKey });
    this.mark(handle, "requested");
    if (!options.autoplay) return;
    try {
      await audio.play();
      if (generation === this.generation) this.notifyAudioStarted(owner);
    } catch {
      if (generation === this.generation) { this.setState({ status: "blocked-by-autoplay", owner, replayKey: options.replayKey }); this.mark(handle, "blocked-by-autoplay"); }
    }
  }

  replay(replayKey: string): Promise<void> {
    const handle = this.replayHandles.get(replayKey);
    return handle ? this.playUrl(handle.owner, handle.url, { autoplay: true, replayKey }) : Promise.resolve();
  }

  enqueueUrl(owner: MediaOwner, url: string, replayKey?: string, correlationId?: string): void {
    if (this.active && this.active.owner !== owner) this.stop();
    const handle = { owner, url, replayKey, correlationId };
    this.queue.push(handle);
    if (!this.active || this.state.status === "idle") this.playQueued();
  }

  acquire(owner: MediaOwner, stop: () => void, correlationId?: string): void {
    this.stop();
    this.externalStop = stop;
    this.active = { owner, url: "", correlationId };
    this.setState({ status: "loading", owner });
    this.mark(this.active, "requested");
  }

  release(owner: MediaOwner): void {
    if (this.active?.owner !== owner) return;
    this.externalStop = undefined;
    this.active = undefined;
    this.setState({ status: "idle" });
  }

  notifyAudioStarted(owner: MediaOwner): void {
    if (!this.active || this.active.owner !== owner) return;
    this.setState({ status: "playing", owner, replayKey: this.active.replayKey });
    if (!this.active.started) { this.active.started = true; this.mark(this.active, "browser-audio-started"); }
  }

  stop(owner?: MediaOwner): void {
    if (owner && this.active?.owner !== owner) return;
    if (this.active) this.mark(this.active, "cancelled");
    this.generation += 1;
    this.queue = [];
    const externalStop = this.externalStop;
    this.externalStop = undefined;
    externalStop?.();
    this.stopAudio();
    this.active = undefined;
    this.setState({ status: "idle" });
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
    this.replayHandles.clear();
    if (this.audio) this.detach(this.audio);
    this.audio = undefined;
  }

  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = "auto";
      this.audio.onplay = () => { if (this.active) this.notifyAudioStarted(this.active.owner); };
      this.audio.onpause = () => { if (this.state.status === "playing") this.setState({ status: "idle" }); };
      this.audio.onended = () => {
        if (this.active) this.mark(this.active, "completed");
        this.active = undefined;
        if (this.queue.length) this.playQueued();
        else this.setState({ status: "idle" });
      };
      this.audio.onerror = () => { if (this.active) { this.setState({ status: "error", owner: this.active.owner, message: "media playback failed" }); this.mark(this.active, "error"); } };
    }
    return this.audio;
  }

  private stopAudio(): void {
    if (!this.audio) return;
    try { this.audio.pause(); } catch { /* browser may not implement pause in tests */ }
  }

  private playQueued(): void {
    const next = this.queue.shift();
    if (!next) return;
    this.active = next;
    if (next.replayKey) this.replayHandles.set(next.replayKey, next);
    const audio = this.ensureAudio();
    audio.src = next.url;
    this.setState({ status: "loading", owner: next.owner, replayKey: next.replayKey });
    this.mark(next, "requested");
    void audio.play().catch(() => { this.setState({ status: "blocked-by-autoplay", owner: next.owner, replayKey: next.replayKey }); this.mark(next, "blocked-by-autoplay"); });
  }

  private detach(audio: HTMLAudioElement): void {
    audio.onplay = null; audio.onpause = null; audio.onended = null; audio.onerror = null;
  }

  private setState(state: MediaSessionState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private mark(handle: UrlHandle, stage: MediaTelemetryMark["stage"]): void {
    if (!handle.correlationId) return;
    this.telemetry?.({ correlationId: handle.correlationId, owner: handle.owner === "coach-turn" ? "turn" : handle.owner, stage, browserTimeMs: Date.now() });
  }
}
