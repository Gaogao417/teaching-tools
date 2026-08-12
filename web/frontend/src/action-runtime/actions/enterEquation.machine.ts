import type { EnterEquationAction } from "../../../../shared/actionRuntime";
import type { DomainCommand } from "../../../../shared/actionWorld";
import { createActorFromDefinition } from "./actionDefinition";
import { createFormMachineDefinition } from "./formMachine";

function emphasisCommands(contract: EnterEquationAction, factors: string[]): DomainCommand[] {
  const entityIds = factors.filter((factor) => contract.input.availableSegmentIds.includes(factor));
  return entityIds.length ? [{
    commandId: `${contract.actionId}/emphasis`,
    actionId: contract.actionId,
    type: "set-emphasis",
    markId: `${contract.actionId}/emphasis`,
    entityIds,
  }] : [];
}

export const enterEquationDefinition = createFormMachineDefinition<EnterEquationAction>("enter-equation", {
  availableLineIds: (contract) => contract.input.availableSegmentIds,
  maxLines: () => 3,
  expectedLineAt: (contract, index) => contract.input.expectedOrder?.[index],
  slotValue: (context, slotId) => slotId === "known-factor" ? context.lines[0] || "" : context.answers[slotId] || "",
  structurallyReady: (context) => {
    const factorsReady = context.contract.input.shareValues
      ? context.lines.length >= 1 && Boolean(context.answers.numerator?.trim()) && Boolean(context.answers.denominator?.trim())
      : context.lines.length >= 3;
    return factorsReady && Boolean(context.answers.result?.trim());
  },
  locallyCorrect: (context) => {
    const factors = context.contract.input.shareValues
      ? [context.lines[0], context.answers.numerator, context.answers.denominator]
      : context.lines;
    return (!context.contract.input.expectedOrder || context.contract.input.expectedOrder.every((id, index) => factors[index] === id))
      && (!context.contract.input.expectedResult || context.answers.result === context.contract.input.expectedResult);
  },
  evidence: (context) => ({
    actionId: context.contract.actionId,
    sourceStepId: context.contract.sourceStepId,
    kind: "enter-equation",
    version: 1,
    factors: context.contract.input.shareValues
      ? [context.lines[0], context.answers.numerator, context.answers.denominator]
      : [...context.lines],
    result: context.answers.result,
  }),
  commands: (contract, evidence) => evidence.kind === "enter-equation" ? emphasisCommands(contract, evidence.factors) : [],
  previewCommands: (context) => emphasisCommands(context.contract, context.lines),
  teachingEvents: (contract) => {
    const result = contract.input.expectedResult;
    if (!result) return [];
    if (contract.input.shareValues) {
      const known = contract.input.expectedOrder?.[0] || contract.input.availableSegmentIds[0];
      if (!known) return [];
      return [
        { type: "OBJECT.SELECTED" as const, objectKind: "line" as const, objectId: known },
        { type: "ANSWER.CHANGED" as const, slotId: "numerator", value: contract.input.shareValues[0] },
        { type: "ANSWER.CHANGED" as const, slotId: "denominator", value: contract.input.shareValues[1] },
        { type: "ANSWER.CHANGED" as const, slotId: "result", value: result },
        { type: "SUBMIT" as const },
      ];
    }
    if (contract.input.expectedOrder?.length !== 3) return [];
    return [
      ...contract.input.expectedOrder.map((objectId) => ({ type: "OBJECT.SELECTED" as const, objectKind: "line" as const, objectId })),
      { type: "ANSWER.CHANGED" as const, slotId: "result", value: result },
      { type: "SUBMIT" as const },
    ];
  },
});

export const createEnterEquationActor = (contract: EnterEquationAction) => createActorFromDefinition(enterEquationDefinition, contract);
