import type { LearningMode, Result } from "./TextCoachEngine";

/**
 * Provider-neutral realtime voice port (full-duplex). This is the realtime
 * counterpart to {@link TextCoachEngine} / {@link SpeechSynthesizer}: concrete
 * providers (DashScope qwen-omni-realtime, …) implement it in the adapters
 * layer, and provider/model names live only there and in the composition root
 * and telemetry — never in ports, application or transport.
 *
 * The public contract mirrors the provider-neutral live media protocol in
 * `shared/coachMedia.ts`: the browser can only express typed intents here, never
 * a raw provider `session.update` / tool / model / instruction event.
 */

/** Safe, Assessment-stripped coaching context. Built once by the shared
 *  `coachContextBuilder` and consumed by both the turn path (as the base of
 *  `TextCoachInput`) and the live path (passed to this port). Assessment mode
 *  always yields an empty `visibleSolution` and no private answer truth. */
export interface CoachContext {
  mode: LearningMode;
  problemLatex: string;
  action: { actionId: string; title: string; instruction: string };
  /** Assessment-stripped: always `[]` in assessment mode. */
  visibleSolution: string[];
  /** `learn` mode only: reviewed teaching targets authorized for the model. */
  reviewedTeachingTargets?: unknown;
  /** Public, Assessment-safe student trace. Never carries private answer truth. */
  trace: unknown;
}

/** Provider-neutral realtime commands. These are the only intents the
 *  application may express; the adapter maps each to its provider's wire
 *  protocol. `open` is handled by {@link RealtimeVoiceProvider.open}. */
export type RealtimeVoiceCommand =
  | { type: "update-context"; context: CoachContext }
  | { type: "append-audio"; audioBase64: string; mimeType: "audio/pcm"; sampleRate: number }
  | { type: "commit-turn" }
  | { type: "interrupt" }
  | { type: "close"; reason: string };

/** Provider-neutral realtime events emitted to the application. These mirror
 *  the public `LiveCoachServerEvent` payload shapes (minus the transport
 *  envelope), so the application can forward them without provider knowledge. */
export type RealtimeVoiceEvent =
  | { type: "ready"; inputSampleRate: number; outputSampleRate: number }
  | { type: "transcript-delta"; role: "student" | "coach"; text: string }
  | { type: "audio-delta"; audioBase64: string; mimeType: "audio/pcm"; sampleRate: number }
  | { type: "interrupted" }
  | { type: "context-updated"; actionId: string }
  | { type: "completed" }
  | { type: "closed"; reason: string }
  | { type: "error"; code: string; retryable: boolean };

export class RealtimeVoiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) {
    super(message);
  }
}

/** A live realtime voice session backed by a provider. The application drives it
 *  through typed commands and pulls typed public events; it never sees the
 *  provider's raw socket, model name or event protocol. */
export interface RealtimeVoiceSession {
  /** Pull the next provider-neutral event, or `done` when the session ends. */
  next(): Promise<IteratorResult<RealtimeVoiceEvent>>;
  /** Send a provider-neutral command. Rejects with `RealtimeVoiceError` on a
   *  hard provider failure. */
  send(command: RealtimeVoiceCommand): Promise<void>;
  /** Close the provider session and stop further events. */
  close(reason: string): Promise<void>;
}

/** Provider-neutral realtime voice port. The application opens a session with a
 *  safe {@link CoachContext}; the adapter performs the provider handshake and
 *  returns a session the application can drive. */
export interface RealtimeVoiceProvider {
  open(context: CoachContext, signal: AbortSignal): Promise<Result<RealtimeVoiceSession, RealtimeVoiceError>>;
}
