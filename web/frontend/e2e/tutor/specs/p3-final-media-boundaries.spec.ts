/** DESIGN before implementation: FM2-8 idle each entry + foreign ASR session_id
 * => actual client decoder error, zero utterance/revision change, explicit sync.
 * FM2-9 idle each entry +413/415 => exact visible error, text usable, new capture
 * recovers with one locked-channel utterance. FM3-7 active voice +403/409/200
 * conflict => zero mic/ASR/control. Natural ended ack pending + wrong-task committed
 * response => zero mic while waiting AND after real synchronous adopt=false.
 * Duplicate stop callback tests adjacent consume-once; fetch cannot resolve twice.
 * Real browser/native recorder/local backend, fake-device, injected ASR, fixture
 * Audio, scripted Gate. No claim of human mic, real ASR/TTS or real model evidence.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {expect,test,type Page,type TestInfo} from '@playwright/test';
const audio=readFileSync(new URL('../assets/silent-1.5s.mp3',import.meta.url));
const task='/learn/goldenMinhangFold2020';
const backend=`http://127.0.0.1:${process.env.TUTOR_E2E_BACKEND_PORT||3184}`;
type Channel='mainline'|'assistance';
type Call={path:string;method:string;body?:Record<string,any>};
test.use({launchOptions:{args:['--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']}});
test.setTimeout(120_000);
async function prepare(page:Page,slow=false,duplicate=false){
 const calls:Call[]=[];
 await page.addInitScript(({slow,duplicate})=>{
  localStorage.setItem('trig-web-student-name','final-media-boundary');
  const state={micStarts:0,duplicateStops:0};(window as any).__mediaBoundary=state;
  const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=constraints=>{state.micStarts++;return get(constraints);};
  if(slow){const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){this.playbackRate=.1;return play.call(this);};}
  if(duplicate){const Native=window.MediaRecorder;window.MediaRecorder=class extends Native{constructor(stream:MediaStream,options?:MediaRecorderOptions){super(stream,options);this.addEventListener('stop',event=>{const callback=this.onstop;setTimeout(()=>{state.duplicateStops++;callback?.call(this,event);},150);});}};}
 },{slow,duplicate});
 await page.route(/\/api\/action-speech(-stream)?$/,route=>route.fulfill(route.request().url().endsWith('-stream')?{status:200,contentType:'audio/mpeg',body:audio}:{status:200,contentType:'application/json',body:JSON.stringify({audioUrl:`data:audio/mpeg;base64,${audio.toString('base64')}`})}));
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(!path.includes('/api/'))return;let body:Record<string,any>|undefined;try{body=request.postDataJSON()??undefined;if(body?.audio)body={...body,audio:{mime_type:body.audio.mime_type,data_url:'[omitted native audio]'}};}catch{}calls.push({path,method:request.method(),body});});
 return calls;
}
const utterances=(calls:Call[])=>calls.filter(c=>c.path.endsWith('/student-inputs')&&c.body?.input?.kind==='utterance');
const controls=(calls:Call[])=>calls.filter(c=>c.path.endsWith('/student-inputs')&&c.body?.input?.kind==='control');
const asrs=(calls:Call[])=>calls.filter(c=>c.path.endsWith('/asr'));
async function snapshot(page:Page){const sid=new URL(page.url()).searchParams.get('session');expect(sid).toMatch(/^TS-/);const r=await page.request.get(`${backend}/api/vnext/tutor-sessions/${sid}`);expect(r.ok()).toBe(true);return await r.json();}
async function ready(page:Page,channel:Channel){await page.goto(task);await expect(page.getByTestId('tutor-confirm-input')).toBeEnabled({timeout:60_000});if(channel==='mainline'){await page.getByTestId('tutor-confirm-input').click();await expect(page.getByTestId('tutor-answer-mic')).toBeEnabled({timeout:60_000});}await expect(page.locator('[data-testid="tutor-presentation"][data-presentation-phase="presenting"]')).toHaveCount(0);}
const mic=(page:Page,channel:Channel)=>channel==='mainline'?page.getByTestId('tutor-answer-mic'):page.getByRole('button',{name:'语音提问',exact:true});
const textInput=(page:Page,channel:Channel)=>channel==='mainline'?page.getByRole('textbox',{name:'回答输入',exact:true}):page.getByPlaceholder('文字或语音问老师');
async function record(page:Page,channel:Channel){await mic(page,channel).click();const stop=page.getByRole('button',{name:channel==='mainline'?'结束录音回答':'结束录音',exact:true});await expect(stop).toBeVisible();await page.waitForTimeout(350);await stop.click();}
async function evidence(page:Page,info:TestInfo,calls:Call[],extra:Record<string,unknown>={}){expect(calls.filter(c=>/^\/api\/tutor-sessions/.test(c.path))).toEqual([]);const value={title:info.title,realBrowser:true,realLocalBackend:true,mic:'fake-device',asr:'HTTP injected',tts:'fixture/native Audio',calls,...extra,media:await page.evaluate(()=>(window as any).__mediaBoundary)};const file=info.outputPath('boundary.json');writeFileSync(file,JSON.stringify(value,null,2));await info.attach('boundary',{path:file,contentType:'application/json'});await page.screenshot({path:info.outputPath('boundary.png')});}
for(const channel of ['mainline','assistance'] as const){
 test(`FM2-8 ${channel}: foreign ASR session_id rejected without input fact`,async({page},info)=>{
  const calls=await prepare(page);await ready(page,channel);const before=await snapshot(page);
  await page.route(/\/api\/vnext\/tutor-sessions\/[^/]+\/asr$/,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({session_id:'TS-999999999999',observed_revision:before.revision,transcript:'这不是当前会话的语音',model:'injected-asr'})}));
  const count=utterances(calls).length;await record(page,channel);await expect(page.getByTestId('tutor-protocol-error')).toContainText('asr 响应 session_id 与请求不一致');expect(utterances(calls)).toHaveLength(count);expect((await snapshot(page)).revision).toBe(before.revision);
  await page.getByTestId('tutor-protocol-retry').click();await expect(page.getByTestId('tutor-protocol-error')).toBeHidden();await expect(textInput(page,channel)).toBeEditable();await evidence(page,info,calls,{beforeRevision:before.revision,afterRevision:(await snapshot(page)).revision});
 });
 for(const status of [413,415] as const)test(`FM2-9 ${channel}: ASR ${status} visible and new capture recovers`,async({page},info)=>{
  const calls=await prepare(page);await ready(page,channel);const before=await snapshot(page);let failing=true;
  await page.route(/\/api\/vnext\/tutor-sessions\/[^/]+\/asr$/,async route=>{if(failing){await route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:{code:status===413?'AUDIO_TOO_LARGE':'AUDIO_FORMAT_UNSUPPORTED',message:'injected audio validation'}})});return;}const current=await snapshot(page);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({session_id:current.session_id,observed_revision:current.revision,transcript:'这一步为什么成立？',model:'injected-asr'})});});
  const count=utterances(calls).length;await record(page,channel);await expect(page.getByTestId('tutor-speech-notice')).toContainText(status===413?'缩短':'格式不支持');expect(utterances(calls)).toHaveLength(count);expect((await snapshot(page)).revision).toBe(before.revision);await expect(textInput(page,channel)).toBeEditable();
  failing=false;await record(page,channel);await expect.poll(()=>utterances(calls).length).toBe(count+1);expect(utterances(calls).at(-1)?.body?.input).toMatchObject({channel,text:'这一步为什么成立？'});expect(asrs(calls)).toHaveLength(2);await evidence(page,info,calls,{errorStatus:status,recovery:'new capture; one raw utterance'});
 });
}
test('FM2-8 adjacent consume-once: duplicate native stop callback is not a second HTTP response',async({page},info)=>{
 const calls=await prepare(page,false,true);await ready(page,'assistance');await page.route(/\/api\/vnext\/tutor-sessions\/[^/]+\/asr$/,async route=>{const current=await snapshot(page);await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({session_id:current.session_id,observed_revision:current.revision,transcript:'这个比例为什么成立？',model:'injected-asr'})});});
 await record(page,'assistance');await expect.poll(()=>utterances(calls).length).toBe(1);await expect.poll(()=>page.evaluate(()=>(window as any).__mediaBoundary.duplicateStops)).toBe(1);await page.waitForTimeout(500);expect(asrs(calls)).toHaveLength(1);expect(utterances(calls)).toHaveLength(1);await evidence(page,info,calls,{limitation:'duplicates native stop callback; standard fetch response settles once'});
});
for(const failure of ['403','409','200-conflict','pending-adopt-rejected'] as const)test(`FM3-7 ${failure}: rejected outcome or adoption never starts recording`,async({page},info)=>{
 const calls=await prepare(page,failure!=='pending-adopt-rejected');let intercepted=0;let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
 await page.route(/\/api\/vnext\/tutor-sessions\/[^/]+\/presentation-actions\/[^/]+\/outcomes$/,async route=>{
  intercepted++;if(failure==='403'||failure==='409'){await route.fulfill({status:Number(failure),contentType:'application/json',body:JSON.stringify({error:{code:failure==='403'?'FORBIDDEN':'REVISION_CONFLICT',message:'injected outcome rejected'}})});return;}
  if(failure==='200-conflict'){const current=await snapshot(page);current.turn={status:'revision-conflict',failure:{category:'presentation',failure_class:'STALE_REVISION',retryable:true}};await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(current)});return;}
  await wait;const response=await route.fetch();const body=await response.json();body.task_id='otherCanonicalTask';await route.fulfill({response,json:body});
 });
 await page.goto(task);await expect(page.locator('[data-testid="tutor-presentation"][data-presentation-phase="presenting"]')).toBeVisible({timeout:60_000});if(failure==='pending-adopt-rejected')await expect.poll(()=>intercepted).toBe(1);await mic(page,'assistance').click();
 if(failure==='pending-adopt-rejected'){await page.waitForTimeout(300);expect(await page.evaluate(()=>(window as any).__mediaBoundary.micStarts)).toBe(0);expect(controls(calls)).toHaveLength(0);release();await expect(page.getByTestId('tutor-protocol-error')).toContainText('otherCanonicalTask');}else await expect(page.getByTestId('tutor-turn-failure')).toBeVisible();
 await page.waitForTimeout(400);expect(intercepted).toBe(1);expect(await page.evaluate(()=>(window as any).__mediaBoundary.micStarts)).toBe(0);expect(controls(calls)).toHaveLength(0);expect(asrs(calls)).toHaveLength(0);expect(utterances(calls)).toHaveLength(0);await expect(page.getByRole('button',{name:'结束录音',exact:true})).toHaveCount(0);await evidence(page,info,calls,{fault:failure,adoptInterface:'synchronous boolean',outcomeCommittedAtServer:failure==='pending-adopt-rejected'});
});
