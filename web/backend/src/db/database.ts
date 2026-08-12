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
    schema_version INTEGER NOT NULL DEFAULT 2,
    action_runtime_version INTEGER NOT NULL DEFAULT 1,
    session_kind TEXT NOT NULL DEFAULT 'practice',
    challenge_id TEXT,
    source_session_id TEXT,
    source_instance_id TEXT,
    source_step_id TEXT,
    return_mode TEXT,
    preserved_completed_step_ids_json TEXT
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
    scenario_id TEXT,
    scenario_version TEXT,
    scenario_json TEXT,
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

  CREATE TABLE IF NOT EXISTS practice_action_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    target_id TEXT,
    submitted_value TEXT,
    source_id TEXT,
    step_id TEXT,
    capability_id TEXT,
    capability_ids_json TEXT,
    evaluation TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(instance_id) REFERENCES practice_instances(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_practice_action_events_session
    ON practice_action_events(session_id, id);

  CREATE TABLE IF NOT EXISTS training_records_v1 (
    record_id TEXT PRIMARY KEY,
    record_kind TEXT NOT NULL,
    session_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    client_revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    received_at TEXT NOT NULL,
    FOREIGN KEY(session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_training_records_session
    ON training_records_v1(session_id, received_at);

  CREATE TABLE IF NOT EXISTS training_progress_v1 (
    student_name TEXT NOT NULL,
    task_id TEXT NOT NULL,
    action_kind TEXT NOT NULL,
    completed_count INTEGER NOT NULL,
    first_try_correct_count INTEGER NOT NULL,
    wrong_attempt_count INTEGER NOT NULL,
    total_duration_ms INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(student_name, task_id, action_kind)
  );

  CREATE TABLE IF NOT EXISTS training_progress_applied_v1 (
    record_id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL,
    FOREIGN KEY(record_id) REFERENCES training_records_v1(record_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS practice_action_checkpoints (
    session_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    current_action_id TEXT NOT NULL,
    completed_action_ids_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    draft_json TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(session_id, instance_id),
    FOREIGN KEY(session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(instance_id) REFERENCES practice_instances(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS practice_action_evaluations_v2 (
    session_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(session_id, idempotency_key),
    FOREIGN KEY(session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(instance_id) REFERENCES practice_instances(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS practice_action_worlds_v2 (
    session_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    source_step_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    world_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(session_id, instance_id),
    FOREIGN KEY(session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(instance_id) REFERENCES practice_instances(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS question_solution_revisions (
    question_id TEXT NOT NULL,
    question_version TEXT NOT NULL,
    solution_revision TEXT NOT NULL,
    document_json TEXT NOT NULL,
    review_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(question_id, question_version, solution_revision)
  );

  CREATE TABLE IF NOT EXISTS question_action_solution_boards (
    question_id TEXT NOT NULL,
    question_version TEXT NOT NULL,
    solution_revision TEXT NOT NULL,
    action_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    stage TEXT NOT NULL,
    board_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(question_id, question_version, solution_revision, action_id, mode, stage),
    FOREIGN KEY(question_id, question_version, solution_revision)
      REFERENCES question_solution_revisions(question_id, question_version, solution_revision)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_question_action_solution_boards_lookup
    ON question_action_solution_boards(question_id, question_version, solution_revision, action_id, mode, stage);

  CREATE TABLE IF NOT EXISTS capability_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    capability_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    session_kind TEXT NOT NULL,
    rule_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(session_id, instance_id, step_id, capability_id),
    FOREIGN KEY(session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(instance_id) REFERENCES practice_instances(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_capability_evidence_student
    ON capability_evidence(student_name, capability_id, created_at);

  CREATE TABLE IF NOT EXISTS student_topic_progress (
    student_name TEXT NOT NULL,
    node_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    state TEXT NOT NULL,
    last_step_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(student_name, node_id)
  );
`);

const sessionColumns = db.prepare("PRAGMA table_info(practice_sessions)").all() as Array<{ name: string }>;
if (!sessionColumns.some((column) => column.name === "schema_version")) {
  db.exec("ALTER TABLE practice_sessions ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1");
}
if (!sessionColumns.some((column) => column.name === "action_runtime_version")) {
  db.exec("ALTER TABLE practice_sessions ADD COLUMN action_runtime_version INTEGER NOT NULL DEFAULT 1");
}

for (const [name, definition] of [
  ["session_kind", "TEXT NOT NULL DEFAULT 'practice'"],
  ["challenge_id", "TEXT"],
  ["source_session_id", "TEXT"],
  ["source_instance_id", "TEXT"],
  ["source_step_id", "TEXT"],
  ["return_mode", "TEXT"],
  ["preserved_completed_step_ids_json", "TEXT"],
] as const) {
  if (!sessionColumns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE practice_sessions ADD COLUMN ${name} ${definition}`);
  }
}

const actionColumns = db.prepare("PRAGMA table_info(practice_action_events)").all() as Array<{ name: string }>;
if (!actionColumns.some((column) => column.name === "capability_id")) {
  db.exec("ALTER TABLE practice_action_events ADD COLUMN capability_id TEXT");
}
if (!actionColumns.some((column) => column.name === "capability_ids_json")) {
  db.exec("ALTER TABLE practice_action_events ADD COLUMN capability_ids_json TEXT");
}

const instanceColumns = db.prepare("PRAGMA table_info(practice_instances)").all() as Array<{ name: string }>;
if (!instanceColumns.some((column) => column.name === "scenario_id")) {
  db.exec("ALTER TABLE practice_instances ADD COLUMN scenario_id TEXT");
}
if (!instanceColumns.some((column) => column.name === "scenario_version")) {
  db.exec("ALTER TABLE practice_instances ADD COLUMN scenario_version TEXT");
}
if (!instanceColumns.some((column) => column.name === "scenario_json")) {
  db.exec("ALTER TABLE practice_instances ADD COLUMN scenario_json TEXT");
}

const checkpointColumns = db.prepare("PRAGMA table_info(practice_action_checkpoints)").all() as Array<{ name: string }>;
if (!checkpointColumns.some((column) => column.name === "draft_json")) {
  db.exec("ALTER TABLE practice_action_checkpoints ADD COLUMN draft_json TEXT");
}

const actionWorldColumns = db.prepare("PRAGMA table_info(practice_action_worlds_v2)").all() as Array<{ name: string }>;
if (!actionWorldColumns.some((column) => column.name === "source_step_id")) {
  db.exec("ALTER TABLE practice_action_worlds_v2 ADD COLUMN source_step_id TEXT NOT NULL DEFAULT ''");
}
