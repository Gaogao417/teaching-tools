import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { presentationPlanV4Schema, workspaceRuntimeStateV2Schema, studentWorkspaceViewV2Schema } from "../../../../../shared/canonical";
import { executeWorkspacePresentationV5 } from "../WorkspaceActionRuntimeV5";
import { applyWorkspaceV7Event, foldWorkspaceV7Events } from "../WorkspaceRuntimeReducerV7";
import { initialWorkspaceFold, type WorkspaceFold } from "../WorkspaceRuntimeReducerV5";
import { projectStudentWorkspaceViewV9 } from "../WorkspaceViewProjectorV5";
import { registerWorkspaceExplanationFragmentsV5, explanationFragmentContentHash } from "../WorkspaceExplanationFragmentsV5";
import { preflightPresentationSequence } from "../../tutorOrchestration/presentationGeneration/SequencePreflight";
import { wsTestCatalog, wsSessionStartedPayload, constructParallelJson } from "./workspaceKernelV5Support";
import { compareWorkspaceStatesSemantically } from "../WorkspaceStateRebuilderV5";
import type { StoredV7Event } from "../TutorSessionEventV7";

const fixture = JSON.parse(readFileSync("../shared/canonical/fixtures/tutor-session-event.v9.positive.planned-content.json", "utf8"));
const catalog = wsTestCatalog();
const session = fixture.session_id;
const decision = fixture.payload.decision_id;
function plan() {
  const payload = structuredClone(fixture.payload);
  payload.scope = { kind: "approved", protocol_id: "PR-SMV-001", beat_id: "BT-01" };
  payload.explanation_fragments[0].basis_refs = ["line-helper"];
  payload.actions[0] = { ordinal: 0, kind: "workspace", workspace_action: {
    action_id: "WSA-20260907-0001", decision_id: decision, origin: "tutor", surface: "geometry",
    capability: "geometry.construct", reveal_scope: "none",
    command_payload: constructParallelJson("D", "segment-BC", "line-helper"),
  } };
  return presentationPlanV4Schema.parse({ ...payload, schema: "ai_teaching_presentation_plan/v4", session_id: session });
}
function event(event_type: string, payload: unknown, sequence: number): StoredV7Event {
  // The production v9 rebuilder uses this same read-only workspace event adapter.
  return { schema: "ai_teaching_tutor_session_event/v9", session_id: session, sequence, event_type, payload } as unknown as StoredV7Event;
}
function startEvents() {
  return [event("session_started", wsSessionStartedPayload(), 1), event("policy_decision_made", {
    decision_id: decision, protocol_id: "PR-SMV-001", beat_id: "BT-01", decision_kind: "execute_beat",
  }, 2)];
}
function initial() { return foldWorkspaceV7Events(startEvents(), catalog); }
function planned(p = plan()) { const { schema: _schema, session_id: _session, ...payload } = p; return event("presentation_sequence_planned", payload, 3); }
function view(fold: WorkspaceFold) { return projectStudentWorkspaceViewV9(fold.state, catalog, { kind: "listen_only" }); }
function execute(fold: WorkspaceFold, action: ReturnType<typeof plan>["actions"][number]) {
  return executeWorkspacePresentationV5({ fold, catalog, action: {
    schema: "ai_teaching_workspace_surface_action/v1", session_id: session, ...action.workspace_action,
  } });
}

describe("S2 dynamic board execution and reconstruction", () => {
  it("construct → dynamic explanation → event reconstruction preserves state and student-safe View", () => {
    const p = plan(); const before = initial(); const snapshot = structuredClone(before);
    expect(preflightPresentationSequence({ fold: before, catalog, plan: p }).resultingWorkspaceRevision).toBe(2);
    expect(before).toEqual(snapshot);
    const events = [...startEvents(), planned(p)];
    let folded = foldWorkspaceV7Events(events, catalog);
    expect(workspaceRuntimeStateV2Schema.parse(folded.state).solution_board.explanation_fragments?.[0].visible).toBe(false);
    expect(view(folded).solution_board.fragments).toEqual([]);
    expect(folded.state.revision).toBe(0);
    for (const action of p.actions) {
      const execution = execute(folded, action);
      expect(execution.status).toBe("completed");
      if (execution.status !== "completed") throw new Error(execution.reason);
      const applied = event("presentation_action_applied", { sequence_id: p.sequence_id,
        ordinal: action.ordinal, action_id: action.workspace_action!.action_id, kind: "workspace",
        resulting_workspace_revision: execution.resultingRevision }, events.length + 1);
      events.push(applied);
      folded = applyWorkspaceV7Event(folded, applied, catalog);
      expect(folded.state).toEqual(execution.nextFold.state);
      if (action.ordinal === 0) expect(view(folded).solution_board.fragments).toEqual([]);
    }
    const projected = studentWorkspaceViewV2Schema.parse(view(folded));
    expect(projected.canvas.elements.some((e) => e.element_id === "line-helper")).toBe(true);
    expect(projected.solution_board.fragments?.[0].content).toBe(p.explanation_fragments![0].content);
    expect(projected.solution_board.fragments?.[0]).not.toHaveProperty("origin_generation");
    // No generator or external service participates in either fresh reconstruction.
    for (let i = 0; i < 2; i++) {
      const rebuilt = foldWorkspaceV7Events(structuredClone(events), catalog);
      expect(compareWorkspaceStatesSemantically(folded.state, rebuilt.state).equal).toBe(true);
      expect(view(rebuilt)).toEqual(projected);
      expect(rebuilt.context.tutorCommands).toEqual(folded.context.tutorCommands);
    }
  });

  it("reversed dependency rejects whole preflight without changing the real fold", () => {
    const p = plan(); p.actions.reverse().forEach((a, ordinal) => { a.ordinal = ordinal; });
    const before = initial(); const snapshot = structuredClone(before);
    expect(() => preflightPresentationSequence({ fold: before, catalog, plan: p })).toThrow(/dependency/);
    expect(before).toEqual(snapshot);
  });

  it("missing persisted body and mismatched applied revision fail closed", () => {
    const p = plan();
    expect(execute(initial(), p.actions[1])).toMatchObject({ status: "rejected", reason: expect.stringMatching(/missing persisted/) });
    const folded = foldWorkspaceV7Events([...startEvents(), planned()], catalog);
    expect(() => applyWorkspaceV7Event(folded, event("presentation_action_applied", {
      sequence_id: p.sequence_id, ordinal: 0, action_id: p.actions[0].workspace_action!.action_id,
      kind: "workspace", resulting_workspace_revision: 0,
    }, 4), catalog)).toThrow(/revision/);
  });

  it("delivery and failed/interrupted/presented outcome do not make planned fragments visible", () => {
    for (const outcome of ["failed", "interrupted", "presented"]) {
      const folded = foldWorkspaceV7Events([...startEvents(), planned(),
        event("presentation_action_delivered", {}, 4), event("presentation_action_outcome_recorded", { outcome }, 5)], catalog);
      expect(view(folded).solution_board.fragments).toEqual([]);
      expect(folded.state.revision).toBe(0);
    }
  });

  it("retry references committed content without replacement; missing/hash-mismatched/redefined content rejects", () => {
    const p = plan(); const folded = foldWorkspaceV7Events([...startEvents(), planned()], catalog);
    const fragment = p.explanation_fragments![0];
    const retry = { sequence_id: "PS-0005", existing_fragment_refs: [{ fragment_id: fragment.fragment_id,
      source_sequence_id: p.sequence_id, content_hash: explanationFragmentContentHash(fragment) }] };
    expect(registerWorkspaceExplanationFragmentsV5(folded, retry)).toEqual(folded);
    expect(() => registerWorkspaceExplanationFragmentsV5(initial(), retry)).toThrow(/missing or corrupt/);
    expect(() => registerWorkspaceExplanationFragmentsV5(folded, { ...retry, existing_fragment_refs: [
      { ...retry.existing_fragment_refs[0], content_hash: `sha256:${"0".repeat(64)}` },
    ] })).toThrow(/missing or corrupt/);
    expect(() => registerWorkspaceExplanationFragmentsV5(folded, { ...p, sequence_id: "PS-0005" })).toThrow(/duplicate immutable/);
  });

  it("fresh content cannot authorize final answers, and runtime permission is checked again", () => {
    const p = plan(); p.explanation_fragments![0].basis_refs = ["BE-04"];
    p.explanation_fragments![0].attach_to_entry = "BE-04";
    const folded = registerWorkspaceExplanationFragmentsV5(initial(), p);
    expect(execute(folded, p.actions[1]).status).toBe("rejected");
    const ordinary = plan(); ordinary.explanation_fragments![0].basis_refs = ["RES1"];
    const ready = registerWorkspaceExplanationFragmentsV5(initial(), ordinary);
    expect(execute(ready, ordinary.actions[1]).status).toBe("completed");
    const locked = structuredClone(ready); locked.state.geometry.interaction_mode = "locked";
    expect(execute(locked, ordinary.actions[1]).status).toBe("rejected");
    ordinary.actions[1].workspace_action!.presentation_only = true;
    expect(execute(ready, ordinary.actions[1])).toMatchObject({ status: "rejected", reason: expect.stringMatching(/hidden fragment/) });
    expect(view(ready).solution_board.fragments).toEqual([]);
  });

  it("semantic comparison detects body and visibility drift", () => {
    const folded = registerWorkspaceExplanationFragmentsV5(initial(), plan());
    const altered = structuredClone(folded);
    if (altered.state.schema !== "ai_teaching_workspace_runtime_state/v2") throw new Error("v2 required");
    altered.state.solution_board.explanation_fragments![0].content = "tampered";
    expect(compareWorkspaceStatesSemantically(folded.state, altered.state).equal).toBe(false);
  });

  it("v1 static workspace remains a v1 state", () => {
    expect(initialWorkspaceFold(session, catalog).state.schema).toBe("ai_teaching_workspace_runtime_state/v1");
  });
});
