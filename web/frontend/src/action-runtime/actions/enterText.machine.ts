import type { EnterTextAction } from "../../../../shared/actionRuntime";
import { createActorFromDefinition } from "./actionDefinition";
import { createFormMachineDefinition } from "./formMachine";

export const enterTextDefinition = createFormMachineDefinition<EnterTextAction>("enter-text", {
  availableLineIds: () => [],
  maxLines: () => 0,
  structurallyReady: (context) => Boolean(context.answers.value?.trim()),
  locallyCorrect: (context) => !context.contract.input.expectedValues || context.contract.input.expectedValues.includes(context.answers.value || ""),
  evidence: (context) => ({ actionId: context.contract.actionId, sourceStepId: context.contract.sourceStepId, kind: "enter-text", version: 1, value: context.answers.value }),
});

export const createEnterTextActor = (contract: EnterTextAction) => createActorFromDefinition(enterTextDefinition, contract);
