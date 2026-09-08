import { describe,it,expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importApprovedPlanV5 } from "../../v5/ImportApprovedPlanV5";
import { realCanonicalRoot } from "../../../tutorNavigator/__tests__/navigatorSupport";
import { buildGoldenWorkspaceCatalogV5 } from "../../../tutorOrchestration/GoldenWorkspaceCatalog";
import { attachFirstTopicVisualCandidate } from "../FirstTopicVisualCandidate";
import { importVisualBindings } from "../ImportVisualBindings";
import { applyDomainCommands } from "../../../../../../shared/actionWorld";
import type { DomainCommand } from "../../../../../../shared/actionWorld";
const importedResult=importApprovedPlanV5({canonicalRoot:realCanonicalRoot()},"TP-SMV-009");
if(!importedResult.ok)throw new Error(importedResult.errors.join(";"));
const imported=importedResult.imported;
const draft=JSON.parse(readFileSync(join(__dirname,"../../review/c1-teach-follow-along/candidate-v13-r3/TP-SMV-009.v13.draft.json"),"utf8"));
const candidate=()=>attachFirstTopicVisualCandidate({plan:draft,graphHash:imported.graph.content_hash,facts:new Map(imported.graph.facts.map(f=>[f.fact_id,f])),targetVersion:"v14"});
describe("first-topic offline approved graph binding evidence",()=>{
 it("builds unsigned v8 candidate, preserving source pins and old draft",()=>{const before=JSON.stringify(draft);const c=candidate();expect(c.plan.schema).toBe("ai_teaching_tutor_plan_bundle/v8");expect(c.plan.status).toBe("Draft");expect(c.plan.approval).toBeUndefined();expect(c.evidence).toHaveLength(19);expect(c.plan.solution_graph_ref).toEqual(draft.solution_graph_ref);expect(JSON.stringify(draft)).toBe(before);});
 it("default production rejects Draft; explicit review resolves actual output identities",()=>{const c=candidate(),workspaceCatalog=buildGoldenWorkspaceCatalogV5(imported).catalog;expect(()=>importVisualBindings({plan:c.plan,imported,workspaceCatalog})).toThrow(/Approved/);const {catalog}=importVisualBindings({plan:c.plan,imported,workspaceCatalog,reviewContext:"draft-local-review"});expect(catalog.get("VB-111").relation).toMatchObject({left:["D","A","pt-O"],right:["D","B","A"]});expect(catalog.get("VB-112").relation).toMatchObject({segment:"seg-DO"});expect(catalog.get("VB-112").required_constructions).toEqual(["VB-01","VB-03"]);});
 it("all approved angle and similarity bindings resolve on the real constructed Euclidean figure",()=>{const c=candidate(),workspaceCatalog=buildGoldenWorkspaceCatalogV5(imported).catalog;const {catalog}=importVisualBindings({plan:c.plan,imported,workspaceCatalog,reviewContext:"draft-local-review"});const commands=JSON.parse(c.plan.resources.find(r=>r.resource_id==="RES7")!.content!).constructions.map((cmd:object,i:number)=>({...cmd,commandId:`cmd-${i}`,actionId:`WSA-${i}`})) as DomainCommand[];const world=applyDomainCommands({revision:0,geometry:workspaceCatalog.baseGeometry},commands);const permission={completedConstructions:new Set(["VB-01","VB-02","VB-03","VB-04","VB-05"]),existingPoints:new Map(world.geometry!.points.map(p=>[p.id,{x:p.x,y:p.y}])),revealAuthorized:()=>true};for(const binding of catalog.list())expect(()=>catalog.resolve(binding.binding_id,{...permission,scope:binding.allowed_scopes[0]})).not.toThrow();
 const length=(a:string,b:string)=>{const x=permission.existingPoints.get(a)!,y=permission.existingPoints.get(b)!;return Math.hypot(x.x-y.x,x.y-y.y);};
 for(const id of ["VB-104","VB-111","VB-117"]){const ratios=[0,1,2].map(i=>{const [a,b]=catalog.pairedSides(id,i);return length(...a.endpoints)/length(...b.endpoints);});expect(ratios[0]).toBeCloseTo(ratios[1],10);expect(ratios[1]).toBeCloseTo(ratios[2],10);}
 expect(length("A","B")/length("B","C")).toBeCloseTo(2/3,12);expect(length("A","D")).toBeCloseTo(length("D","C"),12);expect(length("B","E")/length("A","B")).toBeCloseTo(1/4,12);
 });
 it("changed graph statement cannot inherit the old visual math claim",()=>{const facts=new Map(imported.graph.facts.map(f=>[f.fact_id,{...f}]));facts.get("FN-14")!.statement="wrong ordering";expect(()=>attachFirstTopicVisualCandidate({plan:draft,graphHash:imported.graph.content_hash,facts,targetVersion:"v14"})).toThrow(/re-audited/);});
});

import { createPinnedVisualWorkspaceBridge } from "../../../tutorSession/VisualViewProjector";
import { VisualIntentCompiler } from "../../../tutorOrchestration/presentationGeneration/VisualIntentCompiler";
import { emptyVisualState } from "../../../tutorSession/WorkspaceVisualReducer";
import type { StoredSessionEvent } from "../../../tutorSession/kernel/sessionKernelTypes";
it("real pinned bridge computes target and validates identical invalidation, rejecting forged revisions",()=>{
 const c=candidate(),workspaceCatalog=buildGoldenWorkspaceCatalogV5(imported).catalog;
 const {catalog}=importVisualBindings({plan:c.plan,imported,workspaceCatalog,reviewContext:"draft-local-review"});
 const owner={scope:{kind:"approved" as const,protocol_id:"PR-SMV-001",beat_id:"BT-02"},scope_epoch:1,part_ref:"Q1"};
 const points=new Map(workspaceCatalog.baseGeometry!.points.map(p=>[p.id,{x:p.x,y:p.y}]));
 const compiler=new VisualIntentCompiler({catalog,state:emptyVisualState(),owner,sessionId:"TS-8102",sequenceId:"PS-0001",permission:{completedConstructions:new Set(),existingPoints:points,revealAuthorized:()=>true}});
 const a=compiler.compile({tool_id:"geometry.annotate",binding_ref:"VB-104",params:{form:"paired-sides",lifetime:"explanation-group",group:"pair"}},0,"WSA-8102-0001");
 const history:StoredSessionEvent[]=[];
 const push=(event_type:string,payload:Record<string,unknown>)=>{const e:StoredSessionEvent={schema:"ai_teaching_tutor_session_event/v10",session_id:"TS-8102",sequence:history.length+1,state_revision:history.length+1,occurred_at:"2026-09-08T00:00:00Z",event_type,payload,idempotency_key:`test-${history.length+1}`};history.push(e);return e;};
 push("session_started",{initial_cursor:{protocol_id:"PR-SMV-001",beat_id:"BT-02"},task_id:workspaceCatalog.taskId,protocol_refs:[{artifact_id:"PR-SMV-001"}],session_mode:"teaching"});
 push("policy_decision_made",{decision_id:"TD-8102-0001",protocol_id:"PR-SMV-001",beat_id:"BT-02",decision_kind:"execute_beat"});
 push("presentation_sequence_planned",{session_id:"TS-8102",sequence_id:"PS-0001",decision_id:"TD-8102-0001",scope:owner.scope,purpose:"teaching",actions:[{ordinal:0,kind:"workspace",basis_refs:a.basis_refs,workspace_action:{action_id:a.action_id,decision_id:"TD-8102-0001",surface:"geometry",capability:a.capability,origin:"tutor",command_payload:JSON.stringify(a.command),target_ids:"resolved_targets"in a.command?a.command.resolved_targets.entity_ids:[],reveal_scope:"intermediate_result"}}]});
 push("presentation_action_applied",{sequence_id:"PS-0001",ordinal:0,action_id:a.action_id,kind:"workspace",resulting_workspace_revision:1});
 let authorityCalls=0;
 const bridge=createPinnedVisualWorkspaceBridge({sessionId:"TS-8102",catalogHash:`sha256:${"a".repeat(64)}`,catalog,workspaceCatalog,imported,authorityAt:()=>{authorityCalls++;return {currentOwner:owner,activeOwners:[owner]};}});
 expect(bridge.projectAt(history).annotations).toHaveLength(1);
 const baseline=bridge.foldAt(history);
 // Prefix acceleration keeps history private; neither a public mutable result
 // nor a caller changing its old input can poison an independently read prefix.
 const pristine=structuredClone(history);
 const publicFold=bridge.foldAt(history);
 publicFold.visual.annotations[0].resolved_targets.entity_ids.push("caller-target");
 expect(history).toEqual(pristine);
 expect(bridge.foldAt(pristine)).toEqual(baseline);
 const freezeDeep=(value:unknown):void=>{
   if(value && typeof value==="object") {Object.freeze(value);for(const child of Object.values(value))freezeDeep(child);}
 };
 const frozenHistory=structuredClone(history);freezeDeep(frozenHistory);
 expect(bridge.foldAt(frozenHistory)).toEqual(baseline);
 const poisonedInput=structuredClone(history);
 bridge.foldAt(poisonedInput);
 poisonedInput.at(-1)!.payload.action_id="WSA-caller-input-mutation";
 expect(()=>bridge.foldAt(poisonedInput)).toThrow(/identity|mismatch|WSA/i);
 expect(bridge.foldAt(pristine)).toEqual(baseline);

 const calls=authorityCalls;
 for(let i=0;i<20;i++)expect(bridge.foldAt(structuredClone(history))).toEqual(baseline);
 expect(authorityCalls).toBe(calls); // exact content prefix: zero re-executed visual authorization
 const mutated=bridge.foldAt(history);mutated.visual.annotations.length=0;mutated.workspace.state.revision=999;
 expect(bridge.foldAt(history)).toEqual(baseline);
 const tampered=structuredClone(history);tampered.at(-1)!.payload.resulting_workspace_revision=999;
 expect(()=>bridge.foldAt(tampered)).toThrow(/WSA/);
 expect(bridge.foldAt(history)).toEqual(baseline); // failed speculative prefix never poisons cache
 const suffix={...history.at(-1)!,sequence:5,state_revision:5,event_type:"presentation_action_outcome_recorded",payload:{sequence_id:"PS-0001",ordinal:0,action_id:a.action_id,kind:"workspace",outcome:"presented"}};
 const beforeSuffix=authorityCalls;
 bridge.foldAt([...history,suffix]);expect(authorityCalls).toBe(beforeSuffix);

 const prepared=bridge.prepareInvalidation(history,"barge-in");expect(prepared.invalidation.resulting_workspace_revision).toBe(2);expect(prepared.invalidation.resulting_visual_revision).toBe(2);expect(prepared.target.annotations).toEqual([]);
 const event=push("workspace_visual_owners_invalidated",prepared.invalidation);expect(()=>bridge.validateInvalidation(history.slice(0,-1),event)).not.toThrow();expect(bridge.projectAt(history)).toEqual(prepared.target);
 expect(()=>bridge.validateInvalidation(history.slice(0,-1),{...event,payload:{...event.payload,resulting_workspace_revision:3}})).toThrow();
});
import { reduceVisual } from "../../../tutorSession/WorkspaceVisualReducer";
import { projectVisualView } from "../../../tutorSession/VisualViewProjector";
it("VB102 and VB103 coexist: same entity set does not erase distinct angle vertices/rays",()=>{
 const c=candidate(),workspaceCatalog=buildGoldenWorkspaceCatalogV5(imported).catalog;
 const {catalog}=importVisualBindings({plan:c.plan,imported,workspaceCatalog,reviewContext:"draft-local-review"});
 const owner={scope:{kind:"approved" as const,protocol_id:"PR-SMV-001",beat_id:"BT-02"},scope_epoch:1,part_ref:"Q1"};
 const permission={completedConstructions:new Set<string>(),existingPoints:new Map(workspaceCatalog.baseGeometry!.points.map(p=>[p.id,{x:p.x,y:p.y}])),revealAuthorized:()=>true};
 const compiler=new VisualIntentCompiler({catalog,state:emptyVisualState(),owner,sessionId:"TS-8102",sequenceId:"PS-0001",permission});
 let state=emptyVisualState();
 for(const [ordinal,binding] of ["VB-102","VB-103"].entries()){
  const action=compiler.compile({tool_id:"geometry.annotate",binding_ref:binding,params:{form:"angle-arcs",lifetime:"teaching-scope"}},ordinal,`WSA-8102-${ordinal}`);
  state=reduceVisual(state,action.command,catalog,{...permission,owner,action:{session_id:"TS-8102",sequence_id:"PS-0001",ordinal,action_id:action.action_id}}).state;
 }
 const view=projectVisualView(state,catalog,{...permission,currentOwner:owner,ownerAuthorized:()=>true});
 expect(view.annotations.map(a=>a.binding_ref)).toEqual(["VB-102","VB-103"]);
 expect(view.annotations[0].resolved_targets.angles!.map(a=>a.vertex)).toEqual(["C","C"]);
 expect(view.annotations[1].resolved_targets.angles!.map(a=>a.vertex)).toEqual(["A","B"]);
});

import { importVisualReviewCandidate } from "../ImportVisualReviewCandidate";
import { cpSync,mkdtempSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
it("independent v14 review importer preserves exact pins and rejects edited evidence or plan",()=>{
 const source=join(__dirname,"../../review/geometry-visual/candidate-v14");
 const loaded=importVisualReviewCandidate({canonicalRoot:realCanonicalRoot(),candidateDirectory:source});
 expect(loaded.ok).toBe(true);if(!loaded.ok)throw Error(loaded.errors.join(";"));
 expect(loaded.imported.projection.plan_ref.version).toBe("v14");expect(loaded.imported.projection.plan_ref.content_hash).toBe(loaded.imported.plan.content_hash);expect(loaded.visual.catalog.planHash).toBe(loaded.imported.plan.content_hash);
 const root=mkdtempSync(join(tmpdir(),"visual-review-tamper-"));
 try {cpSync(source,root,{recursive:true});const path=join(root,"visual-binding-evidence.json");const evidence=JSON.parse(readFileSync(path,"utf8"));evidence[0].approved_statement="unapproved replacement";writeFileSync(path,JSON.stringify(evidence));expect(importVisualReviewCandidate({canonicalRoot:realCanonicalRoot(),candidateDirectory:root}).ok).toBe(false);
 cpSync(source,root,{recursive:true});const planPath=join(root,"TP-SMV-009.v14.draft.json");const plan=JSON.parse(readFileSync(planPath,"utf8"));plan.resource_bindings.find((b:{binding_id:string})=>b.binding_id==="VB-104").relation.right=["C","A","B"];writeFileSync(planPath,JSON.stringify(plan));expect(importVisualReviewCandidate({canonicalRoot:realCanonicalRoot(),candidateDirectory:root}).ok).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

import { TutorTaskBindingResolver } from '../../../tutorOrchestration/TutorTaskBindingResolver';
import { workspaceCatalogPin } from '../../../tutorSession/WorkspacePresentationCatalogV5';
it('V10 provider requires explicit review result, preserves pins and registers actual visual capabilities',()=>{
 const loaded=importVisualReviewCandidate({canonicalRoot:realCanonicalRoot(),candidateDirectory:join(__dirname,'../../review/geometry-visual/candidate-v14')});
 if(!loaded.ok)throw Error(loaded.errors.join(';'));
 const resolver=new TutorTaskBindingResolver(realCanonicalRoot(),()=>loaded);
 const binding=resolver.resolveForStart('goldenMinhangFold2020');
 const payload={task_id:binding.taskId,session_mode:'teaching',scenario_id:binding.scenarioId,tutor_plan_ref:binding.plan.tutor_plan_ref,question_ref:binding.plan.question_ref,workspace_catalog_pin:workspaceCatalogPin(binding.golden.catalog)};
 const context=resolver.v10RegistryProvider(payload);
 expect(context.capabilities.has('geometry.visual.upsert')).toBe(true);
 expect(context.capabilities.has('geometry.visual.reconcile')).toBe(true);
 expect(context.visual.catalogHash).toBe(payload.workspace_catalog_pin.content_hash);
 expect(context.visual.resolveInquiryEntryBeat?.('PR-SMV-002')).toBe(loaded.imported.protocols.get('PR-SMV-002')!.entry_beat_id);
 expect(()=>context.visual.resolveInquiryEntryBeat?.('PR-unknown')).toThrow(/ENTRY_MISSING/);
 const unauthorized=new TutorTaskBindingResolver(realCanonicalRoot(),()=>({ok:true,imported:loaded.imported}));
 expect(()=>unauthorized.v10RegistryProvider(payload)).toThrow(/Approved/);
 expect(()=>resolver.v10RegistryProvider({...payload,tutor_plan_ref:{...payload.tutor_plan_ref,content_hash:`sha256:${'0'.repeat(64)}`}})).toThrow(/match/);
});

import { visualAuthorityAt } from '../../../tutorSession/VisualBindingAuthority';
it('local inquiry uses committed identities and return restores anchor visit before same-CAS advance',()=>{
 const event=(sequence:number,payload:object,type='policy_decision_made')=>({session_id:'TS-9001',sequence,state_revision:sequence>3?4:sequence,event_type:type,payload}) as StoredSessionEvent;
 const history=[event(1,{initial_cursor:{protocol_id:'PR-SMV-001',beat_id:'BT-02'}},'session_started'),event(2,{decision_kind:'execute_beat',protocol_id:'PR-SMV-001',beat_id:'BT-02'}),event(3,{decision_kind:'open_inquiry',protocol_id:'PR-SMV-001',beat_id:'BT-02',inquiry:{inquiry_id:'IQ-live-local'},local_inquiry_protocol:{local_protocol_id:'LPR-live-local',beats:[{beat_id:'LBT-1'}]}})];
 const local=visualAuthorityAt(history,imported);
 expect(local.currentOwner.scope).toEqual({kind:'local',inquiry_id:'IQ-live-local',local_protocol_id:'LPR-live-local',local_beat_id:'LBT-1',anchor:{protocol_id:'PR-SMV-001',beat_id:'BT-02'}});
 expect(local.currentOwner.scope_epoch).toBe(2);expect(local.activeOwners).toHaveLength(2);
 const returned=[...history,event(4,{decision_kind:'return_to_mainline',protocol_id:'PR-SMV-001',to_beat_id:'BT-02'})];
 expect(visualAuthorityAt(returned,imported).currentOwner.scope_epoch).toBe(1);
 const advanced=visualAuthorityAt([...returned,event(5,{decision_kind:'transition_beat',protocol_id:'PR-SMV-001',to_beat_id:'BT-03'})],imported);
 expect(advanced.currentOwner).toMatchObject({scope:{beat_id:'BT-03'},scope_epoch:3});expect(advanced.activeOwners).toHaveLength(1);
 const c=candidate(),workspaceCatalog=buildGoldenWorkspaceCatalogV5(imported).catalog;
 const {catalog}=importVisualBindings({plan:c.plan,imported,workspaceCatalog,reviewContext:'draft-local-review'});
 expect(()=>catalog.resolve('VB-102',{scope:local.currentOwner.scope,completedConstructions:new Set(),existingPoints:new Map(workspaceCatalog.baseGeometry!.points.map(p=>[p.id,{x:p.x,y:p.y}])),revealAuthorized:()=>true})).not.toThrow();
});
