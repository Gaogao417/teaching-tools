import { isCoachDirective, type CoachDirective, type CoachTurnRequest } from "../../../../../shared/actionRuntime";
import type { CoachTurnEvent, SpokenSegment } from "../../../../../shared/coachMedia";
import { COACH_MEDIA_PROTOCOL_VERSION } from "../../../../../shared/coachMedia";
import type {
  EventStream,
  Result,
  TextCoachEngine,
  TextGenerationEvent,
} from "../ports/TextCoachEngine";
import { TextGenerationError } from "../ports/TextCoachEngine";
import type { SpeechSynthesizer } from "../ports/SpeechSynthesizer";
import type { SpeechRecognizer } from "../ports/SpeechRecognizer";
import { SegmentPolicy } from "./SegmentPolicy";
import { SpokenSegmenter } from "./SpokenSegmenter";
import { CoachTurnTelemetry } from "./CoachTurnTelemetry";
import { AsyncQueue } from "./asyncQueue";
import { coachModePolicy } from "./coachModePolicy";
import type { CoachModePolicy } from "./coachModePolicy";
import { modelInput, resolveCoachPlanAndFallback } from "../coachTurnService";

const MIME_TYPE = "audio/mpeg";
const SEGMENT_QUEUE_CAP = 8;
const MAX_TURN_BYTES = 12 * 1024 * 1024;

export class CoachStartError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

export interface CoachTurnDeps {
  text: TextCoachEngine;
  speech: SpeechSynthesizer;
  policy: SegmentPolicy;
  recognizer: SpeechRecognizer;
  /** Shared turn/live mode policy. Defaults to the process-wide instance so the
   *  turn path and the live path resolve the Assessment gate through one
   *  policy (ADR-005 §Architectural Invariants #6). */
  modePolicy?: CoachModePolicy;
}

/**
 * Orchestrates one streaming coach turn end to end:
 *   student text/audio → optional ASR → TextCoachEngine → IncrementalSpokenSegmenter
 *   → SegmentPolicy → streaming SpeechSynthesizer → CoachTurnEvent → final validated directive.
 *
 * Provider/model are referenced only for server-side telemetry. The application
 * never lets streaming text/audio produce a DOM selector or an unapproved
 * command — only the final, schema-validated CoachDirective reaches the Action
 * Runtime. Cancellation stops the producer and consumer and emits no further
 * audio. Segments are spoken in order; in-flight segments and buffered bytes are
 * bounded with explicit backpressure.
 */
export class CoachTurnApplication {
  constructor(private readonly deps: CoachTurnDeps) {}

  async start(
    request: CoachTurnRequest,
    signal: AbortSignal,
  ): Promise<Result<EventStream<CoachTurnEvent>, CoachStartError>> {
    const { plan, fallback } = resolveCoachPlanAndFallback(request);

    // Defense-in-depth: Assessment stays fail-closed for generative streaming.
    // The gate is the shared turn/live mode policy.
    const allowance = (this.deps.modePolicy ?? coachModePolicy).allowTurn(plan.mode);
    if (!allowance.ok) {
      return { ok: false, error: new CoachStartError(allowance.code, "Streaming Coach is disabled in Assessment", 403) };
    }

    let studentQuestion = request.studentMessage?.trim() || "";
    let transcript: string | undefined;
    if (request.studentAudio) {
      const asrResult = await this.deps.recognizer.transcribe(request.studentAudio);
      if (!asrResult.ok) {
        return { ok: false, error: new CoachStartError(asrResult.error.code, asrResult.error.message, 502) };
      }
      transcript = asrResult.value.transcript?.trim();
      if (transcript) studentQuestion = studentQuestion || transcript;
    }
    if (!studentQuestion) {
      return { ok: false, error: new CoachStartError("EMPTY_QUESTION", "Student question is empty", 400) };
    }

    const textInput = modelInput(plan, request, studentQuestion);
    const correlationId = crypto.randomUUID();
    const sessionId = request.context.kind === "practice" ? request.context.sessionId : `learn:${request.context.taskId}`;
    const provider = "claude-code";
    const model = process.env.COACH_CLAUDE_MODEL?.trim() || "glm-5.2";
    const telemetry = new CoachTurnTelemetry(correlationId, sessionId, plan.mode, provider, model);

    const queue = new AsyncQueue<CoachTurnEvent>();
    let sequence = 0;
    const envelope = (event: ProducerEvent): CoachTurnEvent =>
      ({ ...event, version: COACH_MEDIA_PROTOCOL_VERSION, correlationId, sessionId, sequence: sequence++, at: new Date().toISOString() }) as CoachTurnEvent;
    const emit = (event: ProducerEvent) => queue.push(envelope(event));

    // Drive the pipeline without blocking the caller; the returned queue is the
    // public event stream.
    void this.run({ request, signal, textInput, fallback, mode: plan.mode, transcript, telemetry, emit, queue }).catch((error) => {
      if (!queue.closed) {
        emit({ type: "turn.error", code: "coach-turn-failed", retryable: true });
        void error;
      }
    });

    return { ok: true, value: queue };
  }

  private async run(ctx: RunContext): Promise<void> {
    const { signal, textInput, fallback, mode, transcript, telemetry, emit, queue } = ctx;
    const finalizer = (terminal: "completed" | "cancelled" | "failed") => {
      if (terminal === "completed") telemetry.complete();
      else if (terminal === "cancelled") telemetry.cancel();
      else telemetry.fail();
      queue.complete();
    };
    try {
      if (signal.aborted) { emit({ type: "turn.cancelled" }); return finalizer("cancelled"); }
      emit({ type: "turn.started" });
      if (transcript) emit({ type: "turn.transcript.delta", role: "student", text: transcript });

      const textResult = await this.deps.text.streamReply(textInput, signal);
      if (!textResult.ok) {
        emit({ type: "turn.error", code: textResult.error.code, retryable: textResult.error.retryable });
        return finalizer("failed");
      }
      telemetry.markProviderConnected();

      // Producer: text deltas → segmenter → ordered segment queue.
      const segmentQueue = new AsyncQueue<SpokenSegment>(SEGMENT_QUEUE_CAP);
      const segmenter = new SpokenSegmenter();
      const turn = { stopped: false };
      let accumulated = "";

      const producer = this.runProducer(textResult.value, segmenter, segmentQueue, signal, telemetry, turn, (delta) => {
        accumulated += delta;
        emit({ type: "turn.transcript.delta", role: "coach", text: delta });
      });
      // Consumer: speak each policy-approved segment in order.
      const consumer = this.runConsumer(segmentQueue, signal, telemetry, turn, emit);

      await Promise.all([producer, consumer]);

      if (signal.aborted) { emit({ type: "turn.cancelled" }); return finalizer("cancelled"); }
      if (turn.stopped) return finalizer("failed"); // consumer already emitted turn.error

      const directive = buildDirective(fallback, accumulated);
      if (!isCoachDirective(directive) || typeof directive.spokenText !== "string") {
        emit({ type: "turn.error", code: "invalid-directive", retryable: false });
        return finalizer("failed");
      }
      emit({ type: "turn.directive", directive });
      emit({ type: "turn.completed" });
      return finalizer("completed");
    } catch (error) {
      if (signal.aborted) { emit({ type: "turn.cancelled" }); return finalizer("cancelled"); }
      const code = error instanceof TextGenerationError ? error.code : "coach-turn-failed";
      const retryable = error instanceof TextGenerationError ? error.retryable : true;
      emit({ type: "turn.error", code, retryable });
      return finalizer("failed");
    }
  }

  private async runProducer(
    stream: EventStream<TextGenerationEvent>,
    segmenter: SpokenSegmenter,
    segmentQueue: AsyncQueue<SpokenSegment>,
    signal: AbortSignal,
    telemetry: CoachTurnTelemetry,
    turn: { stopped: boolean },
    onDelta: (delta: string) => void,
  ): Promise<void> {
    let firstText = true;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal.aborted || turn.stopped) break;
      // Backpressure: if TTS is slower than the model, stop pulling text until
      // the ordered segment queue drains, rather than buffering unbounded.
      if (segmentQueue.size >= SEGMENT_QUEUE_CAP) await segmentQueue.whenRoom();
      const { value: event, done } = await stream.next();
      if (done) break;
      if (signal.aborted || turn.stopped) break; // a pending pull may resolve after cancel/error; never process it
      if (event.type === "text-delta") {
        if (firstText) { telemetry.markFirstText(); firstText = false; }
        onDelta(event.text);
        for (const segment of segmenter.push(event.text)) {
          if (telemetry.bufferedBytes >= MAX_TURN_BYTES) { telemetry.droppedChunks += 1; continue; }
          segmentQueue.push(segment);
        }
      } else if (event.type === "text-completed") {
        telemetry.usage = event.usage;
      }
    }
    for (const segment of segmenter.flush()) {
      if (telemetry.bufferedBytes >= MAX_TURN_BYTES) { telemetry.droppedChunks += 1; continue; }
      segmentQueue.push(segment);
    }
    segmentQueue.complete();
  }

  private async runConsumer(
    segmentQueue: AsyncQueue<SpokenSegment>,
    signal: AbortSignal,
    telemetry: CoachTurnTelemetry,
    turn: { stopped: boolean },
    emit: (event: ProducerEvent) => void,
  ): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal.aborted || turn.stopped) break;
      const { value: segment, done } = await segmentQueue.next();
      if (done) break;

      const verdict = this.deps.policy.validate(this.modeFor(telemetry), segment);
      if (!verdict.ok) continue; // mode/safety gate: skip speech, keep transcript

      telemetry.segmentCount += 1;
      telemetry.markFirstSegment();
      emit({ type: "turn.segment.started", segment });

      const speechResult = await this.deps.speech.stream(segment, signal);
      if (!speechResult.ok) {
        // A TTS failure fails the turn: emit the error and signal the producer
        // to stop so no further transcript/directive is emitted afterwards.
        turn.stopped = true;
        emit({ type: "turn.error", code: speechResult.error.code, retryable: speechResult.error.retryable });
        return;
      }
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (signal.aborted) break;
          const { value: speech, done } = await speechResult.value.next();
          if (done) break;
          if (speech.type === "audio-delta") {
            telemetry.markFirstAudio();
            telemetry.addAudioDelta(speech.bytes.length);
            emit({
              type: "turn.audio.delta",
              segmentId: segment.segmentId,
              audioBase64: speech.bytes.toString("base64"),
              mimeType: MIME_TYPE,
            });
          } else if (speech.type === "speech-completed") {
            emit({ type: "turn.audio.completed", segmentId: segment.segmentId });
          }
        }
      } catch {
        if (signal.aborted) return;
      }
    }
  }

  private modeFor(telemetry: CoachTurnTelemetry): "learn" | "guided-practice" | "assessment" {
    return telemetry.mode as "learn" | "guided-practice" | "assessment";
  }
}

type ProducerEvent = CoachTurnEvent extends infer E
  ? E extends { version: typeof COACH_MEDIA_PROTOCOL_VERSION; correlationId: string; sessionId: string; sequence: number; at: string }
    ? Omit<E, "version" | "correlationId" | "sessionId" | "sequence" | "at">
    : never
  : never;

interface RunContext {
  request: CoachTurnRequest;
  signal: AbortSignal;
  textInput: ReturnType<typeof modelInput>;
  fallback: CoachDirective;
  mode: ExercisePlanMode;
  transcript?: string;
  telemetry: CoachTurnTelemetry;
  emit: (event: ProducerEvent) => void;
  queue: AsyncQueue<CoachTurnEvent>;
}

type ExercisePlanMode = "learn" | "guided-practice" | "assessment";

function buildDirective(fallback: CoachDirective, spokenText: string): CoachDirective {
  const text = spokenText.trim();
  const message = text || fallback.messageLatex;
  return {
    directiveId: crypto.randomUUID(),
    messageLatex: message,
    spokenText: text || fallback.spokenText,
    tone: fallback.tone,
    highlightObjectIds: fallback.highlightObjectIds,
    suggestedActionId: fallback.suggestedActionId,
  };
}
