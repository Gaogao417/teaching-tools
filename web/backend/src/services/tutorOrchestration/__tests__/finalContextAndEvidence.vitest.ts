/** NAV/C4 deterministic application-service boundaries. Synthetic course copy and
 * scripted semantic response are declared test inputs, not content/real-model approval. */
import { afterAll, describe, it, expect } from "vitest";
import { db } from "../../../db/database";
import { realCanonicalRoot } from "../../tutorNavigator/__tests__/navigatorSupport";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importApprovedPlanV5 } from "../../planBuild/v5/ImportApprovedPlanV5";
import { prepareTeachFollowAlongCandidate } from "../../planBuild/c1/PrepareTeachFollowAlongCandidate";
import { publishApprovedPlanV4 } from "../../planBuild/v4/PublishApprovedPlanV4";
import { publishApprovedPlanV7 } from "../../planBuild/v7/PublishApprovedPlanV7";
import { buildRuntimeRegistrySnapshot } from "../../planBuild/RuntimeRegistrySnapshot";
import { FixedResponseGateProvider } from "../../tutorNavigator/ModelGateAdjudicatorV5";
import { f6Model } from "./f6Support";
import { TutorSessionOrchestratorV7 } from "../TutorSessionOrchestratorV7";
import { DEFAULT_CONTEXT_POLICY, PresentationContextError } from "../presentationGeneration/ContextBuilder";
import type { PresenterGeneratorPort } from "../presentationGeneration/GeneratorPort";
import type { PresenterUserPayload } from "../presentationGeneration/PresenterPrompts";
const root = realCanonicalRoot();
let serial = 0;
const id = () => `TS-98${Date.now()}${++serial}`;
class Draft implements PresenterGeneratorPort {
  readonly provider = "scripted-final-context";
  readonly modelId = "final-context/v1";
  readonly pin = {provider:this.provider, model_id:this.modelId, prompt_version:"presenter-interleaved/v1", context_builder_version:"presentation-context-builder/v1",tool_catalog_version:"presentation-tool-catalog/v1"};
  calls = 0;
  payloads: PresenterUserPayload[] = [];
  async generatePresentationDraft(request: Parameters<PresenterGeneratorPort["generatePresentationDraft"]>[0]) {
    this.calls++; const payload=request.userPayload as PresenterUserPayload; this.payloads.push(structuredClone(payload));
    return {latencyMs:1,draft:{schema:"ai_teaching_presentation_draft/v2" as const,request_id:request.request_id,items:[{type:"speech" as const,text:"看清当前题设的依据。",basis_refs:[payload.allowed_knowledge[0].ref]}]}};
  }
}
function events(sessionId: string) { return db.prepare("SELECT event_type, payload_json FROM tutor_session_events WHERE session_id = ? ORDER BY sequence").all(sessionId) as Array<{event_type:string;payload_json:string}>; }
function start(sessionId:string, presenter:Draft) {
  const provider=new FixedResponseGateProvider([],"context-boundary");
  return TutorSessionOrchestratorV7.start({sessionId,studentId:"final-context",taskId:"goldenMinhangFold2020",canonicalRoot:root,model:f6Model(provider,"context-boundary"),presenter});
}
function restrictPolicy() {
  // Test changes versioned strategy inputs only; the real ContextBuilder validates
  // complete required groups and emits its own error. No mocked result/exception.
  const policy=DEFAULT_CONTEXT_POLICY as {policy_version:string;max_total_chars:number};
  const old={...policy}; policy.policy_version="context-policy/test-small";policy.max_total_chars=1;
  return ()=>Object.assign(policy,old);
}
const candidate=createSyntheticFollowAlongRoot();
afterAll(()=>candidate.cleanup());
describe("final NAV and non-understanding evidence boundaries",()=>{
  it("real context budget failure during start invokes no model and reserves no generation or passing Gate",()=>{
    const sessionId=id(), presenter=new Draft(), restore=restrictPolicy();
    try {
      expect(()=>start(sessionId,presenter)).toThrow(PresentationContextError);
      expect(presenter.calls).toBe(0);
      const stream=events(sessionId);
      expect(stream.some(e=>e.event_type==="presentation_generation_requested")).toBe(false);
      expect(stream.some(e=>e.event_type==="presentation_sequence_planned")).toBe(false);
      expect(stream.some(e=>e.event_type==="gate_evaluated")).toBe(false);
      expect(stream.some(e=>e.event_type==="beat_completed" || e.event_type==="session_completed")).toBe(false);
    } finally {restore();}
  });

  it("pending request keeps frozen context when policy changes; a new request observes the new budget",async()=>{
    const sessionId=id(), presenter=new Draft(), session=start(sessionId,presenter);
    const before=events(sessionId).find(e=>e.event_type==="presentation_generation_requested");
    expect(before).toBeDefined();
    const restore=restrictPolicy();
    try {
      expect(()=>start(id(),new Draft())).toThrow(PresentationContextError);
      expect((await session.drivePendingGeneration()).kind).toBe("committed");
      expect(presenter.calls).toBe(1);
      expect(events(sessionId).filter(e=>e.event_type==="presentation_generation_requested")).toEqual([before]);
      expect(presenter.payloads[0].allowed_knowledge.length).toBeGreaterThan(0);
      expect(session.rebuildRuntimeState().teaching_cursor.beat_id).toBe("BT-01");
    } finally {restore();}
  });

  it("raw natural skip request remains non-understanding through existing semantic response and replay",async()=>{
    // No skip control/intent is invented. The existing non-evidence response keeps
    // the request as raw text plus its semantic record; this does not prove a model
    // will classify all skip language correctly or implement a new skip navigation.
    const provider=new FixedResponseGateProvider([JSON.stringify({response_kind:"mixed_or_ambiguous",verdict:"not_applicable",reasoning_location:"unknown",grounding_refs:[],brief_reason:"Student requests skipping, not understanding."})],"scripted-skip");
    const session=TutorSessionOrchestratorV7.start({sessionId:id(),studentId:"final-skip",taskId:"goldenMinhangFold2020",canonicalRoot:candidate.root,model:f6Model(provider,"scripted-skip")});
    for(let n=0;n<30;n++) {
      const cursor=session.rebuildRuntimeState().presentation_cursor;
      if(cursor.status!=="awaiting_browser")break;
      session.reportPresentationOutcome({sequence_id:cursor.sequence_id,ordinal:cursor.ordinal,action_id:cursor.action_id,outcome:"presented",client_request_id:`skip-receipt-${n}`});
    }
    expect(session.rebuildRuntimeState().presentation_cursor.status).toBe("idle");
    const before=session.events.length;
    const request={input:{kind:"utterance" as const,channel:"mainline" as const,text:"这段我想先跳过，还没有听懂。"},client_request_id:"natural-skip"};
    await session.submitStudentInput(request,{});
    const added=session.events.slice(before);
    expect(provider.callCount).toBe(1);
    expect(provider.calls[0]).toContain(request.input.text);
    expect(added.some(e=>e.event_type==="student_input_recorded" && JSON.stringify(e.payload).includes(request.input.text))).toBe(true);
    expect(added.some(e=>e.event_type==="semantic_interpretation_recorded" && JSON.stringify(e.payload).includes("confirm:follow_along"))).toBe(false);
    expect(added.some(e=>e.event_type==="gate_evaluated" && (e.payload as {satisfied?:boolean}).satisfied)).toBe(false);
    expect(session.rebuildRuntimeState().teaching_cursor.beat_id).toBe("BT-01");
    const count=session.events.length;await session.submitStudentInput(request,{});
    expect(session.events).toHaveLength(count);expect(provider.callCount).toBe(1);
    expect(session.assertReplayParity().equal).toBe(true);
  });
});

// Same isolated candidate publication flow as teachFollowAlongTestSupport; static
// imports allow Vitest transform (the node:test helper uses lazy native require).
function createSyntheticFollowAlongRoot(): { root: string; cleanup: () => void } {
  // Lazy imports keep the consuming test's ensureSqlite-before-db discipline intact.
  const sourceRoot = realCanonicalRoot();
  const loaded = importApprovedPlanV5({ canonicalRoot: sourceRoot }, "TP-SMV-009");
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.errors.join("; "));
  const source = loaded.imported;
  const prepared = prepareTeachFollowAlongCandidate({ canonicalRoot: sourceRoot }, "2026-09-07T12:00:00Z");
  const root = mkdtempSync(join(tmpdir(), "f7-C1-SYNTHETIC-ONLY-"));
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  try {
    for (const ns of ["tutor-plan", "question-truth", "approach-set", "reviewed-solution-graph", "teaching-protocol", "tutor-policy-profile"]) {
      cpSync(join(sourceRoot, ns), join(root, ns), { recursive: true });
    }
    const plan = structuredClone(prepared.candidate.plan);
    const protocols = new Map(prepared.candidate.protocols.map(p => [p.protocol_id, structuredClone(p)]));
    const syntheticApproval = { reviewer_id: "SYNTHETIC-TEST-ONLY", approved_at: "2026-09-07T12:00:00Z", review_note: "Temporary chain test; not C1 human approval." };
    const inputs = { ...source, protocols, snapshot: buildRuntimeRegistrySnapshot() };
    assert.equal(publishApprovedPlanV7(root, plan, inputs, plan.content_hash).ok, false, "Draft is not publishable");
    // Publish inquiry → mainline → TP, all inside this disposable copy.
    for (const p of protocols.values()) {
      p.status = "Approved"; p.approval = syntheticApproval;
      const published = publishApprovedPlanV4(root, "teaching-protocol", p as unknown as Parameters<typeof publishApprovedPlanV4>[2]);
      assert.ok(published.ok, published.ok ? "" : published.errors.join("; "));
    }
    plan.status = "Approved"; plan.approval = syntheticApproval;
    const published = publishApprovedPlanV7(root, plan, inputs, plan.content_hash);
    assert.ok(published.ok, published.ok ? "" : published.errors.join("; "));
    const imported = importApprovedPlanV5({ canonicalRoot: root }, plan.artifact_id);
    assert.ok(imported.ok, imported.ok ? "" : imported.errors.join("; "));
    assert.equal(imported.imported.plan.content_hash, prepared.candidate.plan.content_hash);
    for (const p of protocols.values()) {
      assert.equal(imported.imported.protocols.get(p.protocol_id)?.content_hash, p.content_hash);
    }
    return { root, cleanup };
  } catch (error) { cleanup(); throw error; }
}
