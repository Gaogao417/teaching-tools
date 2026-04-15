import {
  ContentDefinition,
  FinishPracticeResponse,
  RuntimeActionEvent,
  RuntimeActionResponse,
  SessionPhase,
  StartPracticeResponse,
  TaskId,
} from "../../../../../shared/contracts";
import { listRuntimeInstancesBySessionId, insertRuntimeInstances, type RuntimeInstanceRow, updateRuntimeInstanceState } from "../../../repositories/instanceRepository";
import { createSession, getSessionById, type SessionRow, updateSessionProgress } from "../../../repositories/sessionRepository";
import { db } from "../../../db/database";
import { finishAndPersistResult } from "../../resultsService";
import { getTaskDefinition } from "../../tasks/catalogService";
import { resolveContentDefinition } from "./contentRegistry";
import { getEnginePlugin } from "./engineRegistry";
import { type RuntimeEngineState } from "./engineTypes";
import { appError } from "./errors";
import { toPracticeSessionSnapshot } from "./runtimeSnapshotProjector";

type RuntimeInstanceRecord = {
  row: RuntimeInstanceRow;
  content: ContentDefinition;
  engineState: RuntimeEngineState;
};

function requireRuntimeSession(sessionId: string): SessionRow {
  const session = getSessionById(sessionId);
  if (!session) throw appError("SESSION_NOT_FOUND", "Session not found", 404);
  if (session.schema_version < 2) {
    throw appError("LEGACY_SESSION_EXPIRED", "Legacy in-progress session expired after runtime-first refactor", 409);
  }
  return session;
}

function loadRuntimeInstances(sessionId: string): RuntimeInstanceRecord[] {
  return listRuntimeInstancesBySessionId(sessionId).map((row) => {
    const content = resolveContentDefinition(row.content_id, JSON.parse(row.content_json) as ContentDefinition);
    const plugin = getEnginePlugin(row.engine_kind);
    return {
      row,
      content,
      engineState: plugin.restoreState(JSON.parse(row.engine_state_json)),
    };
  });
}

const createSessionWithInstances = db.transaction((session: SessionRow, instances: RuntimeInstanceRecord[]) => {
  createSession(session);
  insertRuntimeInstances(instances.map((record) => record.row));
});

const persistProgress = db.transaction(
  (
    sessionId: string,
    nextIndex: number,
    nextPhase: SessionPhase,
    record: RuntimeInstanceRecord,
    engineState: RuntimeEngineState,
    runtime: ReturnType<ReturnType<typeof getEnginePlugin>["buildRuntime"]>,
  ) => {
    updateRuntimeInstanceState(
      record.row.id,
      JSON.stringify(runtime.instance),
      JSON.stringify(engineState),
      JSON.stringify(runtime.runtimeState),
    );
    updateSessionProgress(sessionId, nextIndex, nextPhase);
  },
);

const finishPracticeTransaction = db.transaction((session: SessionRow, instances: RuntimeInstanceRecord[]) =>
  finishAndPersistResult(session, instances),
);

export function startPractice(taskId: TaskId, studentName: string): StartPracticeResponse {
  const trimmed = studentName.trim();
  if (!trimmed) throw appError("INVALID_STUDENT_NAME", "studentName is required");

  const task = getTaskDefinition(taskId);
  const content = resolveContentDefinition(task.contentId);
  const plugin = getEnginePlugin(task.engineKind);
  const sessionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const session: SessionRow = {
    id: sessionId,
    task_id: taskId,
    student_name: trimmed,
    phase: "answering",
    current_index: 0,
    started_at: startedAt,
    finished_at: null,
    finished: 0,
    schema_version: 2,
  };

  const instances = Array.from({ length: 5 }, (_, index) => {
    const state = plugin.createState(task, content, index);
    const runtime = plugin.buildRuntime(task, content, state, "answering");
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

  createSessionWithInstances(session, instances);
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
  const reduced = plugin.reduceAction(task, activeRecord.content, activeRecord.engineState, action);

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
  persistProgress(sessionId, nextIndex, nextPhase, activeRecord, reduced.engineState, runtime);

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

export function finishPractice(sessionId: string): FinishPracticeResponse {
  const session = requireRuntimeSession(sessionId);
  const instances = loadRuntimeInstances(sessionId);
  const result = finishPracticeTransaction(session, instances);
  return {
    sessionId,
    resultSnapshot: result.resultSnapshot,
    alreadyFinished: result.alreadyFinished,
  };
}
