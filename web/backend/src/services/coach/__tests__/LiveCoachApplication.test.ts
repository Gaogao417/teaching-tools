import assert from "node:assert/strict";
import type { ExercisePlan } from "../../../../../shared/actionRuntime";
import { AsyncQueue } from "../application/asyncQueue";
import { LiveCoachApplication } from "../application/LiveCoachApplication";
import { coachModePolicy } from "../application/coachModePolicy";
import type { LiveCoachServerEvent } from "../../../../../shared/coachMedia";
import type {
  CoachContext,
  RealtimeVoiceCommand,
  RealtimeVoiceEvent,
  RealtimeVoiceError,
  RealtimeVoiceProvider,
  RealtimeVoiceSession,
} from "../ports/RealtimeVoiceProvider";
import type { Result } from "../ports/TextCoachEngine";
import { getLearningActionPlan } from "../../learningService";

/** A fake realtime provider that emits scripted typed events and records the
 *  commands the application sends. It implements the PORT only — no provider
 *  SDK, model name or socket — proving the use case is provider-neutral. */
class FakeRealtimeProvider implements RealtimeVoiceProvider {
  readonly commands: RealtimeVoiceCommand[] = [];
  readonly events = new AsyncQueue<RealtimeVoiceEvent>();
  openContext: CoachContext | undefined;
  async open(context: CoachContext, _signal: AbortSignal): Promise<Result<RealtimeVoiceSession, RealtimeVoiceError>> {
    this.openContext = context;
    const commands = this.commands;
    const events = this.events;
    const session: RealtimeVoiceSession = {
      next: () => events.next(),
      async send(command: RealtimeVoiceCommand): Promise<void> { commands.push(command); },
      async close(): Promise<void> { events.complete(); },
    };
    return { ok: true, value: session };
  }
}

function learnPlan(): ExercisePlan {
  return getLearningActionPlan("auxiliaryTwoRatios" as never);
}

async function drain(queue: AsyncQueue<LiveCoachServerEvent>, into: LiveCoachServerEvent[], until: (event: LiveCoachServerEvent) => boolean): Promise<void> {
  while (true) {
    const { value, done } = await queue.next();
    if (done) break;
    into.push(value);
    if (until(value)) break;
  }
}

async function main(): Promise<void> {
  // 1. The live use case opens the port with the shared CoachContext and
  //    forwards typed provider events as public live.* events — no provider
  //    class is involved.
  {
    const provider = new FakeRealtimeProvider();
    const app = new LiveCoachApplication({ provider, modePolicy: coachModePolicy });
    const plan = learnPlan();
    const result = await app.start({
      plan,
      actionId: plan.currentActionId,
      correlationId: "corr-1",
      sessionId: "learn:auxiliaryTwoRatios",
      signal: new AbortController().signal,
    });
    assert.ok(result.ok, "live start succeeds for a learn plan");

    // The shared context builder produced the CoachContext handed to the port.
    assert.equal(provider.openContext?.mode, plan.mode);
    assert.equal(provider.openContext?.problemLatex, plan.metadata.promptLatex);
    assert.equal(provider.openContext?.action.actionId, plan.currentActionId);

    const events: LiveCoachServerEvent[] = [];
    const done = drain(result.value.events, events, (event) => event.type === "live.completed");

    provider.events.push({ type: "ready", inputSampleRate: 16000, outputSampleRate: 24000 });
    provider.events.push({ type: "transcript-delta", role: "student", text: "你好" });
    provider.events.push({ type: "audio-delta", audioBase64: "AAAA", mimeType: "audio/pcm", sampleRate: 24000 });
    provider.events.push({ type: "interrupted" });
    provider.events.push({ type: "completed" });
    await done;

    const types = events.map((event) => event.type);
    assert.equal(types[0], "live.ready", "first public event is live.ready");
    assert.ok(types.includes("live.transcript.delta"), "transcript forwarded as public event");
    assert.ok(types.includes("live.audio"), "audio forwarded as public event");
    assert.ok(types.includes("live.interrupted"), "interrupt forwarded");
    assert.ok(types.includes("live.completed"), "completion forwarded");
    // Public events carry the media envelope.
    const ready = events[0];
    assert.equal(ready.correlationId, "corr-1");
    assert.equal(ready.sessionId, "learn:auxiliaryTwoRatios");
    assert.equal(typeof ready.sequence, "number");
  }

  // 2. Client commands are mapped to provider-neutral port commands (still no
  //    raw provider event); update-context rebuilds the safe context.
  {
    const provider = new FakeRealtimeProvider();
    const app = new LiveCoachApplication({ provider, modePolicy: coachModePolicy });
    const plan = learnPlan();
    const result = await app.start({
      plan,
      actionId: plan.currentActionId,
      correlationId: "corr-2",
      sessionId: "s",
      signal: new AbortController().signal,
    });
    assert.ok(result.ok);
    provider.events.push({ type: "ready", inputSampleRate: 16000, outputSampleRate: 24000 });
    await result.value.events.next(); // drain ready so the pump is running

    await result.value.send({ type: "audio", audioBase64: "AAAA", mimeType: "audio/pcm", sampleRate: 16000 });
    await result.value.send({ type: "commit" });
    await result.value.send({ type: "interrupt" });

    assert.equal(provider.commands[0]?.type, "append-audio", "audio command mapped to port");
    assert.equal(provider.commands[1]?.type, "commit-turn", "commit mapped to port");
    assert.equal(provider.commands[2]?.type, "interrupt", "interrupt mapped to port");

    // update-context rebuilds a safe CoachContext for the new action.
    const nextAction = plan.actions.find((action) => action.actionId !== plan.currentActionId) ?? plan.actions[0];
    await result.value.send({ type: "update-context", actionId: nextAction.actionId });
    const updateCmd = provider.commands[provider.commands.length - 1];
    assert.equal(updateCmd.type, "update-context", "update-context mapped to port");
    if (updateCmd.type === "update-context") {
      assert.equal(updateCmd.context.action.actionId, nextAction.actionId, "context rebuilt for the new action");
    }
  }

  // 3. Assessment fails closed: the port is never opened.
  {
    const provider = new FakeRealtimeProvider();
    const app = new LiveCoachApplication({ provider, modePolicy: coachModePolicy });
    const plan: ExercisePlan = { ...learnPlan(), mode: "assessment" };
    const result = await app.start({
      plan,
      actionId: plan.currentActionId,
      correlationId: "corr-3",
      sessionId: "s",
      signal: new AbortController().signal,
    });
    assert.ok(!result.ok, "live start must fail in assessment");
    assert.equal(result.error.code, "NOT_ALLOWED", "assessment denial code");
    assert.equal(provider.openContext, undefined, "the realtime port was never opened in assessment");
  }

  console.log("PASS LiveCoachApplication drives the realtime port with typed events and fails closed in assessment");
}

void main().catch((error) => { console.error(error); process.exit(1); });
