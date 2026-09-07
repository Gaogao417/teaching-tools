/** v4 board completeness: real Draft graph/compiler/kernel, explicitly scripted model ports. */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { importReviewCandidate } from '../../planBuild/c1/ImportReviewCandidate';
import { TutorTaskBindingResolver } from '../TutorTaskBindingResolver';
import { TutorSessionOrchestratorV7 } from '../TutorSessionOrchestratorV7';
import { TutorRuntimeApplicationV7 } from '../TutorRuntimeApplicationV7';
import { FixedResponseGateProvider } from '../../tutorNavigator/ModelGateAdjudicatorV5';
import { f6Model } from './f6Support';
import { requiredBoardBindings, assertRequiredBoardBindings } from '../presentationGeneration/BoardProofCompleteness';
import { renderFragmentContent } from '../presentationGeneration/IntentCompiler';
import { toolSpecById } from '../presentationGeneration/PresentationToolCatalog';
import { structuredPresenterGenerator, type PresenterGeneratorPort } from '../presentationGeneration/GeneratorPort';
import { PRESENTER_PROMPT_VERSION, PRESENTER_SYSTEM_PROMPT, TOOL_INVOCATION_PRESENTER_PROMPT_VERSION, TOOL_INVOCATION_PRESENTER_SYSTEM_PROMPT, type PresenterUserPayload } from '../presentationGeneration/PresenterPrompts';
import { initialWorkspaceFold, applyWorkspaceV5Event } from '../../tutorSession/WorkspaceRuntimeReducerV5';

const root='/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring';
const review=importReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/c1-teach-follow-along/candidate-v13-r3')});
if(!review.ok)throw Error(review.errors.join(';'));
const resolver=new TutorTaskBindingResolver(root,()=>review);
const binding=resolver.resolveForStart('goldenMinhangFold2020');
const graph={facts:new Map(binding.imported.graph.facts.map(f=>[f.fact_id,f])),inferences:new Map(binding.imported.graph.inferences.map(i=>[i.inference_id,i]))};
const proofBinding=(()=>{
 const found=binding.imported.plan.resource_bindings!.find(b=>b.binding_id==='VB-09')!;
 if(found.binding_kind!=='explanation')throw Error('expected explanation');
 return found;
})();
const visible=[{spec:toolSpecById('board.explain')!,bindings:[proofBinding]}];
const proof=renderFragmentContent('approved_math_note',proofBinding,graph,[],true)!;
const required=[{binding_ref:'VB-09',note_kind:'approved_math_note' as const}];
const pin={provider:'proof-completeness-test',model_id:'proof-completeness-test',prompt_version:PRESENTER_PROMPT_VERSION,context_builder_version:'presentation-context-builder/v1',tool_catalog_version:'presentation-tool-catalog/v1'};
const board=(ref='VB-09',kind='approved_math_note')=>({type:'tool_intent' as const,tool:'board.explain',args:{binding_ref:ref,params:{note_kind:kind}}});
const draft=(items:any[])=>({schema:'ai_teaching_presentation_draft/v2' as const,request_id:'GR-TS-99890001-0001',items});

describe('binding-specific requirement and frozen prompt readers',()=>{
 it('requires the actual BT04 proof, preserving the v3 exact bytes and frozen v4 checkpoint',()=>{
  expect(requiredBoardBindings({visibleTools:visible,graph,alreadyPresentedBoardContent:[]})).toEqual(required);
  expect(createHash('sha256').update(TOOL_INVOCATION_PRESENTER_SYSTEM_PROMPT).digest('hex')).toBe('fa1e6804dcbb197bea9e3cb027fdb82456c119a3a82d8a117ae13b6720062881');
  expect(createHash('sha256').update(PRESENTER_SYSTEM_PROMPT).digest('hex')).toBe('b62b3d5e9e68c9bc7d319a2e3d11ded6ec92d7c03bfb3eda22ecc42d59ef3f58');
 });
 it('a different legal visible binding cannot substitute for the required binding',()=>{
  const other={...proofBinding,binding_id:'VB-77'};
  const requirements=requiredBoardBindings({visibleTools:[{spec:visible[0].spec,bindings:[proofBinding,other]}],graph,alreadyPresentedBoardContent:[]});
  expect(()=>assertRequiredBoardBindings(draft([board('VB-77')]),requirements)).toThrow(/VB-09/);
  expect(()=>assertRequiredBoardBindings(draft([board(),board('VB-77')]),requirements)).not.toThrow();
 });
 it('verbatim mathematical explanation_text is not an approved proof invocation',()=>{
  expect(()=>assertRequiredBoardBindings(draft([{type:'speech',text:proof,basis_refs:proofBinding.basis_refs.fact_ids},board('VB-09','explanation_text')]),required)).toThrow(/omitted/);
 });
 it('visible history containing premises or a bare conclusion cannot suppress their missing derivation',()=>{
  const conclusion=graph.facts.get(graph.inferences.get(proofBinding.basis_refs.inference_ids[0])!.conclusion)!.statement;
  for(const prefix of ['∵ ','∴ ']) {
   expect(requiredBoardBindings({visibleTools:visible,graph,alreadyPresentedBoardContent:[prefix+conclusion]})).toEqual(required);
   const content=renderFragmentContent('approved_math_note',proofBinding,graph,[prefix+conclusion],true)!;
   expect(content).toContain(graph.inferences.get(proofBinding.basis_refs.inference_ids[0])!.derivation);
  }
  expect(requiredBoardBindings({visibleTools:visible,graph,alreadyPresentedBoardContent:[proof]})).toEqual([]);
 });
 it('hidden or non-closed bindings never become authority for a compulsory board',()=>{
  expect(requiredBoardBindings({visibleTools:[],graph,alreadyPresentedBoardContent:[]})).toEqual([]);
  const broken={...proofBinding,basis_refs:{...proofBinding.basis_refs,fact_ids:[]}};
  expect(()=>requiredBoardBindings({visibleTools:[{spec:visible[0].spec,bindings:[broken]}],graph,alreadyPresentedBoardContent:[]})).toThrow(/closed/);
 });
});

let serial=0;
async function finish(s:TutorSessionOrchestratorV7){
 if(s.hasPendingGeneration())expect((await s.drivePendingGeneration()).kind).toBe('committed');
 for(let n=0;n<20;n++) {const c=s.rebuildRuntimeState().presentation_cursor;if(c.status!=='awaiting_browser')return;s.reportPresentationOutcome({sequence_id:c.sequence_id,ordinal:c.ordinal,action_id:c.action_id,outcome:'presented',client_request_id:`proof-receipt-${++serial}`});}
 throw Error('receipt loop exceeded');
}
const response=(gate:string)=>JSON.stringify({response_kind:'understanding_confirmation',matched_gate_id:gate,verdict:'pass',reasoning_location:'unknown',grounding_refs:[]});
async function bt04(mode:'fix'|'omit'|'wrong_binding'|'prose'|'final_leak') {
 const gate=new FixedResponseGateProvider([response('GT-01'),response('GT-02'),response('GT-03')],'v4-proof-gates');
 let calls=0;let before=0;let s:TutorSessionOrchestratorV7;
 const observed:PresenterUserPayload[]=[];
 const presenter:PresenterGeneratorPort={provider:pin.provider,modelId:pin.model_id,pin,async generatePresentationDraft(r){
  const p=r.userPayload as PresenterUserPayload;const target=p.required_board_bindings?.some(b=>b.binding_ref==='VB-09');
  const items:any[]=[];const ref=p.allowed_knowledge[0].ref;
  const geometry=p.tools.find(t=>t.tool==='geometry.construct');
  for(const b of geometry?.bindings??[])items.push({type:'tool_intent',tool:'geometry.construct',args:{binding_ref:b.binding_ref,params:{template_id:b.allowed_template_ids![0]}}});
  for(let i=0;i<(target?4:1);i++)items.push({type:'speech',text:'我们依据批准关系整理这一步。',basis_refs:[ref]});
  if(target){
   calls++;observed.push(structuredClone(p));expect(items).toHaveLength(9);expect(p.output_budget.max_items).toBe(11);
   expect(s.events.slice(before).some(e=>['presentation_sequence_planned','presentation_action_applied','presentation_action_delivered'].includes(e.event_type))).toBe(false);
   if(mode==='wrong_binding')items.push(board('VB-06'));
   else if(mode==='prose'){items[5]={type:'speech',text:proof,basis_refs:[ref]};items.push(board('VB-09','explanation_text'));}
   else if(mode==='final_leak'){items[5]={type:'speech',text:'最终答案。',basis_refs:['FN-23']};items.push(board());}
   else if(mode==='fix'&&calls>1)for(const b of p.required_board_bindings??[])items.push(board(b.binding_ref));
  }else for(const b of p.required_board_bindings??[])items.push(board(b.binding_ref));
  return {latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:r.request_id,items}};
 }};
 const app=()=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:resolver,model:f6Model(gate,'v4-proof-gates'),presenter});
 const started=app().start({task_id:'goldenMinhangFold2020',student_id:'v4-proof-test',client_request_id:`proof-start-${++serial}`,sessionIdAllocator:()=>`TS-99891${String(serial).padStart(5,'0')}`});
 if(started.kind==='payload-drift')throw Error('unexpected drift');s=started.orchestrator;
 for(let i=1;i<=3;i++){await finish(s);await s.submitStudentInput({input:{kind:'utterance',channel:'mainline',text:'这一步听懂了，继续。'},client_request_id:`proof-confirm-${++serial}`});}
 before=s.events.length;expect(s.rebuildRuntimeState().teaching_cursor.beat_id).toBe('BT-04');
 const outcome=await s.drivePendingGeneration();return {s,app,outcome,calls,observed,delta:s.events.slice(before)};
}
describe('real kernel bounded retry and all-or-nothing sequence',()=>{
 it('5 geometry + 4 voice missing board retries once, then commits the actual required proof',async()=>{
  const r=await bt04('fix');expect(r.calls).toBe(2);expect(r.outcome.kind).toBe('committed');
  expect(r.observed[1]).toEqual(r.observed[0]);
  expect(r.delta.filter(e=>String(e.event_type)==='presentation_generation_retry_scheduled')).toHaveLength(1);
  const planned=r.delta.find(e=>e.event_type==='presentation_sequence_planned')!.payload as any;
  expect(planned.actions.filter((a:any)=>a.workspace_action?.capability==='geometry.construct')).toHaveLength(5);
  expect(planned.explanation_fragments.some((f:any)=>proofBinding.basis_refs.inference_ids.every(id=>f.basis_refs.includes(id))&&f.content.includes('∴'))).toBe(true);
  await finish(r.s);expect(r.app().restore(r.s.sessionId).assertReplayParity().equal).toBe(true);
 },15000);
 it.each(['omit','wrong_binding','prose'] as const)('%s exhausts exactly three attempts, with zero partial geometry/board/voice commit',async mode=>{
  const r=await bt04(mode);expect(r.calls).toBe(3);expect(r.outcome).toMatchObject({kind:'failed',errorClass:'RETRY_EXHAUSTED'});
  expect(r.delta.some(e=>e.event_type==='presentation_sequence_planned'||e.event_type==='presentation_action_applied')).toBe(false);
  expect(r.delta.filter(e=>String(e.event_type)==='presentation_generation_retry_scheduled')).toHaveLength(2);
 },15000);
 it('adding the required board cannot authorize a final-answer basis; remains terminal and commits no partial actions',async()=>{
  const r=await bt04('final_leak');expect(r.calls).toBe(1);expect(r.outcome).toMatchObject({kind:'failed',errorClass:'draft_invalid'});
  expect(r.delta.some(e=>e.event_type==='presentation_sequence_planned'||e.event_type==='presentation_action_applied')).toBe(false);
 },15000);
 it('explicit v3 reader restores and generates its original voice-only behavior; v4 replacement fails closed',async()=>{
  const model={provider:'v3-reader-test',modelId:'v3-reader-test',async complete<T>(){return {value:{items:[{type:'speech',text:'先看题目。',basis_refs:['FN-01']}]} as T,latencyMs:1,modelId:'v3-reader-test',promptVersion:TOOL_INVOCATION_PRESENTER_PROMPT_VERSION};}};
  const presenter=structuredPresenterGenerator(model,{promptVersion:TOOL_INVOCATION_PRESENTER_PROMPT_VERSION});
  const gate=new FixedResponseGateProvider([],'v3-reader-gate');const deps={canonicalRoot:root,bindingResolver:resolver,model:f6Model(gate,'v3-reader-gate')};
  const app=()=>TutorRuntimeApplicationV7.create({...deps,presenter});
  const created=app().start({task_id:'goldenMinhangFold2020',student_id:'v3-reader-test',client_request_id:`v3-reader-${++serial}`,sessionIdAllocator:()=>`TS-99892${String(serial).padStart(5,'0')}`});if(created.kind==='payload-drift')throw Error('drift');
  const before=created.orchestrator.events;const restored=app().restore(created.orchestrator.sessionId);expect(restored.events).toEqual(before);
  expect(()=>TutorRuntimeApplicationV7.create({...deps,presenter:structuredPresenterGenerator(model)}).restore(restored.sessionId)).toThrow(/pin mismatch/);
  expect((await restored.drivePendingGeneration()).kind).toBe('committed');
  expect((restored.events.find(e=>e.event_type==='presentation_sequence_planned')!.payload as any).explanation_fragments??[]).toEqual([]);
 });
});

async function frozenHistory(options:{outcome?:string;kind?:string;actionId?:string;revision?:number}={}){
 const sid='TS-99893001';const beat=binding.plan.mainline.beats.get('BT-04')!;
 const noteKind=options.kind??'approved_math_note';const events:any[]=[
  {sequence:1,state_revision:2,event_type:'presentation_sequence_planned',payload:{sequence_id:'PS-OLD',actions:[{ordinal:0,kind:'workspace',workspace_action:{action_id:'WSA-OLD',capability:'board.explain',command_payload:'EF-OLD'}}],explanation_fragments:[{fragment_id:'EF-OLD',content:proof,kind:noteKind}]}},
  {sequence:2,state_revision:3,event_type:'presentation_action_delivered',payload:{sequence_id:'PS-OLD',ordinal:0,action_id:'WSA-OLD',kind:'workspace'}},
  ...(options.outcome?[{sequence:3,state_revision:options.revision??4,event_type:'presentation_action_outcome_recorded',payload:{sequence_id:'PS-OLD',ordinal:0,action_id:options.actionId??'WSA-OLD',kind:'workspace',outcome:options.outcome}}]:[]),
 ];
 const instance:any=Object.create(TutorSessionOrchestratorV7.prototype);
 const initial=initialWorkspaceFold(sid,binding.golden.catalog,undefined,{task_id:binding.taskId,protocol_refs:[{artifact_id:beat.protocol_id}],initial_cursor:{protocol_id:beat.protocol_id,beat_id:beat.beat_id}});
 const fold=applyWorkspaceV5Event(initial,{sequence:1,event_type:'policy_decision_made',payload:{decision_id:`TD-${sid}-0001`,protocol_id:beat.protocol_id,beat_id:beat.beat_id}} as never,binding.golden.catalog);
 let payload:PresenterUserPayload|undefined;
 Object.assign(instance,{sessionId:sid,binding,catalog:binding.golden.catalog,sessionMode:'teaching',navigator:{currentBeat:beat},countPlanned:()=>0,rebuildWorkspace:()=>fold,presenterGenerator:{async generatePresentationDraft(r:any){payload=r.userPayload;return {latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:r.request_id,items:[{type:'speech',text:'整理批准推导。',basis_refs:[proofBinding.basis_refs.fact_ids[0]]},...(payload!.required_board_bindings??[]).map(b=>board(b.binding_ref))]}};}}});
 Object.defineProperty(instance,'events',{get:()=>events});
 const result=await instance.buildAndRunGeneration({request_id:`GR-${sid}-0001`,attempt:1,epoch:1,decision_id:`TD-${sid}-0001`,scope:{kind:'approved',protocol_id:beat.protocol_id,beat_id:beat.beat_id},input_digest:`sha256:${'a'.repeat(64)}`,presenter_pin:pin,timeout_ms:100,context:{plan_ref:binding.plan.tutor_plan_ref,graph_ref:binding.plan.solution_graph_ref,selected_fact_ids:proofBinding.basis_refs.fact_ids,selected_inference_ids:proofBinding.basis_refs.inference_ids,resource_ids:beat.resource_ids,event_cutoff:4,workspace_revision:0}});
 return {result,payload:payload!};
}
describe('actual frozen presented board payload and identity',()=>{
 it.each([undefined,'failed','interrupted'] as const)('%s outcome is not presented board evidence',async outcome=>{
  const r=await frozenHistory({outcome});expect(r.payload.presented_board).toEqual([]);expect(r.payload.required_board_bindings).toEqual(required);
 });
 it('identity-matching presented formal proof before cutoff is shown to Presenter and deduplicates',async()=>{
  const r=await frozenHistory({outcome:'presented'});expect(r.payload.presented_board).toEqual([{kind:'approved_math_note',content:proof}]);expect(r.payload.required_board_bindings).toEqual([]);expect(r.result.explanation_fragments??[]).toEqual([]);
 });
 it.each([{actionId:'WSA-FORGED'},{revision:5}])('wrong identity or later receipt does not change frozen generation: %j',async options=>{
  const r=await frozenHistory({outcome:'presented',...options});expect(r.payload.presented_board).toEqual([]);expect(r.payload.required_board_bindings).toEqual(required);
 });
 it('presented explanation_text is truthful history but never proof coverage',async()=>{
  const r=await frozenHistory({outcome:'presented',kind:'explanation_text'});expect(r.payload.presented_board).toEqual([{kind:'explanation_text',content:proof}]);expect(r.payload.required_board_bindings).toEqual(required);
 });
});
