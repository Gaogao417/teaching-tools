import { visualBindingSchema } from "../../../../shared/canonical/visualSchemas";
/** Pure, pinned mathematical binding resolver. These are internal normalized inputs,
 * not a replacement for canonical validation at the import boundary. */
import type { VisualBinding, VisualOwner } from "../../../../shared/canonical/visualSchemas";
export type NormalizedVisualBinding = VisualBinding;
export type VisualForm = VisualBinding["allowed_forms"][number];
export type VisualLifetime = VisualBinding["max_lifetime"];
export type VisualRelation = VisualBinding["relation"];
export type VisualSegment = { endpoints: [string, string] };
export function visualScopeKey(scope: VisualOwner["scope"]): string {
  return scope.kind === "approved" ? `${scope.protocol_id}/${scope.beat_id}` : `${scope.inquiry_id}/${scope.local_protocol_id}/${scope.local_beat_id}`;
}
/** Local scopes inherit only their approved anchor's relation namespace. The
 * separate reveal/basis authorization still enforces the legal refinement slice. */
export function visualScopeAllows(approved:VisualOwner["scope"],current:VisualOwner["scope"]):boolean {
  return visualScopeKey(approved)===visualScopeKey(current)||current.kind==="local"&&approved.kind==="approved"&&approved.protocol_id===current.anchor.protocol_id&&approved.beat_id===current.anchor.beat_id;
}
export interface VisualBindingSource {
  planHash: string;
  bindings: readonly NormalizedVisualBinding[];
  approvedBasisRefs: ReadonlySet<string>;
  approvedScopes: ReadonlySet<string>;
  expressions: ReadonlyMap<string, string>;
  pointIds: ReadonlySet<string>;
  segments: ReadonlyMap<string, readonly [string, string]>;
  /** Construction binding -> its approved output point identities. */
  constructionOutputs: ReadonlyMap<string, readonly string[]>;
}
export class VisualBindingError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "VisualBindingError"; }
}
const fail = (message: string): never => { throw new VisualBindingError("INVALID_VISUAL_BINDING", message); };
export function visualRelationPoints(relation: VisualRelation, segments: ReadonlyMap<string, readonly [string, string]>): string[] {
  const endpoints = (id: string): string[] => { const result = segments.get(id); if (!result) fail(`unknown segment ${id}`); return [...result!]; };
  switch (relation.type) {
    case "angle-equality": return relation.angles.flatMap(a => [a.vertex, ...a.ray_points]);
    case "similarity": return [...relation.left, ...relation.right];
    case "segment-measure": return endpoints(relation.segment);
    case "directed-ratio": return [...endpoints(relation.numerator), ...endpoints(relation.denominator)];
  }
}
const compatible: Record<VisualRelation["type"], readonly VisualForm[]> = {
  "angle-equality": ["angle-arcs"], similarity: ["paired-sides", "triangle-outline"],
  "segment-measure": ["length-label"], "directed-ratio": ["ratio-label"],
};
const lifetimes: VisualLifetime[] = ["explanation-group", "teaching-scope", "problem-part"];
export class VisualBindingCatalog {
  readonly planHash: string;
  private readonly entries = new Map<string, NormalizedVisualBinding>();
  private readonly constructions: ReadonlyMap<string, readonly string[]>;
  private readonly segments: ReadonlyMap<string, readonly [string, string]>;
  private readonly expressions: ReadonlyMap<string, string>;
  constructor(source: VisualBindingSource) {
    if (!source.planHash) fail("missing plan pin");
    this.planHash = source.planHash;
    this.constructions = new Map([...source.constructionOutputs].map(([id, outputs]) => [id, [...outputs]]));
    this.segments = new Map([...source.segments].map(([id, pair]) => [id, [...pair] as [string, string]]));
    this.expressions = new Map(source.expressions);
    for (const original of source.bindings) {
      const b = visualBindingSchema.parse(original);
      if (this.entries.has(b.binding_id)) fail(`duplicate binding ${b.binding_id}`);
      if (!b.basis_refs.length || b.basis_refs.some(id => !source.approvedBasisRefs.has(id))) fail(`${b.binding_id}: unknown/unapproved basis`);
      if (!b.allowed_scopes.length || b.allowed_scopes.some(id => !source.approvedScopes.has(visualScopeKey(id)))) fail(`${b.binding_id}: unknown scope`);
      if (!b.allowed_forms.length || b.allowed_forms.some(f => !compatible[b.relation.type]?.includes(f))) fail(`${b.binding_id}: incompatible form`);
      if (!lifetimes.includes(b.max_lifetime)) fail(`${b.binding_id}: invalid lifetime`);
      const points = new Set(source.pointIds);
      for (const construction of b.required_constructions) {
        const outputs = source.constructionOutputs.get(construction);
        if (!outputs) fail(`${b.binding_id}: unknown construction ${construction}`);
        for (const point of outputs!) points.add(point);
      }
      if (visualRelationPoints(b.relation, this.segments).some(p => !points.has(p))) fail(`${b.binding_id}: unknown point or missing construction dependency`);
      const r = b.relation;
      const distinct = (ids: string[]) => { if (new Set(ids).size !== ids.length) fail(`${b.binding_id}: degenerate relation`); };
      if (r.type === "angle-equality") for (const a of r.angles) { distinct([a.vertex, ...a.ray_points]); if (a.sector !== "minor") fail("unsupported angle sector"); }
      if (r.type === "similarity") { distinct(r.left); distinct(r.right); }
      if (r.type === "segment-measure") distinct([...this.segments.get(r.segment)!]);
      if (r.type === "directed-ratio") { distinct([...this.segments.get(r.numerator)!]); distinct([...this.segments.get(r.denominator)!]); }
      if ("expression_ref" in r && (!b.basis_refs.includes(r.expression_ref) || !this.expressions.get(r.expression_ref)?.trim())) fail(`${b.binding_id}: unknown approved expression`);
      this.entries.set(b.binding_id, b);
    }
    for (const b of this.entries.values()) if (b.relation.type === "similarity") {
      for (const id of b.relation.proof_angle_bindings) if (this.entries.get(id)?.relation.type !== "angle-equality") fail(`${b.binding_id}: invalid angle proof ${id}`);
    }
  }
  constructionEntries(): [string, readonly string[]][] { return [...this.constructions].map(([id, outputs]) => [id, [...outputs]]); }
  list(): NormalizedVisualBinding[] { return [...this.entries.values()].map(b => structuredClone(b)); }
  get(id: string): NormalizedVisualBinding {
    const b = this.entries.get(id); if (!b) throw new VisualBindingError("UNKNOWN_VISUAL_BINDING", id);
    return structuredClone(b);
  }
  resolve(id: string, permission: {
    scope: VisualOwner["scope"]; pair_index?: 0 | 1 | 2; form?: VisualForm; lifetime?: VisualLifetime;
    completedConstructions: ReadonlySet<string>; existingPoints: ReadonlyMap<string, { x: number; y: number }>;
    scopeAllows?:typeof visualScopeAllows;
    inquiryScope?:VisualOwner["scope"];
    revealAuthorized: (binding: NormalizedVisualBinding) => boolean;
  }): { binding: NormalizedVisualBinding; points: string[]; targets: import("../../../../shared/canonical/visualSchemas").VisualAnnotation["resolved_targets"]; expression?: string } {
    const b = this.get(id);
    if (!b.allowed_scopes.some(s => (permission.scopeAllows??visualScopeAllows)(s, permission.scope)) || !permission.revealAuthorized(b)) throw new VisualBindingError("VISUAL_NOT_AUTHORIZED", id);
    if (permission.form && !b.allowed_forms.includes(permission.form)) throw new VisualBindingError("VISUAL_FORM_NOT_ALLOWED", id);
    if (permission.lifetime && (lifetimes.indexOf(permission.lifetime) < 0 || lifetimes.indexOf(permission.lifetime) > lifetimes.indexOf(b.max_lifetime)
      || (permission.scope.kind === "local" || permission.inquiryScope&&visualScopeKey(permission.inquiryScope)===visualScopeKey(permission.scope)) && permission.lifetime === "problem-part")) throw new VisualBindingError("VISUAL_LIFETIME_NOT_ALLOWED", id);
    if (b.required_constructions.some(c => !permission.completedConstructions.has(c))) throw new VisualBindingError("VISUAL_CONSTRUCTION_REQUIRED", id);
    const points = [...new Set(visualRelationPoints(b.relation, this.segments))];
    if (points.some(p => !permission.existingPoints.has(p))) throw new VisualBindingError("VISUAL_TARGET_MISSING", id);
    const checkTriangle = (ids: readonly string[]) => {
      const [a, b, c] = ids.map(p => permission.existingPoints.get(p)!);
      const cross = (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
      const scale = Math.hypot(b.x-a.x,b.y-a.y)*Math.hypot(c.x-a.x,c.y-a.y);
      if (!Number.isFinite(cross) || !Number.isFinite(scale) || scale === 0 || Math.abs(cross) <= scale * 1e-10) throw new VisualBindingError("VISUAL_DEGENERATE_TARGET", id);
    };
    if (b.relation.type === "angle-equality") for (const a of b.relation.angles) checkTriangle([a.vertex,...a.ray_points]);
    if (b.relation.type === "similarity") { checkTriangle(b.relation.left); checkTriangle(b.relation.right); }
    const segments = b.relation.type === "segment-measure" ? [b.relation.segment] : b.relation.type === "directed-ratio" ? [b.relation.numerator, b.relation.denominator] : [];
    return { binding: b, points, targets: { entity_ids: [...new Set([...points, ...segments])], ...(b.relation.type === "angle-equality" ? { angles: b.relation.angles } : {}), ...(b.relation.type === "similarity" ? { triangles: { left:b.relation.left,right:b.relation.right }, ...(permission.pair_index === undefined ? {} : { paired_sides:this.pairedSides(id,permission.pair_index) }) } : {}) }, ...("expression_ref" in b.relation ? { expression: this.expressions.get(b.relation.expression_ref)! } : {}) };
  }
  pairedSides(id: string, index: number): [VisualSegment, VisualSegment] {
    const b = this.get(id);
    if (b.relation.type !== "similarity" || !Number.isInteger(index) || index < 0 || index > 2) throw new VisualBindingError("INVALID_PAIR_INDEX", id);
    const next = (index + 1) % 3;
    return [{ endpoints: [b.relation.left[index], b.relation.left[next]] }, { endpoints: [b.relation.right[index], b.relation.right[next]] }];
  }
}
