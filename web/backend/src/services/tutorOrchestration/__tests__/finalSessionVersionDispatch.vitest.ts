/** Browser identity does not upgrade a pinned historical plan to the visual protocol. */
import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {TutorRuntimeApplicationV7} from '../TutorRuntimeApplicationV7';
import {TutorTaskBindingResolver} from '../TutorTaskBindingResolver';
import {importVisualReviewCandidate} from '../../planBuild/visual/ImportVisualReviewCandidate';
import {FixedResponseGateProvider} from '../../tutorNavigator/ModelGateAdjudicatorV5';
import {f6Model,realCanonicalRoot} from './f6Support';
import {PRESENTER_PROMPT_VERSION} from '../presentationGeneration/PresenterPrompts';
import type {PresenterGeneratorPort} from '../presentationGeneration/GeneratorPort';
const root=realCanonicalRoot();
let serial=0;
const input=()=>({task_id:'goldenMinhangFold2020',student_id:'version-dispatch',client_request_id:`dispatch-${++serial}`,client_instance_id:'CI-final-version-dispatch',sessionIdAllocator:()=>`TS-997780${String(serial).padStart(4,'0')}`});
const model=f6Model(new FixedResponseGateProvider([],'version-dispatch'),'version-dispatch');
const presenter:PresenterGeneratorPort={provider:'version-dispatch',modelId:'version-dispatch',pin:{provider:'version-dispatch',model_id:'version-dispatch',prompt_version:PRESENTER_PROMPT_VERSION,context_builder_version:'presentation-context-builder/v1',tool_catalog_version:'presentation-tool-catalog/v1'},async generatePresentationDraft(){throw Error('start and restore must not invoke a model');}};
it.each([false,true])('historical pinned plan with browser identity retains its reader (presenter=%s)',enabled=>{
 const app=TutorRuntimeApplicationV7.create({canonicalRoot:root,model,...(enabled?{presenter}:{})});
 const result=app.start(input());if(result.kind==='payload-drift')throw Error('unexpected drift');
 expect(result.orchestrator.eventSchema).toBe(enabled?'v9':'v7');
 expect(app.restore(result.orchestrator.sessionId).eventSchema).toBe(enabled?'v9':'v7');
 expect(result.orchestrator.events[0].payload).not.toHaveProperty('presentation_execution_owner');
});
it('visual pinned plan cannot silently fall back without browser identity or presenter',()=>{
 const loaded=importVisualReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});
 if(!loaded.ok)throw Error(loaded.errors.join(';'));
 const resolver=new TutorTaskBindingResolver(root,()=>loaded);
 const app=TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:resolver,model});
 const withOwner=input();const {client_instance_id,...withoutOwner}=withOwner;
 expect(()=>app.start(withoutOwner)).toThrow(/visual plan requires a browser execution owner/);
 expect(()=>app.start(withOwner)).toThrow(/V10 requires presenter pin/);
});
