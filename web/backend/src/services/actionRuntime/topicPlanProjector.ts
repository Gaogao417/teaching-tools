import {
  ACTION_RUNTIME_PLAN_VERSION,
  type ActionContract,
  type AuthoredActionTemplate,
  type ExercisePlan,
  type LearningMode,
  type ValidationPolicy,
} from "../../../../shared/actionRuntime";
import type { TopicGeometryModel, TopicResolvedScenario } from "../../../../shared/topicPractice";
import type { SessionKind } from "../../../../shared/similarityLearningMap";
import type { TopicPracticeEngineState } from "../runtime/engines/topicPractice/types";
import { currentScenario, runtimeStepEntries } from "../runtime/engines/topicPractice";

function modeFor(state: TopicPracticeEngineState, sessionKind: SessionKind): LearningMode {
  if (state.isLearningProjection) return "learn";
  if (sessionKind === "challenge") return "assessment";
  return "guided-practice";
}

function validationFor(mode: LearningMode): ValidationPolicy {
  return mode === "learn" ? "local-teaching" : "server-authoritative";
}

function mergedLearningGeometry(scenario: TopicResolvedScenario): TopicGeometryModel | undefined {
  const geometries = [scenario.promptGeometry, ...scenario.steps.map((step) => step.interaction?.geometry)].filter(
    (geometry): geometry is TopicGeometryModel => Boolean(geometry),
  );
  if (!geometries.length) return undefined;
  return {
    viewBox: {
      width: Math.max(...geometries.map((geometry) => geometry.viewBox.width)),
      height: Math.max(...geometries.map((geometry) => geometry.viewBox.height)),
    },
    points: [...new Map(geometries.flatMap((geometry) => geometry.points).map((point) => [point.id, point])).values()],
    segments: [...new Map(geometries.flatMap((geometry) => geometry.segments).map((segment) => [segment.id, segment])).values()],
  };
}

/**
 * The runtime projector deliberately treats action-specific `input` as opaque.
 * Per-kind input validation and behavior belong to the frontend registry.
 */
export function materializeActionTemplate(template: AuthoredActionTemplate, mode: LearningMode): ActionContract {
  const input = mode === "assessment"
    ? { ...template.input }
    : { ...template.input, ...template.teachingInput };
  return {
    actionId: template.actionId,
    sourceStepId: template.sourceStepId,
    kind: template.kind,
    version: template.version,
    title: template.title,
    instruction: template.instruction,
    input,
    capabilities: mode === "assessment"
      ? template.capabilities.filter((capability) => !capability.startsWith("agent:"))
      : [...template.capabilities],
    answerSlots: template.answerSlots.map((slot) => ({ ...slot })),
    validationPolicy: validationFor(mode),
    submitOnComplete: template.submitOnComplete,
    presentation: mode === "assessment" ? undefined : template.presentation,
    coach: mode === "assessment" ? undefined : template.coach,
  } as ActionContract;
}

export function buildTopicExercisePlan(
  state: TopicPracticeEngineState,
  sessionKind: SessionKind,
  checkpointActionId?: string,
): ExercisePlan {
  const scenario = currentScenario(state);
  const mode = modeFor(state, sessionKind);
  const entries = runtimeStepEntries(state);
  const activeStepIds = new Set(entries.map(({ step }) => step.id));
  // `compileLegacy...` is reached only by old pinned scenarios. New scenario
  // records already carry the JSON action list and pass through unchanged.
  const templates = scenario.actionTemplates;
  if (!templates?.length) throw new Error(`Scenario ${scenario.id}@${scenario.version} has no authored actionTemplates`);
  const actions = templates
    .filter((template) => activeStepIds.has(template.sourceStepId))
    .map((template) => materializeActionTemplate(template, mode));
  const completedStepIds = new Set(state.completedStepIds);
  const completedActionIds = actions
    .filter((action) => completedStepIds.has(action.sourceStepId))
    .map((action) => action.actionId);
  const activeStepId = entries[state.stepIndex]?.step.id;
  const firstActiveAction = actions.find((action) => action.sourceStepId === activeStepId && !completedActionIds.includes(action.actionId));
  const checkpointAction = checkpointActionId
    ? actions.find((action) => action.actionId === checkpointActionId && action.sourceStepId === activeStepId)
    : undefined;
  const currentActionId = checkpointAction?.actionId || firstActiveAction?.actionId || actions.at(-1)?.actionId || "";
  const activeStep = entries[state.stepIndex]?.step;

  const rawGeometry = mode === "learn" ? mergedLearningGeometry(scenario) : activeStep?.interaction?.geometry || scenario.promptGeometry;
  const outputPointIds = new Set(actions.flatMap((action) => action.kind === "intersect-carriers" ? [action.input.outputPointId] : []));
  const outputLineIds = new Set(actions.flatMap((action) => action.kind === "make-parallel"
    ? [action.input.outputLineId]
    : action.kind === "intersect-carriers" ? [action.input.outputCarrierLineId] : []));
  const geometry = rawGeometry ? {
    ...rawGeometry,
    points: rawGeometry.points.filter((point) => !outputPointIds.has(point.id)),
    segments: rawGeometry.segments.filter((line) => !outputLineIds.has(line.id)),
    derivedLines: (rawGeometry.derivedLines || []).filter((line) => !outputLineIds.has(line.id)),
  } : undefined;

  return {
    planVersion: ACTION_RUNTIME_PLAN_VERSION,
    exerciseId: state.instanceId,
    revision: state.attempts,
    mode,
    metadata: {
      taskId: state.taskId,
      title: scenario.title,
      promptLatex: scenario.promptLatex,
      modelLabel: scenario.modelLabel,
      diagramAsset: activeStep?.diagramAsset || scenario.promptDiagramAsset,
      skillTags: scenario.skillTags,
    },
    world: {
      geometry,
      diagramAsset: activeStep?.diagramAsset || scenario.promptDiagramAsset,
      revision: state.attempts,
    },
    coach: {
      profileId: "topic-coach-v1",
      displayName: "陪练老师",
      avatarId: "school",
      tone: "supportive",
    },
    actions,
    currentActionId,
    completedActionIds,
  };
}
