import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileSystemSpeechArtifactStore } from "../adapters/FileSystemSpeechArtifactStore";
import { InMemoryTelemetrySink } from "../adapters/InMemoryTelemetrySink";
import { NarrationApplication } from "../application/NarrationApplication";
import type { SpeechArtifactStore } from "../ports/SpeechArtifactStore";
import type {
  SpeechSynthesizer,
  SpeechSynthesisIdentity,
  SynthesizedSpeech,
} from "../ports/SpeechSynthesizer";

const BASE_IDENTITY: SpeechSynthesisIdentity = {
  profileVersion: "teacher-zh-v1",
  provider: "test-provider",
  model: "test-model-v1",
  voice: "teacher-a",
  format: "mp3",
  sampleRate: 22_050,
};

function dataUrl(bytes: Buffer): string {
  return `data:audio/mpeg;base64,${bytes.toString("base64")}`;
}

class FakeSpeechSynthesizer implements SpeechSynthesizer {
  calls = 0;

  constructor(
    readonly cacheIdentity: SpeechSynthesisIdentity = BASE_IDENTITY,
    private readonly bytes = Buffer.from("complete-mp3"),
    private readonly implementation?: (
      signal: AbortSignal | undefined,
      onAudioChunk: ((chunk: Buffer) => void) | undefined,
    ) => Promise<Buffer>,
  ) {}

  async synthesize(
    _text: string,
    signal?: AbortSignal,
    onAudioChunk?: (chunk: Buffer) => void,
  ): Promise<SynthesizedSpeech> {
    this.calls += 1;
    const bytes = this.implementation
      ? await this.implementation(signal, onAudioChunk)
      : this.bytes;
    if (!this.implementation) onAudioChunk?.(bytes);
    return { audioUrl: dataUrl(bytes) };
  }

  stream(): never { throw new Error("not used by deterministic narration"); }
}

async function listCacheFiles(directory: string): Promise<string[]> {
  try { return await readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function main(): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "teaching-tools-speech-cache-"));
  try {
    // 1. L1 memory hit returns the same artifact without a provider call and
    // does not pretend that a provider connection occurred.
    {
      const sink = new InMemoryTelemetrySink();
      const provider = new FakeSpeechSynthesizer();
      const app = new NarrationApplication(provider, 8, sink);
      const first = await app.synthesize("  同一段   文案  ", undefined, "l1-first");
      const second = await app.synthesize("同一段 文案", undefined, "l1-second");
      assert.equal(provider.calls, 1);
      assert.equal(second.audioUrl, first.audioUrl);
      assert.equal(sink.getTimeline("l1-second")?.narrationArtifactSource, "memory");
      assert.equal(sink.getTimeline("l1-second")?.providerConnectedAt, undefined);
      assert.equal(sink.getTimeline("l1-second")?.ttsFirstAudioAt, undefined);
    }

    // 2. Reconstructing the application simulates a backend restart: L1 is
    // empty, L2 survives, and no new provider call occurs.
    {
      const directory = path.join(temporaryRoot, "restart");
      const store = new FileSystemSpeechArtifactStore(directory);
      const providerBeforeRestart = new FakeSpeechSynthesizer();
      await new NarrationApplication(providerBeforeRestart, 8, undefined, store)
        .synthesize("重启后仍应命中。", undefined, "before-restart");
      assert.equal(providerBeforeRestart.calls, 1);

      const sink = new InMemoryTelemetrySink();
      const providerAfterRestart = new FakeSpeechSynthesizer();
      const response = await new NarrationApplication(providerAfterRestart, 8, sink, store)
        .synthesize("重启后仍应命中。", undefined, "after-restart");
      assert.equal(providerAfterRestart.calls, 0);
      assert.match(response.audioUrl, /^data:audio\/mpeg;base64,/);
      assert.equal(sink.getTimeline("after-restart")?.narrationArtifactSource, "persistent");
      assert.equal(sink.getTimeline("after-restart")?.providerConnectedAt, undefined);
      assert.equal((await listCacheFiles(directory)).filter((name) => name.endsWith(".mp3")).length, 1);
    }

    // 3. Model, voice and profile are part of the key, while normalized text
    // whitespace is stable.
    {
      const directory = path.join(temporaryRoot, "identity");
      const store = new FileSystemSpeechArtifactStore(directory);
      const base = new FakeSpeechSynthesizer(BASE_IDENTITY);
      await new NarrationApplication(base, 8, undefined, store).synthesize("版本 化 文案");

      const same = new FakeSpeechSynthesizer(BASE_IDENTITY);
      await new NarrationApplication(same, 8, undefined, store).synthesize("  版本  化   文案  ");
      assert.equal(same.calls, 0, "normalized equivalent text reuses the artifact");

      for (const identity of [
        { ...BASE_IDENTITY, model: "test-model-v2" },
        { ...BASE_IDENTITY, voice: "teacher-b" },
        { ...BASE_IDENTITY, profileVersion: "teacher-zh-v2" },
        { ...BASE_IDENTITY, sampleRate: 24_000 },
      ]) {
        const changed = new FakeSpeechSynthesizer(identity);
        await new NarrationApplication(changed, 8, undefined, store).synthesize("版本 化 文案");
        assert.equal(changed.calls, 1, `${JSON.stringify(identity)} invalidates the previous artifact`);
      }
    }

    // 4. Same-key concurrency is single-flight. The leader streams provider
    // bytes; the waiter receives the completed buffer without a second call.
    {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const provider = new FakeSpeechSynthesizer(BASE_IDENTITY, Buffer.alloc(0), async (_signal, onChunk) => {
        await gate;
        const bytes = Buffer.from("one-provider-call");
        onChunk?.(bytes);
        return bytes;
      });
      const sink = new InMemoryTelemetrySink();
      const app = new NarrationApplication(provider, 8, sink);
      const streamed: Buffer[] = [];
      const leader = app.stream("并发文案", undefined, (chunk) => streamed.push(chunk), "flight-leader");
      const waiter = app.synthesize("并发文案", undefined, "flight-waiter");
      release();
      await Promise.all([leader, waiter]);
      assert.equal(provider.calls, 1);
      assert.equal(Buffer.concat(streamed).toString(), "one-provider-call");
      assert.equal(sink.getTimeline("flight-waiter")?.narrationArtifactSource, "provider");
      assert.ok(sink.getTimeline("flight-waiter")?.singleFlightWaitMs !== undefined);
      assert.equal(sink.getTimeline("flight-waiter")?.providerConnectedAt, undefined);
    }

    // 5. Provider failure after a partial stream never publishes an artifact.
    {
      const directory = path.join(temporaryRoot, "failure");
      const store = new FileSystemSpeechArtifactStore(directory);
      const provider = new FakeSpeechSynthesizer(BASE_IDENTITY, Buffer.alloc(0), async (_signal, onChunk) => {
        onChunk?.(Buffer.from("partial"));
        throw new Error("provider failed");
      });
      const app = new NarrationApplication(provider, 8, undefined, store);
      await assert.rejects(() => app.stream("失败不落盘", undefined, () => undefined), /provider failed/);
      assert.deepEqual(await listCacheFiles(directory), []);
    }

    // 6. Cancellation after a partial chunk likewise commits neither MP3 nor
    // temp files and a later request must call the provider again.
    {
      const directory = path.join(temporaryRoot, "cancel");
      const store = new FileSystemSpeechArtifactStore(directory);
      let partialSent!: () => void;
      const sawPartial = new Promise<void>((resolve) => { partialSent = resolve; });
      const provider = new FakeSpeechSynthesizer(BASE_IDENTITY, Buffer.alloc(0), async (signal, onChunk) => {
        onChunk?.(Buffer.from("partial"));
        partialSent();
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("cancelled")), { once: true });
        });
        return Buffer.from("unreachable");
      });
      const controller = new AbortController();
      const pending = new NarrationApplication(provider, 8, undefined, store)
        .stream("取消不落盘", controller.signal, () => undefined);
      await sawPartial;
      controller.abort(new Error("caller cancelled"));
      await assert.rejects(() => pending, /caller cancelled/);
      assert.deepEqual(await listCacheFiles(directory), []);

      const retryProvider = new FakeSpeechSynthesizer();
      await new NarrationApplication(retryProvider, 8, undefined, store).synthesize("取消不落盘");
      assert.equal(retryProvider.calls, 1);
    }

    // 7. An unavailable L2 degrades to a provider response and L1 reuse.
    {
      const brokenStore: SpeechArtifactStore = {
        async get() { throw new Error("read unavailable"); },
        async put() { throw new Error("write unavailable"); },
      };
      const provider = new FakeSpeechSynthesizer();
      const app = new NarrationApplication(provider, 8, undefined, brokenStore);
      await app.synthesize("缓存故障仍可播放");
      await app.synthesize("缓存故障仍可播放");
      assert.equal(provider.calls, 1);
    }

    console.log("PASS NarrationApplication persistent L2, versioned identity, single-flight, fallback and atomicity");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => { console.error(error); process.exit(1); });
