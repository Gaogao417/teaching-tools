import type { ConvertCollinearAction } from "../../../../shared/actionRuntime";
import type { DomainCommand } from "../../../../shared/actionWorld";
import { createActorFromDefinition } from "./actionDefinition";
import { createFormMachineDefinition } from "./formMachine";

function emphasisCommands(contract: ConvertCollinearAction, entityIds: string[]): DomainCommand[] {
  return entityIds.length ? [{
    commandId: `${contract.actionId}/emphasis`,
    actionId: contract.actionId,
    type: "set-emphasis",
    markId: `${contract.actionId}/emphasis`,
    entityIds,
  }] : [];
}

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
  commands: (contract, evidence) => evidence.kind === "convert-collinear" ? emphasisCommands(contract, evidence.segmentIds) : [],
  previewCommands: (context) => emphasisCommands(context.contract, context.lines),
});

export const createConvertCollinearActor = (contract: ConvertCollinearAction) => createActorFromDefinition(convertCollinearDefinition, contract);
