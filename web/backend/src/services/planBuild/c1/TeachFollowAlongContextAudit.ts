/** Candidate-only runtime budget gate; uses the production policy without overrides. */
import { buildPresentationContext, DEFAULT_CONTEXT_POLICY } from "../../tutorOrchestration/presentationGeneration/ContextBuilder";
import type { TeachFollowAlongCandidate } from "./PrepareTeachFollowAlongCandidate";
import type { ImportedApprovedPlanV5 } from "../v5/ImportApprovedPlanV5";

export function auditTeachFollowAlongContexts(candidate: TeachFollowAlongCandidate, source: ImportedApprovedPlanV5) {
  const { plan } = candidate;
  return candidate.protocols.flatMap(protocol => protocol.beats.map(beat => {
    const bindings = (plan.resource_bindings ?? []).filter(b => b.binding_kind === "explanation" && (beat.resource_ids ?? []).includes(b.presentation_resource));
    const built = buildPresentationContext({
      planRef: { artifact_id: plan.artifact_id, version: plan.version, content_hash: plan.content_hash },
      graphRef: { artifact_id: source.graph.graph_id, version: source.graph.version, content_hash: source.graph.content_hash },
      graph: { facts: new Map(source.graph.facts.map(f => [f.fact_id, f])), inferences: new Map(source.graph.inferences.map(i => [i.inference_id, i])) },
      beat: { protocol_id: protocol.protocol_id, beat_id: beat.beat_id, graph_fact_refs: beat.solution_refs.fact_ids, inference_refs: beat.solution_refs.inference_ids, resource_ids: beat.resource_ids ?? [] },
      regionFineRefs: {
        fact_ids: [...new Set(bindings.flatMap(b => b.binding_kind === "explanation" ? b.basis_refs.fact_ids : []))],
        inference_ids: [...new Set(bindings.flatMap(b => b.binding_kind === "explanation" ? b.basis_refs.inference_ids : []))],
      },
      recentInputs: [], eventCutoff: 0, workspaceRevision: 0, currentRevision: 0,
      policy: DEFAULT_CONTEXT_POLICY, sessionMode: "teaching",
      resourceContent: id => plan.resources.find(r => r.resource_id === id)?.content,
    });
    return { protocol_id: protocol.protocol_id, beat_id: beat.beat_id, ...built };
  }));
}
