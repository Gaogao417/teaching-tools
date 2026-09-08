import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import type {VisualBinding,VisualOwner,VisualRequirement} from '../../../../../shared/canonical/visualSchemas';
import {VisualBindingCatalog} from '../VisualBindingCatalog';
import {emptyVisualState,reduceVisual,stableVisualJson} from '../WorkspaceVisualReducer';
import {createVisualRuntimeContext,projectVisualView} from '../VisualViewProjector';
import {initialWorkspaceFold} from '../WorkspaceRuntimeReducerV5';
import {VisualIntentCompiler} from '../../tutorOrchestration/presentationGeneration/VisualIntentCompiler';
import {buildVisualPresentationContext,projectVisualContext} from '../../tutorOrchestration/presentationGeneration/VisualContextProjection';
import {buildPresentationContext,DEFAULT_CONTEXT_POLICY,PresentationContextError,type ContextBuildInput} from '../../tutorOrchestration/presentationGeneration/ContextBuilder';
import {importVisualReviewCandidate} from '../../planBuild/visual/ImportVisualReviewCandidate';
import {buildGoldenWorkspaceCatalogV5} from '../../tutorOrchestration/GoldenWorkspaceCatalog';
import {buildNavigatorPlan} from '../../tutorNavigator/NavigatorPlanV5';
import {realCanonicalRoot} from '../../tutorOrchestration/__tests__/f6Support';
const loaded=importVisualReviewCandidate({canonicalRoot:realCanonicalRoot(),candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});if(!loaded.ok)throw Error(loaded.errors.join(';'));
const imported=loaded.imported,visualCatalog=loaded.visual.catalog,allRequirements=loaded.visual.requirements;
const workspaceCatalog=buildGoldenWorkspaceCatalogV5(loaded.imported).catalog,sessionId='TS-94045001';
const owner:VisualOwner={scope:{kind:'approved',protocol_id:'PR-SMV-001',beat_id:'BT-03'},scope_epoch:3,part_ref:'1'};
const fold=initialWorkspaceFold(sessionId,workspaceCatalog);
const positions=new Map(workspaceCatalog.baseGeometry!.points.map(p=>[p.id,{x:p.x,y:p.y}]));
const required=(binding_ref:string,forms:VisualRequirement['forms']):VisualRequirement=>({binding_ref,scope:owner.scope,forms,required_pair_indices:[],trigger:'introduce'});
function hidden(){
 const binding:VisualBinding={binding_kind:'geometry_visual',binding_id:'VB-999',purpose:'injected final-result relation',basis_refs:['FN-999'],allowed_scopes:[owner.scope],reveal_scope:'final_result',required_constructions:[],max_lifetime:'problem-part',relation:{type:'segment-measure',segment:'segment-AB',expression_ref:'FN-999'},allowed_forms:['length-label']};
 const catalog=new VisualBindingCatalog({planHash:`sha256:${'a'.repeat(64)}`,bindings:[binding],approvedBasisRefs:new Set(['FN-999']),approvedScopes:new Set(['PR-SMV-001/BT-03']),expressions:new Map([['FN-999','$AB=HIDDEN_FINAL_999$']]),pointIds:new Set(positions.keys()),segments:new Map([['segment-AB',['A','B'] as const]]),constructionOutputs:new Map()});
 const authorization=(allowFinal:boolean)=>createVisualRuntimeContext({catalog,workspaceCatalog,fold,currentOwner:owner,activeOwners:[owner],authorizedBasisRefs:new Set(['FN-999']),finalAuthorizedBasisRefs:new Set(allowFinal?['FN-999']:[])});
 const action={session_id:sessionId,sequence_id:'PS-0001',ordinal:0,action_id:'WSA-94045001-0001'};
 const allowed=authorization(true),compiler=new VisualIntentCompiler({catalog,state:emptyVisualState(),owner,sessionId,sequenceId:action.sequence_id,permission:allowed});
 const command=compiler.compile({tool_id:'geometry.annotate',binding_ref:'VB-999',params:{form:'length-label',lifetime:'teaching-scope'}},0,action.action_id).command;
 const state=reduceVisual(emptyVisualState(),command,catalog,{...allowed,owner,action}).state;
 expect(projectVisualView(state,catalog,allowed).annotations[0].content).toContain('HIDDEN_FINAL_999');
 return {catalog,state,authorization:authorization(false),action};
}
it.each(['required-core','optional'] as const)('H04 %s final-result relation cannot enter context or student visual view',path=>{
 const h=hidden(),before=structuredClone(h.state);
 const input={...h,requirements:path==='required-core'?[required('VB-999',['length-label'])]:[],outcomes:[{action:h.action,outcome:'presented' as const,event_sequence:4}],sessionId,eventCutoff:4,availableChars:10000};
 if(path==='required-core')expect(()=>projectVisualContext(input)).toThrow(expect.objectContaining({kind:'CONTEXT_FORBIDDEN'}));
 else {const projected=projectVisualContext(input);expect(projected.bindings).toEqual([]);expect(projected.requirements).toEqual([]);expect(JSON.stringify(projected)).not.toContain('HIDDEN_FINAL_999');}
 const view=projectVisualView(h.state,h.catalog,h.authorization);expect(view.annotations).toEqual([]);expect(JSON.stringify(view)).not.toContain('HIDDEN_FINAL_999');expect(h.state).toEqual(before);
});
function combined(){
 const plan=buildNavigatorPlan(imported),beat=imported.protocols.get('PR-SMV-001')!.beats.find(b=>b.beat_id==='BT-03')!;
 const input:ContextBuildInput={planRef:plan.tutor_plan_ref,graphRef:plan.solution_graph_ref,graph:{facts:new Map(imported.graph.facts.map(f=>[f.fact_id,f])),inferences:new Map(imported.graph.inferences.map(i=>[i.inference_id,i]))},beat:{protocol_id:'PR-SMV-001',beat_id:'BT-03',graph_fact_refs:beat.solution_refs.fact_ids,inference_refs:beat.solution_refs.inference_ids,resource_ids:beat.resource_ids??[]},recentInputs:[],eventCutoff:4,workspaceRevision:0,currentRevision:4,policy:{...DEFAULT_CONTEXT_POLICY,max_total_chars:16000},sessionMode:'teaching',resourceContent:id=>imported.plan.resources.find(r=>r.resource_id===id)?.content};
 const requirements=allRequirements.filter(r=>r.scope.kind==='approved'&&r.scope.protocol_id==='PR-SMV-001'&&r.scope.beat_id==='BT-03');
 const visual={state:emptyVisualState(),catalog:visualCatalog,authorization:{currentOwner:owner,ownerAuthorized:()=>true,existingPoints:positions,completedConstructions:new Set<string>(),revealAuthorized:()=>true},requirements,outcomes:[],sessionId};
 const core=buildPresentationContext({...input,policy:{...input.policy,include_support_resources:false}}).budget.approx_chars;
 const projected=projectVisualContext({...visual,eventCutoff:4,availableChars:16000});
 const ids=new Set(requirements.map(r=>r.binding_ref));const visualCore=stableVisualJson({bindings:projected.bindings.filter(b=>ids.has(b.binding_id)),requirements:projected.requirements,already_presented:projected.already_presented}).length;
 return {input,visual,core,visualCore};
}
it('H05 actual BT03 core and required visual fit individually but their minimum combined group cannot be truncated',()=>{
 const {input,visual,core,visualCore}=combined();expect(core).toBeGreaterThan(0);expect(visualCore).toBeGreaterThan(0);
 const budget=Math.max(core,visualCore)+Math.floor(Math.min(core,visualCore)/2);expect(core).toBeLessThan(budget);expect(visualCore).toBeLessThan(budget);expect(core+visualCore).toBeGreaterThan(budget);
 const limited={...input,policy:{...input.policy,max_total_chars:budget}};expect(()=>buildPresentationContext(limited)).not.toThrow();expect(()=>projectVisualContext({...visual,eventCutoff:4,availableChars:budget})).not.toThrow();
 expect(()=>buildVisualPresentationContext(limited,visual)).toThrow(expect.objectContaining({kind:'CONTEXT_BUDGET_EXCEEDED'}));
});
it('H05 oversized optional support resource is omitted whole while the required combined context succeeds',()=>{
 const {input,visual,core,visualCore}=combined(),budget=core+visualCore+100;
 expect(input.beat.resource_ids.length).toBeGreaterThan(0);
 const result=buildVisualPresentationContext({...input,policy:{...input.policy,max_total_chars:budget},resourceContent:()=> 'RESOURCE_SECRET_'.repeat(budget)},visual);
 expect(result.budget.approx_chars).toBeLessThanOrEqual(budget);expect(result.context.resource_ids).toEqual([]);expect(JSON.stringify(result)).not.toContain('RESOURCE_SECRET_');
 for(const id of input.beat.resource_ids)expect(result.truncated_group_refs).toContain(id);
 expect(result.visual.requirements).toEqual(visual.requirements);
});
