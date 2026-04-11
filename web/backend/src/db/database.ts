import Database from "better-sqlite3";
import path from "node:path";

const sqlitePath =
  process.env.SQLITE_PATH || path.resolve(process.cwd(), "data/trig-web.sqlite");

export const db = new Database(sqlitePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS practice_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    phase TEXT NOT NULL,
    current_index INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    finished INTEGER NOT NULL DEFAULT 0,
    schema_version INTEGER NOT NULL DEFAULT 2
  );

  CREATE TABLE IF NOT EXISTS practice_problems (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    type TEXT NOT NULL,
    problem_index INTEGER NOT NULL,
    public_json TEXT NOT NULL,
    answer_key_json TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS practice_instances (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    content_id TEXT NOT NULL,
    engine_kind TEXT NOT NULL,
    instance_index INTEGER NOT NULL,
    content_json TEXT NOT NULL,
    instance_json TEXT NOT NULL,
    engine_state_json TEXT NOT NULL,
    runtime_state_json TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS practice_results (
    session_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    elapsed_ms INTEGER NOT NULL,
    problem_count INTEGER NOT NULL,
    first_try_accuracy REAL NOT NULL,
    first_try_correct_count INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    cleared_at TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE
  );
`);

const sessionColumns = db.prepare("PRAGMA table_info(practice_sessions)").all() as Array<{ name: string }>;
if (!sessionColumns.some((column) => column.name === "schema_version")) {
  db.exec("ALTER TABLE practice_sessions ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1");
}
