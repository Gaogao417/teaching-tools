/**
 * Provider-neutral, content-addressed storage for completed deterministic
 * narration artifacts. Implementations must never expose partially written
 * audio for a key.
 */
export interface SpeechArtifact {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export interface SpeechArtifactStore {
  /** Return a completed artifact, or undefined when the key is not present. */
  get(key: string, signal?: AbortSignal): Promise<SpeechArtifact | undefined>;

  /** Atomically publish a completed artifact for the content-addressed key. */
  put(key: string, artifact: SpeechArtifact, signal?: AbortSignal): Promise<void>;
}
