import type { RatioScratchAction } from "../../../../shared/actionRuntime";
import type { DomainCommand } from "../../../../shared/actionWorld";
import { createActorFromDefinition } from "./actionDefinition";
import { createFormMachineDefinition } from "./formMachine";

function ratioCommands(contract: RatioScratchAction, segmentIds: string[], ratio: Array<string | undefined>): DomainCommand[] {
  return segmentIds.slice(0, 2).flatMap((segmentId, index) => ratio[index]?.trim() ? [{
    commandId: `${contract.actionId}/ratio/${segmentId}`,
    actionId: contract.actionId,
    type: "set-segment-label" as const,
    markId: `${contract.actionId}/ratio/${segmentId}`,
    segmentId,
    valueLatex: ratio[index]!.trim(),
    labelKind: "share" as const,
  }] : []);
}

export const ratioScratchDefinition = createFormMachineDefinition<RatioScratchAction>("ratio-scratch", {
  availableLineIds: (contract) => contract.input.availableSegmentIds,
  maxLines: () => 2,
  expectedLineAt: (contract, index) => contract.input.expectedOrder?.[index],
  structurallyReady: (context) => context.lines.length === 2 && Boolean(context.answers["ratio-first"]?.trim()) && Boolean(context.answers["ratio-second"]?.trim()),
  locallyCorrect: (context) => (!context.contract.input.expectedOrder || context.contract.input.expectedOrder.every((id, index) => context.lines[index] === id))
    && (!context.contract.input.simplifiedRatio || (context.answers["ratio-first"] === context.contract.input.simplifiedRatio[0] && context.answers["ratio-second"] === context.contract.input.simplifiedRatio[1])),
  evidence: (context) => ({ actionId: context.contract.actionId, sourceStepId: context.contract.sourceStepId, kind: "ratio-scratch", version: 1, segmentIds: [...context.lines], ratio: [context.answers["ratio-first"], context.answers["ratio-second"]] }),
  commands: (contract, evidence) => evidence.kind === "ratio-scratch" ? ratioCommands(contract, evidence.segmentIds, evidence.ratio) : [],
  previewCommands: (context) => ratioCommands(context.contract, context.lines, [context.answers["ratio-first"], context.answers["ratio-second"]]),
});

export const createRatioScratchActor = (contract: RatioScratchAction) => createActorFromDefinition(ratioScratchDefinition, contract);
