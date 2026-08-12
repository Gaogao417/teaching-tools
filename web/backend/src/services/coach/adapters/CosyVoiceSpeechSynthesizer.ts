import { synthesizeCosyVoice } from "../cosyVoiceService";
import type { SpeechSynthesizer } from "../ports/SpeechSynthesizer";

export class CosyVoiceSpeechSynthesizer implements SpeechSynthesizer {
  synthesize(text: string, signal?: AbortSignal, onAudioChunk?: (chunk: Buffer) => void) {
    return synthesizeCosyVoice(text, signal, onAudioChunk);
  }
}
