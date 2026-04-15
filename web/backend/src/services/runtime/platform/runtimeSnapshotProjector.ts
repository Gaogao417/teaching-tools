import { ContentDefinition, ExerciseEngineKind, PracticeSessionSnapshot, SessionPhase, TaskId } from "../../../../../shared/contracts";
import { getTaskDefinition } from "../../tasks/catalogService";
import { getEnginePlugin } from "./engineRegistry";
import { type RuntimeEngineState } from "./engineTypes";

type SessionProjectionRow = {
  id: string;
  task_id: TaskId;
  student_name: string;
  phase: SessionPhase;
  current_index: number;
  started_at: string;
  finished_at: string | null;
};

type RuntimeInstanceProjectionRecord = {
  row: {
    id: string;
    task_id: TaskId;
    engine_kind: ExerciseEngineKind;
    instance_index: number;
  };
  content: ContentDefinition;
  engineState: RuntimeEngineState;
};

function activeRuntime(session: SessionProjectionRow, record: RuntimeInstanceProjectionRecord) {
  const task = getTaskDefinition(record.row.task_id);
  const plugin = getEnginePlugin(record.row.engine_kind);
  return plugin.buildRuntime(task, record.content, record.engineState, session.phase);
}

export function projectedPhaseForIndex(
  session: SessionProjectionRow,
  record: RuntimeInstanceProjectionRecord,
): SessionPhase {
  if (record.row.instance_index === session.current_index) return session.phase;
  return record.engineState.status === "correct" ? "correct_pause" : "answering";
}

export function toPracticeSessionSnapshot(
  session: SessionProjectionRow,
  instances: RuntimeInstanceProjectionRecord[],
): PracticeSessionSnapshot {
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
  };
}
