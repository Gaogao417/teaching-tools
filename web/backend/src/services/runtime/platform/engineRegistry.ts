import { ExerciseEngineKind } from "../../../../../shared/contracts";
import { triangleTrigEnginePlugin } from "../engines/triangleTrig";
import { demoCounterEnginePlugin } from "../engines/demoCounter";
import { appError } from "./errors";
import type { RegisteredEnginePlugin } from "./engineTypes";

const ENGINE_REGISTRY = {
  "triangle-trig": triangleTrigEnginePlugin,
  "demo-counter": demoCounterEnginePlugin,
} satisfies Record<ExerciseEngineKind, RegisteredEnginePlugin>;

export function getEnginePlugin(engineKind: ExerciseEngineKind): RegisteredEnginePlugin {
  const plugin = ENGINE_REGISTRY[engineKind];
  if (!plugin) {
    throw appError("RUNTIME_CONTRACT_INVALID", `Engine ${engineKind} not registered`, 500);
  }
  return plugin;
}
