import {verifyCompanionSemantic} from './GenerationCompanionSemantic';
import { visualScopeAllows, visualScopeKey } from "./VisualBindingCatalog";
import { resolveVisualInquiryEntryBeat } from "./VisualBindingAuthority";
import { preflightPresentationSequence } from "../tutorOrchestration/presentationGeneration/SequencePreflight";
import { workspaceRuntimeStateV3Schema,studentWorkspaceViewV3Schema } from "../../../../shared/canonical/visualSchemas";
import { projectStudentWorkspaceViewV9 } from "./WorkspaceViewProjectorV5";
import { reconcileWorkspaceCatalogPin } from "./WorkspaceStateRebuilderV5";
import { createV10Rebuilder } from "./RuntimeStateRebuilderV10";
import { initialWorkspaceFold } from "./WorkspaceRuntimeReducerV5";
import { applyWorkspaceV7Event, cloneWorkspaceFoldV7 } from "./WorkspaceRuntimeReducerV7";
import { geometryVisualCommandSchema, presentationPlanV5Schema, visualInvalidationSchema } from "../../../../shared/canonical/visualSchemas";
import { emptyVisualState, reduceVisual, foldVisualInvalidation, prepareVisualInvalidation, type VisualActionKey, type VisualLeaseChange, type VisualOwnerTransition } from "./WorkspaceVisualReducer";
import { applyDomainCommands } from "../../../../shared/actionWorld";
import type { VisualView, VisualOwner } from "../../../../shared/canonical/visualSchemas";
import { VisualBindingCatalog, VisualBindingError } from "./VisualBindingCatalog";
import { sameVisualOwner, stableVisualJson, visualHash, type WorkspaceVisualState, type VisualLease, type VisualReductionContext } from "./WorkspaceVisualReducer";
export interface VisualViewAuthorization {
  currentOwner: VisualOwner;
  inquiryScope?:VisualOwner["scope"];
  scopeAllows?:typeof visualScopeAllows;
  /** Includes retained mainline anchor and same-part approved owners, not merely current scope. */
  ownerAuthorized: (owner: VisualOwner, lifetime: VisualLease["lifetime"]) => boolean;
  completedConstructions: VisualReductionContext["completedConstructions"];
  existingPoints: VisualReductionContext["existingPoints"];
  revealAuthorized: VisualReductionContext["revealAuthorized"];
  historicalRevealAuthorized?:VisualReductionContext["revealAuthorized"];
}
export function visualOwnerKey(owner: VisualOwner): string { return visualHash(owner); }
/** Safe projection deliberately omits fact/inference provenance and expression refs.
 * Content is resolved exclusively from the pinned approved expression catalog. */
export function projectVisualView(state: WorkspaceVisualState, catalog: VisualBindingCatalog, auth: VisualViewAuthorization): VisualView {
  const candidates: { view: VisualView["annotations"][number]; priority: number; slot: string }[] = [];
  for (const annotation of state.annotations) {
    const valid = annotation.leases.filter(l => l.status === "active" && auth.ownerAuthorized(l.owner, l.lifetime)
      && (l.lifetime !== "explanation-group" || state.groups.some(g => g.group_id === l.owner.group_id && g.status === "active")));
    if (!valid.length) continue;
    let resolved: ReturnType<VisualBindingCatalog["resolve"]> | undefined;
    const permitted: VisualLease[] = [];
    for (const lease of valid) {
      try {
        resolved = catalog.resolve(annotation.binding_ref, { ...auth, scope: lease.owner.scope, revealAuthorized:!sameVisualOwner(lease.owner,auth.currentOwner)&&auth.historicalRevealAuthorized?auth.historicalRevealAuthorized:auth.revealAuthorized, form: annotation.form, lifetime: lease.lifetime });
        permitted.push(lease);
      } catch (error) {
        if (!(error instanceof VisualBindingError)) throw error;
      }
    }
    if (!permitted.length || !resolved) continue;
    if (stableVisualJson(resolved.targets) !== stableVisualJson(annotation.resolved_targets)) throw new VisualBindingError("VISUAL_TARGET_MISMATCH", annotation.annotation_id);
    const priority = Math.max(...permitted.map(l => (sameVisualOwner(l.owner, auth.currentOwner) ? 2 : 0) + (l.owner.group_id && l.owner.group_id === state.active_group_id ? 1 : 0)));
    candidates.push({ priority, slot: stableVisualJson([annotation.form, resolved.targets.angles ? resolved.targets.angles.map(a=>({vertex:a.vertex,ray_points:[...a.ray_points].sort(),sector:a.sector})).sort((a,b)=>stableVisualJson(a).localeCompare(stableVisualJson(b))) : annotation.form==="ratio-label" ? resolved.targets.entity_ids : [...resolved.targets.entity_ids].sort()]), view: {
      annotation_id: annotation.annotation_id, binding_ref: annotation.binding_ref, form: annotation.form, role_key: annotation.role_key,
      resolved_targets: resolved.targets, version: annotation.version,
      owner_keys: permitted.map(l => `${visualOwnerKey(l.owner)}/${l.lease_id}@${l.version}`).sort(),
      ...(resolved.expression === undefined ? {} : { content: resolved.expression }),
    } });
  }
  const slots = new Map<string, typeof candidates>();
  for (const candidate of candidates.sort((a,b) => a.view.annotation_id.localeCompare(b.view.annotation_id))) {
    const previous = slots.get(candidate.slot);
    if (!previous || previous[0].priority < candidate.priority) slots.set(candidate.slot, [candidate]);
    else if (previous[0].priority === candidate.priority) {
      if(previous.some(p=>p.view.content!==candidate.view.content))throw new VisualBindingError("VISUAL_SLOT_CONFLICT",candidate.slot);
      // Compatible roles over one mathematical target remain explicit. The
      // renderer merges the geometric primitive while preserving role labels.
      previous.push(candidate);
    }
  }
  const annotations = [...slots.values()].flat().map(v => v.view).sort((a,b) => a.annotation_id.localeCompare(b.annotation_id));
  let focus: VisualView["focus"] = null;
  const group = state.groups.find(g => g.group_id === state.active_group_id && g.status === "active");
  if (group?.focus && auth.ownerAuthorized(group.owner, "explanation-group")) {
    try {
      const resolved = catalog.resolve(group.focus.binding_ref, { ...auth, scope: group.owner.scope,pair_index:group.focus.pair_index });
      if (stableVisualJson(resolved.targets) !== stableVisualJson(group.focus.resolved_targets)) throw new VisualBindingError("VISUAL_TARGET_MISMATCH", group.group_id);
      focus = { ...structuredClone(group.focus), group_id: group.group_id, owner_key: visualOwnerKey(group.owner) };
    } catch (error) { if (!(error instanceof VisualBindingError)) throw error; }
  }
  const body = { visual_revision: state.visual_revision, annotations, focus };
  return { ...body, digest: visualHash(body) };
}

/** G2 bridge: reconstruct geometry from the existing authoritative tutor commands.
 * No independent geometry cache, DB, or renderer measurements enter this context. */
export function createVisualRuntimeContext(input: {
  catalog: VisualBindingCatalog;
  workspaceCatalog: import("./WorkspacePresentationCatalogV5").WorkspacePresentationCatalogV5;
  fold: import("./WorkspaceRuntimeReducerV5").WorkspaceFold;
  currentOwner: VisualOwner;
  /** Derived by G2 from the scope-enter/return event lineage (retained anchor included). */
  activeOwners: readonly VisualOwner[];
  inquiryAnchor?:VisualOwner;
  /** Current pinned Beat's approved graph closure, including inference premises. */
  authorizedBasisRefs: ReadonlySet<string>;
  currentReasoningRefs?:ReadonlySet<string>;
  /** Existing policy's exact current follow_along or satisfied-gate final authorization. */
  finalAuthorizedBasisRefs: ReadonlySet<string>;
}): VisualViewAuthorization & { constructionWorld: import("../../../../shared/actionRuntime").WorldProjection } {
  const world = applyDomainCommands({ revision:input.fold.state.revision, geometry:input.workspaceCatalog.baseGeometry }, input.fold.context.tutorCommands);
  const existingPoints = new Map(world.geometry?.points.map(p=>[p.id,{x:p.x,y:p.y}]) ?? []);
  const entities = new Set([...existingPoints.keys(), ...(world.geometry?.segments.map(s=>s.id) ?? [])]);
  const completedConstructions = new Set(input.catalog.constructionEntries().filter(([,outputs])=>outputs.every(id=>entities.has(id))).map(([id])=>id));
  return {
    constructionWorld:world,currentOwner:input.currentOwner,existingPoints,completedConstructions,
    ...(input.inquiryAnchor?{inquiryScope:input.currentOwner.scope}:{}),
    scopeAllows:(approved,current)=>visualScopeAllows(approved,current)||Boolean(input.inquiryAnchor&&visualScopeKey(current)===visualScopeKey(input.currentOwner.scope)&&visualScopeAllows(approved,input.inquiryAnchor.scope)),
    ownerAuthorized:(owner,lifetime)=>input.activeOwners.some(active=>sameVisualOwner(active,owner))
      || lifetime==="problem-part" && owner.scope.kind==="approved" && owner.part_ref===input.currentOwner.part_ref,
    historicalRevealAuthorized:binding=>binding.basis_refs.every(id=>input.authorizedBasisRefs.has(id))
      && (binding.reveal_scope!=="final_result" || binding.basis_refs.every(id=>input.finalAuthorizedBasisRefs.has(id))),
    revealAuthorized:binding=>(!input.inquiryAnchor||binding.reveal_scope!=="final_result")&&binding.basis_refs.every(id=>(input.currentReasoningRefs??input.authorizedBasisRefs).has(id))
      && (binding.reveal_scope!=="final_result" || binding.basis_refs.every(id=>input.finalAuthorizedBasisRefs.has(id))),
  };
}

export interface PinnedVisualWorkspaceInput {
  sessionId:string; catalogHash:string; catalog:VisualBindingCatalog;
  workspaceCatalog:import("./WorkspacePresentationCatalogV5").WorkspacePresentationCatalogV5;
  imported:import("../planBuild/v5/ImportApprovedPlanV5").ImportedApprovedPlanV5;
  /** G2's one scope lineage resolver; never derived from pending commands or model args. */
  authorityAt(events:readonly import("./kernel/sessionKernelTypes").StoredSessionEvent[]): {currentOwner:VisualOwner;activeOwners:readonly VisualOwner[];inquiryAnchor?:VisualOwner};
}
/** Production hook composition for V10FoldContext.visual. Legacy workspace actions
 * reuse the original Workspace reducer; visual actions reuse reduceVisual. */
export function createPinnedVisualWorkspaceBridge(input:PinnedVisualWorkspaceInput): import("./TutorRuntimeStateReducerV10").V10FoldContext["visual"] & {
  prepareTeachingAction(history:readonly import("./kernel/sessionKernelTypes").StoredSessionEvent[],ref:{sequence_id:string;ordinal:number;action_id:string}):{status:"completed";changed:boolean;resultingRevision:number};
  prepareInvalidation(history:readonly import("./kernel/sessionKernelTypes").StoredSessionEvent[],reason:import("../../../../shared/canonical/visualSchemas").VisualInvalidation["reason"]):{invalidation:import("../../../../shared/canonical/visualSchemas").VisualInvalidation;target:VisualView;workspaceRevision:number};
  generationAt(events:readonly import("./kernel/sessionKernelTypes").StoredSessionEvent[]): {workspace:import("./WorkspaceRuntimeReducerV5").WorkspaceFold;catalog:VisualBindingCatalog;state:WorkspaceVisualState;authorization:ReturnType<typeof createVisualRuntimeContext>;requirements:import("../../../../shared/canonical/visualSchemas").VisualRequirement[]};
  foldAt(events:readonly import("./kernel/sessionKernelTypes").StoredSessionEvent[]): {workspace:import("./WorkspaceRuntimeReducerV5").WorkspaceFold;visual:WorkspaceVisualState};
} {
  type Event=import("./kernel/sessionKernelTypes").StoredSessionEvent;
  const authorization=(history:readonly Event[],workspace:import("./WorkspaceRuntimeReducerV5").WorkspaceFold)=>{
    const authority=input.authorityAt(history);
    const current=authority.currentOwner.scope;
    const approved=current.kind==="approved"?current:current.anchor;
    const protocol=input.imported.protocols.get(approved.protocol_id);
    const beat=protocol?.beats.find(b=>b.beat_id===approved.beat_id);
    if(!beat)throw new VisualBindingError("VISUAL_SCOPE_UNKNOWN","pinned protocol/beat missing");
    const refinement=current.kind==="local"?input.imported.plan.solution_regions.find(r=>r.region_id===beat.inquiry_branch?.expand_region_id):undefined;
    if(current.kind==="local"&&!refinement)throw new VisualBindingError("VISUAL_REFINEMENT_UNAUTHORIZED","local scope has no approved refinement region");
    const refs=new Set(current.kind==="local"?[...refinement!.fine_refs.fact_ids,...refinement!.fine_refs.inference_ids]:[...beat.solution_refs.fact_ids,...beat.solution_refs.inference_ids]);
    const inferences=new Map(input.imported.graph.inferences.map(i=>[i.inference_id,i]));
    const expand=(id:string,seen=new Set<string>())=>{if(seen.has(id))throw new Error("cyclic pinned visual proof");const inference=inferences.get(id);if(!inference)return;seen.add(id);for(const ref of [...inference.premises,inference.conclusion]){refs.add(ref);expand(ref,new Set(seen));}};
    for(const id of [...refs])expand(id);
    const currentReasoningRefs=authority.inquiryAnchor?new Set(refs):undefined;
    const final=new Set<string>();
    const presented=new Set(history.filter(e=>e.event_type==="presentation_action_outcome_recorded"&&e.payload.outcome==="presented").map(e=>stableVisualJson([e.payload.sequence_id,e.payload.ordinal,e.payload.action_id])));
    for(const e of history)if(e.event_type==="presentation_sequence_planned"){
      const plan=presentationPlanV5Schema.parse({...e.payload,session_id:input.sessionId,schema:"ai_teaching_presentation_plan/v5"});
      for(const a of plan.actions){
        if(!a.workspace_action?.capability.startsWith("geometry.visual.")||!presented.has(stableVisualJson([plan.sequence_id,a.ordinal,a.workspace_action.action_id])))continue;
        const cmd=geometryVisualCommandSchema.parse(JSON.parse(a.workspace_action.command_payload??""));
        if(cmd.op!=="upsert")continue;
        const retained=authority.activeOwners.some(o=>sameVisualOwner(o,cmd.owner))||cmd.lifetime==="problem-part"&&cmd.owner.scope.kind==="approved"&&cmd.owner.part_ref===authority.currentOwner.part_ref;
        if(retained)for(const ref of input.catalog.get(cmd.binding_ref).basis_refs){refs.add(ref);if(current.kind==="approved"&&cmd.owner.scope.kind==="approved")final.add(ref);}
      }
    }
    const started=history.find(e=>e.event_type==="session_started");
    const gate=beat.completion_evidence.gate;
    const gateSatisfied=gate && workspace.context.gateLedger.evaluations.get(`${gate.gate_id}@${beat.beat_id}`)?.satisfied===true;
    const teach=current.kind==="approved" && started?.payload.session_mode==="teaching" && protocol?.protocol_kind!=="verification" && beat.completion_evidence.confirmation_target==="follow_along";
    if(!authority.inquiryAnchor&&(teach||current.kind==="approved"&&gateSatisfied))for(const ref of refs)final.add(ref);
    return createVisualRuntimeContext({catalog:input.catalog,workspaceCatalog:input.workspaceCatalog,fold:workspace,...authority,authorizedBasisRefs:refs,currentReasoningRefs,finalAuthorizedBasisRefs:final});
  };
  const scopeTransitions=(history:readonly Event[])=>{
    const revision=history.at(-1)?.state_revision;
    const steps:{owner:VisualOwner;transition:VisualOwnerTransition}[]=[];
    for(let i=0;i<history.length;i++) {
      const event=history[i];
      if(event.state_revision!==revision||event.event_type!=="policy_decision_made"||!["open_inquiry","open_scaffold","return_to_mainline","transition_beat","revisit_beat","complete_beat","continue_inquiry"].includes(String(event.payload.decision_kind)))continue;
      const old=input.authorityAt(history.slice(0,i)).currentOwner,next=input.authorityAt(history.slice(0,i+1)).currentOwner;
      const kind=event.payload.decision_kind;
      if(kind==="continue_inquiry"&&sameVisualOwner(old,next))continue;
      steps.push({owner:old,transition:kind==="complete_beat"?"completion":old.part_ref!==next.part_ref?"next-part":kind==="return_to_mainline"?"return-inquiry":kind==="open_inquiry"||kind==="open_scaffold"?"enter-inquiry":"next-beat"});
    }
    return steps;
  };
  type FoldSnapshot={workspace:import("./WorkspaceRuntimeReducerV5").WorkspaceFold;visual:WorkspaceVisualState;
    plans:Map<string,ReturnType<typeof presentationPlanV5Schema.parse>>;
    applied:Map<string,{action:VisualActionKey;changes:VisualLeaseChange[];confirmed:boolean;revoked:boolean}>};
  // Derived acceleration only. Exact serialized event prefixes, not revision or
  // array identity, fence changed payloads and same-revision competing batches.
  // Never publish a failed fold or expose the cached mutable maps to callers.
  const prefixes:{keys:string[];snapshot:FoldSnapshot}[]=[];
  const foldAt=(events:readonly Event[])=>{
    const keys=events.map(stableVisualJson);
    const cached=prefixes.filter(c=>c.keys.length<=keys.length&&c.keys.every((key,i)=>key===keys[i])).sort((a,b)=>b.keys.length-a.keys.length)[0];
    const start=events.find(e=>e.event_type==="session_started");
    if(!start)throw new VisualBindingError("VISUAL_START_MISSING",input.sessionId);
    let workspace=initialWorkspaceFold(input.sessionId,input.workspaceCatalog,undefined,start.payload as never);
    workspace.state={...workspace.state,schema:"ai_teaching_workspace_runtime_state/v2",solution_board:{...workspace.state.solution_board,explanation_fragments:[]}};
    let visual=emptyVisualState();
    let plans=new Map<string, ReturnType<typeof presentationPlanV5Schema.parse>>();
    let applied=new Map<string,{action:VisualActionKey;changes:VisualLeaseChange[];confirmed:boolean;revoked:boolean}>();
    // History is private, read-only event input plus our own array. It is not
    // part of the returned fold or cached mutable state. Exact value keys above
    // validate every reused prefix; using this call's events avoids retaining
    // caller-owned event aliases in a cache and repeated cloning of GEN payloads.
    const history:Event[]=cached ? events.slice(0,cached.keys.length) : [];
    if(cached){
      ({visual,plans,applied}=structuredClone({visual:cached.snapshot.visual,plans:cached.snapshot.plans,applied:cached.snapshot.applied}));
      workspace=cloneWorkspaceFoldV7(cached.snapshot.workspace);
    }
    for(const event of events.slice(history.length)){
      let delegated=true;
      if(event.event_type==="presentation_sequence_planned")plans.set(String(event.payload.sequence_id),presentationPlanV5Schema.parse({...event.payload,session_id:input.sessionId,schema:"ai_teaching_presentation_plan/v5"}));
      if(event.event_type==="presentation_action_applied"||event.event_type==="presentation_action_validated"){
        const plan=plans.get(String(event.payload.sequence_id));
        const ordered=plan?.actions.find(a=>a.ordinal===event.payload.ordinal);
        const action=ordered?.workspace_action;
        if(action?.capability.startsWith("geometry.visual.")){
          delegated=false;
          if(action.action_id!==event.payload.action_id)throw new VisualBindingError("VISUAL_ACTION_IDENTITY","planned/applied mismatch");
          const command=geometryVisualCommandSchema.parse(JSON.parse(action.command_payload??""));
          if(command.op!=="reconcile"){
            if(plan?.purpose!=="teaching"||action.presentation_only||action.capability!==`geometry.visual.${command.op}`)throw new VisualBindingError("VISUAL_ACTION_PERMISSION",action.action_id);
            const auth=authorization(history,workspace);
            const key:VisualActionKey={session_id:input.sessionId,sequence_id:plan!.sequence_id,ordinal:ordered!.ordinal,action_id:action.action_id};
            const id=stableVisualJson(key);
            if(applied.has(id))throw new VisualBindingError("VISUAL_DUPLICATE_APPLIED",action.action_id);
            const reduction=reduceVisual(visual,command,input.catalog,{...auth,owner:auth.currentOwner,action:key});
            if(event.event_type==="presentation_action_applied"){
              if(event.payload.resulting_workspace_revision!==workspace.state.revision+(reduction.changed?1:0))throw new VisualBindingError("VISUAL_WORKSPACE_REVISION",action.action_id);
              visual=reduction.state;workspace.state={...workspace.state,revision:workspace.state.revision+(reduction.changed?1:0)};
              applied.set(id,{action:key,changes:reduction.lease_changes,confirmed:false,revoked:false});
            }
          }
        }
      }
      if(event.event_type==="presentation_action_outcome_recorded"){
        const key={session_id:input.sessionId,sequence_id:event.payload.sequence_id,ordinal:event.payload.ordinal,action_id:event.payload.action_id};
        const record=applied.get(stableVisualJson(key));if(record && event.payload.outcome==="presented")record.confirmed=true;
      }
      if(event.event_type==="workspace_visual_owners_invalidated"){
        delegated=false;
        const payload=visualInvalidationSchema.parse(event.payload);
        const steps=payload.reason==="scope-transition"||payload.reason==="completion"?scopeTransitions(history):[];
        const latestDecision=history.findIndex(e=>e.state_revision===history.at(-1)?.state_revision&&e.event_type==="policy_decision_made");
        const before=payload.reason==="scope-transition"||payload.reason==="completion"?history.slice(0,latestDecision):history;
        const old=input.authorityAt(before).currentOwner, next=input.authorityAt(history).currentOwner;
        const transition:VisualOwnerTransition=payload.reason==="scope-transition"? old.part_ref!==next.part_ref?"next-part":old.scope.kind==="local"?"return-inquiry":next.scope.kind==="local"?"enter-inquiry":"next-beat":payload.reason==="completion"?"completion":"barge-in";
        const unconfirmed=[...applied.values()].filter(a=>!a.confirmed&&!a.revoked);
        const beforeRevision=visual.visual_revision;
        visual=foldVisualInvalidation({state:visual,workspaceRevision:workspace.state.revision,payload,owner:steps[0]?.owner??old,transition:steps[0]?.transition??transition,additionalTransitions:steps.slice(1),action:{session_id:input.sessionId,sequence_id:`event-${event.sequence}`,ordinal:0,action_id:`event-${event.sequence}`},unconfirmed});
        for(const record of unconfirmed)record.revoked=true;
        if(visual.visual_revision!==beforeRevision)workspace.state={...workspace.state,revision:workspace.state.revision+1};
      }
      if(delegated)workspace=applyWorkspaceV7Event(workspace,event as never,input.workspaceCatalog);
      history.push(event);
    }
    if(!cached||cached.keys.length!==keys.length){
      prefixes.push({keys,snapshot:{...structuredClone({visual,plans,applied}),workspace:cloneWorkspaceFoldV7(workspace)}});
      if(prefixes.length>8)prefixes.shift();
    }
    return {workspace,visual,unconfirmed:[...applied.values()].filter(a=>!a.confirmed&&!a.revoked)};
  };
  const prepareInvalidation=(history:readonly Event[],reason:import("../../../../shared/canonical/visualSchemas").VisualInvalidation["reason"])=>{
    const folded=foldAt(history);
    const steps=reason==="scope-transition"||reason==="completion"?scopeTransitions(history):[];
        const latestDecision=history.findIndex(e=>e.state_revision===history.at(-1)?.state_revision&&e.event_type==="policy_decision_made");
    const before=reason==="scope-transition"||reason==="completion"?history.slice(0,latestDecision):history;
    const old=input.authorityAt(before).currentOwner,next=input.authorityAt(history).currentOwner;
    const transition:VisualOwnerTransition=reason==="scope-transition"?old.part_ref!==next.part_ref?"next-part":old.scope.kind==="local"?"return-inquiry":next.scope.kind==="local"?"enter-inquiry":"next-beat":reason==="completion"?"completion":"barge-in";
    const sequence=(history.at(-1)?.sequence??0)+1;
    const result=prepareVisualInvalidation({state:folded.visual,workspaceRevision:folded.workspace.state.revision,reason,owner:steps[0]?.owner??old,transition:steps[0]?.transition??transition,additionalTransitions:steps.slice(1),action:{session_id:input.sessionId,sequence_id:`event-${sequence}`,ordinal:0,action_id:`event-${sequence}`},unconfirmed:folded.unconfirmed});
    return {invalidation:result.invalidation,target:projectVisualView(result.state,input.catalog,authorization(history,folded.workspace)),workspaceRevision:folded.workspace.state.revision+(result.state.visual_revision===folded.visual.visual_revision?0:1)};
  };
  const prepareTeachingAction=(history:readonly Event[],ref:{sequence_id:string;ordinal:number;action_id:string})=>{
    const folded=foldAt(history);
    const planned=history.find(e=>e.event_type==="presentation_sequence_planned"&&e.payload.sequence_id===ref.sequence_id);
    if(!planned)throw new VisualBindingError("VISUAL_PLAN_MISSING",ref.sequence_id);
    const plan=presentationPlanV5Schema.parse({...planned.payload,session_id:input.sessionId,schema:"ai_teaching_presentation_plan/v5"});
    const action=plan.actions.find(a=>a.ordinal===ref.ordinal)?.workspace_action;
    if(plan.purpose!=="teaching"||!action||action.action_id!==ref.action_id||!action.capability.startsWith("geometry.visual.")||action.presentation_only)throw new VisualBindingError("VISUAL_ACTION_PERMISSION",ref.action_id);
    const command=geometryVisualCommandSchema.parse(JSON.parse(action.command_payload??""));
    if(command.op==="reconcile"||action.capability!==`geometry.visual.${command.op}`)throw new VisualBindingError("VISUAL_ACTION_PERMISSION",ref.action_id);
    const auth=authorization(history,folded.workspace);
    const reduction=reduceVisual(folded.visual,command,input.catalog,{...auth,owner:auth.currentOwner,action:{session_id:input.sessionId,...ref}});
    return {status:"completed" as const,changed:reduction.changed,resultingRevision:folded.workspace.state.revision+(reduction.changed?1:0)};
  };
  return {catalogHash:input.catalogHash,foldAt,prepareInvalidation,prepareTeachingAction,
    resolveInquiryEntryBeat: id=>resolveVisualInquiryEntryBeat(input.imported,id),
    generationAt(events){const folded=foldAt(events);return {workspace:folded.workspace,catalog:input.catalog,state:folded.visual,authorization:authorization(events,folded.workspace),requirements:(input.imported.plan as unknown as {visual_requirements:import("../../../../shared/canonical/visualSchemas").VisualRequirement[]}).visual_requirements};},
    projectAt(events){const folded=foldAt(events);return projectVisualView(folded.visual,input.catalog,authorization(events,folded.workspace));},
    validateInvalidation(events,event){foldAt([...events,event]);},
    validateTeachingAction(events,event){
      if(event.event_type==="presentation_sequence_planned"){
        const plan=presentationPlanV5Schema.parse({...event.payload,session_id:input.sessionId,schema:"ai_teaching_presentation_plan/v5"});
        if(plan.purpose==="teaching"){
          const folded=foldAt(events),auth=authorization(events,folded.workspace);
          preflightPresentationSequence({fold:folded.workspace,catalog:input.workspaceCatalog,plan,visual:{catalog:input.catalog,state:folded.visual,owner:auth.currentOwner,permission:auth,constructionWorld:auth.constructionWorld,requirements:[],alreadyPresented:projectVisualView(folded.visual,input.catalog,auth),visibleTools:[]}});
        }
      }
      if(["presentation_sequence_planned","presentation_action_validated","presentation_action_applied"].includes(event.event_type))foldAt([...events,event]);
    },
  };
}

/** Resolver property name: v10RegistryProvider. The resolver owns exact artifact
 * resolution; this factory composes its existing capability registry with pure hooks. */
export function createVisualRegistryProvider(
  baseProvider:import("./RuntimeStateRebuilderV9").V9RegistryProvider,
  resolvePinned:(payload:Record<string,unknown>)=>Omit<PinnedVisualWorkspaceInput,"sessionId"> & {sessionId?:string},
):import("./RuntimeStateRebuilderV10").V10RegistryProvider {
  return payload=>{
    const base=baseProvider(payload),input=resolvePinned(payload);
    const pin=payload.tutor_plan_ref as {content_hash?:string}|undefined;
    if(pin?.content_hash!==input.catalog.planHash)throw new VisualBindingError("VISUAL_PLAN_PIN_MISMATCH","visual catalog differs from session plan");
    reconcileWorkspaceCatalogPin(input.sessionId??"unbound visual provider",input.workspaceCatalog,payload);
    const catalogPin=payload.workspace_catalog_pin as {content_hash?:string};
    if(catalogPin.content_hash!==input.catalogHash)throw new VisualBindingError("VISUAL_CATALOG_PIN_MISMATCH","cleanup catalog differs from session pin");
    // Keep the bridge for this resolved pin/context; no cross-session or global
    // cache. A fresh DB/codec context still rebuilds and validates independently.
    let boundBridge:ReturnType<typeof createPinnedVisualWorkspaceBridge>|undefined;
    let boundSessionId:string|undefined;
    const forEvents=(events:readonly import("./kernel/sessionKernelTypes").StoredSessionEvent[])=>{
      const sessionId=events[0]?.session_id;
      if(!sessionId||events.some(e=>e.session_id!==sessionId)||input.sessionId&&input.sessionId!==sessionId)throw new VisualBindingError("VISUAL_SESSION_MISMATCH","events must belong to one session");
      if(boundSessionId&&boundSessionId!==sessionId)throw new VisualBindingError("VISUAL_SESSION_MISMATCH","pinned context cannot cross sessions");
      boundSessionId=sessionId;
      return boundBridge??(boundBridge=createPinnedVisualWorkspaceBridge({...input,sessionId}));
    };
    const visual:ReturnType<typeof createPinnedVisualWorkspaceBridge>={catalogHash:input.catalogHash,
      validateGenerationCompanion:(body,payload,history)=>verifyCompanionSemantic(input,body,payload,history),
      resolveInquiryEntryBeat: id=>resolveVisualInquiryEntryBeat(input.imported,id),
      generationAt:events=>forEvents(events).generationAt(events),
      projectAt:events=>forEvents(events).projectAt(events),foldAt:events=>forEvents(events).foldAt(events),
      prepareInvalidation:(events,reason)=>forEvents(events).prepareInvalidation(events,reason),
      prepareTeachingAction:(events,ref)=>forEvents(events).prepareTeachingAction(events,ref),
      validateInvalidation:(events,event)=>forEvents([...events,event]).validateInvalidation(events,event),
      validateTeachingAction:(events,event)=>{
        if(!["presentation_sequence_planned","presentation_action_validated","presentation_action_applied"].includes(event.event_type))return;
        forEvents([...events,event]).validateTeachingAction!(events,event);
      },
    };
    const capabilities=new Map(base.capabilities);
    for(const capability of ["geometry.visual.upsert","geometry.visual.focus","geometry.visual.close-group","geometry.visual.reconcile"])
      capabilities.set(capability,{capability,surface:"geometry",origin:"tutor"});
    return Object.assign(Object.create(Object.getPrototypeOf(base)),base,{capabilities,visual});
  };
}
export interface WorkspaceVisualRebuildResult {
  state:import("zod").z.infer<typeof workspaceRuntimeStateV3Schema>;
  context:import("./WorkspaceRuntimeReducerV5").WorkspaceFoldContext;
  visualView:VisualView; eventCount:number;lastSequence:number;
}
export function rebuildWorkspaceRuntimeStateV10(sessionId:string,catalog:import("./WorkspacePresentationCatalogV5").WorkspacePresentationCatalogV5,
  provider:import("./RuntimeStateRebuilderV10").V10RegistryProvider):WorkspaceVisualRebuildResult {
  const verified=createV10Rebuilder(provider).verifyCommittedStreamV10(sessionId);
  const events=verified.events;
  reconcileWorkspaceCatalogPin(sessionId,catalog,events[0].payload);
  const hooks=provider(events[0].payload).visual as ReturnType<typeof createPinnedVisualWorkspaceBridge>;
  if(typeof hooks.foldAt!=="function")throw new VisualBindingError("VISUAL_PRODUCTION_FOLD_REQUIRED","registry must use pinned Workspace bridge");
  const folded=hooks.foldAt(events);
  const state=workspaceRuntimeStateV3Schema.parse({...folded.workspace.state,schema:"ai_teaching_workspace_runtime_state/v3",geometry:{...folded.workspace.state.geometry,visual_state:folded.visual}});
  return {state,context:folded.workspace.context,visualView:hooks.projectAt(events),eventCount:events.length,lastSequence:events.at(-1)?.sequence??1};
}
export function projectStudentWorkspaceViewV10(workspace:WorkspaceVisualRebuildResult,
  catalog:import("./WorkspacePresentationCatalogV5").WorkspacePresentationCatalogV5,
  participation:Parameters<typeof projectStudentWorkspaceViewV9>[2]):import("zod").z.infer<typeof studentWorkspaceViewV3Schema> {
  const {visual_state,...geometry}=workspace.state.geometry;
  const old=projectStudentWorkspaceViewV9({...workspace.state,schema:"ai_teaching_workspace_runtime_state/v2",geometry},catalog,participation);
  return studentWorkspaceViewV3Schema.parse({...old,schema:"ai_teaching_student_workspace_view/v3",canvas:{...old.canvas,visual:workspace.visualView}});
}
