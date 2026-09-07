/** Permanent regressions from the independent S2 review.
 * Real Approved assets, application, SQL leases and kernel; only model output is scripted.
 * No production approval, registry mutation, or existing test database is involved.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ensureSqlite } from "../../tutorSession/__tests__/support";
import { realCanonicalRoot } from "../../tutorNavigator/__tests__/navigatorSupport";
import { f6Model } from "./f6Support";
import { FixedResponseGateProvider } from "../../tutorNavigator/ModelGateAdjudicatorV5";
import type { StructuredModelPort, StructuredCompletionRequest } from "../../tutorIntelligence/structuredModelPort";
import type { TutorRuntimeStateV9 } from "../../tutorSession/TutorRuntimeStateReducerV9";

ensureSqlite("f7-generation-recovery-regressions");
const { TutorRuntimeApplicationV7 } = require("../TutorRuntimeApplicationV7") as typeof import("../TutorRuntimeApplicationV7");
const { structuredPresenterGenerator } = require("../presentationGeneration/GeneratorPort") as typeof import("../presentationGeneration/GeneratorPort");
const { createGenerationRecoveryScanner } = require("../presentationGeneration/GenerationRecoveryWorker") as typeof import("../presentationGeneration/GenerationRecoveryWorker");
const { db } = require("../../../db/database") as typeof import("../../../db/database");

function scriptedModel(response: (request: StructuredCompletionRequest) => Promise<unknown>): StructuredModelPort {
  return {
    provider: "scripted-recovery-regression", modelId: "scripted-recovery-regression/v1",
    async complete<T>(request: StructuredCompletionRequest) {
      return { value: await response(request) as T, modelId: this.modelId, promptVersion: request.promptVersion, latencyMs: 1 };
    },
  };
}
function application(model: StructuredModelPort) {
  const gate = new FixedResponseGateProvider([], "fixed-recovery-regression");
  return TutorRuntimeApplicationV7.create({ canonicalRoot: realCanonicalRoot(),
    model: f6Model(gate, `fixed-response/${gate.name}`), presenter: structuredPresenterGenerator(model) });
}
let serial = 0;
function start(app: ReturnType<typeof application>) {
  const sessionId = `TS-987655${String(++serial).padStart(4, "0")}`;
  const result = app.start({ task_id: "goldenMinhangFold2020", student_id: "recovery-regression",
    client_request_id: `recovery-regression-${sessionId}`, sessionIdAllocator: () => sessionId });
  assert.equal(result.kind, "created");
  assert.equal(result.orchestrator.hasPendingGeneration(), true);
  return result.orchestrator;
}
function state(app: ReturnType<typeof application>, sessionId: string): TutorRuntimeStateV9 {
  return app.restore(sessionId).rebuildRuntimeState() as unknown as TutorRuntimeStateV9;
}

test("illegal compiled basis fails once as draft_invalid; background scans never consume another attempt", async () => {
  let calls = 0;
  const app = application(scriptedModel(async () => {
    calls += 1;
    // Schema-valid model output passes structuredPresenterGenerator, then fails real IntentCompiler.
    return { items: [{ type: "speech", text: "引用超出冻结上下文的依据。", basis_refs: ["FN-999"] }] };
  }));
  const session = start(app);
  const errors: unknown[] = [];
  const scanner = createGenerationRecoveryScanner(() => app, error => errors.push(error));
  try {
    await scanner.scanOnce();
    const failed = state(app, session.sessionId);
    assert.equal(calls, 1);
    assert.equal(failed.generation_requests[0].status, "failed");
    assert.equal(failed.generation_requests[0].error_class, "draft_invalid");
    assert.equal(failed.generation_requests[0].attempt, 1);
    assert.equal(failed.generation_requests[0].epoch, 2);
    assert.equal(failed.generation_slot.status, "failed");
    const events = app.restore(session.sessionId).events;
    assert.equal(events.filter(event => event.event_type === "presentation_sequence_planned").length, 0);
    assert.equal(events.filter(event => String(event.event_type) === "presentation_generation_failed").length, 1);
    assert.equal(events.filter(event => String(event.event_type) === "presentation_generation_retry_scheduled").length, 0);
    for (let scan = 0; scan < 3; scan += 1) await scanner.scanOnce();
    assert.equal(calls, 1, "compiler rejection must not become an orphan recovery/model retry");
    assert.deepEqual(state(app, session.sessionId), failed);
    assert.deepEqual(app.restore(session.sessionId).events, events);
    assert.deepEqual(errors, [], "known invalid draft must settle normally rather than escape to worker logging");
  } finally { scanner.stop(); }
});

for (const progress of ["awaiting_browser", "next_ordinal", "completed", "superseded"] as const) {
  test(`late owner returns the committed result without re-delivery (${progress})`, { timeout: 10_000 }, async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const firstCall = new Promise<void>(resolve => { entered = resolve; });
    let calls = 0;
    const app = application(scriptedModel(async request => {
      const call = ++calls;
      const ref = (request.userPayload as { allowed_knowledge: Array<{ ref: string }> }).allowed_knowledge[0].ref;
      if (call === 1) { entered(); await held; }
      return { items: Array.from({ length: progress === "next_ordinal" ? 2 : 1 }, (_, index) =>
        ({ type: "speech", text: `第 ${index + 1} 段核对已知依据。`, basis_refs: [ref] })) };
    }));
    const old = start(app);
    // Handle any rejection immediately, but fail the test below if the late call rejects.
    const lateResult = old.drivePendingGeneration().then(outcome => ({ outcome }), error => ({ error }));
    try {
      await firstCall;
      const initial = state(app, old.sessionId).generation_requests[0];
      assert.equal(initial.attempt, 1);
      assert.equal(initial.epoch, 2);
      // Only this test session's rebuildable lease is expired; canonical events are untouched.
      const expired = db.prepare("UPDATE tutor_generation_leases SET expires_ms=0 WHERE session_id=? AND request_id=?")
        .run(old.sessionId, initial.request_id);
      assert.equal(expired.changes, 1);
      const replacement = app.restore(old.sessionId);
      const winner = await replacement.drivePendingGeneration();
      assert.equal(winner.kind, "committed");
      assert.equal(winner.report?.beat_id, "BT-01", "v9 scope must normalize to the delivery Beat");
      assert.equal(calls, 2);
      const afterCommit = state(app, old.sessionId);
      assert.equal(afterCommit.generation_requests[0].attempt, 2);
      assert.equal(afterCommit.generation_requests[0].epoch, 3);
      const cursor = afterCommit.presentation_cursor;
      assert.equal(cursor.status, "awaiting_browser");
      if (progress !== "awaiting_browser") {
        replacement.reportPresentationOutcome({ sequence_id: cursor.sequence_id, ordinal: cursor.ordinal,
          action_id: cursor.action_id, outcome: progress === "superseded" ? "interrupted" : "presented",
          client_request_id: `winner-outcome-${old.sessionId}` });
      }
      const before = state(app, old.sessionId);
      const events = app.restore(old.sessionId).events;
      if (progress === "next_ordinal") {
        assert.equal(before.presentation_cursor.status, "awaiting_browser");
        assert.equal(before.presentation_cursor.ordinal, 1);
      } else if (progress !== "awaiting_browser") assert.equal(before.presentation_cursor.status, "idle");
      if (progress === "superseded") assert.ok(events.some(event => event.event_type === "presentation_sequence_superseded"));
      release();
      const late = await lateResult;
      if ("error" in late) throw late.error;
      assert.equal(late.outcome.kind, "committed");
      if (late.outcome.kind !== "committed" || winner.kind !== "committed") throw new Error("expected committed result");
      assert.equal(late.outcome.sequence.sequence_id, winner.sequence.sequence_id);
      assert.equal(late.outcome.sequence.generation?.epoch, 3, "return the winner identity, never the old candidate");
      assert.equal(late.outcome.report, undefined);
      assert.equal(calls, 2);
      assert.deepEqual(state(app, old.sessionId), before, "late verification must append no state changes");
      assert.deepEqual(app.restore(old.sessionId).events, events, "no duplicate validated/applied/delivered events");
    } finally { release(); await lateResult; }
  });
}
