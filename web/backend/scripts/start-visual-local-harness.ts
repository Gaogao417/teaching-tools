/** Local mechanical browser harness. Scripted teaching inputs + recorded silence;
 * real HTTP, SQLite, compiler, view, Canvas and media ended/outcome. No external
 * model, ASR or TTS calls; never evidence of model quality or Approved publication. */
import { mkdtempSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn } from 'node:child_process';
async function main(){
 if(process.env.NODE_ENV==='production')throw new Error('local harness only');
 const resumeIndex=process.argv.indexOf('--resume-run');
 const runDir=resumeIndex<0?mkdtempSync(join(tmpdir(),'visual-local-browser-')):resolve(process.argv[resumeIndex+1]);
 process.env.SQLITE_PATH=join(runDir,'runtime.sqlite');process.env.TUTOR_TELEMETRY='off';
 process.env.TUTOR_VNEXT_GENERATION='1';process.env.FRONTEND_ORIGIN='http://127.0.0.1:5194';
 const canonicalRoot='/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring';
 process.env.TUTOR_VNEXT_ROOT=canonicalRoot;
 const {importVisualReviewCandidate}=await import('../src/services/planBuild/visual/ImportVisualReviewCandidate');
 const loaded=importVisualReviewCandidate({canonicalRoot,candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});
 if(!loaded.ok)throw new Error(loaded.errors.join(';'));
 const {TutorTaskBindingResolver}=await import('../src/services/tutorOrchestration/TutorTaskBindingResolver');
 const {TutorRuntimeApplicationV7}=await import('../src/services/tutorOrchestration/TutorRuntimeApplicationV7');
 const {f6Model}=await import('../src/services/tutorOrchestration/__tests__/f6Support');
 const {VISUAL_PRESENTER_PROMPT_VERSION}=await import('../src/services/tutorOrchestration/presentationGeneration/PresenterPrompts');
 const {VISUAL_CONTEXT_BUILDER_VERSION,VISUAL_TOOL_CATALOG_VERSION}=await import('../src/services/tutorOrchestration/presentationGeneration/VisualPresentationTools');
 const resolver=new TutorTaskBindingResolver(canonicalRoot,(_deps,id)=>id===loaded.imported.plan.artifact_id?loaded:{ok:false,errors:['outside explicit Draft review']});
 const gate={name:'visual-local-scripted',async adjudicate(contextJson:string){const context=JSON.parse(contextJson);if(context.student_input?.text==='我没听懂，为什么这两组边是对应边？')return JSON.stringify({response_kind:'question',verdict:'not_applicable',reasoning_location:'aligned',grounding_refs:['FN-06']});return JSON.stringify({response_kind:'understanding_confirmation',matched_gate_id:context.eligible_gates[0]?.gate_id,verdict:'pass',reasoning_location:'unknown',grounding_refs:[]});}};
 const presenter:import('../src/services/tutorOrchestration/presentationGeneration/GeneratorPort').PresenterGeneratorPort={provider:'scripted-local',modelId:'scripted-local',pin:{provider:'scripted-local',model_id:'scripted-local',prompt_version:VISUAL_PRESENTER_PROMPT_VERSION,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION},async generatePresentationDraft(request){
  const payload=request.userPayload as any;
  writeFileSync(join(runDir,request.request_id+'.json'),JSON.stringify({request_id:request.request_id,payload},null,2));
  const items:any[]=[];
  const intent=(tool:string,args:unknown)=>items.push({type:'tool_intent',tool,args});
  const visual=payload.visual;
  if(!visual)throw new Error('visual context not connected');
  // Exercise genuine declared construction dependencies before visual references.
  const requirements=visual.requirements as Array<any>;
  const bindings=visual.bindings as Array<any>;
  const constructionIds=new Set<string>(requirements.flatMap(r=>bindings.find(b=>b.binding_id===r.binding_ref)?.required_constructions??[]));
  for(const binding_ref of constructionIds){const b=payload.tools.find((t:any)=>t.tool==='geometry.construct')?.bindings?.find((b:any)=>b.binding_ref===binding_ref);if(!b)continue; // Prior beats may already have constructed it; production preflight still verifies availability.
   if(!b.allowed_template_ids?.length)throw new Error('construction template missing '+binding_ref);intent('geometry.construct',{binding_ref,params:{template_id:b.allowed_template_ids[0]}});}
  for(const [index,r]of requirements.entries()){
   const binding=bindings.find(b=>b.binding_id===r.binding_ref);if(!binding)throw new Error('missing binding');
   if(binding.relation.type==='similarity'){
    for(const pair_index of r.required_pair_indices)intent('geometry.emphasize',{binding_ref:r.binding_ref,params:{group:`pair${index}`,pair_index,mode:'pulse'}});
    items.push({type:'speech',text:'请看图中逐对指认的对应边，它们是对应关系，不表示长度相等。',basis_refs:binding.basis_refs});
    intent('geometry.clear-visual',{params:{group:`pair${index}`}});
   }else{
    for(const form of r.forms)intent('geometry.annotate',{binding_ref:r.binding_ref,params:{form,lifetime:'teaching-scope'}});
    items.push({type:'speech',text:binding.purpose,basis_refs:binding.basis_refs});
   }
  }
  for(const b of payload.required_board_bindings??[])intent('board.explain',{binding_ref:b.binding_ref,params:{note_kind:'approved_math_note'}});
  if(!items.length)items.push({type:'speech',text:'这一步先到这里，你可以说说是否跟上。',basis_refs:[payload.allowed_knowledge[0].ref]});
  return{latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:request.request_id,items}};
 }};
 const applicationFactory=()=>TutorRuntimeApplicationV7.create({canonicalRoot,bindingResolver:resolver,model:f6Model(gate,'visual-local-scripted'),presenter});
 const {default:express}=await import('express');const {default:cors}=await import('cors');const app=express();app.use(cors({origin:process.env.FRONTEND_ORIGIN}));app.use(express.json());
 const silence=readFileSync(resolve('../frontend/e2e/tutor/assets/silent-1.5s.mp3'));
 app.post('/api/action-speech-stream',(_req,res)=>res.type('audio/mpeg').send(silence));
 app.post('/api/action-speech',(_req,res)=>res.json({audioUrl:`data:audio/mpeg;base64,${silence.toString('base64')}`}));
 app.post(/\/asr$/,(_req,res)=>res.status(503).json({error:{code:'LOCAL_ASR_DISABLED',message:'local harness does not call ASR'}}));
 const metadata={mode:'local-mechanical-harness',model:'scripted',tts:'recorded-silence',status:'Draft',publicationPerformed:false,runDir,url:'http://127.0.0.1:5194/learn/goldenMinhangFold2020'};
 app.get('/api/author-review',(_req,res)=>res.json(metadata));
 const {createGenerationWakeChannel}=await import('../src/services/tutorOrchestration/presentationGeneration/GenerationRecoveryWorker');
 const generationWake=createGenerationWakeChannel();
 const {createApp}=await import('../src/app');app.use(createApp({vnext:{applicationFactory,generationWake:generationWake.notify}}));
 const server=await new Promise<import('node:http').Server>((done,reject)=>{const s=app.listen(3134,'127.0.0.1',()=>done(s));s.once('error',reject);});
 const {startGenerationRecoveryWorker}=await import('../src/services/tutorOrchestration/presentationGeneration/GenerationRecoveryWorker');
 const worker=startGenerationRecoveryWorker(applicationFactory,e=>console.error('recovery error',String(e)));
 const vite=spawn(process.execPath,[resolve('../frontend/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5194','--strictPort'],{cwd:resolve('../frontend'),stdio:'inherit',env:{...process.env,VITE_API_BASE_URL:'http://127.0.0.1:3134',VITE_TEACH_REVIEW:'1'}});
 const unsubscribeWake=generationWake.subscribe(()=>worker.wake());
 const stop=()=>{unsubscribeWake();worker.stop();vite.kill();server.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);vite.once('exit',()=>{unsubscribeWake();worker.stop();server.close();});
 writeFileSync(join(runDir,'run.json'),JSON.stringify(metadata,null,2));console.log(JSON.stringify(metadata));
}
main().catch(e=>{console.error(String(e));process.exitCode=1;});
