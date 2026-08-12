import { CosyVoiceSpeechSynthesizer } from "./adapters/CosyVoiceSpeechSynthesizer";
import { ClaudeCodeTextCoachEngine } from "./adapters/ClaudeCodeTextCoachEngine";
import { DashScopeRealtimeVoiceAdapter } from "./adapters/DashScopeRealtimeVoiceAdapter";
import { QwenSpeechRecognizer } from "./adapters/QwenSpeechRecognizer";
import { InMemoryTelemetrySink } from "./adapters/InMemoryTelemetrySink";
import { NarrationApplication } from "./application/NarrationApplication";
import { CoachTurnApplication } from "./application/CoachTurnApplication";
import { LiveCoachApplication } from "./application/LiveCoachApplication";
import { SegmentPolicy } from "./application/SegmentPolicy";
import { coachModePolicy } from "./application/coachModePolicy";
import type { TelemetrySink } from "./ports/TelemetrySink";

/**
 * Composition root for the coach services. Concrete providers are chosen here
 * (and only here, plus their adapters and telemetry); the rest of the backend
 * depends on ports and the provider-neutral shared contract. Provider/model
 * names never appear in ports, application or transport.
 */
const speechSynthesizer = new CosyVoiceSpeechSynthesizer();

/** Shared turn/live mode policy — both coaching paths resolve their Assessment
 *  gate through this one instance (ADR-005 §Architectural Invariants #6). */
const modePolicy = coachModePolicy;

/** Shared provider-neutral telemetry sink — every narration/turn/live
 *  correlation is sunk here and merged with the browser-reported
 *  `browser_first_audio_at` under one correlationId (ADR-005 §Observability
 *  Contract). Provider/model names are stored server-side only. */
export const telemetrySink: TelemetrySink = new InMemoryTelemetrySink();

export const narrationApplication = new NarrationApplication(speechSynthesizer, 128, telemetrySink);

export const coachTurnApplication = new CoachTurnApplication({
  text: new ClaudeCodeTextCoachEngine(),
  speech: speechSynthesizer,
  policy: new SegmentPolicy(),
  recognizer: new QwenSpeechRecognizer(),
  modePolicy,
  sink: telemetrySink,
});

export const liveCoachApplication = new LiveCoachApplication({
  provider: new DashScopeRealtimeVoiceAdapter(),
  modePolicy,
  sink: telemetrySink,
});
