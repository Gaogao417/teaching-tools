import type { UsageSummary } from "./TextCoachEngine";

/**
 * ADR-005 §Observability Contract — provider-neutral sink for per-correlation
 * voice telemetry. Every narration/turn/live correlation links the server-side
 * pipeline stages (provider connected, LLM first text, TTS first audio,
 * usage/cost) with the browser-reported first-audio moment under one
 * `correlationId`.
 *
 * The port owns NO provider knowledge: provider/model names are carried inside
 * a timeline update but are stored server-side only and never returned by the
 * Assessment-safe read accessor (see {@link sanitizeTimeline}). Implementations
 * MUST NOT throw into the request/coach path — every record call swallows and
 * logs internally so a telemetry failure never changes attempt/world.
 */

/** The voice flow a correlation belongs to. */
export type VoiceFlowKind = "turn" | "live" | "narration";

/** Browser-reported playback stages (mirrors the provider-neutral
 *  `VoiceTelemetryEvent.stage` union from shared/coachMedia.ts). */
export type BrowserPlaybackStage =
  | "requested"
  | "browser-audio-started"
  | "blocked-by-autoplay"
  | "cancelled"
  | "completed"
  | "error";

/**
 * The merged per-correlation timeline. `browserFirstAudioAt` is the only
 * browser-originated timestamp; every other stage is a server-side mark.
 * Provider/model are server-side only and stripped before leaving the sink via
 * the read accessor.
 */
export interface VoiceCorrelationTimeline {
  correlationId: string;
  sessionId?: string;
  flow: VoiceFlowKind;
  mode?: string;
  requestStartedAt?: number;
  providerConnectedAt?: number;
  llmFirstTextAt?: number;
  firstSpokenSegmentAt?: number;
  ttsFirstAudioAt?: number;
  /** Browser first-audio moment (ADR-005 DoD: "browser first audio 可度量且关联服务端阶段"). */
  browserFirstAudioAt?: number;
  browserAutoplayBlocked?: boolean;
  browserCancelledAt?: number;
  browserCompletedAt?: number;
  browserErroredAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  failedAt?: number;
  terminal?: "completed" | "cancelled" | "failed";
  /** Server-only. Never returned by the Assessment-safe read accessor. */
  provider?: string;
  /** Server-only. Never returned by the Assessment-safe read accessor. */
  model?: string;
  usage?: UsageSummary;
  segmentCount?: number;
  audioDeltas?: number;
  bufferedBytes?: number;
  droppedChunks?: number;
  updatedAt: number;
}

/**
 * A partial server-side timeline update. Stage fields are optional; the sink
 * merges whatever is present under the `correlationId`. The turn/live/narration
 * use cases build this from their internal stage recorders.
 */
export interface ServerTimelineUpdate {
  correlationId: string;
  sessionId?: string;
  flow: VoiceFlowKind;
  mode?: string;
  requestStartedAt?: number;
  providerConnectedAt?: number;
  llmFirstTextAt?: number;
  firstSpokenSegmentAt?: number;
  ttsFirstAudioAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  failedAt?: number;
  terminal?: "completed" | "cancelled" | "failed";
  provider?: string;
  model?: string;
  usage?: UsageSummary;
  segmentCount?: number;
  audioDeltas?: number;
  bufferedBytes?: number;
  droppedChunks?: number;
}

/**
 * Provider-neutral sink contract. The composition root wires one shared
 * implementation behind this port; the use cases and transport depend on the
 * port only.
 */
export interface TelemetrySink {
  /** Merge a server-side timeline update under its `correlationId`. Best-effort:
   *  must never throw into the request/coach path. */
  record(update: ServerTimelineUpdate): void;
  /** Merge a browser-reported playback mark under its `correlationId`. The
   *  `browser-audio-started` stage sets `browserFirstAudioAt`. Best-effort. */
  recordBrowserMark(correlationId: string, flow: VoiceFlowKind, stage: BrowserPlaybackStage, browserTimeMs: number): void;
  /** Read the merged per-correlation timeline, or `undefined` if unseen. */
  getTimeline(correlationId: string): VoiceCorrelationTimeline | undefined;
  /** Read all known timelines (most-recently-updated last). */
  list(): VoiceCorrelationTimeline[];
}

/**
 * Assessment-safe, provider-neutral projection of a timeline for the read
 * accessor: drops `provider`/`model` (server-only) so provider metadata never
 * leaves the server. Returns a fresh plain object.
 */
export function sanitizeTimeline(timeline: VoiceCorrelationTimeline): Omit<VoiceCorrelationTimeline, "provider" | "model"> {
  const { provider: _provider, model: _model, ...safe } = timeline;
  void _provider; void _model;
  return safe;
}
