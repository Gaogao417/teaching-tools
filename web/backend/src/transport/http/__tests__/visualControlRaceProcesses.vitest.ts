import {fork} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {expect,it} from 'vitest';
function worker(database:string,args:string[]){
 const process=fork(resolve('src/transport/http/__tests__/support/visualControlRaceProcess.ts'),args,{execArgv:['--import','tsx'],env:{...globalThis.process.env,SQLITE_PATH:database,TUTOR_TELEMETRY:'off'},stdio:['ignore','pipe','pipe','ipc']});
 const messages:any[]=[];let stderr='';process.stderr?.on('data',s=>stderr+=s);
 const waiters:Array<{predicate:(m:any)=>boolean;resolve:(m:any)=>void}>=[];
 process.on('message',m=>{messages.push(m);for(const w of waiters)if(w.predicate(m))w.resolve(m);});
 const done=new Promise<void>((resolve,reject)=>{process.on('error',reject);process.on('exit',code=>code===0?resolve():reject(Error(`worker ${code}: ${stderr}`)));});
 void done.catch(()=>undefined);
 return {process,done,messages,wait(predicate:(m:any)=>boolean):Promise<any>{const old=messages.find(predicate);if(old)return Promise.resolve(old);return Promise.race([new Promise(resolve=>waiters.push({predicate,resolve})),done.then(()=>{throw Error('worker exited before expected message');})]);}};
}
it('H17 two independent HTTP workers race the same revision: one atomic cleanup, explicit loser, third-process replay',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'f7-control-http-race-')),database=join(dir,'race.sqlite'),release=join(dir,'release'),id='TS-984512001';
 const children:ReturnType<typeof worker>[]=[];const run=(args:string[])=>{const c=worker(database,args);children.push(c);return c;};
 try{
  const seed=run(['seed',id]);const {seed:baseline}=await seed.wait(m=>m.seed);await seed.done;
  const workers=[run(['worker',id,release]),run(['worker',id,release])];
  const ports=await Promise.all(workers.map(w=>w.wait(m=>m.listening)));expect(ports[0].pid).not.toBe(ports[1].pid);
  const requests=ports.map((p,i)=>fetch(`http://127.0.0.1:${p.port}/api/vnext/tutor-sessions/${id}/student-inputs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:{kind:'control',command:'barge_in'},client_request_id:`race-control-${i}`,expected_revision:baseline.revision,execution_owner:baseline.owner})}).then(async r=>({status:r.status,body:await r.json()})));
  // Both requests are inside distinct server processes, after verified restore
  // of the same revision and before admission/commit. Release only then.
  const ready=await Promise.all(workers.map(w=>w.wait(m=>m.ready)));expect(ready.map(r=>r.revision)).toEqual([baseline.revision,baseline.revision]);writeFileSync(release,'go');
  const responses=await Promise.all(requests);
  for(const w of workers)w.process.send('stop');await Promise.all(workers.map(w=>w.done));
  const scan=run(['scan',id]);const {scan:result}=await scan.wait(m=>m.scan);await scan.done;
  if(process.env.VISUAL_RACE_EVIDENCE)writeFileSync(process.env.VISUAL_RACE_EVIDENCE,JSON.stringify({baseline,pids:ports.map(p=>p.pid),ready,caught:workers.flatMap(w=>w.messages.filter(m=>m.caught)),responses:responses.map(r=>({status:r.status,error:r.body.error})),result},null,2));
  const delta=result.events.slice(baseline.eventCount);const count=(type:string)=>delta.filter((e:any)=>e.event_type===type).length;
  for(const type of ['student_input_recorded','workspace_visual_owners_invalidated','visual_barrier_changed','presentation_sequence_planned','presentation_action_validated','presentation_action_applied','presentation_action_delivered'])expect(count(type),type).toBe(1);
  expect(count('presentation_generation_invalidated')).toBe(1);expect(delta).toHaveLength(8);expect(count('presentation_action_outcome_recorded')).toBe(0);expect(count('gate_evaluated')).toBe(0);
  expect(result.lifecycle.visual_barrier.status).toBe('awaiting-cleanup');expect(result.snapshot.pending_presentation.action.workspace_action.capability).toBe('geometry.visual.reconcile');expect(result.lifecycle.presentation_execution_owner).toEqual(baseline.owner);expect(result.parity.equal).toBe(true);
  expect(responses.map(r=>r.status).sort(),JSON.stringify(responses.map(r=>({status:r.status,error:r.body.error})))).toEqual([200,409]);
  const loser=responses.find(r=>r.status===409)!;expect(JSON.stringify(loser.body)).toMatch(/REVISION_CONFLICT|CAS_CONFLICT|CONCURRENT_MODIFICATION/);
 }finally{
  for(const c of children)if(c.process.exitCode===null)c.process.kill('SIGKILL');await Promise.all(children.map(c=>c.done.catch(()=>undefined)));rmSync(dir,{recursive:true,force:true});
 }
},30000);
