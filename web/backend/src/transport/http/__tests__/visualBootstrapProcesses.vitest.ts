import { fork } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
const script=resolve('src/transport/http/__tests__/support/visualBootstrapProcess.ts');
type Message={ready?:boolean;pid?:number;payload?:unknown;events?:Array<{event_type:string;payload_json:string}>;state?:any;parity?:{equal:boolean};errors?:Array<{code?:string;message:string;state?:any;events?:any[]}>};
function child(db:string,args:string[]) {
 const process=fork(script,args,{execArgv:['--import','tsx'],env:{...globalThis.process.env,SQLITE_PATH:db,TUTOR_TELEMETRY:'off'},stdio:['ignore','pipe','pipe','ipc']});
 const messages:Message[]=[];let stderr='';process.stderr?.on('data',data=>stderr+=data);
 let readyResolve:()=>void;const ready=new Promise<void>(resolve=>readyResolve=resolve);
 process.on('message',(message:Message)=>{messages.push(message);if(message.ready)readyResolve();});
 const done=new Promise<{code:number|null;messages:Message[]}>((resolve,reject)=>{
  const timer=setTimeout(()=>{process.kill('SIGKILL');reject(new Error('child timeout '+stderr));},15000);
  process.on('error',error=>{clearTimeout(timer);reject(error);});
  process.on('exit',code=>{clearTimeout(timer);if(code!==0&&code!==73)reject(new Error(`child exit ${code}: ${stderr}`));else resolve({code,messages});});
 });
 return {process,ready,done};
}
it.each(['started','decision'])('H21/H35 independent process restart at %s boundary, two real workers reserve once',async(boundary)=>{
 const dir=mkdtempSync(join(tmpdir(),'g2-bootstrap-process-'));
 const children:ReturnType<typeof child>[]=[];
 const run=(db:string,args:string[])=>{const c=child(db,args);children.push(c);return c;};
 try {
  const seed=await run(join(dir,'seed.sqlite'),['seed']).done;
  const payload=seed.messages.find(m=>m.payload)?.payload;expect(payload).toBeDefined();
  const payloadPath=join(dir,'started.json');writeFileSync(payloadPath,JSON.stringify(payload));
  const database=join(dir,'target.sqlite'),id='TS-920009991',release=join(dir,'release');
  const crashed=await run(database,['boundary',id,payloadPath,boundary]).done;expect(crashed.code).toBe(73);
  const workers=[run(database,['race',id,'',release]),run(database,['race',id,'',release])];
  await Promise.race([Promise.all(workers.map(w=>w.ready)),Promise.all(workers.map(w=>w.done)).then(()=>{throw new Error('workers exited before barrier');})]);
  expect(workers[0].process.pid).not.toBe(workers[1].process.pid);writeFileSync(release,'go');
  const results=await Promise.all(workers.map(w=>w.done));
  for(const result of results)for(const error of result.messages.flatMap(m=>m.errors??[])){
    if(error.code==='SLOT_BUSY'){
      const state=error.state;expect(state.generation_slot.status).toBe('pending');
      const requests=state.generation_requests;expect(requests).toHaveLength(1);const pending=requests[0];
      expect(state.generation_slot.request_id).toBe(pending.request_id);expect(pending.status).toBe('pending');
      const rows=error.events!;const decisions=rows.filter(e=>e.event_type==='policy_decision_made');expect(decisions).toHaveLength(1);
      expect(pending.decision_id).toBe(JSON.parse(decisions[0].payload_json).decision_id);
      expect(pending.presenter_pin).toEqual(state.pinned_plan.presenter_generation_pin);
      expect(pending.source_request_id).toBe(`gen:${id}:${pending.decision_id}:r${pending.reservation_revision}`);
      expect(rows.filter(e=>e.event_type==='presentation_generation_requested')).toHaveLength(1);
    }else expect(error.code,error.message).toMatch(/^(REVISION_CONFLICT|CAS_CONFLICT|CONCURRENT_MODIFICATION|SQLITE_BUSY|SQLITE_BUSY_SNAPSHOT|GENERATION_REQUEST_DUPLICATE)$/);
  }
  expect(results.some(result=>result.messages.some(m=>m.events?.filter(e=>e.event_type==='presentation_generation_requested').length===1))).toBe(true);
  // A third process proves persisted recovery and replay, not surviving memory.
  const restarted=await run(database,['scan',id]).done;
  const report=restarted.messages.find(m=>m.events)!;expect(report.errors).toEqual([]);expect(report.parity?.equal).toBe(true);
  if(process.env.VISUAL_BOOTSTRAP_EVIDENCE)writeFileSync(`${process.env.VISUAL_BOOTSTRAP_EVIDENCE}-${boundary}.json`,JSON.stringify({boundary,results,report},null,2));
  const events=report.events!;
  const decisions=events.filter(e=>e.event_type==='policy_decision_made');expect(decisions).toHaveLength(1);
  expect(JSON.parse(decisions[0].payload_json)).toMatchObject({decision_kind:'execute_beat',transition_basis:{basis:'legal_transition'}});
  const reservations=events.filter(e=>e.event_type==='presentation_generation_requested');expect(reservations).toHaveLength(1);
  expect(JSON.parse(reservations[0].payload_json).decision_id).toBe(JSON.parse(decisions[0].payload_json).decision_id);
  expect(events.filter(e=>e.event_type==='presentation_sequence_planned')).toHaveLength(1);
  expect(events.some(e=>e.event_type==='presentation_action_delivered')).toBe(true);
  expect(events.filter(e=>e.event_type==='presentation_generation_attempt_started')).toHaveLength(1);
  const reservation=JSON.parse(reservations[0].payload_json),planned=JSON.parse(events.find(e=>e.event_type==='presentation_sequence_planned')!.payload_json);
  expect(planned.generation.request_id).toBe(reservation.request_id);
  expect(report.state.generation_slot.status).toBe('idle');expect(report.state.generation_requests).toHaveLength(1);
  expect(report.state.generation_requests[0]).toMatchObject({request_id:reservation.request_id,status:'committed',sequence_id:planned.sequence_id,presenter_pin:reservation.presenter_pin});
 } finally {
  await Promise.all(children.map(async c=>{if(c.process.exitCode===null)c.process.kill('SIGKILL');await c.done.catch(()=>undefined);}));
  rmSync(dir,{recursive:true,force:true});expect(existsSync(dir)).toBe(false);
 }
},30000);
