import type { RuntimeActionEvent } from "../../../../../../shared/contracts";
import { appError } from "../../platform/errors";
import type { AngleEquationEngineState, RuntimeDraftPayload } from "./types";

// ─── Parse draft payload from action ─────────────────────────────────

export function parseDraftPayload(action: RuntimeActionEvent): RuntimeDraftPayload {
  if (action.type !== "submit") return {};
  if (!action.value) return {};
  try {
    return JSON.parse(action.value) as RuntimeDraftPayload;
  } catch {
    throw appError("ANSWER_INVALID", "Submit payload is invalid JSON");
  }
}

// ─── Clone state (deep copy) ─────────────────────────────────────────

export function cloneAngleEquationState(
  state: AngleEquationEngineState,
): AngleEquationEngineState {
  return JSON.parse(JSON.stringify(state));
}
