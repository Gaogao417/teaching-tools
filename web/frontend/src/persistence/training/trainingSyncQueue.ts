import type { TrainingCheckpoint, TrainingReceipt, TrainingResult } from "../../../../shared/trainingRuntime";

export type QueuedTrainingKind = "checkpoint" | "result";
export type QueuedTrainingRecord = TrainingCheckpoint | TrainingResult;

interface QueueEntry {
  kind: QueuedTrainingKind;
  record: QueuedTrainingRecord;
  enqueuedAt: number;
  attempts: number;
  nextAttemptAt: number;
}

interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class TrainingSyncQueue {
  private entries: QueueEntry[];
  private flushing?: Promise<void>;

  constructor(
    private readonly storage: QueueStorage,
    private readonly key = "training-sync-queue-v1",
    private readonly now: () => number = () => Date.now(),
    private readonly capacity = 100,
    private readonly ttlMs = 7 * 24 * 60 * 60 * 1000,
  ) {
    this.entries = this.read().filter((entry) => this.now() - entry.enqueuedAt <= this.ttlMs).slice(-this.capacity);
    this.persist();
  }

  enqueue(kind: QueuedTrainingKind, record: QueuedTrainingRecord): void {
    const existing = this.entries.findIndex((entry) => entry.record.recordId === record.recordId);
    const entry = { kind, record, enqueuedAt: this.now(), attempts: 0, nextAttemptAt: this.now() };
    if (existing >= 0) this.entries[existing] = entry;
    else this.entries.push(entry);
    this.entries = this.entries.filter((item) => this.now() - item.enqueuedAt <= this.ttlMs).slice(-this.capacity);
    this.persist();
  }

  size(): number { return this.entries.length; }
  snapshot(): ReadonlyArray<QueueEntry> { return this.entries.map((entry) => ({ ...entry, record: { ...entry.record } })); }

  flush(sender: (kind: QueuedTrainingKind, record: QueuedTrainingRecord) => Promise<TrainingReceipt>): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushNow(sender).finally(() => { this.flushing = undefined; });
    return this.flushing;
  }

  private async flushNow(sender: (kind: QueuedTrainingKind, record: QueuedTrainingRecord) => Promise<TrainingReceipt>) {
    for (const entry of [...this.entries]) {
      if (entry.nextAttemptAt > this.now()) continue;
      try {
        const receipt = await sender(entry.kind, entry.record);
        if (receipt.accepted && receipt.recordId === entry.record.recordId) {
          this.entries = this.entries.filter((candidate) => candidate.record.recordId !== entry.record.recordId);
        }
      } catch {
        entry.attempts += 1;
        entry.nextAttemptAt = this.now() + Math.min(60_000, 1_000 * 2 ** Math.min(entry.attempts, 6));
      }
      this.persist();
    }
  }

  private read(): QueueEntry[] {
    try {
      const value = JSON.parse(this.storage.getItem(this.key) || "[]") as unknown;
      return Array.isArray(value) ? value.filter((entry): entry is QueueEntry => Boolean(entry && typeof entry === "object" && "record" in entry)) : [];
    } catch { return []; }
  }

  private persist(): void { this.storage.setItem(this.key, JSON.stringify(this.entries)); }
}

let browserQueue: TrainingSyncQueue | undefined;
export function getTrainingSyncQueue(): TrainingSyncQueue {
  if (!browserQueue) browserQueue = new TrainingSyncQueue(window.localStorage);
  return browserQueue;
}
