import type { VisualOwner } from '../../../../shared/canonical/visualSchemas';
import type { StoredSessionEvent } from './kernel/sessionKernelTypes';
import type { ImportedApprovedPlanV5 } from '../planBuild/v5/ImportApprovedPlanV5';
import { visualScopeEpochs } from './TutorRuntimeStateReducerV10';
/** Entry identity comes only from the imported, pinned protocol. */
export function resolveVisualInquiryEntryBeat(imported:ImportedApprovedPlanV5,protocolId:string):string {
 const protocol=imported.protocols.get(protocolId);
 if(!protocol||!protocol.beats.some(beat=>beat.beat_id===protocol.entry_beat_id))throw new Error('VISUAL_INQUIRY_ENTRY_MISSING');
 return protocol.entry_beat_id;
}
/** Event-derived visit authority, shared by live validation and replay. */
export function visualAuthorityAt(events:readonly StoredSessionEvent[], imported:ImportedApprovedPlanV5):{currentOwner:VisualOwner;activeOwners:VisualOwner[];inquiryAnchor?:VisualOwner} {
 const initial=events[0]?.payload.initial_cursor as {protocol_id:string;beat_id:string}|undefined;
 if(!initial)throw new Error('VISUAL_INITIAL_CURSOR_MISSING');
 const part=(p:string,b:string)=>imported.protocols.get(p)?.beats.find(x=>x.beat_id===b)?.part_id??'1';
 let localBeatIds=new Set<string>();
 let current:VisualOwner={scope:{kind:'approved',...initial},scope_epoch:1,part_ref:part(initial.protocol_id,initial.beat_id)},anchor:VisualOwner|undefined;
 for(let i=0;i<events.length;i++) {
  if(events[i].event_type!=='policy_decision_made')continue;
  const d=events[i].payload as {decision_kind:string;protocol_id:string;beat_id:string;to_beat_id?:string;inquiry?:{inquiry_id:string;inquiry_protocol_id?:string};local_inquiry_protocol?:{local_protocol_id:string;beats:{beat_id:string}[]}};
  const epoch=Math.max(1,visualScopeEpochs(events.slice(0,i+1),id=>resolveVisualInquiryEntryBeat(imported,id)).current);
  if(d.decision_kind==='open_inquiry'||d.decision_kind==='open_scaffold') {
   if(!d.inquiry)throw new Error('VISUAL_INQUIRY_ID_MISSING');anchor=structuredClone(current);
   if(d.inquiry.inquiry_protocol_id) {
    const p=imported.protocols.get(d.inquiry.inquiry_protocol_id);if(!p)throw new Error('VISUAL_INQUIRY_PROTOCOL_MISSING');
    current={scope:{kind:'approved',protocol_id:p.protocol_id,beat_id:p.entry_beat_id},scope_epoch:epoch,part_ref:anchor.part_ref};
   } else {
    const l=d.local_inquiry_protocol;if(!l||anchor.scope.kind!=='approved')throw new Error('VISUAL_LOCAL_PROTOCOL_MISSING');localBeatIds=new Set(l.beats.map(b=>b.beat_id));
    current={scope:{kind:'local',inquiry_id:d.inquiry.inquiry_id,local_protocol_id:l.local_protocol_id,local_beat_id:l.beats[0].beat_id,anchor:{protocol_id:anchor.scope.protocol_id,beat_id:anchor.scope.beat_id}},scope_epoch:epoch,part_ref:anchor.part_ref};
   }
  } else if(d.decision_kind==='return_to_mainline') {
   if(!anchor)throw new Error('VISUAL_ANCHOR_MISSING');current=anchor;anchor=undefined;
  } else if(d.decision_kind==='transition_beat'||d.decision_kind==='revisit_beat') {
   if(!d.to_beat_id)throw new Error('VISUAL_TARGET_BEAT_MISSING');
   current={scope:{kind:'approved',protocol_id:d.protocol_id,beat_id:d.to_beat_id},scope_epoch:epoch,part_ref:part(d.protocol_id,d.to_beat_id)};anchor=undefined;
  } else if(d.decision_kind==='continue_inquiry') {
   if(current.scope.kind==='local') {
    // Existing local continue payload names its approved anchor, not a target.
    // Advance only when the committed protocol and beat explicitly identify a
    // real local target; otherwise retain the recorded local cursor.
    if(d.protocol_id===current.scope.local_protocol_id) {
     if(!localBeatIds.has(d.beat_id))throw new Error('VISUAL_LOCAL_BEAT_UNKNOWN');
     current={...current,scope_epoch:epoch,scope:{...current.scope,local_beat_id:d.beat_id}};
    }
   } else if(d.inquiry?.inquiry_protocol_id===current.scope.protocol_id) {
    const target=d.to_beat_id??d.beat_id;
    if(!imported.protocols.get(current.scope.protocol_id)?.beats.some(b=>b.beat_id===target))throw new Error('VISUAL_INQUIRY_BEAT_UNKNOWN');
    current={...current,scope_epoch:epoch,scope:{...current.scope,beat_id:target}};
   }
  }
 }
 return {currentOwner:current,activeOwners:anchor?[anchor,current]:[current],...(anchor?{inquiryAnchor:anchor}:{})};
}
