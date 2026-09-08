import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {buildPresenterPrompt,V7_VISUAL_PRESENTER_PROMPT_VERSION,V7_VISUAL_PRESENTER_SYSTEM_PROMPT,VISUAL_PRESENTER_PROMPT_VERSION,VISUAL_PRESENTER_SYSTEM_PROMPT,LEGACY_VISUAL_PRESENTER_PROMPT_VERSION,PREVIOUS_VISUAL_PRESENTER_PROMPT_VERSION,usesVisualV7PresentationPolicy,usesVisualFractionFormatGuard,isVisualPresenterPromptVersion} from '../PresenterPrompts';
import {structuredPresenterGenerator,type PresenterGeneratorPort} from '../GeneratorPort';
import type {StructuredModelPort} from '../../../tutorIntelligence/structuredModelPort';
import {buildPresentationContext,DEFAULT_CONTEXT_POLICY} from '../ContextBuilder';
import {TutorRuntimeApplicationV7} from '../../TutorRuntimeApplicationV7';
import {TutorTaskBindingResolver} from '../../TutorTaskBindingResolver';
import {importVisualReviewCandidate} from '../../../planBuild/visual/ImportVisualReviewCandidate';
import {FixedResponseGateProvider} from '../../../tutorNavigator/ModelGateAdjudicatorV5';
import {f6Model,realCanonicalRoot} from '../../__tests__/f6Support';
const old=V7_VISUAL_PRESENTER_PROMPT_VERSION,next=VISUAL_PRESENTER_PROMPT_VERSION;
it('v7 exact real-trace bytes stay frozen; v8 appends only form obligations and preserves payload',()=>{
 expect(createHash('sha256').update(V7_VISUAL_PRESENTER_SYSTEM_PROMPT).digest('hex')).toBe('60c2a4adb2dd5aa95b508b455a1a916e54ba056e309ad8160a28b97025cbd4de');
 expect(VISUAL_PRESENTER_SYSTEM_PROMPT.startsWith(V7_VISUAL_PRESENTER_SYSTEM_PROMPT+'\n28.')).toBe(true);
 expect(VISUAL_PRESENTER_SYSTEM_PROMPT).toContain('required_pair_indices 为空只表示没有逐对强调义务，不能省略 forms');
 expect(VISUAL_PRESENTER_SYSTEM_PROMPT).toContain('每个 form 都须输出该 binding_ref 的 geometry.annotate');
 const context=buildPresentationContext({planRef:{artifact_id:'TP-SMV-009',version:'v14',content_hash:`sha256:${'a'.repeat(64)}`},graphRef:{artifact_id:'RG-SMV-001',version:'v8',content_hash:`sha256:${'b'.repeat(64)}`},graph:{facts:new Map([['FN-01',{fact_id:'FN-01',role:'derived',statement:'AB=2',reveals_answer:false}]]),inferences:new Map()},beat:{protocol_id:'PR-SMV-001',beat_id:'BT-02',graph_fact_refs:['FN-01'],inference_refs:[],resource_ids:[]},recentInputs:[],eventCutoff:1,workspaceRevision:0,currentRevision:1,policy:DEFAULT_CONTEXT_POLICY,sessionMode:'teaching'});
 const prompt=(promptVersion:string)=>buildPresenterPrompt({promptVersion,context,instructionalGoal:'approved relation',currentGranularity:'beat',alreadyPresented:[],stuckPoint:null,visibleTools:[],maxItems:31,maxSpeechChars:400,factRoles:[{fact_id:'FN-01',role:'derived'}],requiredBoardBindings:[{binding_ref:'VB-08',note_kind:'approved_math_note'}]});
 expect(prompt(old).systemPrompt).toBe(V7_VISUAL_PRESENTER_SYSTEM_PROMPT);expect(prompt(next).systemPrompt).toBe(VISUAL_PRESENTER_SYSTEM_PROMPT);
 expect(prompt(old).userPayload).toEqual(prompt(next).userPayload);expect(prompt(old).userPayload.fact_roles).toEqual([{fact_id:'FN-01',role:'derived'}]);expect(prompt(next).userPayload.output_budget).toEqual({max_items:31,max_speech_chars:400});
});
it.each([LEGACY_VISUAL_PRESENTER_PROMPT_VERSION,PREVIOUS_VISUAL_PRESENTER_PROMPT_VERSION,old,next])('explicit %s feature and factory policy is preserved',version=>{
 expect(isVisualPresenterPromptVersion(version)).toBe(true);expect(usesVisualV7PresentationPolicy(version)).toBe([old,next].includes(version));expect(usesVisualFractionFormatGuard(version)).toBe(version!==LEGACY_VISUAL_PRESENTER_PROMPT_VERSION);
 expect(structuredPresenterGenerator({provider:'offline',modelId:'offline'} as StructuredModelPort,{promptVersion:version}).pin.prompt_version).toBe(version);
});
it.each([[old,next],[next,old]])('restore %s with %s refuses pin drift before events or provider calls',async(from,to)=>{
 const root=realCanonicalRoot();const loaded=importVisualReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});if(!loaded.ok)throw Error(loaded.errors.join(';'));
 const call=vi.fn();const port=(version:string):PresenterGeneratorPort=>({...structuredPresenterGenerator({provider:'offline',modelId:'offline'} as StructuredModelPort,{promptVersion:version}),generatePresentationDraft:call});
 const model=f6Model(new FixedResponseGateProvider([],'v8-pin'),'v8-pin');const app=(version:string)=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:new TutorTaskBindingResolver(root,()=>loaded),model,presenter:port(version)});
 const started=app(from).start({task_id:'goldenMinhangFold2020',student_id:'v8-pin',client_instance_id:'CI-v8-pin',client_request_id:`v8-pin-${from}`,sessionIdAllocator:()=>from===old?'TS-99778001':'TS-99778002'});if(started.kind==='payload-drift')throw Error('drift');
 const s=started.orchestrator,before=structuredClone(s.events);expect(()=>app(to).restore(s.sessionId)).toThrow(/PRESENTER_PIN_MISMATCH|presenter.*pin|prompt_version/i);
 expect(app(from).restore(s.sessionId).events).toEqual(before);expect(s.events).toEqual(before);expect(call).not.toHaveBeenCalled();
});
