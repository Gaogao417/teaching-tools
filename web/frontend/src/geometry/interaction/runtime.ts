/**
 * InteractionRuntime — the thin controller between a tool machine and the
 * domain.
 *
 * Responsibilities (design report §06 + Appendix A):
 *  - create/destroy the active tool actor here, never in component code;
 *  - forward semantic {@link CanvasEvent}s to the actor;
 *  - project snapshots into {@link InteractionView} for the Canvas;
 *  - on completion, hand the produced GeometryCommand to the executor (the
 *    single mutation entry point) and notify listeners.
 *
 * It deliberately knows nothing about React or JSXGraph.
 */
import { createActor, type Actor, type AnyStateMachine, type SnapshotFrom } from "xstate";
import type { CommandExecutor, CommandResult } from "../domain/command-executor";
import type { GeometryCommand } from "../domain/commands";
import type { GeometryModel } from "../domain/model";
import type { CanvasEvent } from "./events";
import { idleView, type InteractionView } from "./interaction-view";
import type { ToolDefinition, ToolEvidence, ToolId, ToolInput } from "./tool-registry";
import { getTool } from "./tool-registry";

type Listener = () => void;

export interface ToolCompleted {
  toolId: ToolId;
  command: GeometryCommand;
  result: CommandResult;
  /**
   * Teaching evidence extracted from the completed snapshot (the learner's
   * clicks), distinct from the math command. Present only when the tool
   * declares {@link ToolDefinition.extractEvidence}. Production wiring
   * serializes this into the existing `topic-answer` string.
   */
  evidence?: ToolEvidence[ToolId];
}

export interface InteractionRuntime {
  /**
   * Begin a tool run. Replaces any active tool. `input` is the tool's task
   * contract (e.g. ParallelActionSpec); typed per tool via {@link ToolInput}.
   */
  startTool<Id extends ToolId>(toolId: Id, input: ToolInput[Id]): void;
  /** Stop the current tool without producing a command. */
  cancel(): void;
  /** Forward a semantic event to the active actor (no-op if no tool active). */
  send(event: CanvasEvent): void;
  /** Current projected view (idleView when no tool is active). */
  getView(): InteractionView;
  /** The tool currently active, if any. */
  activeToolId(): ToolId | undefined;
  /** Subscribe to runtime changes; returns an unsubscribe fn. */
  subscribe(listener: Listener): () => void;
  /** Register a callback fired once per completed tool run. */
  onDone(handler: (completed: ToolCompleted) => void): () => void;
}

export function createInteractionRuntime(executor: CommandExecutor, model: GeometryModel): InteractionRuntime {
  let tool: ToolDefinition | undefined;
  let actor: Actor<AnyStateMachine> | undefined;
  const listeners = new Set<Listener>();
  const doneHandlers = new Set<(completed: ToolCompleted) => void>();

  // Cached view: getView() must return a referentially stable InteractionView
  // between notifications, or useSyncExternalStore will loop forever. We
  // recompute it on every notify() and hand out the cached reference.
  let cachedView: InteractionView = idleView;

  function recomputeView() {
    if (!actor || !tool) {
      cachedView = idleView;
      return;
    }
    const snapshot = actor.getSnapshot() as SnapshotFrom<AnyStateMachine>;
    cachedView = tool.project(snapshot, model);
  }

  function notify() {
    recomputeView();
    for (const l of listeners) l();
  }

  function teardown() {
    if (actor) {
      actor.stop();
      actor = undefined;
    }
    tool = undefined;
  }

  return {
    startTool<Id extends ToolId>(toolId: Id, input: ToolInput[Id]) {
      teardown();
      tool = getTool(toolId);
      actor = createActor(tool.machine, { input });
      actor.subscribe(() => notify());
      actor.start();

      // Watch for the machine reaching a final state: forward its output to the
      // executor (or treat cancellation as a no-op), then clear the tool.
      actor.subscribe((snapshot) => {
        if (snapshot.status !== "done") return;
        const output = snapshot.output as { type: string } | undefined;
        const activeTool = tool;
        const activeActor = actor;
        if (!output || output.type === "cancelled" || !activeTool || !activeActor) {
          teardown();
          notify();
          return;
        }
        const command = output as GeometryCommand;
        const result = executor.execute(command);
        // Evidence is harvested from the just-completed snapshot before teardown.
        // It is orthogonal to the math command — the learner's clicks, used by
        // production to serialize the `topic-answer` string.
        const evidence = activeTool.extractEvidence?.(activeActor.getSnapshot());
        for (const h of doneHandlers) h({ toolId: activeTool.id, command, result, evidence });
        teardown();
        notify();
      });

      notify();
    },

    cancel() {
      if (actor) actor.send({ type: "CANCEL" });
    },

    send(event: CanvasEvent) {
      if (actor) actor.send(event);
    },

    getView(): InteractionView {
      return cachedView;
    },

    activeToolId() {
      return tool?.id;
    },

    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    onDone(handler: (completed: ToolCompleted) => void) {
      doneHandlers.add(handler);
      return () => doneHandlers.delete(handler);
    },
  };
}
