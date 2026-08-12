import assert from "node:assert/strict";
import type { ExercisePlan } from "../../../../../shared/actionRuntime";
import { buildCoachContext } from "../application/coachContextBuilder";
import { modelInput } from "../coachTurnService";
import type { CoachContext } from "../ports/RealtimeVoiceProvider";
import type { CoachTurnRequest } from "../../../../../shared/actionRuntime";
import { getLearningActionPlan } from "../../learningService";

/** The shared core of the context — everything except the turn-specific
 *  conversation/question/trace projection. Must be identical for turn+live. */
function core(context: CoachContext | { mode: unknown; problemLatex: unknown; action: unknown; visibleSolution: unknown; reviewedTeachingTargets?: unknown }): unknown {
  return JSON.stringify({
    mode: context.mode,
    problemLatex: context.problemLatex,
    action: context.action,
    visibleSolution: context.visibleSolution,
    reviewedTeachingTargets: context.reviewedTeachingTargets,
  });
}

function learnPlan(): ExercisePlan {
  return getLearningActionPlan("auxiliaryTwoRatios" as never);
}

function buildLearnRequest(plan: ExercisePlan, actionId: string): CoachTurnRequest {
  return {
    context: { kind: "learn", taskId: "auxiliaryTwoRatios" as never },
    exerciseId: plan.exerciseId,
    trace: {
      exerciseId: plan.exerciseId,
      currentActionId: actionId,
      actionState: "idle",
      selectedObjectIds: [],
      answerDraft: {},
      recentEvents: [],
      wrongAttempts: 0,
      revision: plan.revision,
    },
    studentMessage: "为什么要作这条辅助线？",
    conversation: [],
    synthesizeSpeech: true,
  };
}

async function main(): Promise<void> {
  const plan = learnPlan();
  const actionId = plan.currentActionId;

  // 1. Turn and live produce an IDENTICAL shared context shape.
  const liveContext = buildCoachContext(plan, { actionId });
  const turnInput = modelInput(plan, buildLearnRequest(plan, actionId), "为什么要作这条辅助线？");
  assert.equal(
    core(liveContext), core(turnInput),
    "turn and live must share the identical core context (mode/problem/action/visibleSolution/reviewedTargets)",
  );

  // 2. The live context is a valid CoachContext with the safe action resolved.
  assert.equal(liveContext.mode, plan.mode);
  assert.equal(liveContext.problemLatex, plan.metadata.promptLatex);
  assert.equal(liveContext.action.actionId, actionId);
  assert.ok(Array.isArray(liveContext.visibleSolution), "visibleSolution is always an array");

  // 3. Assessment is fail-closed at the data layer: no local truth leaks into
  //    the context regardless of what the plan carries.
  const assessmentPlan: ExercisePlan = { ...plan, mode: "assessment" };
  const assessmentContext = buildCoachContext(assessmentPlan, { actionId });
  assert.deepEqual(assessmentContext.visibleSolution, [], "assessment context never exposes visible solution");
  assert.equal(assessmentContext.reviewedTeachingTargets, undefined, "assessment context exposes no reviewed teaching targets");
  assert.equal(assessmentContext.mode, "assessment");

  // 4. The turn path's Assessment stripping matches the shared builder.
  const assessmentTurnInput = modelInput(assessmentPlan, buildLearnRequest(assessmentPlan, actionId), "答案是什么？");
  assert.deepEqual(assessmentTurnInput.visibleSolution, [], "turn path also strips visible solution in assessment");
  assert.equal(assessmentTurnInput.reviewedTeachingTargets, undefined, "turn path exposes no reviewed targets in assessment");

  console.log("PASS coachContextBuilder produces identical context for turn+live and strips Assessment local truth");
}

void main().catch((error) => { console.error(error); process.exit(1); });
