import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import bundle from "../../../content/topicScenarioBundle.json";

const sqlitePath = path.resolve(process.cwd(), ".action-runtime-v2.test.sqlite");
if (existsSync(sqlitePath)) rmSync(sqlitePath, { force: true });
process.env.SQLITE_PATH = sqlitePath;

const { db } = require("../../../db/database") as typeof import("../../../db/database");
const {
  askActionRuntimeCoach,
  checkpointActionRuntime,
  getActionRuntimePlan,
  startChallenge,
  startPractice,
  submitActionEvaluation,
} = require("../platform/sessionRuntimeService") as typeof import("../platform/sessionRuntimeService");
const { materializeActionTemplate } = require("../../actionRuntime/topicPlanProjector") as typeof import("../../actionRuntime/topicPlanProjector");
const { evaluateTopicEvidence } = require("../../actionRuntime/topicTypedEvaluator") as typeof import("../../actionRuntime/topicTypedEvaluator");
const { expressionSlotIds, isSolutionBoardScript, renderBoardExpression } = require("../../../../../shared/solutionBoard") as typeof import("../../../../../shared/solutionBoard");
const { getCommittedActionWorld, listActionEvaluations } = require("../../../repositories/actionRuntimeRepository") as typeof import("../../../repositories/actionRuntimeRepository");
const { getLearningActionPlan } = require("../../learningService") as typeof import("../../learningService");
const { __test__: claudeCoachTest } = require("../../coach/claudeCodeCoachService") as typeof import("../../coach/claudeCodeCoachService");

type ActionContract = import("../../../../../shared/actionRuntime").ActionContract;
type ActionEvidence = import("../../../../../shared/actionRuntime").ActionEvidence;
type AuthoredActionTemplate = import("../../../../../shared/actionRuntime").AuthoredActionTemplate;

function evidenceFor(action: ActionContract): ActionEvidence {
  const base = { actionId: action.actionId, sourceStepId: action.sourceStepId, version: 1 as const };
  switch (action.kind) {
    case "make-parallel":
      return { ...base, kind: action.kind, throughPointId: action.input.throughPointId!, referenceLineId: action.input.referenceLineId! };
    case "intersect-carriers":
      return { ...base, kind: action.kind, carrierPointIds: action.input.carrierPointIds! };
    case "mark-segment-values":
      return { ...base, kind: action.kind, values: Object.fromEntries(action.input.labels.map((label) => [label.segmentId, label.valueLatex])) };
    case "pair-segments":
      return { ...base, kind: action.kind, segmentIds: action.input.expectedOrder! };
    case "ratio-scratch":
      return { ...base, kind: action.kind, segmentIds: action.input.expectedOrder!, ratio: action.input.simplifiedRatio! };
    case "convert-collinear":
      return { ...base, kind: action.kind, segmentIds: action.input.expectedOrder! };
    case "enter-equation":
      return { ...base, kind: action.kind, factors: action.input.shareValues ? [action.input.expectedOrder![0], ...action.input.shareValues] : action.input.expectedOrder!, result: action.input.expectedResult! };
    case "select-option":
      return { ...base, kind: action.kind, value: action.input.expectedValue! };
    case "enter-text":
      return { ...base, kind: action.kind, value: action.input.expectedValues![0] };
  }
}

async function main() {
  const allRecords = Object.values(bundle.scenarios).flat();
  assert.equal(allRecords.length, 280);
  assert.ok(allRecords.every((record) => record.promptData.actionTemplates?.length), "every published Topic record must author actionTemplates");
  assert.ok(allRecords.every((record) => record.promptData.solutionBoard?.expressions.length), "every published Topic record must author a SolutionBoard script");
  for (const record of allRecords) {
    assert.ok(isSolutionBoardScript(record.promptData.solutionBoard), `${record.id} must have a valid SolutionBoard script`);
    const slots = new Set(record.promptData.solutionBoard!.expressions.flatMap((expression) => expressionSlotIds(expression.latexTemplate)));
    assert.equal(slots.size, 0, `${record.id} must store complete board text rather than runtime slots`);
  }
  const projectorSource = readFileSync(path.resolve(process.cwd(), "src/services/actionRuntime/topicPlanProjector.ts"), "utf8");
  const scenarioBankSource = readFileSync(path.resolve(process.cwd(), "src/services/runtime/engines/topicPractice/scenarioBank.ts"), "utf8");
  const authoringSource = readFileSync(path.resolve(process.cwd(), "scripts/lib/topicActionTemplateAuthoring.ts"), "utf8");
  assert.equal(projectorSource.includes("primitiveActionCompiler"), false);
  assert.equal(scenarioBankSource.includes("primitiveActionCompiler"), false);
  const solutionAuthoringSource = authoringSource.split("export function authorTopicSolutionBoard")[1] || "";
  assert.equal(/\.kind\s*===|switch\s*\([^)]*kind/.test(solutionAuthoringSource), false, "SolutionBoard authoring must not dispatch on Action kind");
  const reverseFirst = bundle.scenarios.reverseASimilarity[0];
  const reverseSolution = reverseFirst.promptData.solutionBoard?.expressions.map((expression) => expression.latexTemplate).join(" ") || "";
  assert.match(reverseSolution, /\\triangle PAB\\sim\\triangle PDC/, "formal solution must state the similarity conclusion");
  assert.match(reverseSolution, /\\dfrac\{AB\}\{DC\}=\\dfrac\{PA\}\{PD\}|\\dfrac\{PA\}\{PD\}=\\dfrac\{AB\}\{DC\}/, "formal solution must state the corresponding-side proportion");
  assert.equal(reverseSolution.includes("在图中标出"), false, "formal solution must not contain Action instructions");
  const frontendRoot = path.resolve(process.cwd(), "../frontend/src/action-runtime");
  const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : [target];
  });
  const frontendProduction = sourceFiles(frontendRoot).filter((file) => !file.includes("__tests__")).map((file) => readFileSync(file, "utf8")).join("\n");
  assert.equal(/topicAnswerSerializer|TopicRuntimeFrame|primitiveActionCompiler|reduceTopicPracticeAction|RuntimeActionEvent/.test(frontendProduction), false);
  assert.equal(/projectBoardSlotValues|boardPreview|boardCommands|boardTargets/.test(frontendProduction), false, "Action implementations must not assemble SolutionBoard content");
  const opaqueTemplate = {
    actionId: "future/1",
    sourceStepId: "future",
    kind: "future-machine",
    version: 7,
    title: "future",
    instruction: "future",
    input: { publicValue: 1, nested: { untouched: true } },
    teachingInput: { expectedValue: "teaching-only" },
    capabilities: ["future.capability"],
    answerSlots: [],
    submitOnComplete: true,
  };
  const guidedOpaque = materializeActionTemplate(opaqueTemplate, "guided-practice") as unknown as { kind: string; version: number; input: Record<string, unknown> };
  const assessmentOpaque = materializeActionTemplate(opaqueTemplate, "assessment") as unknown as { input: Record<string, unknown> };
  assert.equal(guidedOpaque.kind, "future-machine");
  assert.equal(guidedOpaque.version, 7);
  assert.equal(guidedOpaque.input.expectedValue, "teaching-only");
  assert.equal(assessmentOpaque.input.expectedValue, undefined);
  assert.deepEqual(assessmentOpaque.input.nested, { untouched: true });

  const actionFixtures = (allRecords as unknown as Array<{
    promptData: { actionTemplates?: AuthoredActionTemplate[] };
  }>).flatMap((record) => record.promptData.actionTemplates || []);
  for (const kind of ["mark-segment-values", "pair-segments", "ratio-scratch", "convert-collinear", "enter-equation"] as const) {
    const template = actionFixtures.find((candidate) => candidate.kind === kind)!;
    const contract = materializeActionTemplate(template, "learn") as ActionContract;
    const diagnosis = evaluateTopicEvidence([template], [evidenceFor(contract)]);
    assert.equal(diagnosis.accepted, true, `${kind} canonical evidence must be accepted`);
    assert.ok(diagnosis.commands.length > 0, `${kind} must project a diagram teaching command`);
    assert.equal(JSON.stringify(contract).includes("boardTargets"), false, `${kind} must be board-neutral at runtime`);
  }

  const learningPlan = getLearningActionPlan("auxiliaryTwoRatios");
  assert.equal(learningPlan.planVersion, 4);
  assert.equal(learningPlan.mode, "learn");
  assert.equal(learningPlan.exerciseId, "learn-auxiliaryTwoRatios", "Learn identity must stay stable across stateless coach requests");
  assert.equal(getLearningActionPlan("auxiliaryTwoRatios").exerciseId, learningPlan.exerciseId);
  assert.ok(learningPlan.solutionBoardContexts?.length);
  assert.ok(learningPlan.solutionBoardContexts?.every((context) => context.board.expressions.every((expression) => expression.phase === "complete")));
  assert.ok(learningPlan.solutionBoardContexts?.every((context) => context.board.expressions.every((expression) => !renderBoardExpression(expression).includes("{{"))));
  assert.equal(JSON.stringify(learningPlan.actions).includes("boardTargets"), false);
  const firstLearningContext = learningPlan.solutionBoardContexts![0];
  const storedBoardRow = db.prepare(`
    SELECT question_id, question_version, board_json
    FROM question_action_solution_boards
    WHERE solution_revision = ? AND action_id = ? AND mode = 'learn' AND stage = 'enter'
    LIMIT 1
  `).get(firstLearningContext.solutionRevision, firstLearningContext.actionId) as {
    question_id: string;
    question_version: string;
    board_json: string;
  };
  const storedBoard = JSON.parse(storedBoardRow.board_json) as typeof firstLearningContext.board;
  db.prepare(`
    UPDATE question_action_solution_boards SET board_json = ?
    WHERE question_id = ? AND question_version = ? AND solution_revision = ?
      AND action_id = ? AND mode = 'learn' AND stage = 'enter'
  `).run(
    JSON.stringify({ ...storedBoard, headingLatex: "数据库解：" }),
    storedBoardRow.question_id,
    storedBoardRow.question_version,
    firstLearningContext.solutionRevision,
    firstLearningContext.actionId,
  );
  assert.equal(
    getLearningActionPlan("auxiliaryTwoRatios").solutionBoardContexts?.find((context) => context.actionId === firstLearningContext.actionId)?.board.headingLatex,
    "数据库解：",
    "runtime must read the complete Action board from the question database",
  );
  db.prepare(`
    UPDATE question_action_solution_boards SET board_json = ?
    WHERE question_id = ? AND question_version = ? AND solution_revision = ?
      AND action_id = ? AND mode = 'learn' AND stage = 'enter'
  `).run(
    storedBoardRow.board_json,
    storedBoardRow.question_id,
    storedBoardRow.question_version,
    firstLearningContext.solutionRevision,
    firstLearningContext.actionId,
  );

  const started = startPractice("auxiliaryTwoRatios", "Action Runtime Test");
  const bootstrap = getActionRuntimePlan(started.sessionId);
  assert.equal(bootstrap.plan.planVersion, 4);
  assert.ok(bootstrap.plan.actions.some((action) => action.kind === "make-parallel"));
  assert.ok(bootstrap.plan.actions.some((action) => action.kind === "intersect-carriers"));
  assert.equal(JSON.stringify(bootstrap.plan).includes("acceptedAnswers"), false);
  assert.equal(JSON.stringify(bootstrap.plan).includes("solutionBoardSlots"), false, "private canonical slot values must stay backend-only");
  assert.equal(started.actionRuntimeVersion, 2);
  assert.equal(JSON.stringify(bootstrap.plan.world).includes("solutionBoard"), false, "SolutionBoard is context, not World state");
  const storedSnapshots = db.prepare("SELECT COUNT(*) AS count FROM question_action_solution_boards").get() as { count: number };
  assert.ok(storedSnapshots.count > 0, "question-bank Action snapshots must be materialized in the database");
  const parallelOutputIds = bootstrap.plan.actions.flatMap((action) => action.kind === "make-parallel" ? [action.input.outputLineId] : []);
  const intersectionOutputIds = bootstrap.plan.actions.flatMap((action) => action.kind === "intersect-carriers" ? [action.input.outputPointId] : []);
  assert.ok(parallelOutputIds.every((id) => !bootstrap.plan.world.geometry?.derivedLines?.some((line) => line.id === id)));
  assert.ok(intersectionOutputIds.every((id) => !bootstrap.plan.world.geometry?.points.some((point) => point.id === id)));

  const active = bootstrap.plan.actions.find((action) => action.actionId === bootstrap.plan.currentActionId)!;
  const sourceActions = bootstrap.plan.actions.filter((action) => action.sourceStepId === active.sourceStepId);
  const evidence = sourceActions.map(evidenceFor);

  const checkpoint = checkpointActionRuntime({
    sessionId: started.sessionId,
    exerciseId: bootstrap.plan.exerciseId,
    currentActionId: active.actionId,
    completedActionIds: [],
    evidence: [],
    currentDraft: { selectedByKind: { points: [], lines: [], angles: [] }, answers: { value: "draft" }, activeSlotId: "value" },
    revision: bootstrap.plan.revision,
  });
  assert.equal(checkpoint.accepted, true);
  assert.equal(getActionRuntimePlan(started.sessionId).checkpoint?.currentActionId, active.actionId);
  assert.equal(getActionRuntimePlan(started.sessionId).checkpoint?.currentDraft?.answers.value, "draft");

  const request = {
    sessionId: started.sessionId,
    exerciseId: bootstrap.plan.exerciseId,
    sourceStepId: active.sourceStepId,
    revision: bootstrap.plan.revision,
    evidence,
    idempotencyKey: crypto.randomUUID(),
  };
  const evaluated = submitActionEvaluation(request);
  assert.notEqual(evaluated.outcome, "conflict");
  assert.notEqual(evaluated.evaluation, "wrong");
  assert.deepEqual(submitActionEvaluation(request), evaluated, "idempotent retry must return the stored response");
  const storedEvaluation = listActionEvaluations(started.sessionId)[0];
  assert.deepEqual(storedEvaluation.request.evidence, evidence);
  assert.equal(JSON.stringify(storedEvaluation).includes("topic-answer"), false);
  if (sourceActions.some((action) => action.kind === "make-parallel")) {
    const storedWorld = getCommittedActionWorld(started.sessionId, bootstrap.plan.exerciseId);
    assert.ok(storedWorld?.world.geometry?.derivedLines?.some((line) => line.derived));
    assert.ok(storedWorld?.world.geometry?.points.some((point) => point.derived));
    assert.equal(JSON.stringify(storedWorld?.world).includes("solutionBoard"), false);
  }
  const auditRow = db.prepare("SELECT submitted_value, source_id FROM practice_action_events WHERE session_id = ? ORDER BY id LIMIT 1").get(started.sessionId) as { submitted_value: string | null; source_id: string };
  assert.equal(auditRow.submitted_value, null);
  assert.equal(auditRow.source_id, "action-runtime-v2");

  const rejectedSession = startPractice("auxiliaryTwoRatios", "Targeted Rejection Test");
  const rejectedPlan = getActionRuntimePlan(rejectedSession.sessionId).plan;
  const rejectedActive = rejectedPlan.actions.find((action) => action.actionId === rejectedPlan.currentActionId)!;
  const rejectedActions = rejectedPlan.actions.filter((action) => action.sourceStepId === rejectedActive.sourceStepId);
  const rejectedEvidence = rejectedActions.map(evidenceFor).map((item) => item.kind === "intersect-carriers"
    ? { ...item, carrierPointIds: [item.carrierPointIds[0], item.carrierPointIds[0]] as [string, string] }
    : item);
  const rejected = submitActionEvaluation({
    sessionId: rejectedSession.sessionId, exerciseId: rejectedPlan.exerciseId, sourceStepId: rejectedActive.sourceStepId,
    revision: rejectedPlan.revision, evidence: rejectedEvidence, idempotencyKey: crypto.randomUUID(),
  });
  assert.equal(rejected.outcome, "rejected");
  assert.deepEqual(rejected.diagnosis?.wrongActionIds, rejectedActions.filter((action) => action.kind === "intersect-carriers").map((action) => action.actionId));
  assert.equal(getCommittedActionWorld(rejectedSession.sessionId, rejectedPlan.exerciseId), undefined, "rejected group must not commit draft world");

  const latest = getActionRuntimePlan(started.sessionId);
  const conflict = submitActionEvaluation({
    sessionId: started.sessionId,
    exerciseId: latest.plan.exerciseId,
    sourceStepId: latest.plan.actions.find((action) => action.actionId === latest.plan.currentActionId)!.sourceStepId,
    revision: latest.plan.revision - 1,
    evidence: [],
    idempotencyKey: crypto.randomUUID(),
  });
  assert.equal(conflict.outcome, "conflict");
  assert.equal(conflict.plan?.planVersion, 4);

  const coach = askActionRuntimeCoach({
    sessionId: started.sessionId,
    exerciseId: latest.plan.exerciseId,
    trace: {
      exerciseId: latest.plan.exerciseId,
      currentActionId: latest.plan.currentActionId,
      actionState: "editing",
      selectedObjectIds: [],
      answerDraft: {},
      recentEvents: [],
      wrongAttempts: 1,
      revision: latest.plan.revision,
    },
  });
  assert.ok(coach.directive.messageLatex.length > 0);
  assert.equal(coach.directive.suggestedActionId, latest.plan.currentActionId);
  const commandCoach = askActionRuntimeCoach({
    sessionId: started.sessionId,
    exerciseId: latest.plan.exerciseId,
    trace: { exerciseId: latest.plan.exerciseId, currentActionId: latest.plan.currentActionId, actionState: "editing", selectedObjectIds: [], answerDraft: {}, recentEvents: [], wrongAttempts: 0, revision: latest.plan.revision, studentMessage: "请帮我撤销" },
    studentMessage: "请帮我撤销",
  });
  assert.equal(commandCoach.directive.agentCommand?.type, "back");
  assert.deepEqual(claudeCoachTest.parseEnvelope(JSON.stringify({
    type: "result",
    structured_output: {
      messageLatex: "先看当前这一步。",
      spokenText: "先看当前这一步。",
      tone: "explain",
    },
  })), {
    messageLatex: "先看当前这一步。",
    spokenText: "先看当前这一步。",
    tone: "explain",
  });

  const challenge = startChallenge("challenge-auxiliary-comprehensive", "Assessment Runtime Test");
  const assessment = getActionRuntimePlan(challenge.sessionId).plan;
  assert.equal(assessment.mode, "assessment");
  assert.equal(assessment.solutionBoardContexts, undefined);
  assert.equal(JSON.stringify(assessment.world).includes("solutionBoard"), false);
  for (const action of assessment.actions) {
    assert.equal(action.validationPolicy, "server-authoritative");
    if (action.kind === "make-parallel") assert.equal(action.input.throughPointId, undefined);
    if (action.kind === "intersect-carriers") assert.equal(action.input.carrierPointIds, undefined);
    if (action.kind === "enter-text") assert.equal(action.input.expectedValues, undefined);
    if (action.kind === "select-option") assert.equal(action.input.expectedValue, undefined);
  }
  assert.equal(/acceptedAnswers|expectedValue|expectedValues|throughPointId|carrierPointIds/.test(JSON.stringify(assessment)), false);

  const pinned = startPractice("auxiliaryTwoRatios", "Pinned v1 Test");
  db.prepare("UPDATE practice_sessions SET action_runtime_version = 1 WHERE id = ?").run(pinned.sessionId);
  assert.equal((require("../platform/sessionRuntimeService") as typeof import("../platform/sessionRuntimeService")).restorePractice(pinned.sessionId).actionRuntimeVersion, 1);
  assert.throws(() => getActionRuntimePlan(pinned.sessionId), (error) => (error as { body?: { error?: { message?: string } } }).body?.error?.message === "Session is pinned to Action Runtime v1");

  process.env.ACTION_RUNTIME_V2 = "false";
  const rollbackSession = startPractice("auxiliaryTwoRatios", "Rollback Flag Test");
  delete process.env.ACTION_RUNTIME_V2;
  assert.equal(rollbackSession.actionRuntimeVersion, 1, "rollback flag only affects newly created sessions");
  assert.equal((require("../platform/sessionRuntimeService") as typeof import("../platform/sessionRuntimeService")).restorePractice(started.sessionId).actionRuntimeVersion, 2, "already pinned v2 session stays v2");

  db.close();
  rmSync(sqlitePath, { force: true });
  console.log("PASS Action Runtime v4 server-projected SolutionBoard context");
}

void main().catch((error) => {
  console.error("FAIL Action Runtime v4", error);
  db.close();
  throw error;
});
