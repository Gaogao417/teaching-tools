import { VISUAL_CONTEXT_BUILDER_VERSION } from "./VisualPresentationTools";
import type { VisualBinding, VisualRequirement, VisualView, VisualActionKey } from "../../../../../shared/canonical/visualSchemas";
import { VisualBindingCatalog, visualScopeAllows } from "../../tutorSession/VisualBindingCatalog";
import { projectVisualView, type VisualViewAuthorization } from "../../tutorSession/VisualViewProjector";
import { visualHash, stableVisualJson, type WorkspaceVisualState } from "../../tutorSession/WorkspaceVisualReducer";
import { buildPresentationContext, PresentationContextError } from "./ContextBuilder";
export interface VisualPresentedEvidence { action: VisualActionKey; outcome: "presented" | "failed" | "interrupted"; event_sequence: number }
export interface ProjectedVisualContext { bindings: VisualBinding[]; requirements: VisualRequirement[]; already_presented: VisualView; chars: number }
export function projectVisualContext(input: {
  state: WorkspaceVisualState; catalog: VisualBindingCatalog; authorization: VisualViewAuthorization;
  requirements: readonly VisualRequirement[]; outcomes: readonly VisualPresentedEvidence[];
  sessionId: string; eventCutoff: number; availableChars: number;
}): ProjectedVisualContext {
  const confirmed = new Set(input.outcomes.filter(o => o.outcome === "presented" && o.event_sequence <= input.eventCutoff && o.action.session_id === input.sessionId).map(o => stableVisualJson(o.action)));
  const state = structuredClone(input.state);
  // Applied but unacknowledged leases are not historical visual coverage.
  for (const a of state.annotations) a.leases = a.leases.filter(l => confirmed.has(stableVisualJson(l.last_changed_by)));
  state.annotations = state.annotations.filter(a => a.leases.length);
  // Group focus has no per-replacement presented provenance in state. Do not
  // advertise it as historical coverage from opened_by (a later focus may be pending).
  for(const group of state.groups)group.focus=null;
  const already = projectVisualView(state, input.catalog, input.authorization);
  const scope = input.authorization.currentOwner.scope;
  const scopeAllows=input.authorization.scopeAllows??visualScopeAllows;
  const inquiry=scope.kind==="local"||input.authorization.inquiryScope!==undefined;
  const requirements = input.requirements.filter(r => scopeAllows(r.scope,scope)&&(!inquiry||input.authorization.revealAuthorized(input.catalog.get(r.binding_ref)))).map(r=>inquiry?{...r,scope,trigger:"clarify-reference" as const}:r);
  const ids = new Set(requirements.map(r => r.binding_ref));
  const bindings = input.catalog.list().filter(b => b.allowed_scopes.some(s => scopeAllows(s,scope)) && input.authorization.revealAuthorized(b));
  if ([...ids].some(id => !bindings.some(b => b.binding_id === id))) throw new PresentationContextError("CONTEXT_FORBIDDEN", "required visual binding is outside current authorization");
  const core = bindings.filter(b => ids.has(b.binding_id));
  const result = { bindings: core, requirements, already_presented: already };
  if (stableVisualJson(result).length > input.availableChars) throw new PresentationContextError("CONTEXT_BUDGET_EXCEEDED", "required visual context and real presented history exceed remaining shared budget");
  for (const b of bindings.filter(b => !ids.has(b.binding_id))) {
    if (stableVisualJson({ ...result, bindings: [...result.bindings, b] }).length <= input.availableChars) result.bindings.push(b);
  }
  return { ...result, chars: stableVisualJson(result).length };
}

/** One shared budget and digest: visual context cannot be appended after freezing. */
export function buildVisualPresentationContext(input: import("./ContextBuilder").ContextBuildInput,
  visual: Omit<Parameters<typeof projectVisualContext>[0], "availableChars" | "eventCutoff">): import("./ContextBuilder").BuiltPresentationContext & { visual: ProjectedVisualContext } {
  const base = buildPresentationContext(input);
  const projected = projectVisualContext({ ...visual,eventCutoff:input.eventCutoff,availableChars:input.policy.max_total_chars-base.budget.approx_chars });
  return { ...base, visual:projected, digest:visualHash({base:base.digest,visual:projected,builder:VISUAL_CONTEXT_BUILDER_VERSION}),
    budget:{...base.budget,approx_chars:base.budget.approx_chars+projected.chars} };
}
