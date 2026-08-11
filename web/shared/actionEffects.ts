import type { WorldProjection } from "./actionRuntime";
import { applyDomainCommands, type DomainCommand } from "./actionWorld";

export type WorkspaceCommand = { target: "diagram"; command: DomainCommand };

export interface ActionEffectBatch {
  actionId: string;
  sourceStepId: string;
  commands: WorkspaceCommand[];
  committed: boolean;
}

export class WorkspaceCommandError extends Error {
  constructor(readonly target: WorkspaceCommand["target"], message: string, readonly cause?: unknown) {
    super(message);
  }
}

/** Immutable application makes the batch atomic: a later failure never exposes a partial projection. */
export function applyActionEffectBatch(world: WorldProjection, batch: ActionEffectBatch): WorldProjection {
  let next = world;
  try {
    const diagram = batch.commands.filter((item) => item.target === "diagram").map((item) => item.command as DomainCommand);
    if (diagram.length) next = applyDomainCommands(next, diagram);
  } catch (cause) {
    throw new WorkspaceCommandError("diagram", `Diagram effect failed for ${batch.actionId}`, cause);
  }
  return next;
}

export function replayActionEffectBatches(committed: WorldProjection, batches: readonly ActionEffectBatch[]): WorldProjection {
  return batches.reduce((world, batch) => applyActionEffectBatch(world, batch), committed);
}

export const diagramEffects = (commands: readonly DomainCommand[]): WorkspaceCommand[] => commands.map((command) => ({
  target: "diagram" as const,
  command,
}));
