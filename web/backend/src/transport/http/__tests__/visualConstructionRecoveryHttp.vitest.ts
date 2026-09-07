/** Scripted inputs; real Draft v14 HTTP/SQLite/compiler/scanner. No provider calls. */
import express from 'express';
import {resolve} from 'node:path';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createVNextTutorRoutes} from '../vnextTutorRoutes';
import {TutorRuntimeApplicationV7} from '../../../services/tutorOrchestration/TutorRuntimeApplicationV7';
import {TutorTaskBindingResolver} from '../../../services/tutorOrchestration/TutorTaskBindingResolver';
import {importVisualReviewCandidate} from '../../../services/planBuild/visual/ImportVisualReviewCandidate';
import {f6Model} from '../../../services/tutorOrchestration/__tests__/f6Support';
import {createGenerationRecoveryScanner} from '../../../services/tutorOrchestration/presentationGeneration/GenerationRecoveryWorker';
import {VISUAL_PRESENTER_PROMPT_VERSION} from '../../../services/tutorOrchestration/presentationGeneration/PresenterPrompts';
import {VISUAL_CONTEXT_BUILDER_VERSION,VISUAL_TOOL_CATALOG_VERSION} from '../../../services/tutorOrchestration/presentationGeneration/VisualPresentationTools';
import type {PresenterGeneratorPort} from '../../../services/tutorOrchestration/presentationGeneration/GeneratorPort';
import {parseSessionSnapshotHttp,type SessionSnapshotHttpV1} from '../../../../../shared/tutorHttpProfile';
import {db} from '../../../db/database';
const root='/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring';
const loaded=importVisualReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});
if(!loaded.ok)throw Error(loaded.errors.join(';'));
const resolver=new TutorTaskBindingResolver(root,()=>loaded);
const requests:Array<{id:string;payload:any}>=[];
let duplicate=false;
const presenter:PresenterGeneratorPort={provider:'local-recovery-test',modelId:'local-recovery-test',pin:{provider:'local-recovery-test',model_id:'local-recovery-test',prompt_version:VISUAL_PRESENTER_PROMPT_VERSION,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION},async generatePresentationDraft(request){
 const payload=request.userPayload as any;requests.push({id:request.request_id,payload});
 const items:any[]=[];
 const tool=(tool:string,binding_ref:string|undefined,params:unknown)=>items.push({type:'tool_intent',tool,args:{...(binding_ref?{binding_ref}:{}),params}});
 const requirements=payload.visual.requirements as any[],bindings=payload.visual.bindings as any[];
 const needed=new Set<string>(requirements.flatMap(r=>bindings.find(b=>b.binding_id===r.binding_ref)?.required_constructions??[]));
 for(const id of needed){const b=payload.tools.find((t:any)=>t.tool==='geometry.construct')?.bindings.find((b:any)=>b.binding_ref===id);if(b){tool('geometry.construct',id,{template_id:b.allowed_template_ids[0]});if(duplicate&&id==='VB-01')tool('geometry.construct',id,{template_id:b.allowed_template_ids[0]});}}
 items.push({type:'speech',text:'请观察图形。',basis_refs:[payload.allowed_knowledge[0].ref]});
 for(const [index,r] of requirements.entries()){
  for(const form of r.forms)if(form!=='paired-sides')tool('geometry.annotate',r.binding_ref,{form,lifetime:'teaching-scope'});
  for(const pair_index of r.required_pair_indices)tool('geometry.emphasize',r.binding_ref,{group:`pairs${index}`,mode:'pulse',pair_index});
  if(r.required_pair_indices.length)tool('geometry.clear-visual',undefined,{group:`pairs${index}`});
 }
 for(const b of payload.required_board_bindings??[])tool('board.explain',b.binding_ref,{note_kind:'approved_math_note'});
 return {latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:request.request_id,items}};
}};
const gate={name:'local-recovery-test',async adjudicate(json:string){const c=JSON.parse(json);return JSON.stringify({response_kind:'understanding_confirmation',matched_gate_id:c.eligible_gates[0]?.gate_id,verdict:'pass',reasoning_location:'unknown',grounding_refs:[]});}};
const factory=()=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:resolver,presenter,model:f6Model(gate,'local-recovery-test')});
const errors:unknown[]=[];const scanner=createGenerationRecoveryScanner(factory,e=>errors.push(e));
let base='',serial=0,server:import('node:http').Server;
beforeAll(async()=>{const app=express();app.use(express.json());app.use('/api/vnext',createVNextTutorRoutes({applicationFactory:factory}));await new Promise<void>(done=>{server=app.listen(0,'127.0.0.1',()=>{base=`http://127.0.0.1:${(server.address() as any).port}/api/vnext`;done();});});});
afterAll(async()=>{scanner.stop();await new Promise<void>(done=>server.close(()=>done()));});
async function call(path:string,body?:unknown){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const json=await r.json();expect(r.status,JSON.stringify(json)).toBe(body&&path==='/tutor-sessions'?201:200);const parsed=parseSessionSnapshotHttp(json);if(!parsed.ok)throw Error(parsed.errors.join(';'));return parsed.snapshot;}
const events=(id:string)=>db.prepare('SELECT event_type,payload_json FROM tutor_session_events WHERE session_id=? ORDER BY sequence').all(id) as Array<{event_type:string;payload_json:string}>;
const get=(v:SessionSnapshotHttpV1)=>call(`/tutor-sessions/${v.session_id}`);
const input=(v:SessionSnapshotHttpV1,input:unknown,owner=v.presentation_execution_owner)=>call(`/tutor-sessions/${v.session_id}/student-inputs`,{expected_revision:v.revision,client_request_id:`recovery-${++serial}`,execution_owner:owner,input});
const outcome=(v:SessionSnapshotHttpV1,failed=false)=>{const p=v.pending_presentation!;return call(`/tutor-sessions/${v.session_id}/presentation-actions/${p.action_id}/outcomes`,{expected_revision:v.revision,client_request_id:`recovery-${++serial}`,execution_owner:v.presentation_execution_owner,sequence_id:p.sequence_id,ordinal:p.ordinal,outcome:failed?'failed':'presented',...(failed?{failure_class:'provider_failure',message:'local injected media failure'}:{})});};
async function reachConstruction(){
 let v=await call('/tutor-sessions',{task_id:'goldenMinhangFold2020',student_id:`recovery-${++serial}`,client_instance_id:'recovery-page-a',client_request_id:`start-${serial}`});
 for(let i=0;i<100;i++){
  await scanner.scanOnce();v=await get(v);
  if(v.pending_presentation?.action.workspace_action?.capability==='geometry.construct'||v.generation!.status==='failed')return v;
  if(v.pending_presentation)v=await outcome(v);
  else v=await input(v,v.views.participation.kind==='confirm_input'?{kind:'control',command:'confirm'}:{kind:'utterance',channel:'mainline',text:'听懂了，继续'});
 }
 throw Error('BT04 construction not reached');
}
it('BT04 applied O + four segments survive claim/cleanup/regenerate without reoffering construct',async()=>{
 duplicate=false;let v=await reachConstruction();let constructed=0;
 while(v.pending_presentation?.action.workspace_action?.capability==='geometry.construct'){v=await outcome(v);constructed++;}
 expect(constructed,JSON.stringify(v.generation!)).toBe(5);expect(v.pending_presentation?.action.kind).toBe('voice');
 v=await outcome(v,true);const count=requests.length;
 v=await input(v,{kind:'control',command:'claim_presentation'},{client_instance_id:'recovery-page-b',epoch:900});
 expect(v.pending_presentation?.action.workspace_action?.capability).toBe('geometry.visual.reconcile');
 v=await outcome(v);await scanner.scanOnce();v=await get(v);
 expect(errors.map(String)).toEqual([]);expect(requests).toHaveLength(count+1);
 expect(requests.at(-1)!.payload.tools.some((t:any)=>t.tool==='geometry.construct')).toBe(false);
 expect(v.pending_presentation).toBeDefined();expect(v.generation!.status).toBe('idle');
 const resumed=v.pending_presentation!.sequence_id;
 for(let i=0;v.pending_presentation&&i<40;i++)v=await outcome(v);
 expect(v.pending_presentation).toBeUndefined();
 expect(events(v.session_id).filter(e=>e.event_type==='presentation_sequence_planned').map(e=>JSON.parse(e.payload_json)).find(p=>p.sequence_id===resumed).actions.some((a:any)=>a.workspace_action?.capability==='geometry.construct')).toBe(false);
 await scanner.scanOnce();expect(requests).toHaveLength(count+1);
},90000);
it('duplicate construction yields one durable failed generation and no repeated scanner reclaim',async()=>{
 duplicate=true;const v=await reachConstruction();
 expect(v.generation!.status,JSON.stringify(v.generation!)).toBe('failed');expect(errors.map(String)).toEqual([]);
 const before=events(v.session_id),calls=requests.length;
 const failures=before.filter(e=>e.event_type==='presentation_generation_failed').map(e=>JSON.parse(e.payload_json));
 expect(failures).toHaveLength(1);expect(failures[0].error_class).toBe('draft_invalid');
 expect(before.filter(e=>e.event_type==='presentation_generation_attempt_started'&&JSON.parse(e.payload_json).request_id===failures[0].request_id)).toHaveLength(1);
 await scanner.scanOnce();await scanner.scanOnce();
 expect(requests).toHaveLength(calls);expect(events(v.session_id)).toEqual(before);expect(errors.map(String)).toEqual([]);
},90000);
