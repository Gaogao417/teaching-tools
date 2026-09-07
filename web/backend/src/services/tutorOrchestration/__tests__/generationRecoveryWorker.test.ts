/** Real SQL + application + Approved golden sessions; scripted model, no HTTP/GET. */
import assert from "node:assert/strict";
import test from "node:test";
import { ensureSqlite } from "../../tutorSession/__tests__/support";
import { realCanonicalRoot } from "../../tutorNavigator/__tests__/navigatorSupport";
import { f6Model } from "./f6Support";
import { FixedResponseGateProvider } from "../../tutorNavigator/ModelGateAdjudicatorV5";
import type { PresenterGeneratorPort, PresenterGenerationPin } from "../presentationGeneration/GeneratorPort";

ensureSqlite("f7-generation-recovery-worker");
const { TutorRuntimeApplicationV7 } = require("../TutorRuntimeApplicationV7") as typeof import("../TutorRuntimeApplicationV7");
const { createGenerationRecoveryScanner, startGenerationRecoveryWorker } = require("../presentationGeneration/GenerationRecoveryWorker") as typeof import("../presentationGeneration/GenerationRecoveryWorker");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
class ScriptedPort implements PresenterGeneratorPort {
  readonly provider = "scripted-recovery";
  readonly modelId = "scripted-recovery/v1";
  readonly pin: PresenterGenerationPin = {
    provider: this.provider, model_id: this.modelId, prompt_version: "presenter-interleaved/v1",
    context_builder_version: "presentation-context-builder/v1", tool_catalog_version: "presentation-tool-catalog/v1",
  };
  constructor(promptVersion = "presenter-interleaved/v1") {
    this.pin = { ...this.pin, prompt_version: promptVersion };
  }
  calls = 0;
  active = 0;
  peak = 0;
  pause?: Promise<void>;
  onCall?: () => void;
  async generatePresentationDraft(request: { request_id: string; userPayload: unknown }) {
    this.calls += 1;
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    this.onCall?.();
    try {
      await this.pause;
      const ref = (request.userPayload as { allowed_knowledge: Array<{ ref: string }> }).allowed_knowledge[0].ref;
      return { draft: { schema: "ai_teaching_presentation_draft/v2" as const, request_id: request.request_id,
        items: [{ type: "speech" as const, text: `我们核对 ${ref} 的已知依据。`, basis_refs: [ref] }] }, latencyMs: 1 };
    } finally { this.active -= 1; }
  }
}
function application(port: ScriptedPort) {
  const gate = new FixedResponseGateProvider([], "fixed-recovery-worker");
  return TutorRuntimeApplicationV7.create({ canonicalRoot: realCanonicalRoot(),
    model: f6Model(gate, `fixed-response/${gate.name}`), presenter: port });
}
let serial = 0;
function start(app: ReturnType<typeof application>) {
  const id = `TS-970000${String(++serial).padStart(4, "0")}`;
  const result = app.start({ task_id: "goldenMinhangFold2020", student_id: "recovery-worker-test",
    client_request_id: `recovery-start-${id}`, sessionIdAllocator: () => id });
  assert.equal(result.kind, "created");
  assert.equal(result.orchestrator.hasPendingGeneration(), true);
  return result.orchestrator;
}

// This one test owns all sessions in its dedicated SQLite database; subtests are sequential.
test("background generation recovery uses the real database and isolates session failures", { timeout: 15_000 }, async t => {
  const port = new ScriptedPort();
  const app = application(port);
  const errors: unknown[] = [];
  let recoveredSessionId: string;
  const scanner = createGenerationRecoveryScanner(() => app, error => errors.push(error));
  try {
    await t.test("empty scan does not call the model", async () => {
      await scanner.scanOnce();
      assert.equal(port.calls, 0);
      assert.deepEqual(errors, []);
    });

    await t.test("server startup scan recovers pending without GET or a foreground drive", async () => {
      const session = start(app);
      recoveredSessionId = session.sessionId;
      assert.equal(port.calls, 0);
      const recovered = deferred();
      // Observe completion of the real application drive, not a substitute implementation.
      const originalDrive = app.drivePendingGeneration.bind(app);
      app.drivePendingGeneration = async restored => {
        try { await originalDrive(restored); } finally { recovered.resolve(); }
      };
      const stop = startGenerationRecoveryWorker(() => app, error => { errors.push(error); recovered.resolve(); });
      try {
        await recovered.promise;
        const state = app.restore(session.sessionId).rebuildRuntimeState();
        assert.equal(port.calls, 1);
        assert.equal((state.generation_requests as Array<{ status: string }>)[0].status, "committed");
        assert.deepEqual(state.generation_slot, { status: "idle" });
        assert.equal(state.presentation_cursor.status, "awaiting_browser");
        assert.deepEqual(errors, []);
      } finally { stop(); app.drivePendingGeneration = originalDrive; }
    });

    await t.test("non-pending active session is read without another model call or event", async () => {
      const calls = port.calls;
      const before = app.restore(recoveredSessionId).events.length;
      await scanner.scanOnce();
      await scanner.scanOnce();
      assert.equal(port.calls, calls);
      assert.equal(app.restore(recoveredSessionId).events.length, before);
      assert.deepEqual(errors, []);
    });

    await t.test("scan is non-overlapping and dispatch remains bounded to four", async () => {
      const sessions = Array.from({ length: 6 }, () => start(app));
      const release = deferred();
      const batchStarted = deferred();
      const before = port.calls;
      port.pause = release.promise;
      // At least three pending rows fit in the first batch, regardless of SQL order.
      port.onCall = () => { if (port.calls - before === 3) batchStarted.resolve(); };
      const scanning = scanner.scanOnce();
      try {
        await batchStarted.promise;
        const firstBatchCalls = port.calls;
        await scanner.scanOnce();
        assert.equal(port.calls, firstBatchCalls, "overlapping scan must not start another batch");
        assert.ok(port.calls - before <= 4);
      } finally { release.resolve(); await scanning; port.pause = undefined; port.onCall = undefined; }
      assert.equal(port.calls - before, 6);
      assert.ok(port.peak <= 4, `active model calls peaked at ${port.peak}`);
      for (const session of sessions) assert.equal(app.restore(session.sessionId).hasPendingGeneration(), false);
      assert.deepEqual(errors, []);
    });

    await t.test("one incompatible session does not block healthy sessions in later batches", async () => {
      const incompatible = new ScriptedPort("presenter-interleaved/incompatible-test");
      const broken = start(application(incompatible));
      const healthy = Array.from({ length: 5 }, () => start(app));
      const before = port.calls;
      await scanner.scanOnce();
      assert.equal(errors.length, 1);
      assert.match(String(errors[0]), /pin|PRESENTER/i);
      assert.equal(port.calls - before, healthy.length);
      assert.equal(incompatible.calls, 0);
      assert.equal(application(incompatible).restore(broken.sessionId).hasPendingGeneration(), true);
      for (const session of healthy) {
        assert.equal((app.restore(session.sessionId).rebuildRuntimeState().generation_requests as Array<{ status: string }>)[0].status, "committed");
      }
    });
  } finally { scanner.stop(); }
});
