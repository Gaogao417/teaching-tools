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
import { insertActionEvent, listActionEvents } from "../../../repositories/actionEventRepository";
import { insertCapabilityEvidence, listSessionCapabilityIds } from "../../../repositories/progressionRepository";
import { finishAndPersistResult } from "../../resultsService";
import { getTaskDefinition } from "../../tasks/catalogService";
import { resolveContentDefinition } from "./contentRegistry";
import { getEnginePlugin } from "./engineRegistry";
import { type RuntimeEngineState } from "./engineTypes";
import { appError } from "./errors";
import { toPracticeSessionSnapshot } from "./runtimeSnapshotProjector";
import {
  CAPABILITY_RULE_VERSION,
  capabilityIdsForTopicStep,
  challengeById,
  REMEDIATION_TASK_BY_CAPABILITY,
  type RemediationDiagnosis,
  type SessionKind,
  type SimilarityCapabilityId,
} from "../../../../../shared/similarityLearningMap";
import type { TopicActionContract, TopicPracticeTaskId } from "../../../../../shared/topicPractice";

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
    action: RuntimeActionEvent,
    evaluation: RuntimeActionResponse["evaluation"],
    capabilityIds: SimilarityCapabilityId[],
    session: SessionRow,
  ) => {
    updateRuntimeInstanceState(
      record.row.id,
      JSON.stringify(runtime.instance),
      JSON.stringify(engineState),
      JSON.stringify(runtime.runtimeState),
    );
    updateSessionProgress(sessionId, nextIndex, nextPhase);
    insertActionEvent(sessionId, record.row.id, action, evaluation, capabilityIds[0]);
    if (action.type === "submit" && evaluation !== "wrong" && action.stepId) {
      for (const capabilityId of capabilityIds) {
        insertCapabilityEvidence({
          studentName: session.student_name,
          capabilityId,
          sessionId,
          instanceId: record.row.id,
          stepId: action.stepId,
          taskId: record.row.task_id,
          sessionKind: session.session_kind,
          ruleVersion: CAPABILITY_RULE_VERSION,
        });
      }
    }
  },
);

const finishPracticeTransaction = db.transaction((session: SessionRow, instances: RuntimeInstanceRecord[]) =>
  finishAndPersistResult(session, instances),
);

type StartSessionOptions = {
  sessionKind?: SessionKind;
  instanceCount?: number;
  challengeId?: string;
  sourceSessionId?: string;
  sourceInstanceId?: string;
  sourceStepId?: string;
  returnMode?: "resume-step" | "restart-instance";
};

function startSession(taskId: TaskId, studentName: string, options: StartSessionOptions = {}): StartPracticeResponse {
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
    session_kind: options.sessionKind || "practice",
    challenge_id: options.challengeId || null,
    source_session_id: options.sourceSessionId || null,
    source_instance_id: options.sourceInstanceId || null,
    source_step_id: options.sourceStepId || null,
    return_mode: options.returnMode || null,
  };

  const instances = Array.from({ length: options.instanceCount || 5 }, (_, index) => {
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

export function startPractice(taskId: TaskId, studentName: string): StartPracticeResponse {
  return startSession(taskId, studentName);
}

export function startChallenge(challengeId: string, studentName: string): StartPracticeResponse {
  const challenge = challengeById(challengeId);
  if (!challenge) throw appError("TASK_NOT_FOUND", "Challenge not found", 404);
  return startSession(challenge.sourceTaskId, studentName, {
    sessionKind: "challenge",
    instanceCount: 2,
    challengeId,
  });
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

  const beforeRuntime = plugin.buildRuntime(task, activeRecord.content, activeRecord.engineState, session.phase);
  const contracts = beforeRuntime.instance.scene.topicWorkspace?.contracts;
  const orderedContracts = contracts ? Object.values(contracts) : [];
  const activeContract = action.stepId ? contracts?.[action.stepId] : undefined;
  const stepIndex = activeContract ? orderedContracts.findIndex((contract) => contract.id === activeContract.id) : -1;
  const capabilityIds = activeContract && stepIndex >= 0
    ? capabilityIdsForTopicStep(activeRecord.row.task_id, (activeContract as TopicActionContract).primitive, stepIndex)
    : [];

  let nextIndex = session.current_index;
  let nextPhase = reduced.phase;
  let persistedPhase = reduced.phase;

  if (reduced.phase === "correct_pause") {
    if (session.current_index >= records.length - 1) {
      nextPhase = "group_finished";
      persistedPhase = "group_finished";
    } else {
      nextIndex = session.current_index + 1;
      persistedPhase = "answering";
    }
  }

  const runtime = plugin.buildRuntime(task, activeRecord.content, reduced.engineState, nextPhase);
  persistProgress(sessionId, nextIndex, persistedPhase, activeRecord, reduced.engineState, runtime, action, reduced.evaluation, capabilityIds, session);

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
  if (session.session_kind === "challenge" && session.challenge_id) {
    if (session.phase !== "group_finished") {
      throw appError("ANSWER_INVALID", "Challenge must complete every instance before it can pass", 409);
    }
    const challenge = challengeById(session.challenge_id);
    const observed = new Set(listSessionCapabilityIds(sessionId));
    const missing = challenge?.requiredCapabilityIds.filter((capabilityId) => !observed.has(capabilityId)) || [];
    if (missing.length) {
      throw appError("ANSWER_INVALID", `Challenge is missing required process evidence: ${missing.join(", ")}`, 409);
    }
  }
  const instances = loadRuntimeInstances(sessionId);
  const result = finishPracticeTransaction(session, instances);
  return {
    sessionId,
    resultSnapshot: result.resultSnapshot,
    alreadyFinished: result.alreadyFinished,
  };
}

const DIAGNOSIS_COPY: Record<SimilarityCapabilityId, { title: string; coachingCopy: string }> = {
  "similarity.mark-known-segments": { title: "已知量还没有落到正确线段", coachingCopy: "先把题干里的每个数字贴回对应线段，再继续建立比例。" },
  "similarity.map-corresponding-sides": { title: "对应边方向没有对齐", coachingCopy: "沿相同顶点顺序配成一组对应边，再写比例。" },
  "similarity.transfer-ratio-shares": { title: "共同边的份数没有迁移", coachingCopy: "保留第一组相似的共同边份数，只补第二组中新出现的边。" },
  "similarity.construct-parallel-helper": { title: "辅助线构造没有完成", coachingCopy: "先确定过线点，再选平行参照边和两个外点。" },
  "similarity.convert-collinear-segments": { title: "共线整段与分段没有互化", coachingCopy: "先写出整段等于两个分段之和，再代入已知长度。" },
  "similarity.read-crossed-vertex-order": { title: "交叉构型的点序读反了", coachingCopy: "从交点出发，按同一转向读取两组三角形的对应顶点。" },
  "similarity.build-side-equation": { title: "按份数列式的三个位置没有对齐", coachingCopy: "固定使用：未知边 = 已知边 × 未知份数 ÷ 已知份数。" },
};

export function getChallengeDiagnosis(sessionId: string): RemediationDiagnosis {
  const session = requireRuntimeSession(sessionId);
  if (session.session_kind !== "challenge") throw appError("BAD_REQUEST", "Session is not a challenge", 400);
  const events = listActionEvents(sessionId).filter((event) => event.evaluation === "wrong" && event.capability_id);
  const counts = new Map<SimilarityCapabilityId, number>();
  for (const item of events) {
    if (item.capability_id) counts.set(item.capability_id, (counts.get(item.capability_id) || 0) + 1);
  }
  const capability = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  const event = events.find((item) => item.capability_id === capability);
  const capabilityId = event?.capability_id;
  if (!event || !capabilityId || !event.step_id) throw appError("ANSWER_INVALID", "No actionable challenge diagnosis is available", 409);
  const copy = DIAGNOSIS_COPY[capabilityId];
  return {
    diagnosisCode: `${capabilityId}.incorrect`,
    capabilityId,
    title: copy.title,
    coachingCopy: copy.coachingCopy,
    focusStepId: event.step_id,
    sourceChallengeSessionId: sessionId,
    recommendedRemediationId: `remediation:${capabilityId}`,
  };
}

export function startRemediation(challengeSessionId: string): StartPracticeResponse {
  const challengeSession = requireRuntimeSession(challengeSessionId);
  const diagnosis = getChallengeDiagnosis(challengeSessionId);
  const records = loadRuntimeInstances(challengeSessionId);
  const active = records[challengeSession.current_index];
  const taskId: TopicPracticeTaskId = REMEDIATION_TASK_BY_CAPABILITY[diagnosis.capabilityId];
  return startSession(taskId, challengeSession.student_name, {
    sessionKind: "remediation",
    instanceCount: 3,
    sourceSessionId: challengeSessionId,
    sourceInstanceId: active?.row.id,
    sourceStepId: diagnosis.focusStepId,
    returnMode: "resume-step",
  });
}
