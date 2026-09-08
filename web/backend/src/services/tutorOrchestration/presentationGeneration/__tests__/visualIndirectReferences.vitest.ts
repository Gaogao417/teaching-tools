import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {resolveVisualSpeechUses} from '../VisualCoverageValidator';
import {V9_VISUAL_PRESENTER_SYSTEM_PROMPT,V9_VISUAL_PRESENTER_PROMPT_VERSION,V10_VISUAL_PRESENTER_PROMPT_VERSION as VISUAL_PRESENTER_PROMPT_VERSION,V10_VISUAL_PRESENTER_SYSTEM_PROMPT as VISUAL_PRESENTER_SYSTEM_PROMPT,usesOnDemandVisualPolicy} from '../PresenterPrompts';
import {structuredPresenterGenerator} from '../GeneratorPort';
import type {StructuredModelPort} from '../../../tutorIntelligence/structuredModelPort';
const bindings=[{binding_id:'VB-102',basis_refs:['FN-05']},{binding_id:'VB-103',basis_refs:['FN-05']},{binding_id:'VB-104',basis_refs:['FN-06']}];
const inferences=new Map([['IF-01',{conclusion:'FN-05'}],['IF-02',{conclusion:'FN-06'}]]);
const resolve=(refs:string[])=>resolveVisualSpeechUses({speeches:[{ordinal:0,basis_refs:refs}],bindings,inferences});
it('real GR0002 first speech compound fact/inference requires explicit target',()=>{const r=resolve(['FN-03','FN-05','IF-01']);expect(r.uses).toEqual([]);expect(r.issues).toEqual(bindings.slice(0,2).map(b=>({binding_ref:b.binding_id,code:'ambiguous-visual-reference',speech_ordinal:0})));});
it.each(['FN-06','IF-02'])('unique fact/conclusion maps a current required target %j',ref=>{expect(resolve([ref])).toEqual({uses:[{ordinal:0,binding_ref:'VB-104'}],issues:[]});});
it('explicit target disambiguates compound approved facts and leaves premises as support',()=>{expect(resolve(['VB-102','FN-05','IF-01'])).toEqual({uses:[{ordinal:0,binding_ref:'VB-102'}],issues:[]});expect(resolve(['VB-104','FN-05','FN-06','IF-02']).uses).toEqual([{ordinal:0,binding_ref:'VB-104'}]);});
it('multiple explicit current targets remain ambiguous rather than demanding simultaneous focus',()=>{expect(resolve(['VB-102','VB-103','FN-05']).issues).toHaveLength(2);});
it('inference premises and unrelated transitions are not silently expanded',()=>{expect(resolve(['FN-03','RES2'])).toEqual({uses:[],issues:[]});expect(resolve(['IF-02']).uses).toEqual([{ordinal:0,binding_ref:'VB-104'}]);});
it('v9 bytes and pin stay readable while new runs explicitly select v10',()=>{expect(createHash('sha256').update(V9_VISUAL_PRESENTER_SYSTEM_PROMPT).digest('hex')).toBe('f9815efa81b444dc680b74fb67cfa4a93e2a0b140ecdb59119fe303d2ff531b2');expect(VISUAL_PRESENTER_SYSTEM_PROMPT.startsWith(V9_VISUAL_PRESENTER_SYSTEM_PROMPT+'\n29.')).toBe(true);expect(VISUAL_PRESENTER_PROMPT_VERSION).toBe('presenter-interleaved/v10-visual');for(const version of [V9_VISUAL_PRESENTER_PROMPT_VERSION,VISUAL_PRESENTER_PROMPT_VERSION]){expect(usesOnDemandVisualPolicy(version)).toBe(true);expect(structuredPresenterGenerator({provider:'offline',modelId:'offline'} as StructuredModelPort,{promptVersion:version}).pin?.prompt_version).toBe(version);}});

it('binding may itself cite approved inference identity, not only its conclusion',()=>{expect(resolveVisualSpeechUses({speeches:[{ordinal:0,basis_refs:['IF-02']}],bindings:[{binding_id:'VB-104',basis_refs:['IF-02']}],inferences})).toEqual({uses:[{ordinal:0,binding_ref:'VB-104'}],issues:[]});});
it('same binding repeated for separate form obligations is one semantic target',()=>{expect(resolveVisualSpeechUses({speeches:[{ordinal:0,basis_refs:['FN-06']}],bindings:[bindings[2],bindings[2]],inferences})).toEqual({uses:[{ordinal:0,binding_ref:'VB-104'}],issues:[]});});
