/**
 * ToolRegistry — a flat lookup from tool id to its machine + projector.
 *
 * The report recommends NOT building a dynamic actor system or parent
 * ToolController actor until two or three tools share a stable pattern. This
 * registry is the deliberately thin version: it proves a second tool plugs in
 * with zero changes to the Canvas's event dispatch.
 *
 * Each tool may declare a machine-specific `input` type (e.g. a mandatory task
 * spec). `startTool(toolId, input)` passes it through; projectors receive the
 * model so they can build per-entity affordances.
 */
import type { SnapshotFrom } from "xstate";
import type { AnyStateMachine } from "xstate";
import type { GeometryModel } from "../domain/model";
import { constructCircleMachine } from "./tools/construct-circle.machine";
import { projectConstructCircle } from "./tools/construct-circle.view";
import { constructParallelMachine, type ParallelActionSpec } from "./tools/construct-parallel.machine";
import { projectConstructParallel } from "./tools/construct-parallel.view";
import type { InteractionView } from "./interaction-view";

export type ToolId = "construct-parallel" | "construct-circle";

/**
 * Per-tool input contract. `construct-parallel` requires a ParallelActionSpec
 * (task-driven, no free mode); `construct-circle` currently takes no input.
 * Keys mirror {@link ToolId}.
 */
export interface ToolInput {
  "construct-parallel": ParallelActionSpec;
  "construct-circle": undefined;
}

export interface ToolDefinition {
  id: ToolId;
  title: string;
  goal: string;
  machine: AnyStateMachine;
  /** Pure projector: (snapshot, model) -> InteractionView. */
  project(snapshot: SnapshotFrom<AnyStateMachine>, model: GeometryModel): InteractionView;
}

export const TOOL_REGISTRY: Record<ToolId, ToolDefinition> = {
  "construct-parallel": {
    id: "construct-parallel",
    title: "过点作平行线",
    goal: "选择经过的点，再选参考直线，构造平行线",
    machine: constructParallelMachine as unknown as AnyStateMachine,
    project: (snapshot, model) =>
      projectConstructParallel(snapshot as SnapshotFrom<typeof constructParallelMachine>, model),
  },
  "construct-circle": {
    id: "construct-circle",
    title: "过点作圆",
    goal: "选择圆心，再选经过的点，构造圆",
    machine: constructCircleMachine as unknown as AnyStateMachine,
    project: (snapshot, model) =>
      projectConstructCircle(snapshot as SnapshotFrom<typeof constructCircleMachine>, model),
  },
};

export function getTool(toolId: ToolId): ToolDefinition {
  const tool = TOOL_REGISTRY[toolId];
  if (!tool) throw new Error(`Unknown tool: ${toolId}`);
  return tool;
}
