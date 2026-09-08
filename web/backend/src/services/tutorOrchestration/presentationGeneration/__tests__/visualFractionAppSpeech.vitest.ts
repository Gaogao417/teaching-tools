import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createApp } from '../../../../app';
import { narrationApplication } from '../../../coach/composition';

// Exercise the actual registered app handlers without listening or contacting TTS.
// Only the external narration boundary is intercepted; normalization is production.
afterEach(()=>vi.restoreAllMocks());
it.each(['/api/action-speech','/api/action-speech-stream'])('%s normalizes approved fractions before the TTS boundary',async path=>{
 const sentinel=new Error('offline TTS boundary reached');
 const synth=vi.spyOn(narrationApplication,'synthesize').mockRejectedValue(sentinel);
 const stream=vi.spyOn(narrationApplication,'stream').mockRejectedValue(sentinel);
 const app=createApp();
 const router=(app as unknown as {_router:{stack:Array<{route?:{path:string;stack:Array<{handle:Function}>}}>}})._router;
 const handle=router.stack.find(layer=>layer.route?.path===path)!.route!.stack[0].handle;
 for(const [text,spoken] of [
  [String.raw`DO=$\frac{32}{15}$。`,'DO 等于 15 分之 32 。'],
  [String.raw`$\frac{10}{3} - \frac{32}{15} = \frac{6}{5}$`,'3 分之 10 减 15 分之 32 等于 5 分之 6'],
 ]){
  const res=Object.assign(new EventEmitter(),{writableEnded:false,destroyed:false,headersSent:false,status:vi.fn(),setHeader:vi.fn(),flushHeaders:vi.fn()});
  const next=vi.fn();
  await handle({body:{text}},res,next);
  expect(next).toHaveBeenLastCalledWith(sentinel);
  const call=(path.endsWith('-stream')?stream:synth).mock.calls.at(-1)!;
  expect(call[0]).toBe(spoken);
 }
 expect(path.endsWith('-stream')?synth:stream).not.toHaveBeenCalled();
});
