import type { PairSegmentsAction } from "../../../../shared/actionRuntime";
import { createActorFromDefinition } from "./actionDefinition";
import { createFormMachineDefinition } from "./formMachine";

export const pairSegmentsDefinition = createFormMachineDefinition<PairSegmentsAction>("pair-segments", {
  availableLineIds: (contract) => contract.input.availableSegmentIds,
  maxLines: (contract) => contract.input.pairCount * 2,
  expectedLineAt: (contract, index) => contract.input.expectedOrder?.[index],
  slotValue: (context, slotId) => slotId === "segment-pairs" ? context.lines.join(" · ") : "",
  structurallyReady: (context) => context.lines.length >= context.contract.input.pairCount * 2,
  locallyCorrect: (context) => !context.contract.input.expectedOrder || context.contract.input.expectedOrder.every((id, index) => context.lines[index] === id),
  evidence: (context) => ({ actionId: context.contract.actionId, sourceStepId: context.contract.sourceStepId, kind: "pair-segments", version: 1, segmentIds: [...context.lines] }),
  projectStepRecord: (_contract, { evidence }) => ({ summary: evidence?.segmentIds.join("、") }),
});

export const createPairSegmentsActor = (contract: PairSegmentsAction) => createActorFromDefinition(pairSegmentsDefinition, contract);
