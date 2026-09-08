import {remainingVisualConstructionTools} from '../../../tutorOrchestration/presentationGeneration/FrozenVisualGeneration';
import {preflightPresentationSequence} from '../../../tutorOrchestration/presentationGeneration/SequencePreflight';
import type {StoredSessionEvent} from '../../../tutorSession/kernel/sessionKernelTypes';
import {it,expect,vi,afterEach} from 'vitest';
import {join} from 'node:path';
import {importVisualReviewCandidate} from '../../../planBuild/visual/ImportVisualReviewCandidate';
import {realCanonicalRoot} from '../../../tutorNavigator/__tests__/navigatorSupport';
import {buildGoldenWorkspaceCatalogV5} from '../../../tutorOrchestration/GoldenWorkspaceCatalog';
import {buildNavigatorPlan} from '../../../tutorNavigator/NavigatorPlanV5';
import {resolveBeatConstructions} from '../../../tutorOrchestration/WorkspaceActionAdjudication';
import {buildPresentationContext,DEFAULT_CONTEXT_POLICY} from '../../../tutorOrchestration/presentationGeneration/ContextBuilder';
import {compilePresentationIntents, type IntentCompilerInput} from '../../../tutorOrchestration/presentationGeneration/IntentCompiler';
import {visiblePresentationTools} from '../../../tutorOrchestration/presentationGeneration/PresentationToolCatalog';
import {requiredBoardBindings} from '../../../tutorOrchestration/presentationGeneration/BoardProofCompleteness';
import {visibleVisualTools,VISUAL_CONTEXT_BUILDER_VERSION,VISUAL_TOOL_CATALOG_VERSION} from '../../../tutorOrchestration/presentationGeneration/VisualPresentationTools';
import {V7_VISUAL_PRESENTER_PROMPT_VERSION as VISUAL_PRESENTER_PROMPT_VERSION} from '../../../tutorOrchestration/presentationGeneration/PresenterPrompts';
import {emptyVisualState} from '../../../tutorSession/WorkspaceVisualReducer';
import {createPinnedVisualWorkspaceBridge,projectVisualView} from '../../../tutorSession/VisualViewProjector';
import type {PresentationResourceBinding} from '../../../tutorOrchestration/presentationGeneration/PresentationToolCatalog';
function compileRecorded(version=VISUAL_PRESENTER_PROMPT_VERSION){
 const loaded=importVisualReviewCandidate({canonicalRoot:realCanonicalRoot(),candidateDirectory:join(process.cwd(),'src/services/planBuild/review/geometry-visual/candidate-v14')});if(!loaded.ok)throw Error(loaded.errors.join(';'));
 const imported=loaded.imported,workspace=buildGoldenWorkspaceCatalogV5(imported).catalog,plan=buildNavigatorPlan(imported);
 const protocol=imported.protocols.get('PR-SMV-001')!,beat=protocol.beats.find(b=>b.beat_id==='BT-04')!;
 const scope={kind:'approved' as const,protocol_id:protocol.protocol_id,beat_id:beat.beat_id};
 const owner={scope,scope_epoch:4,part_ref:'1'},catalog=loaded.visual.catalog;
 const graph={facts:new Map(imported.graph.facts.map(f=>[f.fact_id,f])),inferences:new Map(imported.graph.inferences.map(i=>[i.inference_id,i]))};
 const context=buildPresentationContext({planRef:plan.tutor_plan_ref,graphRef:plan.solution_graph_ref,graph,beat:{protocol_id:protocol.protocol_id,beat_id:beat.beat_id,graph_fact_refs:beat.solution_refs.fact_ids,inference_refs:beat.solution_refs.inference_ids,resource_ids:beat.resource_ids??[]},recentInputs:[],eventCutoff:4,workspaceRevision:0,currentRevision:4,policy:{...DEFAULT_CONTEXT_POLICY,max_total_chars:16000},sessionMode:'teaching',resourceContent:id=>imported.plan.resources.find(r=>r.resource_id===id)?.content});
 const ordinary=visiblePresentationTools({registeredCapabilities:new Set(['geometry.construct','solution_board.explain_fragment','board.explain']),bindings:(imported.plan.resource_bindings??[]) as PresentationResourceBinding[],sessionMode:'teaching',scopeAllows:b=>b.binding_kind==='geometry'||b.binding_kind==='explanation'&&(beat.resource_ids??[]).includes(b.presentation_resource)});
 const permission={completedConstructions:new Set<string>(),existingPoints:new Map(workspace.baseGeometry!.points.map(p=>[p.id,{x:p.x,y:p.y}])),revealAuthorized:()=>true};
 const requirements=loaded.visual.requirements.filter(r=>r.scope.kind==='approved'&&r.scope.beat_id==='BT-04');
 const tools=visibleVisualTools({bindings:catalog.list(),scope,sessionMode:'teaching',registeredCapabilities:new Set(['geometry.visual.upsert','geometry.visual.focus','geometry.visual.close-group']),revealAuthorized:()=>true});
 const items = recorded.items as IntentCompilerInput['draft']['items'];
 const input:IntentCompilerInput={sessionId:'TS-9400',sequenceSerial:1,decisionId:'TD-9400-0001',scope,request:{request_id:'GR-9400-0001',attempt:1,epoch:1,input_digest:context.digest,presenter_pin:{provider:'offline',model_id:'offline',prompt_version:version,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION}},draft:{schema:'ai_teaching_presentation_draft/v2',request_id:'GR-9400-0001',items},context,visibleTools:ordinary,resources:new Map(imported.plan.resources.map(r=>[r.resource_id,r])),graph,approvedConstructions:resolveBeatConstructions(imported.plan.resources,{resource_ids:beat.resource_ids} as never)??[],revealAuthorized:()=>false};
 const visual={catalog,state:emptyVisualState(),owner,permission,constructionWorld:{revision:0,geometry:workspace.baseGeometry},requirements,alreadyPresented:projectVisualView(emptyVisualState(),catalog,{...permission,currentOwner:owner,ownerAuthorized:()=>true}),visibleTools:tools};

 return compilePresentationIntents({...input,visual});
}
// Recorded, unedited model draft from teach-live-review-9SbBJT/presenter.jsonl,
// GR-TS-178881766677401-0004. Replayed offline; no new model sampling.
import recorded from './visualV7RecordedBT04.json';
import { normalizeVisualVoiceFractions } from '../IntentCompiler';
import { LEGACY_VISUAL_PRESENTER_PROMPT_VERSION,PREVIOUS_VISUAL_PRESENTER_PROMPT_VERSION } from '../PresenterPrompts';
import { EventEmitter } from 'node:events';
import { createApp } from '../../../../app';
import { narrationApplication } from '../../../coach/composition';

afterEach(()=>vi.restoreAllMocks());
it('recorded real 28-item BT04 compiles unchanged actions/basis; only v7 voice fractions normalize',()=>{
 expect(recorded.items).toHaveLength(28);
 const raw=JSON.stringify(recorded),v7=compileRecorded();
 for(const version of [LEGACY_VISUAL_PRESENTER_PROMPT_VERSION,PREVIOUS_VISUAL_PRESENTER_PROMPT_VERSION]){
  const old=compileRecorded(version);
  expect(old.actions.filter(a=>a.kind==='voice').map(a=>a.voice_action!.text)).toEqual(recorded.items.filter(i=>i.type==='speech').map(i=>i.text));
  expect(v7.actions.map((a,i)=>a.kind==='voice'?{...a,voice_action:{...a.voice_action,text:old.actions[i].voice_action!.text}}:a)).toEqual(old.actions);
 }
 expect(v7.actions.filter(a=>a.kind==='voice').map(a=>a.voice_action!.text)).toContain(String.raw`由点序 B-O-D，BO = BD - DO = $\frac{10}{3}$ - $\frac{32}{15}$ = $\frac{6}{5}$。`);
 expect(JSON.stringify(recorded)).toBe(raw);
});
it.each(['/api/action-speech','/api/action-speech-stream'])('recorded compiled voices reach %s with denominator-first fractions and subtraction',async path=>{
 const boundary=new Error('offline TTS capture');
 const synth=vi.spyOn(narrationApplication,'synthesize').mockRejectedValue(boundary);
 const stream=vi.spyOn(narrationApplication,'stream').mockRejectedValue(boundary);
 const app=createApp();
 const router=(app as unknown as {_router:{stack:Array<{route?:{path:string;stack:Array<{handle:Function}>}}>}})._router;
 const handle=router.stack.find(layer=>layer.route?.path===path)!.route!.stack[0].handle;
 const voices=compileRecorded().actions.filter(a=>a.kind==='voice').map(a=>a.voice_action!.text);
 for(const [text,expected] of [[voices.find(t=>t.startsWith('由 DO:DA'))!,'DO 等于 15 分之 32'],[voices.find(t=>t.startsWith('由 AO:BA'))!,'AO 等于 5 分之 16'],[voices.find(t=>t.startsWith('由点序 B-O-D'))!,'3 分之 10 减 15 分之 32 等于 5 分之 6'],[voices.find(t=>t.startsWith('由点序 A-O-E'))!,'4 减 5 分之 16 等于 5 分之 4'],[normalizeVisualVoiceFractions('10/3-32/15=6/5'),'3 分之 10 减 15 分之 32 等于 5 分之 6']]){
  const response=Object.assign(new EventEmitter(),{writableEnded:false,destroyed:false,headersSent:false,status:vi.fn(),setHeader:vi.fn(),flushHeaders:vi.fn()});
  const next=vi.fn();await handle({body:{text}},response,next);
  expect(next).toHaveBeenLastCalledWith(boundary);
  expect((path.endsWith('-stream')?stream:synth).mock.calls.at(-1)![0]).toContain(expected);
 }
});
it.each(['32/15','10/3 - 32/15 = 6/5','10/3-32/15=6/5','001/02'])('normalization is idempotent and preserves integer tokens: %s',text=>{
 const normalized=normalizeVisualVoiceFractions(text);
 expect(normalized).not.toContain(String.fromCharCode(12));
 expect(normalized).toContain(String.fromCharCode(92)+'frac');
 expect(normalizeVisualVoiceFractions(normalized)).toBe(normalized);
 expect(normalized.replace(/\$\\frac\{([0-9]+)\}\{([0-9]+)\}\$/g,'$1/$2')).toBe(text);
});
it.each(['1/2/3','1.2/3','AB/CD','https://example.com','32 / 15 / 2','$32/15$','2^3/4','3/4^2','2 ^ 3/4','3/4 ^ 2','2^{3/4}','(1+2)/3','2(3/4)'])('ambiguous or unsupported slash fails closed: %s',text=>{
 expect(()=>normalizeVisualVoiceFractions(text)).toThrow(/slash/);
});
it('existing LaTeX stays byte-identical, including nested fractions',()=>{
 for(const text of [String.raw`$\frac{32}{15}$`,String.raw`\(\frac{1}{\frac{2}{3}}\)`,String.raw`\frac{32}{15}`])expect(normalizeVisualVoiceFractions(text)).toBe(text);
});
