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

// ─── Standard unit circle angle labels ───────────────────────────────

export const UNIT_CIRCLE_ANGLES = [
  "0",
  "pi/6",
  "pi/4",
  "pi/3",
  "pi/2",
  "2*pi/3",
  "3*pi/4",
  "5*pi/6",
  "pi",
  "7*pi/6",
  "5*pi/4",
  "4*pi/3",
  "3*pi/2",
  "5*pi/3",
  "7*pi/4",
  "11*pi/6",
];
