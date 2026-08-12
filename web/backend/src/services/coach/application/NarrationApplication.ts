import type { SpeechSynthesizer, SynthesizedSpeech } from "../ports/SpeechSynthesizer";
import type { TelemetrySink } from "../ports/TelemetrySink";

/**
 * Deterministic speech use case with a bounded server cache; it has no
 * text-generation dependency.
 *
 * ADR-005 §Observability Contract: the narration server-side timeline
 * (request → provider connected → TTS first audio → terminal) is sunk to the
 * shared provider-neutral {@link TelemetrySink} under the `correlationId` the
 * caller supplies (the browser's narration utterance id). When no id is
 * supplied a server-side id is generated so the narration correlation is still
 * captured. The sink call is best-effort and never throws into the request path.
 */
export class NarrationApplication {
  private readonly cache = new Map<string, SynthesizedSpeech>();
  constructor(
    private readonly speech: SpeechSynthesizer,
    private readonly capacity = 128,
    private readonly sink?: TelemetrySink,
  ) {}

  async synthesize(spokenText: string, signal?: AbortSignal, correlationId?: string): Promise<SynthesizedSpeech> {
    const correlation = correlationId ?? crypto.randomUUID();
    const requestStartedAt = Date.now();
    this.sink?.record({ correlationId: correlation, flow: "narration", requestStartedAt });
    const key = this.key(spokenText);
    const cached = this.cache.get(key);
    if (cached) {
      const now = Date.now();
      this.sink?.record({ correlationId: correlation, flow: "narration", providerConnectedAt: now, ttsFirstAudioAt: now, completedAt: now, terminal: "completed" });
      return cached;
    }
    let result: SynthesizedSpeech;
    try {
      result = await this.speech.synthesize(spokenText, signal);
    } catch (error) {
      this.recordTerminal(signal, correlation);
      throw error;
    }
    const now = Date.now();
    this.sink?.record({ correlationId: correlation, flow: "narration", providerConnectedAt: now, ttsFirstAudioAt: now, completedAt: now, terminal: "completed" });
    this.remember(key, result);
    return result;
  }

  async stream(spokenText: string, signal: AbortSignal | undefined, onAudioChunk: (chunk: Buffer) => void, correlationId?: string): Promise<SynthesizedSpeech> {
    const correlation = correlationId ?? crypto.randomUUID();
    const requestStartedAt = Date.now();
    this.sink?.record({ correlationId: correlation, flow: "narration", requestStartedAt });
    const key = this.key(spokenText);
    const cached = this.cache.get(key);
    if (cached) {
      const match = /^data:[^;]+;base64,(.+)$/.exec(cached.audioUrl);
      if (match) onAudioChunk(Buffer.from(match[1], "base64"));
      const now = Date.now();
      this.sink?.record({ correlationId: correlation, flow: "narration", providerConnectedAt: now, ttsFirstAudioAt: now, completedAt: now, terminal: "completed" });
      return cached;
    }
    let firstChunk = true;
    const wrappingChunk = (chunk: Buffer): void => {
      if (firstChunk) { firstChunk = false; const now = Date.now(); this.sink?.record({ correlationId: correlation, flow: "narration", providerConnectedAt: now, ttsFirstAudioAt: now }); }
      onAudioChunk(chunk);
    };
    let result: SynthesizedSpeech;
    try {
      result = await this.speech.synthesize(spokenText, signal, wrappingChunk);
    } catch (error) {
      this.recordTerminal(signal, correlation);
      throw error;
    }
    const now = Date.now();
    // If the provider never streamed chunks (e.g. returned a data URL), mark the
    // TTS stage now so the narration timeline still resolves.
    if (firstChunk) this.sink?.record({ correlationId: correlation, flow: "narration", providerConnectedAt: now, ttsFirstAudioAt: now });
    this.sink?.record({ correlationId: correlation, flow: "narration", completedAt: now, terminal: "completed" });
    this.remember(key, result);
    return result;
  }

  private recordTerminal(signal: AbortSignal | undefined, correlationId: string): void {
    const now = Date.now();
    if (signal?.aborted) this.sink?.record({ correlationId, flow: "narration", cancelledAt: now, terminal: "cancelled" });
    else this.sink?.record({ correlationId, flow: "narration", failedAt: now, terminal: "failed" });
  }

  private key(text: string): string { return `teacher-zh-v1:${text.trim()}`; }
  private remember(key: string, result: SynthesizedSpeech) {
    this.cache.set(key, result);
    while (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
  }
}
