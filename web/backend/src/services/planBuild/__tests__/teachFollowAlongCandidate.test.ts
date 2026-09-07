/** C1 real source → joint Draft → synthetic-only publication → actual importer.
 * Synthetic approval exists only in a fresh disposable copy; never in delivered candidates.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSyntheticFollowAlongRoot } from "./teachFollowAlongTestSupport";
import { canonicalHash, type TeachingProtocolV2Payload } from "../canonicalInputs";
import { importApprovedPlanV5 } from "../v5/ImportApprovedPlanV5";
import { prepareTeachFollowAlongCandidate, validateTeachFollowAlongCandidate, type TeachFollowAlongCandidate } from "../c1/PrepareTeachFollowAlongCandidate";

const root = resolve(process.env.AI_TEACHING_CANONICAL_ROOT ?? "../../../teaching-skills-mvp/artifacts/canonical-authoring");
const loaded = importApprovedPlanV5({ canonicalRoot: root }, "TP-SMV-009");
assert.ok(loaded.ok, loaded.ok ? "" : loaded.errors.join("; "));
const source = loaded.imported;
const originalJson = JSON.stringify(source.plan);
const prepared = prepareTeachFollowAlongCandidate({ canonicalRoot: root }, "2026-09-07T12:00:00Z");
assert.deepEqual(validateTeachFollowAlongCandidate(prepared.candidate, source), []);
assert.equal(JSON.stringify(source.plan), originalJson);
assert.equal(source.plan.schema, "ai_teaching_tutor_plan_bundle/v5");
for (const p of source.protocols.values()) {
  assert.equal(p.schema, "ai_teaching_teaching_protocol/v2");
  assert.ok(p.beats.every(b => b.completion_evidence.confirmation_target === undefined));
}
for (const chunk of source.projection.chunks) for (const p of chunk.protocols) {
  assert.equal(p.schema, undefined);
  assert.ok(p.beats.every(b => b.completion_evidence === undefined), "historical v2 projection unchanged");
}
console.log("PASS historical v2 remains unmarked and unmodified");

for (const artifact of [prepared.candidate.plan, ...prepared.candidate.protocols]) {
  assert.equal(artifact.status, "Draft"); assert.equal(artifact.approval, undefined);
}
assert.equal(prepared.candidate.plan.version, "v13");
assert.equal(prepared.review.release_ready, false);
assert.notEqual(prepared.candidate.plan.content_hash, source.plan.content_hash);
assert.equal(prepared.review.preserved_practice.resource?.resource_id, "RES8");
assert.equal(prepared.review.preserved_practice.evidence_requirements.find(x => x.beat_id === "BT-04")?.completion_evidence.evidence_kind, "workspace_command");
assert.equal(prepared.candidate.plan.resources.some(r => r.resource_id === "RES8"), false);
for (const p of prepared.candidate.protocols) for (const beat of p.beats) {
  assert.equal(p.schema, "ai_teaching_teaching_protocol/v3");
  assert.equal(beat.completion_evidence.confirmation_target, "follow_along");
  assert.equal(beat.completion_evidence.evidence_kind, "student_confirmation");
  assert.equal(beat.completion_evidence.gate?.capability, undefined);
  assert.equal(beat.participation, "confirm");
  assert.ok(beat.presentation_intent.voice.includes("narrate"));
  assert.equal(beat.support_boundary.may_reveal_answer, false);
}
const mainline = prepared.candidate.protocols.find(p => p.protocol_kind === "mainline")!;
assert.equal(mainline.beats.find(b => b.beat_id === "BT-05")!.completion_evidence.gate!.graph_fact_id, "FN-23");
assert.equal(prepared.candidate.plan.resource_bindings!.some(b => b.binding_kind === "board"), false);
for (const resource of prepared.candidate.plan.resources.filter(r => /^RES[1-6]$/.test(r.resource_id))) {
  assert.equal(resource.kind, "voice_seed");
  assert.notEqual(resource.content, source.plan.resources.find(r => r.resource_id === resource.resource_id)!.content);
}
const inquiry = prepared.candidate.protocols.find(p => p.protocol_id === "PR-SMV-002")!;
assert.equal(inquiry.beats.length, 1);
assert.equal(inquiry.entry_beat_id, inquiry.beats[0].beat_id);
assert.deepEqual(inquiry.beats[0].transitions, [{ to_beat: inquiry.entry_beat_id, on: "evidence_collected" }]);
assert.equal(prepared.review.inquiry_revision.source_diagnostic_beats.length, 4);
for (const [index, original] of source.protocols.get("PR-SMV-002")!.beats.entries()) {
  const resource = prepared.candidate.plan.resources.find(r => r.resource_id === `RES${index + 9}`)!;
  assert.equal(resource.kind, "diagnostic_probe");
  assert.deepEqual(resource.solution_refs, original.solution_refs);
  assert.ok(resource.content?.includes(original.purpose));
  assert.ok(resource.content?.includes("不是必过步骤"));
  assert.ok(inquiry.beats[0].resource_ids!.includes(resource.resource_id));
}
for (const beat of mainline.beats) {
  const original = source.protocols.get("PR-SMV-001")!.beats.find(b => b.beat_id === beat.beat_id)!;
  assert.equal(beat.inquiry_branch?.return_beat_id, original.inquiry_branch?.return_beat_id);
  assert.equal(beat.inquiry_branch?.expand_region_id, original.inquiry_branch?.expand_region_id);
}
console.log("PASS joint C1 Draft has seven marked confirmation Beats, no mandatory RES8, and separate original practice requirements");

function reject(label: string, mutate: (candidate: TeachFollowAlongCandidate) => void) {
  const changed = structuredClone(prepared.candidate); mutate(changed);
  for (const p of changed.protocols) p.content_hash = canonicalHash(p as unknown as Record<string, unknown>, "authoring");
  // Rebind candidate graph after intentional edits: test semantics, not just stale hash detection.
  const refs = new Map(changed.protocols.map(p => [p.protocol_id, { artifact_id: p.protocol_id, version: p.version, content_hash: p.content_hash }]));
  for (const chunk of changed.plan.chunks) chunk.protocol_refs = chunk.protocol_refs.map(r => refs.get(r.artifact_id) ?? r);
  changed.plan.content_hash = canonicalHash(changed.plan as unknown as Record<string, unknown>, "plan");
  assert.ok(validateTeachFollowAlongCandidate(changed, source).length > 0, label);
  console.log(`PASS rejects ${label}`);
}
reject("follow_along with practice role", c => { c.protocols.find(p => p.protocol_kind === "mainline")!.beats[2].role = "practice"; });
reject("follow_along with workspace evidence", c => { c.protocols.find(p => p.protocol_kind === "mainline")!.beats[3].completion_evidence.evidence_kind = "workspace_command"; });
reject("missing confirmation target", c => { delete c.protocols.find(p => p.protocol_kind === "mainline")!.beats[0].completion_evidence.confirmation_target; });
reject("mandatory practice resource leaks into Teach", c => { c.plan.resources.push(structuredClone(source.plan.resources.find(r => r.resource_id === "RES8")!)); });
reject("stale inquiry reference", c => { c.protocols.find(p => p.protocol_kind === "mainline")!.beats[0].inquiry_branch!.inquiry_protocol_ref.version = "v9"; });
reject("unknown binding target", c => { const b = c.plan.resource_bindings![0]; if (b.binding_kind === "geometry") b.geometry_target = "unknown-C1-point"; });
reject("sequential inquiry confirmations", c => { c.protocols.find(p => p.protocol_id === "PR-SMV-002")!.beats.push(structuredClone(inquiry.beats[0])); });
reject("changed inquiry return anchor", c => { c.protocols.find(p => p.protocol_kind === "mainline")!.beats[0].inquiry_branch!.return_beat_id = "BT-02"; });
reject("withdrawn v12", c => { c.plan.version = "v12"; });

const { root: temp, cleanup } = createSyntheticFollowAlongRoot();
try {
  const plan = prepared.candidate.plan;
  const imported = importApprovedPlanV5({ canonicalRoot: temp }, plan.artifact_id);
  assert.ok(imported.ok, imported.ok ? "" : imported.errors.join("; "));
  assert.equal(imported.imported.plan.content_hash, prepared.candidate.plan.content_hash);
  assert.equal(imported.imported.protocols.get("PR-SMV-001")?.schema, "ai_teaching_teaching_protocol/v3");
  assert.equal(imported.imported.protocols.get("PR-SMV-002")?.version, "v10");
  for (const chunk of imported.imported.projection.chunks) for (const p of chunk.protocols) {
    assert.equal(p.schema, "ai_teaching_teaching_protocol/v3");
    assert.ok(p.beats.every(b => b.completion_evidence?.confirmation_target === "follow_along"));
  }
  console.log("PASS both PRs and TP jointly publish/import with exact hashes and confirmation target in projection (synthetic only)");
  const path = join(temp, "teaching-protocol/PR-SMV-001/v11.json");
  const tampered = JSON.parse(readFileSync(path, "utf8")) as TeachingProtocolV2Payload;
  tampered.beats[0].purpose += " changed";
  tampered.content_hash = canonicalHash(tampered as unknown as Record<string, unknown>, "authoring");
  writeFileSync(path, JSON.stringify(tampered));
  assert.equal(importApprovedPlanV5({ canonicalRoot: temp }, plan.artifact_id).ok, false);
  console.log("PASS v3 registry hash drift rejected");
} finally { cleanup(); }
