import type { ActionContract } from "../../../shared/actionRuntime";
import { actionMachineRegistry } from "./registry";

/** Compatibility facade; all dispatch and validation lives in the registry. */
export function createActionActor(contract: ActionContract) {
  return actionMachineRegistry.create(contract);
}
