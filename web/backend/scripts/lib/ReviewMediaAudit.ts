/** Local review evidence only. Does not parse requests, change responses, or save audio. */
import {createHash} from 'node:crypto';
import type {RequestHandler} from 'express';
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const string=(value:unknown)=>typeof value==='string'?value:undefined;
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:undefined;
const owner=(value:unknown)=>{const source=object(value);return typeof source.client_instance_id==='string'&&Number.isSafeInteger(source.epoch)?{client_instance_id:source.client_instance_id,epoch:source.epoch}:undefined;};
function audioMetadata(value:unknown){
 const source=object(value),data=string(source.data_url),match=data?.match(/^data:([^,]*);base64,([A-Za-z0-9+/=\r\n]*)$/);
 const bytes=match?Buffer.from(match[2],'base64'):undefined;
 return {mime_type:string(source.mime_type),duration_ms:number(source.duration_ms),data_url_char_length:data?.length,
   ...(bytes?{byte_length:bytes.length,sha256:`sha256:${createHash('sha256').update(bytes).digest('hex')}`}:{audio_encoding:'unrecognized'})};
}
export function createReviewMediaAudit(write:(record:unknown)=>void,onWriteError:()=>void=()=>{}):RequestHandler {
 return (req,res,next)=>{
  const match=req.path.match(/^\/api\/vnext\/tutor-sessions\/([^/]+)\/(asr|student-inputs)$/);
  if(req.method!=='POST'||!match)return next();
  const began=Date.now();let response:unknown;
  const original=res.json;
  res.json=function(body:unknown){response=body;return original.call(this,body);};
  res.once('finish',()=>{
   const body=object(req.body),reply=object(response),error=object(reply.error),input=object(body.input);
   if(match[2]==='student-inputs'&&input.kind!=='utterance')return;
   const asr=match[2]==='asr';
   const record={kind:asr?'asr_exchange':'utterance_exchange',started_at:new Date(began).toISOString(),elapsed_ms:Date.now()-began,
    session_id:match[1],client_request_id:string(body.client_request_id),status:res.statusCode,
    request:{execution_owner:owner(body.execution_owner),expected_revision:number(body.expected_revision),
      ...(asr?{audio:audioMetadata(body.audio),capture_identity:'not_present_in_http_contract',channel:'not_present_in_asr_http_contract'}
        :{channel:input.channel==='mainline'||input.channel==='assistance'?input.channel:undefined,text:string(input.text)})},
    response:asr?{session_id:string(reply.session_id),observed_revision:number(reply.observed_revision),execution_owner:owner(reply.execution_owner),transcript:string(reply.transcript),model:string(reply.model),error_code:string(error.code)}
      :{revision:number(reply.revision),error_code:string(error.code)}};
   try{write(record);}catch{onWriteError();}
  });
  next();
 };
}
