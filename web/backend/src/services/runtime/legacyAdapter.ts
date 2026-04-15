import {
  AnswerPayload,
  ExerciseRuntimeSpec,
  GuidedSolveProblem,
  LegacyProblem,
  MeaningProblem,
  ProblemRenderSchema,
  RatioToSideProblem,
  TaskDefinition,
  TriangleTrigContentDefinition,
  RuntimeActionEvent,
  SessionPhase,
} from "../../../../shared/contracts";
import type { GuidedStepKey, Role, Side } from "../../../../shared/triangleTrig";
import { TriangleTrigEngineState } from "./triangleTrigEngine";

function roleSideMap(referenceAngle: "A" | "C"): Record<Role, Side> {
  if (referenceAngle === "C") {
    return { opposite: "AB", adjacent: "BC", hypotenuse: "AC" };
  }
  return { opposite: "BC", adjacent: "AB", hypotenuse: "AC" };
}

function buildWorkspace(referenceAngle: "A" | "C"): ProblemRenderSchema["workspace"] {
  const vertices = {
    A: { x: 90, y: 288 },
    B: { x: 320, y: 288 },
    C: { x: 320, y: 110 },
  };
  const sideMap = roleSideMap(referenceAngle);
  return {
    stage: { width: 460, height: 340 },
    vertices,
    rightAnglePath: "M292 288 L292 260 L320 260",
    referenceAnglePath:
      referenceAngle === "A"
        ? "M124 288 A34 34 0 0 1 111 259"
        : "M320 146 A34 34 0 0 1 290 134",
    sides: (["AB", "BC", "AC"] as Side[]).map((side) => ({
      side,
      role: ((Object.entries(sideMap).find(([, mappedSide]) => mappedSide === side)?.[0] ?? "hypotenuse") as Role),
      label:
        side === "AB"
          ? { x: 205, y: 316 }
          : side === "BC"
            ? { x: 348, y: 205 }
            : { x: 194, y: 122 },
      input:
        side === "AB"
          ? { x: 205, y: 255 }
          : side === "BC"
            ? { x: 350, y: 205 }
            : { x: 200, y: 150 },
      hitZone:
        side === "AC"
          ? {
              kind: "polygon" as const,
              points: [
                { x: 82, y: 302 },
                { x: 104, y: 322 },
                { x: 336, y: 124 },
                { x: 314, y: 96 },
              ],
            }
          : {
              kind: "line" as const,
              x1: side === "AB" ? vertices.A.x : vertices.B.x,
              y1: side === "AB" ? vertices.A.y : vertices.B.y,
              x2: side === "AB" ? vertices.B.x : vertices.C.x,
              y2: side === "AB" ? vertices.B.y : vertices.C.y,
              strokeWidth: 30,
            },
    })),
  };
}

function toGuideStatus(status: "locked" | "active" | "done"): "pending" | "active" | "done" {
  return status === "locked" ? "pending" : status;
}

function buildRenderSchema(referenceAngle: "A" | "C", runtime: ExerciseRuntimeSpec): ProblemRenderSchema {
  return {
    workspace: buildWorkspace(referenceAngle),
    guide: {
      title: runtime.instance.guide.banner,
      body: runtime.instance.guide.hint || runtime.instance.prompt,
      steps: runtime.instance.guide.stepItems.map((step) => ({
        id: step.stepId,
        title: step.title,
        body: step.summary || "",
        status: toGuideStatus(step.status),
      })),
    },
    feedback: {
      correct: "correct",
      wrong: "wrong",
      finish: "finish",
    },
  };
}

function projectedPhase(state: TriangleTrigEngineState, sessionPhase: SessionPhase, active: boolean): SessionPhase {
  if (active) return sessionPhase;
  return state.status === "correct" ? "correct_pause" : "answering";
}

export function projectLegacyProblem(
  _task: TaskDefinition,
  _content: TriangleTrigContentDefinition,
  state: TriangleTrigEngineState,
  runtime: ExerciseRuntimeSpec,
  sessionPhase: SessionPhase,
  active: boolean,
): LegacyProblem {
  const phase = projectedPhase(state, sessionPhase, active);
  const renderSchema = buildRenderSchema(state.referenceAngle, runtime);

  if (state.taskId === "meaning") {
    const problem: MeaningProblem = {
      id: state.instanceId,
      taskId: state.taskId,
      type: "meaning",
      index: state.index,
      status: state.status,
      attempts: state.attempts,
      firstTryCorrect: state.firstTryCorrect,
      prompt: runtime.instance.prompt,
      target: state.target,
      referenceAngle: state.referenceAngle,
      renderSchema,
      runtime,
      ui: {
        numeratorLabel: "分子边",
        denominatorLabel: "分母边",
        selectableRoles: ["opposite", "adjacent", "hypotenuse"],
      },
    };
    problem.runtime = runtime;
    return problem;
  }

  if (state.taskId === "ratioToSide") {
    const problem: RatioToSideProblem = {
      id: state.instanceId,
      taskId: state.taskId,
      type: "ratioToSide",
      index: state.index,
      status: state.status,
      attempts: state.attempts,
      firstTryCorrect: state.firstTryCorrect,
      prompt: runtime.instance.prompt,
      target: state.target,
      referenceAngle: state.referenceAngle,
      renderSchema,
      runtime,
      ratio: state.ratio,
      ui: {
        edges: ["AB", "BC", "AC"],
      },
    };
    problem.runtime = runtime;
    return problem;
  }

  const problem: GuidedSolveProblem = {
    id: state.instanceId,
    taskId: state.taskId,
    type: "guidedSolve",
    index: state.index,
    status: phase === "wrong_feedback" ? "wrong" : state.status,
    attempts: state.attempts,
    firstTryCorrect: state.firstTryCorrect,
    prompt: runtime.instance.prompt,
    target: state.target,
    referenceAngle: state.referenceAngle,
    renderSchema,
    runtime,
    knownType: state.knownType,
    given: state.given,
    stepKeys: ["mark", "ratio", "third", "final"],
    stepState: {
      mark: {
        done: true,
        value: state.given.map((item) => `${item.role}=${item.value}`).join(", "),
      },
      ratio: state.stepState.ratio,
      third: state.stepState.third,
      final: state.stepState.final,
    },
  };
  problem.runtime = runtime;
  return problem;
}

export function answerPayloadToRuntimeAction(
  payload: AnswerPayload,
  state: TriangleTrigEngineState,
): RuntimeActionEvent {
  if (payload.type === "meaning") {
    const mapping = roleSideMap(state.referenceAngle);
    return {
      type: "submit",
      stepId: "pick-roles",
      value: JSON.stringify({
        selections: {
          "meaning-selection": [mapping[payload.numeratorRole], mapping[payload.denominatorRole]],
        },
      }),
    };
  }

  if (payload.type === "ratioToSide") {
    return {
      type: "submit",
      stepId: "fill-lengths",
      value: JSON.stringify({
        inputs: {
          "side-AB": payload.placements.AB || "",
          "side-BC": payload.placements.BC || "",
          "side-AC": payload.placements.AC || "",
        },
      }),
    };
  }

  const inputs: Record<string, string> = {};
  if (payload.stepKey === "ratio") {
    for (const role of Object.keys(payload.value) as Role[]) {
      inputs[`ratio-${role}`] = payload.value[role] || "";
    }
  } else if (payload.stepKey === "third") {
    inputs["third-side"] = payload.value.third || "";
  } else {
    inputs["final-numerator"] = payload.value.numerator || "";
    inputs["final-denominator"] = payload.value.denominator || "";
  }

  return {
    type: "submit",
    stepId: payload.stepKey,
    value: JSON.stringify({ inputs }),
  };
}

export function runtimeActionToEngineAction(
  action: RuntimeActionEvent,
  state: TriangleTrigEngineState,
): RuntimeActionEvent {
  if (action.type !== "submit" || !action.value) return action;

  if (state.taskId === "meaning") {
    const [numeratorRole, denominatorRole] = action.value.split("|");
    if (!numeratorRole || !denominatorRole) return action;
    const mapping = roleSideMap(state.referenceAngle);
    return {
      ...action,
      value: JSON.stringify({
        selections: {
          "meaning-selection": [mapping[numeratorRole as Role], mapping[denominatorRole as Role]],
        },
      }),
    };
  }

  try {
    const parsed = JSON.parse(action.value) as Record<string, unknown>;
    if ("inputs" in parsed || "selections" in parsed) {
      return action;
    }

    if (state.taskId === "ratioToSide") {
      return {
        ...action,
        value: JSON.stringify({
          inputs: {
            "side-AB": (parsed.AB as string | undefined) || "",
            "side-BC": (parsed.BC as string | undefined) || "",
            "side-AC": (parsed.AC as string | undefined) || "",
          },
        }),
      };
    }

    const stepId = (action.stepId || "ratio") as GuidedStepKey;
    if (stepId === "ratio") {
      return {
        ...action,
        value: JSON.stringify({
          inputs: Object.fromEntries(
            Object.entries(parsed).map(([role, value]) => [`ratio-${role}`, value as string]),
          ),
        }),
      };
    }
    if (stepId === "third") {
      return {
        ...action,
        value: JSON.stringify({
          inputs: {
            "third-side": (parsed.third as string | undefined) || "",
          },
        }),
      };
    }
    return {
      ...action,
      value: JSON.stringify({
        inputs: {
          "final-numerator": (parsed.numerator as string | undefined) || "",
          "final-denominator": (parsed.denominator as string | undefined) || "",
        },
      }),
    };
  } catch (_error) {
    return action;
  }
}
