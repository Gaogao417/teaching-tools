import type { TaskId } from "../../../../shared/contracts";
import type {
  CoachDirective,
  CoachTurnRequest,
  CoachTurnResponse,
  ExercisePlan,
} from "../../../../shared/actionRuntime";
import { renderBoardExpression } from "../../../../shared/solutionBoard";
import { latexToSpokenChinese } from "../../../../shared/speechText";
import { getLearningActionPlan } from "../learningService";
import { askActionRuntimeCoach, getActionRuntimePlan } from "../runtime/platform/sessionRuntimeService";
import { askClaudeCodeCoach } from "./claudeCodeCoachService";
import { synthesizeCoachSpeech, transcribeStudentAudio } from "./qwenSpeechService";
import { conductOmniCoach } from "./omniCoachService";
import { synthesizeCosyVoice } from "./cosyVoiceService";

/**
 * Normalize display LaTeX into plain spoken Chinese for TTS. Delegates to the
 * shared speech transform so the direct TTS endpoint and the coach turn path
 * share one canonical normalization.
 */
const plainSpeech = latexToSpokenChinese;

/**
 * Server default for the speech backend, used when a request omits voiceModel.
 * "claude-code" = ASR→LLM→qwen3-tts-flash triplet; "omni" = single Qwen3.5-Omni
 * call; "cosyvoice" = Claude answer spoken by CosyVoice-v3-plus.
 */
const ANSWER_PROVIDER = (process.env.COACH_ANSWER_PROVIDER || "claude-code").trim();

/**
 * Resolve the speech backend for a turn. An explicit per-request choice wins;
 * otherwise the server's COACH_ANSWER_PROVIDER default applies (back-compat
 * for callers that don't send voiceModel).
 */
function resolveVoiceModel(requested?: "omni" | "cosyvoice"): "omni" | "cosyvoice" | "default" {
  if (requested === "omni" || requested === "cosyvoice") return requested;
  if (ANSWER_PROVIDER === "omni") return "omni";
  if (ANSWER_PROVIDER === "cosyvoice") return "cosyvoice";
  return "default";
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

/**
 * Omni path: one Qwen3.5-Omni call understands the student's audio (or text)
 * in the same teaching context and emits both the display copy and a spoken
 * reply. The deterministic fallback still supplies every canvas-affecting
 * field (highlights, suggested action, tone); only the message copy and speech
 * come from the omni model. Multi-turn continuity keeps flowing through the
 * replayed `conversation` field inside the context payload.
 */
async function conductCoachTurnOmni(
  request: CoachTurnRequest,
  plan: ExercisePlan,
  fallback: CoachDirective,
): Promise<CoachTurnResponse> {
  const hasAudio = Boolean(request.studentAudio);
  const hasText = Boolean(request.studentMessage?.trim());
  if (!hasAudio && !hasText) throw new Error("Student question is empty");
  // The omni model hears the audio directly, so the question slot carries a
  // marker instead of a transcript; for typed questions we pass the raw text.
  const studentQuestion = hasText
    ? request.studentMessage!.trim()
    : "(学生通过语音提问，内容见附带音频)";
  const input = modelInput(plan, request, studentQuestion);

  let directive: CoachDirective = {
    ...fallback,
    spokenText: fallback.spokenText || plainSpeech(fallback.messageLatex),
  };
  let answerProvider: CoachTurnResponse["providers"]["answer"] = "deterministic-fallback";
  let speech: CoachTurnResponse["speech"] | undefined;
  let speechProvider: string | undefined;

  try {
    const omni = await conductOmniCoach(input, request.studentAudio);
    directive = {
      ...fallback,
      directiveId: crypto.randomUUID(),
      messageLatex: omni.messageLatex,
      spokenText: plainSpeech(omni.messageLatex),
      tone: fallback.tone,
    };
    answerProvider = "qwen3.5-omni-plus";
    if (request.synthesizeSpeech !== false && omni.audioWavBase64) {
      speech = {
        audioUrl: `data:audio/wav;base64,${omni.audioWavBase64}`,
        model: omni.model,
        voice: omni.voice,
      };
      speechProvider = omni.model;
    }
  } catch {
    // keep the deterministic fallback; speech simply stays unavailable
  }

  return {
    directive,
    ...(speech ? { speech } : {}),
    providers: {
      answer: answerProvider,
      ...(speechProvider ? { speech: speechProvider } : {}),
    },
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

  const effectiveVoice = resolveVoiceModel(request.voiceModel);
  if (effectiveVoice === "omni") {
    return conductCoachTurnOmni(request, plan, fallback);
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
      const spoken = directive.spokenText || plainSpeech(directive.messageLatex);
      const synthesized = effectiveVoice === "cosyvoice"
        ? await synthesizeCosyVoice(spoken)
        : await synthesizeCoachSpeech(spoken);
      speech = synthesized;
      speechProvider = synthesized.model;
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
