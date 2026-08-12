import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, rmSync } from "node:fs";

const sqlitePath = path.resolve(process.cwd(), ".training-v2-ingest.test.sqlite");
if (existsSync(sqlitePath)) rmSync(sqlitePath, { force: true });
process.env.SQLITE_PATH = sqlitePath;

const { db } = require("../../../db/database") as typeof import("../../../db/database");
const { SqliteTrainingRecordRepository } = require("../adapters/sqliteTrainingRecordRepository") as typeof import("../adapters/sqliteTrainingRecordRepository");
const { ingestTrainingRecord } = require("../application/ingestTrainingRecord") as typeof import("../application/ingestTrainingRecord");
const { normalizedActionMetrics } = require("../application/normalizeTrainingMetric") as typeof import("../application/normalizeTrainingMetric");
type TrainingCheckpoint = import("../../../../../shared/trainingRuntime").TrainingCheckpoint;
type TrainingResult = import("../../../../../shared/trainingRuntime").TrainingResult;

const repository = new SqliteTrainingRecordRepository();
const now = "2026-01-01T00:00:00.000Z";

db.prepare(`INSERT INTO practice_sessions (id, task_id, student_name, phase, current_index, started_at, finished)
            VALUES ('s1', 't1', 'student', 'answering', 0, ?, 0)`).run(now);

function v1Checkpoint(exerciseId: string, recordId: string): TrainingCheckpoint {
  return {
    version: 1, recordId, sessionId: "s1", exerciseId, planRevision: 1,
    currentActionId: "mp1", completedActionIds: [],
    attempts: [{
      version: 1, eventId: `${recordId}-e1`, sessionId: "s1", exerciseId, actionId: "mp1", actionKind: "make-parallel",
      candidate: { kind: "object", objectKind: "point", objectId: "P" }, outcome: "correct-partial",
      attemptIndex: 1, elapsedMs: 50, assistance: "none", at: now,
    }],
    actionMetrics: [{
      actionId: "mp1", actionKind: "make-parallel", durationMs: 50, attemptCount: 1, wrongAttemptCount: 0,
      firstTryCorrect: false, completed: false, assistanceUsed: [],
    }],
    clientRevision: 1, createdAt: now,
  };
}

function v2Metric(actionId = "mp1") {
  return {
    version: 2 as const, actionId, actionKind: "make-parallel", startedAt: now, completedAt: now,
    duration: { startedAt: now, completedAt: now, activeDurationMs: 50, segments: [{ startedAt: now, endedAt: now, durationMs: 50 }] },
    correctAttemptCount: 1, wrongAttemptCount: 1, backCount: 1, clearCount: 0, hintCount: 1, coachCount: 0,
    firstAttemptCorrect: false, assistanceLevel: "hint-used" as const,
    errorDistribution: [{ actionStateBefore: "select-through-point", candidateId: "Q", wrongCount: 1 }],
  };
}

function v2Attempt(recordId: string, exerciseId: string) {
  return {
    version: 2 as const, eventId: `${recordId}-e1`, exerciseId, actionId: "mp1", actionKind: "make-parallel",
    actionStateBefore: "select-through-point", sequence: 1, occurredAt: now, elapsedMs: 50,
    classification: "wrong-candidate" as const, candidateId: "Q",
  };
}

async function main() {
  // 1. v1 checkpoint (no carry-on) still accepted and uploaded.
  const v1 = v1Checkpoint("ex-v1", "rec-v1");
  const r1 = ingestTrainingRecord(repository, "checkpoint", v1);
  assert.equal(r1.accepted, true, "v1 checkpoint accepted");

  // 2. v1 checkpoint WITH valid v2 carry-on accepted.
  const v2carried: TrainingCheckpoint = {
    ...v1Checkpoint("ex-v2", "rec-v2"),
    actionMetricsV2: [v2Metric()],
    attemptsV2: [v2Attempt("rec-v2", "ex-v2")],
  };
  const r2 = ingestTrainingRecord(repository, "checkpoint", v2carried);
  assert.equal(r2.accepted, true, "v2 carry-on checkpoint accepted");

  // 3. Bad v2 carry-on (malformed metric) is REJECTED with 400.
  const badV2: unknown = {
    ...v1Checkpoint("ex-bad", "rec-bad"),
    actionMetricsV2: [{ version: 1, actionId: "mp1", actionKind: "make-parallel" }], // version != 2 → invalid
  };
  assert.throws(() => ingestTrainingRecord(repository, "checkpoint", badV2), (error: unknown) => {
    const status = (error as { status?: number }).status;
    return status === 400;
  }, "bad v2 carry-on rejected with 400");

  // 4. No re-judge: a structurally valid but mathematically nonsensical metric
  //    (claims completed with a fabricated result) is accepted — ingest validates
  //    SHAPE only and never re-evaluates answer truth.
  const fabricated = v1Checkpoint("ex-fab", "rec-fab");
  fabricated.actionMetrics[0]!.completed = true;
  fabricated.actionMetrics[0]!.firstTryCorrect = true;
  fabricated.actionMetrics[0]!.durationMs = 999999;
  const r4 = ingestTrainingRecord(repository, "checkpoint", fabricated);
  assert.equal(r4.accepted, true, "ingest does not re-judge math correctness");

  // 5. Read-model normalization prefers v2 carry-on over v1.
  const normalized = normalizedActionMetrics(v2carried as unknown as TrainingResult);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]!.wrongAttemptCount, 1, "v2 wrongAttemptCount used");
  assert.equal(normalized[0]!.firstTryCorrect, false, "v2 firstAttemptCorrect used");
  assert.deepEqual(normalized[0]!.assistanceUsed, ["back", "hint"], "v2 assistance derived from counts");

  // And falls back to v1 when no carry-on is present.
  const v1normalized = normalizedActionMetrics(v1 as unknown as TrainingResult);
  assert.equal(v1normalized[0]!.durationMs, 50, "v1 fallback durationMs");

  db.close();
  rmSync(sqlitePath, { force: true });
  console.log("PASS Training v2 ingest accepts v1+v2, rejects bad v2, no re-judge");
}

void main().catch((error) => {
  console.error("FAIL Training v2 ingest", error);
  try { db.close(); } catch { /* already closed */ }
  throw error;
});
