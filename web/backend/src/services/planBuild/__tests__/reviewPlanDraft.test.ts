/** Existing approved fixture exercises the generic validator; not new-question evidence. */
import assert from "node:assert/strict";
import { importApprovedPlanV5 } from "../v5/ImportApprovedPlanV5";
import { reviewPlanDraft } from "../authoring/ReviewPlanDraft";
import { canonicalHash } from "../canonicalInputs";

const root = process.env.AI_TEACHING_CANONICAL_ROOT;
assert.ok(root, "explicit canonical fixture root required; never silently skip");
const loaded = importApprovedPlanV5({ canonicalRoot: root }, "TP-SMV-009");
assert.ok(loaded.ok, loaded.ok ? "" : loaded.errors.join("; "));
if (!loaded.ok) throw new Error("fixture unavailable");
const candidate = { plan: structuredClone(loaded.imported.plan), protocols: [...loaded.imported.protocols.values()].map(p => structuredClone(p)) };
for (const value of [candidate.plan, ...candidate.protocols]) {
  value.status = "Draft";
  delete value.approval;
}
assert.equal(reviewPlanDraft(root, candidate).ok, true);
for (const mutation of ["approval", "hash", "stale", "duplicate", "missing_protocol"]) {
  const bad = structuredClone(candidate);
  if (mutation === "approval") bad.plan.status = "Approved";
  if (mutation === "hash") bad.plan.content_hash = "sha256:" + "0".repeat(64);
  if (mutation === "stale") {
    bad.plan.question_ref.version = "v999";
    bad.plan.content_hash = canonicalHash(bad.plan as unknown as Record<string, unknown>, "plan");
  }
  if (mutation === "duplicate") bad.protocols.push(structuredClone(bad.protocols[0]));
  if (mutation === "missing_protocol") bad.protocols.pop();
  assert.equal(reviewPlanDraft(root, bad).ok, false, mutation);
}
console.log("PASS generic draft materialization and 5 fail-closed cases");
