import type { SessionKind } from "../../../shared/similarityLearningMap";
import type { TaskId } from "../../../shared/contracts";
import type { SimilarityCapabilityId } from "../../../shared/similarityLearningMap";
import { db } from "../db/database";

export type CapabilityEvidenceRow = {
  capability_id: SimilarityCapabilityId;
  evidence_count: number;
  updated_at: string;
};

export type CapabilityWrongRow = {
  capability_id: SimilarityCapabilityId;
  wrong_count: number;
  updated_at: string;
};

export type StudentSessionProgressRow = {
  id: string;
  task_id: TaskId;
  session_kind: SessionKind;
  challenge_id: string | null;
  phase: string;
  current_index: number;
  finished: number;
  started_at: string;
  finished_at: string | null;
  source_session_id: string | null;
};

export type SavedTopicProgressRow = {
  node_id: string;
  task_id: TaskId;
  state: "in_progress" | "completed";
  last_step_id: string | null;
  updated_at: string;
};

const insertEvidenceStatement = db.prepare(`
  INSERT OR IGNORE INTO capability_evidence
    (student_name, capability_id, session_id, instance_id, step_id, task_id, session_kind, rule_version, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const listCapabilityEvidenceStatement = db.prepare(`
  SELECT capability_id, COUNT(*) AS evidence_count, MAX(created_at) AS updated_at
  FROM capability_evidence
  WHERE student_name = ? AND rule_version = ?
  GROUP BY capability_id
`);

const listStudentSessionsStatement = db.prepare(`
  SELECT id, task_id, session_kind, challenge_id, phase, current_index, finished,
         started_at, finished_at, source_session_id
  FROM practice_sessions
  WHERE student_name = ?
  ORDER BY started_at ASC
`);

const listCapabilityWrongStatement = db.prepare(`
  SELECT e.capability_id, COUNT(*) AS wrong_count, MAX(e.created_at) AS updated_at
  FROM practice_action_events e
  JOIN practice_sessions s ON s.id = e.session_id
  WHERE s.student_name = ? AND e.evaluation = 'wrong' AND e.capability_id IS NOT NULL
  GROUP BY e.capability_id
`);

const listSessionCapabilitiesStatement = db.prepare(`
  SELECT DISTINCT capability_id
  FROM capability_evidence
  WHERE session_id = ?
`);

const upsertTopicProgressStatement = db.prepare(`
  INSERT INTO student_topic_progress (student_name, node_id, task_id, state, last_step_id, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(student_name, node_id) DO UPDATE SET
    state = CASE WHEN student_topic_progress.state = 'completed' THEN 'completed' ELSE excluded.state END,
    last_step_id = COALESCE(excluded.last_step_id, student_topic_progress.last_step_id),
    updated_at = excluded.updated_at
`);

const listTopicProgressStatement = db.prepare(`
  SELECT node_id, task_id, state, last_step_id, updated_at
  FROM student_topic_progress
  WHERE student_name = ?
  ORDER BY updated_at ASC
`);

export function insertCapabilityEvidence(args: {
  studentName: string;
  capabilityId: SimilarityCapabilityId;
  sessionId: string;
  instanceId: string;
  stepId: string;
  taskId: TaskId;
  sessionKind: SessionKind;
  ruleVersion: string;
  createdAt?: string;
}) {
  insertEvidenceStatement.run(
    args.studentName,
    args.capabilityId,
    args.sessionId,
    args.instanceId,
    args.stepId,
    args.taskId,
    args.sessionKind,
    args.ruleVersion,
    args.createdAt || new Date().toISOString(),
  );
}

export function listCapabilityEvidence(studentName: string, ruleVersion: string): CapabilityEvidenceRow[] {
  return listCapabilityEvidenceStatement.all(studentName, ruleVersion) as CapabilityEvidenceRow[];
}

export function listStudentSessions(studentName: string): StudentSessionProgressRow[] {
  return listStudentSessionsStatement.all(studentName) as StudentSessionProgressRow[];
}

export function listCapabilityWrongCounts(studentName: string): CapabilityWrongRow[] {
  return listCapabilityWrongStatement.all(studentName) as CapabilityWrongRow[];
}

export function listSessionCapabilityIds(sessionId: string): SimilarityCapabilityId[] {
  return (listSessionCapabilitiesStatement.all(sessionId) as Array<{ capability_id: SimilarityCapabilityId }>)
    .map((row) => row.capability_id);
}

export function upsertTopicProgress(args: {
  studentName: string;
  nodeId: string;
  taskId: TaskId;
  state: "in_progress" | "completed";
  lastStepId?: string;
}) {
  upsertTopicProgressStatement.run(
    args.studentName,
    args.nodeId,
    args.taskId,
    args.state,
    args.lastStepId || null,
    new Date().toISOString(),
  );
}

export function listTopicProgress(studentName: string): SavedTopicProgressRow[] {
  return listTopicProgressStatement.all(studentName) as SavedTopicProgressRow[];
}
