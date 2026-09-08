/** Generate and compile a real short explanation from an imported production plan. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
async function main() {
  process.env.SQLITE_PATH = ':memory:';
  process.env.TUTOR_PRESENTER_PROVIDER = 'dashscope';

  const { importApprovedPlanV5 } = await import('../src/services/planBuild/v5/ImportApprovedPlanV5');
  const { buildPresentationContext, DEFAULT_CONTEXT_POLICY } = await import('../src/services/tutorOrchestration/presentationGeneration/ContextBuilder');
  const { createPresenterGenerator } = await import('../src/services/tutorOrchestration/presentationGeneration/GeneratorPort');
  const { buildPresenterPrompt } = await import('../src/services/tutorOrchestration/presentationGeneration/PresenterPrompts');
  const { visiblePresentationTools } = await import('../src/services/tutorOrchestration/presentationGeneration/PresentationToolCatalog');
  const { compilePresentationIntents } = await import('../src/services/tutorOrchestration/presentationGeneration/IntentCompiler');
  const args=process.argv.slice(2);
  const arg=(key:string)=>{ const i=args.indexOf(key);if(i<0||!args[i+1])throw new Error(`${key} required`);return args[i+1]; };
  const root=resolve(arg('--canonical-root')); const job=JSON.parse(readFileSync(arg('--request'),'utf8'));
  process.env.TUTOR_PRESENTER_MODEL = job.models?.presenter || 'qwen-plus';
  const result=importApprovedPlanV5({canonicalRoot:root,anchored:true},arg('--plan'),{workspaceCatalog:job.resource_catalog});
  if(!result.ok)throw new Error(result.errors.join('; '));
  const imported=result.imported;
  const graph={facts:new Map(imported.graph.facts.map(f=>[f.fact_id,f])),inferences:new Map(imported.graph.inferences.map(i=>[i.inference_id,i]))};
  const resources=new Map(imported.plan.resources.map(r=>[r.resource_id,r]));
  const protocol=[...imported.protocols.values()][0];
  const beat=protocol.beats[0];
  const context=buildPresentationContext({planRef:{artifact_id:imported.plan.artifact_id,version:imported.plan.version,content_hash:imported.plan.content_hash},graphRef:{artifact_id:imported.graph.graph_id,version:imported.graph.version,content_hash:imported.graph.content_hash},graph,
    beat:{protocol_id:protocol.protocol_id,beat_id:beat.beat_id,graph_fact_refs:beat.solution_refs.fact_ids,inference_refs:beat.solution_refs.inference_ids,resource_ids:beat.resource_ids??[]},recentInputs:[],eventCutoff:0,workspaceRevision:0,currentRevision:0,policy:DEFAULT_CONTEXT_POLICY,sessionMode:'teaching',resourceContent:id=>resources.get(id)?.content});
  const selected=new Set(context.basis.map(b=>b.ref));
  const visibleTools=visiblePresentationTools({registeredCapabilities:new Set(['solution_board.explain_fragment']),bindings:imported.plan.resource_bindings??[],sessionMode:'teaching',scopeAllows:b=>b.binding_kind==='explanation' && b.basis_refs.fact_ids.every(id=>selected.has(id)) && b.basis_refs.inference_ids.every(id=>selected.has(id))});
  const prompt=buildPresenterPrompt({context,studentContext:job.student_context,instructionalGoal:beat.purpose,currentGranularity:'beat',alreadyPresented:[],stuckPoint:null,visibleTools,maxItems:8,maxSpeechChars:600});
  const generator=createPresenterGenerator();const requestId='GR-TS-9001-0001';
  const generated=await generator.generatePresentationDraft({request_id:requestId,systemPrompt:prompt.systemPrompt,promptVersion:prompt.promptVersion,userPayload:prompt.userPayload,timeoutMs:120000});
  const sequence=compilePresentationIntents({sessionId:'TS-9001',sequenceSerial:1,decisionId:'TD-TS-9001-production',scope:{kind:'approved',protocol_id:protocol.protocol_id,beat_id:beat.beat_id},request:{request_id:requestId,attempt:1,epoch:1,input_digest:context.digest,presenter_pin:generator.pin},draft:generated.draft,context,visibleTools,resources,graph,approvedConstructions:[],revealAuthorized:()=>false});
  writeFileSync(arg('--output'),JSON.stringify({status:'EXPLANATION_COMPILED',plan:imported.plan.artifact_id,provider:generator.provider,model_id:generator.modelId,prompt,context_digest:context.digest,draft:generated.draft,sequence,browser_accepted:false},null,2)+'\n',{flag:'wx'});
}
main().catch(error=>{console.error(error instanceof Error?error.message:'verification failed');process.exitCode=1;});
