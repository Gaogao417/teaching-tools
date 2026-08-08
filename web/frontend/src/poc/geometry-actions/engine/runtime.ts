/**
 * Runtime — the generic engine that drives a Program forward.
 *
 * CRITICAL INVARIANT: this file knows NOTHING about specific actions. It does
 * not import makeParallel / markSegmentValue. It has no `switch(actionKind)`,
 * no `if (action.kind === ...)`. It only talks to the RuntimeAction interface.
 *
 * The flow is:
 *
 *   current Action = program[actionIndex]
 *   view()   -> GeometryCanvas renders InteractionView
 *   event    -> reduce()
 *      continue -> update actionState
 *      reject   -> keep actionState, set feedback
 *      complete -> world = commit(world, result); advance actionIndex;
 *                  init next action or mark finished
 *
 * All functions here are PURE: they take a snapshot and return a new one.
 */
import type { RuntimeAction, RuntimeTransition } from "../domain/action.ts";
import type { GeometryEvent } from "../domain/events.ts";
import type { InteractionView } from "../domain/interaction.ts";
import type { WorldState } from "../domain/geometry.ts";
import type { Program } from "./program.ts";

export interface RuntimeFeedback {
  kind: "error" | "success" | "info";
  message: string;
}

export interface RuntimeSnapshot {
  program: Program;
  world: WorldState;
  actionIndex: number;
  actionState: unknown;
  finished: boolean;
  feedback?: RuntimeFeedback;
}

export function initRuntime(program: Program, world: WorldState): RuntimeSnapshot {
  const first = program[0];
  if (!first) {
    return { program, world, actionIndex: 0, actionState: null, finished: true };
  }
  return {
    program,
    world,
    actionIndex: 0,
    actionState: first.init(world),
    finished: false,
  };
}

function currentAction(snapshot: RuntimeSnapshot): RuntimeAction | undefined {
  if (snapshot.finished) return undefined;
  return snapshot.program[snapshot.actionIndex];
}

/**
 * Feed one GeometryEvent into the runtime. Returns a NEW snapshot; never mutates.
 */
export function dispatch(snapshot: RuntimeSnapshot, event: GeometryEvent): RuntimeSnapshot {
  const action = currentAction(snapshot);
  if (!action) return snapshot;

  const transition: RuntimeTransition = action.reduce(
    snapshot.actionState,
    event,
    snapshot.world,
  );

  if (transition.kind === "continue") {
    return { ...snapshot, actionState: transition.state };
  }

  if (transition.kind === "reject") {
    return {
      ...snapshot,
      actionState: transition.state,
      feedback: { kind: "error", message: transition.message },
    };
  }

  // complete -> commit world, advance
  const nextWorld = action.commit(snapshot.world, transition.result);
  const nextIndex = snapshot.actionIndex + 1;
  const nextAction = snapshot.program[nextIndex];

  if (!nextAction) {
    return {
      ...snapshot,
      world: nextWorld,
      actionIndex: nextIndex,
      actionState: null,
      finished: true,
      feedback: { kind: "success", message: "全部完成！" },
    };
  }

  return {
    ...snapshot,
    world: nextWorld,
    actionIndex: nextIndex,
    actionState: nextAction.init(nextWorld),
    feedback: { kind: "success", message: "步骤完成，继续下一步。" },
  };
}

/**
 * Compute the InteractionView for the current action (or null if finished).
 */
export function viewOf(snapshot: RuntimeSnapshot): InteractionView | null {
  const action = currentAction(snapshot);
  if (!action) return null;
  return action.view(snapshot.actionState, snapshot.world);
}
