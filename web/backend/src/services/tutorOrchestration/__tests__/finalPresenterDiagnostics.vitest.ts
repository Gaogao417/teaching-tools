import {expect,it} from 'vitest';
import {PresenterGenerationError,presenterFailureDiagnostic,structuredPresenterGenerator,mapStructuredModelError} from '../presentationGeneration/GeneratorPort';
import {StructuredModelError} from '../../tutorIntelligence/structuredModelPort';
import {PRESENTER_PROMPT_VERSION} from '../presentationGeneration/PresenterPrompts';
it('canonical validation reports precise safe paths without serializing raw provider objects',async()=>{
 const port=structuredPresenterGenerator({provider:'test-only',modelId:'test-only',async complete<T>(){return {value:{items:[{type:'tool_intent',tool:'board.explain',args:{binding_ref:'VB-06',params:{}},text:'unexpected field'}]} as T,modelId:'test-only',promptVersion:PRESENTER_PROMPT_VERSION,latencyMs:1};}});
 let error:unknown;try{await port.generatePresentationDraft({request_id:'GR-diagnostics-0001',systemPrompt:'test',promptVersion:PRESENTER_PROMPT_VERSION,userPayload:{},timeoutMs:100});}catch(value){error=value;}
 expect(error).toBeInstanceOf(PresenterGenerationError);expect(presenterFailureDiagnostic(error)).toMatchObject({failure_class:'draft_invalid',retryable:false,diagnostic:{stage:'draft_validation',issues:[{path:['items',0],code:'custom',message:'invalid draft item discriminant'}]}});
});
it('review logger never copies request headers, provider details or arbitrary error messages',()=>{
 const error=Object.assign(new PresenterGenerationError('provider_failure','Bearer do-not-log',false),{headers:{Authorization:'secret'},apiKey:'secret'});
 const text=JSON.stringify(presenterFailureDiagnostic(error));expect(text).not.toMatch(/secret|Bearer|headers|apiKey/);
 expect(presenterFailureDiagnostic(new Error('secret response'))).toEqual({name:'Error'});
});

it('provider invalid JSON is distinguished without recording response body',()=>{
 const error=mapStructuredModelError(new StructuredModelError('invalid-json','unsafe provider details',false));
 expect(presenterFailureDiagnostic(error)).toEqual({name:'PresenterGenerationError',failure_class:'draft_invalid',retryable:false,diagnostic:{stage:'provider',code:'invalid-json'}});
});
