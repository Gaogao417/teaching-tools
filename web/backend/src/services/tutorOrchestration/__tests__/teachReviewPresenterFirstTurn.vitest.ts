/** Mechanical regression of the real first-turn failure shape, not model-quality evidence. */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { importReviewCandidate } from '../../planBuild/c1/ImportReviewCandidate';
import { importApprovedPlanV5 } from '../../planBuild/v5/ImportApprovedPlanV5';
import { auditTeachFollowAlongContexts } from '../../planBuild/c1/TeachFollowAlongContextAudit';
import { buildPresenterPrompt, PRESENTER_PROMPT_VERSION, TOOL_INVOCATION_PRESENTER_PROMPT_VERSION, PREVIOUS_PRESENTER_PROMPT_VERSION, LEGACY_PRESENTER_PROMPT_VERSION } from '../presentationGeneration/PresenterPrompts';
import { structuredPresenterGenerator } from '../presentationGeneration/GeneratorPort';
import { toolSpecById } from '../presentationGeneration/PresentationToolCatalog';
import { compilePresentationIntents, type IntentCompilerInput } from '../presentationGeneration/IntentCompiler';
import type { StructuredModelPort, StructuredCompletionRequest } from '../../tutorIntelligence/structuredModelPort';
import { TutorTaskBindingResolver } from '../TutorTaskBindingResolver';
import { TutorRuntimeApplicationV7 } from '../TutorRuntimeApplicationV7';
import { FixedResponseGateProvider } from '../../tutorNavigator/ModelGateAdjudicatorV5';
import { f6Model } from './f6Support';

const root='/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring';
const review=importReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/c1-teach-follow-along/candidate-v13-r3')});
const source=importApprovedPlanV5({canonicalRoot:root},'TP-SMV-009');
if(!review.ok)throw Error(review.errors.join(';'));if(!source.ok)throw Error(source.errors.join(';'));
const imported=review.imported;
const audits=auditTeachFollowAlongContexts({plan:imported.plan,protocols:[...imported.protocols.values()]},source.imported);
const context=audits.find(a=>a.protocol_id==='PR-SMV-001'&&a.beat_id==='BT-01')!;
const binding=imported.plan.resource_bindings!.find(b=>b.binding_id==='VB-06')!;
const visibleTools=[{spec:toolSpecById('board.explain')!,bindings:[binding]}];
const speech={type:'speech' as const,text:'我们先把题目给出的关系看清楚，再把对应关系记下来。',basis_refs:['FN-01']};
const tool=(params:Record<string,unknown>)=>({type:'tool_intent' as const,tool:'board.explain',args:{binding_ref:'VB-06',params}});
const requestId='GR-TS-99120001-0001';
function prompt(version=PRESENTER_PROMPT_VERSION) {
 return buildPresenterPrompt({context,instructionalGoal:imported.protocols.get('PR-SMV-001')!.beats[0].purpose,
  ...(version!==LEGACY_PRESENTER_PROMPT_VERSION?{completionTarget:'follow_along' as const}:{}),promptVersion:version,
  currentGranularity:'beat',alreadyPresented:[],stuckPoint:null,visibleTools,maxItems:8,maxSpeechChars:500});
}
async function generate(items:unknown[],version=PRESENTER_PROMPT_VERSION){
 const calls:StructuredCompletionRequest[]=[];
 const port:StructuredModelPort={provider:'test-only',modelId:'test-only',async complete<T>(request:StructuredCompletionRequest){calls.push(request);return {value:{items} as T,modelId:'test-only',promptVersion:request.promptVersion,latencyMs:1};}};
 const generator=structuredPresenterGenerator(port);
 const built=prompt(version);
 const result=await generator.generatePresentationDraft({request_id:requestId,...built,timeoutMs:100});
 return {draft:result.draft,calls,pin:{...generator.pin,prompt_version:version}};
}
function compile(result:Awaited<ReturnType<typeof generate>>, overrides:Partial<IntentCompilerInput>={}){
 const input:IntentCompilerInput={sessionId:'TS-99120001',sequenceSerial:1,decisionId:'TD-TS-99120001-0001',scope:{kind:'approved',protocol_id:'PR-SMV-001',beat_id:'BT-01'},
 request:{request_id:requestId,attempt:1,epoch:1,input_digest:context.digest,presenter_pin:result.pin},draft:result.draft,context,visibleTools,
 resources:new Map(imported.plan.resources.map(r=>[r.resource_id,r])),graph:{facts:new Map(imported.graph.facts.map(f=>[f.fact_id,f])),inferences:new Map(imported.graph.inferences.map(i=>[i.inference_id,i]))},approvedConstructions:[],revealAuthorized:()=>false,...overrides};
 return compilePresentationIntents(input);
}

describe('Presenter first turn: prompt/adapter/compiler contract',()=>{
 it('new prompt reaches the provider with null stuck point and the actual closed board parameter catalog',async()=>{
  const result=await generate([speech,tool({note_kind:'explanation_text'})]);
  expect(result.calls[0].promptVersion).toBe('presenter-interleaved/v4-board-proof');
  expect(result.calls[0].systemPrompt).toBe(prompt().systemPrompt);
  const payload=result.calls[0].userPayload as any;
  expect(payload.student_stuck_point).toBeNull();expect(payload.already_presented).toEqual([]);
  expect(payload.instructional_goal).toBe(imported.protocols.get('PR-SMV-001')!.beats[0].purpose);
  expect(payload.tools[0].parameters.map((p:any)=>p.name)).toEqual(['note_kind']);
  const compiled=compile(result);
  expect(compiled.explanation_fragments![0].content).toBe(speech.text);
  expect(compiled.explanation_fragments![0].basis_refs).toEqual(binding.binding_kind==='explanation'?[...binding.basis_refs.fact_ids,...binding.basis_refs.inference_ids]:[]);
  expect(compiled.actions.map(a=>a.kind)).toEqual(['voice','workspace']);
  expect(compiled.generation?.presenter_pin.prompt_version).toBe(PRESENTER_PROMPT_VERSION);
 });
 it('actual failure shape params{text,note_kind} stays rejected after adapter validation, without accepting a partial segment',async()=>{
  const result=await generate([speech,tool({note_kind:'explanation_text',text:'模型自写板书正文'})]);
  expect(result.draft.items).toHaveLength(2);
  expect(()=>compile(result)).toThrow(/unknown parameter text/);
 });
 it('approved_math_note renders bound graph facts, not adjacent model prose',async()=>{
  const compiled=compile(await generate([speech,tool({note_kind:'approved_math_note'})]));
  const content=compiled.explanation_fragments![0].content;
  expect(content).not.toBe(speech.text);
  expect(content).toContain(imported.graph.facts.find(f=>f.fact_id==='FN-01')!.statement);
 });
 it('compiled relation note exposes derivation prose without internal IDs while preserving provenance refs',()=>{
  const audit=audits.find(a=>a.protocol_id==='PR-SMV-001'&&a.beat_id==='BT-02')!;
  const b=imported.plan.resource_bindings!.find(b=>b.binding_id==='VB-07')!;
  if(b.binding_kind!=='explanation')throw Error('expected explanation binding');
  const result:Awaited<ReturnType<typeof generate>>={calls:[],pin:{provider:'test-only',model_id:'test-only',prompt_version:PRESENTER_PROMPT_VERSION,context_builder_version:'presentation-context-builder/v1',tool_catalog_version:'presentation-tool-catalog/v1'},
   draft:{schema:'ai_teaching_presentation_draft/v2',request_id:requestId,items:[{type:'tool_intent',tool:'board.explain',args:{binding_ref:b.binding_id,params:{note_kind:'relation_note'}}}]}};
  const compiled=compile(result,{context:audit,scope:{kind:'approved',protocol_id:'PR-SMV-001',beat_id:'BT-02'},visibleTools:[{spec:toolSpecById('board.explain')!,bindings:[b]}]});
  const fragment=compiled.explanation_fragments![0];
  expect(fragment.content).not.toMatch(/\b(?:FN|IF)-\d+\b/);
  for(const id of b.basis_refs.inference_ids)expect(fragment.content).toContain(imported.graph.inferences.find(i=>i.inference_id===id)!.derivation);
  expect(fragment.basis_refs).toEqual([...b.basis_refs.fact_ids,...b.basis_refs.inference_ids]);
  expect(fragment.basis_refs).toContain('IF-01');expect(fragment.basis_refs).toContain('FN-01');
 });
 it('explanation_text without preceding speech fails instead of manufacturing content',async()=>{
  const result=await generate([tool({note_kind:'explanation_text'})]);
  expect(()=>compile(result)).toThrow(/fragment content is empty/);
 });
 it.each([
  [TOOL_INVOCATION_PRESENTER_PROMPT_VERSION,'fa1e6804dcbb197bea9e3cb027fdb82456c119a3a82d8a117ae13b6720062881'],
  [LEGACY_PRESENTER_PROMPT_VERSION,'22868badf150971bc8210dc5f506f50072c41646ea839ea0f26189c3c16271bb'],
  [PREVIOUS_PRESENTER_PROMPT_VERSION,'531f9e1d77ff5532ad41b278dccc8f53ffb62a6d5a352cf469a0ea33f53348f8'],
 ])('frozen %s uses its exact historical prompt and retains its compilation provenance',async(version,hash)=>{
  // Hashes are from the pre-v3 committed source, not computed from the new constants.
  const result=await generate([speech,tool({note_kind:'explanation_text'})],version);
  expect(createHash('sha256').update(result.calls[0].systemPrompt).digest('hex')).toBe(hash);
  expect(result.calls[0].promptVersion).toBe(version);
  expect(compile(result).generation?.presenter_pin.prompt_version).toBe(version);
 });
 it('v2 Draft session restores with its original presenter pin; v3 replacement fails closed without writes',()=>{
  const bindingResolver=new TutorTaskBindingResolver(root,()=>review);
  const gate=new FixedResponseGateProvider([],'old-presenter-pin-test');const model=f6Model(gate,'old-presenter-pin-test');
  const oldPresenter={provider:'test-only',modelId:'test-only',pin:{provider:'test-only',model_id:'test-only',prompt_version:PREVIOUS_PRESENTER_PROMPT_VERSION,context_builder_version:'presentation-context-builder/v1',tool_catalog_version:'presentation-tool-catalog/v1'},async generatePresentationDraft():Promise<never>{throw Error('restore must not call provider');}};
  const oldApp=()=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver,model,presenter:oldPresenter});
  const result=oldApp().start({task_id:'goldenMinhangFold2020',student_id:'pin-test',client_request_id:'old-presenter-draft',sessionIdAllocator:()=> 'TS-99120002'});
  if(result.kind==='payload-drift')throw Error('unexpected drift');
  const session=result.orchestrator;const events=structuredClone(session.events);
  expect(oldApp().restore(session.sessionId).events).toEqual(events);
  const current=TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver,model,presenter:{...oldPresenter,pin:{...oldPresenter.pin,prompt_version:PRESENTER_PROMPT_VERSION}}});
  expect(()=>current.restore(session.sessionId)).toThrow(/presenter.*pin/i);
  expect(oldApp().restore(session.sessionId).events).toEqual(events);
 });
});
