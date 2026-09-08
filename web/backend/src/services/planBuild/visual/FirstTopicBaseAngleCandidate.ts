/** Offline unsigned successor only. Derivation evidence is not a new graph fact. */
import {tutorPlanBundleV8Schema,visualBindingSchema,visualRequirementSchema} from '../../../../../shared/canonical/visualSchemas';
import {canonicalHash,type GraphFactNode} from '../canonicalInputs';
import {attachFirstTopicVisualCandidate} from './FirstTopicVisualCandidate';
const GRAPH_HASH='sha256:2bc516468e9cc8c4033f96277d810f96752a7cb41269f1f0eb0735c2da507c25';
const DERIVATION='由等腰底角、题设等角及图中同一直线关系合并得到两对对应角。';
export function attachFirstTopicBaseAngleCandidate(input:{plan:unknown;graphHash:string;facts:ReadonlyMap<string,GraphFactNode>;inferences:readonly {inference_id:string;premises:string[];conclusion:string;derivation:string}[]}){
 if(input.graphHash!==GRAPH_HASH)throw Error('base-angle reviewed graph pin drift');
 const fact=input.facts.get('FN-01'),inference=input.inferences.find(i=>i.inference_id==='IF-01');
 if(fact?.statement!=='$AB=AC=4$'||fact.role!=='given'||fact.reveals_answer)throw Error('base-angle reviewed FN-01 drift');
 if(!inference||inference.derivation!==DERIVATION||inference.conclusion!=='FN-05'||JSON.stringify(inference.premises)!==JSON.stringify(['FN-01','FN-02','FN-03']))throw Error('base-angle reviewed IF-01 evidence drift');
 const original=attachFirstTopicVisualCandidate({...input,targetVersion:'v14'});
 if(original.plan.resource_bindings.some(b=>b.binding_id==='VB-120'))throw Error('base-angle VB-120 occupied');
 const scope={kind:'approved' as const,protocol_id:'PR-SMV-001',beat_id:'BT-01'};
 const binding=visualBindingSchema.parse({binding_id:'VB-120',binding_kind:'geometry_visual',purpose:'由 AB=AC，等腰三角形 ABC 的底角 ∠ABC=∠ACB。',relation:{type:'angle-equality',angles:[{vertex:'B',ray_points:['A','C'],sector:'minor'},{vertex:'C',ray_points:['A','B'],sector:'minor'}]},basis_refs:['FN-01'],allowed_scopes:[scope],reveal_scope:'intermediate_result',required_constructions:[],allowed_forms:['angle-arcs'],max_lifetime:'teaching-scope'});
 const requirement=visualRequirementSchema.parse({scope,binding_ref:'VB-120',forms:['angle-arcs'],required_pair_indices:[],trigger:'introduce'});
 const body={...original.plan,version:'v15',artifact_uri:'artifact://tutor-plan/TP-SMV-009@v15',resource_bindings:[...original.plan.resource_bindings,binding],visual_requirements:[...original.plan.visual_requirements,requirement]};
 body.content_hash=canonicalHash(body as unknown as Record<string,unknown>,'plan');
 return {plan:tutorPlanBundleV8Schema.parse(body),evidence:[...original.evidence,{binding_id:'VB-120',fact_id:'FN-01',approved_statement:fact.statement,derived_relation:'∠ABC=∠ACB',derivation:'由AB=AC，按等腰三角形底角定理得到∠ABC=∠ACB。',reviewed_inference:{inference_id:'IF-01',derivation:DERIVATION},classification:'derived-not-problem-given',runtime_basis_refs:['FN-01']}]};
}
