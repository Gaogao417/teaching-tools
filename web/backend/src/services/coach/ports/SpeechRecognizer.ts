import type { Result } from "./TextCoachEngine";

/**
 * Provider-neutral speech recognition port (ASR). Concrete providers (Qwen
 * ASR, …) implement it in the adapters layer; the application depends only on
 * this contract, so provider/model names stay out of ports, application and
 * transport (ADR-005 §Backend effect ports).
 */
export class SpeechRecognitionError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) {
    super(message);
  }
}

export interface AudioInput {
  /** Browser-recorded audio encoded as a data URL. */
  dataUrl: string;
  durationMs?: number;
}

export interface SpeechRecognizer {
  /** Transcribe student audio into plain text. The adapter validates size and
   *  duration and maps provider failures to a typed error. */
  transcribe(audio: AudioInput): Promise<Result<{ transcript: string }, SpeechRecognitionError>>;
}
