import type {
  BrowserPlaybackStage,
  ServerTimelineUpdate,
  TelemetrySink,
  VoiceCorrelationTimeline,
  VoiceFlowKind,
} from "../ports/TelemetrySink";

/**
 * Process-wide in-memory {@link TelemetrySink} (ADR-005 §Observability Contract).
 *
 * Keeps the most recent merged per-correlation timeline in a bounded map. All
 * record calls are best-effort: any failure is swallowed and logged so the
 * coach/training request path never observes a telemetry error and attempt/world
 * is never changed. Provider/model names are stored here server-side only and
 * stripped by {@link sanitizeTimeline} before any read leaves the server.
 *
 * The adapter is provider-neutral (no provider import) and is the default sink
 * wired in the composition root. It also emits a structured server-only log line
 * for the terminal server timeline so the pre-existing `coach_turn_timeline`
 * observability is preserved while the data is additionally persisted/correlated
 * here. A SQLite-backed adapter can be dropped in behind the same port without
 * touching application code.
 */
const DEFAULT_CAPACITY = 512;

export class InMemoryTelemetrySink implements TelemetrySink {
  private readonly store = new Map<string, VoiceCorrelationTimeline>();

  constructor(private readonly capacity = DEFAULT_CAPACITY) {}

  record(update: ServerTimelineUpdate): void {
    try {
      const existing = this.store.get(update.correlationId);
      const merged = mergeServer(existing, update);
      this.put(merged);
      if (merged.terminal) console.info(`${merged.flow}_timeline`, JSON.stringify(toLogObject(merged)));
    } catch (error) {
      console.error("telemetry_sink_record_failed", error);
    }
  }

  recordBrowserMark(correlationId: string, flow: VoiceFlowKind, stage: BrowserPlaybackStage, browserTimeMs: number): void {
    try {
      const existing = this.store.get(correlationId);
      const base: VoiceCorrelationTimeline = existing ?? { correlationId, flow, updatedAt: browserTimeMs };
      const merged: VoiceCorrelationTimeline = { ...base, flow: existing?.flow ?? flow };
      switch (stage) {
        case "browser-audio-started": merged.browserFirstAudioAt = merged.browserFirstAudioAt ?? browserTimeMs; break;
        case "blocked-by-autoplay": merged.browserAutoplayBlocked = true; break;
        case "cancelled": merged.browserCancelledAt = merged.browserCancelledAt ?? browserTimeMs; break;
        case "completed": merged.browserCompletedAt = merged.browserCompletedAt ?? browserTimeMs; break;
        case "error": merged.browserErroredAt = merged.browserErroredAt ?? browserTimeMs; break;
        default: break; // "requested" needs no persisted field
      }
      merged.updatedAt = Date.now();
      this.put(merged);
    } catch (error) {
      console.error("telemetry_sink_browser_mark_failed", error);
    }
  }

  getTimeline(correlationId: string): VoiceCorrelationTimeline | undefined {
    return this.store.get(correlationId);
  }

  list(): VoiceCorrelationTimeline[] {
    return [...this.store.values()];
  }

  private put(timeline: VoiceCorrelationTimeline): void {
    if (!this.store.has(timeline.correlationId) && this.store.size >= this.capacity) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(timeline.correlationId, timeline);
  }
}

/** Merge a server-side update into an existing timeline, preserving the
 *  browser-reported fields and only filling server stages that are present. */
function mergeServer(existing: VoiceCorrelationTimeline | undefined, update: ServerTimelineUpdate): VoiceCorrelationTimeline {
  const sessionId = firstDefined(update.sessionId, existing?.sessionId);
  return {
    correlationId: update.correlationId,
    flow: existing?.flow ?? update.flow,
    sessionId,
    mode: firstDefined(update.mode, existing?.mode),
    requestStartedAt: firstDefined(update.requestStartedAt, existing?.requestStartedAt),
    providerConnectedAt: firstDefined(update.providerConnectedAt, existing?.providerConnectedAt),
    llmFirstTextAt: firstDefined(update.llmFirstTextAt, existing?.llmFirstTextAt),
    firstSpokenSegmentAt: firstDefined(update.firstSpokenSegmentAt, existing?.firstSpokenSegmentAt),
    ttsFirstAudioAt: firstDefined(update.ttsFirstAudioAt, existing?.ttsFirstAudioAt),
    completedAt: firstDefined(update.completedAt, existing?.completedAt),
    cancelledAt: firstDefined(update.cancelledAt, existing?.cancelledAt),
    failedAt: firstDefined(update.failedAt, existing?.failedAt),
    terminal: firstDefined(update.terminal, existing?.terminal),
    provider: firstDefined(update.provider, existing?.provider),
    model: firstDefined(update.model, existing?.model),
    usage: firstDefined(update.usage, existing?.usage),
    segmentCount: firstDefined(update.segmentCount, existing?.segmentCount),
    audioDeltas: firstDefined(update.audioDeltas, existing?.audioDeltas),
    bufferedBytes: firstDefined(update.bufferedBytes, existing?.bufferedBytes),
    droppedChunks: firstDefined(update.droppedChunks, existing?.droppedChunks),
    browserFirstAudioAt: existing?.browserFirstAudioAt,
    browserAutoplayBlocked: existing?.browserAutoplayBlocked,
    browserCancelledAt: existing?.browserCancelledAt,
    browserCompletedAt: existing?.browserCompletedAt,
    browserErroredAt: existing?.browserErroredAt,
    updatedAt: Date.now(),
  };
}

function firstDefined<T>(...values: (T | undefined)[]): T | undefined {
  for (const value of values) if (value !== undefined) return value;
  return undefined;
}

/** Plain object for the server-only structured log (provider/model kept; log is server-side only). */
function toLogObject(timeline: VoiceCorrelationTimeline): Record<string, unknown> {
  return { ...timeline };
}
