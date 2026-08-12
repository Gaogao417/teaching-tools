import type { SpeechSynthesizer, SynthesizedSpeech } from "../ports/SpeechSynthesizer";

/** Deterministic speech use case with a bounded server cache; it has no text-generation dependency. */
export class NarrationApplication {
  private readonly cache = new Map<string, SynthesizedSpeech>();
  constructor(private readonly speech: SpeechSynthesizer, private readonly capacity = 128) {}

  async synthesize(spokenText: string, signal?: AbortSignal): Promise<SynthesizedSpeech> {
    const key = this.key(spokenText);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = await this.speech.synthesize(spokenText, signal);
    this.remember(key, result);
    return result;
  }

  async stream(spokenText: string, signal: AbortSignal | undefined, onAudioChunk: (chunk: Buffer) => void): Promise<SynthesizedSpeech> {
    const key = this.key(spokenText);
    const cached = this.cache.get(key);
    if (cached) {
      const match = /^data:[^;]+;base64,(.+)$/.exec(cached.audioUrl);
      if (match) onAudioChunk(Buffer.from(match[1], "base64"));
      return cached;
    }
    const result = await this.speech.synthesize(spokenText, signal, onAudioChunk);
    this.remember(key, result);
    return result;
  }

  private key(text: string): string { return `teacher-zh-v1:${text.trim()}`; }
  private remember(key: string, result: SynthesizedSpeech) {
    this.cache.set(key, result);
    while (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
  }
}
