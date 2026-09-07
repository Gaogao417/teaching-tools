import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { applyDomainCommands, WorldCommandError, type DomainCommand } from '../../../../../../shared/actionWorld';
import { importVisualReviewCandidate } from '../../../planBuild/visual/ImportVisualReviewCandidate';
import { realCanonicalRoot } from '../../../tutorNavigator/__tests__/navigatorSupport';
import { buildGoldenWorkspaceCatalogV5 } from '../../GoldenWorkspaceCatalog';
import { buildNavigatorPlan } from '../../../tutorNavigator/NavigatorPlanV5';
import { resolveBeatConstructions } from '../../WorkspaceActionAdjudication';
import { buildPresentationContext, CONTEXT_BUILDER_VERSION, DEFAULT_CONTEXT_POLICY } from '../ContextBuilder';
import { visiblePresentationTools, PRESENTATION_TOOL_CATALOG_VERSION, type PresentationResourceBinding } from '../PresentationToolCatalog';
import { compilePresentationIntents, IntentCompilerError, type IntentCompilerInput, type VisualCompilationInput } from '../IntentCompiler';
import { VISUAL_PRESENTER_PROMPT_VERSION, PRESENTER_PROMPT_VERSION } from '../PresenterPrompts';
import { VISUAL_CONTEXT_BUILDER_VERSION, VISUAL_TOOL_CATALOG_VERSION } from '../VisualPresentationTools';
import { emptyVisualState } from '../../../tutorSession/WorkspaceVisualReducer';
import { createPinnedVisualWorkspaceBridge, projectVisualView } from '../../../tutorSession/VisualViewProjector';
import { preflightPresentationSequence } from '../SequencePreflight';
import type { StoredSessionEvent } from '../../../tutorSession/kernel/sessionKernelTypes';

const loaded=importVisualReviewCandidate({canonicalRoot:realCanonicalRoot(),candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});
if(!loaded.ok)throw Error(loaded.errors.join(';'));
const imported=loaded.imported,catalog=loaded.visual.catalog,workspace=buildGoldenWorkspaceCatalogV5(imported).catalog;
const plan=buildNavigatorPlan(imported),beat=imported.protocols.get('PR-SMV-001')!.beats.find(b=>b.beat_id==='BT-04')!;
const scope={kind:'approved' as const,protocol_id:'PR-SMV-001',beat_id:'BT-04'},owner={scope,scope_epoch:4,part_ref:'1'};
const graph={facts:new Map(imported.graph.facts.map(f=>[f.fact_id,f])),inferences:new Map(imported.graph.inferences.map(i=>[i.inference_id,i]))};
const commands=resolveBeatConstructions(imported.plan.resources,{resource_ids:beat.resource_ids} as never)!;
const visibleTools=visiblePresentationTools({registeredCapabilities:new Set(['geometry.construct']),bindings:(imported.plan.resource_bindings??[]) as PresentationResourceBinding[],sessionMode:'teaching',scopeAllows:b=>b.binding_kind==='geometry'});
const item=(binding_ref:string)=>{
 const binding=(imported.plan.resource_bindings??[]).find(b=>b.binding_id===binding_ref);
 if(binding?.binding_kind!=='geometry')throw Error('missing real construction binding');
 return {type:'tool_intent' as const,tool:'geometry.construct',args:{binding_ref,params:{template_id:binding.allowed_template_ids[0]}}};
};
function inputFor(ids:string[],restored=false):IntentCompilerInput & {visual:VisualCompilationInput}{
 const seed={revision:0,geometry:structuredClone(workspace.baseGeometry)};
 const stamped={...commands[0],commandId:'cmd-prior-construct',actionId:'WSA-prior-construct'} as DomainCommand;
 const world=restored?applyDomainCommands(seed,[stamped]):seed;
 const permission={existingPoints:new Map(world.geometry!.points.map(p=>[p.id,{x:p.x,y:p.y}])),completedConstructions:new Set(restored?['VB-01']:[]),revealAuthorized:()=>true};
 const state=emptyVisualState();
 const context=buildPresentationContext({planRef:plan.tutor_plan_ref,graphRef:plan.solution_graph_ref,graph,beat:{protocol_id:scope.protocol_id,beat_id:scope.beat_id,graph_fact_refs:beat.solution_refs.fact_ids,inference_refs:beat.solution_refs.inference_ids,resource_ids:beat.resource_ids??[]},recentInputs:[],eventCutoff:4,workspaceRevision:world.revision,currentRevision:4,policy:{...DEFAULT_CONTEXT_POLICY,max_total_chars:16000},sessionMode:'teaching',resourceContent:id=>imported.plan.resources.find(r=>r.resource_id===id)?.content});
 return {sessionId:'TS-957001',sequenceSerial:1,decisionId:'TD-957001-0001',scope,
  request:{request_id:'GR-957001-0001',attempt:1,epoch:1,input_digest:context.digest,presenter_pin:{provider:'offline',model_id:'offline',prompt_version:VISUAL_PRESENTER_PROMPT_VERSION,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION}},
  draft:{schema:'ai_teaching_presentation_draft/v2',request_id:'GR-957001-0001',items:ids.map(item)},context,visibleTools,resources:new Map(imported.plan.resources.map(r=>[r.resource_id,r])),graph,approvedConstructions:commands,revealAuthorized:()=>false,
  visual:{catalog,state,owner,permission,constructionWorld:world,requirements:[],visibleTools:[],alreadyPresented:projectVisualView(state,catalog,{...permission,currentOwner:owner,ownerAuthorized:()=>true})}};
}
function rejection(input:ReturnType<typeof inputFor>,code:string){
 const before=structuredClone({world:input.visual.constructionWorld,state:input.visual.state,points:input.visual.permission.existingPoints,completed:input.visual.permission.completedConstructions});
 let caught:unknown;try{compilePresentationIntents(input);}catch(error){caught=error;}
 expect(caught).toBeInstanceOf(IntentCompilerError);
 expect(caught).not.toBeInstanceOf(WorldCommandError);
 expect(caught).toMatchObject({code:'ILLEGAL_TARGET'});
 expect((caught as Error).message).toContain(code);
 expect({world:input.visual.constructionWorld,state:input.visual.state,points:input.visual.permission.existingPoints,completed:input.visual.permission.completedConstructions}).toEqual(before);
}
describe('visual construction simulation produces deterministic compiler rejection',()=>{
 it('missing O dependency uses the actual domain failure, without partial effects',()=>{
  const input=inputFor(['VB-02']);
  expect(()=>applyDomainCommands(input.visual.constructionWorld!,[{...commands[1],commandId:'cmd-missing-O',actionId:'WSA-missing-O'} as DomainCommand])).toThrow(WorldCommandError);
  rejection(input,'missing-reference');
  expect(compilePresentationIntents(inputFor(['VB-01','VB-02'])).actions).toHaveLength(2);
 });
 it('duplicate output after a valid construction rejects the entire candidate',()=>rejection(inputFor(['VB-01','VB-01']),'duplicate-output'));
 it('restored real O rejects a repeated visible construction deterministically',()=>rejection(inputFor(['VB-01'],true),'duplicate-output'));
 it('restored O still permits a new dependent carrier, without mutating the frozen world',()=>{
  const input=inputFor(['VB-02'],true),before=structuredClone(input.visual.constructionWorld);
  expect(compilePresentationIntents(input).actions).toHaveLength(1);
  expect(input.visual.constructionWorld).toEqual(before);
 });
 it('old pin retains deferred simulation: compiler output unchanged, real preflight still rejects duplicate',()=>{
  const {visual,...base}=inputFor(['VB-01','VB-01']);
  const legacy={...base,request:{...base.request,presenter_pin:{...base.request.presenter_pin,prompt_version:PRESENTER_PROMPT_VERSION,context_builder_version:CONTEXT_BUILDER_VERSION,tool_catalog_version:PRESENTATION_TOOL_CATALOG_VERSION}}};
  const compiled=compilePresentationIntents(legacy);expect(compiled.schema).toBe('ai_teaching_presentation_plan/v4');expect(compiled.actions).toHaveLength(2);
  const events:StoredSessionEvent[]=[{event_type:'session_started',payload:{initial_cursor:scope,task_id:workspace.taskId,protocol_refs:[{artifact_id:scope.protocol_id}],session_mode:'teaching'}},{event_type:'policy_decision_made',payload:{decision_id:base.decisionId,protocol_id:scope.protocol_id,beat_id:scope.beat_id,decision_kind:'execute_beat'}}].map((e,i)=>({...e,session_id:base.sessionId,schema:'ai_teaching_tutor_session_event/v10',sequence:i+1,state_revision:i+1,occurred_at:'2026-09-08T00:00:00Z',idempotency_key:`legacy-simulation-${i}`}));
  const bridge=createPinnedVisualWorkspaceBridge({sessionId:base.sessionId,catalogHash:`sha256:${'a'.repeat(64)}`,catalog,workspaceCatalog:workspace,imported,authorityAt:()=>({currentOwner:owner,activeOwners:[owner]})});
  expect(()=>preflightPresentationSequence({fold:bridge.foldAt(events).workspace,catalog:workspace,plan:compiled})).toThrow(/preflight failed/);
 });
});

// Real SQLite coordinator lifecycle with a synthetic registry and the real v14
// compiler. HTTP/scanner integration is covered separately by Ohm's test.
import { TutorSessionKernelV9 } from '../../../tutorSession/TutorSessionKernelV9';
import { readTutorSessionEventsV9 } from '../../../tutorSession/RuntimeStateRebuilderV9';
import { REF, SHA, sessionStartedPayloadV6, syntheticRegistry } from '../../../tutorSession/__tests__/v6KernelSupport';
import { driveGeneration, reserveGeneration, type GenerationKernelAccess } from '../GenerationCoordinator';
import { PresenterGenerationError } from '../GeneratorPort';

it.each(['ILLEGAL_TARGET','ILLEGAL_PARAM'])('persists %s once; same-process and restored ticks never regenerate', async expectedCode=>{
 const base=inputFor(['VB-01','VB-01']);
 const input=expectedCode==='ILLEGAL_TARGET'?base:{...base,draft:{...base.draft,items:[{type:'speech' as const,text:'DO等于三十二分之十五。'}]}};
 const pin=input.request.presenter_pin;
 const registry=()=>syntheticRegistry();
 const kernel=TutorSessionKernelV9.start({sessionId:expectedCode==='ILLEGAL_TARGET'?'TS-957009':'TS-957010',studentId:'visual-compiler-lifecycle',sessionStarted:{...sessionStartedPayloadV6(),session_mode:'teaching',presenter_generation_pin:pin},occurred_at:new Date().toISOString()},registry);
 const access=(k:TutorSessionKernelV9):GenerationKernelAccess=>({sessionId:k.sessionId,get revision(){return k.revision},get state(){return k.state},append:(revision,events)=>k.append(revision,events)});
 reserveGeneration(access(kernel),{sourceRequestId:'visual-duplicate-output',decisionId:'TD-957009-0001',decisionSequence:1,scope:{kind:'approved',protocol_id:'PR-SMV-002',beat_id:'BT-02'},contextDigest:SHA('visual-duplicate-output'),context:{plan_ref:REF.tutorPlan,graph_ref:REF.solutionGraph,selected_fact_ids:['FN-14'],selected_inference_ids:['IF-12'],resource_ids:['RES3'],event_cutoff:kernel.revision,workspace_revision:0},inputText:null,presenterPin:pin});
 let calls=0;
 const compilerCodes:string[]=[];
 const pipeline={buildAndRun:async()=>{
  calls++;
  try{compilePresentationIntents(input);throw new Error('expected invalid candidate to be rejected')}
  catch(error){
   // The existing orchestrator adapter preserves the canonical failure class;
   // ILLEGAL_TARGET is the compiler code, not a new generation error_class.
   if(error instanceof IntentCompilerError){compilerCodes.push(error.code);throw new PresenterGenerationError('draft_invalid',error.message,false)}
   throw error;
  }
 }};
 const dependencies={causationSequence:1,sleep:async()=>undefined};
 expect(await driveGeneration(access(kernel),pipeline,dependencies)).toEqual({kind:'failed',errorClass:'draft_invalid'});
 expect(compilerCodes).toEqual([expectedCode]);
 const persisted=readTutorSessionEventsV9(kernel.sessionId,registry);
 const failures=persisted.filter(e=>e.event_type==='presentation_generation_failed');
 expect(failures).toHaveLength(1);
 expect(failures[0].payload).toMatchObject({status:'failed',error_class:'draft_invalid',attempt:1});
 expect(persisted.filter(e=>e.event_type==='presentation_generation_attempt_started')).toHaveLength(1);
 expect(persisted.some(e=>e.event_type==='presentation_generation_retry_scheduled'||e.event_type==='presentation_sequence_planned')).toBe(false);
 const revision=kernel.revision;
 expect(await driveGeneration(access(kernel),pipeline,dependencies)).toEqual({kind:'superseded'});
 const restored=TutorSessionKernelV9.resume(kernel.sessionId,registry,{expectedPresenterPin:pin});
 expect(restored.state.generation_requests[0]).toMatchObject({status:'failed',error_class:'draft_invalid',attempt:1});
 for(let tick=0;tick<2;tick++)expect(await driveGeneration(access(restored),pipeline,dependencies)).toEqual({kind:'superseded'});
 expect(calls).toBe(1);
 expect(restored.revision).toBe(revision);
 expect(readTutorSessionEventsV9(kernel.sessionId,registry)).toEqual(persisted);
 expect(restored.assertReplayParity().equal).toBe(true);
});

import { createHash } from 'node:crypto';
import { LEGACY_VISUAL_PRESENTER_PROMPT_VERSION, LEGACY_VISUAL_PRESENTER_SYSTEM_PROMPT, buildPresenterPrompt } from '../PresenterPrompts';
import { structuredPresenterGenerator } from '../GeneratorPort';
import type { StructuredModelPort } from '../../../tutorIntelligence/structuredModelPort';

it('retains the exact v5 prompt bytes and both visual generator/context/tool pins',()=>{
 expect(createHash('sha256').update(LEGACY_VISUAL_PRESENTER_SYSTEM_PROMPT).digest('hex')).toBe('fb272f62ebfaf77f14dc8bbd676f452c90347f02268a93a5c9b674ce282612e7');
 for(const promptVersion of [LEGACY_VISUAL_PRESENTER_PROMPT_VERSION,VISUAL_PRESENTER_PROMPT_VERSION]){
  const generator=structuredPresenterGenerator({provider:'offline',modelId:'offline'} as StructuredModelPort,{promptVersion});
  expect(generator.pin).toMatchObject({prompt_version:promptVersion,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION});
  const prompt=buildPresenterPrompt({promptVersion,context:inputFor([]).context,instructionalGoal:'approved math',currentGranularity:'beat',alreadyPresented:[],stuckPoint:null,visibleTools:[],maxItems:31,maxSpeechChars:2000});
  expect(prompt.promptVersion).toBe(promptVersion);
  if(promptVersion===LEGACY_VISUAL_PRESENTER_PROMPT_VERSION)expect(prompt.systemPrompt).toBe(LEGACY_VISUAL_PRESENTER_SYSTEM_PROMPT);
 }
});
it.each(['DO等于三十二分之十五。','DO等于十五分之三十二。','DO等于32 分 之 15。'])('new pin rejects handwritten fractions without correcting them: %s',text=>{
 const base=inputFor(['VB-01']);const input={...base,draft:{...base.draft,items:[...base.draft.items,{type:'speech' as const,text}]}};
 expect(()=>compilePresentationIntents(input)).toThrow(/handwritten X分之Y/);
 const old={...input,request:{...input.request,presenter_pin:{...input.request.presenter_pin,prompt_version:LEGACY_VISUAL_PRESENTER_PROMPT_VERSION}}};
 expect(compilePresentationIntents(old).actions[1].voice_action?.text).toBe(text);
});
it.each([String.raw`DO=$\frac{32}{15}$。`,String.raw`$\frac{10}{3} - \frac{32}{15} = \frac{6}{5}$`])('preserves standard LaTeX verbatim: %s',text=>{
 const base=inputFor([]);const input={...base,draft:{...base.draft,items:[{type:'speech' as const,text}]}};
 expect(compilePresentationIntents(input).actions[0].voice_action?.text).toBe(text);
});
