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
import { insertActionEvent, insertTypedActionEvent, listActionEvents } from "../../../repositories/actionEventRepository";
import { insertCapabilityEvidence, listSessionCapabilityIds } from "../../../repositories/progressionRepository";
import { finishAndPersistResult } from "../../resultsService";
import { getTaskDefinition } from "../../tasks/catalogService";
import { resolveContentDefinition } from "./contentRegistry";
import { getEnginePlugin } from "./engineRegistry";
import { type RuntimeEngineState } from "./engineTypes";
import { appError } from "./errors";
import { selectApprovedScenario } from "./scenarioSelector";
import type { ScenarioRecord } from "../../../../../shared/scenarios";
import { toPracticeSessionSnapshot } from "./runtimeSnapshotProjector";
import {
  CAPABILITY_RULE_VERSION,
  CAPABILITY_MASTERY_RULE,
  challengeById,
  REMEDIATION_TASK_BY_CAPABILITY,
  type RemediationDiagnosis,
  type SessionKind,
  type SimilarityCapabilityId,
} from "../../../../../shared/similarityLearningMap";
import type { TopicPracticeTaskId } from "../../../../../shared/topicPractice";
import type { TopicPracticeEngineState } from "../engines/topicPractice/types";
import type {
  ActionCheckpointRequest,
  ActionCheckpointResponse,
  ActionEvaluationRequest,
  ActionEvaluationResponse,
  ActionEvidence,
  ActionPlanResponse,
  CoachRequest,
  CoachResponse,
} from "../../../../../shared/actionRuntime";
import {
  getActionCheckpoint,
  getCachedActionEvaluation,
  getCommittedActionWorld,
  saveActionCheckpoint,
  saveActionEvaluation,
  saveCommittedActionWorld,
} from "../../../repositories/actionRuntimeRepository";
import { buildTopicExercisePlan } from "../../actionRuntime/topicPlanProjector";
import { currentScenario, runtimeStepEntries } from "../engines/topicPractice";
import { evaluateTopicEvidence } from "../../actionRuntime/topicTypedEvaluator";
import { applyDomainCommands } from "../../../../../shared/actionWorld";

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
    let pinnedScenario: ScenarioRecord | undefined;
    if (row.scenario_json) {
      try {
        pinnedScenario = JSON.parse(row.scenario_json) as ScenarioRecord;
      } catch {
        throw appError("RUNTIME_CONTRACT_INVALID", `Stored scenario snapshot is invalid for instance ${row.id}`, 500);
      }
    }
    return {
      row,
      content,
      engineState: plugin.restoreState(JSON.parse(row.engine_state_json), pinnedScenario),
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
    isIndependentCorrect: boolean,
  ) => {
    updateRuntimeInstanceState(
      record.row.id,
      JSON.stringify(runtime.instance),
      JSON.stringify(engineState),
      JSON.stringify(runtime.runtimeState),
    );
    updateSessionProgress(sessionId, nextIndex, nextPhase);
    insertActionEvent(sessionId, record.row.id, action, evaluation, capabilityIds);
    if (isIndependentCorrect && action.stepId && CAPABILITY_MASTERY_RULE.allowedSessionKinds.includes(session.session_kind)) {
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
  remediationCapabilityId?: SimilarityCapabilityId;
  preservedCompletedStepIds?: string[];
  allowedCapabilityIds?: SimilarityCapabilityId[];
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
    action_runtime_version: task.engineKind === "topic-practice" && process.env.ACTION_RUNTIME_V2 !== "false" ? 2 : 1,
    session_kind: options.sessionKind || "practice",
    challenge_id: options.challengeId || null,
    source_session_id: options.sourceSessionId || null,
    source_instance_id: options.sourceInstanceId || null,
    source_step_id: options.sourceStepId || null,
    return_mode: options.returnMode || null,
    preserved_completed_step_ids_json: options.preservedCompletedStepIds
      ? JSON.stringify(options.preservedCompletedStepIds)
      : null,
  };

  const instances = Array.from({ length: options.instanceCount || 5 }, (_, index) => {
    const scenario = selectApprovedScenario(task, content, index);
    const state = plugin.createState(task, content, index, scenario);
    if (options.remediationCapabilityId && task.engineKind === "topic-practice") {
      (state as TopicPracticeEngineState).remediationCapabilityId = options.remediationCapabilityId;
    }
    if (options.allowedCapabilityIds?.length && task.engineKind === "topic-practice") {
      (state as TopicPracticeEngineState).allowedCapabilityIds = options.allowedCapabilityIds;
    }
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
        scenario_id: scenario.id,
        scenario_version: scenario.version,
        scenario_json: JSON.stringify(scenario),
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
    allowedCapabilityIds: challenge.requiredCapabilityIds,
  });
}

export function restorePractice(sessionId: string) {
  const session = requireRuntimeSession(sessionId);
  return toPracticeSessionSnapshot(session, loadRuntimeInstances(sessionId));
}

function activeTopicRecord(session: SessionRow): RuntimeInstanceRecord & { engineState: TopicPracticeEngineState } {
  const records = loadRuntimeInstances(session.id);
  const activeRecord = records[session.current_index];
  if (!activeRecord) throw appError("INSTANCE_NOT_ACTIVE", "Current instance is not active", 409);
  if (activeRecord.row.engine_kind !== "topic-practice") {
    throw appError("ACTION_NOT_ALLOWED", "Action Runtime v2 is currently available for topic practice", 409);
  }
  return activeRecord as RuntimeInstanceRecord & { engineState: TopicPracticeEngineState };
}

export function getActionRuntimePlan(sessionId: string): ActionPlanResponse {
  const session = requireRuntimeSession(sessionId);
  if (session.action_runtime_version !== 2) throw appError("ACTION_NOT_ALLOWED", "Session is pinned to Action Runtime v1", 409);
  const activeRecord = activeTopicRecord(session);
  const checkpoint = getActionCheckpoint(sessionId, activeRecord.row.id);
  const usableCheckpoint = checkpoint?.revision === activeRecord.engineState.attempts ? checkpoint : undefined;
  const plan = buildTopicExercisePlan(activeRecord.engineState, session.session_kind, usableCheckpoint?.current_action_id);
  const activeSourceStepId = plan.actions.find((action) => action.actionId === plan.currentActionId)?.sourceStepId;
  const storedWorld = getCommittedActionWorld(sessionId, activeRecord.row.id);
  if (storedWorld && storedWorld.sourceStepId === activeSourceStepId) plan.world = storedWorld.world;
  return {
    sessionId,
    plan,
    ...(usableCheckpoint ? {
      checkpoint: {
        currentActionId: usableCheckpoint.current_action_id,
        completedActionIds: JSON.parse(usableCheckpoint.completed_action_ids_json) as string[],
        evidence: JSON.parse(usableCheckpoint.evidence_json) as ActionEvidence[],
        currentDraft: usableCheckpoint.draft_json
          ? JSON.parse(usableCheckpoint.draft_json) as NonNullable<ActionCheckpointRequest["currentDraft"]>
          : undefined,
        revision: usableCheckpoint.revision,
        updatedAt: usableCheckpoint.updated_at,
      },
    } : {}),
  };
}

export function checkpointActionRuntime(request: ActionCheckpointRequest): ActionCheckpointResponse {
  const session = requireRuntimeSession(request.sessionId);
  const activeRecord = activeTopicRecord(session);
  if (activeRecord.row.id !== request.exerciseId) throw appError("INSTANCE_NOT_ACTIVE", "Exercise is not active", 409);
  if (request.revision !== activeRecord.engineState.attempts) throw appError("ACTION_NOT_ALLOWED", "Action plan revision is stale", 409);
  const plan = buildTopicExercisePlan(activeRecord.engineState, session.session_kind);
  const planActionIds = new Set(plan.actions.map((action) => action.actionId));
  const activeSourceStepId = plan.actions.find((action) => action.actionId === plan.currentActionId)?.sourceStepId;
  const checkpointAction = plan.actions.find((action) => action.actionId === request.currentActionId);
  if (!planActionIds.has(request.currentActionId)
    || checkpointAction?.sourceStepId !== activeSourceStepId
    || request.completedActionIds.some((actionId) => !planActionIds.has(actionId))
    || request.evidence.some((evidence) => !planActionIds.has(evidence.actionId)
      || evidence.sourceStepId !== activeSourceStepId)) {
    throw appError("ANSWER_INVALID", "Checkpoint contains unknown action data", 400);
  }
  const updatedAt = saveActionCheckpoint(request);
  return { accepted: true, revision: request.revision, updatedAt };
}

function performActionEvaluation(request: ActionEvaluationRequest): ActionEvaluationResponse {
  const cached = getCachedActionEvaluation(request.sessionId, request.idempotencyKey);
  if (cached) {
    if (JSON.stringify(cached.request) !== JSON.stringify(request)) {
      throw appError("ANSWER_INVALID", "Idempotency key was already used for another request", 409);
    }
    return cached.response;
  }

  const session = requireRuntimeSession(request.sessionId);
  if (session.action_runtime_version !== 2) throw appError("ACTION_NOT_ALLOWED", "Session is pinned to Action Runtime v1", 409);
  const activeRecord = activeTopicRecord(session);
  if (activeRecord.row.id !== request.exerciseId) throw appError("INSTANCE_NOT_ACTIVE", "Exercise is not active", 409);
  const currentStep = runtimeStepEntries(activeRecord.engineState)[activeRecord.engineState.stepIndex]?.step;
  if (!currentStep || currentStep.id !== request.sourceStepId) {
    throw appError("ACTION_NOT_ALLOWED", `Step ${request.sourceStepId} is not active`, 409);
  }
  if (request.revision !== activeRecord.engineState.attempts) {
    return {
      outcome: "conflict",
      evaluation: "progress",
      revision: activeRecord.engineState.attempts,
      plan: buildTopicExercisePlan(activeRecord.engineState, session.session_kind),
      phase: session.phase,
      nextIndex: session.current_index,
    };
  }

  const expectedActionIds = new Set(
    buildTopicExercisePlan(activeRecord.engineState, session.session_kind).actions
      .filter((action) => action.sourceStepId === currentStep.id)
      .map((action) => action.actionId),
  );
  if (request.evidence.length !== expectedActionIds.size
    || request.evidence.some((item) => !expectedActionIds.has(item.actionId))) {
    throw appError("ANSWER_INVALID", "Evidence does not exactly cover the active action group", 400);
  }

  const scenario = currentScenario(activeRecord.engineState);
  const templates = (scenario.actionTemplates || []).filter((template) => template.sourceStepId === currentStep.id);
  const diagnosis = evaluateTopicEvidence(templates, request.evidence);
  const state = JSON.parse(JSON.stringify(activeRecord.engineState)) as TopicPracticeEngineState;
  state.attempts += 1;
  state.wrongObjectIds = diagnosis.wrongObjectIds;

  let evaluation: ActionEvaluationResponse["evaluation"];
  let nextIndex = session.current_index;
  let phase: ActionEvaluationResponse["phase"];
  if (!diagnosis.accepted) {
    state.status = "wrong";
    state.hadWrongAttempt = true;
    evaluation = "wrong";
    phase = "wrong_feedback";
  } else {
    if (!state.completedStepIds.includes(currentStep.id)) state.completedStepIds.push(currentStep.id);
    state.wrongObjectIds = [];
    const finalStep = state.stepIndex === runtimeStepEntries(state).length - 1;
    if (finalStep) {
      state.status = "correct";
      state.firstTryCorrect = !state.hadWrongAttempt;
      evaluation = "correct";
      phase = session.current_index >= loadRuntimeInstances(request.sessionId).length - 1 ? "group_finished" : "correct_pause";
      if (phase === "correct_pause") nextIndex += 1;
    } else {
      state.status = "pending";
      state.stepIndex += 1;
      evaluation = "progress";
      phase = "answering";
    }
  }

  const currentPlan = buildTopicExercisePlan(activeRecord.engineState, session.session_kind);
  const storedWorld = getCommittedActionWorld(request.sessionId, request.exerciseId);
  const baseWorld = storedWorld?.sourceStepId === currentStep.id ? storedWorld.world : currentPlan.world;
  const acceptedWorld = diagnosis.accepted
    ? { ...applyDomainCommands(baseWorld, diagnosis.commands), revision: state.attempts }
    : undefined;
  if (acceptedWorld) saveCommittedActionWorld(request.sessionId, request.exerciseId, currentStep.id, state.attempts, acceptedWorld);

  const runtimeState = JSON.parse(activeRecord.row.runtime_state_json) as Record<string, unknown>;
  updateRuntimeInstanceState(
    activeRecord.row.id,
    activeRecord.row.instance_json,
    JSON.stringify(state),
    JSON.stringify({ ...runtimeState, attempts: state.attempts, status: state.status, currentStepId: currentStep.id, wrongObjectIds: state.wrongObjectIds }),
  );
  updateSessionProgress(request.sessionId, nextIndex, phase === "correct_pause" ? "answering" : phase);

  const capabilityIds = templates.flatMap((template) => template.capabilities)
    .filter((capability): capability is SimilarityCapabilityId => capability.startsWith("similarity."));
  insertTypedActionEvent(request.sessionId, request.exerciseId, currentStep.id, evaluation, capabilityIds);
  const hadPriorWrong = listActionEvents(request.sessionId).some((event) => event.instance_id === request.exerciseId
    && event.step_id === currentStep.id && event.evaluation === "wrong");
  if (diagnosis.accepted && !hadPriorWrong && CAPABILITY_MASTERY_RULE.allowedSessionKinds.includes(session.session_kind)) {
    for (const capabilityId of capabilityIds) insertCapabilityEvidence({
      studentName: session.student_name, capabilityId, sessionId: request.sessionId, instanceId: request.exerciseId,
      stepId: currentStep.id, taskId: activeRecord.row.task_id, sessionKind: session.session_kind, ruleVersion: CAPABILITY_RULE_VERSION,
    });
  }

  const nextPlan = buildTopicExercisePlan(state, session.session_kind);
  const response: ActionEvaluationResponse = {
    outcome: diagnosis.accepted ? "accepted" : "rejected",
    evaluation,
    revision: state.attempts,
    ...(!diagnosis.accepted ? {
      diagnosis: {
        messageLatex: currentStep.errorDiagnosis,
        wrongObjectIds: diagnosis.wrongObjectIds,
        wrongActionIds: diagnosis.wrongActionIds,
        wrongSlotIds: diagnosis.wrongSlotIds,
        focusTargetId: diagnosis.wrongSlotIds[0] || diagnosis.wrongObjectIds[0],
      },
    } : {}),
    nextActionId: evaluation === "progress" ? nextPlan.currentActionId : undefined,
    phase,
    nextIndex,
    ...(acceptedWorld ? { committedWorld: evaluation === "progress" ? nextPlan.world : acceptedWorld } : {}),
  };
  saveActionEvaluation(request, response);
  return response;
}

export function submitActionEvaluation(request: ActionEvaluationRequest): ActionEvaluationResponse {
  return db.transaction(performActionEvaluation)(request);
}

export function askActionRuntimeCoach(request: CoachRequest): CoachResponse {
  const session = requireRuntimeSession(request.sessionId);
  const activeRecord = activeTopicRecord(session);
  if (activeRecord.row.id !== request.exerciseId) throw appError("INSTANCE_NOT_ACTIVE", "Exercise is not active", 409);
  if (request.trace.revision !== activeRecord.engineState.attempts) throw appError("ACTION_NOT_ALLOWED", "Student trace revision is stale", 409);
  const plan = buildTopicExercisePlan(activeRecord.engineState, session.session_kind);
  const action = plan.actions.find((candidate) => candidate.actionId === request.trace.currentActionId);
  if (!action) throw appError("ACTION_NOT_ALLOWED", "Student trace action is not active", 409);
  const selected = request.trace.selectedObjectIds.at(-1);
  const coach = action.coach;
  const explicit = request.studentMessage?.trim();
  const messageLatex = explicit
    ? `${explicit}——先只完成当前动作：${action.instruction}`
    : request.trace.wrongAttempts >= 2
      ? coach?.objectCategoryHintLatex || coach?.invalidObjectLatex || `先检查当前选择的对象类型，再完成：${action.instruction}`
      : coach?.entryLatex || `当前只做这一件事：${action.instruction}`;
  const requestedCommand = explicit && plan.mode !== "assessment"
    ? ([
        { pattern: /清空|重来/, type: "clear" as const },
        { pattern: /撤销|退回/, type: "back" as const },
      ].find((candidate) => candidate.pattern.test(explicit)))
    : undefined;
  const agentCommand = requestedCommand && action.capabilities.includes(`agent:${requestedCommand.type}`)
    ? { commandId: crypto.randomUUID(), actionId: action.actionId, type: requestedCommand.type }
    : undefined;
  return {
    directive: {
      directiveId: crypto.randomUUID(),
      messageLatex,
      tone: request.trace.wrongAttempts ? "wrong" : "prompt",
      highlightObjectIds: selected ? [selected] : [],
      focusTargetId: request.trace.wrongAttempts ? selected : undefined,
      suggestedActionId: action.actionId,
      ...(agentCommand ? { agentCommand } : {}),
    },
  };
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
  const activeContract = action.stepId ? contracts?.[action.stepId] : undefined;
  const capabilityIds = activeContract?.presentation?.capabilityIds || [];
  const hadPriorWrong = action.stepId
    ? listActionEvents(sessionId).some((event) => event.instance_id === activeRecord.row.id
      && event.step_id === action.stepId && event.evaluation === "wrong")
    : false;
  const isIndependentCorrect = action.type === "submit" && reduced.evaluation !== "wrong" && !hadPriorWrong;

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
  persistProgress(sessionId, nextIndex, persistedPhase, activeRecord, reduced.engineState, runtime, action, reduced.evaluation, capabilityIds, session, isIndependentCorrect);

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
  const challenge = session.challenge_id ? challengeById(session.challenge_id) : undefined;
  if (!challenge) throw appError("TASK_NOT_FOUND", "Challenge definition not found", 404);
  const targetCapabilities = new Set(challenge.requiredCapabilityIds);
  const events = listActionEvents(sessionId).filter((event) => event.evaluation === "wrong" && event.step_id);
  const candidates = new Map<SimilarityCapabilityId, { count: number; firstIndex: number; event: typeof events[number] }>();
  events.forEach((event, eventIndex) => {
    let capabilityIds: SimilarityCapabilityId[] = [];
    if (event.capability_ids_json) {
      try {
        capabilityIds = JSON.parse(event.capability_ids_json) as SimilarityCapabilityId[];
      } catch {
        capabilityIds = [];
      }
    }
    if (!capabilityIds.length && event.capability_id) capabilityIds = [event.capability_id];
    for (const capabilityId of capabilityIds.filter((item) => targetCapabilities.has(item))) {
      const current = candidates.get(capabilityId);
      candidates.set(capabilityId, current
        ? { ...current, count: current.count + 1 }
        : { count: 1, firstIndex: eventIndex, event });
    }
  });
  const selected = [...candidates.entries()].sort((left, right) =>
    left[1].firstIndex - right[1].firstIndex || right[1].count - left[1].count)[0];
  const capabilityId = selected?.[0];
  const event = selected?.[1].event;
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
  const sourceState = active?.engineState as Partial<TopicPracticeEngineState> | undefined;
  const sourceRuntime = active
    ? getEnginePlugin(active.row.engine_kind).buildRuntime(
        getTaskDefinition(active.row.task_id),
        active.content,
        active.engineState,
        challengeSession.phase,
      )
    : undefined;
  const canResumeStep = sourceRuntime?.runtimeState.currentStepId === diagnosis.focusStepId;
  const preservedCompletedStepIds = canResumeStep ? sourceState?.completedStepIds || [] : [];
  const taskId: TopicPracticeTaskId = REMEDIATION_TASK_BY_CAPABILITY[diagnosis.capabilityId];
  return startSession(taskId, challengeSession.student_name, {
    sessionKind: "remediation",
    instanceCount: 3,
    sourceSessionId: challengeSessionId,
    sourceInstanceId: active?.row.id,
    sourceStepId: diagnosis.focusStepId,
    returnMode: canResumeStep ? "resume-step" : "restart-instance",
    preservedCompletedStepIds,
    remediationCapabilityId: diagnosis.capabilityId,
  });
}
