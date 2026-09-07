/** TEST ONLY: real source copied to a fresh root, then synthetic-approved C1 TP/PRs.
 * Importing this module has no database/registry side effects. Call after the consuming
 * test has configured its own SQLite; cleanup owns only the returned temporary root.
 */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

export function createSyntheticFollowAlongRoot(): { root: string; cleanup: () => void } {
  // Lazy imports keep the consuming test's ensureSqlite-before-db discipline intact.
  const { importApprovedPlanV5 } = require("../v5/ImportApprovedPlanV5") as typeof import("../v5/ImportApprovedPlanV5");
  const { prepareTeachFollowAlongCandidate } = require("../c1/PrepareTeachFollowAlongCandidate") as typeof import("../c1/PrepareTeachFollowAlongCandidate");
  const { publishApprovedPlanV4 } = require("../v4/PublishApprovedPlanV4") as typeof import("../v4/PublishApprovedPlanV4");
  const { publishApprovedPlanV7 } = require("../v7/PublishApprovedPlanV7") as typeof import("../v7/PublishApprovedPlanV7");
  const { buildRuntimeRegistrySnapshot } = require("../RuntimeRegistrySnapshot") as typeof import("../RuntimeRegistrySnapshot");
  const sourceRoot = resolve(process.env.AI_TEACHING_CANONICAL_ROOT ?? "../../../teaching-skills-mvp/artifacts/canonical-authoring");
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
