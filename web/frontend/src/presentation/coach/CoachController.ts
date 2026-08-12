import type {
  CoachAudioInput,
  CoachConversationTurn,
  CoachDirective,
  CoachTurnRequest,
  CoachTurnResponse,
  LearningMode,
  StudentTrace,
} from "../../../../shared/actionRuntime";
import type { CoachTurnEvent } from "../../../../shared/coachMedia";
import type { AudioStreamHandle, MediaSessionController } from "../audio/MediaSessionController";

/**
 * ADR-005 §Layer Responsibilities — `CoachController` is the single owner of
 * coach turn orchestration. It consolidates the turn lifecycle (stream +
 * request/response transport), request cancellation, and the audio-stream
 * feeding that was previously scattered across `ActionRuntimeFrame`,
 * `useCoachRecorder` and `useRealtimeCoach`. It does NOT call a provider
 * directly (the injected `CoachTurnClient` does), it never holds Action truth
 * (it talks to the runtime through `CoachRuntimePort`), and it never touches
 * the microphone itself (the recorder/live hooks own capture leases).
 *
 * The controller is React-free so the turn/cancellation contract is unit-
 * testable without jsdom + React act.
 */

export type CoachTurnTransport = "stream" | "request-response";

export interface CoachTurnInput {
  message?: string;
  audio?: CoachAudioInput;
}

/** Plan/session context the controller needs to build a `CoachTurnRequest`. */
export interface CoachTurnPlanContext {
  transport: CoachTurnTransport | undefined;
  local: boolean;
  sessionId: string;
  taskId?: string;
  exerciseId: string;
  mode: LearningMode;
  currentActionId: string;
  studentText: string;
  previousConversation: CoachConversationTurn[];
}

/** Narrow, provider-neutral surface the controller drives the transport through. */
export interface CoachTurnClient {
  stream(payload: CoachTurnRequest, onEvent: (event: CoachTurnEvent) => void, signal: AbortSignal): Promise<void>;
  request(payload: CoachTurnRequest, options: { signal?: AbortSignal }): Promise<CoachTurnResponse>;
}

/** The runtime capabilities the controller needs, without giving it Action truth. */
export interface CoachRuntimePort {
  recordAssistance(kind: "hint" | "coach"): void;
  getTrace(message?: string): StudentTrace;
  applyCoach(directive: CoachDirective): void;
}

export interface CoachControllerCallbacks {
  runtime: CoachRuntimePort;
  /** Play a coach reply audio URL (non-stream path). Optional: when absent the
   *  controller simply skips spoken playback for the turn reply. */
  playSpeechUrl?(url: string): void;
  onThreadEvent(event: CoachThreadEvent): void;
}

export interface CoachControllerDeps {
  media: MediaSessionController;
  client: CoachTurnClient;
  callbacks: CoachControllerCallbacks;
}

export interface CoachControllerStatus {
  busy: boolean;
}

/** One rendered coach/conversation bubble. Moved here from ActionRuntimeFrame. */
export interface CoachThreadMessage extends CoachConversationTurn {
  id: string;
  pending?: boolean;
  error?: boolean;
}

/** Incremental, serializable thread mutations the controller emits. The owning
 *  hook reduces them into React state via `reduceCoachThread`. */
export type CoachThreadEvent =
  | { type: "student-turn"; id: string; text: string; pending: boolean }
  | { type: "coach-upsert"; id: string; text: string; pending: boolean }
  | { type: "student-transcribed"; id: string; text: string }
  | { type: "student-error"; id: string; error: boolean }
  | { type: "coach-message"; id: string; text: string; error?: boolean };

/** Pure reducer used by the owning hook. Mirrors the inline `setCoachThread`
 *  updates that previously lived in `ActionRuntimeFrame.askCoach`. */
export function reduceCoachThread(current: CoachThreadMessage[], event: CoachThreadEvent): CoachThreadMessage[] {
  switch (event.type) {
    case "student-turn":
      return [...current, { id: event.id, role: "student", text: event.text, pending: event.pending }];
    case "coach-upsert": {
      const rest = current.filter((turn) => turn.id !== event.id);
      return event.text ? [...rest, { id: event.id, role: "coach", text: event.text, pending: event.pending }] : rest;
    }
    case "student-transcribed":
      return current.map((turn) => (turn.id === event.id ? { ...turn, text: event.text, pending: false } : turn));
    case "student-error":
      return current.map((turn) => (turn.id === event.id ? { ...turn, pending: false, error: event.error } : turn));
    case "coach-message":
      return [...current, { id: event.id, role: "coach", text: event.text, error: event.error }];
    default:
      return current;
  }
}

const COACH_FAILURE_MESSAGE = "老师暂时没有连上。我们先停在这一步，稍后可以再问一次。";

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class CoachController {
  private abort?: AbortController;
  private busy = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: CoachControllerDeps) {}

  getStatus(): CoachControllerStatus {
    return { busy: this.busy };
  }

  /** Subscribe to status changes (busy transitions). Returns an unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Start a coach turn. Returns `true` when a turn actually started (and the
   * composer text should be consumed), `false` on an early no-op guard
   * (already busy / no input / no help). Cancellation is driven by an internal
   * `AbortController` that the next turn, an Action switch, a live start, or
   * `dispose` can abort.
   */
  async startTurn(input: CoachTurnInput, ctx: CoachTurnPlanContext, assistanceKind: "hint" | "coach"): Promise<boolean> {
    if (this.busy) return false;
    const message = input.message?.trim() || ctx.studentText.trim();
    if (!message && !input.audio) return false;

    const { runtime, onThreadEvent } = this.deps.callbacks;
    runtime.recordAssistance(assistanceKind);
    const studentTurnId = crypto.randomUUID();
    const coachTurnId = crypto.randomUUID();
    onThreadEvent({
      type: "student-turn",
      id: studentTurnId,
      text: message || "正在识别语音…",
      pending: Boolean(input.audio),
    });

    this.setBusy(true);
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const audioStreamRef = { current: null as AudioStreamHandle | null };

    try {
      const payload: CoachTurnRequest = {
        context: ctx.local
          ? { kind: "learn", taskId: ctx.taskId ?? "" }
          : { kind: "practice", sessionId: ctx.sessionId },
        exerciseId: ctx.exerciseId,
        trace: runtime.getTrace(message || undefined),
        ...(message ? { studentMessage: message } : {}),
        ...(input.audio ? { studentAudio: input.audio } : {}),
        conversation: ctx.previousConversation,
        synthesizeSpeech: true,
      };

      if (ctx.transport === "stream") {
        let directive: CoachDirective | undefined;
        let coachStreamedText = "";
        let studentTranscript = "";
        await this.deps.client.stream(payload, (event) => {
          if (event.type === "turn.transcript.delta") {
            if (event.role === "coach") {
              coachStreamedText += event.text;
              onThreadEvent({ type: "coach-upsert", id: coachTurnId, text: coachStreamedText, pending: true });
            } else if (event.role === "student") {
              studentTranscript = event.text;
            }
          } else if (event.type === "turn.audio.delta") {
            // Feed each MP3 chunk into one incremental MediaSource stream so
            // playback starts on the first chunk — before the full answer lands.
            const handle = audioStreamRef.current ?? this.deps.media.startAudioStream("coach-turn", { correlationId: event.correlationId });
            audioStreamRef.current = handle;
            handle.appendChunk(decodeBase64ToBytes(event.audioBase64));
          } else if (event.type === "turn.directive") {
            directive = event.directive;
          }
        }, abort.signal);
        audioStreamRef.current?.complete();
        if (abort.signal.aborted) return true;
        if (!directive) throw new Error("Coach stream ended without a directive");
        onThreadEvent({ type: "coach-upsert", id: coachTurnId, text: directive.messageLatex, pending: false });
        runtime.applyCoach(directive);
        onThreadEvent({ type: "student-transcribed", id: studentTurnId, text: studentTranscript || message || "语音提问" });
      } else {
        const turnResponse = await this.deps.client.request(payload, { signal: abort.signal });
        if (abort.signal.aborted) return true;
        runtime.applyCoach(turnResponse.directive);
        onThreadEvent({ type: "coach-message", id: turnResponse.directive.directiveId, text: turnResponse.directive.messageLatex });
        onThreadEvent({ type: "student-transcribed", id: studentTurnId, text: turnResponse.transcript || message || "语音提问" });
        if (turnResponse.speech?.audioUrl) this.deps.callbacks.playSpeechUrl?.(turnResponse.speech.audioUrl);
      }
    } catch {
      // Cancelled by a new turn / Action switch / live start: leave the thread as-is.
      if (abort.signal.aborted) return true;
      this.deps.media.stop("coach-turn");
      const failure: CoachDirective = {
        directiveId: crypto.randomUUID(),
        messageLatex: COACH_FAILURE_MESSAGE,
        spokenText: COACH_FAILURE_MESSAGE,
        tone: "prompt",
        highlightObjectIds: [],
        suggestedActionId: ctx.currentActionId,
      };
      runtime.applyCoach(failure);
      onThreadEvent({ type: "student-error", id: studentTurnId, error: Boolean(input.audio) });
      onThreadEvent({ type: "coach-message", id: failure.directiveId, text: failure.messageLatex, error: true });
    } finally {
      this.setBusy(false);
    }
    return true;
  }

  /**
   * Cancel any in-flight coach turn and its TTS/playback. Called on Action
   * switch, Frame unmount, and before starting a live session. Idempotent.
   */
  cancel(reason: string): void {
    this.abort?.abort();
    this.deps.media.stop("coach-turn");
  }

  dispose(): void {
    this.cancel("dispose");
    this.listeners.clear();
  }

  private setBusy(value: boolean): void {
    this.busy = value;
    for (const listener of this.listeners) listener();
  }
}
