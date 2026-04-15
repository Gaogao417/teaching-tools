import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, rmSync } from "node:fs";

const sqlitePath = path.resolve(process.cwd(), ".runtime-first.test.sqlite");
if (existsSync(sqlitePath)) {
  rmSync(sqlitePath, { force: true });
}
process.env.SQLITE_PATH = sqlitePath;

const { db } = require("../../db/database") as typeof import("../../db/database");
const {
  finishPractice,
  restorePractice,
  startPractice,
  submitAnswer,
  submitRuntimeAction,
} = require("./sessionRuntimeService") as typeof import("./sessionRuntimeService");
const { getResult, getTaskHistory } = require("../resultsService") as typeof import("../resultsService");

type TaskId = import("../../../../shared/contracts").TaskId;
type Side = import("../../../../shared/contracts").Side;
type Role = import("../../../../shared/contracts").Role;
type AnswerPayload = import("../../../../shared/contracts").AnswerPayload;
type RuntimeActionEvent = import("../../../../shared/contracts").RuntimeActionEvent;

type MeaningState = {
  taskId: "meaning";
  instanceId: string;
  status: "pending" | "correct" | "wrong";
  referenceAngle: "A" | "C";
  answerKey: { roles: [Role, Role] };
};

type RatioState = {
  taskId: "ratioToSide";
  instanceId: string;
  status: "pending" | "correct" | "wrong";
  answerKey: { triple: Record<Side, { n: number; s: number }> };
};

type GuidedState = {
  taskId: "guidedSolve";
  instanceId: string;
  status: "pending" | "correct" | "wrong";
  answerKey: {
    zRoles: Partial<Record<Role, string>>;
    thirdZ: string;
    finalNumerator: string;
    finalDenominator: string;
  };
  stepState: Record<"ratio" | "third" | "final", { done: boolean; value: string }>;
};

type EngineState = MeaningState | RatioState | GuidedState;

function resetDb() {
  db.exec(`
    DELETE FROM practice_results;
    DELETE FROM practice_instances;
    DELETE FROM practice_problems;
    DELETE FROM practice_sessions;
  `);
}

function formatLength(len: { n: number; s: number }) {
  if (len.s === 1) return String(len.n);
  if (len.n === 1) return `√${len.s}`;
  return `${len.n}√${len.s}`;
}

function sideForRole(referenceAngle: "A" | "C", role: Role): Side {
  if (referenceAngle === "C") {
    return ({ opposite: "AB", adjacent: "BC", hypotenuse: "AC" } satisfies Record<Role, Side>)[role];
  }
  return ({ opposite: "BC", adjacent: "AB", hypotenuse: "AC" } satisfies Record<Role, Side>)[role];
}

function currentSessionRow(sessionId: string) {
  return db
    .prepare(`SELECT id, current_index, phase FROM practice_sessions WHERE id = ?`)
    .get(sessionId) as { id: string; current_index: number; phase: string };
}

function currentEngineState(sessionId: string): EngineState {
  const session = currentSessionRow(sessionId);
  const row = db
    .prepare(
      `SELECT engine_state_json
       FROM practice_instances
       WHERE session_id = ?
       ORDER BY instance_index ASC
       LIMIT 1 OFFSET ?`,
    )
    .get(sessionId, session.current_index) as { engine_state_json: string };

  return JSON.parse(row.engine_state_json) as EngineState;
}

function runtimeInstanceCount(sessionId: string) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM practice_instances
       WHERE session_id = ?`,
    )
    .get(sessionId) as { count: number };

  return row.count;
}

function engineStateAtIndex(sessionId: string, index: number): EngineState {
  const row = db
    .prepare(
      `SELECT engine_state_json
       FROM practice_instances
       WHERE session_id = ?
       ORDER BY instance_index ASC
       LIMIT 1 OFFSET ?`,
    )
    .get(sessionId, index) as { engine_state_json: string };

  return JSON.parse(row.engine_state_json) as EngineState;
}

function correctRuntimeActionFor(state: EngineState): RuntimeActionEvent {
  if (state.taskId === "meaning") {
    return {
      type: "submit",
      stepId: "pick-roles",
      value: JSON.stringify({
        selections: {
          "meaning-selection": [
            sideForRole(state.referenceAngle, state.answerKey.roles[0]),
            sideForRole(state.referenceAngle, state.answerKey.roles[1]),
          ],
        },
      }),
    };
  }

  if (state.taskId === "ratioToSide") {
    return {
      type: "submit",
      stepId: "fill-lengths",
      value: JSON.stringify({
        inputs: {
          "side-AB": formatLength(state.answerKey.triple.AB),
          "side-BC": formatLength(state.answerKey.triple.BC),
          "side-AC": formatLength(state.answerKey.triple.AC),
        },
      }),
    };
  }

  if (!state.stepState.ratio.done) {
    return {
      type: "submit",
      stepId: "ratio",
      value: JSON.stringify({
        inputs: Object.fromEntries(
          Object.entries(state.answerKey.zRoles).map(([role, value]) => [`ratio-${role}`, value || ""]),
        ),
      }),
    };
  }

  if (!state.stepState.third.done) {
    return {
      type: "submit",
      stepId: "third",
      value: JSON.stringify({
        inputs: {
          "third-side": state.answerKey.thirdZ,
        },
      }),
    };
  }

  return {
    type: "submit",
    stepId: "final",
    value: JSON.stringify({
      inputs: {
        "final-numerator": state.answerKey.finalNumerator,
        "final-denominator": state.answerKey.finalDenominator,
      },
    }),
  };
}

function wrongRuntimeActionFor(state: EngineState): RuntimeActionEvent {
  if (state.taskId === "meaning") {
    return {
      type: "submit",
      stepId: "pick-roles",
      value: JSON.stringify({
        selections: {
          "meaning-selection": [
            sideForRole(state.referenceAngle, state.answerKey.roles[1]),
            sideForRole(state.referenceAngle, state.answerKey.roles[0]),
          ],
        },
      }),
    };
  }

  if (state.taskId === "ratioToSide") {
    return {
      type: "submit",
      stepId: "fill-lengths",
      value: JSON.stringify({
        inputs: {
          "side-AB": "999",
          "side-BC": "999",
          "side-AC": "999",
        },
      }),
    };
  }

  if (!state.stepState.ratio.done) {
    return {
      type: "submit",
      stepId: "ratio",
      value: JSON.stringify({
        inputs: {
          "ratio-opposite": "999",
          "ratio-adjacent": "999",
          "ratio-hypotenuse": "999",
        },
      }),
    };
  }

  if (!state.stepState.third.done) {
    return {
      type: "submit",
      stepId: "third",
      value: JSON.stringify({
        inputs: {
          "third-side": "999",
        },
      }),
    };
  }

  return {
    type: "submit",
    stepId: "final",
    value: JSON.stringify({
      inputs: {
        "final-numerator": "999",
        "final-denominator": "999",
      },
    }),
  };
}

function correctLegacyPayloadFor(state: EngineState): AnswerPayload {
  if (state.taskId === "meaning") {
    return {
      type: "meaning",
      numeratorRole: state.answerKey.roles[0],
      denominatorRole: state.answerKey.roles[1],
    };
  }

  if (state.taskId === "ratioToSide") {
    return {
      type: "ratioToSide",
      placements: {
        AB: formatLength(state.answerKey.triple.AB),
        BC: formatLength(state.answerKey.triple.BC),
        AC: formatLength(state.answerKey.triple.AC),
      },
    };
  }

  if (!state.stepState.ratio.done) {
    return {
      type: "guidedSolve",
      stepKey: "ratio",
      value: Object.fromEntries(Object.entries(state.answerKey.zRoles).map(([role, value]) => [role, value || ""])),
    };
  }

  if (!state.stepState.third.done) {
    return {
      type: "guidedSolve",
      stepKey: "third",
      value: { third: state.answerKey.thirdZ },
    };
  }

  return {
    type: "guidedSolve",
    stepKey: "final",
    value: {
      numerator: state.answerKey.finalNumerator,
      denominator: state.answerKey.finalDenominator,
    },
  };
}

async function advanceWithCorrectRuntimeActions(taskId: TaskId, studentName: string) {
  const started = startPractice(taskId, studentName);
  let snapshot = started;

  while (snapshot.phase !== "group_finished") {
    const state = currentEngineState(snapshot.sessionId);
    const response = submitRuntimeAction(snapshot.sessionId, state.instanceId, correctRuntimeActionFor(state));

    if (response.phase === "group_finished") {
      snapshot = restorePractice(snapshot.sessionId);
      break;
    }

    assert.equal(response.phase, "correct_pause");
    snapshot = restorePractice(snapshot.sessionId);
  }

  return snapshot;
}

async function runTest(name: string, fn: () => void | Promise<void>) {
  resetDb();
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  await runTest("startPractice persists a session row and five runtime instances together", () => {
    const started = startPractice("meaning", "Ada");
    const session = currentSessionRow(started.sessionId);

    assert.equal(session.current_index, 0);
    assert.equal(session.phase, "answering");
    assert.equal(runtimeInstanceCount(started.sessionId), 5);
    assert.equal(started.legacy, undefined);
  });

  await runTest("submitRuntimeAction keeps session progress and instance state in sync", () => {
    const started = startPractice("meaning", "Grace");
    const state = currentEngineState(started.sessionId);
    const response = submitRuntimeAction(started.sessionId, state.instanceId, correctRuntimeActionFor(state));

    assert.equal(response.phase, "correct_pause");
    assert.equal(response.nextIndex, 1);

    const session = currentSessionRow(started.sessionId);
    const firstInstance = engineStateAtIndex(started.sessionId, 0);

    assert.equal(session.current_index, 1);
    assert.equal(session.phase, "correct_pause");
    assert.equal(firstInstance.status, "correct");
  });

  await runTest("runtime-action pipeline can finish a full meaning session and persist a result snapshot", async () => {
    const restored = await advanceWithCorrectRuntimeActions("meaning", "Ada");
    assert.equal(restored.phase, "group_finished");
    assert.equal(restored.legacy, undefined);

    const finishResponse = finishPractice(restored.sessionId);
    assert.equal(finishResponse.resultSnapshot.taskId, "meaning");
    assert.equal(finishResponse.resultSnapshot.problemCount, 5);
    assert.equal(finishResponse.alreadyFinished, undefined);

    const secondFinishResponse = finishPractice(restored.sessionId);
    assert.equal(secondFinishResponse.alreadyFinished, true);

    const fetchedResult = getResult(restored.sessionId);
    assert.equal(fetchedResult.sessionId, restored.sessionId);

    const history = getTaskHistory("meaning", "Ada", 5);
    assert.equal(history.length, 1);
    assert.equal(history[0].problemCount, 5);
  });

  await runTest("runtime-action clear keeps the session on the same instance and wrong answers stay in place", () => {
    const started = startPractice("guidedSolve", "Babbage");
    assert.equal(started.legacy, undefined);
    const state = currentEngineState(started.sessionId);

    const cleared = submitRuntimeAction(started.sessionId, state.instanceId, {
      type: "clear",
      targetId: "ratio",
    });
    assert.equal(cleared.accepted, true);
    assert.equal(cleared.evaluation, "progress");
    assert.equal(cleared.phase, "answering");
    assert.equal(cleared.nextIndex, 0);

    const wrong = submitRuntimeAction(started.sessionId, state.instanceId, wrongRuntimeActionFor(state));
    assert.equal(wrong.evaluation, "wrong");
    assert.equal(wrong.phase, "wrong_feedback");

    const restored = restorePractice(started.sessionId);
    assert.equal(restored.currentIndex, 0);
    assert.equal(restored.legacy, undefined);
  });

  await runTest("legacy submitAnswer stays on the runtime-first pipeline for all three task families", () => {
    for (const taskId of ["meaning", "ratioToSide", "guidedSolve"] as TaskId[]) {
      const started = startPractice(taskId, `Student-${taskId}`);
      assert.equal(started.legacy, undefined);
      const state = currentEngineState(started.sessionId);
      const response = submitAnswer(started.sessionId, state.instanceId, correctLegacyPayloadFor(state));

      assert.equal(response.correct, true);
      assert.ok(response.runtime);
      assert.equal(response.problemState.id, state.instanceId);

      const restored = restorePractice(started.sessionId);
      assert.equal(restored.legacy, undefined);
      if (taskId === "guidedSolve") {
        assert.equal(restored.currentIndex, 0);
        assert.equal(restored.runtime?.runtimeState.currentStepId, "third");
      } else {
        assert.equal(restored.currentIndex, 1);
      }
    }
  });

  await runTest("legacy runtime sessions from schema version 1 fail with LEGACY_SESSION_EXPIRED", () => {
    db.prepare(
      `INSERT INTO practice_sessions (id, task_id, student_name, phase, current_index, started_at, finished, schema_version)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
    ).run("legacy-session", "meaning", "Old Student", "answering", 0, new Date().toISOString());

    assert.throws(
      () => restorePractice("legacy-session"),
      (error: any) => error?.body?.error?.code === "LEGACY_SESSION_EXPIRED",
    );
  });
}

main()
  .then(() => {
    db.close();
    if (existsSync(sqlitePath)) {
      rmSync(sqlitePath, { force: true });
    }
  })
  .catch((error) => {
    db.close();
    if (existsSync(sqlitePath)) {
      rmSync(sqlitePath, { force: true });
    }
    console.error(error);
    process.exitCode = 1;
  });
