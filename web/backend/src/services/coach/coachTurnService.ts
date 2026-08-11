import type { TaskId } from "../../../../shared/contracts";
import type {
  CoachDirective,
  CoachTurnRequest,
  CoachTurnResponse,
  ExercisePlan,
} from "../../../../shared/actionRuntime";
import { renderBoardExpression } from "../../../../shared/solutionBoard";
import { getLearningActionPlan } from "../learningService";
import { askActionRuntimeCoach, getActionRuntimePlan } from "../runtime/platform/sessionRuntimeService";
import { askClaudeCodeCoach } from "./claudeCodeCoachService";
import { synthesizeCoachSpeech, transcribeStudentAudio } from "./qwenSpeechService";

function plainSpeech(value: string): string {
  return value
    .replace(/\$+/g, "")
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\(?:frac|sqrt)\{([^}]*)\}(?:\{([^}]*)\})?/g, (_match, first, second) => second ? `${first} 除以 ${second}` : first)
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function learningFallback(plan: ExercisePlan, question: string): CoachDirective {
  const action = plan.actions.find((candidate) => candidate.actionId === plan.currentActionId)!;
  const messageLatex = question.includes("没听懂")
    ? `我们先不往下走。当前只看这一件事：${action.instruction}。你可以继续问“为什么要这样做”，我会换一种说法。`
    : `你的问题我收到了。先把注意力放在当前步骤：${action.instruction}。`;
  return {
    directiveId: crypto.randomUUID(),
    messageLatex,
    spokenText: plainSpeech(messageLatex),
    tone: "explain",
    highlightObjectIds: [],
    suggestedActionId: action.actionId,
  };
}

function validateLearningTrace(plan: ExercisePlan, request: CoachTurnRequest): void {
  if (request.exerciseId !== plan.exerciseId || request.trace.exerciseId !== plan.exerciseId) {
    throw new Error("Learning exercise is not active");
  }
  if (request.trace.revision !== plan.revision) throw new Error("Learning trace revision is stale");
  if (!plan.actions.some((action) => action.actionId === request.trace.currentActionId)) {
    throw new Error("Learning action is not active");
  }
}

function modelInput(plan: ExercisePlan, request: CoachTurnRequest, studentQuestion: string) {
  const action = plan.actions.find((candidate) => candidate.actionId === request.trace.currentActionId)
    || plan.actions.find((candidate) => candidate.actionId === plan.currentActionId)!;
  const board = plan.solutionBoardContexts?.find((context) => context.actionId === action.actionId)?.board;
  return {
    problemLatex: plan.metadata.promptLatex,
    mode: plan.mode,
    action: { actionId: action.actionId, title: action.title, instruction: action.instruction },
    visibleSolution: plan.mode === "assessment"
      ? []
      : (board?.expressions || []).filter((expression) => expression.phase !== "hidden").map((expression) => renderBoardExpression(expression)),
    ...(plan.mode === "learn" ? { reviewedTeachingTargets: action.input } : {}),
    trace: {
      actionState: request.trace.actionState,
      selectedObjectIds: request.trace.selectedObjectIds,
      answerDraft: request.trace.answerDraft,
      wrongAttempts: request.trace.wrongAttempts,
      recentEvents: request.trace.recentEvents.slice(-12),
    },
    conversation: (request.conversation || []).slice(-8).map((turn) => ({
      role: turn.role,
      text: turn.text.slice(0, 600),
    })),
    studentQuestion: studentQuestion.slice(0, 1_200),
  };
}

export async function conductCoachTurn(request: CoachTurnRequest): Promise<CoachTurnResponse> {
  let plan: ExercisePlan;
  let fallback: CoachDirective;
  if (request.context.kind === "practice") {
    const fallbackResponse = askActionRuntimeCoach({
      sessionId: request.context.sessionId,
      exerciseId: request.exerciseId,
      trace: request.trace,
      studentMessage: request.studentMessage,
    });
    fallback = fallbackResponse.directive;
    plan = getActionRuntimePlan(request.context.sessionId).plan;
  } else {
    plan = getLearningActionPlan(request.context.taskId as TaskId);
    validateLearningTrace(plan, request);
    fallback = learningFallback(plan, request.studentMessage || "");
  }

  let transcript: string | undefined;
  let transcriptionProvider: string | undefined;
  if (request.studentAudio) {
    const transcription = await transcribeStudentAudio(request.studentAudio);
    transcript = transcription.transcript;
    transcriptionProvider = transcription.model;
  }
  const studentQuestion = request.studentMessage?.trim() || transcript?.trim() || "";
  if (!studentQuestion) throw new Error("Student question is empty");

  let directive = fallback;
  let answerProvider: CoachTurnResponse["providers"]["answer"] = "deterministic-fallback";
  try {
    const generated = await askClaudeCodeCoach(modelInput(plan, request, studentQuestion));
    directive = {
      ...fallback,
      directiveId: crypto.randomUUID(),
      messageLatex: generated.messageLatex,
      spokenText: generated.spokenText,
      tone: generated.tone,
    };
    answerProvider = "claude-code-glm-5.2";
  } catch {
    directive = { ...fallback, spokenText: fallback.spokenText || plainSpeech(fallback.messageLatex) };
  }

  let speech: CoachTurnResponse["speech"];
  let speechProvider: string | undefined;
  if (request.synthesizeSpeech !== false) {
    try {
      speech = await synthesizeCoachSpeech(directive.spokenText || plainSpeech(directive.messageLatex));
      speechProvider = speech.model;
    } catch {
      speech = undefined;
    }
  }

  return {
    directive,
    ...(transcript ? { transcript } : {}),
    ...(speech ? { speech } : {}),
    providers: {
      answer: answerProvider,
      ...(transcriptionProvider ? { transcription: transcriptionProvider } : {}),
      ...(speechProvider ? { speech: speechProvider } : {}),
    },
  };
}
