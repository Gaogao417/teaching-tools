import express from 'express';
import {createHash} from 'node:crypto';
import {afterAll,expect,it} from 'vitest';
import type {Server} from 'node:http';
import {createReviewMediaAudit} from '../../../../scripts/lib/ReviewMediaAudit';
const servers:Server[]=[];
afterAll(async()=>{for(const server of servers){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}});
async function server(sink:(record:any)=>void,onError=()=>{}){
 const app=express();app.use(createReviewMediaAudit(sink,onError));app.use(express.json());
 app.post('/api/vnext/tutor-sessions/:id/asr',(req,res)=>res.status(200).json({session_id:req.params.id,observed_revision:17,execution_owner:req.body.execution_owner,transcript:'这是测试转写。',model:'test-model',headers:{secret:'not-audit'}}));
 app.post('/api/vnext/tutor-sessions/:id/student-inputs',(_req,res)=>res.status(200).json({revision:18,headers:{secret:'not-audit'}}));
 const listening=await new Promise<Server>((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});servers.push(listening);
 return `http://127.0.0.1:${(listening.address() as {port:number}).port}`;
}
it('records only real wire identity, audio metadata/hash and ASR result; later utterance records its own channel',async()=>{
 const records:any[]=[];const base=await server(record=>records.push(record));const bytes=Buffer.from('synthetic test audio, not human evidence');const encoded=bytes.toString('base64');
 const owner={client_instance_id:'page-test',epoch:2};
 const response=await fetch(`${base}/api/vnext/tutor-sessions/TS-test/asr`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer DO_NOT_LOG'},body:JSON.stringify({client_request_id:'asr-req',execution_owner:owner,audio:{data_url:`data:audio/webm;codecs=opus;base64,${encoded}`,mime_type:'audio/webm;codecs=opus',duration_ms:1500},apiKey:'DO_NOT_LOG'})});
 expect(response.status).toBe(200);expect((await response.json()).transcript).toBe('这是测试转写。');
 expect(records[0]).toMatchObject({kind:'asr_exchange',session_id:'TS-test',client_request_id:'asr-req',status:200,request:{execution_owner:owner,audio:{byte_length:bytes.length,sha256:`sha256:${createHash('sha256').update(bytes).digest('hex')}`,mime_type:'audio/webm;codecs=opus',duration_ms:1500},capture_identity:'not_present_in_http_contract',channel:'not_present_in_asr_http_contract'},response:{observed_revision:17,transcript:'这是测试转写。',execution_owner:owner}});
 await fetch(`${base}/api/vnext/tutor-sessions/TS-test/student-inputs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_request_id:'utterance-req',expected_revision:17,execution_owner:owner,input:{kind:'utterance',channel:'assistance',text:'这是测试转写。'}})});
 expect(records[1]).toMatchObject({kind:'utterance_exchange',client_request_id:'utterance-req',request:{expected_revision:17,channel:'assistance',text:'这是测试转写。'},response:{revision:18}});
 expect(JSON.stringify(records)).not.toMatch(new RegExp(`DO_NOT_LOG|${encoded}|apiKey|Authorization|headers`));
});
it('audit sink failure cannot change ASR response behavior',async()=>{
 let errors=0;const base=await server(()=>{throw Error('disk failure');},()=>errors++);
 const response=await fetch(`${base}/api/vnext/tutor-sessions/TS-test/asr`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_request_id:'audit-failure',audio:{data_url:'invalid',mime_type:'audio/webm'}})});
 expect(response.status).toBe(200);expect((await response.json()).transcript).toBe('这是测试转写。');expect(errors).toBe(1);
});
