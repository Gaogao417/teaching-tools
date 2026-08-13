import type { EventStream, Result } from "./TextCoachEngine";
import type { SpokenSegment } from "../../../../../shared/coachMedia";

export interface SynthesizedSpeech {
  audioUrl: string;
}

/** Every output-affecting setting that participates in deterministic cache identity. */
export interface SpeechSynthesisIdentity {
  profileVersion: string;
  provider: string;
  model: string;
  voice: string;
  format: string;
  sampleRate: number;
}

export type SpeechEvent =
  | { type: "speech-started"; segmentId: string; mimeType: string }
  | { type: "audio-delta"; segmentId: string; bytes: Buffer }
  | { type: "speech-completed"; segmentId: string };

export class SpeechError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) {
    super(message);
  }
}

export interface SpeechSynthesizer {
  /**
   * Stable output identity for deterministic narration caching. Optional for
   * test doubles and non-cacheable implementations; omitted fields are mapped
   * to conservative, versioned defaults rather than sharing provider output.
   */
  readonly cacheIdentity?: SpeechSynthesisIdentity;

  /** Whole-utterance synthesis used by deterministic narration. Optional audio
   *  chunks are surfaced through the callback so a caller can forward them, but
   *  the returned promise only resolves once the provider task is finished. */
  synthesize(text: string, signal?: AbortSignal, onAudioChunk?: (chunk: Buffer) => void): Promise<SynthesizedSpeech>;

  /** Incremental synthesis for one policy-approved spoken segment. Emits real
   *  `audio-delta` events as the provider streams audio chunks — never waits for
   *  the whole task before surfacing the first byte. `signal` closes the
   *  provider connection and stops further events. */
  stream(segment: SpokenSegment, signal: AbortSignal): Promise<Result<EventStream<SpeechEvent>, SpeechError>>;
}
