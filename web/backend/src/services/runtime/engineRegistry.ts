import { ExerciseEngineKind } from "../../../../shared/contracts";
import { demoCounterEnginePlugin } from "./demoCounterEngine";
import {
  buildRuntimeForState,
  createTriangleTrigState,
  reduceTriangleTrigAction,
  restoreTriangleTrigState,
} from "./triangleTrigEngine";
import { appError } from "./errors";
import { defineEnginePlugin, type RegisteredEnginePlugin } from "./engineTypes";
import { runtimeActionToEngineAction } from "./legacyAdapter";

const ENGINE_REGISTRY = {
  "triangle-trig": defineEnginePlugin({
    createState: createTriangleTrigState,
    restoreState: restoreTriangleTrigState,
    adaptAction: (state, action) => runtimeActionToEngineAction(action, state),
    buildRuntime: buildRuntimeForState,
    reduceAction: reduceTriangleTrigAction,
  }),
  "demo-counter": demoCounterEnginePlugin,
} satisfies Record<ExerciseEngineKind, RegisteredEnginePlugin>;

export function getEnginePlugin(engineKind: ExerciseEngineKind): RegisteredEnginePlugin {
  const plugin = ENGINE_REGISTRY[engineKind];
  if (!plugin) {
    throw appError("RUNTIME_CONTRACT_INVALID", `Engine ${engineKind} not registered`, 500);
  }
  return plugin;
}
