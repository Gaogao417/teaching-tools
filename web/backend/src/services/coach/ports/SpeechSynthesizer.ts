export interface SynthesizedSpeech {
  audioUrl: string;
}
export interface SpeechSynthesizer {
  synthesize(text: string, signal?: AbortSignal, onAudioChunk?: (chunk: Buffer) => void): Promise<SynthesizedSpeech>;
}
