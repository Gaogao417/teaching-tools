/** Failed renderer recovery must consume durable content, never regenerate it. */
import {expect,it} from 'vitest';
import {foldCommittedV9Events} from '../../tutorSession/TutorRuntimeStateReducerV9';
import {resolve} from 'node:path';
import {importReviewCandidate} from '../../planBuild/c1/ImportReviewCandidate';
import {TutorTaskBindingResolver} from '../TutorTaskBindingResolver';
import {TutorRuntimeApplicationV7} from '../TutorRuntimeApplicationV7';
import {FixedResponseGateProvider} from '../../tutorNavigator/ModelGateAdjudicatorV5';
import {f6Model,realCanonicalRoot} from './f6Support';
import {PRESENTER_PROMPT_VERSION,type PresenterUserPayload} from '../presentationGeneration/PresenterPrompts';
import type {PresenterGeneratorPort} from '../presentationGeneration/GeneratorPort';
const root=realCanonicalRoot();
const review=importReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/c1-teach-follow-along/candidate-v13-r3')});
if(!review.ok)throw Error(review.errors.join(';'));
it('retry and refresh reuse the failed committed board and following voice with fresh action identity',async()=>{
 let calls=0;
 const presenter:PresenterGeneratorPort={provider:'committed-recovery',modelId:'committed-recovery',pin:{provider:'committed-recovery',model_id:'committed-recovery',prompt_version:PRESENTER_PROMPT_VERSION,context_builder_version:'presentation-context-builder/v1',tool_catalog_version:'presentation-tool-catalog/v1'},async generatePresentationDraft(r){calls++;const p=r.userPayload as PresenterUserPayload;return {latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:r.request_id,items:[...(p.required_board_bindings??[]).map(b=>({type:'tool_intent' as const,tool:'board.explain',args:{binding_ref:b.binding_ref,params:{note_kind:'approved_math_note'}}})),{type:'speech',text:'固定的已提交讲解。',basis_refs:[p.allowed_knowledge[0].ref]}]}};}};
 const gate=new FixedResponseGateProvider([],'committed-recovery');
 const app=()=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:new TutorTaskBindingResolver(root,()=>review),model:f6Model(gate,'committed-recovery'),presenter});
 const start=app().start({task_id:'goldenMinhangFold2020',student_id:'recovery',client_request_id:'committed-recovery-start',sessionIdAllocator:()=> 'TS-99779001'});if(start.kind==='payload-drift')throw Error('drift');
 const s=start.orchestrator;await s.drivePendingGeneration();
 const oldPlan=s.events.find(e=>e.event_type==='presentation_sequence_planned')!.payload as any;
 const failed=s.rebuildRuntimeState().presentation_cursor;if(failed.status!=='awaiting_browser')throw Error('delivery required');expect(oldPlan.actions[failed.ordinal].kind).toBe('workspace');
 s.reportPresentationOutcome({...failed,outcome:'failed',failure_class:'internal_error',message:'board animation failed',client_request_id:'board-fail'});
 const request={input:{kind:'control' as const,command:'retry_recovery' as const},client_request_id:'retry-fixed-board'};
 const recovered=app().restore(s.sessionId);
 const hook=recovered as unknown as {appendViaKernel(revision:number,events:any[]):unknown};
 const append=hook.appendViaKernel.bind(recovered);const beforeAttack=structuredClone(recovered.events);
 hook.appendViaKernel=(revision,events)=>{
  const mutated=structuredClone(events);const plan=mutated.find(e=>e.event_type==='presentation_sequence_planned');
  if(plan)plan.payload.actions.at(-1).voice_action.text='非法第二生成正文';
  return append(revision,mutated);
 };
 try{await expect(recovered.submitStudentInput({...request,client_request_id:'forged-recovery-batch'})).rejects.toThrow(/exact committed suffix/);}
 finally{hook.appendViaKernel=append;}
 expect(recovered.events.slice(beforeAttack.length).map(e=>e.event_type)).toEqual(['student_input_recorded']);
 expect(recovered.rebuildRuntimeState().presentation_cursor.status).toBe('failed');
 await recovered.submitStudentInput(request);await recovered.drivePendingGeneration();
 expect(calls).toBe(1);expect(gate.callCount).toBe(0);
 const plans=recovered.events.filter(e=>e.event_type==='presentation_sequence_planned');expect(plans).toHaveLength(2);
 const replacement=plans[1].payload as any;expect(replacement.sequence_id).not.toBe(oldPlan.sequence_id);
 expect(replacement.explanation_fragments??[]).toEqual([]);expect(replacement.existing_fragment_refs).toHaveLength(oldPlan.explanation_fragments.length);
 expect(replacement.actions[0].workspace_action.command_payload).toBe(oldPlan.actions[0].workspace_action.command_payload);
 expect(replacement.actions[0].workspace_action.action_id).not.toBe(oldPlan.actions[0].workspace_action.action_id);
 expect(replacement.actions.at(-1).voice_action.text).toBe(oldPlan.actions.at(-1).voice_action.text);
 const before=structuredClone(recovered.events);await app().restore(s.sessionId).submitStudentInput(request);expect(app().restore(s.sessionId).events).toEqual(before);
 expect(()=>recovered.reportPresentationOutcome({...failed,outcome:'presented',client_request_id:'late-old-board'})).toThrow();
 expect(recovered.events).toEqual(before);
 expect(recovered.assertReplayParity().equal).toBe(true);
 const record=(recovered.rebuildRuntimeState().generation_requests as Array<{request_id:string;sequence_id?:string;status:string}>).find(r=>r.request_id===oldPlan.generation.request_id)!;
 expect(record.sequence_id).toBe(oldPlan.sequence_id);expect(record.status).toBe('committed');
 const registry=new TutorTaskBindingResolver(root,()=>review).v7RegistryProvider(recovered.events[0].payload);
 const recoverIndex=recovered.events.findIndex(e=>e.sequence===plans[1].sequence);
 const mutations:Array<(events:any[])=>void>=[
  events=>{events[recoverIndex].causation_sequence=1;},
  events=>{events[recoverIndex-1].causation_sequence=1;},
  events=>{events[recoverIndex].schema="ai_teaching_tutor_session_event/v10";},
  events=>{events[recoverIndex].state_revision++;},
  events=>{events[recoverIndex].payload.actions.at(-1).voice_action.text='伪造改写正文';},
  events=>{events[recoverIndex].payload.actions.pop();},
  events=>{events[recoverIndex].payload.generation.request_id='GR-unknown-0001';},
  events=>{events[recoverIndex].payload.existing_fragment_refs[0].content_hash=`sha256:${'0'.repeat(64)}`;},
  events=>{events[recoverIndex].payload.actions[0].workspace_action.action_id=oldPlan.actions[0].workspace_action.action_id;},
 ];
 for(const mutate of mutations){const events=structuredClone(recovered.events) as any[];mutate(events);expect(()=>foldCommittedV9Events(events as never,registry)).toThrow();}
 expect(recovered.snapshot().views.status.last_failure).toBeUndefined();
 append(recovered.revision,[{event_type:'runtime_failure',payload:{failure_class:'internal_error',related_event_sequence:1,message:'unrelated infrastructure failure'},occurred_at:new Date().toISOString(),causation_sequence:1,idempotency_key:'unrelated-internal-failure'}]);
 expect(recovered.snapshot().views.status.last_failure).toMatchObject({category:'model_runtime_failure',event_type:'runtime_failure',failure_class:'internal_error'});


});
