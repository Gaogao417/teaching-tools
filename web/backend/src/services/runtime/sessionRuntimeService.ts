import {
  AnswerPayload,
  AnswerResponse,
  ContentDefinition,
  FinishPracticeResponse,
  PracticeSessionSnapshot,
  ResultSnapshot,
  RuntimeActionEvent,
  RuntimeActionResponse,
  SessionPhase,
  StartPracticeResponse,
  TaskId,
} from "../../../../shared/contracts";
import { TASK_COLORS, TASK_LABELS } from "../../../../shared/tasks";
import { db } from "../../db/database";
import { getTaskDefinition } from "../tasks/catalogService";
import { resolveContentDefinition } from "./contentRegistry";
import { getEnginePlugin } from "./engineRegistry";
import { answerPayloadToRuntimeAction, projectLegacyProblem, runtimeActionToEngineAction } from "./legacyAdapter";
import { appError } from "./errors";
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
    content: resolveContentDefinition(
      row.content_id,
      JSON.parse(row.content_json) as ContentDefinition,
    ),
    engineState: JSON.parse(row.engine_state_json) as TriangleTrigEngineState,
  }));
}

function activeRuntime(session: SessionRow, record: RuntimeInstanceRecord) {
  const task = getTaskDefinition(record.row.task_id);
  const plugin = getEnginePlugin(record.row.engine_kind);
  return plugin.buildRuntime(task, record.content, record.engineState, session.phase);
}

function projectedPhaseForIndex(session: SessionRow, record: RuntimeInstanceRecord) {
  if (record.row.instance_index === session.current_index) return session.phase;
  return record.engineState.status === "correct" ? "correct_pause" : "answering";
}

function toSnapshot(session: SessionRow, instances: RuntimeInstanceRecord[]): PracticeSessionSnapshot {
  const active = instances[session.current_index];
  const runtime = active ? activeRuntime(session, active) : undefined;

  const elapsedMs = session.finished_at
    ? Date.parse(session.finished_at) - Date.parse(session.started_at)
    : Date.now() - Date.parse(session.started_at);

  return {
    sessionId: session.id,
    taskId: session.task_id,
    studentName: session.student_name,
    currentIndex: session.current_index,
    instanceCount: instances.length,
    elapsedMs: Math.max(0, elapsedMs),
    phase: session.phase,
    runtime,
    legacy: {
      problems: instances.map((record) => {
        const task = getTaskDefinition(record.row.task_id);
        const plugin = getEnginePlugin(record.row.engine_kind);
        const phase = projectedPhaseForIndex(session, record);
        const instanceRuntime = plugin.buildRuntime(task, record.content, record.engineState, phase);
        return projectLegacyProblem(
          task,
          record.content,
          record.engineState,
          instanceRuntime,
          phase,
          record.row.instance_index === session.current_index,
        );
      }),
    },
  };
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

function groupLabel(taskId: TaskId) {
  if (taskId === "meaning") return "第 1 组";
  if (taskId === "ratioToSide") return "第 2 组";
  return "第 3 组";
}

function buildHistory(taskId: TaskId, studentName: string) {
  const rows = db
    .prepare(
      `SELECT snapshot_json
       FROM practice_results
       WHERE task_id = ? AND student_name = ?
       ORDER BY cleared_at DESC
       LIMIT 10`,
    )
    .all(taskId, studentName) as Array<{ snapshot_json: string }>;
  return rows
    .map((row) => JSON.parse(row.snapshot_json) as ResultSnapshot)
    .reverse()
    .map((item) => ({
      elapsedMs: item.elapsedMs,
      clearedAt: item.clearedAt,
    }));
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
  return toSnapshot(session, instances);
}

export function restorePractice(sessionId: string) {
  const session = requireRuntimeSession(sessionId);
  return toSnapshot(session, loadRuntimeInstances(sessionId));
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
  const task = getTaskDefinition(problemRecord.row.task_id);
  const plugin = getEnginePlugin(problemRecord.row.engine_kind);
  const problemPhase =
    response.phase === "group_finished" && problemRecord.row.instance_index !== refreshedSession.current_index
      ? "correct_pause"
      : projectedPhaseForIndex(refreshedSession, problemRecord);
  const runtime = plugin.buildRuntime(task, problemRecord.content, problemRecord.engineState, problemPhase);

  return {
    correct: response.evaluation !== "wrong",
    allSolved: response.phase === "group_finished",
    hint: response.evaluation === "wrong" ? response.runtime?.instance.guide.hint : undefined,
    problemState: projectLegacyProblem(
      task,
      problemRecord.content,
      problemRecord.engineState,
      runtime,
      problemPhase,
      problemRecord.row.instance_index === refreshedSession.current_index,
    ),
    nextIndex: response.nextIndex,
    phase: response.phase,
    runtime: response.runtime,
    feedback: response.feedback,
  };
}

export function finishPractice(sessionId: string): FinishPracticeResponse {
  const existing = db
    .prepare(`SELECT snapshot_json FROM practice_results WHERE session_id = ?`)
    .get(sessionId) as { snapshot_json: string } | undefined;
  if (existing) {
    return {
      sessionId,
      resultSnapshot: JSON.parse(existing.snapshot_json) as ResultSnapshot,
      alreadyFinished: true,
    };
  }

  const session = requireRuntimeSession(sessionId);
  const instances = loadRuntimeInstances(sessionId);
  const finishedAt = new Date().toISOString();
  const elapsedMs = Math.max(0, Date.parse(finishedAt) - Date.parse(session.started_at));
  const firstTryCorrectCount = instances.filter((record) => record.engineState.firstTryCorrect).length;
  const firstTryAccuracy = instances.length ? firstTryCorrectCount / instances.length : 0;

  const previous = db
    .prepare(
      `SELECT elapsed_ms
       FROM practice_results
       WHERE task_id = ? AND student_name = ?
       ORDER BY cleared_at DESC
       LIMIT 1`,
    )
    .get(session.task_id, session.student_name) as { elapsed_ms: number } | undefined;

  const history = buildHistory(session.task_id, session.student_name);
  const snapshot: ResultSnapshot = {
    sessionId,
    taskId: session.task_id,
    studentName: session.student_name,
    startedAt: session.started_at,
    clearedAt: finishedAt,
    title: `${groupLabel(session.task_id)} 已完成`,
    groupLabel: TASK_LABELS[session.task_id],
    elapsedMs,
    bestMs: history.length ? Math.min(...history.map((item) => item.elapsedMs), elapsedMs) : elapsedMs,
    avgMs: average([...history.map((item) => item.elapsedMs), elapsedMs].slice(-5)),
    copy: `本次共完成 ${instances.length} 题，可查看详细结果与最近趋势。`,
    problemCount: instances.length,
    firstTryAccuracy,
    firstTryCorrectCount,
    color: TASK_COLORS[session.task_id],
    deltaVsPreviousMs: previous ? elapsedMs - previous.elapsed_ms : null,
    history: [...history, { elapsedMs, clearedAt: finishedAt }],
  };

  db.prepare(`UPDATE practice_sessions SET phase = ?, finished = 1, finished_at = ? WHERE id = ?`).run(
    "group_finished",
    finishedAt,
    sessionId,
  );
  db.prepare(
    `INSERT INTO practice_results (session_id, task_id, student_name, elapsed_ms, problem_count, first_try_accuracy, first_try_correct_count, started_at, cleared_at, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    session.task_id,
    session.student_name,
    elapsedMs,
    instances.length,
    firstTryAccuracy,
    firstTryCorrectCount,
    session.started_at,
    finishedAt,
    JSON.stringify(snapshot),
  );

  return { sessionId, resultSnapshot: snapshot };
}
