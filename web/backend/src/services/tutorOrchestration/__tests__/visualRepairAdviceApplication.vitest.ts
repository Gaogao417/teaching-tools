/** H06: recorded real draft, scripted replies only; real pinned visual importer/kernel/preflight. */
import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {TutorRuntimeApplicationV7} from '../TutorRuntimeApplicationV7';
import {TutorTaskBindingResolver} from '../TutorTaskBindingResolver';
import {importVisualReviewCandidate} from '../../planBuild/visual/ImportVisualReviewCandidate';
import {FixedResponseGateProvider} from '../../tutorNavigator/ModelGateAdjudicatorV5';
import {f6Model,realCanonicalRoot} from './f6Support';
import {VISUAL_PRESENTER_PROMPT_VERSION} from '../presentationGeneration/PresenterPrompts';
import {VISUAL_CONTEXT_BUILDER_VERSION,VISUAL_TOOL_CATALOG_VERSION} from '../presentationGeneration/VisualPresentationTools';
import type {PresenterGeneratorPort,PresentationDraftV2} from '../presentationGeneration/GeneratorPort';
import {VisualObligationQualityError} from '../presentationGeneration/IntentCompiler';
import * as preflightModule from '../presentationGeneration/SequencePreflight';
const original=JSON.parse(readFileSync(resolve('src/services/tutorOrchestration/__tests__/fixtures/realBt03MissingRatio.json'),'utf8')).items as PresentationDraftV2['items'];
const annotate=(binding_ref:string,form:string)=>({type:'tool_intent' as const,tool:'geometry.annotate',args:{binding_ref,params:{form,lifetime:'teaching-scope',group:'seg'}}});
// The recorded input remains immutable. The scripted corrected response now
// also repairs the real indirect-reference order/focus defect exposed by v10.
const fixed=()=>{
 const speech=(index:number,binding:string)=>{const item=structuredClone(original[index]);if(item.type!=='speech')throw Error('fixture speech missing');return {...item,basis_refs:[...(item.basis_refs??[]),binding]};};
 const show=(binding:string,form:string):PresentationDraftV2['items']=>[annotate(binding,form),{type:'tool_intent',tool:'geometry.emphasize',args:{binding_ref:binding,params:{group:'seg',mode:'steady'}}}];
 return [...show('VB-105','ratio-label'),speech(0,'VB-105'),speech(1,'VB-105'),structuredClone(original[2]),...show('VB-106','length-label'),speech(3,'VB-106'),...show('VB-107','length-label'),speech(5,'VB-107'),...show('VB-108','length-label'),speech(7,'VB-108'),{type:'speech' as const,text:'这一步你跟上了吗？',basis_refs:[]}];
};
const root=realCanonicalRoot();const loaded=importVisualReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});if(!loaded.ok)throw Error(loaded.errors.join(';'));
let serial=0;
function legalItems(p:any){const items:PresentationDraftV2['items']=[];for(const req of p.visual.requirements){for(const form of req.forms)items.push(annotate(req.binding_ref,form));for(const pair of req.required_pair_indices)items.push({type:'tool_intent',tool:'geometry.emphasize',args:{binding_ref:req.binding_ref,params:{group:'seg',pair_index:pair,mode:'pulse'}}});}items.push({type:'speech',text:'我们依据当前批准关系看这一步。',basis_refs:[p.allowed_knowledge[0].ref]});for(const b of p.required_board_bindings??[])items.push({type:'tool_intent',tool:'board.explain',args:{binding_ref:b.binding_ref,params:{note_kind:'approved_math_note'}}});return items;}
afterEach(()=>vi.restoreAllMocks());
async function setup(reply:(call:number,payload:any)=>Promise<PresentationDraftV2['items']>|PresentationDraftV2['items'],targetBeat=3,promptVersion=VISUAL_PRESENTER_PROMPT_VERSION){
 const feedbacks:unknown[]=[];
 const seen:Array<{request_id:string;payload:unknown}>=[];
 const gate=new FixedResponseGateProvider([1,2].map(n=>JSON.stringify({response_kind:'understanding_confirmation',matched_gate_id:`GT-0${n}`,verdict:'pass',reasoning_location:'unknown',grounding_refs:[]})),'visual-quality');
 const presenter:PresenterGeneratorPort={provider:'visual-quality-test',modelId:'visual-quality-test',pin:{provider:'visual-quality-test',model_id:'visual-quality-test',prompt_version:promptVersion,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION},async generatePresentationDraft(r){
  const p=r.userPayload as any;let items:PresentationDraftV2['items'];
  if(p.visual.requirements.some((x:any)=>x.binding_ref===(targetBeat===1?'VB-101':targetBeat===3?'VB-105':'VB-104'))){seen.push({request_id:r.request_id,payload:structuredClone((({repair_feedback,...base})=>base)(p))});feedbacks.push(structuredClone(p.repair_feedback));items=await reply(seen.length,p);}
  else items=legalItems(p);
  return {draft:{schema:'ai_teaching_presentation_draft/v2',request_id:r.request_id,items},latencyMs:0};}};
 const app=()=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:new TutorTaskBindingResolver(root,()=>loaded),model:f6Model(gate,'visual-quality'),presenter});
 const started=app().start({task_id:'goldenMinhangFold2020',student_id:'quality-test',client_instance_id:'CI-quality-test',client_request_id:`repair-advice-start-${++serial}`,sessionIdAllocator:()=>`TS-998881${String(serial).padStart(4,'0')}`});if(started.kind==='payload-drift')throw Error('drift');const s=started.orchestrator;
 for(let beat=1;beat<targetBeat;beat++){await settle(s);await s.submitStudentInput({input:{kind:'utterance',channel:'mainline',text:'这一步关系我听懂了。'},execution_owner:s.visualLifecycle!.presentation_execution_owner,client_request_id:`quality-confirm-${++serial}`},{expectedRevision:s.revision});await settle(s,false);}
 expect(s.rebuildRuntimeState().teaching_cursor.beat_id).toBe(`BT-0${targetBeat}`);expect(seen).toHaveLength(0);
 const diagnostics:unknown[]=[];
 const engine=s as unknown as {buildAndRunGeneration(request:unknown,feedback?:unknown):Promise<unknown>};const build=engine.buildAndRunGeneration.bind(s);
 engine.buildAndRunGeneration=async (request,feedback)=>{try{return await build(request,feedback);}catch(error){if(error instanceof VisualObligationQualityError)diagnostics.push(structuredClone(error.issues));throw error;}};
 return {s,app,seen,feedbacks,diagnostics,before:s.events.length};
}
type Session=ReturnType<TutorRuntimeApplicationV7['restore']>;
async function settle(s:Session,generate=true){for(let n=0;n<80;n++){if(s.hasPendingGeneration()){if(!generate)return;expect((await s.drivePendingGeneration()).kind).toBe('committed');}const c=s.rebuildRuntimeState().presentation_cursor;if(c.status!=='awaiting_browser')return;s.reportPresentationOutcome({sequence_id:c.sequence_id,ordinal:c.ordinal,action_id:c.action_id,outcome:'presented',execution_owner:s.visualLifecycle!.presentation_execution_owner,expected_revision:s.revision,client_request_id:`quality-outcome-${++serial}`});}throw Error('settle exceeded');}
const absent=(events:any[])=>expect(events.filter(e=>['presentation_sequence_planned','presentation_action_applied','presentation_action_delivered','gate_evaluated'].includes(e.event_type))).toEqual([]);

it('current real application sends concrete rejected draft advice only to next budgeted attempt',async()=>{
 const f=await setup((n,p)=>{const items:PresentationDraftV2['items']=[annotate('VB-101','angle-arcs')];if(n>1)items.push({type:'tool_intent',tool:'geometry.emphasize',args:{binding_ref:'VB-101',params:{group:'seg',mode:'steady'}}});items.push({type:'speech',text:'先看题设相等角。',basis_refs:['FN-03']});for(const b of p.required_board_bindings??[])items.push({type:'tool_intent',tool:'board.explain',args:{binding_ref:b.binding_ref,params:{note_kind:'approved_math_note'}}});return items;},1);
 expect((await f.s.drivePendingGeneration()).kind).toBe('committed');expect(f.seen).toHaveLength(2);expect(f.seen[1]).toEqual(f.seen[0]);expect(f.feedbacks[0]).toBeUndefined();expect(f.feedbacks[1]).toMatchObject({source_attempt:1,issues:expect.arrayContaining([{binding_ref:'VB-101',code:'missing-focus',draft_item_index:1}]),previous_speech_items:[{draft_item_index:1,basis_refs:['FN-03']}]});
 expect(f.feedbacks[1]).toMatchObject({corrections:[{source:'rejected_uncommitted_candidate',draft_item_index:1,binding_ref:'VB-101',rejected_speech:{text:'先看题设相等角。',truncated:false,basis_refs:['FN-03']}}]});
 expect(f.feedbacks[1]).toMatchObject({rejected_candidate:{source:'rejected_uncommitted_candidate',complete:true,items:expect.arrayContaining([{draft_item_index:1,item:{type:'speech',text:'先看题设相等角。',basis_refs:['FN-03']},text_truncated:false}])}});
 const events=f.s.events.slice(f.before);expect(events.filter(e=>e.event_type==='presentation_sequence_planned')).toHaveLength(1);const attempts=events.filter(e=>String(e.event_type)==='presentation_generation_attempt_started').map(e=>e.payload as any);expect(attempts.map(a=>a.attempt)).toEqual([1,2]);expect(attempts[1].context).toEqual(attempts[0].context);expect(attempts[1].input_digest).toBe(attempts[0].input_digest);expect(attempts[1].presenter_pin).toEqual(attempts[0].presenter_pin);expect(JSON.stringify(events)).not.toContain('repair_feedback');
},15000);
import {driveGeneration} from '../presentationGeneration/GenerationCoordinator';
it('restart after persisted retry loses advisory but only consumes original remaining attempts',async()=>{
 const f=await setup((_n,p)=>{const items:PresentationDraftV2['items']=[annotate('VB-101','angle-arcs'),{type:'speech',text:'看题设的等角。',basis_refs:['FN-03']}];for(const b of p.required_board_bindings??[])items.push({type:'tool_intent',tool:'board.explain',args:{binding_ref:b.binding_ref,params:{note_kind:'approved_math_note'}}});return items;},1);
 const engine=f.s as any;
 await expect(driveGeneration(engine.generationKernelAccess(),{buildAndRun:async request=>({candidate:await engine.buildAndRunGeneration(request)})},{causationSequence:engine.generationCausationSequence(),sleep:async()=>{throw Error('TEST_PROCESS_STOP_AFTER_PERSISTED_RETRY');}})).rejects.toThrow('TEST_PROCESS_STOP_AFTER_PERSISTED_RETRY');
 expect(f.seen).toHaveLength(1);expect(String(f.s.events.at(-1)?.event_type)).toBe('presentation_generation_retry_scheduled');
 const restored=f.app().restore(f.s.sessionId);expect(await restored.drivePendingGeneration()).toMatchObject({kind:'failed',errorClass:'RETRY_EXHAUSTED'});expect(f.seen).toHaveLength(3);expect(f.feedbacks[1]).toBeUndefined();expect(f.feedbacks[2]).toMatchObject({source_attempt:2});
 const attempts=restored.events.filter(e=>String(e.event_type)==='presentation_generation_attempt_started').map(e=>(e.payload as any).attempt);expect(attempts).toEqual([1,2,3]);expect(restored.events.filter(e=>e.event_type==='presentation_sequence_planned')).toHaveLength(0);
},15000);

it('old v10 provider request remains without repair feedback on a real retry',async()=>{
 const f=await setup((n,p)=>{const items:PresentationDraftV2['items']=[annotate('VB-101','angle-arcs')];if(n>1)items.push({type:'tool_intent',tool:'geometry.emphasize',args:{binding_ref:'VB-101',params:{group:'seg',mode:'steady'}}});items.push({type:'speech',text:'看题设的等角。',basis_refs:['FN-03']});for(const b of p.required_board_bindings??[])items.push({type:'tool_intent',tool:'board.explain',args:{binding_ref:b.binding_ref,params:{note_kind:'approved_math_note'}}});return items;},1,'presenter-interleaved/v10-visual');
 expect((await f.s.drivePendingGeneration()).kind).toBe('committed');expect(f.feedbacks).toEqual([undefined,undefined]);expect(f.seen[1]).toEqual(f.seen[0]);
},15000);
import {PresenterGenerationError} from '../presentationGeneration/GeneratorPort';
import {createVisualRepairAdvisor} from '../presentationGeneration/VisualRepairAdvice';
it('accepted timeout cannot gain late quality advice or overwrite a newer accepted quality error',async()=>{
 const f=await setup(()=>[],1),engine=f.s as any,advisor=createVisualRepairAdvisor();let rejectLate!:(error:unknown)=>void;
 const late=new Promise<never>((_resolve,reject)=>rejectLate=reject);let calls=0,waits=0;const received:unknown[]=[],accepted:string[]=[];
 const result=await driveGeneration(engine.generationKernelAccess(),{
  async buildAndRun(request){received.push(advisor.take(request));calls++;
   if(calls===1)return await Promise.race([late,Promise.reject(new PresenterGenerationError('timeout','TEST_TIMEOUT',true))]);
   if(calls===2)throw new VisualObligationQualityError([{binding_ref:'VB-new',code:'missing-focus'}]);
   throw new PresenterGenerationError('draft_invalid','TEST_TERMINAL',false);
  },
  onRetryScheduled(request,error){accepted.push(error.failureClass);if(error instanceof VisualObligationQualityError)advisor.remember(request,error.issues,error.previousSpeech);},
 },{causationSequence:engine.generationCausationSequence(),sleep:async()=>{waits++;if(waits===2){rejectLate(new VisualObligationQualityError([{binding_ref:'VB-old',code:'late-visual'}]));await Promise.resolve();}}});
 expect(result).toMatchObject({kind:'failed'});expect(calls).toBe(3);expect(accepted).toEqual(['timeout','draft_invalid']);expect(received.slice(0,2)).toEqual([undefined,undefined]);expect(received[2]).toMatchObject({source_attempt:2,issues:[{binding_ref:'VB-new',code:'missing-focus'}]});expect(JSON.stringify(received)).not.toContain('VB-old');
},15000);
