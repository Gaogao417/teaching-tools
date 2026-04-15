import {
  AnswerPayload,
  AnswerResponse,
  ContentDefinition,
  FinishPracticeResponse,
  RuntimeActionEvent,
  RuntimeActionResponse,
  SessionPhase,
  StartPracticeResponse,
  TaskId,
} from "../../../../shared/contracts";
import { db } from "../../db/database";
import { finishAndPersistResult } from "../resultsService";
import { getTaskDefinition } from "../tasks/catalogService";
import { resolveContentDefinition } from "./contentRegistry";
import { getEnginePlugin } from "./engineRegistry";
import { answerPayloadToRuntimeAction, runtimeActionToEngineAction } from "./legacyAdapter";
import { appError } from "./errors";
import { projectedPhaseForIndex, toLegacyProblemState, toPracticeSessionSnapshot } from "./runtimeSnapshotProjector";
import { TriangleTrigEngineState } from "./triangleTrigEngine";

type SessionRow = {
  id: string;
  task_id: TaskId;
  student_name: string;
  phase: SessionPhase;
  current_index: number;
  started_at: string;
  finished_at: string | null;
  finished: number;
  schema_version: number;
};

type RuntimeInstanceRow = {
  id: string;
  session_id: string;
  task_id: TaskId;
  content_id: string;
  engine_kind: "triangle-trig";
  instance_index: number;
  content_json: string;
  instance_json: string;
  engine_state_json: string;
  runtime_state_json: string;
};

type RuntimeInstanceRecord = {
  row: RuntimeInstanceRow;
  content: ContentDefinition;
  engineState: TriangleTrigEngineState;
};

function getSessionRow(sessionId: string): SessionRow | undefined {
  return db.prepare(`SELECT * FROM practice_sessions WHERE id = ?`).get(sessionId) as SessionRow | undefined;
}

function requireRuntimeSession(sessionId: string): SessionRow {
  const session = getSessionRow(sessionId);
  if (!session) throw appError("SESSION_NOT_FOUND", "Session not found", 404);
  if (session.schema_version < 2) {
    throw appError("LEGACY_SESSION_EXPIRED", "Legacy in-progress session expired after runtime-first refactor", 409);
  }
  return session;
}

function loadRuntimeInstances(sessionId: string): RuntimeInstanceRecord[] {
  const rows = db
    .prepare(
      `SELECT *
       FROM practice_instances
       WHERE session_id = ?
       ORDER BY instance_index ASC`,
    )
    .all(sessionId) as RuntimeInstanceRow[];

  return rows.map((row) => ({
    row,
    content: resolveContentDefinition(row.content_id, JSON.parse(row.content_json) as ContentDefinition),
    engineState: JSON.parse(row.engine_state_json) as TriangleTrigEngineState,
  }));
}

function persistRuntimeRecord(
  record: RuntimeInstanceRecord,
  engineState: TriangleTrigEngineState,
  runtime: ReturnType<ReturnType<typeof getEnginePlugin>["buildRuntime"]>,
) {
  db.prepare(
    `UPDATE practice_instances
     SET instance_json = ?, engine_state_json = ?, runtime_state_json = ?
     WHERE id = ?`,
  ).run(
    JSON.stringify(runtime.instance),
    JSON.stringify(engineState),
    JSON.stringify(runtime.runtimeState),
    record.row.id,
  );
}

export function startPractice(taskId: TaskId, studentName: string): StartPracticeResponse {
  const trimmed = studentName.trim();
  if (!trimmed) throw appError("INVALID_STUDENT_NAME", "studentName is required");

  const task = getTaskDefinition(taskId);
  const content = resolveContentDefinition(task.contentId);
  const plugin = getEnginePlugin(task.engineKind);
  const sessionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO practice_sessions (id, task_id, student_name, phase, current_index, started_at, finished, schema_version)
     VALUES (?, ?, ?, ?, ?, ?, 0, 2)`,
  ).run(sessionId, taskId, trimmed, "answering", 0, startedAt);

  const insertInstance = db.prepare(
    `INSERT INTO practice_instances (id, session_id, task_id, content_id, engine_kind, instance_index, content_json, instance_json, engine_state_json, runtime_state_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const instances = Array.from({ length: 5 }, (_, index) => {
    const state = plugin.createState(task, content, index);
    const runtime = plugin.buildRuntime(task, content, state, "answering");
    insertInstance.run(
      state.instanceId,
      sessionId,
      taskId,
      content.id,
      task.engineKind,
      index,
      JSON.stringify(content),
      JSON.stringify(runtime.instance),
      JSON.stringify(state),
      JSON.stringify(runtime.runtimeState),
    );
    return {
      row: {
        id: state.instanceId,
        session_id: sessionId,
        task_id: taskId,
        content_id: content.id,
        engine_kind: task.engineKind,
        instance_index: index,
        content_json: JSON.stringify(content),
        instance_json: JSON.stringify(runtime.instance),
        engine_state_json: JSON.stringify(state),
        runtime_state_json: JSON.stringify(runtime.runtimeState),
      } satisfies RuntimeInstanceRow,
      content,
      engineState: state,
    };
  });

  const session = requireRuntimeSession(sessionId);
  return toPracticeSessionSnapshot(session, instances);
}

export function restorePractice(sessionId: string) {
  const session = requireRuntimeSession(sessionId);
  return toPracticeSessionSnapshot(session, loadRuntimeInstances(sessionId));
}

export function submitRuntimeAction(
  sessionId: string,
  instanceId: string,
  action: RuntimeActionEvent,
): RuntimeActionResponse {
  const session = requireRuntimeSession(sessionId);
  if (session.finished) throw appError("SESSION_FINISHED", "Session already finished", 409);

  const records = loadRuntimeInstances(sessionId);
  const activeRecord = records[session.current_index];
  if (!activeRecord || activeRecord.row.id !== instanceId) {
    throw appError("INSTANCE_NOT_ACTIVE", "Current instance is not active", 409);
  }

  const task = getTaskDefinition(activeRecord.row.task_id);
  const plugin = getEnginePlugin(activeRecord.row.engine_kind);
  const engineAction = runtimeActionToEngineAction(action, activeRecord.engineState);
  const reduced = plugin.reduceAction(task, activeRecord.content, activeRecord.engineState, engineAction);

  let nextIndex = session.current_index;
  let nextPhase = reduced.phase;

  if (reduced.phase === "correct_pause") {
    if (session.current_index >= records.length - 1) {
      nextPhase = "group_finished";
    } else {
      nextIndex = session.current_index + 1;
    }
  }

  const runtime = plugin.buildRuntime(task, activeRecord.content, reduced.engineState, nextPhase);
  persistRuntimeRecord(activeRecord, reduced.engineState, runtime);
  db.prepare(`UPDATE practice_sessions SET current_index = ?, phase = ? WHERE id = ?`).run(
    nextIndex,
    nextPhase,
    sessionId,
  );

  return {
    accepted: reduced.accepted,
    evaluation: reduced.evaluation,
    runtimeState: runtime.runtimeState,
    runtime,
    feedback: reduced.feedback,
    nextIndex,
    phase: nextPhase,
  };
}

export function submitAnswer(sessionId: string, problemId: string, payload: AnswerPayload): AnswerResponse {
  const session = requireRuntimeSession(sessionId);
  const records = loadRuntimeInstances(sessionId);
  const activeRecord = records[session.current_index];
  if (!activeRecord || activeRecord.row.id !== problemId) {
    throw appError("PROBLEM_NOT_FOUND", "Problem not found", 404);
  }

  const response = submitRuntimeAction(
    sessionId,
    activeRecord.row.id,
    answerPayloadToRuntimeAction(payload, activeRecord.engineState),
  );
  const refreshedSession = requireRuntimeSession(sessionId);
  const refreshedRecords = loadRuntimeInstances(sessionId);
  const problemRecord = refreshedRecords.find((record) => record.row.id === problemId) || activeRecord;
  const compatSession =
    response.phase === "group_finished" && problemRecord.row.instance_index !== refreshedSession.current_index
      ? { ...refreshedSession, phase: "correct_pause" as const }
      : { ...refreshedSession, phase: projectedPhaseForIndex(refreshedSession, problemRecord) };

  return {
    correct: response.evaluation !== "wrong",
    allSolved: response.phase === "group_finished",
    hint: response.evaluation === "wrong" ? response.runtime?.instance.guide.hint : undefined,
    problemState: toLegacyProblemState(compatSession, problemRecord),
    nextIndex: response.nextIndex,
    phase: response.phase,
    runtime: response.runtime,
    feedback: response.feedback,
  };
}

export function finishPractice(sessionId: string): FinishPracticeResponse {
  const session = requireRuntimeSession(sessionId);
  const instances = loadRuntimeInstances(sessionId);
  const result = finishAndPersistResult(session, instances);
  return {
    sessionId,
    resultSnapshot: result.resultSnapshot,
    alreadyFinished: result.alreadyFinished,
  };
}
