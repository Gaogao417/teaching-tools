import type { UsageSummary } from "../ports/TextCoachEngine";
import type { TelemetrySink } from "../ports/TelemetrySink";

/**
 * Per-correlation server-side timeline for one coach turn. Records the stage
 * timestamps called out in ADR-005 §Observability Contract and emits a single
 * structured line when the turn reaches a terminal state. Provider/model are
 * included (server-only). This never logs full student audio, private answers,
 * or secrets — only counts and timestamps.
 *
 * On a terminal state the timeline is sunk to the provider-neutral
 * {@link TelemetrySink} (which correlates it with the browser-reported
 * `browser_first_audio_at` under the same `correlationId`). The sink call is
 * best-effort and never throws into the coach path.
 */
export interface CoachTurnTimeline {
  correlationId: string;
  sessionId: string;
  mode: string;
  requestStartedAt: number;
  providerConnectedAt?: number;
  llmFirstTextAt?: number;
  firstSpokenSegmentAt?: number;
  ttsFirstAudioAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  failedAt?: number;
  terminal: "completed" | "cancelled" | "failed";
  provider?: string;
  model?: string;
  usage?: UsageSummary;
  segmentCount: number;
  audioDeltas: number;
  bufferedBytes: number;
  droppedChunks: number;
}

export class CoachTurnTelemetry {
  readonly startedAt = Date.now();
  providerConnectedAt?: number;
  llmFirstTextAt?: number;
  firstSpokenSegmentAt?: number;
  ttsFirstAudioAt?: number;
  segmentCount = 0;
  audioDeltas = 0;
  bufferedBytes = 0;
  droppedChunks = 0;
  usage?: UsageSummary;

  constructor(
    private readonly correlationId: string,
    private readonly sessionId: string,
    readonly mode: string,
    private readonly provider?: string,
    private readonly model?: string,
    private readonly sink?: TelemetrySink,
  ) {}

  markProviderConnected(): void { this.providerConnectedAt ??= Date.now(); }
  markFirstText(): void { this.llmFirstTextAt ??= Date.now(); }
  markFirstSegment(): void { this.firstSpokenSegmentAt ??= Date.now(); }
  markFirstAudio(): void { this.ttsFirstAudioAt ??= Date.now(); }
  addAudioDelta(bytes: number): void { this.audioDeltas += 1; this.bufferedBytes += bytes; }

  private emit(terminal: CoachTurnTimeline["terminal"]): CoachTurnTimeline {
    const now = Date.now();
    const timeline: CoachTurnTimeline = {
      correlationId: this.correlationId,
      sessionId: this.sessionId,
      mode: this.mode,
      requestStartedAt: this.startedAt,
      providerConnectedAt: this.providerConnectedAt,
      llmFirstTextAt: this.llmFirstTextAt,
      firstSpokenSegmentAt: this.firstSpokenSegmentAt,
      ttsFirstAudioAt: this.ttsFirstAudioAt,
      terminal,
      provider: this.provider,
      model: this.model,
      usage: this.usage,
      segmentCount: this.segmentCount,
      audioDeltas: this.audioDeltas,
      bufferedBytes: this.bufferedBytes,
      droppedChunks: this.droppedChunks,
      ...(terminal === "completed" ? { completedAt: now }
        : terminal === "cancelled" ? { cancelledAt: now }
        : { failedAt: now }),
    };
    // Sink the server-side timeline so it is correlated with the browser's
    // `browser_first_audio_at` under the same correlationId (ADR-005 §Observability
    // Contract). The sink never throws into the coach path; the structured log
    // is emitted by the sink adapter itself.
    this.sink?.record({
      correlationId: timeline.correlationId,
      sessionId: timeline.sessionId,
      flow: "turn",
      mode: timeline.mode,
      requestStartedAt: timeline.requestStartedAt,
      providerConnectedAt: timeline.providerConnectedAt,
      llmFirstTextAt: timeline.llmFirstTextAt,
      firstSpokenSegmentAt: timeline.firstSpokenSegmentAt,
      ttsFirstAudioAt: timeline.ttsFirstAudioAt,
      completedAt: timeline.completedAt,
      cancelledAt: timeline.cancelledAt,
      failedAt: timeline.failedAt,
      terminal: timeline.terminal,
      provider: timeline.provider,
      model: timeline.model,
      usage: timeline.usage,
      segmentCount: timeline.segmentCount,
      audioDeltas: timeline.audioDeltas,
      bufferedBytes: timeline.bufferedBytes,
      droppedChunks: timeline.droppedChunks,
    });
    return timeline;
  }

  complete(): CoachTurnTimeline { return this.emit("completed"); }
  cancel(): CoachTurnTimeline { return this.emit("cancelled"); }
  fail(): CoachTurnTimeline { return this.emit("failed"); }
}
