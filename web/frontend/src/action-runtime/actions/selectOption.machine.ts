import type { SelectOptionAction } from "../../../../shared/actionRuntime";
import { createActorFromDefinition, projectBoardSlotValues } from "./actionDefinition";
import { createFormMachineDefinition } from "./formMachine";

export const selectOptionDefinition = createFormMachineDefinition<SelectOptionAction>("select-option", {
  availableLineIds: () => [],
  maxLines: () => 0,
  structurallyReady: (context) => Boolean(context.answers.choice),
  locallyCorrect: (context) => !context.contract.input.expectedValue || context.answers.choice === context.contract.input.expectedValue,
  evidence: (context) => ({ actionId: context.contract.actionId, sourceStepId: context.contract.sourceStepId, kind: "select-option", version: 1, value: context.answers.choice }),
  boardPreview: (context) => projectBoardSlotValues(context.contract, { value: context.answers.choice }),
});

export const createSelectOptionActor = (contract: SelectOptionAction) => createActorFromDefinition(selectOptionDefinition, contract);
