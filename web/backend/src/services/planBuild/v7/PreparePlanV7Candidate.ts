import { validatePlanV7WorkspaceBindings } from "./ValidatePlanV7WorkspaceBindings";
/** Explicit review-only derivation. Never grants approval or updates registries. */
import { canonicalHash, type TutorPlanV5Payload, type CanonicalRegistries } from "../canonicalInputs";
import { importApprovedPlanV5 } from "../v5/ImportApprovedPlanV5";
import { validateApprovedPlanV5 } from "../v5/MaterializeTutorPlanV5";
import { buildRuntimeRegistrySnapshot } from "../RuntimeRegistrySnapshot";

export function preparePlanV7Candidate(deps: CanonicalRegistries, tpId: string, version: string,
  bindings: NonNullable<TutorPlanV5Payload["resource_bindings"]>, builtAt: string) {
  const loaded = importApprovedPlanV5(deps, tpId);
  if (!loaded.ok) throw new Error(loaded.errors.join("; "));
  const source = loaded.imported;
  if (source.plan.schema !== "ai_teaching_tutor_plan_bundle/v5") throw new Error("candidate source must be Approved v5");
  if (!/^v[1-9][0-9]*$/.test(version) || Number(version.slice(1)) <= Number(source.plan.version.slice(1))) throw new Error("candidate must use a newer version");
  const candidate = structuredClone(source.plan);
  candidate.schema = "ai_teaching_tutor_plan_bundle/v7";
  candidate.version = version;
  candidate.status = "Draft";
  delete candidate.approval;
  delete (candidate as unknown as Record<string, unknown>).runtime_projection;
  candidate.artifact_uri = `artifact://tutor-plan/${tpId}@${version}`;
  candidate.resource_bindings = structuredClone(bindings);
  candidate.build_provenance = { ...candidate.build_provenance, provider: "deterministic-rules", model_id: "none",
    workflow_version: "prepare-plan-v7-candidate/1", run_id: `candidate-${tpId}-${version}`, built_at: builtAt };
  candidate.content_hash = canonicalHash(candidate as unknown as Record<string, unknown>, "plan");
  const checked = validateApprovedPlanV5(candidate, { ...source, snapshot: buildRuntimeRegistrySnapshot() }, { requireApproved: false });
  if (!checked.ok) throw new Error(checked.errors.join("; "));
  const bindingErrors = validatePlanV7WorkspaceBindings({ ...source, plan: candidate });
  if (bindingErrors.length) throw new Error(bindingErrors.join("; "));
  return { candidate, review: { status: "PENDING_HUMAN_REVIEW", source: { artifact_id: tpId, version: source.plan.version,
    content_hash: source.plan.content_hash }, candidate_hash: candidate.content_hash,
    note: "No approval inherited. Review this exact content_hash before publication; no registry was modified." } };
}
