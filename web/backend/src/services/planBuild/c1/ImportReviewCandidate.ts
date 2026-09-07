/** Local review only. Never use as the production Approved importer.
 * The legacy ImportedApprovedPlanV5 shape is reused for dependency injection;
 * its name does NOT confer approval. TP/PR remain Draft, with no approval field.
 * This module reads only: it does not publish, rewrite assets, or create sessions.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { canonicalHash, type TeachingProtocolV2Payload, type TutorPlanV5Payload } from "../canonicalInputs";
import { importApprovedPlanV5, type ImportedApprovedPlanV5 } from "../v5/ImportApprovedPlanV5";
import { materializeTutorPlanV5, MATERIALIZER_V5_VERSION } from "../v5/MaterializeTutorPlanV5";
import { validatePlanV7WorkspaceBindings } from "../v7/ValidatePlanV7WorkspaceBindings";
import { buildRuntimeRegistrySnapshot } from "../RuntimeRegistrySnapshot";
import { C1_VERSIONS, validateTeachFollowAlongCandidate } from "./PrepareTeachFollowAlongCandidate";

export interface ImportReviewCandidateOptions {
  /** Real registry supplying Approved QT/AS/RG/PP and the audited original TP/PR. */
  readonly canonicalRoot: string;
  /** Explicit local directory containing the joint Draft files and review manifest. */
  readonly candidateDirectory: string;
}
export type ImportReviewCandidateResult =
  | { ok: true; imported: ImportedApprovedPlanV5; reviewContext: "draft-local-review" }
  | { ok: false; errors: string[] };

export function importReviewCandidate(options: ImportReviewCandidateOptions): ImportReviewCandidateResult {
  try {
    const directory = resolve(options.candidateDirectory);
    const read = (filename: string) => JSON.parse(readFileSync(join(directory, filename), "utf8"));
    const plan = read(`TP-SMV-009.${C1_VERSIONS.plan}.draft.json`) as TutorPlanV5Payload;
    const protocols = [
      read(`PR-SMV-002.${C1_VERSIONS.inquiry}.draft.json`),
      read(`PR-SMV-001.${C1_VERSIONS.mainline}.draft.json`),
    ] as TeachingProtocolV2Payload[];
    const manifest = read("review-manifest.json");
    const artifacts = [plan, ...protocols];
    const errors: string[] = [];
    for (const artifact of artifacts) {
      if (artifact.status !== "Draft" || Object.prototype.hasOwnProperty.call(artifact, "approval"))
        errors.push("review TP/PR must remain Draft with no approval field");
    }
    const pins = protocols.map(p => ({ artifact_id: p.protocol_id, version: p.version, content_hash: p.content_hash }));
    pins.push({ artifact_id: plan.artifact_id, version: plan.version, content_hash: plan.content_hash });
    // Version and identity are hash-excluded fields: bind them to the requested files too.
    const identities = [["PR-SMV-002", C1_VERSIONS.inquiry], ["PR-SMV-001", C1_VERSIONS.mainline], ["TP-SMV-009", C1_VERSIONS.plan]];
    pins.forEach((pin, i) => {
      if (pin.artifact_id !== identities[i][0] || pin.version !== identities[i][1]) errors.push("candidate identity/version differs from requested file");
    });
    for (const artifact of artifacts) {
      if (canonicalHash(artifact as unknown as Record<string, unknown>, artifact === plan ? "plan" : "authoring") !== artifact.content_hash)
        errors.push("candidate content_hash differs from actual payload");
    }
    if (!isDeepStrictEqual(pins, manifest.proposed_publish_order)) errors.push("review manifest candidate pins differ from actual files");
    if (manifest.status !== "DRAFT_NOT_APPROVED" || manifest.release_ready !== false) errors.push("review manifest must not claim approval/readiness");
    if (errors.length) return { ok: false, errors };

    const loaded = importApprovedPlanV5({ canonicalRoot: resolve(options.canonicalRoot) }, "TP-SMV-009");
    if (!loaded.ok) return loaded;
    const source = loaded.imported;
    const sourcePins = [
      { artifact_id: source.plan.artifact_id, version: source.plan.version, content_hash: source.plan.content_hash },
      ...["PR-SMV-001", "PR-SMV-002"].map(id => {
        const p = source.protocols.get(id)!;
        return { artifact_id: id, version: p.version, content_hash: p.content_hash };
      }),
      { artifact_id: source.graph.graph_id, version: source.graph.version, content_hash: source.graph.content_hash },
    ];
    if (!isDeepStrictEqual(sourcePins, manifest.source_refs)) return { ok: false, errors: ["review source pins differ from current Approved inputs; re-audit required"] };
    errors.push(...validateTeachFollowAlongCandidate({ plan, protocols }, source));
    if (errors.length) return { ok: false, errors };
    const snapshot = buildRuntimeRegistrySnapshot();
    const inputs = { ...source, protocols: new Map(protocols.map(p => [p.protocol_id, p])), snapshot };
    const materialized = materializeTutorPlanV5(plan, inputs, { requireApproved: false });
    if (!materialized.ok) return materialized;
    const imported: ImportedApprovedPlanV5 = {
      plan, truth: source.truth, approachSet: source.approachSet, graph: source.graph, profile: source.profile,
      protocols: inputs.protocols, projection: materialized.projection, projection_hash: materialized.projection_hash,
      materializer_version: MATERIALIZER_V5_VERSION, runtime_registry_version: snapshot.runtime_registry_version,
    };
    errors.push(...validatePlanV7WorkspaceBindings(imported));
    return errors.length ? { ok: false, errors } : { ok: true, imported, reviewContext: "draft-local-review" };
  } catch (error) {
    return { ok: false, errors: [`review candidate import failed: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
