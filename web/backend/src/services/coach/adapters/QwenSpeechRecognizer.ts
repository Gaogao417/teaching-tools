import { transcribeStudentAudio } from "../qwenSpeechService";
import type { Result } from "../ports/TextCoachEngine";
import type { AudioInput, SpeechRecognizer } from "../ports/SpeechRecognizer";
import { SpeechRecognitionError } from "../ports/SpeechRecognizer";

/**
 * Qwen (DashScope) ASR adapter for the provider-neutral {@link SpeechRecognizer}
 * port. This is the only place that knows the upstream ASR model and endpoint;
 * the application calls the port and is unaware of the provider.
 */
export class QwenSpeechRecognizer implements SpeechRecognizer {
  async transcribe(audio: AudioInput): Promise<Result<{ transcript: string }, SpeechRecognitionError>> {
    try {
      const result = await transcribeStudentAudio(audio);
      return { ok: true, value: { transcript: result.transcript } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "ASR failed";
      return { ok: false, error: new SpeechRecognitionError("ASR_FAILED", message, true) };
    }
  }
}
