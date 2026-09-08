import type {PresentationDraftV2} from './GeneratorPort';
import type {VisualCoverageIssue} from './VisualCoverageValidator';
import {visualHash} from '../../tutorSession/WorkspaceVisualReducer';
export const BOUNDED_VISUAL_LOWERING_POLICY='presenter-bounded-visual-lowering/v1';
export interface BoundedVisualLoweringResult {
 readonly draft:PresentationDraftV2;
 readonly sourceIndices:readonly number[];
 readonly moves:readonly {speech_original_index:number;visual_original_indices:readonly number[];reason:'adjacent-unique-visual-block'}[];
 readonly original_digest:string;readonly lowered_digest:string;
}
/** Pure permutation only. Caller must first validate the entire original draft
 * and preflight its legal commands; no action identity or runtime state is owned here. */
export function lowerAdjacentVisualBlock(draft:PresentationDraftV2,issues:readonly VisualCoverageIssue[],targets:ReadonlyMap<number,string>):BoundedVisualLoweringResult{
 const sourceIndices=draft.items.map((_,i)=>i),options:{speech:number;end:number}[]=[];
 for(const [i,item]of draft.items.entries()){
  if(item.type!=='speech'||!issues.some(x=>x.draft_item_index===i&&(x.code==='late-visual'||x.code==='missing-focus')))continue;
  const binding=targets.get(i);if(!binding)continue;
  let end=i+1;
  while(end<draft.items.length){const next=draft.items[end];if(next.type!=='tool_intent'||!['geometry.annotate','geometry.emphasize'].includes(next.tool!))break;end++;}
  const block=draft.items.slice(i+1,end),focus=block.filter(x=>x.tool==='geometry.emphasize');
  if(!block.length||focus.length!==1)continue;
  const group=focus[0].args?.params?.group;
  if(typeof group!=='string'||block.some(x=>x.args?.binding_ref!==binding||x.args?.params?.group!==group))continue;
  let activeGroup:string|undefined;
  for(const preceding of draft.items.slice(0,i)){
   if(preceding.type!=='tool_intent')continue;
   if(preceding.tool==='geometry.clear-visual')activeGroup=undefined;
   else if(['geometry.annotate','geometry.emphasize'].includes(preceding.tool!)&&typeof preceding.args?.params?.group==='string')activeGroup=preceding.args.params.group;
  }
  if(activeGroup!==undefined&&activeGroup!==group)continue;
  options.push({speech:i,end});
 }
 // The first bounded policy deliberately refuses interacting/multiple moves.
 const moves:BoundedVisualLoweringResult['moves']=options.length===1?[{speech_original_index:options[0].speech,visual_original_indices:sourceIndices.slice(options[0].speech+1,options[0].end),reason:'adjacent-unique-visual-block'}]:[];
 if(moves.length){const {speech,end}=options[0];sourceIndices.splice(speech,end-speech,...sourceIndices.slice(speech+1,end),speech);}
 const lowered={...structuredClone(draft),items:sourceIndices.map(i=>structuredClone(draft.items[i]))};
 return {draft:lowered,sourceIndices,moves,original_digest:visualHash(draft),lowered_digest:visualHash(lowered)};
}
