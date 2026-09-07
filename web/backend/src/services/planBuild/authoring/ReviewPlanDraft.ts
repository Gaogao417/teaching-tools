/** Generic local draft review. Uses canonical validators and the production materializer.
 * Does not import a current/golden Plan as a template or grant approval.
 */
import { validatePayload } from "../../../../../shared/canonical";
import {
  canonicalHash, loadApprovedTruth, loadApprovedSolutionGraph, loadApprovedApproachSet,
  loadApprovedApproach, loadApprovedPolicyProfile, type CanonicalRegistries,
  type TutorPlanV5Payload, type TeachingProtocolV2Payload,
} from "../canonicalInputs";
import { buildRuntimeRegistrySnapshot } from "../RuntimeRegistrySnapshot";
import { materializeTutorPlanV5, MATERIALIZER_V5_VERSION } from "../v5/MaterializeTutorPlanV5";
import { validatePlanV7WorkspaceBindings } from "../v7/ValidatePlanV7WorkspaceBindings";
import type { WorkspacePresentationCatalogV5 } from "../../tutorSession/WorkspacePresentationCatalogV5";

export function loadPlanAuthoringInputs(root: string, questionId: string, graphId: string, setId: string, profileId: string) {
  const deps: CanonicalRegistries = { canonicalRoot: root, anchored: true };
  const truth = loadApprovedTruth(deps, questionId);
  const graph = loadApprovedSolutionGraph(deps, graphId);
  const approachSet = loadApprovedApproachSet(deps, setId);
  const profile = loadApprovedPolicyProfile(deps, profileId);
  if (!truth.ok || !graph.ok || !approachSet.ok || !profile.ok) throw new Error(
    [truth, graph, approachSet, profile].flatMap(r => r.ok ? [] : r.errors).join("; "));
  for (const upstream of [graph.payload, approachSet.payload]) {
    const q = upstream.question_ref;
    if (q.artifact_id !== questionId || q.version !== truth.payload.version || q.content_hash !== truth.payload.content_hash)
      throw new Error("authoring input question binding mismatch");
  }
  const approaches = approachSet.payload.parts.map(part => {
    const loaded = loadApprovedApproach(deps, part.approach.artifact_id);
    if (!loaded.ok) throw new Error(loaded.errors.join("; "));
    if (loaded.payload.version !== part.approach.version || loaded.payload.content_hash !== part.approach.content_hash)
      throw new Error("ApproachSet refers to stale approach");
    const value = loaded.payload as unknown as Record<string, unknown>;
    const pin = value.solution_graph_ref as { artifact_id?: string; version?: string; content_hash?: string } | undefined;
    if (value.schema !== "ai_teaching_teaching_approach/v4" || !pin || pin.artifact_id !== graphId || pin.version !== graph.payload.version || pin.content_hash !== graph.payload.content_hash)
      throw new Error("generic Plan authoring requires current graph-aligned TA-v4");
    const q = loaded.payload.question_ref;
    if (q.artifact_id !== questionId || q.version !== truth.payload.version || q.content_hash !== truth.payload.content_hash || q.part_id !== part.part_id)
      throw new Error("approach question/part binding mismatch");
    return loaded.payload;
  });
  return { truth: truth.payload, graph: graph.payload, approachSet: approachSet.payload,
    profile: profile.payload, approaches, snapshot: buildRuntimeRegistrySnapshot() };
}

export function reviewPlanDraft(root: string, raw: unknown, catalog?: WorkspacePresentationCatalogV5) {
  try {
    if (!raw || typeof raw !== "object") throw new Error("candidate must be an object");
    const envelope = raw as { plan?: TutorPlanV5Payload; protocols?: TeachingProtocolV2Payload[] };
    if (!envelope.plan || !Array.isArray(envelope.protocols) || envelope.protocols.length === 0)
      throw new Error("plan and protocols required");
    const { plan, protocols } = envelope;
    const ids = new Set<string>();
    for (const candidate of [plan, ...protocols]) {
      const checked = validatePayload(candidate as unknown as Record<string, unknown>);
      if (!checked.ok) throw new Error(checked.errors.join("; "));
      if (candidate.status !== "Draft" || "approval" in candidate) throw new Error("all candidates must remain Draft without approval");
      const identity = "artifact_id" in candidate ? candidate.artifact_id : candidate.protocol_id;
      if (ids.has(identity)) throw new Error("duplicate candidate identity");
      ids.add(identity);
      if (candidate.content_hash !== canonicalHash(candidate as unknown as Record<string, unknown>, candidate === plan ? "plan" : "authoring"))
        throw new Error("candidate content hash mismatch");
    }
    if (plan.schema !== "ai_teaching_tutor_plan_bundle/v5" && plan.schema !== "ai_teaching_tutor_plan_bundle/v7")
      throw new Error("unsupported candidate Plan schema");
    const source = loadPlanAuthoringInputs(root, plan.question_ref.artifact_id, plan.solution_graph_ref.artifact_id,
      plan.approach_set_ref.artifact_id, plan.policy_profile_ref.artifact_id);
    const inputs = { ...source, protocols: new Map(protocols.map(p => [p.protocol_id, p])) };
    const materialized = materializeTutorPlanV5(plan, inputs, { requireApproved: false });
    if (!materialized.ok) return { ok: false as const, errors: materialized.errors };
    const imported = { ...inputs, plan, projection: materialized.projection,
      projection_hash: materialized.projection_hash, materializer_version: MATERIALIZER_V5_VERSION,
      runtime_registry_version: inputs.snapshot.runtime_registry_version };
    const errors = validatePlanV7WorkspaceBindings(imported, catalog);
    if (errors.length) return { ok: false as const, errors };
    return { ok: true as const, status: "PendingHumanReview", projection_hash: materialized.projection_hash,
      pins: [plan, ...protocols].map(a => ({ artifact_id: "artifact_id" in a ? a.artifact_id : a.protocol_id,
        version: a.version, content_hash: a.content_hash })),
      teacher_approved: false, published: false, browser_accepted: false };
  } catch (error) { return { ok: false as const, errors: [error instanceof Error ? error.message : String(error)] }; }
}
