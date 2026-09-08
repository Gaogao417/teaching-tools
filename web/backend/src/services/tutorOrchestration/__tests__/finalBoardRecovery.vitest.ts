/** FM-9 deterministic Draft + isolated binding inputs; real golden importer,
 * compiler, SQLite transactions and resume. No course approval/model evidence. */
import { describe, it, expect } from "vitest";
import { db } from "../../../db/database";
import { realCanonicalRoot } from "../../tutorNavigator/__tests__/navigatorSupport";
import { f6Model } from "./f6Support";
import { FixedResponseGateProvider } from "../../tutorNavigator/ModelGateAdjudicatorV5";
import { TutorSessionOrchestratorV7 } from "../TutorSessionOrchestratorV7";
import type { PresenterGeneratorPort } from "../presentationGeneration/GeneratorPort";
import type { PresenterUserPayload } from "../presentationGeneration/PresenterPrompts";
import type { PresentationResourceBinding } from "../presentationGeneration/PresentationToolCatalog";
import { studentWorkspaceViewV2Schema } from "../../../../../shared/canonical";
import type { WorkspaceFold } from "../../tutorSession/WorkspaceRuntimeReducerV5";
const root = realCanonicalRoot();
let serial = 0;
const model = () => f6Model(new FixedResponseGateProvider([], "final-board"), "fixed-response/final-board");
class Draft implements PresenterGeneratorPort {
  readonly provider = "scripted-final-board";
  readonly modelId = "final-board/v1";
  readonly pin = { provider: this.provider, model_id: this.modelId, prompt_version: "presenter-interleaved/v1", context_builder_version: "presentation-context-builder/v1", tool_catalog_version: "presentation-tool-catalog/v1" };
  calls = 0;
  constructor(readonly twoBoards = false) {}
  async generatePresentationDraft(request: Parameters<PresenterGeneratorPort["generatePresentationDraft"]>[0]) {
    this.calls++;
    const payload = request.userPayload as PresenterUserPayload;
    expect(payload.tools.find(t => t.tool === "board.explain")?.binding_refs).toContain("VB-91");
    const board = { type: "tool_intent" as const, tool: "board.explain", args: { binding_ref: "VB-91", params: { note_kind: "explanation_text" } } };
    const speech = { type: "speech" as const, text: "记录当前已批准依据。", basis_refs: ["FN-01"] };
    return { latencyMs: 1, draft: { schema: "ai_teaching_presentation_draft/v2" as const, request_id: request.request_id, items: this.twoBoards ? [{ ...board, args: { ...board.args, params: { note_kind: "approved_math_note" } } }, speech, board] : [speech, board] } };
  }
}
function setup(twoBoards = false) {
  const presenter = new Draft(twoBoards);
  const sessionId = `TS-97${Date.now()}${++serial}`;
  const session = TutorSessionOrchestratorV7.start({ sessionId, studentId: "final-board", taskId: "goldenMinhangFold2020", canonicalRoot: root, model: model(), presenter });
  const binding = (session as unknown as { binding: { imported: { plan: { resource_bindings?: readonly PresentationResourceBinding[] } } } }).binding;
  binding.imported.plan = { ...binding.imported.plan, resource_bindings: [...(binding.imported.plan.resource_bindings ?? []), {
    binding_id: "VB-91", binding_kind: "explanation", purpose: "isolated test binding", basis_refs: { fact_ids: ["FN-01"], inference_ids: [] }, presentation_resource: "RES1",
  }] };
  return { session, presenter, sessionId, resume: () => TutorSessionOrchestratorV7.resume({ sessionId, canonicalRoot: root, model: model(), presenter }) };
}
function receipt(session: TutorSessionOrchestratorV7, key: string) {
  const cursor = session.rebuildRuntimeState().presentation_cursor;
  if (cursor.status !== "awaiting_browser") throw new Error(`expected delivery, got ${cursor.status}`);
  return { sequence_id: cursor.sequence_id, ordinal: cursor.ordinal, action_id: cursor.action_id, outcome: "presented" as const, client_request_id: key };
}
function fragments(session: TutorSessionOrchestratorV7) { return studentWorkspaceViewV2Schema.parse(session.snapshot().views.studentWorkspaceView).solution_board.fragments ?? []; }
function planned(session: TutorSessionOrchestratorV7) { return session.events.filter(e => e.event_type === "presentation_sequence_planned"); }

describe("FM-9 real persisted dynamic Board integrity", () => {
  it("SQL ABORT inside planned insert atomically removes sequence, body and generation commit", async () => {
    const { session, presenter, sessionId } = setup();
    let plannedInsertSeen = 0;
    db.function("final_board_fault_seen", () => ++plannedInsertSeen);
    db.exec(`CREATE TEMP TRIGGER final_board_abort AFTER INSERT ON tutor_session_events WHEN NEW.session_id = '${sessionId}' AND NEW.event_type = 'presentation_sequence_planned' BEGIN SELECT final_board_fault_seen(); SELECT RAISE(ABORT, 'final-board-planned-abort'); END`);
    try { await session.drivePendingGeneration().catch(() => undefined); }
    finally { db.exec("DROP TRIGGER final_board_abort"); }
    expect(presenter.calls).toBe(1);
    expect(plannedInsertSeen).toBeGreaterThan(0);
    const rows = db.prepare("SELECT event_type, payload_json FROM tutor_session_events WHERE session_id = ? ORDER BY sequence").all(sessionId) as Array<{event_type: string; payload_json: string}>;
    expect(rows.some(r => ["presentation_sequence_planned", "presentation_generation_committed", "presentation_action_applied", "presentation_action_delivered"].includes(r.event_type))).toBe(false);
    expect(rows.some(r => Object.hasOwn(JSON.parse(r.payload_json), "explanation_fragments"))).toBe(false);
    expect(planned(session)).toHaveLength(0);
    expect(fragments(session)).toEqual([]);
    expect(session.workspaceFold().state.solution_board).not.toHaveProperty("explanation_fragments.0");
  });

  for (const fault of ["tampered", "missing"] as const) it(`persisted ${fault} fragment rejects real resume against its committed reference without regeneration`, async () => {
    const { session, presenter, sessionId, resume } = setup();
    expect((await session.drivePendingGeneration()).kind).toBe("committed");
    session.reportPresentationOutcome(receipt(session, `voice-${fault}`));
    const original = planned(session)[0];
    // A persisted recovery reference supplies an independent committed content hash.
    // Without that reference, arbitrary valid text changes in the sole source event
    // are outside the stream's detectable integrity boundary (not a false hash promise).
    if (fault === "tampered") {
      session.reportPresentationOutcome({ ...receipt(session, "tamper-failed"), outcome: "failed", failure_class: "provider_failure" });
      await session.submitStudentInput({ input: { kind: "control", command: "retry_recovery" }, client_request_id: "tamper-recovery" }, {});
      expect(planned(session)).toHaveLength(2);
      expect((planned(session)[1].payload as { existing_fragment_refs?: unknown[] }).existing_fragment_refs).toHaveLength(1);
    }
    expect(() => resume()).not.toThrow();
    const row = db.prepare("SELECT payload_json FROM tutor_session_events WHERE session_id = ? AND sequence = ?").get(sessionId, original.sequence) as {payload_json: string};
    const payload = JSON.parse(row.payload_json);
    if (fault === "tampered") payload.explanation_fragments[0].content = "corrupted persisted body";
    else delete payload.explanation_fragments;
    db.prepare("UPDATE tutor_session_events SET payload_json = ? WHERE session_id = ? AND sequence = ?").run(JSON.stringify(payload), sessionId, original.sequence);
    const count = session.events.length;
    expect(() => resume()).toThrow(/corrupt|mismatch|hash|fragment|persist|replay|invalid|exact committed suffix/i);
    expect(presenter.calls).toBe(1);
    expect(session.events).toHaveLength(count);
  });

  it("undelivered tail permission failure retains prior Board effect and has legal system recovery", async () => {
    const { session, presenter, resume } = setup(true);
    expect((await session.drivePendingGeneration()).kind).toBe("committed");
    const visible = fragments(session);
    expect(visible).toHaveLength(1);
    type Hook = { validateWorkspaceAction(sequence: unknown, fold: WorkspaceFold, ordinal: number): unknown };
    const hook = session as unknown as Hook;
    const validate = hook.validateWorkspaceAction.bind(session);
    // Only permission input is injected; the production validator and all writes remain real.
    hook.validateWorkspaceAction = (sequence, fold, ordinal) => {
      if (ordinal !== 2) return validate(sequence, fold, ordinal);
      const locked = structuredClone(fold); locked.state.geometry.interaction_mode = "locked";
      return validate(sequence, locked, ordinal);
    };
    let rejection: unknown;
    try { session.reportPresentationOutcome(receipt(session, "partial-first-presented")); session.reportPresentationOutcome(receipt(session, "partial-speech-presented")); } catch (error) { rejection = error; }
    finally { hook.validateWorkspaceAction = validate; }
    expect(fragments(session)).toEqual(visible);
    expect(session.events.filter(e => e.event_type === "presentation_action_outcome_recorded")).toHaveLength(2);
    expect(session.events.filter(e => e.event_type === "gate_evaluated")).toHaveLength(0);
    expect(session.events.filter(e => e.event_type === "runtime_failure")).toHaveLength(1);
    expect(session.events.filter(e => e.event_type === "presentation_action_applied" || e.event_type === "presentation_action_delivered")
      .some(e => (e.payload as { ordinal: number }).ordinal === 2)).toBe(false);
    expect(session.snapshot().views.status.last_failure?.event_type).toBe("runtime_failure");
    const countBeforeRestore = session.events.length;
    const restored = resume();
    expect(restored.events).toHaveLength(countBeforeRestore);
    expect(fragments(restored)).toEqual(visible);
    expect(restored.snapshot().views.status.last_failure?.event_type).toBe("runtime_failure");
    expect(rejection === undefined || /rejected|permission|locked/i.test(String(rejection))).toBe(true);
    expect(session.snapshot().views.status.last_failure).toMatchObject({category:"presentation_action_failure",event_type:"runtime_failure",failure_class:"internal_error"});
    const paused=structuredClone(session.events);expect(restored.events).toEqual(paused);
    await expect(restored.submitStudentInput({input:{kind:"utterance",channel:"mainline",text:"这一步听懂了"},client_request_id:"paused-normal-input"},{})).rejects.toThrow(/recovery/i);
    expect(restored.events).toEqual(paused);
    // The rejected tail was never delivered: do not manufacture a browser failed receipt.
    await session.submitStudentInput({ input: { kind: "control", command: "retry_recovery" }, client_request_id: "partial-retry" }, {});
    expect(planned(session)).toHaveLength(2);
    expect(fragments(session).some(f => f.fragment_id === visible[0].fragment_id && f.content === visible[0].content)).toBe(true);
    expect(presenter.calls).toBe(1);
    expect(session.snapshot().views.status.last_failure).toBeUndefined();
    expect(session.events.filter(e=>e.event_type==="presentation_action_outcome_recorded")).toHaveLength(2);
    expect(session.assertReplayParity().equal).toBe(true);
  });
});
