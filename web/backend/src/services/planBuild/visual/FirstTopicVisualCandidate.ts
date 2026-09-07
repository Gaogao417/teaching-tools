import { tutorPlanBundleV7Schema } from "../../../../../shared/canonical";
import { tutorPlanBundleV8Schema } from "../../../../../shared/canonical/visualSchemas";
import { canonicalHash } from "../canonicalInputs";
/** Offline review candidate only. No registry mutation, approval or production publication. */
import { visualBindingSchema, visualRequirementSchema, type VisualBinding, type VisualRequirement } from "../../../../../shared/canonical/visualSchemas";
import type { GraphFactNode } from "../canonicalInputs";
export interface FirstTopicVisualCandidate { status: "Draft"; graph_hash: string; bindings: VisualBinding[]; visual_requirements: VisualRequirement[]; evidence: { binding_id:string; fact_id:string; approved_statement:string }[] }
const scope = (beat: number) => ({ kind: "approved" as const, protocol_id: "PR-SMV-001", beat_id: `BT-${String(beat).padStart(2,"0")}` });
const angle = (vertex:string, a:string, b:string) => ({ vertex, ray_points:[a,b] as [string,string], sector:"minor" as const });
/** The caller supplies the pinned graph and actual approved construction binding.
 * Explicit statement checks prevent reusing FN identities against changed math. */
export function prepareFirstTopicVisualCandidate(input: { graphHash:string; facts: ReadonlyMap<string,GraphFactNode>; constructionBinding:string; segmentConstructionBindings?:ReadonlyMap<string,string> }): FirstTopicVisualCandidate {
  const result: FirstTopicVisualCandidate = { status:"Draft", graph_hash:input.graphHash, bindings:[], visual_requirements:[], evidence:[] };
  const add = (number:number, beat:number, factId:string, exact:string, relation:VisualBinding["relation"], forms:VisualBinding["allowed_forms"], needsO=false, pairs:(0|1|2)[]=[]) => {
    const fact=input.facts.get(factId);
    if (!fact || fact.statement!==exact) throw new Error(`visual candidate requires reviewed ${factId} statement: graph pin must be re-audited`);
    // Runtime references are approved construction outputs, never display aliases.
    const text=JSON.stringify(relation).replaceAll('"O"','"pt-O"').replaceAll('"DO"','"seg-DO"').replaceAll('"AO"','"seg-AO"').replaceAll('"BO"','"seg-BO"').replaceAll('"OE"','"seg-OE"');
    relation=JSON.parse(text) as VisualBinding["relation"];
    const binding=visualBindingSchema.parse({binding_id:`VB-${number}`,binding_kind:"geometry_visual",purpose:exact,relation,basis_refs:[factId],allowed_scopes:[scope(beat)],reveal_scope:fact.reveals_answer||fact.role==="goal"?"final_result":"intermediate_result",required_constructions:needsO?[input.constructionBinding,...(relation.type==="segment-measure" && relation.segment.startsWith("seg-") ? [input.segmentConstructionBindings?.get(relation.segment) ?? (()=>{throw new Error(`missing construction binding for ${relation.segment}`);})()] : [])]:[],allowed_forms:forms,max_lifetime:"teaching-scope"});
    result.bindings.push(binding);result.evidence.push({binding_id:binding.binding_id,fact_id:factId,approved_statement:exact});
    result.visual_requirements.push(visualRequirementSchema.parse({scope:scope(beat),binding_ref:binding.binding_id,forms,required_pair_indices:pairs,trigger:"introduce"}));
  };
  add(101,1,"FN-03","$\\angle DAC=\\angle ACD$",{type:"angle-equality",angles:[angle("A","D","C"),angle("C","A","D")]},["angle-arcs"]);
  const firstAngles="$\\angle ACD=\\angle ACB$ 且 $\\angle DAC=\\angle ABC$";
  add(102,2,"FN-05",firstAngles,{type:"angle-equality",angles:[angle("C","A","D"),angle("C","A","B")]},["angle-arcs"]);
  add(103,2,"FN-05",firstAngles,{type:"angle-equality",angles:[angle("A","D","C"),angle("B","A","C")]},["angle-arcs"]);
  add(104,2,"FN-06","$\\triangle CAD\\sim\\triangle CBA$（第一组子母型相似）",{type:"similarity",left:["C","A","D"],right:["C","B","A"],proof_angle_bindings:["VB-102","VB-103"]},["paired-sides"],false,[0,1,2]);
  add(105,3,"FN-07","$CA:CB=AD:BA=CD:CA=2:3$",{type:"directed-ratio",numerator:"segment-AC",denominator:"segment-BC",expression_ref:"FN-07"},["ratio-label"]);
  for(const [id,fact,segment,exact] of [[106,"FN-08","segment-AD","$AD=\\frac{8}{3}$"],[107,"FN-09","segment-DC","$CD=\\frac{8}{3}$"],[108,"FN-10","segment-BD","$BD=\\frac{10}{3}$"]] as const)
    add(id,3,fact,exact,{type:"segment-measure",segment,expression_ref:fact},["length-label"]);
  const secondAngles="$\\angle DAO=\\angle DBA$ 且 $\\angle ADO=\\angle BDA$";
  add(109,4,"FN-13",secondAngles,{type:"angle-equality",angles:[angle("A","D","O"),angle("B","D","A")]},["angle-arcs"],true);
  add(110,4,"FN-13",secondAngles,{type:"angle-equality",angles:[angle("D","A","O"),angle("D","B","A")]},["angle-arcs"],true);
  add(111,4,"FN-14","$\\triangle DAO\\sim\\triangle DBA$（第二组子母型相似）",{type:"similarity",left:["D","A","O"],right:["D","B","A"],proof_angle_bindings:["VB-109","VB-110"]},["paired-sides"],true,[0,1,2]);
  for(const [id,fact,segment,exact] of [[112,"FN-16","DO","$DO=\\frac{32}{15}$"],[113,"FN-17","AO","$AO=\\frac{16}{5}$"],[114,"FN-18","BO","$BO=\\frac65$"],[115,"FN-19","OE","$OE=\\frac45$"]] as const)
    add(id,4,fact,exact,{type:"segment-measure",segment,expression_ref:fact},["length-label"],true);
  const butterfly="$BO:AO=OE:OD=3:8$，且 $\\angle BOE=\\angle AOD$";
  add(116,5,"FN-20",butterfly,{type:"angle-equality",angles:[angle("O","B","E"),angle("O","A","D")]},["angle-arcs"],true);
  add(117,5,"FN-21","$\\triangle BOE\\sim\\triangle AOD$（蝶形相似）",{type:"similarity",left:["B","O","E"],right:["A","O","D"],proof_angle_bindings:["VB-116"]},["paired-sides"],true,[0,1,2]);
  add(118,5,"FN-22","$BE:AD=3:8$",{type:"directed-ratio",numerator:"segment-BE",denominator:"segment-AD",expression_ref:"FN-22"},["ratio-label"],true);
  add(119,5,"FN-23","$BE=1$",{type:"segment-measure",segment:"segment-BE",expression_ref:"FN-23"},["length-label"],true);
  return result;
}

/** Build a reviewable Plan v8 in memory. Caller chooses an unoccupied artifact
 * version; no published Plan or protocol is edited, signed, or registered. */
export function attachFirstTopicVisualCandidate(input:{
  plan:unknown; graphHash:string; facts:ReadonlyMap<string,GraphFactNode>; targetVersion:string;
}): {plan:ReturnType<typeof tutorPlanBundleV8Schema.parse>;evidence:FirstTopicVisualCandidate["evidence"]} {
  const base=tutorPlanBundleV7Schema.parse(input.plan);
  if(base.status!=="Draft"||base.approval)throw new Error("visual candidate attachment requires an unsigned Draft plan");
  if(base.version===input.targetVersion || !/^v[0-9]+$/.test(input.targetVersion))throw new Error("visual successor requires a distinct explicit version");
  if(base.solution_graph_ref.content_hash!==input.graphHash)throw new Error("visual candidate graph pin mismatch");
  const constructions=base.resource_bindings.filter(b=>b.binding_kind==="geometry");
  const outputBindings=new Map(constructions.flatMap(b=>b.allowed_template_ids.map(id=>[id,b.binding_id] as const)));
  const pointBinding=outputBindings.get("pt-O");if(!pointBinding)throw new Error("missing approved pt-O construction binding");
  const candidate=prepareFirstTopicVisualCandidate({graphHash:input.graphHash,facts:input.facts,constructionBinding:pointBinding,segmentConstructionBindings:outputBindings});
  if(candidate.bindings.some(b=>base.resource_bindings.some(old=>old.binding_id===b.binding_id)))throw new Error("candidate VB identity already occupied");
  const body={...base,schema:"ai_teaching_tutor_plan_bundle/v8" as const,version:input.targetVersion,artifact_uri:`artifact://tutor-plan/${base.artifact_id}@${input.targetVersion}`,resource_bindings:[...base.resource_bindings,...candidate.bindings],visual_requirements:candidate.visual_requirements};
  body.content_hash=canonicalHash(body as unknown as Record<string,unknown>,"plan");
  return {plan:tutorPlanBundleV8Schema.parse(body),evidence:candidate.evidence};
}
