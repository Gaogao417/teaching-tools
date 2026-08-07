import type { TaskId } from "../../../shared/contracts";
import {
  CAPABILITY_LABELS,
  CAPABILITY_MASTERY_RULE,
  CAPABILITY_RULE_VERSION,
  SIMILARITY_CAPABILITY_IDS,
  SIMILARITY_CHALLENGES,
  SIMILARITY_MAP_EDGES,
  SIMILARITY_MAP_ID,
  SIMILARITY_TOPIC_NODES,
  type LearningMapNode,
  type LearningMapResponse,
  type StudentCapabilityState,
  type StudentTopicProgress,
} from "../../../shared/similarityLearningMap";
import {
  listCapabilityEvidence,
  listCapabilityWrongCounts,
  listStudentSessions,
  listTopicProgress,
  upsertTopicProgress,
  type SavedTopicProgressRow,
  type StudentSessionProgressRow,
} from "../repositories/progressionRepository";
import { pickTopicScenario } from "./runtime/engines/topicPractice/scenarioBank";

function questionPreview(taskId: (typeof SIMILARITY_TOPIC_NODES)[number]["taskId"], title: string) {
  const scenario = pickTopicScenario(taskId, 0);
  return {
    questionId: scenario.id,
    stemLatex: scenario.promptLatex,
    diagramAssetUrl: scenario.promptDiagramAsset,
    diagramAlt: scenario.promptDiagramAsset ? `${title}代表题题图` : undefined,
  };
}

function capabilityStates(studentName: string): StudentCapabilityState[] {
  const evidence = new Map(listCapabilityEvidence(studentName, CAPABILITY_RULE_VERSION).map((row) => [row.capability_id, row]));
  const wrong = new Map(listCapabilityWrongCounts(studentName).map((row) => [row.capability_id, row]));
  return SIMILARITY_CAPABILITY_IDS.map((capabilityId) => {
    const correctRow = evidence.get(capabilityId);
    const wrongRow = wrong.get(capabilityId);
    return {
      capabilityId,
      state: correctRow && correctRow.evidence_count >= CAPABILITY_MASTERY_RULE.minimumIndependentCorrectEvidence
        ? "mastered"
        : correctRow || wrongRow
          ? "developing"
          : "unobserved",
      evidenceCount: correctRow?.evidence_count || 0,
      ruleVersion: CAPABILITY_RULE_VERSION,
      updatedAt: correctRow?.updated_at || wrongRow?.updated_at,
    };
  });
}

function latestSession(sessions: StudentSessionProgressRow[]) {
  return [...sessions].sort((left, right) => right.started_at.localeCompare(left.started_at))[0];
}

function topicProgress(studentName: string, nodeId: string, taskId: TaskId, sessions: StudentSessionProgressRow[], saved?: SavedTopicProgressRow): StudentTopicProgress {
  const relevant = sessions.filter((session) => session.task_id === taskId && session.session_kind === "practice");
  const latest = latestSession(relevant);
  const state = relevant.some((session) => session.finished) || saved?.state === "completed"
    ? "completed"
    : relevant.some((session) => !session.finished) || saved?.state === "in_progress"
      ? "in_progress"
      : "not_started";
  return {
    studentName,
    nodeId,
    state,
    lastTaskId: latest?.task_id || saved?.task_id,
    lastStepId: saved?.last_step_id || undefined,
    updatedAt: latest?.finished_at || latest?.started_at || saved?.updated_at,
  };
}

export function recordSimilarityTopicProgress(args: {
  studentName: string;
  nodeId: string;
  taskId: TaskId;
  state: "in_progress" | "completed";
  lastStepId?: string;
}) {
  upsertTopicProgress(args);
}

export function getSimilarityLearningMap(studentName: string): LearningMapResponse {
  const capabilities = capabilityStates(studentName);
  const mastered = new Set(capabilities.filter((item) => item.state === "mastered").map((item) => item.capabilityId));
  const sessions = listStudentSessions(studentName);
  const savedProgress = listTopicProgress(studentName);
  const savedByNode = new Map(savedProgress.map((item) => [item.node_id, item]));
  const progresses = new Map(SIMILARITY_TOPIC_NODES.map((node) => [
    node.id,
    topicProgress(studentName, node.id, node.taskId, sessions, savedByNode.get(node.id)),
  ]));

  const topicNodes: LearningMapNode[] = SIMILARITY_TOPIC_NODES.map((definition) => {
    const progress = progresses.get(definition.id)!;
    const missingPrerequisiteIds = definition.requiredCapabilityIds.filter((capabilityId) => !mastered.has(capabilityId));
    const state = missingPrerequisiteIds.length
      ? "unopened"
      : progress.state === "completed" && mastered.has(definition.primaryCapabilityId)
        ? "passed"
        : "open";
    const active = latestSession(sessions.filter((session) => session.task_id === definition.taskId && !session.finished && session.session_kind === "practice"));
    return {
      id: definition.id,
      kind: "topic",
      taskId: definition.taskId,
      title: definition.title,
      actionLabel: definition.actionLabel,
      capabilityId: definition.primaryCapabilityId,
      capabilityLabel: CAPABILITY_LABELS[definition.primaryCapabilityId],
      state,
      recommended: false,
      progress: { completed: progress.state === "completed" ? 1 : 0, total: 1 },
      missingPrerequisiteIds,
      previewQuestion: questionPreview(definition.taskId, definition.title),
      activeSessionId: active?.id,
    };
  });

  const challengeNodes: LearningMapNode[] = SIMILARITY_CHALLENGES.map((definition) => {
    const challengeSessions = sessions.filter((session) => session.session_kind === "challenge" && session.challenge_id === definition.id);
    const active = latestSession(challengeSessions.filter((session) => !session.finished));
    const passed = challengeSessions.some((session) => session.finished);
    const missingPrerequisiteIds = definition.requiredCapabilityIds.filter((capabilityId) => !mastered.has(capabilityId));
    return {
      id: definition.id,
      kind: "challenge",
      title: definition.title,
      actionLabel: definition.actionLabel,
      state: passed ? "passed" : active ? "open" : "unopened",
      recommended: false,
      missingPrerequisiteIds,
      previewQuestion: questionPreview(definition.sourceTaskId, definition.title),
      activeSessionId: active?.id,
    };
  });

  const remediation = latestSession(sessions.filter((session) => session.session_kind === "remediation" && !session.finished));
  const sourceChallenge = remediation
    ? challengeNodes.find((node) => sessions.some((session) => session.id === remediation.source_session_id && session.challenge_id === node.id))
    : undefined;
  const activeTopic = topicNodes.find((node) => progresses.get(node.id)?.state === "in_progress");
  const activeChallenge = challengeNodes.find((node) => node.activeSessionId);
  const availableTopic = topicNodes.find((node) => node.state === "open");
  const readyChallenge = challengeNodes.find((node) => node.state === "unopened" && !node.missingPrerequisiteIds.length);
  const recommended = sourceChallenge || activeChallenge || activeTopic || availableTopic || readyChallenge;
  if (recommended) recommended.recommended = true;

  const latestNormal = latestSession(sessions.filter((session) => session.session_kind === "practice"));
  const focusedTopic = latestNormal ? topicNodes.find((node) => node.taskId === latestNormal.task_id) : undefined;
  const latestSaved = savedProgress[savedProgress.length - 1];
  const savedFocusedTopic = latestSaved ? topicNodes.find((node) => node.id === latestSaved.node_id) : undefined;
  const focused = sourceChallenge || activeChallenge || focusedTopic || savedFocusedTopic || recommended;

  return {
    mapId: SIMILARITY_MAP_ID,
    nodes: [...topicNodes, ...challengeNodes],
    edges: SIMILARITY_MAP_EDGES,
    capabilities,
    focusedNodeId: focused?.id,
    recommendedNodeId: recommended?.id,
  };
}
