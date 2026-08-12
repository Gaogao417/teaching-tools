// AudioWorklet processor: captures mic input at the AudioContext sample rate
// (typically 48 kHz) and downsamples to 16 kHz mono Int16 PCM, the format the
// DashScope qwen-omni-realtime `input_audio_buffer.append` event expects.
// Posts Int16Array buffers (transferable) to the main thread in ~20 ms chunks.
//
// This file is plain JS (AudioWorkletGlobalScope has no module/TS), served
// verbatim from /realtime-capture-worklet.js by Vite (lives in /public).

class PCM16CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ratio = Math.max(1, Math.round(sampleRate / 16000));
    this._acc = [];
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    const ratio = this._ratio;
    for (let i = 0; i < channel.length; i += ratio) {
      let s = channel[i];
      if (s < -1) s = -1;
      else if (s > 1) s = 1;
      this._acc.push(s < 0 ? s * 0x8000 : s * 0x7fff);
    }
    // ~20 ms at 16 kHz = 320 samples; flush once we have at least that many.
    if (this._acc.length >= 320) {
      const out = new Int16Array(this._acc.length);
      for (let k = 0; k < out.length; k++) out[k] = this._acc[k];
      this._acc.length = 0;
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm16-capture", PCM16CaptureProcessor);
