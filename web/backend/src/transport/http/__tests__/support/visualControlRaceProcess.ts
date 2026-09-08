/** Test-only independent HTTP worker. No model or speech provider calls. */
import express from 'express';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {createVNextTutorRoutes} from '../../vnextTutorRoutes';
import {TutorRuntimeApplicationV7} from '../../../../services/tutorOrchestration/TutorRuntimeApplicationV7';
import {TutorTaskBindingResolver} from '../../../../services/tutorOrchestration/TutorTaskBindingResolver';
import {importVisualReviewCandidate} from '../../../../services/planBuild/visual/ImportVisualReviewCandidate';
import {f6Model,realCanonicalRoot} from '../../../../services/tutorOrchestration/__tests__/f6Support';
import {FixedResponseGateProvider} from '../../../../services/tutorNavigator/ModelGateAdjudicatorV5';
import {db} from '../../../../db/database';
import {VISUAL_PRESENTER_PROMPT_VERSION} from '../../../../services/tutorOrchestration/presentationGeneration/PresenterPrompts';
import {VISUAL_TOOL_CATALOG_VERSION,VISUAL_CONTEXT_BUILDER_VERSION} from '../../../../services/tutorOrchestration/presentationGeneration/VisualPresentationTools';
const root=realCanonicalRoot();
const loaded=importVisualReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});
if(!loaded.ok)throw Error(loaded.errors.join(';'));
const resolver=new TutorTaskBindingResolver(root,()=>loaded);
const application=TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:resolver,model:f6Model(new FixedResponseGateProvider([]),'control-race'),presenter:{provider:'no-provider',modelId:'no-provider',pin:{provider:'no-provider',model_id:'no-provider',prompt_version:VISUAL_PRESENTER_PROMPT_VERSION,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION},async generatePresentationDraft(){throw Error('provider forbidden in atomicity test');}}});
const [mode,id,release]=process.argv.slice(2);
const events=()=>db.prepare('SELECT sequence,event_type,payload_json FROM tutor_session_events WHERE session_id=? ORDER BY sequence').all(id);
async function main(){
 if(mode==='seed'){
  const result=application.start({task_id:'goldenMinhangFold2020',student_id:'control-race',client_instance_id:'race-original-owner',client_request_id:'race-start',sessionIdAllocator:()=>id});
  if(!('orchestrator'in result))throw Error('start failed');
  const s=result.orchestrator;
  process.send?.({seed:{revision:s.revision,owner:s.visualLifecycle!.presentation_execution_owner,eventCount:events().length}});return;
 }
 if(mode==='scan'){
  const s=application.restore(id);process.send?.({scan:{events:events(),snapshot:s.snapshot(),lifecycle:s.visualLifecycle,parity:s.assertReplayParity()}});return;
 }
 const submit=application.submitStudentInput.bind(application);
 application.submitStudentInput=async(...args)=>{try{return await submit(...args);}catch(error){process.send?.({caught:{name:(error as Error).name,code:(error as {code?:string}).code,message:(error as Error).message}});throw error;}};
 const restore=application.restore.bind(application);
 let blocked=false;
 application.restore=(sessionId:string)=>{
  const s=restore(sessionId);
  if(!blocked){blocked=true;process.send?.({ready:true,pid:process.pid,revision:s.revision,busyTimeout:db.pragma('busy_timeout',{simple:true})});
   const until=Date.now()+10000;
   while(!existsSync(release)){if(Date.now()>until)throw Error('race barrier timed out');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);}
  }
  return s;
 };
 const app=express();app.use(express.json());app.use('/api/vnext',createVNextTutorRoutes({applicationFactory:()=>application}));
 const server=app.listen(0,'127.0.0.1',()=>process.send?.({listening:true,port:(server.address() as {port:number}).port,pid:process.pid}));
 process.on('message',message=>{if(message==='stop')server.close(()=>{db.close();process.exit(0);});});
}
main().then(()=>{if(mode!=='worker'){db.close();process.exit(0);}}).catch(error=>{console.error(error);process.exit(1);});
