import {
  COACH_MEDIA_PROTOCOL_VERSION,
  type LiveCoachServerEvent,
} from "../../../../../shared/coachMedia";
import type { ExercisePlan } from "../../../../../shared/actionRuntime";
import type { Result } from "../ports/TextCoachEngine";
import type {
  CoachContext,
  RealtimeVoiceCommand,
  RealtimeVoiceEvent,
  RealtimeVoiceProvider,
  RealtimeVoiceSession,
} from "../ports/RealtimeVoiceProvider";
import { RealtimeVoiceError } from "../ports/RealtimeVoiceProvider";
import { buildCoachContext } from "./coachContextBuilder";
import type { CoachModePolicy } from "./coachModePolicy";
import { coachModePolicy } from "./coachModePolicy";
import { AsyncQueue } from "./asyncQueue";

/**
 * Application use case for the full-duplex live coach (ADR-005 §Live conversation,
 * §Backend effect ports). It is the live counterpart to {@link CoachTurnApplication}:
 *
 *   browser capture → typed backend WS → LiveCoachApplication
 *     → mode policy + shared coachContextBuilder → RealtimeVoiceProvider adapter
 *     → typed public events → transport.
 *
 * The use case owns the mode gate (live is denied in Assessment), builds the
 * safe {@link CoachContext} through the shared builder, opens the provider-neutral
 * realtime port, and translates between the public media protocol and the port.
 * It never imports a provider client, model name or socket — those live in the
 * adapter and composition root only.
 */

export class LiveStartError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

/** Provider-neutral public commands the transport forwards from the browser.
 *  These are the only intents a live session accepts; none of them is a raw
 *  provider event. */
export type LiveCoachClientCommand =
  | { type: "audio"; audioBase64: string; mimeType: "audio/pcm"; sampleRate: number }
  | { type: "commit" }
  | { type: "interrupt" }
  | { type: "update-context"; actionId: string }
  | { type: "stop" };

export interface LiveCoachSession {
  /** Typed public server events (with media envelope) for the browser. */
  events: AsyncQueue<LiveCoachServerEvent>;
  /** Forward a validated browser command to the provider session. */
  send(command: LiveCoachClientCommand): Promise<void>;
  /** Tear the session down (client stop or transport close). */
  close(reason: string): Promise<void>;
}

export interface LiveCoachDeps {
  provider: RealtimeVoiceProvider;
  /** Shared turn/live mode policy. */
  modePolicy?: CoachModePolicy;
}

export interface LiveCoachStartParams {
  plan: ExercisePlan;
  actionId: string;
  correlationId: string;
  sessionId: string;
  signal: AbortSignal;
}

export class LiveCoachApplication {
  constructor(private readonly deps: LiveCoachDeps) {}

  async start(params: LiveCoachStartParams): Promise<Result<LiveCoachSession, LiveStartError>> {
    const modePolicy = this.deps.modePolicy ?? coachModePolicy;

    // Live voice is fail-closed in Assessment (ADR-005 §Transport and Safety
    // Rules #6). The gate is the same policy object the turn path uses.
    const allowance = modePolicy.allowLive(params.plan.mode);
    if (!allowance.ok) {
      return { ok: false, error: new LiveStartError(allowance.code, "Live Coach is not allowed in this mode", 403) };
    }

    const context = buildCoachContext(params.plan, { actionId: params.actionId });
    const openResult = await this.deps.provider.open(context, params.signal);
    if (!openResult.ok) {
      return { ok: false, error: new LiveStartError(openResult.error.code, openResult.error.message, 502) };
    }

    const providerSession = openResult.value;
    const queue = new AsyncQueue<LiveCoachServerEvent>();
    let sequence = 0;
    const sessionId = params.sessionId;
    const correlationId = params.correlationId;
    const envelope = (event: LiveServerPayload): LiveCoachServerEvent =>
      ({ ...event, version: COACH_MEDIA_PROTOCOL_VERSION, correlationId, sessionId, sequence: sequence++, at: new Date().toISOString() }) as LiveCoachServerEvent;
    const emit = (event: LiveServerPayload) => queue.push(envelope(event));

    let closed = false;
    const closeOnce = async (reason: string): Promise<void> => {
      if (closed) return;
      closed = true;
      try { await providerSession.close(reason); } catch { /* ignore */ }
      queue.complete();
    };

    // Pump provider-neutral port events into the public media stream.
    void this.pump(providerSession, emit, () => closeOnce("session-ended")).catch((error) => {
      if (!queue.closed) {
        const code = error instanceof RealtimeVoiceError ? error.code : "live-failed";
        emit({ type: "live.error", code, retryable: true });
        void closeOnce(code);
      }
    });

    const send = async (command: LiveCoachClientCommand): Promise<void> => {
      if (closed) return;
      if (command.type === "stop") { await closeOnce("client-stop"); return; }
      let portCommand: RealtimeVoiceCommand;
      if (command.type === "update-context") {
        // Rebuild the safe context for the new action through the shared builder.
        const nextContext: CoachContext = buildCoachContext(params.plan, { actionId: command.actionId });
        portCommand = { type: "update-context", context: nextContext };
      } else if (command.type === "audio") {
        portCommand = { type: "append-audio", audioBase64: command.audioBase64, mimeType: command.mimeType, sampleRate: command.sampleRate };
      } else if (command.type === "commit") {
        portCommand = { type: "commit-turn" };
      } else {
        portCommand = { type: "interrupt" };
      }
      await providerSession.send(portCommand);
    };

    return { ok: true, value: { events: queue, send, close: closeOnce } };
  }

  private async pump(
    session: RealtimeVoiceSession,
    emit: (event: LiveServerPayload) => void,
    done: () => Promise<void>,
  ): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value: event, done: ended } = await session.next();
      if (ended) break;
      switch (event.type) {
        case "ready": emit({ type: "live.ready", inputSampleRate: event.inputSampleRate, outputSampleRate: event.outputSampleRate }); break;
        case "transcript-delta": emit({ type: "live.transcript.delta", role: event.role, text: event.text }); break;
        case "audio-delta": emit({ type: "live.audio", audioBase64: event.audioBase64, mimeType: event.mimeType, sampleRate: event.sampleRate }); break;
        case "interrupted": emit({ type: "live.interrupted" }); break;
        case "context-updated": emit({ type: "live.context-updated", actionId: event.actionId }); break;
        case "completed": emit({ type: "live.completed" }); break;
        case "closed": await done(); return;
        case "error": emit({ type: "live.error", code: event.code, retryable: event.retryable }); break;
        default: break;
      }
    }
    await done();
  }
}

/** A live server payload without the transport envelope (mirrors the public
 *  `LiveCoachServerEvent` union minus envelope fields). */
type LiveServerPayload = LiveCoachServerEvent extends infer Event
  ? Event extends LiveCoachServerEvent ? Omit<Event, "version" | "correlationId" | "sessionId" | "sequence" | "at"> : never
  : never;
