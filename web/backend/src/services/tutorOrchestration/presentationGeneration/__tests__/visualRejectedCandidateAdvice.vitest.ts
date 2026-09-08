import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {createVisualRepairAdvisor} from '../VisualRepairAdvice';
import {VISUAL_PRESENTER_PROMPT_VERSION,V13_VISUAL_PRESENTER_PROMPT_VERSION,V13_VISUAL_PRESENTER_SYSTEM_PROMPT} from '../PresenterPrompts';
import type {PresentationDraftV2} from '../GeneratorPort';
const id=(version=VISUAL_PRESENTER_PROMPT_VERSION)=>({request_id:'GR-1',input_digest:'d',attempt:1,epoch:1,presenter_pin:{prompt_version:version}});
const issue={code:'missing-focus' as const,binding_ref:'VB-104',draft_item_index:0};
const candidate:PresentationDraftV2['items']=[{type:'speech',text:'由AA得到相似。',basis_refs:['FN-06','IF-02']},{type:'tool_intent',tool:'geometry.emphasize',args:{binding_ref:'VB-104',params:{group:'g',pair_index:0,mode:'pulse'}}}];
const advice=(version=VISUAL_PRESENTER_PROMPT_VERSION,items=candidate)=>{const a=createVisualRepairAdvisor(),source=id(version);a.remember(source,[issue],[{draft_item_index:0,text:items[0].text,basis_refs:items[0].basis_refs}],items);return a.take({...source,attempt:2,epoch:2})!;};
it('v14 sends rejected complete candidate with original order and keeps factual refs in instruction',()=>{const f=advice();expect(f.rejected_candidate).toEqual({source:'rejected_uncommitted_candidate',complete:true,items:[{draft_item_index:0,item:candidate[0],text_truncated:false},{draft_item_index:1,item:candidate[1]}]});expect(f.corrections![0].instruction).toContain('保留原句已批准主题和basis_refs');});
it('candidate return has no aliases to original nested params',()=>{const f=advice();f.rejected_candidate!.items[1].item.args!.params!.group='changed';expect(candidate[1].args!.params!.group).toBe('g');});
it('v13 retains speech advice without new candidate or new instruction',()=>{const f=advice(V13_VISUAL_PRESENTER_PROMPT_VERSION);expect(f.rejected_candidate).toBeUndefined();expect(f.corrections![0].rejected_speech?.text).toBe(candidate[0].text);expect(f.corrections![0].instruction).not.toContain('保留原句已批准主题');});
it('candidate count/text/total json bounds explicitly mark incomplete',()=>{const f=advice(VISUAL_PRESENTER_PROMPT_VERSION,Array.from({length:50},()=>({type:'speech',text:'x'.repeat(1000),basis_refs:['FN-06']})));expect(f.rejected_candidate!.complete).toBe(false);expect(f.rejected_candidate!.items.length).toBeLessThanOrEqual(32);expect(JSON.stringify(f.rejected_candidate).length).toBeLessThanOrEqual(12000);expect(f.rejected_candidate!.items[0].item.text).toHaveLength(400);});

it('v13 prompt bytes remain frozen',()=>expect(createHash('sha256').update(V13_VISUAL_PRESENTER_SYSTEM_PROMPT).digest('hex')).toBe('17e2c7e9ce1f9ec18220f795c4c806e32c14b4a2013f1ea58734c9b515a795f6'));

it('omitted unvalidated common tool basis refs prevent a complete claim even below cap',()=>{const items=structuredClone(candidate);items[1].basis_refs=['FN-private'];const f=advice(VISUAL_PRESENTER_PROMPT_VERSION,items);expect(f.rejected_candidate?.complete).toBe(false);expect(JSON.stringify(f.rejected_candidate)).not.toContain('FN-private');});
