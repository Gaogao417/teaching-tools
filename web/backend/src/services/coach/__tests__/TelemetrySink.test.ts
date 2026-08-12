import assert from "node:assert/strict";
import type { ExercisePlan } from "../../../../../shared/actionRuntime";
import { AsyncQueue } from "../application/asyncQueue";
import { CoachTurnTelemetry } from "../application/CoachTurnTelemetry";
import { LiveCoachApplication } from "../application/LiveCoachApplication";
import { NarrationApplication } from "../application/NarrationApplication";
import { coachModePolicy } from "../application/coachModePolicy";
import { InMemoryTelemetrySink } from "../adapters/InMemoryTelemetrySink";
import { sanitizeTimeline, type ServerTimelineUpdate } from "../ports/TelemetrySink";
import type {
  CoachContext,
  RealtimeVoiceCommand,
  RealtimeVoiceEvent,
  RealtimeVoiceProvider,
  RealtimeVoiceSession,
} from "../ports/RealtimeVoiceProvider";
import type { Result } from "../ports/TextCoachEngine";
import { RealtimeVoiceError } from "../ports/RealtimeVoiceProvider";
import type { SpeechEvent, SpeechSynthesizer, SynthesizedSpeech } from "../ports/SpeechSynthesizer";
import type { VoiceCorrelationTimeline } from "../ports/TelemetrySink";
import { getLearningActionPlan } from "../../learningService";

/** A fake realtime provider that implements the PORT only — proves the live
 *  timeline is sunk with no provider class involved. */
class FakeRealtimeProvider implements RealtimeVoiceProvider {
  readonly events = new AsyncQueue<RealtimeVoiceEvent>();
  openContext: CoachContext | undefined;
  async open(context: CoachContext, _signal: AbortSignal): Promise<Result<RealtimeVoiceSession, RealtimeVoiceError>> {
    this.openContext = context;
    const events = this.events;
    const session: RealtimeVoiceSession = {
      next: () => events.next(),
      async send(_command: RealtimeVoiceCommand): Promise<void> { /* no-op */ },
      async close(): Promise<void> { events.complete(); },
    };
    return { ok: true, value: session };
  }
}

/** Fake deterministic synthesizer that streams one chunk then resolves. */
class FakeSpeechSynthesizer implements SpeechSynthesizer {
  async synthesize(_text: string, _signal?: AbortSignal, onAudioChunk?: (chunk: Buffer) => void): Promise<SynthesizedSpeech> {
    onAudioChunk?.(Buffer.from([1, 2, 3, 4]));
    return { audioUrl: "data:audio/mpeg;base64,AAAA" };
  }
  stream(): Promise<Result<AsyncQueue<SpeechEvent>, never>> { throw new Error("not used"); }
}

function learnPlan(): ExercisePlan {
  return getLearningActionPlan("auxiliaryTwoRatios" as never);
}

async function waitFor<T>(predicate: () => T | undefined, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function main(): Promise<void> {
  const sink = new InMemoryTelemetrySink();

  // 1. A server timeline is persisted and readable; provider/model are kept
  //    server-side but stripped by the Assessment-safe sanitizer.
  {
    const update: ServerTimelineUpdate = {
      correlationId: "corr-turn-1",
      sessionId: "learn:t",
      flow: "turn",
      mode: "learn",
      requestStartedAt: 1000,
      providerConnectedAt: 1100,
      llmFirstTextAt: 1200,
      ttsFirstAudioAt: 1300,
      completedAt: 1400,
      terminal: "completed",
      provider: "claude-code",
      model: "glm-5.2",
      segmentCount: 2,
      audioDeltas: 5,
      bufferedBytes: 1024,
      droppedChunks: 0,
    };
    sink.record(update);
    const timeline = sink.getTimeline("corr-turn-1");
    assert.ok(timeline, "server timeline is persisted");
    assert.equal(timeline!.flow, "turn");
    assert.equal(timeline!.ttsFirstAudioAt, 1300);
    assert.equal(timeline!.terminal, "completed");
    assert.equal(timeline!.provider, "claude-code", "provider stored server-side");

    const safe = sanitizeTimeline(timeline!);
    assert.equal((safe as VoiceCorrelationTimeline).provider, undefined, "sanitizer strips provider");
    assert.equal((safe as VoiceCorrelationTimeline).model, undefined, "sanitizer strips model");
    assert.equal(safe.ttsFirstAudioAt, 1300, "sanitizer keeps stage timestamps");
  }

  // 2. A browser-reported first-audio mark is merged into the matching
  //    correlationId timeline (end-to-end correlation, ADR-005 DoD).
  {
    sink.recordBrowserMark("corr-turn-1", "turn", "browser-audio-started", 1350);
    const timeline = sink.getTimeline("corr-turn-1");
    assert.equal(timeline!.browserFirstAudioAt, 1350, "browser first audio merged under the same correlationId");
    assert.ok(timeline!.browserFirstAudioAt! >= timeline!.ttsFirstAudioAt!, "browser first audio follows TTS first audio");
  }

  // 3. An unknown browser mark does not throw and creates a sparse timeline.
  {
    assert.doesNotThrow(() => sink.recordBrowserMark("corr-unknown", "narration", "browser-audio-started", 2000));
    assert.equal(sink.getTimeline("corr-unknown")?.browserFirstAudioAt, 2000);
    assert.equal(sink.getTimeline("corr-unknown")?.flow, "narration");
  }

  // 4. Autoplay-block / cancel marks are recorded without a browserFirstAudioAt.
  {
    sink.recordBrowserMark("corr-turn-1", "turn", "blocked-by-autoplay", 1500);
    assert.equal(sink.getTimeline("corr-turn-1")?.browserAutoplayBlocked, true);
    assert.equal(sink.getTimeline("corr-turn-1")?.browserFirstAudioAt, 1350, "first-audio not overwritten by a later block");
  }

  // 5. record() never throws into the caller (best-effort sink).
  {
    const tiny = new InMemoryTelemetrySink(1);
    assert.doesNotThrow(() => {
      tiny.record({ correlationId: "a", flow: "turn", requestStartedAt: 1 } as ServerTimelineUpdate);
      tiny.record({ correlationId: "b", flow: "turn", requestStartedAt: 2 } as ServerTimelineUpdate);
    });
    assert.ok(tiny.list().length <= 1, "bounded map evicts oldest without throwing");
  }

  // 6. CoachTurnTelemetry sinks its terminal timeline to the sink.
  {
    const localSink = new InMemoryTelemetrySink();
    const telemetry = new CoachTurnTelemetry("corr-telemetry-1", "learn:t", "learn", "claude-code", "glm-5.2", localSink);
    telemetry.markProviderConnected();
    telemetry.markFirstText();
    telemetry.markFirstSegment();
    telemetry.markFirstAudio();
    telemetry.addAudioDelta(128);
    telemetry.complete();
    const timeline = localSink.getTimeline("corr-telemetry-1");
    assert.ok(timeline, "CoachTurnTelemetry emitted to the sink");
    assert.equal(timeline!.flow, "turn");
    assert.equal(timeline!.terminal, "completed");
    assert.equal(timeline!.providerConnectedAt, telemetry.providerConnectedAt);
    assert.equal(timeline!.bufferedBytes, 128);
    assert.equal(timeline!.provider, "claude-code", "provider kept server-side in the sink");
  }

  // 7. LiveCoachApplication sinks its server timeline (request → connected →
  //    first audio → completed) under the correlationId shared with the browser.
  {
    const localSink = new InMemoryTelemetrySink();
    const provider = new FakeRealtimeProvider();
    const app = new LiveCoachApplication({ provider, modePolicy: coachModePolicy, sink: localSink });
    const plan = learnPlan();
    const result = await app.start({
      plan,
      actionId: plan.currentActionId,
      correlationId: "corr-live-1",
      sessionId: "learn:auxiliaryTwoRatios",
      signal: new AbortController().signal,
    });
    assert.ok(result.ok);

    provider.events.push({ type: "ready", inputSampleRate: 16000, outputSampleRate: 24000 });
    provider.events.push({ type: "audio-delta", audioBase64: "AAAA", mimeType: "audio/pcm", sampleRate: 24000 });
    provider.events.push({ type: "completed" });
    // Drain to completion.
    await waitFor(() => localSink.getTimeline("corr-live-1")?.terminal === "completed");

    const timeline = localSink.getTimeline("corr-live-1");
    assert.ok(timeline, "LiveCoachApplication emitted to the sink");
    assert.equal(timeline!.flow, "live");
    assert.equal(timeline!.terminal, "completed");
    assert.ok(timeline!.providerConnectedAt, "live providerConnectedAt recorded");
    assert.ok(timeline!.ttsFirstAudioAt, "live TTS first audio recorded on first audio-delta");
    assert.equal(timeline!.provider, undefined, "live carries no provider name (port-driven)");

    // A browser-reported first-audio mark merges under the same live correlationId.
    localSink.recordBrowserMark("corr-live-1", "live", "browser-audio-started", Date.now());
    assert.ok(localSink.getTimeline("corr-live-1")?.browserFirstAudioAt, "live browser first audio merged");
  }

  // 8. NarrationApplication sinks its server timeline under the supplied
  //    correlationId (the browser narration utterance id).
  {
    const localSink = new InMemoryTelemetrySink();
    const narration = new NarrationApplication(new FakeSpeechSynthesizer(), 8, localSink);
    await narration.synthesize("我们先看这个已知条件。", undefined, "corr-narration-1");
    const timeline = localSink.getTimeline("corr-narration-1");
    assert.ok(timeline, "NarrationApplication emitted to the sink");
    assert.equal(timeline!.flow, "narration");
    assert.equal(timeline!.terminal, "completed");
    assert.ok(timeline!.requestStartedAt, "narration requestStartedAt recorded");
    assert.ok(timeline!.ttsFirstAudioAt, "narration TTS first audio recorded");
  }

  // 9. NarrationApplication.stream sinks first-audio on the first chunk.
  {
    const localSink = new InMemoryTelemetrySink();
    const narration = new NarrationApplication(new FakeSpeechSynthesizer(), 8, localSink);
    const chunks: Buffer[] = [];
    await narration.stream("再继续往下分析。", undefined, (chunk) => chunks.push(chunk), "corr-narration-2");
    assert.ok(chunks.length, "stream forwarded the chunk");
    const timeline = localSink.getTimeline("corr-narration-2");
    assert.ok(timeline?.ttsFirstAudioAt, "narration stream TTS first audio recorded on first chunk");
    assert.equal(timeline!.terminal, "completed");
  }

  // 10. list() returns all known timelines.
  {
    assert.ok(sink.list().some((item) => item.correlationId === "corr-turn-1"), "list includes the merged turn timeline");
  }

  console.log("PASS TelemetrySink persists + correlates server timelines with browser first-audio across turn/live/narration");
}

void main().catch((error) => { console.error(error); process.exit(1); });
