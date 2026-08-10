import type { ActionEvidence, AuthoredActionTemplate } from "../../../../shared/actionRuntime";
import type { DomainCommand } from "../../../../shared/actionWorld";

export interface TypedActionDiagnosis {
  accepted: boolean;
  wrongActionIds: string[];
  wrongObjectIds: string[];
  wrongSlotIds: string[];
  commands: DomainCommand[];
}

const equal = (left: readonly string[] | undefined, right: readonly string[] | undefined) => Boolean(left && right)
  && left!.length === right!.length && left!.every((item, index) => item === right![index]);

function expected(template: AuthoredActionTemplate): Record<string, unknown> {
  return { ...template.input, ...template.teachingInput };
}

function diagnoseOne(template: AuthoredActionTemplate, evidence: ActionEvidence): Omit<TypedActionDiagnosis, "wrongActionIds"> {
  const target = expected(template);
  const wrongObjectIds: string[] = [];
  const wrongSlotIds: string[] = [];
  const commands: DomainCommand[] = [];
  let accepted = evidence.actionId === template.actionId && evidence.sourceStepId === template.sourceStepId
    && evidence.kind === template.kind && evidence.version === template.version;
  if (!accepted) return { accepted: false, wrongObjectIds, wrongSlotIds, commands };

  switch (evidence.kind) {
    case "make-parallel": {
      if (target.throughPointId !== evidence.throughPointId) wrongObjectIds.push(evidence.throughPointId);
      if (target.referenceLineId !== evidence.referenceLineId) wrongObjectIds.push(evidence.referenceLineId);
      accepted = wrongObjectIds.length === 0;
      if (accepted) commands.push({
        commandId: `${template.actionId}/construct-parallel`, actionId: template.actionId, type: "construct-parallel",
        throughPointId: evidence.throughPointId, referenceLineId: evidence.referenceLineId,
        outputLineId: String(template.input.outputLineId),
      });
      break;
    }
    case "intersect-carriers": {
      const wanted = target.carrierPointIds as string[] | undefined;
      evidence.carrierPointIds.forEach((id, index) => { if (wanted?.[index] !== id) wrongObjectIds.push(id); });
      accepted = equal(evidence.carrierPointIds, wanted);
      if (accepted) commands.push({
        commandId: `${template.actionId}/construct-carrier`, actionId: template.actionId, type: "construct-carrier",
        fromPointId: evidence.carrierPointIds[0], toPointId: evidence.carrierPointIds[1], outputLineId: String(template.input.outputCarrierLineId),
      }, {
        commandId: `${template.actionId}/intersect-lines`, actionId: template.actionId, type: "intersect-lines",
        firstLineId: String(template.input.parallelLineId), secondLineId: String(template.input.outputCarrierLineId), outputPointId: String(template.input.outputPointId),
      });
      break;
    }
    case "mark-segment-values": {
      const labels = (target.labels as Array<{ segmentId: string; valueLatex: string }> | undefined) || [];
      for (const label of labels) {
        if (evidence.values[label.segmentId] !== label.valueLatex) {
          wrongObjectIds.push(label.segmentId);
          wrongSlotIds.push(label.segmentId);
        }
      }
      accepted = labels.length > 0 && wrongSlotIds.length === 0;
      break;
    }
    case "pair-segments":
    case "convert-collinear": {
      const wanted = target.expectedOrder as string[] | undefined;
      evidence.segmentIds.forEach((id, index) => { if (wanted?.[index] !== id) wrongObjectIds.push(id); });
      accepted = equal(evidence.segmentIds, wanted);
      break;
    }
    case "ratio-scratch": {
      const wanted = target.expectedOrder as string[] | undefined;
      const ratio = target.simplifiedRatio as string[] | undefined;
      evidence.segmentIds.forEach((id, index) => { if (wanted?.[index] !== id) wrongObjectIds.push(id); });
      if (!equal(evidence.ratio, ratio)) wrongSlotIds.push("ratio-first", "ratio-second");
      accepted = equal(evidence.segmentIds, wanted) && equal(evidence.ratio, ratio);
      break;
    }
    case "enter-equation": {
      const order = target.expectedOrder as string[] | undefined;
      const factors = target.shareValues && order?.[0]
        ? [order[0], ...(target.shareValues as string[])]
        : order;
      evidence.factors.forEach((id, index) => { if (factors?.[index] !== id) wrongSlotIds.push(["known-factor", "numerator", "denominator"][index] || `factor-${index}`); });
      if (target.expectedResult !== evidence.result) wrongSlotIds.push("result");
      accepted = equal(evidence.factors, factors) && target.expectedResult === evidence.result;
      break;
    }
    case "select-option":
      accepted = target.expectedValue === evidence.value;
      if (!accepted) wrongSlotIds.push("choice");
      break;
    case "enter-text":
      accepted = Array.isArray(target.expectedValues) && target.expectedValues.includes(evidence.value);
      if (!accepted) wrongSlotIds.push("value");
      break;
  }
  return { accepted, wrongObjectIds: [...new Set(wrongObjectIds)], wrongSlotIds: [...new Set(wrongSlotIds)], commands };
}

/** Typed private evaluator: no primitive, topic-answer string, RuntimeActionEvent or v1 reducer. */
export function evaluateTopicEvidence(templates: AuthoredActionTemplate[], evidence: ActionEvidence[]): TypedActionDiagnosis {
  const results = templates.map((template) => {
    const item = evidence.find((candidate) => candidate.actionId === template.actionId);
    return item ? { actionId: template.actionId, ...diagnoseOne(template, item) } : {
      actionId: template.actionId, accepted: false, wrongObjectIds: [], wrongSlotIds: [], commands: [],
    };
  });
  return {
    accepted: results.every((result) => result.accepted),
    wrongActionIds: results.filter((result) => !result.accepted).map((result) => result.actionId),
    wrongObjectIds: [...new Set(results.flatMap((result) => result.wrongObjectIds))],
    wrongSlotIds: [...new Set(results.flatMap((result) => result.wrongSlotIds))],
    commands: results.filter((result) => result.accepted).flatMap((result) => result.commands),
  };
}
