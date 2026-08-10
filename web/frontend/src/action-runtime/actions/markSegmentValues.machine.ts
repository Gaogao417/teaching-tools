import type { MarkSegmentValuesAction } from "../../../../shared/actionRuntime";
import { createActorFromDefinition } from "./actionDefinition";
import { createFormMachineDefinition } from "./formMachine";

export const markSegmentValuesDefinition = createFormMachineDefinition<MarkSegmentValuesAction>("mark-segment-values", {
  availableLineIds: (contract) => contract.input.availableSegmentIds,
  maxLines: (contract) => contract.input.availableSegmentIds.length,
  expectedLineAt: () => undefined,
  activeSlotForLine: (_contract, lineId) => lineId,
  answerSlots: (context) => context.lines.map((segmentId) => ({ id: segmentId, label: segmentId, kind: "number" as const, required: true, placeholder: "输入线段长度" })),
  structurallyReady: (context) => {
    const required = context.contract.input.labels.length || context.contract.presentation?.requiredInputCount || 1;
    return Object.values(context.answers).filter((value) => value.trim()).length >= required;
  },
  locallyCorrect: (context) => context.contract.input.labels.every((label) => context.answers[label.segmentId] === label.valueLatex),
  evidence: (context) => ({ actionId: context.contract.actionId, sourceStepId: context.contract.sourceStepId, kind: "mark-segment-values", version: 1, values: { ...context.answers } }),
  projectStepRecord: (_contract, { evidence }) => ({
    summary: evidence ? Object.entries(evidence.values).map(([segment, value]) => `${segment}=${value}`).join("；") : undefined,
  }),
});

export const createMarkSegmentValuesActor = (contract: MarkSegmentValuesAction) => createActorFromDefinition(markSegmentValuesDefinition, contract);
