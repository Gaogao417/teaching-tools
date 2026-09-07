/** Review loader tests: real source + real Draft, no synthetic approval or database. */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { importReviewCandidate } from "../c1/ImportReviewCandidate";
import { canonicalHash } from "../canonicalInputs";
import { importApprovedPlanV5 } from "../v5/ImportApprovedPlanV5";
import { materializeTutorPlanV5 } from "../v5/MaterializeTutorPlanV5";
import { buildRuntimeRegistrySnapshot } from "../RuntimeRegistrySnapshot";

const canonicalRoot = resolve(process.env.AI_TEACHING_CANONICAL_ROOT ?? "../../../teaching-skills-mvp/artifacts/canonical-authoring");
const candidateDirectory = resolve("src/services/planBuild/review/c1-teach-follow-along/candidate-v13-r3");
const before = new Map(readdirSync(candidateDirectory).map(f => [f, readFileSync(join(candidateDirectory, f), "utf8")]));
const loaded = importReviewCandidate({ canonicalRoot, candidateDirectory });
assert.ok(loaded.ok, loaded.ok ? "" : loaded.errors.join("; "));
assert.equal(loaded.reviewContext, "draft-local-review");
for (const artifact of [loaded.imported.plan, ...loaded.imported.protocols.values()]) {
  assert.equal(artifact.status, "Draft"); assert.equal(Object.hasOwn(artifact, "approval"), false);
}
assert.equal(loaded.imported.protocols.get("PR-SMV-002")!.beats.length, 1);
assert.equal(loaded.imported.protocols.get("PR-SMV-001")!.beats.length, 6);
assert.ok(loaded.imported.projection.chunks.flatMap(c => c.protocols).every(p => p.schema === "ai_teaching_teaching_protocol/v3"));
const again = importReviewCandidate({ canonicalRoot, candidateDirectory });
assert.ok(again.ok); assert.equal(again.imported.projection_hash, loaded.imported.projection_hash);
assert.equal(materializeTutorPlanV5(loaded.imported.plan, { ...loaded.imported, snapshot: buildRuntimeRegistrySnapshot() }).ok, false, "production materializer still refuses Draft");
const original = importApprovedPlanV5({ canonicalRoot }, "TP-SMV-009");
assert.ok(original.ok); assert.equal(original.imported.plan.version, "v11"); assert.equal(original.imported.plan.status, "Approved");
console.log("PASS real Draft review import/project without approval; production defaults remain Approved-only");

const temp = mkdtempSync(join(tmpdir(), "f7-review-candidate-"));
const tp = "TP-SMV-009.v13.draft.json", pr = "PR-SMV-001.v11.draft.json";
function reject(label: string, file: string, change: (payload: any) => void, rehashPlan = false) {
  const dir = join(temp, String(counter++)); cpSync(candidateDirectory, dir, { recursive: true });
  const payload = JSON.parse(readFileSync(join(dir, file), "utf8")); change(payload);
  if (rehashPlan) {
    payload.content_hash = canonicalHash(payload, "plan");
    const manifest = JSON.parse(readFileSync(join(dir, "review-manifest.json"), "utf8"));
    manifest.proposed_publish_order[2].content_hash = payload.content_hash;
    writeFileSync(join(dir, "review-manifest.json"), JSON.stringify(manifest));
  }
  writeFileSync(join(dir, file), JSON.stringify(payload));
  const result = importReviewCandidate({ canonicalRoot, candidateDirectory: dir });
  assert.equal(result.ok, false, label); console.log(`PASS rejects ${label}`);
  return result;
}
let counter = 0;
try {
  reject("stale source pin", "review-manifest.json", m => { m.source_refs[0].version = "v999"; });
  reject("wrong candidate pin", "review-manifest.json", m => { m.proposed_publish_order[0].content_hash = "sha256:" + "0".repeat(64); });
  reject("readiness claim", "review-manifest.json", m => { m.release_ready = true; });
  reject("Approved status", tp, p => { p.status = "Approved"; });
  reject("approval field even null", pr, p => { p.approval = null; });
  reject("content tamper", pr, p => { p.beats[0].purpose += " tampered"; });
  reject("version excluded from hash", pr, p => { p.version = "v99"; });
  reject("stale joint PR ref with valid TP hash", tp, p => { p.chunks[0].protocol_refs[0].content_hash = "sha256:" + "0".repeat(64); }, true);
  const badBinding = reject("invalid geometry with valid TP/manifest hashes", tp, p => { p.resource_bindings.find((b: any) => b.binding_kind === "geometry").geometry_target = "missing-target"; }, true);
  assert.ok(!badBinding.ok && badBinding.errors.some(e => /target|geometry|绑定/.test(e)));
  assert.equal(importReviewCandidate({ canonicalRoot, candidateDirectory: join(temp, "missing") }).ok, false);
  const malformed = join(temp, "malformed"); cpSync(candidateDirectory, malformed, { recursive: true });
  writeFileSync(join(malformed, tp), "null");
  assert.equal(importReviewCandidate({ canonicalRoot, candidateDirectory: malformed }).ok, false);
} finally { rmSync(temp, { recursive: true, force: true }); }
for (const [file, text] of before) assert.equal(readFileSync(join(candidateDirectory, file), "utf8"), text);
assert.deepEqual(readdirSync(candidateDirectory).sort(), [...before.keys()].sort());
console.log("PASS missing/malformed bundle fails closed; delivered Draft files unchanged");
