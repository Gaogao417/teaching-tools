import { isCoachDirective, type CoachDirective } from "./actionRuntime";

/** Provider-neutral browser/server media contracts. Provider and model metadata stay server-side. */
export const COACH_MEDIA_PROTOCOL_VERSION = 3 as const;

export type CoachMediaMode = "narration" | "turn" | "live";
export interface VoiceTelemetryEvent {
  version: typeof COACH_MEDIA_PROTOCOL_VERSION;
  correlationId: string;
  sessionId: string;
  owner: CoachMediaMode;
  stage: "requested" | "browser-audio-started" | "blocked-by-autoplay" | "cancelled" | "completed" | "error";
  browserTimeMs: number;
}

export interface MediaEnvelope {
  version: typeof COACH_MEDIA_PROTOCOL_VERSION;
  correlationId: string;
  sessionId: string;
  sequence: number;
  at: string;
}

export interface NarrationRequest {
  version: typeof COACH_MEDIA_PROTOCOL_VERSION;
  correlationId: string;
  sessionId: string;
  utteranceId: string;
  spokenText: string;
  cacheKey: string;
}

export type NarrationEvent =
  | (MediaEnvelope & { type: "narration.ready"; utteranceId: string; cached: boolean; mimeType: string; sampleRate?: number })
  | (MediaEnvelope & { type: "narration.audio"; utteranceId: string; audioBase64: string; final: boolean })
  | (MediaEnvelope & { type: "narration.blocked"; utteranceId: string; reason: "autoplay" })
  | (MediaEnvelope & { type: "narration.completed"; utteranceId: string })
  | (MediaEnvelope & { type: "narration.cancelled"; utteranceId: string })
  | (MediaEnvelope & { type: "narration.error"; utteranceId: string; code: string; retryable: boolean });

export interface CoachTurnStart {
  version: typeof COACH_MEDIA_PROTOCOL_VERSION;
  correlationId: string;
  sessionId: string;
  exerciseId: string;
  actionId: string;
  mode: "learn" | "guided-practice" | "assessment";
  studentText?: string;
  studentAudio?: { mimeType: string; audioBase64: string; durationMs?: number };
}

/**
 * A policy-approved, read-aloud chunk of the coach reply. `displayText` is what
 * the transcript bubble shows; `spokenText` is what was sent to TTS (the two
 * differ only when display and spoken copy are intentionally split). Both are
 * provider-neutral plain text — no provider/model metadata crosses here.
 */
export interface SpokenSegment {
  segmentId: string;
  displayText: string;
  spokenText: string;
}

export type CoachTurnEvent =
  | (MediaEnvelope & { type: "turn.started" })
  | (MediaEnvelope & { type: "turn.transcript.delta"; role: "student" | "coach"; text: string })
  | (MediaEnvelope & { type: "turn.segment.started"; segment: SpokenSegment })
  | (MediaEnvelope & { type: "turn.audio.delta"; segmentId: string; audioBase64: string; mimeType: string })
  | (MediaEnvelope & { type: "turn.audio.completed"; segmentId: string })
  | (MediaEnvelope & { type: "turn.directive"; directive: CoachDirective })
  | (MediaEnvelope & { type: "turn.completed" })
  | (MediaEnvelope & { type: "turn.cancelled" })
  | (MediaEnvelope & { type: "turn.error"; code: string; retryable: boolean });

export type LiveCoachClientEvent =
  | (MediaEnvelope & { type: "live.start"; exerciseId: string; actionId: string; mode: "learn" | "guided-practice" })
  | (MediaEnvelope & { type: "live.audio"; audioBase64: string; mimeType: "audio/pcm"; sampleRate: number })
  | (MediaEnvelope & { type: "live.commit" })
  | (MediaEnvelope & { type: "live.interrupt" })
  | (MediaEnvelope & { type: "live.update-context"; actionId: string; instruction: string })
  | (MediaEnvelope & { type: "live.stop" });

export type LiveCoachServerEvent =
  | (MediaEnvelope & { type: "live.ready"; inputSampleRate: number; outputSampleRate: number })
  | (MediaEnvelope & { type: "live.transcript.delta"; role: "student" | "coach"; text: string })
  | (MediaEnvelope & { type: "live.audio"; audioBase64: string; mimeType: "audio/pcm"; sampleRate: number })
  | (MediaEnvelope & { type: "live.interrupted" })
  | (MediaEnvelope & { type: "live.context-updated"; actionId: string })
  | (MediaEnvelope & { type: "live.completed" })
  | (MediaEnvelope & { type: "live.error"; code: string; retryable: boolean });

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: Record<string, unknown>, key: string) => typeof value[key] === "string" && String(value[key]).length > 0;
const envelope = (value: Record<string, unknown>) => value.version === COACH_MEDIA_PROTOCOL_VERSION
  && string(value, "correlationId") && string(value, "sessionId") && Number.isInteger(value.sequence) && Number(value.sequence) >= 0 && string(value, "at");

export function isNarrationRequest(value: unknown): value is NarrationRequest {
  return record(value) && value.version === COACH_MEDIA_PROTOCOL_VERSION && string(value, "correlationId")
    && string(value, "sessionId") && string(value, "utteranceId") && string(value, "spokenText") && string(value, "cacheKey");
}

export function isNarrationEvent(value: unknown): value is NarrationEvent {
  if (!record(value) || !envelope(value) || !string(value, "type") || !string(value, "utteranceId")) return false;
  switch (value.type) {
    case "narration.ready": return typeof value.cached === "boolean" && string(value, "mimeType") && (value.sampleRate === undefined || Number.isInteger(value.sampleRate));
    case "narration.audio": return string(value, "audioBase64") && typeof value.final === "boolean";
    case "narration.blocked": return value.reason === "autoplay";
    case "narration.completed":
    case "narration.cancelled": return true;
    case "narration.error": return string(value, "code") && typeof value.retryable === "boolean";
    default: return false;
  }
}

const isSpokenSegment = (value: unknown): value is SpokenSegment => record(value)
  && string(value, "segmentId") && string(value, "displayText") && string(value, "spokenText");

export function isCoachTurnEvent(value: unknown): value is CoachTurnEvent {
  if (!record(value) || !envelope(value) || !string(value, "type")) return false;
  switch (value.type) {
    case "turn.started":
    case "turn.completed":
    case "turn.cancelled": return true;
    case "turn.transcript.delta": return ["student", "coach"].includes(String(value.role)) && typeof value.text === "string";
    case "turn.segment.started": return isSpokenSegment(value.segment);
    case "turn.audio.delta": return string(value, "segmentId") && string(value, "audioBase64") && string(value, "mimeType");
    case "turn.audio.completed": return string(value, "segmentId");
    case "turn.directive": return isCoachDirective(value.directive) && typeof value.directive.spokenText === "string";
    case "turn.error": return string(value, "code") && typeof value.retryable === "boolean";
    default: return false;
  }
}

export function isLiveCoachClientEvent(value: unknown): value is LiveCoachClientEvent {
  if (!record(value) || !envelope(value) || !string(value, "type")) return false;
  switch (value.type) {
    case "live.start": return string(value, "exerciseId") && string(value, "actionId") && ["learn", "guided-practice"].includes(String(value.mode));
    case "live.audio": return string(value, "audioBase64") && value.mimeType === "audio/pcm" && Number.isInteger(value.sampleRate) && Number(value.sampleRate) > 0;
    case "live.update-context": return string(value, "actionId") && string(value, "instruction");
    case "live.commit":
    case "live.interrupt":
    case "live.stop": return true;
    default: return false;
  }
}

export function isLiveCoachServerEvent(value: unknown): value is LiveCoachServerEvent {
  if (!record(value) || !envelope(value) || !string(value, "type")) return false;
  switch (value.type) {
    case "live.ready": return Number.isInteger(value.inputSampleRate) && Number(value.inputSampleRate) > 0
      && Number.isInteger(value.outputSampleRate) && Number(value.outputSampleRate) > 0;
    case "live.transcript.delta": return ["student", "coach"].includes(String(value.role)) && typeof value.text === "string";
    case "live.audio": return string(value, "audioBase64") && value.mimeType === "audio/pcm" && Number.isInteger(value.sampleRate) && Number(value.sampleRate) > 0;
    case "live.context-updated": return string(value, "actionId");
    case "live.interrupted":
    case "live.completed": return true;
    case "live.error": return string(value, "code") && typeof value.retryable === "boolean";
    default: return false;
  }
}

export function isVoiceTelemetryEvent(value: unknown): value is VoiceTelemetryEvent {
  return record(value) && value.version === COACH_MEDIA_PROTOCOL_VERSION && string(value, "correlationId") && string(value, "sessionId")
    && ["narration", "turn", "live"].includes(String(value.owner))
    && ["requested", "browser-audio-started", "blocked-by-autoplay", "cancelled", "completed", "error"].includes(String(value.stage))
    && Number.isFinite(value.browserTimeMs) && Number(value.browserTimeMs) >= 0;
}
