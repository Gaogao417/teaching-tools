import {resolveVisualSpeechUses} from '../tutorOrchestration/presentationGeneration/VisualCoverageValidator';
/** Read-only source-to-action audit, using the pinned compiler's existing content renderer.
 * This does not compile, reorder, execute or grant permission. Canonical fold/preflight
 * remains responsible for action legality; this checks the companion describes it. */
import type {GenerationCompanion} from './GenerationCompanionStore';
import type {PinnedVisualWorkspaceInput} from './VisualViewProjector';
import {normalizeVisualVoiceFractions,renderFragmentContent,validateParams} from '../tutorOrchestration/presentationGeneration/IntentCompiler';
import {toolSpecById,type PresentationResourceBinding} from '../tutorOrchestration/presentationGeneration/PresentationToolCatalog';
import {stableVisualJson} from './WorkspaceVisualReducer';
const equal=(a:unknown,b:unknown)=>stableVisualJson(a)===stableVisualJson(b);
const fail=(reason:string):never=>{throw Error(`GENERATION_COMPANION_CORRUPT: source/action ${reason}`);};
export function verifyCompanionSemantic(input:Pick<PinnedVisualWorkspaceInput,'imported'|'catalog'>,body:GenerationCompanion,p:any,history:readonly {event_type:string;payload:any;state_revision?:number}[]):void{
 const request=history.find(e=>e.event_type==='presentation_generation_attempt_started'&&e.payload.request_id===p.generation.request_id&&e.payload.attempt===p.generation.attempt&&e.payload.epoch===p.generation.epoch)?.payload;
 if(!request?.context)fail('frozen generation context missing');
 const bindings=(input.imported.plan as unknown as {resource_bindings:PresentationResourceBinding[]}).resource_bindings;
 const graph={facts:new Map(input.imported.graph.facts.map(f=>[f.fact_id,f])),inferences:new Map(input.imported.graph.inferences.map(i=>[i.inference_id,i]))};
 const requirements=(input.imported.plan as unknown as {visual_requirements:{scope:unknown;binding_ref:string}[]}).visual_requirements.filter(r=>equal(r.scope,request.scope));
 const resolved=resolveVisualSpeechUses({speeches:body.original_draft.items.flatMap((item,ordinal)=>item.type==='speech'?[{ordinal,basis_refs:item.basis_refs}]:[]),bindings:requirements.map(r=>input.catalog.get(r.binding_ref)),inferences:graph.inferences});
 for(const move of body.moves){
  const target=resolved.uses.find(u=>u.ordinal===move.speech_original_index)?.binding_ref;
  const block=move.visual_original_indices.map(i=>body.original_draft.items[i]);const alias=block[0]?.args?.params?.group;
  const next=body.original_draft.items[move.visual_original_indices.at(-1)!+1];
  if(!target||typeof alias!=='string'||block.some(i=>i.args?.binding_ref!==target||i.args?.params?.group!==alias)||next?.type==='tool_intent'&&['geometry.annotate','geometry.emphasize'].includes(next.tool!))fail('move target/group/maximality');
 }
 const known:string[]=[];const plans=new Map<string,any>();const fragments=new Map<string,any>();
 for(const e of history){if(e.state_revision!>request.context.event_cutoff)continue;
  if(e.event_type==='presentation_sequence_planned'){plans.set(e.payload.sequence_id,e.payload);for(const f of e.payload.explanation_fragments??[])fragments.set(f.fragment_id,f);}
  if(e.event_type==='presentation_action_outcome_recorded'&&e.payload.outcome==='presented'){
   const a=plans.get(e.payload.sequence_id)?.actions[e.payload.ordinal];
   if(a?.kind!=='workspace'||e.payload.kind!==a.kind||a.workspace_action.action_id!==e.payload.action_id||a.workspace_action.capability!=='board.explain')continue;
   const f=fragments.get(a.workspace_action.command_payload);if(f&&['approved_math_note','relation_note'].includes(f.kind))known.push(f.content);
  }
 }
 const groups=new Map<string,string>();let active:string|undefined,lastSpeech='';const emittedFragments=new Set<string>();
 const group=(alias:unknown,open:boolean):string=>{if(typeof alias!=='string'||!/^[a-z][a-z0-9_]{0,15}$/.test(alias))return fail('group alias');let id=groups.get(alias);if(!id){if(!open)return fail('unknown group');id=`${p.sequence_id}/g/${groups.size}`;groups.set(alias,id);}if(open){if(active&&active!==id)fail('nested group');active=id;}else{if(active!==id)fail('closed group');active=undefined;}return id;};
 for(const [j,item] of body.lowered_draft.items.entries()){
  const mapped=body.item_action_mapping[j].action_ordinals;const action=mapped.length?p.actions[mapped[0]]:undefined;
  if(item.type==='speech'){
   if(!action||action.kind!=='voice'||action.voice_action.text!==normalizeVisualVoiceFractions(item.text!)||!equal(action.basis_refs??[],item.basis_refs??[]))fail('speech text/refs');lastSpeech=item.text!;continue;
  }
  const params=item.args?.params??{},bindingRef=item.args?.binding_ref;
  if(['geometry.annotate','geometry.emphasize','geometry.clear-visual'].includes(item.tool!)){
   const w=action?.workspace_action;if(!w||action.kind!=='workspace')fail('visual action missing');const c=JSON.parse(w.command_payload);
   if(item.tool==='geometry.clear-visual'){
    if(bindingRef!==undefined||Object.keys(params).some(k=>k!=='group')||c.op!=='close-group'||c.group_id!==group(params.group,false)||w.capability!=='geometry.visual.close-group')fail('close params');continue;
   }
   const binding=input.catalog.get(bindingRef!);
   if(c.binding_ref!==bindingRef||!equal(action.basis_refs??[],binding.basis_refs))fail('visual binding/basis');
   if(item.tool==='geometry.annotate'){
    if(Object.keys(params).some(k=>!['form','lifetime','group'].includes(k))||c.op!=='upsert'||w.capability!=='geometry.visual.upsert'||c.form!==params.form||c.lifetime!==params.lifetime||c.owner.group_id!==(params.group===undefined?undefined:group(params.group,true)))fail('annotation params');
   }else if(Object.keys(params).some(k=>!['group','mode','pair_index'].includes(k))||c.op!=='focus'||w.capability!=='geometry.visual.focus'||c.mode!==params.mode||c.pair_index!==params.pair_index||c.group_id!==group(params.group,true))fail('focus params');
   continue;
  }
  const spec=toolSpecById(item.tool!);if(!spec||!validateParams(spec,params).ok)fail('tool parameters');const binding=bindings.find(b=>b.binding_id===bindingRef);if(!binding)fail('unknown resource binding');
  if(item.tool==='board.explain'){
   const kind=params.note_kind as Parameters<typeof renderFragmentContent>[0];const content=kind==='explanation_text'?lastSpeech:renderFragmentContent(kind,binding!,graph,known,true);
   if(content===''&&kind!=='explanation_text'){if(mapped.length)fail('duplicate board unexpectedly emits');continue;}
   const w=action?.workspace_action;const f=p.explanation_fragments?.find((f:any)=>f.fragment_id===w?.command_payload);
   const refs=binding!.binding_kind==='explanation'?[...binding!.basis_refs.fact_ids,...binding!.basis_refs.inference_ids]:binding!.binding_kind==='board'?[binding!.board_entry_id]:undefined;
   const attached=binding!.binding_kind==='board'?binding!.board_entry_id:undefined;
   if(!f||w.capability!=='board.explain'||!content||f.content!==content||f.kind!==kind||!equal(f.basis_refs,refs)||f.attach_to_entry!==attached||f.origin_generation!==p.generation.request_id)fail('board content/basis');
   emittedFragments.add(f.fragment_id);if(kind!=='explanation_text')known.push(content!);continue;
  }
  const w=action?.workspace_action;if(!w||w.capability!==spec!.capability)fail('tool capability');
  if(spec!.effect_class==='construct'){
   if(binding!.binding_kind!=='geometry')fail('construct binding');const b=binding as Extract<PresentationResourceBinding,{binding_kind:'geometry'}>;const target=params.template_id??b.geometry_target;
   if(!b.allowed_template_ids.includes(target as string)||!equal(w.target_ids,[target]))fail('construct target');
  }else if(spec!.effect_class==='reveal'){
   if(binding!.binding_kind!=='board'||!equal(w.target_ids,[binding!.board_entry_id]))fail('reveal target');
  }else fail('unsupported tool');
 }
 if(emittedFragments.size!==(p.explanation_fragments??[]).length)fail('unmapped fragment');
 for(const extra of body.compiler_actions){const w=p.actions[extra.action_ordinal].workspace_action,c=JSON.parse(w.command_payload);if(!active||c.op!=='close-group'||c.group_id!==active)fail('compiler close mismatch');active=undefined;}
 if(active)fail('unclosed group');
}
