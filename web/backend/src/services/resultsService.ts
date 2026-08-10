import type { ContentDefinition, ExerciseEngineKind, ExerciseInstance, ResultAttemptReview, ResultSnapshot, TaskHistoryItem, TaskId } from "../../../shared/contracts";
import { TASK_COLORS } from "../../../shared/tasks";
import { getPreviousElapsedMs, getResultSnapshot, insertResultSnapshot, listResultHistory, listTaskHistory } from "../repositories/resultRepository";
import { listChildSessionIds, markSessionFinished } from "../repositories/sessionRepository";
import { appError } from "./runtime/platform/errors";
import { getTaskDefinition } from "./tasks/catalogService";
import { listActionEvents } from "../repositories/actionEventRepository";
import { getEnginePlugin } from "./runtime/platform/engineRegistry";
import type { RuntimeEngineState } from "./runtime/platform/engineTypes";
import type { SessionKind } from "../../../shared/similarityLearningMap";
import { listActionEvaluations } from "../repositories/actionRuntimeRepository";

type ResultSessionRecord = {
  id: string;
  task_id: TaskId;
  student_name: string;
  started_at: string;
  session_kind: SessionKind;
  challenge_id: string | null;
  source_session_id: string | null;
};

type ResultInstanceRecord = {
  row: {
    id: string;
    instance_index: number;
    instance_json: string;
    engine_kind: ExerciseEngineKind;
  };
  content: ContentDefinition;
  engineState: RuntimeEngineState;
};

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getResult(sessionId: string): ResultSnapshot {
  const result = getResultSnapshot(sessionId);

  if (!result) {
    throw appError("SESSION_NOT_FOUND", "Result not found", 404);
  }

  return result;
}

export function getTaskHistory(taskId: TaskId, studentName: string, limit = 5): TaskHistoryItem[] {
  return listTaskHistory(taskId, studentName, limit);
}

export function finishAndPersistResult(
  session: ResultSessionRecord,
  instances: ResultInstanceRecord[],
): { resultSnapshot: ResultSnapshot; alreadyFinished?: boolean } {
  const existing = getResultSnapshot(session.id);
  if (existing) {
    return {
      resultSnapshot: existing,
      alreadyFinished: true,
    };
  }

  const finishedAt = new Date().toISOString();
  const elapsedMs = Math.max(0, Date.parse(finishedAt) - Date.parse(session.started_at));
  const firstTryCorrectCount = instances.filter((record) => record.engineState.firstTryCorrect).length;
  const firstTryAccuracy = instances.length ? firstTryCorrectCount / instances.length : 0;

  const previousElapsedMs = getPreviousElapsedMs(session.task_id, session.student_name);
  const history = listResultHistory(session.task_id, session.student_name);
  const task = getTaskDefinition(session.task_id);
  const actionEvents = listActionEvents(session.id);
  const typedEvaluations = listActionEvaluations(session.id);
  const problemReviews = instances.map((record) => {
    const instance = JSON.parse(record.row.instance_json) as ExerciseInstance;
    const attemptLog: ResultAttemptReview[] = actionEvents
      .filter((event) => event.instance_id === record.row.id)
      .map((event) => {
        const typedEvidence = typedEvaluations.find((evaluation) => evaluation.instanceId === record.row.id
          && evaluation.request.sourceStepId === event.step_id
          && evaluation.response.evaluation === event.evaluation)?.request.evidence;
        return {
          actionType: event.action_type,
          stepId: event.step_id ?? undefined,
          stepTitle: instance.flow.steps.find((step) => step.id === event.step_id)?.title,
          targetId: event.target_id ?? undefined,
          submittedValue: typedEvidence ? undefined : event.submitted_value ?? undefined,
          typedEvidence,
          evaluation: event.evaluation,
          createdAt: event.created_at,
        };
      });
    const projection = getEnginePlugin(record.row.engine_kind).buildProblemReviewProjection(
      task,
      record.content,
      record.engineState,
      instance,
      attemptLog,
    );
    const typedSubmissions = attemptLog.filter((attempt) => attempt.typedEvidence?.length);
    const typedWrong = typedSubmissions.find((attempt) => attempt.evaluation === "wrong");
    const typedRepresentative = typedWrong || typedSubmissions[typedSubmissions.length - 1];
    return {
      instanceId: record.row.id,
      index: record.row.instance_index,
      prompt: instance.prompt,
      attempts: record.engineState.attempts,
      firstTryCorrect: Boolean(record.engineState.firstTryCorrect),
      attemptLog,
      ...projection,
      ...(typedRepresentative?.typedEvidence ? {
        actualAnswer: {
          display: typedRepresentative.typedEvidence.map((evidence) => Object.entries(evidence)
            .filter(([key]) => !["actionId", "sourceStepId", "kind", "version"].includes(key))
            .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : typeof value === "object" ? JSON.stringify(value) : String(value)}`)
            .join("；"))
            .join("；"),
        },
      } : {}),
    };
  });
  const snapshot: ResultSnapshot = {
    sessionId: session.id,
    taskId: session.task_id,
    studentName: session.student_name,
    startedAt: session.started_at,
    clearedAt: finishedAt,
    title: `${task.title} \u5df2\u5b8c\u6210`,
    groupLabel: task.catalogMeta.chapterName,
    elapsedMs,
    bestMs: history.length ? Math.min(...history.map((item) => item.elapsedMs), elapsedMs) : elapsedMs,
    avgMs: average([...history.map((item) => item.elapsedMs), elapsedMs].slice(-5)),
    copy: `\u672c\u6b21\u5171\u5b8c\u6210 ${instances.length} \u9898\uff0c\u53ef\u67e5\u770b\u8be6\u7ec6\u7ed3\u679c\u4e0e\u6700\u8fd1\u8d8b\u52bf\u3002`,
    problemCount: instances.length,
    firstTryAccuracy,
    firstTryCorrectCount,
    color: TASK_COLORS[session.task_id],
    deltaVsPreviousMs: previousElapsedMs === null ? null : elapsedMs - previousElapsedMs,
    history: [...history, { elapsedMs, clearedAt: finishedAt }],
    problemReviews,
    sessionKind: session.session_kind,
    challengeId: session.challenge_id ?? undefined,
    sourceSessionId: session.source_session_id ?? undefined,
    linkedSessionIds: listChildSessionIds(session.id),
  };

  insertResultSnapshot({
    sessionId: session.id,
    taskId: session.task_id,
    studentName: session.student_name,
    elapsedMs,
    problemCount: instances.length,
    firstTryAccuracy,
    firstTryCorrectCount,
    startedAt: session.started_at,
    clearedAt: finishedAt,
    snapshot,
  });
  markSessionFinished(session.id, finishedAt);

  return { resultSnapshot: snapshot };
}
