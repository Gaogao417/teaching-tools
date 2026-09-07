/** Real v9 kernel/compiler/preflight/delivery/restore; only presenter and approved binding candidate are test inputs. */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { rmSync, readFileSync } from "node:fs";
import { ensureSqlite } from "../../tutorSession/__tests__/support";
import { realCanonicalRoot } from "../../tutorNavigator/__tests__/navigatorSupport";
import { f6Model } from "./f6Support";
import { FixedResponseGateProvider } from "../../tutorNavigator/ModelGateAdjudicatorV5";
import type { PresenterGeneratorPort } from "../presentationGeneration/GeneratorPort";
import type { PresenterUserPayload } from "../presentationGeneration/PresenterPrompts";
import type { PresentationResourceBinding } from "../presentationGeneration/PresentationToolCatalog";
import { workspaceRuntimeStateV2Schema, studentWorkspaceViewV2Schema, tutorRuntimeStateV4Schema } from "../../../../../shared/canonical";
const sqlitePath = ensureSqlite("s2-v9-dynamic-board-session");
after(() => {
  (require("../../../db/database") as typeof import("../../../db/database")).db.close();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${sqlitePath}${suffix}`, { force: true });
});
const { TutorSessionOrchestratorV7 } = require("../TutorSessionOrchestratorV7") as typeof import("../TutorSessionOrchestratorV7");
type Session = import("../TutorSessionOrchestratorV7").TutorSessionOrchestratorV7;
const root = realCanonicalRoot();
const model = () => f6Model(new FixedResponseGateProvider([], "dynamic-board-test"), "fixed-response/dynamic-board-test");
class Presenter implements PresenterGeneratorPort {
  readonly provider = "scripted-presenter";
  readonly modelId = "dynamic-board-test/v1";
  readonly pin = { provider: this.provider, model_id: this.modelId, prompt_version: "presenter-interleaved/v1",
    context_builder_version: "presentation-context-builder/v1", tool_catalog_version: "presentation-tool-catalog/v1" };
  calls = 0;
  constructor(readonly forbid = false) {}
  async generatePresentationDraft(request: Parameters<PresenterGeneratorPort["generatePresentationDraft"]>[0]) {
    assert.equal(this.forbid, false, "resume must not invoke generation"); this.calls++;
    const payload = request.userPayload as PresenterUserPayload;
    const explain = payload.tools.find((tool) => tool.tool === "board.explain");
    assert.ok(explain?.binding_refs.includes("VB-91"), "FN-01/RES1 candidate must pass real tool visibility");
    assert.ok(payload.allowed_knowledge.some((k) => k.ref === "FN-01"));
    return { latencyMs: 1, draft: { schema: "ai_teaching_presentation_draft/v2" as const, request_id: request.request_id,
      items: [
        { type: "speech" as const, text: "把当前批准依据记在板上。", basis_refs: ["FN-01"] },
        { type: "tool_intent" as const, tool: "board.explain", args: { binding_ref: "VB-91", params: { note_kind: "explanation_text" } } },
      ] } };
  }
}
function projected(session: Session) {
  const snapshot = session.snapshot();
  assert.equal(snapshot.views.studentWorkspaceView.schema, "ai_teaching_student_workspace_view/v2");
  const view = studentWorkspaceViewV2Schema.parse(snapshot.views.studentWorkspaceView);
  assert.equal(view.session_id, session.sessionId);
  assert.equal(view.revision, session.workspaceFold().state.revision);
  assert.deepEqual(view.participation, snapshot.views.participation);
  return view;
}
function receipt(session: Session, client_request_id: string) {
  const cursor = session.rebuildRuntimeState().presentation_cursor;
  assert.equal(cursor.status, "awaiting_browser");
  if (cursor.status !== "awaiting_browser") throw new Error("no delivery");
  return { sequence_id: cursor.sequence_id, ordinal: cursor.ordinal, action_id: cursor.action_id,
    outcome: "presented" as const, client_request_id };
}

test("real v9 dynamic board: planned hidden → applied visible → verified restore, zero regeneration", async () => {
  const presenter = new Presenter(); const sessionId = `TS-92${Date.now()}`;
  const session = TutorSessionOrchestratorV7.start({ sessionId, studentId: "s2-board-test",
    taskId: "goldenMinhangFold2020", canonicalRoot: root, model: model(), presenter });
  assert.deepEqual(projected(session).solution_board.fragments, [], "v9 snapshot uses view/v2 before content is planned");
  // Only this session's imported binding candidates change. Production visibility,
  // compiler, kernel, workspace and delivery remain real; no canonical files change.
  const binding = (session as unknown as { binding: { imported: { plan: { resource_bindings?: readonly PresentationResourceBinding[] } } } }).binding;
  const originalPlan = binding.imported.plan;
  binding.imported.plan = { ...originalPlan, resource_bindings: [...(originalPlan.resource_bindings ?? []), {
    binding_id: "VB-91", binding_kind: "explanation", purpose: "approved opening explanation",
    basis_refs: { fact_ids: ["FN-01"], inference_ids: [] }, presentation_resource: "RES1",
  }] };
  const result = await session.drivePendingGeneration();
  assert.equal(result.kind, "committed", JSON.stringify(result)); assert.equal(presenter.calls, 1);
  const planned = session.events.find((e) => e.event_type === "presentation_sequence_planned")!;
  const body = (planned.payload as unknown as { explanation_fragments: Array<{ content: string }> }).explanation_fragments[0];
  assert.ok(body.content);
  assert.equal(workspaceRuntimeStateV2Schema.parse(session.workspaceFold().state).solution_board.explanation_fragments![0].visible, false);
  assert.deepEqual(projected(session).solution_board.fragments, []);
  assert.equal(JSON.stringify(session.snapshot().views.studentWorkspaceView).includes(body.content), false);
  const never = new Presenter(true);
  const resume = () => TutorSessionOrchestratorV7.resume({ sessionId, canonicalRoot: root, model: model(), presenter: never });
  const hidden = resume(); assert.deepEqual(projected(hidden).solution_board.fragments, []);
  const appliedResponse = hidden.reportPresentationOutcome(receipt(hidden, "s2-voice-presented"));
  assert.equal(studentWorkspaceViewV2Schema.parse(appliedResponse.snapshot.views.studentWorkspaceView)
    .solution_board.fragments![0].content, body.content);
  assert.equal(projected(hidden).solution_board.fragments![0].content, body.content);
  assert.equal(hidden.rebuildRuntimeState().presentation_cursor.status, "awaiting_browser");
  assert.equal(hidden.events.filter((e) => e.event_type === "presentation_action_outcome_recorded").length, 1,
    "only client voice receipt exists; server cannot invent board presented");
  const restored = resume(); assert.deepEqual(projected(restored), projected(hidden));
  const boardReceipt = receipt(restored, "s2-board-presented"); restored.reportPresentationOutcome(boardReceipt);
  const finalView = projected(restored);
  assert.equal(finalView.solution_board.fragments![0].content, body.content);
  assert.equal("origin_generation" in finalView.solution_board.fragments![0], false);
  assert.equal("visible" in finalView.solution_board.fragments![0], false);
  const count = restored.events.length; restored.reportPresentationOutcome(boardReceipt);
  assert.equal(restored.events.length, count, "lost-response retry is idempotent");
  assert.equal(never.calls, 0); assert.equal(presenter.calls, 1);
  assert.equal(restored.events.filter((e) => e.event_type === "presentation_sequence_planned").length, 1);
  assert.equal(restored.assertReplayParity().equal, true);
});


test("v7 snapshot retains the static view/v1 contract", () => {
  const session = TutorSessionOrchestratorV7.start({ sessionId: `TS-93${Date.now()}`, studentId: "s2-v7-snapshot-test",
    taskId: "goldenMinhangFold2020", canonicalRoot: root, model: model() });
  assert.equal(session.snapshot().views.studentWorkspaceView.schema, "ai_teaching_student_workspace_view/v1");
});

class GateRevealPresenter implements PresenterGeneratorPort {
  readonly provider = "scripted-gate-reveal";
  readonly modelId = "gate-reveal/v1";
  readonly pin = { provider: this.provider, model_id: this.modelId, prompt_version: "presenter-interleaved/v1",
    context_builder_version: "presentation-context-builder/v1", tool_catalog_version: "presentation-tool-catalog/v1" };
  reveal = false;
  async generatePresentationDraft(request: Parameters<PresenterGeneratorPort["generatePresentationDraft"]>[0]) {
    const payload = request.userPayload as PresenterUserPayload;
    if (this.reveal) assert.ok(payload.tools.some((t) => t.tool === "board.reveal-entry" && t.binding_refs.includes("VB-92")));
    const items = this.reveal
      ? [{ type: "tool_intent" as const, tool: "board.reveal-entry", args: { binding_ref: "VB-92", params: {} } }]
      : [{ type: "speech" as const, text: "请按当前批准任务完成核验。", basis_refs: [payload.allowed_knowledge[0].ref] }];
    return { latencyMs: 1, draft: { schema: "ai_teaching_presentation_draft/v2" as const, request_id: request.request_id, items } };
  }
}
function gateRevealSession(presenter: GateRevealPresenter, suffix: string) {
  const response = JSON.stringify({ response_kind: "final_answer", matched_gate_id: "GT-02", verdict: "pass",
    reasoning_location: "aligned", grounding_refs: ["FN-06"], brief_reason: "approved similarity identified" });
  const session = TutorSessionOrchestratorV7.start({ sessionId: `TS-94${Date.now()}${suffix}`, studentId: "s2-gate-reveal",
    taskId: "goldenMinhangFold2020", canonicalRoot: root,
    model: f6Model(new FixedResponseGateProvider([response], "s2-gate-reveal"), "fixed-response/s2-gate-reveal"), presenter });
  const binding = (session as unknown as { binding: {
    golden: { factEntryIds: ReadonlyMap<string, string> };
    imported: { plan: { resource_bindings?: readonly PresentationResourceBinding[] } };
  } }).binding;
  // FN-06 is the approved GT-02 fact. Its catalog entry is intermediate;
  // the candidate binding adds the real Gate requirement at compiler admission.
  const entry = session.sessionCatalog.boardEntries.find((entry) => entry.entryId === binding.golden.factEntryIds.get("FN-06"));
  assert.ok(entry);
  binding.imported.plan = { ...binding.imported.plan, resource_bindings: [...(binding.imported.plan.resource_bindings ?? []), {
    binding_id: "VB-92", binding_kind: "board", purpose: "approved GT-02 reveal candidate", board_entry_id: entry.entryId,
    reveal_after_gate: { protocol_id: "PR-SMV-001", gate_id: "GT-02" },
  }] };
  return { session, entry };
}

test("real v9 board binding rejects reveal before Gate and commits no candidate actions", async () => {
  const presenter = new GateRevealPresenter(); presenter.reveal = true;
  const { session, entry } = gateRevealSession(presenter, "1");
  const before = session.workspaceFold().state;
  const outcome = await session.drivePendingGeneration();
  assert.deepEqual(outcome, { kind: "failed", errorClass: "draft_invalid" });
  const state = tutorRuntimeStateV4Schema.parse(session.rebuildRuntimeState());
  assert.equal(state.generation_slot.status, "failed");
  assert.equal(state.generation_requests[0].status, "failed");
  assert.equal(state.generation_requests[0].error_class, "draft_invalid");
  assert.equal(session.events.filter((e) => e.event_type === "presentation_sequence_planned").length, 0);
  assert.equal(session.events.filter((e) => e.event_type === "presentation_action_applied").length, 0);
  assert.deepEqual(session.workspaceFold().state, before);
  assert.equal(before.solution_board.entries.find((e) => e.entry_id === entry.entryId)?.visibility, "hidden");
});

test("real v9 board binding reveals only after committed student evidence satisfies GT-02", async () => {
  const presenter = new GateRevealPresenter();
  const { session, entry } = gateRevealSession(presenter, "2");
  assert.equal((await session.drivePendingGeneration()).kind, "committed");
  session.reportPresentationOutcome(receipt(session, "gate-first-voice"));
  await session.submitStudentInput({ input: { kind: "control", command: "confirm" }, client_request_id: "gate-confirm-first" }, {});
  assert.equal((await session.drivePendingGeneration()).kind, "committed");
  session.reportPresentationOutcome(receipt(session, "gate-second-voice"));
  assert.equal(session.rebuildRuntimeState().teaching_cursor.beat_id, "BT-02");
  await session.submitStudentInput({ input: { kind: "utterance", channel: "mainline", text: "子母型相似，△CAD∽△CBA" }, client_request_id: "gate-student-answer" }, {});
  const ledger = session.workspaceFold().context.gateLedger;
  assert.equal(ledger.evaluations.get("GT-02@BT-02")?.satisfied, true);
  assert.equal(ledger.cursor.beatId, "BT-03", "real passing answer transitions to the next approved Beat");
  assert.equal(session.workspaceFold().state.solution_board.entries.find((e) => e.entry_id === entry.entryId)?.visibility, "hidden");
  presenter.reveal = true;
  assert.equal(session.hasPendingGeneration(), true, "the real transition reserves the next presentation");
  const outcome = await session.drivePendingGeneration();
  assert.equal(outcome.kind, "committed", JSON.stringify(outcome));
  assert.equal(session.workspaceFold().state.solution_board.entries.find((e) => e.entry_id === entry.entryId)?.visibility, "visible");
  const board = session.snapshot().views.studentWorkspaceView.solution_board;
  assert.ok(board.groups.some((group) => group.entries.some((e) => e.entry_id === entry.entryId && e.content === entry.content)));
  assert.equal(session.rebuildRuntimeState().presentation_cursor.status, "awaiting_browser", "reveal does not invent browser outcome");
});

/** First item is a real board.explain, with approved content (no preceding speech needed). */
class WorkspaceFirstPresenter extends Presenter {
  override async generatePresentationDraft(request: Parameters<PresenterGeneratorPort["generatePresentationDraft"]>[0]) {
    assert.equal(this.forbid, false); this.calls++;
    const payload = request.userPayload as PresenterUserPayload;
    assert.ok(payload.tools.some((t) => t.tool === "board.explain" && t.binding_refs.includes("VB-91")));
    return { latencyMs: 1, draft: { schema: "ai_teaching_presentation_draft/v2" as const, request_id: request.request_id,
      items: [
        { type: "tool_intent" as const, tool: "board.explain", args: { binding_ref: "VB-91", params: { note_kind: "approved_math_note" } } },
        { type: "speech" as const, text: "核对刚刚写出的批准依据。", basis_refs: ["FN-01"] },
      ] } };
  }
}
function workspaceFirstSession() {
  const presenter = new WorkspaceFirstPresenter();
  const sessionId = `TS-96${Date.now()}${++crashSerial}`;
  const session = TutorSessionOrchestratorV7.start({ sessionId, studentId: "s2-crash-window",
    taskId: "goldenMinhangFold2020", canonicalRoot: root, model: model(), presenter });
  const binding = (session as unknown as { binding: { imported: { plan: { resource_bindings?: readonly PresentationResourceBinding[] } } } }).binding;
  binding.imported.plan = { ...binding.imported.plan, resource_bindings: [...(binding.imported.plan.resource_bindings ?? []), {
    binding_id: "VB-91", binding_kind: "explanation", purpose: "approved first workspace action",
    basis_refs: { fact_ids: ["FN-01"], inference_ids: [] }, presentation_resource: "RES1",
  }] };
  const never = new WorkspaceFirstPresenter(true);
  const resume = () => TutorSessionOrchestratorV7.resume({ sessionId, canonicalRoot: root, model: model(), presenter: never });
  return { session, presenter, never, resume };
}
let crashSerial = 0;
type DeliveryHook = { deliverOrdinal(...args: unknown[]): unknown };
function appliedOrdinals(session: Session) {
  return session.events.filter((e) => e.event_type === "presentation_action_applied")
    .map((e) => (e.payload as { ordinal: number }).ordinal);
}
function deliveredOrdinals(session: Session) {
  return session.events.filter((e) => e.event_type === "presentation_action_delivered")
    .map((e) => (e.payload as { ordinal: number }).ordinal);
}

test("v9 crash after planned before first workspace delivery resumes approved scope exactly once", async () => {
  const { session, presenter, never, resume } = workspaceFirstSession();
  // Fault only at the boundary after the real planned transaction. No SQL edits.
  const hook = session as unknown as DeliveryHook;
  hook.deliverOrdinal = () => { throw new Error("crash before first delivery"); };
  await assert.rejects(() => session.drivePendingGeneration(), /crash before first delivery/);
  const planned = session.events.find((e) => e.event_type === "presentation_sequence_planned")!;
  assert.ok(planned);
  const payload = planned.payload as unknown as { scope: { beat_id: string }; beat_id?: string;
    explanation_fragments: Array<{ content: string }> };
  assert.equal(payload.beat_id, undefined); assert.equal(payload.scope.beat_id, "BT-01");
  assert.deepEqual(appliedOrdinals(session), []); assert.deepEqual(deliveredOrdinals(session), []);
  assert.equal(session.workspaceFold().state.revision, 0);
  assert.deepEqual(projected(session).solution_board.fragments, []);
  const count = session.events.length;
  const restored = resume();
  assert.equal(restored.events.length, count + 3, "validated/applied/delivered are one real kernel batch");
  assert.deepEqual(appliedOrdinals(restored), [0]); assert.deepEqual(deliveredOrdinals(restored), [0]);
  assert.equal(restored.workspaceFold().state.revision, 1);
  assert.equal(projected(restored).solution_board.fragments![0].content, payload.explanation_fragments[0].content);
  assert.equal(receipt(restored, "inspect-first").ordinal, 0);
  const again = resume(); assert.equal(again.events.length, restored.events.length);
  assert.deepEqual(projected(again), projected(restored));
  assert.equal(presenter.calls, 1); assert.equal(never.calls, 0);

  // A second crash: first receipt commits but next delivery does not. Resume must
  // select ordinal 1, retaining the already applied workspace state at revision 1.
  (again as unknown as DeliveryHook).deliverOrdinal = () => { throw new Error("crash before tail delivery"); };
  await assert.rejects(async () => again.reportPresentationOutcome(receipt(again, "first-client-presented")), /crash before tail delivery/);
  assert.equal(again.rebuildRuntimeState().presentation_cursor.status, "idle");
  const tail = resume();
  assert.equal(receipt(tail, "inspect-tail").ordinal, 1);
  assert.deepEqual(appliedOrdinals(tail), [0]); assert.deepEqual(deliveredOrdinals(tail), [0, 1]);
  assert.equal(tail.workspaceFold().state.revision, 1);
  assert.equal(never.calls, 0); assert.equal(tail.assertReplayParity().equal, true);
});

for (const progress of ["awaiting-head", "tail-gap", "completed"] as const) {
  test(`v9 planned commit receipt lost after another owner progresses to ${progress}: no ordinal-zero reapply`, async () => {
    const { session, presenter, never, resume } = workspaceFirstSession();
    type Access = import("../presentationGeneration/GenerationCoordinator").GenerationKernelAccess;
    const hook = session as unknown as { generationKernelAccess(): Access };
    const original = hook.generationKernelAccess.bind(session);
    let injected = false;
    hook.generationKernelAccess = () => {
      const access = original(); const append = access.append.bind(access);
      access.append = (revision, events) => {
        const result = append(revision, events);
        if (!injected && events.some((e) => e.event_type === "presentation_sequence_planned")) {
          injected = true;
          const competing = resume(); // A separate wrapper resumes the committed stream.
          if (progress === "tail-gap") {
            (competing as unknown as DeliveryHook).deliverOrdinal = () => { throw new Error("other owner dies before tail"); };
            assert.throws(() => competing.reportPresentationOutcome(receipt(competing, "competing-head")), /other owner dies before tail/);
          } else if (progress === "completed") {
            competing.reportPresentationOutcome(receipt(competing, "competing-head"));
            competing.reportPresentationOutcome(receipt(competing, "competing-tail"));
          }
          throw new Error("planned commit response lost");
        }
        return result;
      };
      return access;
    };
    const result = await session.drivePendingGeneration();
    assert.equal(result.kind, "committed"); assert.equal(injected, true);
    assert.equal(presenter.calls, 1); assert.equal(never.calls, 0);
    assert.deepEqual(appliedOrdinals(session), [0]);
    assert.deepEqual(deliveredOrdinals(session), progress === "awaiting-head" ? [0] : [0, 1]);
    assert.equal(session.workspaceFold().state.revision, 1);
    if (progress === "completed") {
      assert.equal(session.rebuildRuntimeState().presentation_cursor.status, "idle");
      assert.equal(result.report, undefined);
    } else {
      assert.equal(receipt(session, "inspect-competing").ordinal, progress === "awaiting-head" ? 0 : 1);
    }
    const before = session.events.length; const restored = resume();
    assert.equal(restored.events.length, before);
    assert.equal(restored.assertReplayParity().equal, true);
  });
}


test("v9 planned scope adapter resolves canonical local anchor instead of local Beat ID", () => {
  // Small adapter test alongside the real approved-scope crash/recovery tests.
  // This fixture is read-only; no local session or committed facts are fabricated.
  const planned = JSON.parse(readFileSync("../shared/canonical/fixtures/tutor-session-event.v9.positive.planned-content.json", "utf8"));
  const adapter = (TutorSessionOrchestratorV7.prototype as unknown as {
    plannedSequenceOf(this: { events: unknown[] }, id: string): { beat_id: string };
  }).plannedSequenceOf;
  const projected = adapter.call({ events: [planned] }, planned.payload.sequence_id);
  assert.equal(planned.payload.scope.kind, "local");
  assert.equal(projected.beat_id, planned.payload.scope.anchor.beat_id);
  assert.notEqual(projected.beat_id, planned.payload.scope.local_beat_id);
  const corrupt = structuredClone(planned); delete corrupt.payload.scope.anchor;
  assert.throws(() => adapter.call({ events: [corrupt] }, planned.payload.sequence_id), /no committed teaching anchor/);
});
