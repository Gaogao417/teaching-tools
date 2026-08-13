import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { SPEECH_TEXT_VERSION } from "../../../../../shared/speechText";
import type {
  SpeechSynthesizer,
  SpeechSynthesisIdentity,
  SynthesizedSpeech,
} from "../ports/SpeechSynthesizer";
import type { SpeechArtifact, SpeechArtifactStore } from "../ports/SpeechArtifactStore";
import type { TelemetrySink } from "../ports/TelemetrySink";

const DEFAULT_IDENTITY: SpeechSynthesisIdentity = {
  profileVersion: "unprofiled",
  provider: "unspecified-provider",
  model: "unspecified-model",
  voice: "unspecified-voice",
  format: "mp3",
  sampleRate: 22_050,
};

function normalizeSpokenText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** A SHA-256 content identity covering all known output-affecting settings. */
export function createSpeechArtifactKey(text: string, identity: SpeechSynthesisIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify({
      profileVersion: identity.profileVersion,
      speechTextVersion: SPEECH_TEXT_VERSION,
      provider: identity.provider,
      model: identity.model,
      voice: identity.voice,
      format: identity.format,
      sampleRate: identity.sampleRate,
      normalizedText: normalizeSpokenText(text),
    }))
    .digest("hex");
}

function decodeSynthesizedSpeech(result: SynthesizedSpeech): SpeechArtifact {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=]+)$/i.exec(result.audioUrl);
  if (!match) throw new Error("Speech synthesizer returned a non-base64 audio URL");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) throw new Error("Speech synthesizer returned empty audio");
  return { bytes, contentType: match[1] };
}

function toSynthesizedSpeech(artifact: SpeechArtifact): SynthesizedSpeech {
  return { audioUrl: `data:${artifact.contentType};base64,${artifact.bytes.toString("base64")}` };
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Operation aborted", "AbortError");
}

async function waitForFlight<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw abortError(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

/**
 * Deterministic narration with an in-process L1, an optional persistent L2,
 * and same-key single-flight synthesis. Completed artifacts are retained as
 * raw MP3 buffers; data URLs exist only at the legacy REST contract boundary.
 */
export class NarrationApplication {
  private readonly cache = new Map<string, SpeechArtifact>();
  private readonly flights = new Map<string, Promise<SpeechArtifact>>();
  private readonly cacheIdentity: SpeechSynthesisIdentity;

  constructor(
    private readonly speech: SpeechSynthesizer,
    private readonly capacity = 128,
    private readonly sink?: TelemetrySink,
    private readonly artifacts?: SpeechArtifactStore,
  ) {
    // An unprofiled test double remains cacheable within this application, but
    // its random process-local version can never collide in persistent storage
    // with a different implementation after restart.
    this.cacheIdentity = speech.cacheIdentity ?? {
      ...DEFAULT_IDENTITY,
      profileVersion: `${DEFAULT_IDENTITY.profileVersion}-${randomUUID()}`,
    };
  }

  async synthesize(spokenText: string, signal?: AbortSignal, correlationId?: string): Promise<SynthesizedSpeech> {
    return toSynthesizedSpeech(await this.resolve(spokenText, signal, correlationId));
  }

  async stream(
    spokenText: string,
    signal: AbortSignal | undefined,
    onAudioChunk: (chunk: Buffer) => void,
    correlationId?: string,
  ): Promise<SynthesizedSpeech> {
    const artifact = await this.resolve(spokenText, signal, correlationId, onAudioChunk);
    return toSynthesizedSpeech(artifact);
  }

  private async resolve(
    spokenText: string,
    signal?: AbortSignal,
    correlationId?: string,
    onAudioChunk?: (chunk: Buffer) => void,
  ): Promise<SpeechArtifact> {
    const correlation = correlationId ?? randomUUID();
    this.sink?.record({ correlationId: correlation, flow: "narration", requestStartedAt: Date.now() });
    const normalizedText = normalizeSpokenText(spokenText);
    const key = createSpeechArtifactKey(normalizedText, this.cacheIdentity);

    const memoryStartedAt = performance.now();
    const memoryArtifact = this.cache.get(key);
    const memoryCacheLookupMs = elapsedMs(memoryStartedAt);
    if (memoryArtifact) {
      onAudioChunk?.(memoryArtifact.bytes);
      this.recordCompleted(correlation, memoryArtifact, {
        narrationArtifactSource: "memory",
        memoryCacheLookupMs,
      });
      return memoryArtifact;
    }

    let persistentCacheLookupMs = 0;
    if (this.artifacts) {
      const persistentStartedAt = performance.now();
      let persistentArtifact: SpeechArtifact | undefined;
      try {
        persistentArtifact = await this.artifacts.get(key, signal);
      } catch (error) {
        if (signal?.aborted) {
          this.recordTerminal(signal, correlation);
          throw error;
        }
        // Cache availability must never make narration unavailable.
      }
      persistentCacheLookupMs = elapsedMs(persistentStartedAt);
      if (persistentArtifact) {
        this.remember(key, persistentArtifact);
        onAudioChunk?.(persistentArtifact.bytes);
        this.recordCompleted(correlation, persistentArtifact, {
          narrationArtifactSource: "persistent",
          memoryCacheLookupMs,
          persistentCacheLookupMs,
        });
        return persistentArtifact;
      }
    }

    const activeFlight = this.flights.get(key);
    if (activeFlight) {
      const waitStartedAt = performance.now();
      try {
        const artifact = await waitForFlight(activeFlight, signal);
        onAudioChunk?.(artifact.bytes);
        this.recordCompleted(correlation, artifact, {
          narrationArtifactSource: "provider",
          memoryCacheLookupMs,
          persistentCacheLookupMs,
          singleFlightWaitMs: elapsedMs(waitStartedAt),
        });
        return artifact;
      } catch (error) {
        this.recordTerminal(signal, correlation);
        throw error;
      }
    }

    let flight!: Promise<SpeechArtifact>;
    flight = this.synthesizeAndStore(key, normalizedText, signal, correlation, onAudioChunk)
      .finally(() => {
        if (this.flights.get(key) === flight) this.flights.delete(key);
      });
    this.flights.set(key, flight);

    try {
      const artifact = await flight;
      this.recordCompleted(correlation, artifact, {
        narrationArtifactSource: "provider",
        memoryCacheLookupMs,
        persistentCacheLookupMs,
      });
      return artifact;
    } catch (error) {
      this.recordTerminal(signal, correlation);
      throw error;
    }
  }

  private async synthesizeAndStore(
    key: string,
    normalizedText: string,
    signal: AbortSignal | undefined,
    correlationId: string,
    onAudioChunk?: (chunk: Buffer) => void,
  ): Promise<SpeechArtifact> {
    const providerStartedAt = performance.now();
    let firstChunk = true;
    const result = await this.speech.synthesize(normalizedText, signal, (chunk) => {
      if (firstChunk) {
        firstChunk = false;
        const now = Date.now();
        this.sink?.record({
          correlationId,
          flow: "narration",
          providerConnectedAt: now,
          ttsFirstAudioAt: now,
        });
      }
      onAudioChunk?.(chunk);
    });
    const providerSynthesisMs = elapsedMs(providerStartedAt);
    const artifact = decodeSynthesizedSpeech(result);

    // Some compatible synthesizers only return the completed data URL. Keep
    // the streaming HTTP contract working and mark its real provider byte here.
    if (firstChunk) {
      const now = Date.now();
      this.sink?.record({
        correlationId,
        flow: "narration",
        providerConnectedAt: now,
        ttsFirstAudioAt: now,
      });
      onAudioChunk?.(artifact.bytes);
    }

    this.sink?.record({ correlationId, flow: "narration", providerSynthesisMs });
    if (signal?.aborted) throw abortError(signal);

    if (this.artifacts) {
      try {
        await this.artifacts.put(key, artifact, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        // A failed L2 write degrades to the L1 cache and provider result.
      }
    }
    if (signal?.aborted) throw abortError(signal);
    this.remember(key, artifact);
    return artifact;
  }

  private recordCompleted(
    correlationId: string,
    artifact: SpeechArtifact,
    cache: Pick<
      NonNullable<Parameters<TelemetrySink["record"]>[0]>,
      "narrationArtifactSource" | "memoryCacheLookupMs" | "persistentCacheLookupMs" | "singleFlightWaitMs"
    >,
  ): void {
    this.sink?.record({
      correlationId,
      flow: "narration",
      ...cache,
      artifactBytes: artifact.bytes.length,
      completedAt: Date.now(),
      terminal: "completed",
    });
  }

  private recordTerminal(signal: AbortSignal | undefined, correlationId: string): void {
    const now = Date.now();
    if (signal?.aborted) this.sink?.record({ correlationId, flow: "narration", cancelledAt: now, terminal: "cancelled" });
    else this.sink?.record({ correlationId, flow: "narration", failedAt: now, terminal: "failed" });
  }

  private remember(key: string, artifact: SpeechArtifact): void {
    this.cache.set(key, artifact);
    while (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
  }
}
