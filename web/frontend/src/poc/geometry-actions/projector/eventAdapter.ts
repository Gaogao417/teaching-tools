/**
 * eventAdapter — accumulates a local draft from GeometryEvents and produces
 * RuntimeActionEvents to submit to the backend.
 *
 * This mirrors what the production frontend does (InteractionZoneLayer +
 * RuntimeActionDock): clicks/inputs only mutate a local draft; nothing leaves
 * the browser until Submit. The draft is then serialized into the
 * RuntimeActionEvent.value envelope the backend parses.
 *
 * The adapter is GENERIC: it does not know which engine/step is active. It keys
 * selections/inputs by target id, which the backend's parseDraftPayload reads
 * back. This is the production shape ({ selections, inputs }).
 *
 * No React. No JSXGraph.
 */
import type { GeometryEvent } from "../domain/events.ts";
import type { RuntimeActionEvent } from "../shared/runtimeContracts.ts";

export interface DraftState {
  selections: Record<string, string[]>;
  inputs: Record<string, string>;
}

export function emptyDraft(): DraftState {
  return { selections: {}, inputs: {} };
}

/**
 * Fold a GeometryEvent into the draft. Returns a NEW draft (immutable update).
 *
 * The `selectionSlot` tells the adapter which draft slot a click targets — this
 * is the one piece of context the adapter needs from the current step. It maps
 * a clickable point/segment id onto a named selection key the backend reads
 * (e.g. "through-point", "parallel-segment", "segment").
 */
export function applyEvent(
  draft: DraftState,
  event: GeometryEvent,
  selectionSlot?: string,
): DraftState {
  if (event.kind === "point-click" || event.kind === "segment-click") {
    if (!selectionSlot) return draft;
    return {
      ...draft,
      selections: {
        ...draft.selections,
        [selectionSlot]: [event.id], // single selection per slot
      },
    };
  }
  if (event.kind === "input-change") {
    return {
      ...draft,
      inputs: { ...draft.inputs, [event.objectId]: event.value },
    };
  }
  return draft;
}

/** Build the RuntimeActionEvent to submit for the given step. */
export function buildSubmitAction(stepId: string, draft: DraftState): RuntimeActionEvent {
  return {
    type: "submit",
    stepId,
    value: JSON.stringify({ selections: draft.selections, inputs: draft.inputs }),
  };
}
