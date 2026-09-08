/** FM11-1 typed fault propagation at the actual builder call. Not corrupt-asset
 * or concurrency evidence; pair with presentationContextBuilder.test.ts inputs. */
import {afterEach,describe,it,expect,vi} from 'vitest';
import {db} from '../../../db/database';
import {realCanonicalRoot} from '../../tutorNavigator/__tests__/navigatorSupport';
import {TutorSessionOrchestratorV7} from '../TutorSessionOrchestratorV7';
import {FixedResponseGateProvider} from '../../tutorNavigator/ModelGateAdjudicatorV5';
import {f6Model} from './f6Support';
import * as ContextBuilder from '../presentationGeneration/ContextBuilder';
import type {PresenterGeneratorPort} from '../presentationGeneration/GeneratorPort';
const root=realCanonicalRoot();let serial=0;
const sessionId=()=>`TS-97${Date.now()}${++serial}`;
function dependencies(){
 const provider=new FixedResponseGateProvider([],'typed-context-boundary');
 const generate=vi.fn<PresenterGeneratorPort['generatePresentationDraft']>(async()=>{throw new Error('Presenter must not be invoked');});
 const presenter:PresenterGeneratorPort={provider:'scripted-context-boundary',modelId:'context-boundary/v1',pin:{provider:'scripted-context-boundary',model_id:'context-boundary/v1',prompt_version:'presenter-interleaved/v1',context_builder_version:'presentation-context-builder/v1',tool_catalog_version:'presentation-tool-catalog/v1'},generatePresentationDraft:generate};
 return{provider,presenter,generate};
}
function stream(id:string){return db.prepare('SELECT sequence,event_type,payload_json FROM tutor_session_events WHERE session_id=? ORDER BY sequence').all(id) as {sequence:number;event_type:string;payload_json:string}[];}
function start(id:string,d:ReturnType<typeof dependencies>){return TutorSessionOrchestratorV7.start({sessionId:id,studentId:'typed-context-boundary',taskId:'goldenMinhangFold2020',canonicalRoot:root,model:f6Model(d.provider,'typed-context-boundary'),presenter:d.presenter});}
afterEach(()=>vi.restoreAllMocks());
describe('FM11-1 real Orchestrator builder-boundary typed errors',()=>{
 it('control reaches actual builder and reserves generation without calling provider',()=>{
  const spy=vi.spyOn(ContextBuilder,'buildPresentationContext');const id=sessionId(),d=dependencies();start(id,d);
  expect(spy).toHaveBeenCalledOnce();expect(stream(id).filter(e=>e.event_type==='presentation_generation_requested')).toHaveLength(1);expect(d.generate).not.toHaveBeenCalled();expect(d.provider.callCount).toBe(0);
 });
 it.each(['CONTEXT_LOOKUP_FAILED','STALE_CONTEXT','CONTEXT_FORBIDDEN','CONTEXT_UNAVAILABLE'] as const)('%s propagates intact without generation or Gate side effects',kind=>{
  const failure=new ContextBuilder.PresentationContextError(kind,`explicit test injection at builder call: ${kind}`);let observed:ContextBuilder.ContextBuildInput|undefined;
  const spy=vi.spyOn(ContextBuilder,'buildPresentationContext').mockImplementation(input=>{observed=input;throw failure;});const id=sessionId(),d=dependencies();
  let thrown:unknown;try{start(id,d);}catch(error){thrown=error;}
  expect(thrown).toBe(failure);expect((thrown as ContextBuilder.PresentationContextError).kind).toBe(kind);expect(spy).toHaveBeenCalledOnce();expect(observed?.graph.facts.size).toBeGreaterThan(0);expect(observed?.graph.inferences.size).toBeGreaterThan(0);expect(observed?.planRef.artifact_id).toBeDefined();expect(observed?.graphRef.content_hash).toMatch(/^sha256:/);
  expect(d.generate).not.toHaveBeenCalled();expect(d.provider.callCount).toBe(0);
  const events=stream(id);expect(events.some(e=>e.event_type==='session_started')).toBe(true);
  // Bootstrap and its policy decision are allowed. Nothing else is silently
  // normalized into successful generation, browser presentation or evidence.
  expect(events.every(e=>['session_started','policy_decision_made'].includes(e.event_type))).toBe(true);
  for(const type of ['presentation_generation_requested','presentation_generation_attempt_started','presentation_sequence_planned','presentation_action_delivered','presentation_action_outcome_recorded','gate_evaluated','beat_completed','session_completed'])expect(events.filter(e=>e.event_type===type),type).toHaveLength(0);
  for(const table of ['tutor_generation_leases','tutor_generation_companions']){
   const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);if(exists)expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE session_id=?`).get(id) as {n:number}).n).toBe(0);
  }
  console.log(JSON.stringify({scope:'injected-builder-error-real-orchestrator',kind,sessionId:id,bootstrapEvents:events.map(e=>({sequence:e.sequence,type:e.event_type})),presenterCalls:d.generate.mock.calls.length,gateProviderCalls:d.provider.callCount}));
 });
});
