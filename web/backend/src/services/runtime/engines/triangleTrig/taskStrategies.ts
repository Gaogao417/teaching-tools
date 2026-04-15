import type { TriangleTrigTaskId } from "../../../../../../shared/triangleTrig";
import type { TriangleTrigEngineState } from "./types";
import { meaningStrategy } from "./strategies/meaning";
import { ratioToSideStrategy } from "./strategies/ratioToSide";
import { guidedSolveStrategy } from "./strategies/guidedSolve";

export type { TriangleTrigProjectionModel, TriangleTrigSubmitResult, TriangleTrigTaskStrategy } from "./types";

const TASK_STRATEGIES = {
  meaning: meaningStrategy,
  ratioToSide: ratioToSideStrategy,
  guidedSolve: guidedSolveStrategy,
} as const;

export function getTriangleTrigTaskStrategy<TTaskId extends TriangleTrigTaskId>(
  taskId: TTaskId,
): import("./types").TriangleTrigTaskStrategy<Extract<TriangleTrigEngineState, { taskId: TTaskId }>> {
  return TASK_STRATEGIES[taskId] as unknown as import("./types").TriangleTrigTaskStrategy<
    Extract<TriangleTrigEngineState, { taskId: TTaskId }>
  >;
}
