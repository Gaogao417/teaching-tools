import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {validateVisualCoverage,type VisualCoverageIssue} from '../VisualCoverageValidator';
import type {CompiledVisualAction} from '../VisualIntentCompiler';
import type {VisualRequirement,VisualView} from '../../../../../../shared/canonical/visualSchemas';
import {createVisualRepairAdvisor} from '../VisualRepairAdvice';
import {VISUAL_PRESENTER_PROMPT_VERSION,V11_VISUAL_PRESENTER_PROMPT_VERSION,V11_VISUAL_PRESENTER_SYSTEM_PROMPT} from '../PresenterPrompts';
const requirement={binding_ref:'VB-1',forms:['paired-sides'],required_pair_indices:[0,1,2],trigger:'introduce'} as VisualRequirement;
const view={annotations:[]} as unknown as VisualView;
const focus=(ordinal:number,pair_index:number,binding_ref='VB-1',mode='pulse')=>({ordinal,command:{op:'focus',binding_ref,pair_index,mode,group_id:'g'}} as CompiledVisualAction);
const close=(ordinal:number)=>({ordinal,command:{op:'close-group',group_id:'g'}} as CompiledVisualAction);
const options={requireCurrentPresentation:true,requireEntryPulse:true};
const uses=[1,3,5].map(ordinal=>({ordinal,binding_ref:'VB-1'}));
const actions=[focus(0,0),focus(2,1),focus(4,2)];
it('each current pair may be explained before future pairs while whole segment remains complete',()=>expect(validateVisualCoverage([requirement],actions,view,uses,options)).toEqual([]));
it('omitting a later required pair still fails',()=>expect(validateVisualCoverage([requirement],actions.slice(0,2),view,uses.slice(0,2),options)).toContainEqual({binding_ref:'VB-1',code:'missing-pair',pair_index:2}));
it('steady or history does not substitute this segment entry pulse',()=>expect(validateVisualCoverage([requirement],actions.map(a=>focus(a.ordinal,(a.command as {pair_index:number}).pair_index,'VB-1','steady')),view,uses,options).filter(x=>x.code==='missing-pulse')).toHaveLength(3));
it.each([{extra:[]},{extra:[close(0.5)]},{extra:[focus(0.5,0,'VB-other')]}])('no focus / close / other binding cannot serve early speech %j',({extra})=>{const xs=extra.length?[...actions,...extra]:actions.map(a=>({...a,ordinal:a.ordinal+2}));expect(validateVisualCoverage([requirement],xs,view,[uses[0]],options)).toEqual(expect.arrayContaining([expect.objectContaining({code:'missing-focus',speech_ordinal:1})]));});
it('speech before any pair is identified precisely and rejected despite complete later pairs',()=>expect(validateVisualCoverage([requirement],actions.map(a=>({...a,ordinal:a.ordinal+8})),view,[{ordinal:7,binding_ref:'VB-1'}],options)).toEqual(expect.arrayContaining([expect.objectContaining({code:'late-visual',speech_ordinal:7}),expect.objectContaining({code:'missing-focus',speech_ordinal:7})])));
it('only v12 feedback exposes precise item location; v11 shape remains historical',()=>{const issue:VisualCoverageIssue={binding_ref:'VB-1',code:'missing-focus',speech_ordinal:9,draft_item_index:7};for(const version of [V11_VISUAL_PRESENTER_PROMPT_VERSION,VISUAL_PRESENTER_PROMPT_VERSION]){const a=createVisualRepairAdvisor(),source={request_id:'GR-1',input_digest:'d',attempt:1,epoch:1,presenter_pin:{prompt_version:version}};a.remember(source,[issue],[]);const f=a.take({...source,attempt:2,epoch:2})!;expect(f.issues[0].draft_item_index).toBe(version===VISUAL_PRESENTER_PROMPT_VERSION?7:undefined);expect(JSON.stringify(f)).not.toContain('speech_ordinal');}});

it('nonempty historical paired annotation cannot replace missing fresh pair pulses',()=>{const history={annotations:[{binding_ref:'VB-1',form:'paired-sides'}]} as unknown as VisualView;expect(validateVisualCoverage([requirement],[],history,[],options)).toEqual(expect.arrayContaining([expect.objectContaining({code:'missing-form'}),...([0,1,2].map(pair_index=>({binding_ref:'VB-1',code:'missing-pair',pair_index})))]));});

it('v11 prompt bytes stay frozen',()=>expect(createHash('sha256').update(V11_VISUAL_PRESENTER_SYSTEM_PROMPT).digest('hex')).toBe('812ba01ae7c1aa7a508ce36536c0831144717cb2c4a578cfaa6508feaeed2640'));
