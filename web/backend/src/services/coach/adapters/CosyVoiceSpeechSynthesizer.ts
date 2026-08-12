import { synthesizeCosyVoice } from "../cosyVoiceService";
import type { SpeechEvent, SpeechSynthesizer, SynthesizedSpeech } from "../ports/SpeechSynthesizer";
import { SpeechError } from "../ports/SpeechSynthesizer";
import type { Result, EventStream } from "../ports/TextCoachEngine";
import type { SpokenSegment } from "../../../../../shared/coachMedia";
import { AsyncQueue } from "../application/asyncQueue";

const MIME_TYPE = "audio/mpeg";

export class CosyVoiceSpeechSynthesizer implements SpeechSynthesizer {
  synthesize(text: string, signal?: AbortSignal, onAudioChunk?: (chunk: Buffer) => void): Promise<SynthesizedSpeech> {
    return synthesizeCosyVoice(text, signal, onAudioChunk);
  }

  /**
   * Stream one spoken segment. The DashScope duplex socket emits raw MP3
   * binary frames as they are produced; each frame is forwarded immediately as
   * an `audio-delta` event — we never wait for `task-finished` before surfacing
   * audio. The resolved promise only marks setup; provider work continues as
   * the consumer pulls events.
   */
  stream(segment: SpokenSegment, signal: AbortSignal): Promise<Result<EventStream<SpeechEvent>, SpeechError>> {
    const spokenText = segment.spokenText.trim();
    if (!spokenText) {
      return Promise.resolve({ ok: false, error: new SpeechError("empty-segment", "CosyVoice segment text is empty", false) });
    }
    const queue = new AsyncQueue<SpeechEvent>();
    queue.push({ type: "speech-started", segmentId: segment.segmentId, mimeType: MIME_TYPE });

    const fail = (message: string, retryable: boolean) => {
      queue.error(new SpeechError("cosyvoice-stream-failed", message, retryable));
    };
    const onAbort = () => fail("CosyVoice stream cancelled", false);
    if (signal.aborted) { onAbort(); }
    else signal.addEventListener("abort", onAbort, { once: true });

    // Kick off the provider call; forward each binary frame as it arrives and
    // close the queue when the task finishes or fails.
    synthesizeCosyVoice(spokenText, signal, (chunk) => {
      queue.push({ type: "audio-delta", segmentId: segment.segmentId, bytes: chunk }, chunk.length);
    })
      .then(() => {
        signal.removeEventListener("abort", onAbort);
        queue.push({ type: "speech-completed", segmentId: segment.segmentId });
        queue.complete();
      })
      .catch((error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        const message = error instanceof Error ? error.message : "CosyVoice stream failed";
        fail(message, true);
      });

    return Promise.resolve({ ok: true, value: queue });
  }
}
