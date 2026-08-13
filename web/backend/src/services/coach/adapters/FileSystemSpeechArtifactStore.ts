import { constants as fsConstants } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SpeechArtifact, SpeechArtifactStore } from "../ports/SpeechArtifactStore";

const CONTENT_TYPE = "audio/mpeg";
const VALID_KEY = /^[a-f0-9]{64}$/;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Operation aborted", "AbortError");
}

/**
 * Stores completed MP3 artifacts under a content-addressed filename. Writes go
 * to a unique sibling file, are flushed, and are then atomically renamed so a
 * reader can never observe partial provider output.
 */
export class FileSystemSpeechArtifactStore implements SpeechArtifactStore {
  constructor(private readonly rootDirectory: string) {}

  async get(key: string, signal?: AbortSignal): Promise<SpeechArtifact | undefined> {
    const artifactPath = this.artifactPath(key);
    throwIfAborted(signal);
    try {
      const bytes = await readFile(artifactPath, signal ? { signal } : undefined);
      throwIfAborted(signal);
      return { bytes, contentType: CONTENT_TYPE };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async put(key: string, artifact: SpeechArtifact, signal?: AbortSignal): Promise<void> {
    const artifactPath = this.artifactPath(key);
    if (artifact.bytes.length === 0) throw new Error("Cannot cache an empty speech artifact");
    throwIfAborted(signal);
    await mkdir(this.rootDirectory, { recursive: true });

    // A unique temp filename allows concurrent writers. rename(2) publishes the
    // fully flushed file as one atomic directory operation.
    const temporaryPath = path.join(this.rootDirectory, `.${key}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      await handle.writeFile(artifact.bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      throwIfAborted(signal);
      await rename(temporaryPath, artifactPath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private artifactPath(key: string): string {
    if (!VALID_KEY.test(key)) throw new Error("Speech artifact key must be a lowercase SHA-256 digest");
    return path.join(this.rootDirectory, `${key}.mp3`);
  }
}
