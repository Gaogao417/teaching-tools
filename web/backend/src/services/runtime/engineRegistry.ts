import { ContentDefinition, ExerciseEngineKind, RuntimeActionEvent, SessionPhase, TaskDefinition } from "../../../../shared/contracts";
import {
  buildRuntimeForState,
  createTriangleTrigState,
  reduceTriangleTrigAction,
  TriangleTrigEngineState,
} from "./triangleTrigEngine";
import { appError } from "./errors";

export type EnginePlugin = {
  createState: (task: TaskDefinition, content: ContentDefinition, index: number) => TriangleTrigEngineState;
  buildRuntime: (
    task: TaskDefinition,
    content: ContentDefinition,
    state: TriangleTrigEngineState,
    phase: SessionPhase,
  ) => ReturnType<typeof buildRuntimeForState>;
  reduceAction: (
    task: TaskDefinition,
    content: ContentDefinition,
    state: TriangleTrigEngineState,
    action: RuntimeActionEvent,
  ) => ReturnType<typeof reduceTriangleTrigAction>;
};

const ENGINE_REGISTRY: Record<ExerciseEngineKind, EnginePlugin> = {
  "triangle-trig": {
    createState: createTriangleTrigState,
    buildRuntime: buildRuntimeForState,
    reduceAction: reduceTriangleTrigAction,
  },
};

export function getEnginePlugin(engineKind: ExerciseEngineKind): EnginePlugin {
  const plugin = ENGINE_REGISTRY[engineKind];
  if (!plugin) {
    throw appError("RUNTIME_CONTRACT_INVALID", `Engine ${engineKind} not registered`, 500);
  }
  return plugin;
}
