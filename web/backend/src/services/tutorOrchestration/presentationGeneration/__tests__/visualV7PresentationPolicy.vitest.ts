import { describe,it,expect } from "vitest";
import { createHash } from "node:crypto";
import { visualStateSchema, visualViewSchema, geometryVisualCommandSchema, type VisualBinding, type VisualOwner, type VisualRequirement } from "../../../../../../shared/canonical/visualSchemas";
import { VisualBindingCatalog } from "../../../tutorSession/VisualBindingCatalog";
import { emptyVisualState, reduceVisual, rollbackVisualLeaseChanges, invalidateVisualOwner, type VisualActionKey } from "../../../tutorSession/WorkspaceVisualReducer";
import { projectVisualView } from "../../../tutorSession/VisualViewProjector";
import { VisualIntentCompiler } from "../VisualIntentCompiler";
import { validateVisualCoverage } from "../VisualCoverageValidator";
import { projectVisualContext } from "../VisualContextProjection";
import { visibleVisualTools } from "../VisualPresentationTools";
import { TOOL_INVOCATION_PRESENTER_SYSTEM_PROMPT, PRESENTER_SYSTEM_PROMPT } from "../PresenterPrompts";
const owner:VisualOwner={scope:{kind:"approved",protocol_id:"PR-SMV-001",beat_id:"BT-02"},scope_epoch:1,part_ref:"Q1"};
const inquiry:VisualOwner={scope:{kind:"local",inquiry_id:"IQ-test1",local_protocol_id:"LPR-test1",local_beat_id:"LBT-1",anchor:{protocol_id:"PR-SMV-001",beat_id:"BT-02"}},scope_epoch:2,part_ref:"Q1"};
const basis={binding_kind:"geometry_visual" as const,purpose:"approved relation",basis_refs:["FN-01"],allowed_scopes:[owner.scope,inquiry.scope],reveal_scope:"intermediate_result" as const,required_constructions:[],max_lifetime:"problem-part" as const};
const length:VisualBinding={...basis,binding_id:"VB-1",relation:{type:"segment-measure",segment:"AB",expression_ref:"FN-01"},allowed_forms:["length-label"]};
const similarity:VisualBinding={...basis,binding_id:"VB-2",relation:{type:"similarity",left:["A","B","C"],right:["D","E","F"],proof_angle_bindings:[]},allowed_forms:["paired-sides","triangle-outline"]};
const angle:VisualBinding={...basis,binding_id:"VB-3",relation:{type:"angle-equality",angles:[{vertex:"A",ray_points:["B","C"],sector:"minor"},{vertex:"D",ray_points:["E","F"],sector:"minor"}]},allowed_forms:["angle-arcs"]};
const points=new Map(Object.entries({A:{x:0,y:0},B:{x:2,y:0},C:{x:0,y:2},D:{x:4,y:0},E:{x:5,y:0},F:{x:4,y:1}}));
const source=(bindings=[length,similarity,angle])=>({planHash:`sha256:${"a".repeat(64)}`,bindings,approvedBasisRefs:new Set(["FN-01"]),approvedScopes:new Set(["PR-SMV-001/BT-02","IQ-test1/LPR-test1/LBT-1"]),expressions:new Map([["FN-01","AB=2"]]),pointIds:new Set(points.keys()),segments:new Map<string,readonly[string,string]>([["AB",["A","B"]]]),constructionOutputs:new Map<string,string[]>()});
const permission={completedConstructions:new Set<string>(),existingPoints:points,revealAuthorized:()=>true};
const action=(id="WSA-test-1",ordinal=0):VisualActionKey=>({session_id:"TS-test",sequence_id:"PS-0001",ordinal,action_id:id});
const compiler=(state=emptyVisualState(),own=owner,catalog=new VisualBindingCatalog(source()))=>new VisualIntentCompiler({catalog,state,owner:own,sessionId:"TS-test",sequenceId:"PS-0001",permission});
const annotate=(form="length-label",lifetime="teaching-scope",group?:string)=>({tool_id:"geometry.annotate",binding_ref:"VB-1",params:{form,lifetime,...(group?{group}:{})}});
const auth=(own=owner)=>({...permission,currentOwner:own,ownerAuthorized:()=>true});
const apply=(command:ReturnType<VisualIntentCompiler["compile"]>["command"],state=emptyVisualState(),own=owner,key=action())=>reduceVisual(state,command,new VisualBindingCatalog(source()),{...permission,owner:own,action:key});
import { compilePresentationIntents, type IntentCompilerInput } from "../IntentCompiler";
import { buildPresentationContext,DEFAULT_CONTEXT_POLICY } from "../ContextBuilder";
import { V7_VISUAL_PRESENTER_PROMPT_VERSION as VISUAL_PRESENTER_PROMPT_VERSION } from "../PresenterPrompts";
import { VISUAL_CONTEXT_BUILDER_VERSION,VISUAL_TOOL_CATALOG_VERSION } from "../VisualPresentationTools";
import { prepareVisualInvalidation,foldVisualInvalidation } from "../../../tutorSession/WorkspaceVisualReducer";
const compiledInput=():IntentCompilerInput=>{
 const facts=new Map([["FN-01",{fact_id:"FN-01",role:"given" as const,statement:"AB=2",reveals_answer:false}]]);
 const context=buildPresentationContext({planRef:{artifact_id:"TP-SMV-009",version:"v14",content_hash:`sha256:${"a".repeat(64)}`},graphRef:{artifact_id:"RG-SMV-001",version:"v8",content_hash:`sha256:${"b".repeat(64)}`},graph:{facts,inferences:new Map()},beat:{protocol_id:"PR-SMV-001",beat_id:"BT-02",graph_fact_refs:["FN-01"],inference_refs:[],resource_ids:[]},recentInputs:[],eventCutoff:1,workspaceRevision:0,currentRevision:1,policy:DEFAULT_CONTEXT_POLICY,sessionMode:"teaching"});
 return {sessionId:"TS-8102",sequenceSerial:1,decisionId:"TD-8102-0001",scope:{kind:"approved",protocol_id:"PR-SMV-001",beat_id:"BT-02"},request:{request_id:"GR-8102-0001",attempt:1,epoch:1,input_digest:context.digest,presenter_pin:{provider:"offline",model_id:"offline",prompt_version:VISUAL_PRESENTER_PROMPT_VERSION,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION}},draft:{schema:"ai_teaching_presentation_draft/v2",request_id:"GR-8102-0001",items:[{type:"tool_intent",tool:"geometry.annotate",args:{binding_ref:"VB-1",params:{form:"length-label",lifetime:"teaching-scope"}}},{type:"speech",text:"AB的批准长度是2。",basis_refs:["VB-1"]}]},context,visibleTools:[],resources:new Map(),graph:{facts,inferences:new Map()},approvedConstructions:[],revealAuthorized:()=>false};
};

import { LEGACY_VISUAL_PRESENTER_PROMPT_VERSION, PREVIOUS_VISUAL_PRESENTER_PROMPT_VERSION, LEGACY_VISUAL_PRESENTER_SYSTEM_PROMPT, PREVIOUS_VISUAL_PRESENTER_SYSTEM_PROMPT, buildPresenterPrompt } from '../PresenterPrompts';
import { structuredPresenterGenerator } from '../GeneratorPort';
import type { StructuredModelPort } from '../../../tutorIntelligence/structuredModelPort';
function candidate(version:string,trigger:VisualRequirement['trigger'],modes:string[]){
 const base=compiledInput(),catalog=new VisualBindingCatalog(source());
 const visual={catalog,state:emptyVisualState(),owner,permission,requirements:[{scope:owner.scope,binding_ref:'VB-2',forms:['paired-sides' as const],required_pair_indices:[0 as const,1 as const,2 as const],trigger}],alreadyPresented:projectVisualView(emptyVisualState(),catalog,auth()),visibleTools:visibleVisualTools({bindings:[similarity],scope:owner.scope,sessionMode:'teaching',registeredCapabilities:new Set(['geometry.visual.focus','geometry.visual.close-group']),revealAuthorized:()=>true})};
 return {...base,visual,request:{...base.request,presenter_pin:{...base.request.presenter_pin,prompt_version:version}},draft:{...base.draft,items:modes.map((mode,pair_index)=>({type:'tool_intent' as const,tool:'geometry.emphasize',args:{binding_ref:'VB-2',params:{group:'pairs',mode,pair_index}}}))}};
}
it.each(['introduce','clarify-reference'] as const)('v7 %s requires all three pulses, without rewriting or partial state',trigger=>{
 const input=candidate(VISUAL_PRESENTER_PROMPT_VERSION,trigger,['steady','steady','steady']);
 const before=JSON.stringify(input.draft),state=structuredClone(input.visual.state);
 expect(()=>compilePresentationIntents(input)).toThrow(/COMPILE_VALIDATION_FAILED|missing-pulse/);
 try{compilePresentationIntents(input)}catch(error){expect(error).toMatchObject({code:'COMPILE_VALIDATION_FAILED'});expect((error as Error).message).not.toContain('ILLEGAL_PARAM')}
 expect(JSON.stringify(input.draft)).toBe(before);expect(input.visual.state).toEqual(state);
 expect(()=>compilePresentationIntents(candidate(VISUAL_PRESENTER_PROMPT_VERSION,trigger,['pulse','steady','pulse']))).toThrow(/missing-pulse/);
 const plan=compilePresentationIntents(candidate(VISUAL_PRESENTER_PROMPT_VERSION,trigger,['pulse','pulse','pulse']));
 const focus=plan.actions.filter(a=>a.workspace_action?.capability==='geometry.visual.focus');
 expect(focus.map(a=>JSON.parse(a.workspace_action!.command_payload!).mode)).toEqual(['pulse','pulse','pulse']);
});
it.each([LEGACY_VISUAL_PRESENTER_PROMPT_VERSION,PREVIOUS_VISUAL_PRESENTER_PROMPT_VERSION])('old pin %s still accepts legal steady',version=>{
 expect(()=>compilePresentationIntents(candidate(version,'introduce',['steady','steady','steady']))).not.toThrow();
});
it('v7 use-in-reasoning retains steady; a pulse after speech cannot cure late coverage',()=>{
 expect(()=>compilePresentationIntents(candidate(VISUAL_PRESENTER_PROMPT_VERSION,'use-in-reasoning',['steady','steady','steady']))).not.toThrow();
 const c=compiler(),view=projectVisualView(emptyVisualState(),new VisualBindingCatalog(source()),auth());
 const req:VisualRequirement={scope:owner.scope,binding_ref:'VB-2',forms:['paired-sides'],required_pair_indices:[0],trigger:'introduce'};
 const actions=['steady','pulse'].map((mode,i)=>c.compile({tool_id:'geometry.emphasize',binding_ref:'VB-2',params:{group:'pairs',pair_index:0,mode}},i*2,`WSA-${i}`));
 expect(validateVisualCoverage([req],actions,view,[{binding_ref:'VB-2',ordinal:1}],{requireEntryPulse:true})).toContainEqual({binding_ref:'VB-2',code:'late-visual',pair_index:0,speech_ordinal:1});
 expect(validateVisualCoverage([req],actions,view,[{binding_ref:'VB-2',ordinal:1}])).toEqual([]);
});
it('v5/v6 exact prompts, factory pins and payload remain readable; only v7 carries fact roles',()=>{
 const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
 expect(hash(LEGACY_VISUAL_PRESENTER_SYSTEM_PROMPT)).toBe('fb272f62ebfaf77f14dc8bbd676f452c90347f02268a93a5c9b674ce282612e7');
 expect(hash(PREVIOUS_VISUAL_PRESENTER_SYSTEM_PROMPT)).toBe('5c1db3333aa7813b54126c4b7dd039ff7ad7aff0ce86b535e50a1824c561e4b9');
 for(const version of [LEGACY_VISUAL_PRESENTER_PROMPT_VERSION,PREVIOUS_VISUAL_PRESENTER_PROMPT_VERSION,VISUAL_PRESENTER_PROMPT_VERSION]){
  const port=structuredPresenterGenerator({provider:'offline',modelId:'offline'} as StructuredModelPort,{promptVersion:version});
  expect(port.pin).toMatchObject({prompt_version:version,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION});
  const roles=[{fact_id:'FN-01',role:'derived' as const}];
  const p=buildPresenterPrompt({promptVersion:version,context:compiledInput().context,instructionalGoal:'approved relation',currentGranularity:'beat',alreadyPresented:[],stuckPoint:null,visibleTools:[],maxItems:31,maxSpeechChars:2000,factRoles:roles});
  expect(p.promptVersion).toBe(version);
  if(version===VISUAL_PRESENTER_PROMPT_VERSION){expect(p.userPayload.fact_roles).toEqual(roles);expect(p.userPayload.fact_roles).not.toBe(roles)}
  else{expect(p.userPayload).not.toHaveProperty('fact_roles');expect(p.systemPrompt).toBe(version===LEGACY_VISUAL_PRESENTER_PROMPT_VERSION?LEGACY_VISUAL_PRESENTER_SYSTEM_PROMPT:PREVIOUS_VISUAL_PRESENTER_SYSTEM_PROMPT)}
 }
});
it.each([PREVIOUS_VISUAL_PRESENTER_PROMPT_VERSION,VISUAL_PRESENTER_PROMPT_VERSION])('%s keeps the fraction guard',version=>{
 const input=candidate(version,'use-in-reasoning',['steady','steady','steady']);
 expect(()=>compilePresentationIntents({...input,draft:{...input.draft,items:[...input.draft.items,{type:'speech',text:'三十二分之十五'}]}})).toThrow(/handwritten/);
});

import {VISUAL_PRESENTER_PROMPT_VERSION as V8_VISUAL_PRESENTER_PROMPT_VERSION} from '../PresenterPrompts';
it.each([VISUAL_PRESENTER_PROMPT_VERSION,V8_VISUAL_PRESENTER_PROMPT_VERSION])('%s keeps compiler pulse, fraction rejection and numeric normalization',version=>{
 expect(()=>compilePresentationIntents(candidate(version,'introduce',['steady','steady','steady']))).toThrow(/missing-pulse/);
 const valid=candidate(version,'introduce',['pulse','pulse','pulse']);
 expect(()=>compilePresentationIntents(valid)).not.toThrow();
 expect(()=>compilePresentationIntents({...valid,draft:{...valid.draft,items:[...valid.draft.items,{type:'speech',text:'十五分之三十二'}]}})).toThrow(/handwritten/);
 const normalized=compilePresentationIntents({...valid,draft:{...valid.draft,items:[...valid.draft.items,{type:'speech',text:'32/15'}]}});
 expect(normalized.actions.filter(a=>a.kind==='voice').map(a=>a.voice_action!.text)).toEqual([String.raw`$\frac{32}{15}$`]);
});
