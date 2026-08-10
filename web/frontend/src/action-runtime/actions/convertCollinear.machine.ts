import type { ConvertCollinearAction } from "../../../../shared/actionRuntime";
import { createActorFromDefinition } from "./actionDefinition";
import { createFormMachineDefinition } from "./formMachine";

export const convertCollinearDefinition = createFormMachineDefinition<ConvertCollinearAction>("convert-collinear", {
  availableLineIds: (contract) => contract.input.availableSegmentIds,
  maxLines: () => 3,
  expectedLineAt: (contract, index) => contract.input.expectedOrder?.[index],
  slotValue: (context, slotId) => ({
    "whole-segment": context.lines[0],
    "target-segment": context.lines[1],
    "known-segment": context.lines[2],
  }[slotId] || ""),
  structurallyReady: (context) => context.lines.length === 3,
  locallyCorrect: (context) => !context.contract.input.expectedOrder || context.contract.input.expectedOrder.every((id, index) => context.lines[index] === id),
  evidence: (context) => ({ actionId: context.contract.actionId, sourceStepId: context.contract.sourceStepId, kind: "convert-collinear", version: 1, segmentIds: [...context.lines] }),
  projectStepRecord: (_contract, { evidence }) => ({ summary: evidence?.segmentIds.join("、") }),
});

export const createConvertCollinearActor = (contract: ConvertCollinearAction) => createActorFromDefinition(convertCollinearDefinition, contract);
