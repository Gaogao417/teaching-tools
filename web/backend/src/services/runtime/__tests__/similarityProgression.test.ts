import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, rmSync } from "node:fs";

const sqlitePath = path.resolve(process.cwd(), ".similarity-progression.test.sqlite");
if (existsSync(sqlitePath)) rmSync(sqlitePath, { force: true });
process.env.SQLITE_PATH = sqlitePath;

const { db } = require("../../../db/database") as typeof import("../../../db/database");
const {
  finishPractice,
  getChallengeDiagnosis,
  restorePractice,
  startChallenge,
  startPractice,
  startRemediation,
  submitRuntimeAction,
} = require("../platform/sessionRuntimeService") as typeof import("../platform/sessionRuntimeService");
const { getSimilarityLearningMap } = require("../../similarityProgressionService") as typeof import("../../similarityProgressionService");
const { recordSimilarityTopicProgress } = require("../../similarityProgressionService") as typeof import("../../similarityProgressionService");

function activeContract(sessionId: string) {
  const session = restorePractice(sessionId);
  const runtime = session.runtime!;
  const contract = runtime.instance.scene.topicWorkspace?.contracts[runtime.runtimeState.currentStepId];
  assert.ok(contract);
  return { session, runtime, contract };
}

function submitCurrentCorrect(sessionId: string) {
  const { runtime, contract } = activeContract(sessionId);
  return submitRuntimeAction(sessionId, runtime.instance.instanceId, {
    type: "submit",
    stepId: contract.id,
    value: JSON.stringify({ inputs: { "topic-answer": contract.acceptedAnswers[0] } }),
  });
}

function finishAllSteps(sessionId: string) {
  for (let guard = 0; guard < 40; guard += 1) {
    const session = restorePractice(sessionId);
    if (session.phase === "group_finished") return;
    submitCurrentCorrect(sessionId);
  }
  throw new Error("Session did not finish within the guard limit");
}

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  await runTest("new students receive one server-recommended entry node and explicit locks", () => {
    const map = getSimilarityLearningMap("map-new-student");
    assert.equal(map.recommendedNodeId, "parallel-line-ratios");
    assert.equal(map.nodes.find((node) => node.id === "parallel-line-ratios")?.state, "available");
    assert.equal(map.nodes.find((node) => node.id === "auxiliary-two-ratios")?.state, "locked");
    assert.equal(map.nodes.find((node) => node.id === "challenge-auxiliary-comprehensive")?.challengeState, "early-attempt");
  });

  await runTest("correct practice steps write versioned capability evidence and unlock dependent nodes", () => {
    const studentName = "map-practice-student";
    const session = startPractice("parallelLineRatios", studentName);
    for (let index = 0; index < 3; index += 1) submitCurrentCorrect(session.sessionId);
    const map = getSimilarityLearningMap(studentName);
    const mastered = new Set(map.capabilities.filter((item) => item.state === "mastered").map((item) => item.capabilityId));
    assert.ok(mastered.has("similarity.map-corresponding-sides"));
    assert.ok(mastered.has("similarity.transfer-ratio-shares"));
    assert.ok(mastered.has("similarity.build-side-equation"));
    assert.equal(map.nodes.find((node) => node.id === "auxiliary-two-ratios")?.state, "available");
    assert.equal(map.nodes.find((node) => node.id === "reverse-a-similarity")?.state, "available");
  });

  await runTest("Learn progress is visible but never creates mastery evidence", () => {
    const studentName = "learn-only-student";
    recordSimilarityTopicProgress({
      studentName,
      nodeId: "parallel-line-ratios",
      taskId: "parallelLineRatios",
      state: "completed",
      lastStepId: "learn-final-step",
    });
    const map = getSimilarityLearningMap(studentName);
    assert.equal(map.nodes.find((node) => node.id === "parallel-line-ratios")?.state, "in_progress");
    assert.equal(map.capabilities.every((capability) => capability.state === "unobserved"), true);
  });

  await runTest("challenge sessions require process evidence and become passed after completion", () => {
    const studentName = "challenge-pass-student";
    const challenge = startChallenge("challenge-auxiliary-comprehensive", studentName);
    assert.equal(challenge.sessionKind, "challenge");
    assert.throws(
      () => finishPractice(challenge.sessionId),
      (error: any) => error?.body?.error?.message === "Challenge must complete every instance before it can pass",
    );
    finishAllSteps(challenge.sessionId);
    const result = finishPractice(challenge.sessionId);
    assert.equal(result.resultSnapshot.sessionKind, "challenge");
    const map = getSimilarityLearningMap(studentName);
    assert.equal(map.nodes.find((node) => node.id === "challenge-auxiliary-comprehensive")?.challengeState, "passed");
  });

  await runTest("a challenge error produces one capability diagnosis and linked remediation session", () => {
    const challenge = startChallenge("challenge-crossed-configuration", "challenge-remediation-student");
    const { runtime, contract } = activeContract(challenge.sessionId);
    submitRuntimeAction(challenge.sessionId, runtime.instance.instanceId, {
      type: "submit",
      stepId: contract.id,
      value: JSON.stringify({ inputs: { "topic-answer": "definitely-wrong" } }),
    });
    const diagnosis = getChallengeDiagnosis(challenge.sessionId);
    assert.equal(diagnosis.sourceChallengeSessionId, challenge.sessionId);
    assert.equal(diagnosis.focusStepId, contract.id);
    const remediation = startRemediation(challenge.sessionId);
    assert.equal(remediation.sessionKind, "remediation");
    assert.equal(remediation.instanceCount, 3);
    assert.equal(remediation.sourceSessionId, challenge.sessionId);
    assert.equal(remediation.resumeContext?.sourceStepId, contract.id);
  });

  db.close();
  rmSync(sqlitePath, { force: true });
}

void main();
