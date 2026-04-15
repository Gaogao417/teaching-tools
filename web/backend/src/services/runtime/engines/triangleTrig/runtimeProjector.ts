import type {
  ExerciseInstance,
  ExerciseRuntimeSpec,
  FeedbackCue,
  FeedbackSpec,
  GuideSpec,
  InteractionZone,
  SceneEntity,
  SceneSpec,
  SessionPhase,
  TaskDefinition,
  TriangleTrigContentDefinition,
} from "../../../../../../shared/contracts";
import type { Side } from "../../../../../../shared/triangleTrig";
import { getTriangleTrigTaskStrategy } from "./taskStrategies";
import { SIDE_POINTS, VERTICES, renderTemplate, roleForSide } from "./shared";
import type { TriangleTrigEngineState } from "./types";

function makeCue(key: string, scope: FeedbackCue["scope"], targetRef?: string): FeedbackCue {
  return { key, scope, targetRef };
}

function buildFeedback(currentStepId: string): FeedbackSpec {
  return {
    correct: [makeCue("correct", "global"), makeCue("highlight-correct", "workspace", currentStepId)],
    wrong: [makeCue("wrong", "global"), makeCue("highlight-wrong", "guide", currentStepId)],
    finish: [makeCue("finish", "global")],
  };
}

export function buildTriangleTrigFeedbackPacket(
  currentStepId: string,
  evaluation: "correct" | "wrong" | "progress",
) {
  const feedback = buildFeedback(currentStepId);
  if (evaluation === "correct") {
    return { global: feedback.correct, workspace: feedback.correct, guide: [] };
  }
  if (evaluation === "wrong") {
    return { global: feedback.wrong, workspace: [], guide: feedback.wrong };
  }
  return { global: [], workspace: [], guide: [] };
}

function buildBaseEntities(state: TriangleTrigEngineState): SceneEntity[] {
  const entities: SceneEntity[] = [
    {
      id: "triangle-main",
      kind: "triangle",
      vertices: VERTICES,
      rightAnglePath: "M292 288 L292 260 L320 260",
      referenceAnglePath:
        state.referenceAngle === "A"
          ? "M124 288 A34 34 0 0 1 111 259"
          : "M320 146 A34 34 0 0 1 290 134",
    },
    { id: "vertex-A", kind: "vertex", x: VERTICES.A.x, y: VERTICES.A.y, label: "A" },
    { id: "vertex-B", kind: "vertex", x: VERTICES.B.x, y: VERTICES.B.y, label: "B" },
    { id: "vertex-C", kind: "vertex", x: VERTICES.C.x, y: VERTICES.C.y, label: "C" },
  ];

  for (const side of ["AB", "BC", "AC"] as Side[]) {
    const [from, to] = side.split("") as Array<"A" | "B" | "C">;
    entities.push({
      id: `edge-${side}`,
      kind: "edge",
      from: `vertex-${from}`,
      to: `vertex-${to}`,
      label: side,
      role: roleForSide(state.referenceAngle, side),
    });
  }

  entities.push({
    id: "scene-angle",
    kind: "text",
    text: `参考角 ${state.referenceAngle}`,
    x: 372,
    y: 40,
    variant: "angle-badge",
  });

  return entities;
}

function buildZones(): InteractionZone[] {
  return (["AB", "BC", "AC"] as Side[]).map((side) => ({
    id: `zone-${side}`,
    zoneKind: "edge",
    targetRef: `edge-${side}`,
    shape: SIDE_POINTS[side].hitZone,
    accepts: ["select"],
  }));
}

function buildScene(state: TriangleTrigEngineState, taskEntities: SceneEntity[], anchors: SceneSpec["anchors"]): SceneSpec {
  return {
    sceneKind: "triangle",
    entities: [...buildBaseEntities(state), ...taskEntities],
    zones: buildZones(),
    anchors,
    overlays: [],
  };
}

function buildGuide(
  content: TriangleTrigContentDefinition,
  phase: SessionPhase,
  flow: ExerciseInstance["flow"],
  defaultHint: string,
  wrongHint: string,
  completedSummary: (stepId: string) => string,
): GuideSpec {
  return {
    banner: content.guideTemplate.banner,
    hint: phase === "wrong_feedback" ? wrongHint : defaultHint,
    statusCopy: phase === "wrong_feedback" ? "请回到左侧修正当前步骤。" : "左侧负责操作，右侧负责引导。",
    stepItems: content.flowTemplate.guideSteps.map((step) => {
      const flowStep = flow.steps.find((item) => item.id === step.stepId);
      return {
        stepId: step.stepId,
        title: step.title,
        status: flowStep?.status || "locked",
        summary: flowStep?.status === "done" ? completedSummary(step.stepId) : step.summary,
      };
    }),
  };
}

function buildInstance(
  task: TaskDefinition,
  content: TriangleTrigContentDefinition,
  state: TriangleTrigEngineState,
  phase: SessionPhase,
): ExerciseInstance {
  const projection = getTriangleTrigTaskStrategy(state.taskId).buildProjectionModel(content, state);

  return {
    instanceId: state.instanceId,
    taskId: task.id,
    engineKind: task.engineKind,
    contentId: content.id,
    prompt: renderTemplate(content.promptTemplate, projection.promptVars),
    scene: buildScene(state, projection.taskEntities, projection.anchors),
    flow: projection.flow,
    guide: buildGuide(
      content,
      phase,
      projection.flow,
      projection.defaultHint,
      projection.wrongHint,
      projection.completedSummary,
    ),
    feedback: buildFeedback(projection.currentStepId),
  };
}

export function buildTriangleTrigRuntime(
  task: TaskDefinition,
  content: TriangleTrigContentDefinition,
  state: TriangleTrigEngineState,
  phase: SessionPhase,
): ExerciseRuntimeSpec {
  const projection = getTriangleTrigTaskStrategy(state.taskId).buildProjectionModel(content, state);
  return {
    instance: buildInstance(task, content, state, phase),
    runtimeState: {
      phase,
      currentStepId: projection.currentStepId,
      completedStepIds: projection.completedStepIds,
      problemStatus: state.status,
      attempts: state.attempts,
    },
  };
}
