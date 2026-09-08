import type {PresentationDraftV2} from './GeneratorPort';
import {VISUAL_PRESENTER_PROMPT_VERSION,V12_VISUAL_PRESENTER_PROMPT_VERSION,V13_VISUAL_PRESENTER_PROMPT_VERSION,V14_VISUAL_PRESENTER_PROMPT_VERSION} from './PresenterPrompts';
import type {VisualCoverageIssue} from './VisualCoverageValidator';
export interface RepairAttemptIdentity {request_id:string;input_digest:string;attempt:number;epoch:number;presenter_pin:unknown}
export interface VisualRepairFeedback {
 source_attempt:number;source_epoch:number;
 issues: {code:VisualCoverageIssue['code'];binding_ref:string;form?:string;pair_index?:number;draft_item_index?:number}[];
 previous_speech_items:{draft_item_index:number;basis_refs:string[]}[];
 corrections?:{source:'rejected_uncommitted_candidate';draft_item_index?:number;binding_ref:string;code:VisualCoverageIssue['code'];rejected_speech?:{text:string;truncated:boolean;basis_refs:string[]};instruction:string}[];
 rejected_candidate?:{source:'rejected_uncommitted_candidate';complete:boolean;items:{draft_item_index:number;item:PresentationDraftV2['items'][number];text_truncated?:boolean}[]};
 required_order:readonly string[];
}
/** Ephemeral advice for the immediately adjacent owned attempt, never a retry
 * controller or persisted source. A new driver intentionally starts empty. */
export function createVisualRepairAdvisor(){
 let prior:{identity:RepairAttemptIdentity;feedback:VisualRepairFeedback}|undefined;
 return {
  remember(identity:RepairAttemptIdentity,issues:readonly VisualCoverageIssue[],speech:readonly {draft_item_index:number;basis_refs?:readonly string[];text?:string}[],candidate:readonly PresentationDraftV2["items"][number][]=[]){
   const version=(identity.presenter_pin as {prompt_version?:string})?.prompt_version;
   const corrections=[V13_VISUAL_PRESENTER_PROMPT_VERSION,V14_VISUAL_PRESENTER_PROMPT_VERSION,VISUAL_PRESENTER_PROMPT_VERSION].includes(version??'')?issues.slice(0,8).map(issue=>{
    const rejected=speech.find(s=>s.draft_item_index===issue.draft_item_index);
    const instructions:Record<VisualCoverageIssue['code'],string>={
     'late-visual':'此项已经引用该几何关系，不能先讲后标。请先完成该binding的必要展示，再安排这句讲解；后面的展示不能补救前面的语音。',
     'missing-focus':'此项讲解时没有保持该binding的当前focus。请在此项之前合法geometry.emphasize该binding，讲解后再close或切换；board binding不是geometry focus。',
     'ambiguous-visual-reference':'此项依据映射到多个几何关系。请拆分或在basis_refs明确本句唯一geometry binding，并先展示和focus该目标。',
     'missing-form':'完整候选缺少该binding的必要form，请按真实目录补齐本段展示，不能用历史或其他形式抵扣。',
     'missing-pair':'完整候选缺少该binding的必要pair，请按真实目录补齐该pair，保留其他pair。',
     'missing-pulse':'该pair缺少本段实际pulse，steady或历史不抵扣，请使用目录许可的pulse并保持当前pair讲解。',
    };
    return {source:'rejected_uncommitted_candidate' as const,...(issue.draft_item_index!==undefined?{draft_item_index:issue.draft_item_index}:{}),binding_ref:issue.binding_ref,code:issue.code,...(rejected?.text!==undefined?{rejected_speech:{text:rejected.text.slice(0,400),truncated:rejected.text.length>400,basis_refs:[...(rejected.basis_refs??[])].slice(0,32)}}:{}),instruction:instructions[issue.code]+([V14_VISUAL_PRESENTER_PROMPT_VERSION,VISUAL_PRESENTER_PROMPT_VERSION].includes(version??'')&&['late-visual','missing-focus'].includes(issue.code)?' 保留原句已批准主题和basis_refs，优先调整已有合法视觉工具与该句顺序；不要换话题、删除依据或用另一关系总述规避。':'')};
   }):undefined;
   let rejectedCandidate:VisualRepairFeedback['rejected_candidate'];
   if([V14_VISUAL_PRESENTER_PROMPT_VERSION,VISUAL_PRESENTER_PROMPT_VERSION].includes(version??'')&&candidate.length){
    rejectedCandidate={source:'rejected_uncommitted_candidate',complete:false,items:[]};
    for(const [draft_item_index,item]of candidate.slice(0,32).entries()){
     const copy:typeof rejectedCandidate.items[number]=item.type==='speech'
      ?{draft_item_index,item:{type:'speech',text:item.text!.slice(0,400),...(item.basis_refs?{basis_refs:[...item.basis_refs].slice(0,32)}:{})},text_truncated:item.text!.length>400}
      :{draft_item_index,item:{type:'tool_intent',tool:item.tool!,...(item.args?{args:{...(item.args.binding_ref?{binding_ref:item.args.binding_ref}:{}),...(item.args.params?{params:structuredClone(item.args.params)}:{})}}:{})}};
     const proposed={...rejectedCandidate,items:[...rejectedCandidate.items,copy]};
     if(JSON.stringify(proposed).length>12000)break;
     rejectedCandidate.items.push(copy);
    }
    rejectedCandidate.complete=rejectedCandidate.items.length===candidate.length&&!rejectedCandidate.items.some(i=>i.text_truncated||(candidate[i.draft_item_index].basis_refs?.length??0)>32||(candidate[i.draft_item_index].type==='tool_intent'&&candidate[i.draft_item_index].basis_refs!==undefined));
   }
   prior={identity:structuredClone(identity),feedback:{source_attempt:identity.attempt,source_epoch:identity.epoch,
    ...(corrections?{corrections}:{}),
    ...(rejectedCandidate?{rejected_candidate:rejectedCandidate}:{}),
    issues:issues.slice(0,32).map(i=>({code:i.code,binding_ref:i.binding_ref,...(i.form!==undefined?{form:i.form}:{}),...(i.pair_index!==undefined?{pair_index:i.pair_index}:{}),...([V12_VISUAL_PRESENTER_PROMPT_VERSION,V13_VISUAL_PRESENTER_PROMPT_VERSION,V14_VISUAL_PRESENTER_PROMPT_VERSION,VISUAL_PRESENTER_PROMPT_VERSION].includes(version??'')&&i.draft_item_index!==undefined?{draft_item_index:i.draft_item_index}:{})})),
    previous_speech_items:speech.slice(0,32).map(s=>({draft_item_index:s.draft_item_index,basis_refs:[...(s.basis_refs??[])].slice(0,32)})),
    required_order:['geometry.annotate(required form)','geometry.emphasize(current binding)','speech(current binding)','geometry.clear-visual(after speech)']}};
  },
  take(identity:RepairAttemptIdentity):VisualRepairFeedback|undefined{
   const held=prior;prior=undefined;if(!held)return undefined;
   const p=held.identity;
   if(p.request_id!==identity.request_id||p.input_digest!==identity.input_digest||JSON.stringify(p.presenter_pin)!==JSON.stringify(identity.presenter_pin)||identity.attempt!==p.attempt+1||identity.epoch!==p.epoch+1)return undefined;
   return structuredClone(held.feedback);
  },
 };
}
