import type { PairSegmentsAction } from "../../../../shared/actionRuntime";
import type { DomainCommand } from "../../../../shared/actionWorld";
import { createActorFromDefinition } from "./actionDefinition";
import { createFormMachineDefinition } from "./formMachine";

function pairCommands(contract: PairSegmentsAction, segmentIds: string[]): DomainCommand[] {
  const commands: DomainCommand[] = [];
  for (let index = 0; index + 1 < segmentIds.length; index += 2) {
    const pairIndex = index / 2;
    commands.push({
      commandId: `${contract.actionId}/correspondence/${pairIndex}`,
      actionId: contract.actionId,
      type: "set-correspondence-mark",
      markId: `${contract.actionId}/correspondence/${pairIndex}`,
      segmentIds: [segmentIds[index], segmentIds[index + 1]],
      tickCount: pairIndex + 1,
    });
  }
  return commands;
}

export const pairSegmentsDefinition = createFormMachineDefinition<PairSegmentsAction>("pair-segments", {
  availableLineIds: (contract) => contract.input.availableSegmentIds,
  maxLines: (contract) => contract.input.pairCount * 2,
  expectedLineAt: (contract, index) => contract.input.expectedOrder?.[index],
  slotValue: (context, slotId) => slotId === "segment-pairs" ? context.lines.join(" · ") : "",
  structurallyReady: (context) => context.lines.length >= context.contract.input.pairCount * 2,
  locallyCorrect: (context) => !context.contract.input.expectedOrder || context.contract.input.expectedOrder.every((id, index) => context.lines[index] === id),
  evidence: (context) => ({ actionId: context.contract.actionId, sourceStepId: context.contract.sourceStepId, kind: "pair-segments", version: 1, segmentIds: [...context.lines] }),
  commands: (contract, evidence) => evidence.kind === "pair-segments" ? pairCommands(contract, evidence.segmentIds) : [],
  previewCommands: (context) => pairCommands(context.contract, context.lines),
});

export const createPairSegmentsActor = (contract: PairSegmentsAction) => createActorFromDefinition(pairSegmentsDefinition, contract);
