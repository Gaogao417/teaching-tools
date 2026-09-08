/** Full visual application/kernel: authority rejection precedes repairable board omission. */
import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {TutorRuntimeApplicationV7} from '../TutorRuntimeApplicationV7';
import {TutorTaskBindingResolver} from '../TutorTaskBindingResolver';
import {importVisualReviewCandidate} from '../../planBuild/visual/ImportVisualReviewCandidate';
import {FixedResponseGateProvider} from '../../tutorNavigator/ModelGateAdjudicatorV5';
import {f6Model,realCanonicalRoot} from './f6Support';
import {VISUAL_PRESENTER_PROMPT_VERSION} from '../presentationGeneration/PresenterPrompts';
import {VISUAL_CONTEXT_BUILDER_VERSION,VISUAL_TOOL_CATALOG_VERSION} from '../presentationGeneration/VisualPresentationTools';
import type {PresenterGeneratorPort} from '../presentationGeneration/GeneratorPort';
const root=realCanonicalRoot();
const loaded=importVisualReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});
if(!loaded.ok)throw Error(loaded.errors.join(';'));
let serial=0;
it.each(['basis','binding','parameter','omission'] as const)('visual missing board with %s has the correct retry policy and no partial commit',async fault=>{
 let calls=0;
 const presenter:PresenterGeneratorPort={provider:'visual-priority',modelId:'visual-priority',pin:{provider:'visual-priority',model_id:'visual-priority',prompt_version:VISUAL_PRESENTER_PROMPT_VERSION,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION},async generatePresentationDraft(r){
  calls++;expect((r.userPayload as {required_board_bindings:unknown[]}).required_board_bindings.length).toBeGreaterThan(0);
  return {latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:r.request_id,items:[
   {type:'tool_intent',tool:'geometry.annotate',args:{binding_ref:fault==='binding'?'VB-999':'VB-101',params:{form:'angle-arcs',lifetime:'teaching-scope',...(fault==='parameter'?{unauthorized:true}:{})}}},
   {type:'speech',text:'我们先看题目给出的两个相等角。',basis_refs:[fault==='basis'?'FN-999':'FN-03']},
  ]}};
 }};
 const gate=new FixedResponseGateProvider([],'visual-priority');
 const app=TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:new TutorTaskBindingResolver(root,()=>loaded),model:f6Model(gate,'visual-priority'),presenter});
 const result=app.start({task_id:'goldenMinhangFold2020',student_id:'visual-priority',client_instance_id:'CI-visual-priority',client_request_id:`visual-priority-${++serial}`,sessionIdAllocator:()=>`TS-9977600${serial}`});if(result.kind==='payload-drift')throw Error('drift');
 const s=result.orchestrator,before=s.events.length;const outcome=await s.drivePendingGeneration();
 expect(outcome).toMatchObject({kind:'failed',errorClass:fault==='omission'?'RETRY_EXHAUSTED':'draft_invalid'});
 expect(calls).toBe(fault==='omission'?3:1);expect(gate.callCount).toBe(0);
 const delta=s.events.slice(before);expect(delta.filter(e=>e.event_type==='presentation_sequence_planned'||e.event_type==='presentation_action_applied'||e.event_type==='presentation_action_delivered')).toEqual([]);
 expect(delta.filter(e=>String(e.event_type)==='presentation_generation_retry_scheduled')).toHaveLength(fault==='omission'?2:0);
},15000);
