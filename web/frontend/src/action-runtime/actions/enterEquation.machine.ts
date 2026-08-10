import type { EnterEquationAction } from "../../../../shared/actionRuntime";
import { createActorFromDefinition } from "./actionDefinition";
import { createFormMachineDefinition } from "./formMachine";

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
  projectStepRecord: (_contract, { evidence }) => ({ summary: evidence?.result ? `结果 ${evidence.result}` : undefined }),
});

export const createEnterEquationActor = (contract: EnterEquationAction) => createActorFromDefinition(enterEquationDefinition, contract);
