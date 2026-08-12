import { db } from "../../../db/database";
import { TRAINING_RUNTIME_VERSION, type TrainingReceipt } from "../../../../../shared/trainingRuntime";
import type { TrainingRecord, TrainingRecordKind, TrainingRecordRepository } from "../ports/trainingRecordRepository";

export class SqliteTrainingRecordRepository implements TrainingRecordRepository {
  receiptFor(recordId: string): TrainingReceipt | undefined {
    const row = db.prepare("SELECT client_revision, received_at FROM training_records_v1 WHERE record_id = ?")
      .get(recordId) as { client_revision: number; received_at: string } | undefined;
    return row ? { version: TRAINING_RUNTIME_VERSION, recordId, accepted: true, duplicate: true, serverRevision: row.client_revision, receivedAt: row.received_at } : undefined;
  }

  save(kind: TrainingRecordKind, record: TrainingRecord): TrainingReceipt {
    const receivedAt = new Date().toISOString();
    const latest = db.prepare("SELECT record_id, client_revision FROM training_records_v1 WHERE session_id = ? AND exercise_id = ? AND record_kind = ? ORDER BY client_revision DESC LIMIT 1")
      .get(record.sessionId, record.exerciseId, kind) as { record_id: string; client_revision: number } | undefined;
    if (latest && (record.clientRevision < latest.client_revision
      || (record.clientRevision === latest.client_revision && record.recordId !== latest.record_id))) {
      throw Object.assign(new Error("Training record revision conflict"), { status: 409 });
    }
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO training_records_v1
        (record_id, record_kind, session_id, exercise_id, client_revision, payload_json, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(record.recordId, kind, record.sessionId, record.exerciseId, record.clientRevision, JSON.stringify(record), receivedAt);
    const row = db.prepare("SELECT client_revision, received_at FROM training_records_v1 WHERE record_id = ?")
      .get(record.recordId) as { client_revision: number; received_at: string };
    return {
      version: TRAINING_RUNTIME_VERSION,
      recordId: record.recordId,
      accepted: true,
      duplicate: inserted.changes === 0,
      serverRevision: row.client_revision,
      receivedAt: row.received_at,
    };
  }

  listForSession(sessionId: string) {
    const rows = db.prepare("SELECT record_kind, payload_json, received_at FROM training_records_v1 WHERE session_id = ? ORDER BY received_at")
      .all(sessionId) as Array<{ record_kind: TrainingRecordKind; payload_json: string; received_at: string }>;
    return rows.map((row) => ({ kind: row.record_kind, record: JSON.parse(row.payload_json) as TrainingRecord, receivedAt: row.received_at }));
  }
}
