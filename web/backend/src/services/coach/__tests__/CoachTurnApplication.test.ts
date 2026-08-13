import assert from "node:assert/strict";
import type { CoachTurnEvent, SpokenSegment } from "../../../../../shared/coachMedia";
import { AsyncQueue } from "../application/asyncQueue";
import { CoachTurnApplication } from "../application/CoachTurnApplication";
import { SegmentPolicy } from "../application/SegmentPolicy";
import type { EventStream, Result, TextCoachEngine, TextCoachInput, TextGenerationEvent } from "../ports/TextCoachEngine";
import { TextGenerationError } from "../ports/TextCoachEngine";
import type { SpeechEvent, SpeechSynthesizer } from "../ports/SpeechSynthesizer";
import { SpeechError } from "../ports/SpeechSynthesizer";
import type { AudioInput, SpeechRecognizer } from "../ports/SpeechRecognizer";
import type { CoachTurnRequest } from "../../../../../shared/actionRuntime";
import { getLearningActionPlan } from "../../learningService";
import { InMemoryTelemetrySink } from "../adapters/InMemoryTelemetrySink";

class FakeRecognizer implements SpeechRecognizer {
  async transcribe(_audio: AudioInput): Promise<{ ok: true; value: { transcript: string } }> {
    return { ok: true, value: { transcript: "" } };
  }
}

type TextStreamResult = Result<EventStream<TextGenerationEvent>, TextGenerationError>;

class FakeTextEngine implements TextCoachEngine {
  readonly queue = new AsyncQueue<TextGenerationEvent>();
  readonly telemetryIdentity = { provider: "fake-direct-api", model: "fake-fast-model" };
  streamReply(_input: TextCoachInput, _signal: AbortSignal): Promise<TextStreamResult> {
    return Promise.resolve({ ok: true, value: this.queue });
  }
}

class FakeSpeech implements SpeechSynthesizer {
  readonly openedSegments: string[] = [];
  async synthesize(): Promise<{ audioUrl: string }> { throw new Error("not used in stream path"); }
  stream(segment: SpokenSegment, _signal: AbortSignal): Promise<Result<EventStream<SpeechEvent>, SpeechError>> {
    this.openedSegments.push(segment.segmentId);
    const q = new AsyncQueue<SpeechEvent>();
    q.push({ type: "speech-started", segmentId: segment.segmentId, mimeType: "audio/mpeg" });
    q.push({ type: "audio-delta", segmentId: segment.segmentId, bytes: Buffer.from([1, 2, 3, 4]) });
    q.push({ type: "audio-delta", segmentId: segment.segmentId, bytes: Buffer.from([5, 6, 7, 8]) });
    q.push({ type: "speech-completed", segmentId: segment.segmentId });
    q.complete();
    return Promise.resolve({ ok: true, value: q });
  }
}

function buildLearnRequest(): CoachTurnRequest {
  const plan = getLearningActionPlan("auxiliaryTwoRatios" as never);
  const action = plan.actions.find((candidate) => candidate.actionId === plan.currentActionId) || plan.actions[0];
  return {
    context: { kind: "learn", taskId: "auxiliaryTwoRatios" as never },
    exerciseId: plan.exerciseId,
    trace: {
      exerciseId: plan.exerciseId,
      currentActionId: action.actionId,
      actionState: "idle",
      selectedObjectIds: [],
      answerDraft: {},
      recentEvents: [],
      wrongAttempts: 0,
      revision: plan.revision,
    },
    studentMessage: "为什么要作这条辅助线？",
    conversation: [],
    synthesizeSpeech: true,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function drain(stream: { next(): Promise<IteratorResult<CoachTurnEvent>> }, into: CoachTurnEvent[]): Promise<void> {
  while (true) {
    const { value, done } = await stream.next();
    if (done) break;
    into.push(value);
  }
}

async function main(): Promise<void> {
  // 1. First generated-answer audio delta arrives BEFORE the model finishes,
  //    and the final directive is schema-valid.
  {
    const text = new FakeTextEngine();
    const speech = new FakeSpeech();
    const sink = new InMemoryTelemetrySink();
    const app = new CoachTurnApplication({ text, speech, policy: new SegmentPolicy(), recognizer: new FakeRecognizer(), sink });
    const controller = new AbortController();

    const result = await app.start(buildLearnRequest(), controller.signal);
    assert.ok(result.ok, "start should succeed for a learn turn");
    const events: CoachTurnEvent[] = [];
    const done = drain(result.value, events);

    // A delta that completes a first segment is spoken — before text-completed.
    text.queue.push({ type: "text-delta", text: "我们先看这个已知条件，" });
    await waitFor(() => events.some((event) => event.type === "turn.audio.delta"));
    const generatedAudioBeforeCompletion = events.some((event) => event.type === "turn.audio.delta");
    const directiveAlreadyEmitted = events.some((event) => event.type === "turn.directive");

    text.queue.push({ type: "text-delta", text: "再继续往下分析。" });
    text.queue.push({ type: "text-completed" });
    text.queue.complete();
    await done;

    assert.ok(generatedAudioBeforeCompletion, "a generated-answer audio delta must arrive before the model completes");
    assert.ok(!directiveAlreadyEmitted, "no directive may be emitted before the model completes");

    const types = events.map((event) => event.type);
    assert.equal(types[0], "turn.started");
    assert.ok(types.indexOf("turn.audio.delta") < types.indexOf("turn.directive"), "first audio precedes the directive");
    const directiveEvent = events.find((event): event is Extract<CoachTurnEvent, { type: "turn.directive" }> => event.type === "turn.directive");
    assert.ok(directiveEvent, "a final directive must be emitted");
    assert.equal(typeof directiveEvent!.directive.spokenText, "string", "directive carries spokenText (schema)");
    assert.ok(directiveEvent!.directive.messageLatex.length > 0);

    const segmentOrder = events.filter((event) => event.type === "turn.segment.started")
      .map((event) => (event as Extract<CoachTurnEvent, { type: "turn.segment.started" }>).segment.segmentId);
    assert.deepEqual(segmentOrder, [...new Set(segmentOrder)], "segment ids are unique and ordered");
    const correlationId = events[0].correlationId;
    assert.equal(sink.getTimeline(correlationId)?.provider, "fake-direct-api", "telemetry uses the bound adapter identity");
    assert.equal(sink.getTimeline(correlationId)?.model, "fake-fast-model", "telemetry no longer hard-codes Claude/GLM");
  }

  // 2. Cancellation emits no further transcript/audio/directive events.
  {
    const text = new FakeTextEngine();
    const speech = new FakeSpeech();
    const app = new CoachTurnApplication({ text, speech, policy: new SegmentPolicy(), recognizer: new FakeRecognizer() });
    const controller = new AbortController();
    const result = await app.start(buildLearnRequest(), controller.signal);
    assert.ok(result.ok);
    const events: CoachTurnEvent[] = [];
    const done = drain(result.value, events);

    text.queue.push({ type: "text-delta", text: "我们先看这个已知条件，" });
    await waitFor(() => events.some((event) => event.type === "turn.audio.delta"));
    controller.abort(); // cancel mid-turn
    text.queue.push({ type: "text-delta", text: "late delta after cancel" });
    text.queue.push({ type: "text-completed" });
    text.queue.complete();
    await done;

    const types = events.map((event) => event.type);
    assert.ok(!types.includes("turn.directive"), "cancel must suppress the final directive");
    assert.ok(events.some((event) => event.type === "turn.cancelled"), "cancel emits turn.cancelled");
    assert.ok(!events.some((event) => event.type === "turn.transcript.delta" && event.role === "coach" && event.text.includes("late delta")),
      "no coach transcript after cancellation");
  }

  // 3. Assessment policy fails closed: a spoken segment is never synthesized.
  {
    const policy = new SegmentPolicy();
    const segment: SpokenSegment = { segmentId: "seg-0", displayText: "答案", spokenText: "答案" };
    assert.ok(policy.validate("learn", segment).ok, "learn allows spoken segments");
    const assessment = policy.validate("assessment", segment);
    assert.ok(!assessment.ok && assessment.error.code === "assessment-disabled", "assessment rejects generative spoken segments");
  }

  // 4. A TTS failure fails the whole turn: turn.error is emitted and NO directive
  //    or later transcript follows.
  {
    const failing: SpeechSynthesizer = {
      async synthesize() { throw new Error("not used"); },
      stream(segment) {
        return Promise.resolve({ ok: false, error: new SpeechError("tts-down", "provider unavailable", true) });
      },
    };
    const text = new FakeTextEngine();
    const app = new CoachTurnApplication({ text, speech: failing, policy: new SegmentPolicy(), recognizer: new FakeRecognizer() });
    const result = await app.start(buildLearnRequest(), new AbortController().signal);
    assert.ok(result.ok);
    const events: CoachTurnEvent[] = [];
    const done = drain(result.value, events);
    text.queue.push({ type: "text-delta", text: "我们先看这个已知条件，" });
    text.queue.push({ type: "text-completed" });
    text.queue.complete();
    await done;
    const types = events.map((event) => event.type);
    assert.ok(types.includes("turn.error"), "TTS failure emits turn.error");
    assert.ok(!types.includes("turn.directive"), "no directive after a TTS failure");
    assert.equal(types[types.length - 1], "turn.error", "turn.error is terminal");
  }

  console.log("PASS CoachTurnApplication streams generated audio before completion, validates the directive, and cancels cleanly");
}

void main().catch((error) => { console.error(error); process.exit(1); });
