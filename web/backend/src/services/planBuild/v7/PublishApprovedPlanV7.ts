import { validatePlanV7WorkspaceBindings } from "./ValidatePlanV7WorkspaceBindings";
import { materializeTutorPlanV5 } from "../v5/MaterializeTutorPlanV5";
import type { WorkspacePresentationCatalogV5 } from "../../tutorSession/WorkspacePresentationCatalogV5";
/** Publication requires an externally reviewed Approved payload and its exact reviewed hash. */
import { validateApprovedPlanV5, type MaterializationV5Inputs } from "../v5/MaterializeTutorPlanV5";
import { canonicalHash, type TutorPlanV5Payload } from "../canonicalInputs";
import { publishApprovedPlanV4 } from "../v4/PublishApprovedPlanV4";
export function publishApprovedPlanV7(root: string, plan: TutorPlanV5Payload, inputs: MaterializationV5Inputs,
  reviewedContentHash: string, options: { dryRun?: boolean; workspaceCatalog?: WorkspacePresentationCatalogV5 } = {}) {
  if (plan.schema !== "ai_teaching_tutor_plan_bundle/v7" || plan.content_hash !== reviewedContentHash
    || canonicalHash(plan as unknown as Record<string, unknown>, "plan") !== reviewedContentHash) {
    return { ok: false as const, errors: ["v7 publication requires the exact reviewed content_hash"] };
  }
  const checked = validateApprovedPlanV5(plan, inputs);
  if (!checked.ok) return checked;
  const materialized = materializeTutorPlanV5(plan, inputs);
  if (!materialized.ok) return materialized;
  try {
    const errors = validatePlanV7WorkspaceBindings({ ...inputs, plan, projection: materialized.projection,
      projection_hash: materialized.projection_hash, materializer_version: "v7-publication-validation",
      runtime_registry_version: inputs.snapshot.runtime_registry_version }, options.workspaceCatalog);
    if (errors.length) return { ok: false as const, errors };
  } catch (error) { return { ok: false as const, errors: [String(error)] }; }
  return publishApprovedPlanV4(root, "tutor-plan", plan as unknown as Parameters<typeof publishApprovedPlanV4>[2], options);
}
