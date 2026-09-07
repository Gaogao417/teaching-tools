import {preflightPresentationSequence} from '../../../tutorOrchestration/presentationGeneration/SequencePreflight';
import type {StoredSessionEvent} from '../../../tutorSession/kernel/sessionKernelTypes';
import {it,expect} from 'vitest';
import {join} from 'node:path';
import {importVisualReviewCandidate} from '../ImportVisualReviewCandidate';
import {realCanonicalRoot} from '../../../tutorNavigator/__tests__/navigatorSupport';
import {buildGoldenWorkspaceCatalogV5} from '../../../tutorOrchestration/GoldenWorkspaceCatalog';
import {buildNavigatorPlan} from '../../../tutorNavigator/NavigatorPlanV5';
import {resolveBeatConstructions} from '../../../tutorOrchestration/WorkspaceActionAdjudication';
import {buildPresentationContext,DEFAULT_CONTEXT_POLICY} from '../../../tutorOrchestration/presentationGeneration/ContextBuilder';
import {compilePresentationIntents, type IntentCompilerInput} from '../../../tutorOrchestration/presentationGeneration/IntentCompiler';
import {visiblePresentationTools} from '../../../tutorOrchestration/presentationGeneration/PresentationToolCatalog';
import {requiredBoardBindings} from '../../../tutorOrchestration/presentationGeneration/BoardProofCompleteness';
import {visibleVisualTools,VISUAL_CONTEXT_BUILDER_VERSION,VISUAL_TOOL_CATALOG_VERSION} from '../../../tutorOrchestration/presentationGeneration/VisualPresentationTools';
import {VISUAL_PRESENTER_PROMPT_VERSION} from '../../../tutorOrchestration/presentationGeneration/PresenterPrompts';
import {emptyVisualState} from '../../../tutorSession/WorkspaceVisualReducer';
import {createPinnedVisualWorkspaceBridge,projectVisualView} from '../../../tutorSession/VisualViewProjector';
import type {PresentationResourceBinding} from '../../../tutorOrchestration/presentationGeneration/PresentationToolCatalog';
function checkBT04Cache(branchCase=false){
 const loaded=importVisualReviewCandidate({canonicalRoot:realCanonicalRoot(),candidateDirectory:join(__dirname,'../../review/geometry-visual/candidate-v14')});if(!loaded.ok)throw Error(loaded.errors.join(';'));
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
 const items:IntentCompilerInput['draft']['items']=[];
 const tool=(tool:string,binding_ref:string|undefined,params:Record<string,unknown>)=>items.push({type:'tool_intent',tool,args:{...(binding_ref?{binding_ref}:{}),params}});
 for(const id of ['VB-01','VB-02','VB-03','VB-04','VB-05']){const binding=(imported.plan.resource_bindings??[]).find(b=>b.binding_id===id);if(binding?.binding_kind!=='geometry')throw Error('construction binding missing');tool('geometry.construct',id,{template_id:binding.allowed_template_ids[0]});}
 for(const r of requirements){
  for(const form of r.forms)if(form!=='paired-sides')tool('geometry.annotate',r.binding_ref,{form,lifetime:'teaching-scope'});
  for(const pair_index of r.required_pair_indices)tool('geometry.emphasize',r.binding_ref,{group:'pairs',mode:'pulse',pair_index});
 }
 items.push({type:'speech',text:'由第二组相似，依次得到这四条线段的长度。',basis_refs:requirements.map(r=>r.binding_ref)});
 for(const b of requiredBoardBindings({visibleTools:ordinary,graph,alreadyPresentedBoardContent:[]}))tool('board.explain',b.binding_ref,{note_kind:'approved_math_note'});
 const input:IntentCompilerInput={sessionId:'TS-9400',sequenceSerial:1,decisionId:'TD-9400-0001',scope,request:{request_id:'GR-9400-0001',attempt:1,epoch:1,input_digest:context.digest,presenter_pin:{provider:'offline',model_id:'offline',prompt_version:VISUAL_PRESENTER_PROMPT_VERSION,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION}},draft:{schema:'ai_teaching_presentation_draft/v2',request_id:'GR-9400-0001',items},context,visibleTools:ordinary,resources:new Map(imported.plan.resources.map(r=>[r.resource_id,r])),graph,approvedConstructions:resolveBeatConstructions(imported.plan.resources,{resource_ids:beat.resource_ids} as never)??[],revealAuthorized:()=>false};
 const visual={catalog,state:emptyVisualState(),owner,permission,constructionWorld:{revision:0,geometry:workspace.baseGeometry},requirements,alreadyPresented:projectVisualView(emptyVisualState(),catalog,{...permission,currentOwner:owner,ownerAuthorized:()=>true}),visibleTools:tools};
 const compiled=compilePresentationIntents({...input,visual});
 const bridge=createPinnedVisualWorkspaceBridge({sessionId:'TS-9400',catalogHash:`sha256:${'a'.repeat(64)}`,catalog,workspaceCatalog:workspace,imported,authorityAt:()=>({currentOwner:owner,activeOwners:[owner]})});
 const history=[{session_id:'TS-9400',sequence:1,state_revision:1,event_type:'session_started',payload:{initial_cursor:{protocol_id:'PR-SMV-001',beat_id:'BT-04'},task_id:workspace.taskId,protocol_refs:[{artifact_id:'PR-SMV-001'}],session_mode:'teaching'}},{session_id:'TS-9400',sequence:2,state_revision:2,event_type:'policy_decision_made',payload:{decision_id:'TD-9400-0001',protocol_id:'PR-SMV-001',beat_id:'BT-04',decision_kind:'execute_beat'}}].map(e=>({...e,schema:'ai_teaching_tutor_session_event/v10',occurred_at:'2026-09-08T00:00:00Z',idempotency_key:`capacity-${e.sequence}`})) satisfies StoredSessionEvent[];
 const fold=bridge.foldAt(history).workspace;
 expect(preflightPresentationSequence({fold,catalog:workspace,plan:compiled,visual}).ok).toBe(true);
 expect(fold.state.revision).toBe(0);
 // Exercise cached prefixes through real legacy construction/board lineage as
 // well as visual actions. Cloning only enumerable state loses V7 WeakMap data.
 const stream:StoredSessionEvent[]=[...history];
 const append=(event_type:string,payload:Record<string,unknown>)=>stream.push({session_id:'TS-9400',schema:'ai_teaching_tutor_session_event/v10',sequence:stream.length+1,state_revision:stream.length+1,occurred_at:'2026-09-08T00:00:00Z',idempotency_key:`capacity-stream-${stream.length}`,event_type,payload});
 const {schema:planSchema,session_id:planSession,...planned}=compiled;
 append('presentation_sequence_planned',planned);
 bridge.foldAt(stream);
 if(branchCase){
  const prefix=structuredClone(stream),baseline=bridge.foldAt(prefix);
  const constructs=compiled.actions.filter(a=>a.workspace_action?.capability==='geometry.construct');
  const board=compiled.actions.find(a=>a.workspace_action?.capability==='board.explain')!;
  const applied=(action:typeof board,offset:number,revision:number):StoredSessionEvent=>({
   ...prefix.at(-1)!,sequence:prefix.length+offset,state_revision:prefix.length+offset,idempotency_key:`branch-${offset}`,
   event_type:'presentation_action_applied',payload:{sequence_id:compiled.sequence_id,ordinal:action.ordinal,action_id:action.workspace_action!.action_id,kind:'workspace',resulting_workspace_revision:revision}});
  // One speculative fold: legal geometry AND board effects occur before the
  // duplicate applied fails. Neither effects nor V7 WeakMap lineage may escape.
  const failed=[...prefix,applied(constructs[0],1,1),applied(board,2,2),applied(constructs[0],3,3)];
  expect(()=>bridge.foldAt(failed)).toThrow();
  expect(bridge.foldAt(prefix)).toEqual(baseline);
  // Competing valid suffix starts at the exact same sequence/revision, but uses
  // another construction instead of the board from the abandoned branch.
  const alternate=[...prefix,applied(constructs[0],1,1),applied(constructs[1],2,2)];
  const resumed=bridge.foldAt(alternate);
  const cold=createPinnedVisualWorkspaceBridge({sessionId:'TS-9400',catalogHash:`sha256:${'a'.repeat(64)}`,catalog,workspaceCatalog:workspace,imported,authorityAt:()=>({currentOwner:owner,activeOwners:[owner]})});
  expect(resumed).toEqual(cold.foldAt(alternate));
  expect(resumed.workspace.context.tutorCommands).toHaveLength(baseline.workspace.context.tutorCommands.length+2);
  expect(resumed.workspace.state.solution_board).toEqual(baseline.workspace.state.solution_board);
  const withBoard=[...alternate,applied(board,3,3)];
  expect(bridge.foldAt(withBoard)).toEqual(cold.foldAt(withBoard));
  expect(bridge.foldAt(withBoard).workspace.state.solution_board).not.toEqual(baseline.workspace.state.solution_board);
  expect(()=>bridge.foldAt([...withBoard,applied(board,4,4)])).toThrow();
  expect(bridge.foldAt(alternate)).toEqual(resumed);
  expect(bridge.foldAt(prefix)).toEqual(baseline);
  return;
 }
 let revision=0;
 for(const action of compiled.actions)if(action.workspace_action){
  append('presentation_action_applied',{sequence_id:compiled.sequence_id,ordinal:action.ordinal,action_id:action.workspace_action.action_id,kind:'workspace',resulting_workspace_revision:++revision});
  expect(bridge.foldAt(stream).workspace.state.revision).toBe(revision);
 }
 const cached=bridge.foldAt(stream);
 const fresh=createPinnedVisualWorkspaceBridge({sessionId:'TS-9400',catalogHash:`sha256:${'a'.repeat(64)}`,catalog,workspaceCatalog:workspace,imported,authorityAt:()=>({currentOwner:owner,activeOwners:[owner]})}).foldAt(stream);
 expect(cached).toEqual(fresh);
 const last=stream.at(-1)!;
 expect(()=>bridge.foldAt([...stream,{...last,sequence:last.sequence+1,state_revision:last.state_revision+1}])).toThrow();
 expect(bridge.foldAt(stream)).toEqual(fresh);
 expect(()=>compilePresentationIntents({...input,visual,draft:{...input.draft,items:[...items,...Array.from({length:32},()=>({type:'speech' as const,text:'继续观察。',basis_refs:['FN-01']}))]}})).toThrow(/32 actions/);
 expect(compiled.actions.length).toBeGreaterThan(14);expect(compiled.actions.length).toBeLessThanOrEqual(32);
 expect(compiled.actions.filter(a=>a.workspace_action?.capability==='geometry.construct')).toHaveLength(5);
 const visualCommands=compiled.actions.filter(a=>a.workspace_action?.capability.startsWith('geometry.visual.')).map(a=>JSON.parse(a.workspace_action!.command_payload!));
 expect(visualCommands.filter(c=>c.op==='upsert'&&c.form==='angle-arcs')).toHaveLength(2);
 expect(visualCommands.filter(c=>c.op==='focus').map(c=>c.pair_index)).toEqual([0,1,2]);
 expect(visualCommands.filter(c=>c.op==='upsert'&&c.form==='length-label')).toHaveLength(4);
 expect(compiled.actions.some(a=>a.workspace_action?.capability==='board.explain')).toBe(true);
 expect(compiled.actions.at(-1)?.workspace_action?.capability).toBe('geometry.visual.close-group');
 expect(()=>compilePresentationIntents({...input,visual,draft:{...input.draft,items:items.filter(i=>!(i.type==='tool_intent'&&i.args?.binding_ref==='VB-112'))}})).toThrow(/coverage/);
}
it('real BT04 complete construction, angle, pair, length and proof obligations compile beyond legacy 12',()=>checkBT04Cache());
it('cached prefix isolates a failed construct/board branch before an alternative valid applied lineage',()=>checkBT04Cache(true));
