import { performance } from "node:perf_hooks";
import type { CoachTurnEvent } from "../../shared/coachMedia";
import type { CoachTurnRequest } from "../../shared/actionRuntime";
import { getLearningActionPlan } from "../src/services/learningService";
import { askClaudeCodeCoach } from "../src/services/coach/claudeCodeCoachService";
import { synthesizeCosyVoice } from "../src/services/coach/cosyVoiceService";
import { streamCoachTurn } from "../src/services/coach/application/streamCoachTurn";

const taskId = "auxiliaryTwoRatios" as const;
const question = "我没听懂这一步，请换一种说法，并说明为什么这样做。";
const plan = getLearningActionPlan(taskId);
const action = plan.actions.find((candidate) => candidate.actionId === plan.currentActionId) || plan.actions[0];
const request: CoachTurnRequest = {
  context: { kind: "learn", taskId },
  exerciseId: plan.exerciseId,
  trace: {
    exerciseId: plan.exerciseId,
    currentActionId: action.actionId,
    actionState: "idle",
    selectedObjectIds: [],
    answerDraft: {},
    recentEvents: [],
    wrongAttempts: 0,
    revision: plan.revision,
    studentMessage: question,
  },
  studentMessage: question,
  conversation: [],
  synthesizeSpeech: true,
};

function milliseconds(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}

async function benchmarkComponents() {
  const started = performance.now();
  const generated = await askClaudeCodeCoach({
    problemLatex: plan.metadata.promptLatex,
    mode: "learn",
    action: { actionId: action.actionId, title: action.title, instruction: action.instruction },
    visibleSolution: [],
    reviewedTeachingTargets: action.input,
    trace: request.trace,
    conversation: [],
    studentQuestion: question,
  });
  const modelCompleteMs = milliseconds(started);
  let firstAudioMs: number | undefined;
  await synthesizeCosyVoice(generated.spokenText, undefined, () => {
    firstAudioMs ??= milliseconds(started);
  });
  const ttsCompleteMs = milliseconds(started);
  console.log(JSON.stringify({
    mode: "components",
    actionId: action.actionId,
    modelCompleteMs,
    ttsFirstChunkMsFromStart: firstAudioMs,
    ttsFirstChunkMsAfterModel: firstAudioMs === undefined ? undefined : Math.round((firstAudioMs - modelCompleteMs) * 10) / 10,
    ttsCompleteMsFromStart: ttsCompleteMs,
    ttsCompleteMsAfterModel: Math.round((ttsCompleteMs - modelCompleteMs) * 10) / 10,
    spokenCharacters: generated.spokenText.length,
  }, null, 2));
}

async function benchmarkStream() {
  const started = performance.now();
  const timeline: Array<{ type: string; atMs: number; detail?: string }> = [];
  await streamCoachTurn(request, (event: CoachTurnEvent) => {
    const detail = event.type === "turn.transcript.delta"
      ? event.text.slice(0, 36)
      : event.type === "turn.audio" ? event.segmentId : undefined;
    timeline.push({ type: event.type, atMs: milliseconds(started), ...(detail ? { detail } : {}) });
  }, new AbortController().signal);
  const firstAnswerText = timeline.find((event) => event.type === "turn.transcript.delta" && event.detail !== "我先看当前这一步。");
  const firstAudio = timeline.find((event) => event.type === "turn.audio");
  console.log(JSON.stringify({
    mode: "stream",
    actionId: action.actionId,
    firstAnswerTextMs: firstAnswerText?.atMs,
    firstAudioMs: firstAudio?.atMs,
    completeMs: timeline.at(-1)?.atMs,
    timeline,
  }, null, 2));
}

const mode = process.argv.includes("--stream") ? "stream" : "components";
await (mode === "stream" ? benchmarkStream() : benchmarkComponents());
