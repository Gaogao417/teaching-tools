// AudioWorklet processor: captures mic input at the AudioContext sample rate
// (typically 48 kHz) and downsamples to 16 kHz mono Int16 PCM, the format the
// provider-neutral live Coach contract expects.
// Posts Int16Array buffers (transferable) to the main thread in ~20 ms chunks.
//
// This file is plain JS (AudioWorkletGlobalScope has no module/TS), served
// verbatim from /realtime-capture-worklet.js by Vite (lives in /public).

class PCM16CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ratio = sampleRate / 16000;
    this._sourcePosition = 0;
    this._source = [];
    this._acc = [];
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i += 1) this._source.push(channel[i]);
    while (this._sourcePosition + 1 < this._source.length) {
      const left = Math.floor(this._sourcePosition);
      const fraction = this._sourcePosition - left;
      let s = this._source[left] + (this._source[left + 1] - this._source[left]) * fraction;
      if (s < -1) s = -1;
      else if (s > 1) s = 1;
      this._acc.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      this._sourcePosition += this._ratio;
    }
    const consumed = Math.floor(this._sourcePosition);
    if (consumed > 0) {
      this._source.splice(0, consumed);
      this._sourcePosition -= consumed;
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
