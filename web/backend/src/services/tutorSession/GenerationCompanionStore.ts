import {presentationDraftV2Schema} from '../../../../shared/canonical';
/** Internal immutable audit companion. Never a teaching state, queue or View source. */
import {db} from '../../db/database';
import {visualHash,stableVisualJson} from './WorkspaceVisualReducer';
import type {PresentationDraftV2} from '../tutorOrchestration/presentationGeneration/GeneratorPort';
import type {BoundedVisualLoweringResult} from '../tutorOrchestration/presentationGeneration/BoundedVisualLowering';
export interface GenerationCompanion {
 policy_version:'presenter-bounded-visual-lowering/v1';
 original_draft:PresentationDraftV2;lowered_draft:PresentationDraftV2;
 original_digest:string;lowered_digest:string;
 source_indices:readonly number[];
 moves:BoundedVisualLoweringResult['moves'];
 item_action_mapping:readonly {original_item_index:number;final_item_index:number;action_ordinals:readonly number[]}[];
 compiler_actions:readonly {action_ordinal:number;source:'compiler-close'}[];
 final_actions_digest:string;
}
function fail(reason:string):never{throw new Error(`GENERATION_COMPANION_CORRUPT: ${reason}`);}
type AuditEvent={sequence:number;event_type:string;payload:any;state_revision?:number};
export interface CompanionValidationContext {visual?:{validateGenerationCompanion?:(body:GenerationCompanion,payload:any,history:readonly AuditEvent[])=>void}}
function isV15(payload:any):boolean{return payload?.generation?.presenter_pin?.prompt_version==='presenter-interleaved/v15-visual';}
function identity(payload:any):string{return stableVisualJson([payload.generation.request_id,payload.generation.attempt,payload.generation.epoch]);}
function originals(events:readonly AuditEvent[]):AuditEvent[]{const seen=new Map<string,AuditEvent>();for(const e of events){if(e.event_type!=='presentation_sequence_planned'||!isV15(e.payload))continue;const key=identity(e.payload);const first=seen.get(key);if(!first)seen.set(key,e);else if(stableVisualJson(first.payload.generation)!==stableVisualJson(e.payload.generation))fail('recovery generation identity drift');}return [...seen.values()];}
function semantic(body:GenerationCompanion,payload:any,history:readonly AuditEvent[],context?:CompanionValidationContext):void{const hook=context?.visual?.validateGenerationCompanion;if(!hook)fail('pinned semantic audit hook missing');hook(body,payload,history);}

function verifyBody(body:GenerationCompanion,payload:any):void{
 if(!presentationDraftV2Schema.safeParse(body.original_draft).success||!presentationDraftV2Schema.safeParse(body.lowered_draft).success)fail('invalid draft schema');
 if(body.policy_version!=='presenter-bounded-visual-lowering/v1'||visualHash(body.original_draft)!==body.original_digest||visualHash(body.lowered_draft)!==body.lowered_digest||visualHash(payload.actions)!==body.final_actions_digest)fail('digest/policy mismatch');
 const indices=body.source_indices,n=body.original_draft.items.length;
 if(indices.length!==n||new Set(indices).size!==n||indices.some(i=>!Number.isInteger(i)||i<0||i>=n))fail('non-bijective item mapping');
 if(body.original_draft.request_id!==payload.generation.request_id||body.lowered_draft.request_id!==payload.generation.request_id)fail('request mismatch');
 if(stableVisualJson(body.lowered_draft.items)!==stableVisualJson(indices.map(i=>body.original_draft.items[i])))fail('candidate is not original permutation');
 let next=0;
 if(body.item_action_mapping.length!==n)fail('action mapping count');
 for(const [j,m] of body.item_action_mapping.entries()){
  if(m.final_item_index!==j||m.original_item_index!==indices[j]||m.action_ordinals.length>1||m.action_ordinals.some(o=>o!==next++))fail('action mapping mismatch');
  if(!m.action_ordinals.length&&body.lowered_draft.items[j]?.tool!=='board.explain')fail('only duplicate board may emit zero actions');
 }
 if(body.compiler_actions.length!==payload.actions.length-next||body.compiler_actions.length>1||body.compiler_actions.some((a,j)=>a.action_ordinal!==next+j||a.source!=='compiler-close'||payload.actions[a.action_ordinal]?.workspace_action?.capability!=='geometry.visual.close-group'))fail('compiler action source mismatch');
 const rebuilt=Array.from({length:n},(_,i)=>i);
 if(body.moves.length>1)fail('multiple moves unsupported');
 for(const move of body.moves){const s=move.speech_original_index,vs=move.visual_original_indices;if(move.reason!=='adjacent-unique-visual-block'||!vs.length||vs.some((v,j)=>v!==s+1+j)||body.original_draft.items[s]?.type!=='speech')fail('move identity mismatch');const block=vs.map(i=>body.original_draft.items[i]);if(block.some(i=>i?.type!=='tool_intent'||!['geometry.annotate','geometry.emphasize'].includes(i.tool!))||block.filter(i=>i.tool==='geometry.emphasize').length!==1)fail('illegal move block');rebuilt.splice(s,vs.length+1,...vs,s);}
 if(stableVisualJson(rebuilt)!==stableVisualJson(indices))fail('move mapping mismatch');
}
export function appendGenerationCompanion(sessionId:string,batch:readonly AuditEvent[],companion?:GenerationCompanion,context?:CompanionValidationContext,history:readonly AuditEvent[]=[]):void{
 // Classify by first committed generation identity, never by optional fragment refs.
 const planned=originals([...history,...batch]).filter(e=>batch.some(b=>b.sequence===e.sequence));
 if(!planned.length){if(companion)fail('orphan companion');return;}
 if(planned.length!==1||!companion)fail('v15 original generation requires companion');
 const event=planned[0],payload=event.payload;verifyBody(companion,payload);semantic(companion,payload,history,context);const g=payload.generation;
 db.prepare('INSERT INTO tutor_generation_companions(session_id,sequence_id,request_id,attempt,epoch,planned_event_sequence,policy_version,input_digest,presenter_pin_json,companion_json) VALUES(?,?,?,?,?,?,?,?,?,?)').run(sessionId,payload.sequence_id,g.request_id,g.attempt,g.epoch,event.sequence,companion.policy_version,g.input_digest,stableVisualJson(g.presenter_pin),stableVisualJson(companion));
}
export function verifyGenerationCompanions(sessionId:string,context?:CompanionValidationContext):void{
 if(!db.prepare("SELECT 1 FROM tutor_session_events WHERE session_id=? AND event_type='presentation_sequence_planned' AND json_extract(payload_json,'$.generation.presenter_pin.prompt_version')='presenter-interleaved/v15-visual' LIMIT 1").get(sessionId))return;
 const rows=db.prepare('SELECT sequence,event_type,recorded_revision AS state_revision,payload_json FROM tutor_session_events WHERE session_id=? ORDER BY sequence').all(sessionId) as any[];
 const events:AuditEvent[]=rows.map(e=>({...e,payload:JSON.parse(e.payload_json)}));
 for(const event of originals(events)){const p=event.payload;const row=db.prepare('SELECT * FROM tutor_generation_companions WHERE session_id=? AND sequence_id=?').get(sessionId,p.sequence_id) as any;if(!row)fail('missing committed audit');const g=p.generation;if(row.planned_event_sequence!==event.sequence||row.request_id!==g.request_id||row.attempt!==g.attempt||row.epoch!==g.epoch||row.input_digest!==g.input_digest||row.presenter_pin_json!==stableVisualJson(g.presenter_pin))fail('committed identity mismatch');const body=JSON.parse(row.companion_json);if(row.policy_version!==body.policy_version)fail('policy column mismatch');verifyBody(body,p);semantic(body,p,events.filter(e=>e.sequence<event.sequence),context);}
}
