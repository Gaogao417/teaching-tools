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
describe("production visual resolver/compiler/reducer",()=>{
 it("resolves exact triangle correspondence in all three directions",()=>{const c=new VisualBindingCatalog(source());expect([0,1,2].map(i=>c.pairedSides("VB-2",i))).toEqual([[{endpoints:["A","B"]},{endpoints:["D","E"]}],[{endpoints:["B","C"]},{endpoints:["E","F"]}],[{endpoints:["C","A"]},{endpoints:["F","D"]}]]);expect(()=>c.pairedSides("VB-2",3)).toThrow();});
 it("rejects incompatible forms and unapproved basis at catalog construction",()=>{expect(()=>new VisualBindingCatalog(source([{...length,allowed_forms:["angle-arcs"]}]))).toThrow();expect(()=>new VisualBindingCatalog({...source(),approvedBasisRefs:new Set()})).toThrow();});
 it("rejects missing construction before target and degeneracy",()=>{const c=new VisualBindingCatalog({...source([{...angle,required_constructions:["VB-8"]}]),constructionOutputs:new Map([["VB-8",["F"]]])});expect(()=>c.resolve("VB-3",{...permission,scope:owner.scope})).toThrow(/VB-3/);const flat=new Map(points);flat.set("C",{x:4,y:0});expect(()=>new VisualBindingCatalog(source()).resolve("VB-3",{...permission,scope:owner.scope,existingPoints:flat})).toThrow();});
 it("compiles canonical command and immutable state, renders only approved text",()=>{const original=emptyVisualState(), c=compiler(original);const command=c.compile(annotate(),0,action().action_id).command;expect(geometryVisualCommandSchema.safeParse(command).success).toBe(true);const r=apply(command);expect(original).toEqual(emptyVisualState());expect(visualStateSchema.safeParse(r.state).success).toBe(true);const view=projectVisualView(r.state,new VisualBindingCatalog(source()),auth());expect(visualViewSchema.safeParse(view).success).toBe(true);expect(view.annotations[0].content).toBe("AB=2");expect(JSON.stringify(view)).not.toContain("basis_refs");});
 it.each([{text:"made up"},{color:"red"},{valueLatex:"999"},{duration:900}])("rejects model-owned parameter %j",extra=>expect(()=>compiler().compile({...annotate(),params:{...annotate().params,...extra}},0,action().action_id)).toThrow());
 it("rejects forged target, semantic key, owner and expected version",()=>{const command=compiler().compile(annotate(),0,action().action_id).command;expect(()=>apply({...command,resolved_targets:{entity_ids:["F"]}} as typeof command)).toThrow();expect(()=>apply({...command,semantic_key:"forged"} as typeof command)).toThrow();expect(()=>apply({...command,owner:{...owner,scope_epoch:4}} as typeof command)).toThrow();expect(()=>apply({...command,expected_version:9} as typeof command)).toThrow();});
 it("denies local part lifetime and unauthorized final content",()=>{expect(()=>compiler(emptyVisualState(),inquiry).compile(annotate("length-label","problem-part"),0,action().action_id)).toThrow();const c=new VisualBindingCatalog(source([{...length,reveal_scope:"final_result"}]));expect(()=>c.resolve("VB-1",{...permission,scope:owner.scope,revealAuthorized:()=>false})).toThrow();});
 it("shares semantic annotation but independently revokes unconfirmed Inquiry lease",()=>{const first=apply(compiler().compile(annotate(),0,action().action_id).command);const key=action("WSA-test-2",1);const local=compiler(first.state,inquiry).compile(annotate(),1,key.action_id);const second=apply(local.command,first.state,inquiry,key);expect(second.state.annotations).toHaveLength(1);expect(second.state.annotations[0].leases).toHaveLength(2);const rolled=rollbackVisualLeaseChanges(second.state,second.lease_changes,action("WSA-clean",2));expect(rolled.annotations[0].leases.map(l=>l.status)).toEqual(["active","retired"]);expect(projectVisualView(rolled,new VisualBindingCatalog(source()),auth()).annotations).toHaveLength(1);expect(()=>rollbackVisualLeaseChanges(rolled,second.lease_changes,action())).toThrow();});
 it("pure reuse has no lease change and cannot steal confirmation lineage",()=>{const first=apply(compiler().compile(annotate(),0,action().action_id).command);const next=compiler(first.state).compile(annotate(),1,"WSA-test-2");const reused=apply(next.command,first.state,owner,action("WSA-test-2",1));expect(reused.changed).toBe(false);expect(reused.lease_changes).toEqual([]);expect(reused.state.annotations[0].leases[0].last_changed_by).toEqual(action());});
 it("compiler closes group; group lease retires while scope annotation survives",()=>{const c=compiler();const first=c.compile(annotate("length-label","explanation-group","explain"),0,action().action_id);const second=c.finish(1,"WSA-close");expect(second).toHaveLength(1);const a=apply(first.command);const b=apply(second[0].command,a.state,owner,action("WSA-close",1));expect(b.state.active_group_id).toBeNull();expect(b.state.annotations[0].leases[0].status).toBe("retired");expect(c.finish(2,"WSA-close2")).toEqual([]);});
 it("nested groups and re-opened aliases fail closed",()=>{const c=compiler();c.compile(annotate("length-label","explanation-group","a"),0,action().action_id);expect(()=>c.compile(annotate("length-label","explanation-group","b"),1,"WSA-b")).toThrow();const d=compiler();d.compile(annotate("length-label","explanation-group","a"),0,action().action_id);d.finish(1,"WSA-close");expect(()=>d.compile(annotate("length-label","explanation-group","a"),2,"WSA-a2")).toThrow();});
 it("next beat retires scope but keeps part; part switch retires both",()=>{const c=compiler(),a=c.compile(annotate(),0,action().action_id);let state=apply(a.command).state;const b=compiler(state).compile(annotate("length-label","problem-part"),1,"WSA-part");state=apply(b.command,state,owner,action("WSA-part",1)).state;const next=invalidateVisualOwner(state,owner,"next-beat",action("WSA-next",2));expect(next.state.annotations[0].leases.map(l=>l.status)).toEqual(["retired","active"]);expect(invalidateVisualOwner(next.state,owner,"next-part",action("WSA-nextpart",3)).state.annotations[0].leases.every(l=>l.status==="retired")).toBe(true);});
 it("cutoff and full action identity filter historical coverage",()=>{const state=apply(compiler().compile(annotate(),0,action().action_id).command).state;const base={state,catalog:new VisualBindingCatalog(source()),authorization:auth(),requirements:[],sessionId:"TS-test",eventCutoff:10,availableChars:5000};for(const evidence of [{action:action(),outcome:"presented" as const,event_sequence:11},{action:{...action(),sequence_id:"PS-other"},outcome:"presented" as const,event_sequence:9},{action:action(),outcome:"failed" as const,event_sequence:9}])expect(projectVisualContext({...base,outcomes:[evidence]}).already_presented.annotations).toEqual([]);expect(projectVisualContext({...base,outcomes:[{action:action(),outcome:"presented",event_sequence:9}]}).already_presented.annotations).toHaveLength(1);expect(()=>projectVisualContext({...base,outcomes:[],availableChars:1})).toThrow(/budget/);});
 it("missing pair, wrong binding, and late indication cannot satisfy coverage",()=>{const req:VisualRequirement={scope:owner.scope,binding_ref:"VB-2",forms:["paired-sides"],required_pair_indices:[0,1,2],trigger:"introduce"};const c=compiler();const actions=[0,1].map((pair_index,i)=>c.compile({tool_id:"geometry.emphasize",binding_ref:"VB-2",params:{group:"pairs",mode:"pulse",pair_index}},i+1,`WSA-pair${i}`));const empty=projectVisualView(emptyVisualState(),new VisualBindingCatalog(source()),auth());expect(validateVisualCoverage([req],actions,empty).some(i=>i.pair_index===2)).toBe(true);expect(validateVisualCoverage([req],actions,empty,[{ordinal:0,binding_ref:"VB-2"}]).some(i=>i.code==="late-visual")).toBe(true);actions.push(c.compile({tool_id:"geometry.emphasize",binding_ref:"VB-2",params:{group:"pairs",mode:"pulse",pair_index:2}},3,"WSA-pair2"));expect(validateVisualCoverage([req],actions,empty)).toEqual([]);});
 it("tool exposure needs capability intersection and denies assessment",()=>{const input={bindings:[length],scope:owner.scope,sessionMode:"teaching" as const,registeredCapabilities:new Set(["geometry.visual.upsert"]),revealAuthorized:()=>true};expect(visibleVisualTools(input)).toEqual([]);input.registeredCapabilities.add("geometry.visual.close-group");expect(visibleVisualTools(input).map(t=>t.tool)).toEqual(["geometry.annotate","geometry.clear-visual"]);expect(visibleVisualTools({...input,sessionMode:"assessment"})).toEqual([]);});
 it("old v3 and v4 prompt bytes remain frozen",()=>{const hash=(text:string)=>createHash("sha256").update(text).digest("hex");expect(hash(TOOL_INVOCATION_PRESENTER_SYSTEM_PROMPT)).toBe("fa1e6804dcbb197bea9e3cb027fdb82456c119a3a82d8a117ae13b6720062881");expect(hash(PRESENTER_SYSTEM_PROMPT)).toBe("b62b3d5e9e68c9bc7d319a2e3d11ded6ec92d7c03bfb3eda22ecc42d59ef3f58");});
});

import { compilePresentationIntents, type IntentCompilerInput } from "../IntentCompiler";
import { buildPresentationContext,DEFAULT_CONTEXT_POLICY } from "../ContextBuilder";
// Historical v8 fixture: tests original compiler/context pipeline, not new-session default.
import { V8_VISUAL_PRESENTER_PROMPT_VERSION as VISUAL_PRESENTER_PROMPT_VERSION } from "../PresenterPrompts";
import { VISUAL_CONTEXT_BUILDER_VERSION,VISUAL_TOOL_CATALOG_VERSION } from "../VisualPresentationTools";
import { prepareVisualInvalidation,foldVisualInvalidation } from "../../../tutorSession/WorkspaceVisualReducer";
const compiledInput=():IntentCompilerInput=>{
 const facts=new Map([["FN-01",{fact_id:"FN-01",role:"given" as const,statement:"AB=2",reveals_answer:false}]]);
 const context=buildPresentationContext({planRef:{artifact_id:"TP-SMV-009",version:"v14",content_hash:`sha256:${"a".repeat(64)}`},graphRef:{artifact_id:"RG-SMV-001",version:"v8",content_hash:`sha256:${"b".repeat(64)}`},graph:{facts,inferences:new Map()},beat:{protocol_id:"PR-SMV-001",beat_id:"BT-02",graph_fact_refs:["FN-01"],inference_refs:[],resource_ids:[]},recentInputs:[],eventCutoff:1,workspaceRevision:0,currentRevision:1,policy:DEFAULT_CONTEXT_POLICY,sessionMode:"teaching"});
 return {sessionId:"TS-8102",sequenceSerial:1,decisionId:"TD-8102-0001",scope:{kind:"approved",protocol_id:"PR-SMV-001",beat_id:"BT-02"},request:{request_id:"GR-8102-0001",attempt:1,epoch:1,input_digest:context.digest,presenter_pin:{provider:"offline",model_id:"offline",prompt_version:VISUAL_PRESENTER_PROMPT_VERSION,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION}},draft:{schema:"ai_teaching_presentation_draft/v2",request_id:"GR-8102-0001",items:[{type:"tool_intent",tool:"geometry.annotate",args:{binding_ref:"VB-1",params:{form:"length-label",lifetime:"teaching-scope"}}},{type:"speech",text:"AB的批准长度是2。",basis_refs:["VB-1"]}]},context,visibleTools:[],resources:new Map(),graph:{facts,inferences:new Map()},approvedConstructions:[],revealAuthorized:()=>false};
};
it("real main compiler emits plan/v5 and coverage rejection is whole-candidate",()=>{
 const base=compiledInput(),catalog=new VisualBindingCatalog(source());
 const visual={catalog,state:emptyVisualState(),owner,permission,requirements:[{scope:owner.scope,binding_ref:"VB-1",forms:["length-label" as const],required_pair_indices:[],trigger:"introduce" as const}],alreadyPresented:projectVisualView(emptyVisualState(),catalog,auth()),visibleTools:visibleVisualTools({bindings:[length],scope:owner.scope,sessionMode:"teaching",registeredCapabilities:new Set(["geometry.visual.upsert","geometry.visual.close-group"]),revealAuthorized:()=>true})};
 const plan=compilePresentationIntents({...base,visual});expect(plan.schema).toBe("ai_teaching_presentation_plan/v5");expect(plan.purpose).toBe("teaching");expect(plan.actions[0].workspace_action?.capability).toBe("geometry.visual.upsert");
 expect(()=>compilePresentationIntents({...base,visual,draft:{...base.draft,items:[base.draft.items[1]]}})).toThrow(/visual coverage/);
 expect(visual.state).toEqual(emptyVisualState());
});
it("atomic invalidation increments visual and parent revision exactly once; forged payload fails",()=>{
 const c=compiler();const a=c.compile(annotate("length-label","explanation-group","g"),0,action().action_id);const applied=apply(a.command);
 const input={state:applied.state,workspaceRevision:8,reason:"barge-in" as const,owner,transition:"barge-in" as const,action:action("WSA-clean",1),unconfirmed:[{action:action(),changes:applied.lease_changes}]};
 const result=prepareVisualInvalidation(input);expect(result.state.visual_revision).toBe(applied.state.visual_revision+1);expect(result.invalidation.resulting_workspace_revision).toBe(9);expect(result.state.active_group_id).toBeNull();
 expect(foldVisualInvalidation({...input,payload:result.invalidation})).toEqual(result.state);
 expect(()=>foldVisualInvalidation({...input,payload:{...result.invalidation,lease_ids:[]}})).toThrow();
 expect(()=>foldVisualInvalidation({...input,payload:{...result.invalidation,resulting_workspace_revision:10}})).toThrow();
});
it("focus carries server-derived paired sides and rejects reversed forged correspondence",()=>{
 const c=compiler();const a=c.compile({tool_id:"geometry.emphasize",binding_ref:"VB-2",params:{group:"pair",mode:"pulse",pair_index:1}},0,action().action_id);
 if(a.command.op!=="focus")throw new Error("expected focus");expect(a.command.resolved_targets.triangles).toEqual({left:["A","B","C"],right:["D","E","F"]});expect(a.command.resolved_targets.paired_sides).toEqual([{endpoints:["B","C"]},{endpoints:["E","F"]}]);
 const forged=structuredClone(a.command);forged.resolved_targets.paired_sides![1].endpoints.reverse();expect(()=>apply(forged)).toThrow(/VB-2/);
});
it("required pair2 must precede relation voice even if pair0 was already shown",()=>{
 const catalog=new VisualBindingCatalog(source()),base=compiledInput();
 const visual={catalog,state:emptyVisualState(),owner,permission,requirements:[{scope:owner.scope,binding_ref:"VB-2",forms:["paired-sides" as const],required_pair_indices:[2 as const],trigger:"use-in-reasoning" as const}],alreadyPresented:projectVisualView(emptyVisualState(),catalog,auth()),visibleTools:visibleVisualTools({bindings:[similarity],scope:owner.scope,sessionMode:"teaching",registeredCapabilities:new Set(["geometry.visual.focus","geometry.visual.close-group"]),revealAuthorized:()=>true})};
 const pair=(pair_index:number)=>({type:"tool_intent" as const,tool:"geometry.emphasize",args:{binding_ref:"VB-2",params:{group:"pairs",mode:"pulse",pair_index}}});
 const voice={type:"speech" as const,text:"这对边对应。",basis_refs:["VB-2"]};
 expect(()=>compilePresentationIntents({...base,visual,draft:{...base.draft,items:[pair(0),voice,pair(2)]}})).toThrow(/late-visual/);
 expect(()=>compilePresentationIntents({...base,visual,draft:{...base.draft,items:[pair(0),pair(2),voice]}})).not.toThrow();
});
it('H26 return plus advance retires local and saved anchor scope leases atomically',()=>{
 const first=apply(compiler().compile(annotate(),0,action().action_id).command);
 const localKey=action('WSA-local',1);
 const local=compiler(first.state,inquiry).compile(annotate(),1,localKey.action_id);
 const both=apply(local.command,first.state,inquiry,localKey);
 const input={state:both.state,workspaceRevision:7,reason:'scope-transition' as const,owner:inquiry,transition:'return-inquiry' as const,
  additionalTransitions:[{owner,transition:'next-beat' as const}],action:action('WSA-cleanup',2),unconfirmed:[]};
 const result=prepareVisualInvalidation(input);
 expect(result.state.annotations.flatMap(a=>a.leases).every(l=>l.status==='retired')).toBe(true);
 expect(result.invalidation.owner_keys).toHaveLength(2);
 expect(result.state.visual_revision).toBe(both.state.visual_revision+1);
 expect(result.invalidation.resulting_workspace_revision).toBe(8);
 expect(foldVisualInvalidation({...input,payload:result.invalidation})).toEqual(result.state);
});
