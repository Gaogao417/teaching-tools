import type { BuoyancyVariableKey } from "../../../../../../shared/buoyancyForceAnalysis";
import type { RuntimeActionEvent } from "../../../../../../shared/contracts";
import { appError } from "../../platform/errors";
import type { BuoyancyEngineState, RuntimeDraftPayload } from "./types";

export const VARIABLE_LABELS: Record<BuoyancyVariableKey, { force: string; mass?: string }> = {
  F: { force: "F" },
  Fb: { force: "F浮" },
  Gobj: { force: "G物", mass: "m物" },
  Gwater: { force: "G水", mass: "m水" },
  Ftable: { force: "F桌" },
};

export function parseDraftPayload(action: RuntimeActionEvent): RuntimeDraftPayload {
  if (action.type !== "submit") return {};
  if (!action.value) return {};
  try {
    return JSON.parse(action.value) as RuntimeDraftPayload;
  } catch {
    throw appError("ANSWER_INVALID", "Submit payload is invalid JSON");
  }
}

export function cloneBuoyancyState(state: BuoyancyEngineState): BuoyancyEngineState {
  return JSON.parse(JSON.stringify(state));
}
