import assert from "node:assert/strict";
import { resolve } from "node:path";
import { importApprovedPlanV5 } from "../v5/ImportApprovedPlanV5";
import { prepareTeachFollowAlongCandidate, validateTeachFollowAlongCandidate } from "../c1/PrepareTeachFollowAlongCandidate";
import { auditTeachFollowAlongContexts } from "../c1/TeachFollowAlongContextAudit";
import { DEFAULT_CONTEXT_POLICY, PresentationContextError } from "../../tutorOrchestration/presentationGeneration/ContextBuilder";

const root = resolve(process.env.AI_TEACHING_CANONICAL_ROOT ?? "../../../teaching-skills-mvp/artifacts/canonical-authoring");
const loaded = importApprovedPlanV5({ canonicalRoot: root }, "TP-SMV-009");
assert.ok(loaded.ok, loaded.ok ? "" : loaded.errors.join("; "));
const source = loaded.imported;
const { candidate } = prepareTeachFollowAlongCandidate({ canonicalRoot: root }, "2026-09-07T12:00:00Z");
assert.deepEqual([DEFAULT_CONTEXT_POLICY.max_facts, DEFAULT_CONTEXT_POLICY.max_inferences, DEFAULT_CONTEXT_POLICY.max_total_chars], [14, 8, 4000]);
for (const beatId of ["BT-04", "BT-06"]) {
  const old = structuredClone(candidate);
  old.protocols.find(p => p.protocol_kind === "mainline")!.beats.find(b => b.beat_id === beatId)!.solution_refs = structuredClone(source.protocols.get("PR-SMV-001")!.beats.find(b => b.beat_id === beatId)!.solution_refs);
  assert.throws(() => auditTeachFollowAlongContexts(old, source), (e: unknown) => e instanceof PresentationContextError && e.kind === "CONTEXT_BUDGET_EXCEEDED");
  assert.ok(validateTeachFollowAlongCandidate(old, source).some(e => e.startsWith("candidate context:")));
}
const audits = auditTeachFollowAlongContexts(candidate, source);
assert.equal(audits.length, 7);
for (const audit of audits) {
  const beat = candidate.protocols.find(p => p.protocol_id === audit.protocol_id)!.beats.find(b => b.beat_id === audit.beat_id)!;
  assert.ok(audit.budget.facts <= 14 && audit.budget.inferences <= 8 && audit.budget.approx_chars <= 4000);
  assert.ok(beat.solution_refs.fact_ids.every(id => audit.context.selected_fact_ids.includes(id)));
  assert.ok(beat.solution_refs.inference_ids.every(id => audit.context.selected_inference_ids.includes(id)));
  for (const binding of candidate.plan.resource_bindings ?? []) if (binding.binding_kind === "explanation" && (beat.resource_ids ?? []).includes(binding.presentation_resource)) {
    assert.ok(binding.basis_refs.fact_ids.every(id => audit.context.selected_fact_ids.includes(id)));
    assert.ok(binding.basis_refs.inference_ids.every(id => audit.context.selected_inference_ids.includes(id)));
    assert.ok(audit.context.resource_ids.includes(binding.presentation_resource));
  }
  console.log(`PASS ${audit.protocol_id}/${audit.beat_id}: ${JSON.stringify(audit.budget)}`);
}
assert.ok(audits.find(a => a.protocol_id === "PR-SMV-001" && a.beat_id === "BT-05")!.context.selected_fact_ids.includes("FN-23"));
assert.deepEqual(candidate.plan.solution_regions, source.plan.solution_regions.map(r => ({ ...r, ...(r.local_protocol_refs ? { local_protocol_refs: candidate.plan.solution_regions.find(n => n.region_id === r.region_id)!.local_protocol_refs } : {}) })));
console.log("PASS old BT04/BT06 rejected; all seven candidate Beats retain core and explanation basis under unchanged production budgets");

const repairAudit = audits.find(a => a.protocol_id === "PR-SMV-002")!;
assert.equal(repairAudit.context_truncated, false, "all four optional diagnostic texts fit without losing context");
assert.ok(!repairAudit.context.selected_fact_ids.includes("FN-23"), "repair does not add final answer permissions");
const oldInquiry = source.protocols.get("PR-SMV-002")!;
const oldFacts = new Set(oldInquiry.beats.flatMap(b => b.solution_refs.fact_ids));
const oldInferences = new Set(oldInquiry.beats.flatMap(b => b.solution_refs.inference_ids));
assert.ok(repairAudit.context.selected_fact_ids.every(id => oldFacts.has(id)));
assert.ok(repairAudit.context.selected_inference_ids.every(id => oldInferences.has(id)));
assert.deepEqual([...repairAudit.context.resource_ids].sort(), ["RES10", "RES11", "RES12", "RES9"]);
