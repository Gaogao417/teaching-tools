import type { UsageSummary } from "../ports/TextCoachEngine";

/**
 * Per-correlation server-side timeline for one coach turn. Records the stage
 * timestamps called out in ADR-005 §Observability Contract and emits a single
 * structured line when the turn reaches a terminal state. Provider/model are
 * included (server-only). This never logs full student audio, private answers,
 * or secrets — only counts and timestamps.
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
    // Server-only structured log; browser receives only its own playback marks.
    console.info("coach_turn_timeline", JSON.stringify(timeline));
    return timeline;
  }

  complete(): CoachTurnTimeline { return this.emit("completed"); }
  cancel(): CoachTurnTimeline { return this.emit("cancelled"); }
  fail(): CoachTurnTimeline { return this.emit("failed"); }
}
