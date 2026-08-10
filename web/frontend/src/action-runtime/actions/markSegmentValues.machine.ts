import type { MarkSegmentValuesAction } from "../../../../shared/actionRuntime";
import type { DomainCommand } from "../../../../shared/actionWorld";
import { createActorFromDefinition, projectBoardSlotValues } from "./actionDefinition";
import { createFormMachineDefinition } from "./formMachine";

const labelKind = (contract: MarkSegmentValuesAction): "length" | "share" => /份/.test(contract.title) ? "share" : "length";

function labelCommands(contract: MarkSegmentValuesAction, values: Record<string, string>): DomainCommand[] {
  return Object.entries(values).flatMap(([segmentId, valueLatex]) => valueLatex.trim() ? [{
    commandId: `${contract.actionId}/label/${segmentId}`,
    actionId: contract.actionId,
    type: "set-segment-label" as const,
    markId: `${contract.actionId}/label/${segmentId}`,
    segmentId,
    valueLatex: valueLatex.trim(),
    labelKind: labelKind(contract),
  }] : []);
}

export const markSegmentValuesDefinition = createFormMachineDefinition<MarkSegmentValuesAction>("mark-segment-values", {
  availableLineIds: (contract) => contract.input.availableSegmentIds,
  maxLines: (contract) => contract.input.requiredCount || contract.input.labels.length || contract.presentation?.requiredInputCount || 1,
  expectedLineAt: (contract, index) => contract.input.labels[index]?.segmentId,
  activeSlotForLine: (_contract, lineId) => lineId,
  answerSlots: (context) => context.lines.map((segmentId) => ({
    id: segmentId,
    label: segmentId,
    kind: "number" as const,
    required: true,
    placeholder: /份/.test(context.contract.title) ? "输入份数" : "输入边长",
  })),
  structurallyReady: (context) => {
    const required = context.contract.input.requiredCount || context.contract.input.labels.length || context.contract.presentation?.requiredInputCount || 1;
    return context.lines.length >= required
      && context.lines.slice(0, required).every((segmentId) => Boolean(context.answers[segmentId]?.trim()));
  },
  locallyCorrect: (context) => context.contract.input.labels.every((label) => context.answers[label.segmentId] === label.valueLatex),
  evidence: (context) => ({ actionId: context.contract.actionId, sourceStepId: context.contract.sourceStepId, kind: "mark-segment-values", version: 1, values: { ...context.answers } }),
  commands: (contract, evidence) => evidence.kind === "mark-segment-values" ? labelCommands(contract, evidence.values) : [],
  previewCommands: (context) => labelCommands(context.contract, context.answers),
  boardPreview: (context) => projectBoardSlotValues(context.contract, Object.fromEntries(
    Object.entries(context.answers).map(([segmentId, value]) => [`segment.${segmentId}`, value]),
  )),
});

export const createMarkSegmentValuesActor = (contract: MarkSegmentValuesAction) => createActorFromDefinition(markSegmentValuesDefinition, contract);
