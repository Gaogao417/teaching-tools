export type MediaOwner = "narration" | "coach-turn" | "live";

/** Who may hold the microphone. Capture is mutually exclusive with every other
 *  capture owner — a turn recording and a live session can never share the mic
 *  (ADR-005 §Exclusive media session). */
export type CaptureOwner = "coach-turn" | "live";

/**
 * Exclusive microphone capture lease. Acquire BEFORE
 * `navigator.mediaDevices.getUserMedia`; release on stop, failure or permission
 * denial. `acquireCapture` returns `null` when another owner already holds the
 * mic — in that case the caller MUST NOT call `getUserMedia`. Release is
 * idempotent and only the current holder releases.
 */
export interface CaptureLease {
  readonly owner: CaptureOwner;
  release(): void;
}

export type MediaSessionState =
  | { status: "idle" }
  | { status: "loading" | "playing"; owner: MediaOwner; replayKey?: string }
  | { status: "blocked-by-autoplay"; owner: MediaOwner; replayKey?: string }
  | { status: "error"; owner: MediaOwner; message: string };

/**
 * F7 Step 6：单次播放尝试的生命周期事件（携带发起该次播放的 generation）。
 * 与 subscribe 的聚合状态正交：状态只知道「现在如何」，事件能区分
 * `ended`（自然播完）与 `stopped`（被停/被替换）——PresentationRuntime 只
 * 允许对应播放的 `ended` 产生 presented，聚合 idle 不再等价于播完。
 */
export type MediaPlaybackEvent =
  | { type: "started"; owner: MediaOwner; generation: number }
  | { type: "ended"; owner: MediaOwner; generation: number }
  | { type: "stopped"; owner: MediaOwner; generation: number }
  | { type: "blocked"; owner: MediaOwner; generation: number }
  | { type: "error"; owner: MediaOwner; generation: number; message: string };

interface UrlHandle { owner: MediaOwner; url: string; replayKey?: string; correlationId?: string; started?: boolean }
export interface MediaTelemetryMark { correlationId: string; owner: "narration" | "turn" | "live"; stage: "requested" | "browser-audio-started" | "blocked-by-autoplay" | "cancelled" | "completed" | "error"; browserTimeMs: number }

/** Handle returned to a caller driving incremental audio. Chunks are appended in
 *  arrival order to a single MediaSource; `complete` finalizes the stream. */
export interface AudioStreamHandle {
  appendChunk(bytes: Uint8Array): void;
  complete(): void;
}
interface StreamHandle extends AudioStreamHandle {
  owner: MediaOwner;
  abort(): void;
}

/** Owns every browser playback path and guarantees that only one media owner is audible. */
export class MediaSessionController {
  private audio?: HTMLAudioElement;
  private state: MediaSessionState = { status: "idle" };
  private readonly listeners = new Set<(state: MediaSessionState) => void>();
  private readonly playbackListeners = new Set<(event: MediaPlaybackEvent) => void>();
  private readonly replayHandles = new Map<string, UrlHandle>();
  private generation = 0;
  /** generation of the playback attempt that currently owns the output. */
  private activeGeneration = 0;
  private lastStartedGeneration = -1;
  private active?: UrlHandle;
  private externalStop?: () => void;
  private queue: UrlHandle[] = [];
  private streamHandle?: StreamHandle;
  // ADR-005 §Exclusive media session: at most one capture owner holds the mic.
  private captureOwner?: CaptureOwner;

  constructor(private readonly telemetry?: (mark: MediaTelemetryMark) => void) {}

  getState(): MediaSessionState { return this.state; }
  subscribe(listener: (state: MediaSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** F7 Step 6：播放生命周期事件流（per-generation；见 MediaPlaybackEvent）。 */
  subscribePlaybackEvents(listener: (event: MediaPlaybackEvent) => void): () => void {
    this.playbackListeners.add(listener);
    return () => this.playbackListeners.delete(listener);
  }

  /** 当前播放代数（每次新的播放尝试递增；等待者以此绑定「本次播放」）。 */
  currentGeneration(): number { return this.generation; }

  private emitPlayback(event: MediaPlaybackEvent): void {
    // 与 telemetry 同纪律：事件监听器失败不得影响播放路径。
    for (const listener of [...this.playbackListeners]) {
      try { listener(event); } catch { /* best-effort */ }
    }
  }

  /** 以新播放接管输出时，为被替换的旧播放补发 stopped（其等待者不得悬挂）。 */
  private supersedeActive(): void {
    if (this.active) {
      const owner = this.active.owner;
      const generation = this.activeGeneration;
      this.active = undefined;
      this.emitPlayback({ type: "stopped", owner, generation });
    }
  }

  /**
   * Acquire the exclusive microphone capture lease for `owner`. Returns the
   * lease when granted, or `null` when another owner already holds the mic — in
   * that case the caller MUST NOT call `getUserMedia` (ADR-005 §Exclusive media
   * session). Capture arbitration is orthogonal to playback arbitration: a turn
   * recording and a live session can each play audio through this controller
   * while never sharing the microphone.
   */
  acquireCapture(owner: CaptureOwner): CaptureLease | null {
    if (this.captureOwner) return null;
    this.captureOwner = owner;
    let released = false;
    return {
      owner,
      release: () => {
        if (released) return;
        released = true;
        if (this.captureOwner === owner) this.captureOwner = undefined;
      },
    };
  }

  /** Release the capture lease if `owner` currently holds it. Idempotent. */
  releaseCapture(owner: CaptureOwner): void {
    if (this.captureOwner === owner) this.captureOwner = undefined;
  }

  /** The owner currently holding the microphone, if any. */
  getCaptureOwner(): CaptureOwner | undefined { return this.captureOwner; }

  /** 开始一次 URL 播放；resolve 值为本次播放的 generation（供等待者绑定）。 */
  async playUrl(owner: MediaOwner, url: string, options: { autoplay: boolean; replayKey?: string; correlationId?: string } = { autoplay: true }): Promise<number> {
    const generation = ++this.generation;
    this.externalStop?.();
    this.externalStop = undefined;
    this.queue = [];
    this.abortStream();
    this.supersedeActive();
    this.stopAudio();
    const handle = { owner, url, replayKey: options.replayKey, correlationId: options.correlationId };
    this.active = handle;
    this.activeGeneration = generation;
    if (options.replayKey) this.replayHandles.set(options.replayKey, handle);
    const audio = this.ensureAudio();
    audio.src = url;
    this.setState({ status: "loading", owner, replayKey: options.replayKey });
    this.mark(handle, "requested");
    if (!options.autoplay) return generation;
    try {
      await audio.play();
      if (generation === this.generation) this.notifyAudioStarted(owner);
    } catch {
      if (generation === this.generation) {
        this.setState({ status: "blocked-by-autoplay", owner, replayKey: options.replayKey });
        this.mark(handle, "blocked-by-autoplay");
        this.emitPlayback({ type: "blocked", owner, generation });
      }
    }
    return generation;
  }

  /**
   * Open a single-owner incremental audio stream for `owner` and return a handle
   * that the caller feeds MP3 chunks to. All chunks of a turn are appended in
   * arrival order to ONE MediaSource SourceBuffer — we never carve each chunk
   * into a separate `<audio>` data URL. The first appended chunk triggers
   * playback (and the browser-audio-started telemetry mark); playback begins
   * before the full answer has arrived. Starting a stream interrupts narration,
   * live and any previous turn. If MediaSource is unavailable the handle degrades
   * to buffering the whole turn into one Blob played at completion (still a
   * single owner, never overlapping audio).
   */
  startAudioStream(owner: MediaOwner, options: { correlationId?: string } = {}): AudioStreamHandle {
    const generation = ++this.generation;
    this.externalStop?.();
    this.externalStop = undefined;
    this.abortStream();
    this.supersedeActive();
    this.stopAudio();
    this.queue = [];
    this.active = { owner, url: "", correlationId: options.correlationId };
    this.activeGeneration = generation;
    this.setState({ status: "loading", owner });
    this.mark(this.active, "requested");

    const supportsMediaSource = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg");

    if (!supportsMediaSource) {
      const chunks: Uint8Array[] = [];
      let finished = false;
      const flush = () => {
        if (!finished || generation !== this.generation || !chunks.length) return;
        const blobUrl = URL.createObjectURL(new Blob(chunks as unknown as BlobPart[], { type: "audio/mpeg" }));
        void this.playUrl(owner, blobUrl, { autoplay: true, correlationId: options.correlationId });
      };
      const handle: StreamHandle = {
        owner,
        appendChunk: (bytes) => { if (generation === this.generation) chunks.push(bytes); },
        complete: () => { finished = true; flush(); },
        abort: () => { chunks.length = 0; },
      };
      this.streamHandle = handle;
      return handle;
    }

    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    const audio = this.ensureAudio();
    audio.src = objectUrl;
    let sourceBuffer: SourceBuffer | undefined;
    const pending: Uint8Array[] = [];
    let ended = false;
    let aborted = false;
    let firstAppended = false;

    const pump = () => {
      if (aborted || generation !== this.generation || !sourceBuffer || sourceBuffer.updating || pending.length === 0) return;
      const chunk = pending.shift()!;
      try { sourceBuffer.appendBuffer(chunk as unknown as BufferSource); } catch { /* drop unparseable frame, keep streaming */ }
    };
    const finishIfDrained = () => {
      if (ended && pending.length === 0 && mediaSource.readyState === "open") {
        try { mediaSource.endOfStream(); } catch { /* ignore */ }
      }
    };
    mediaSource.addEventListener("sourceopen", () => {
      if (aborted || generation !== this.generation) return;
      try { sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg"); }
      catch { this.fail(owner, generation, "media-source-buffer-failed"); return; }
      sourceBuffer.addEventListener("updateend", () => {
        if (aborted || generation !== this.generation) return;
        if (!firstAppended) { firstAppended = true; this.tryPlay(owner, generation); }
        finishIfDrained();
        pump();
      });
      pump();
    });

    const handle: StreamHandle = {
      owner,
      appendChunk: (bytes) => {
        if (aborted || generation !== this.generation) return;
        pending.push(bytes);
        pump();
      },
      complete: () => {
        if (aborted || generation !== this.generation) return;
        ended = true;
        finishIfDrained();
      },
      abort: () => {
        aborted = true;
        pending.length = 0;
        if (mediaSource.readyState === "open") { try { mediaSource.endOfStream(); } catch { /* ignore */ } }
      },
    };
    this.streamHandle = handle;
    return handle;
  }

  private tryPlay(owner: MediaOwner, generation: number): void {
    if (generation !== this.generation || !this.audio) return;
    void this.audio.play()
      .then(() => { if (generation === this.generation) this.notifyAudioStarted(owner); })
      .catch(() => {
        if (generation === this.generation) {
          this.setState({ status: "blocked-by-autoplay", owner, replayKey: this.active?.replayKey });
          if (this.active) this.mark(this.active, "blocked-by-autoplay");
          this.emitPlayback({ type: "blocked", owner, generation });
        }
      });
  }

  private fail(owner: MediaOwner, generation: number, message: string): void {
    if (generation !== this.generation) return;
    this.setState({ status: "error", owner, message });
    if (this.active) this.mark(this.active, "error");
    this.emitPlayback({ type: "error", owner, generation, message });
  }

  private abortStream(): void {
    const handle = this.streamHandle;
    this.streamHandle = undefined;
    handle?.abort();
  }

  replay(replayKey: string): Promise<number | undefined> {
    const handle = this.replayHandles.get(replayKey);
    return handle ? this.playUrl(handle.owner, handle.url, { autoplay: true, replayKey }) : Promise.resolve(undefined);
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
    this.activeGeneration = ++this.generation;
    this.setState({ status: "loading", owner });
    this.mark(this.active, "requested");
  }

  release(owner: MediaOwner): void {
    if (this.active?.owner !== owner) return;
    const generation = this.activeGeneration;
    this.externalStop = undefined;
    this.active = undefined;
    this.emitPlayback({ type: "stopped", owner, generation });
    this.setState({ status: "idle" });
  }

  notifyAudioStarted(owner: MediaOwner): void {
    if (!this.active || this.active.owner !== owner) return;
    this.setState({ status: "playing", owner, replayKey: this.active.replayKey });
    if (this.activeGeneration !== this.lastStartedGeneration) {
      this.lastStartedGeneration = this.activeGeneration;
      this.emitPlayback({ type: "started", owner, generation: this.activeGeneration });
    }
    if (!this.active.started) { this.active.started = true; this.mark(this.active, "browser-audio-started"); }
  }

  stop(owner?: MediaOwner): void {
    if (owner && this.active?.owner !== owner) return;
    if (this.active) {
      const stoppedOwner = this.active.owner;
      const stoppedGeneration = this.activeGeneration;
      this.mark(this.active, "cancelled");
      this.emitPlayback({ type: "stopped", owner: stoppedOwner, generation: stoppedGeneration });
    }
    this.generation += 1;
    this.queue = [];
    const externalStop = this.externalStop;
    this.externalStop = undefined;
    externalStop?.();
    this.abortStream();
    this.stopAudio();
    this.active = undefined;
    this.setState({ status: "idle" });
  }

  dispose(): void {
    this.stop();
    this.captureOwner = undefined;
    this.listeners.clear();
    this.playbackListeners.clear();
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
        if (this.active) {
          this.emitPlayback({ type: "ended", owner: this.active.owner, generation: this.activeGeneration });
          this.mark(this.active, "completed");
        }
        this.active = undefined;
        if (this.queue.length) this.playQueued();
        else this.setState({ status: "idle" });
      };
      this.audio.onerror = () => {
        if (this.active) {
          const owner = this.active.owner;
          const generation = this.activeGeneration;
          this.setState({ status: "error", owner, message: "media playback failed" });
          this.mark(this.active, "error");
          this.emitPlayback({ type: "error", owner, generation, message: "media playback failed" });
        }
      };
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
    this.activeGeneration = ++this.generation;
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
    // ADR-005 §Observability Contract: the browser-first-audio reporter is
    // best-effort above all else. A telemetry callback failure (network throw,
    // abort, autoplay-block) MUST NOT propagate into the playback/coach/training
    // path or change attempt/world — so swallow any synchronous error here.
    try {
      this.telemetry?.({ correlationId: handle.correlationId, owner: handle.owner === "coach-turn" ? "turn" : handle.owner, stage, browserTimeMs: Date.now() });
    } catch {
      /* telemetry is best-effort; never let it break playback */
    }
  }
}
