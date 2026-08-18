import type { EnterTextAction } from "../../../../shared/actionRuntime";
import { normalizedTextAccepted } from "../../../../shared/actionAnswerEquivalence";
import { createActorFromDefinition } from "./actionDefinition";
import { createFormMachineDefinition } from "./formMachine";

export const enterTextDefinition = createFormMachineDefinition<EnterTextAction>("enter-text", {
  availableLineIds: () => [],
  maxLines: () => 0,
  structurallyReady: (context) => Boolean(context.answers.value?.trim()),
  locallyCorrect: (context) => normalizedTextAccepted(
    context.answers.value,
    context.contract.input.expectedValues,
    context.contract.input.answerNormalization,
  ),
  evidence: (context) => ({ actionId: context.contract.actionId, sourceStepId: context.contract.sourceStepId, kind: "enter-text", version: 1, value: context.answers.value }),
  teachingEvents: (contract) => contract.input.expectedValues?.[0] ? [
    { type: "ANSWER.CHANGED", slotId: "value", value: contract.input.expectedValues[0] },
    { type: "SUBMIT" },
  ] : [],
});

export const createEnterTextActor = (contract: EnterTextAction) => createActorFromDefinition(enterTextDefinition, contract);
