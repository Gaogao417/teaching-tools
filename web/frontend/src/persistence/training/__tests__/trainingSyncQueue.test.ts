import { describe, expect, it } from "vitest";
import { TRAINING_RUNTIME_VERSION, type TrainingCheckpoint } from "../../../../../shared/trainingRuntime";
import { TrainingSyncQueue } from "../trainingSyncQueue";

const checkpoint = (recordId: string): TrainingCheckpoint => ({
  version: TRAINING_RUNTIME_VERSION, recordId, sessionId: "s1", exerciseId: "e1", planRevision: 0, currentActionId: "a1",
  completedActionIds: [], attempts: [], actionMetrics: [], clientRevision: 0, createdAt: "2026-08-12T00:00:00.000Z",
});

describe("TrainingSyncQueue", () => {
  it("persists offline and removes exactly once after an idempotent receipt", async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const queue = new TrainingSyncQueue(storage, "q", () => 1000);
    queue.enqueue("checkpoint", checkpoint("r1"));
    await queue.flush(async () => { throw new Error("offline"); });
    expect(queue.size()).toBe(1);
    const restored = new TrainingSyncQueue(storage, "q", () => 3000);
    let calls = 0;
    await restored.flush(async (_kind, record) => ({ version: 1, recordId: record.recordId, accepted: true, duplicate: calls++ > 0, serverRevision: 0, receivedAt: "now" }));
    expect(restored.size()).toBe(0);
    await restored.flush(async () => { calls += 1; throw new Error("must not run"); });
    expect(calls).toBe(1);
  });
});
