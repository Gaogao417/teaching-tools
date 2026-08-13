import path from "node:path";
import { CosyVoiceSpeechSynthesizer } from "./adapters/CosyVoiceSpeechSynthesizer";
import { FileSystemSpeechArtifactStore } from "./adapters/FileSystemSpeechArtifactStore";
import { DashScopeRealtimeVoiceAdapter } from "./adapters/DashScopeRealtimeVoiceAdapter";
import { QwenSpeechRecognizer } from "./adapters/QwenSpeechRecognizer";
import { InMemoryTelemetrySink } from "./adapters/InMemoryTelemetrySink";
import { NarrationApplication } from "./application/NarrationApplication";
import { CoachTurnApplication } from "./application/CoachTurnApplication";
import { LiveCoachApplication } from "./application/LiveCoachApplication";
import { SegmentPolicy } from "./application/SegmentPolicy";
import { coachModePolicy } from "./application/coachModePolicy";
import type { TelemetrySink } from "./ports/TelemetrySink";
import { createTextCoachEngine } from "./textCoachEngineFactory";

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

function speechArtifactStore(): FileSystemSpeechArtifactStore | undefined {
  const configured = process.env.ACTION_SPEECH_CACHE_DIR;
  // Unset enables the safe local default. An explicitly empty value, `off`,
  // `none`, or `disabled` preserves the old in-memory-only behavior.
  if (configured !== undefined) {
    const value = configured.trim();
    if (!value || ["off", "none", "disabled"].includes(value.toLowerCase())) return undefined;
    return new FileSystemSpeechArtifactStore(path.resolve(value));
  }
  return new FileSystemSpeechArtifactStore(path.resolve(process.cwd(), ".cache", "action-speech"));
}

export const narrationApplication = new NarrationApplication(
  speechSynthesizer,
  128,
  telemetrySink,
  speechArtifactStore(),
);

export const coachTurnApplication = new CoachTurnApplication({
  text: createTextCoachEngine(),
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
