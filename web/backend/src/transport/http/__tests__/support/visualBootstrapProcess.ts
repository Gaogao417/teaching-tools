import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { TutorRuntimeApplicationV7 } from '../../../../services/tutorOrchestration/TutorRuntimeApplicationV7';
import { TutorTaskBindingResolver } from '../../../../services/tutorOrchestration/TutorTaskBindingResolver';
import { importVisualReviewCandidate } from '../../../../services/planBuild/visual/ImportVisualReviewCandidate';
import { FixedResponseGateProvider } from '../../../../services/tutorNavigator/ModelGateAdjudicatorV5';
import { f6Model } from '../../../../services/tutorOrchestration/__tests__/f6Support';
import { createGenerationRecoveryScanner } from '../../../../services/tutorOrchestration/presentationGeneration/GenerationRecoveryWorker';
import { VISUAL_PRESENTER_PROMPT_VERSION } from '../../../../services/tutorOrchestration/presentationGeneration/PresenterPrompts';
import { VISUAL_TOOL_CATALOG_VERSION, VISUAL_CONTEXT_BUILDER_VERSION } from '../../../../services/tutorOrchestration/presentationGeneration/VisualPresentationTools';
import type { PresenterGeneratorPort } from '../../../../services/tutorOrchestration/presentationGeneration/GeneratorPort';
import { TutorSessionKernelV10 } from '../../../../services/tutorSession/TutorSessionKernelV10';
import { db } from '../../../../db/database';
const root='/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring';
const loaded=importVisualReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});
if(!loaded.ok)throw new Error(loaded.errors.join(';'));
const resolver=new TutorTaskBindingResolver(root,(_deps,id)=>id===loaded.imported.plan.artifact_id?loaded:{ok:false,errors:['outside isolated review']});
let calls=0;
const presenter:PresenterGeneratorPort={provider:'visual-http-test-only',modelId:'visual-http-test-only',
  pin:{provider:'visual-http-test-only',model_id:'visual-http-test-only',prompt_version:VISUAL_PRESENTER_PROMPT_VERSION,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION},
  async generatePresentationDraft(request){calls++;
    const payload=request.userPayload as {required_board_bindings?:Array<{binding_ref:string}>};
    return {latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:request.request_id,items:[
      {type:'tool_intent',tool:'geometry.annotate',args:{binding_ref:'VB-101',params:{form:'angle-arcs',lifetime:'teaching-scope'}}},
      {type:'speech',text:'我们先看题目给出的两个相等角。',basis_refs:['FN-03']},
      ...(payload.required_board_bindings??[]).map(b=>({type:'tool_intent' as const,tool:'board.explain',args:{binding_ref:b.binding_ref,params:{note_kind:'approved_math_note'}}})),
    ]}};
  }};
const model=f6Model(new FixedResponseGateProvider([],'visual-http-test'),'visual-http-test');
const visualHttpApplication=()=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:resolver,model,presenter});

const [mode,sessionId,boundary,release]=process.argv.slice(2);
async function main() {
 if(mode==='seed') {
  const started=visualHttpApplication().start({task_id:'goldenMinhangFold2020',student_id:'process-bootstrap',client_instance_id:'process-page',client_request_id:'process-start'});
  if(!('orchestrator' in started))throw new Error('seed start failed');
  const row=db.prepare('SELECT payload_json FROM tutor_session_events WHERE session_id=? ORDER BY sequence LIMIT 1').get(started.orchestrator.sessionId) as {payload_json:string};
  process.send?.({payload:JSON.parse(row.payload_json)});return;
 }
 if(mode==='boundary') {
  TutorSessionKernelV10.start({sessionId,studentId:'process-target',occurred_at:new Date().toISOString(),sessionStarted:JSON.parse(readFileSync(boundary,'utf8'))},resolver.v10RegistryProvider);
  if(release==='decision') {
   // Exit after the real decision CAS commits, before generation reservation.
   const session=visualHttpApplication().restore(sessionId);
   (session as unknown as {navigator:{completeBootstrap():unknown}}).navigator.completeBootstrap();
  }
  process.exit(73);
 }
 const errors:Array<{code?:string;message:string}>=[];
 const application=visualHttpApplication();
 if(mode==='race') {
  const restore=application.restore.bind(application);
  application.restore=(id:string)=>{
   const session=restore(id);
   process.send?.({ready:true,pid:process.pid});
   const deadline=Date.now()+10000;
   while(!existsSync(release)) {
    if(Date.now()>deadline)throw new Error('worker release timeout');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
   }
   return session;
  };
 }
 const scanner=createGenerationRecoveryScanner(()=>application,error=>errors.push({code:(error as {code?:string}).code,message:String(error)}));
 await scanner.scanOnce();scanner.stop();
 const rows=db.prepare('SELECT event_type,payload_json FROM tutor_session_events WHERE session_id=? ORDER BY sequence').all(sessionId);
 process.send?.({events:rows,errors,pid:process.pid});
}
main().then(()=>{db.close();process.disconnect?.();}).catch(error=>{console.error(error);process.exit(1);});
