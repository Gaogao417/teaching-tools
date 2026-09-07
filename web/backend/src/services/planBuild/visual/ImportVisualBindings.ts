import { tutorPlanBundleV8Schema, type VisualBinding, type VisualRequirement } from "../../../../../shared/canonical/visualSchemas";
import { VisualBindingCatalog, visualScopeKey } from "../../tutorSession/VisualBindingCatalog";
import type { ImportedApprovedPlanV5 } from "../v5/ImportApprovedPlanV5";
import type { WorkspacePresentationCatalogV5 } from "../../tutorSession/WorkspacePresentationCatalogV5";
/** Internal pinned catalog construction after the caller's full artifact-chain import.
 * Draft is admitted only through an explicit review context, never production default. */
export function importVisualBindings(input: { plan:unknown; imported:ImportedApprovedPlanV5; workspaceCatalog:WorkspacePresentationCatalogV5;
  reviewContext?:"draft-local-review" }): { catalog:VisualBindingCatalog; requirements:VisualRequirement[] } {
  const plan=tutorPlanBundleV8Schema.parse(input.plan);
  if(plan.status!=="Approved" && !(plan.status==="Draft" && input.reviewContext==="draft-local-review" && !plan.approval)) throw new Error("visual Plan requires Approved status or explicit isolated Draft review");
  if(plan.solution_graph_ref.content_hash!==input.imported.graph.content_hash) throw new Error("visual graph pin mismatch");
  const bindings=plan.resource_bindings.filter((b):b is VisualBinding=>b.binding_kind==="geometry_visual");
  const segments=new Map<string,readonly[string,string]>((input.workspaceCatalog.baseGeometry?.segments??[]).map(s=>[s.id,[s.from,s.to]]));
  const constructionOutputs=new Map<string,string[]>();
  const commands: {outputPointId?:string;outputLineId?:string;fromPointId?:string;toPointId?:string}[]=[];
  for(const resource of plan.resources) if(resource.kind==="workspace" && resource.content) {
    const parsed=JSON.parse(resource.content);commands.push(...(parsed.constructions??[]));
  }
  for(const c of commands) if(c.outputLineId && c.fromPointId && c.toPointId) segments.set(c.outputLineId,[c.fromPointId,c.toPointId]);
  for(const binding of plan.resource_bindings) if(binding.binding_kind==="geometry" && binding.allowed_template_ids.length) {
    const ids=binding.allowed_template_ids;
    if(ids.some(id=>!commands.some(c=>(c.outputPointId??c.outputLineId)===id))) throw new Error(`unknown visual construction output in ${binding.binding_id}`);
    constructionOutputs.set(binding.binding_id,[...ids]);
  }
  const facts=new Map(input.imported.graph.facts.map(f=>[f.fact_id,f]));
  const approvedBasisRefs=new Set([...facts.keys(),...input.imported.graph.inferences.map(i=>i.inference_id)]);
  for(const binding of bindings) for(const ref of binding.basis_refs) {
    const fact=facts.get(ref);
    if((fact?.reveals_answer || fact?.role==="goal") && binding.reveal_scope!=="final_result") throw new Error(`visual binding ${binding.binding_id} downgrades final truth`);
  }
  const catalog=new VisualBindingCatalog({planHash:plan.content_hash,bindings,approvedBasisRefs,
    approvedScopes:new Set([...input.imported.protocols.values()].flatMap(p=>p.beats.map(b=>visualScopeKey({kind:"approved",protocol_id:p.protocol_id,beat_id:b.beat_id})))),
    expressions:new Map(input.imported.graph.facts.map(f=>[f.fact_id,f.statement])),
    pointIds:new Set(input.workspaceCatalog.baseGeometry?.points.map(p=>p.id)??[]),segments,constructionOutputs});
  for(const r of plan.visual_requirements) {
    const b=catalog.get(r.binding_ref);
    if(!b.allowed_scopes.some(s=>visualScopeKey(s)===visualScopeKey(r.scope)) || r.required_pair_indices.length && b.relation.type!=="similarity") throw new Error("visual requirement scope/pair mismatch");
  }
  return {catalog,requirements:plan.visual_requirements};
}
