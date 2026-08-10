import type { ActionEvidence, AuthoredActionTemplate } from "../../../../shared/actionRuntime";
import type { DomainCommand } from "../../../../shared/actionWorld";
import type { BoardCommand } from "../../../../shared/solutionBoard";

export interface TypedActionDiagnosis {
  accepted: boolean;
  wrongActionIds: string[];
  wrongObjectIds: string[];
  wrongSlotIds: string[];
  commands: DomainCommand[];
  boardCommands: BoardCommand[];
}

const equal = (left: readonly string[] | undefined, right: readonly string[] | undefined) => Boolean(left && right)
  && left!.length === right!.length && left!.every((item, index) => item === right![index]);

function expected(template: AuthoredActionTemplate): Record<string, unknown> {
  return { ...template.input, ...template.teachingInput };
}

function boardValues(template: AuthoredActionTemplate, evidence: ActionEvidence): Record<string, string | undefined> {
  const target = expected(template);
  switch (evidence.kind) {
    case "make-parallel": return { throughPoint: evidence.throughPointId, helperLine: String(target.outputLineLabel || template.input.outputLineId), referenceLine: evidence.referenceLineId };
    case "intersect-carriers": return { carrierLine: evidence.carrierPointIds.join(""), intersectionPoint: String(template.input.outputPointId) };
    case "mark-segment-values": return Object.fromEntries(Object.entries(evidence.values).map(([id, value]) => [`segment.${id}`, value]));
    case "pair-segments": return { correspondence: evidence.segmentIds.join("\\leftrightarrow ") };
    case "ratio-scratch": return { firstSegment: evidence.segmentIds[0], secondSegment: evidence.segmentIds[1], ratioFirst: evidence.ratio[0], ratioSecond: evidence.ratio[1] };
    case "convert-collinear": return { wholeSegment: evidence.segmentIds[0], targetSegment: evidence.segmentIds[1], knownSegment: evidence.segmentIds[2], relation: String(target.relationLatex || "") };
    case "enter-equation": return { knownFactor: evidence.factors[0], numerator: evidence.factors[1], denominator: evidence.factors[2], result: evidence.result };
    case "select-option": return { value: evidence.value };
    case "enter-text": {
      const canonical = Array.isArray(target.expectedValues) ? String(target.expectedValues[0] || evidence.value) : evidence.value;
      return { value: canonical };
    }
  }
}

export function projectCanonicalBoardCommands(template: AuthoredActionTemplate, evidence: ActionEvidence): BoardCommand[] {
  const values = boardValues(template, evidence);
  return Object.entries(values).flatMap(([role, latex]) => {
    const slotId = template.boardTargets?.[role];
    return slotId && latex ? [{ type: "fill-slot" as const, slotId, latex }] : [];
  });
}

function diagnoseOne(template: AuthoredActionTemplate, evidence: ActionEvidence): Omit<TypedActionDiagnosis, "wrongActionIds"> {
  const target = expected(template);
  const wrongObjectIds: string[] = [];
  const wrongSlotIds: string[] = [];
  const commands: DomainCommand[] = [];
  const boardCommands: BoardCommand[] = [];
  let accepted = evidence.actionId === template.actionId && evidence.sourceStepId === template.sourceStepId
    && evidence.kind === template.kind && evidence.version === template.version;
  if (!accepted) return { accepted: false, wrongObjectIds, wrongSlotIds, commands, boardCommands };

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
      if (accepted) commands.push(...labels.map((label) => ({
        commandId: `${template.actionId}/label/${label.segmentId}`,
        actionId: template.actionId,
        type: "set-segment-label" as const,
        markId: `${template.actionId}/label/${label.segmentId}`,
        segmentId: label.segmentId,
        valueLatex: evidence.values[label.segmentId],
        labelKind: /份/.test(template.title) ? "share" as const : "length" as const,
      })));
      break;
    }
    case "pair-segments": {
      const wanted = target.expectedOrder as string[] | undefined;
      evidence.segmentIds.forEach((id, index) => { if (wanted?.[index] !== id) wrongObjectIds.push(id); });
      accepted = equal(evidence.segmentIds, wanted);
      if (accepted) {
        for (let index = 0; index + 1 < evidence.segmentIds.length; index += 2) {
          const pairIndex = index / 2;
          commands.push({
            commandId: `${template.actionId}/correspondence/${pairIndex}`,
            actionId: template.actionId,
            type: "set-correspondence-mark",
            markId: `${template.actionId}/correspondence/${pairIndex}`,
            segmentIds: [evidence.segmentIds[index], evidence.segmentIds[index + 1]],
            tickCount: pairIndex + 1,
          });
        }
      }
      break;
    }
    case "convert-collinear": {
      const wanted = target.expectedOrder as string[] | undefined;
      evidence.segmentIds.forEach((id, index) => { if (wanted?.[index] !== id) wrongObjectIds.push(id); });
      accepted = equal(evidence.segmentIds, wanted);
      if (accepted) commands.push({
        commandId: `${template.actionId}/emphasis`, actionId: template.actionId, type: "set-emphasis",
        markId: `${template.actionId}/emphasis`, entityIds: [...evidence.segmentIds],
      });
      break;
    }
    case "ratio-scratch": {
      const wanted = target.expectedOrder as string[] | undefined;
      const ratio = target.simplifiedRatio as string[] | undefined;
      evidence.segmentIds.forEach((id, index) => { if (wanted?.[index] !== id) wrongObjectIds.push(id); });
      if (!equal(evidence.ratio, ratio)) wrongSlotIds.push("ratio-first", "ratio-second");
      accepted = equal(evidence.segmentIds, wanted) && equal(evidence.ratio, ratio);
      if (accepted) commands.push(...evidence.segmentIds.slice(0, 2).map((segmentId, index) => ({
        commandId: `${template.actionId}/ratio/${segmentId}`,
        actionId: template.actionId,
        type: "set-segment-label" as const,
        markId: `${template.actionId}/ratio/${segmentId}`,
        segmentId,
        valueLatex: evidence.ratio[index],
        labelKind: "share" as const,
      })));
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
      if (accepted) {
        const available = (target.availableSegmentIds as string[] | undefined) || [];
        const entityIds = evidence.factors.filter((factor) => available.includes(factor));
        if (entityIds.length) commands.push({
          commandId: `${template.actionId}/emphasis`, actionId: template.actionId, type: "set-emphasis",
          markId: `${template.actionId}/emphasis`, entityIds,
        });
      }
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
  if (accepted) boardCommands.push(...projectCanonicalBoardCommands(template, evidence));
  return { accepted, wrongObjectIds: [...new Set(wrongObjectIds)], wrongSlotIds: [...new Set(wrongSlotIds)], commands, boardCommands };
}

/** Typed private evaluator: no primitive, topic-answer string, RuntimeActionEvent or v1 reducer. */
export function evaluateTopicEvidence(templates: AuthoredActionTemplate[], evidence: ActionEvidence[]): TypedActionDiagnosis {
  const results = templates.map((template) => {
    const item = evidence.find((candidate) => candidate.actionId === template.actionId);
    return item ? { actionId: template.actionId, ...diagnoseOne(template, item) } : {
      actionId: template.actionId, accepted: false, wrongObjectIds: [], wrongSlotIds: [], commands: [], boardCommands: [],
    };
  });
  return {
    accepted: results.every((result) => result.accepted),
    wrongActionIds: results.filter((result) => !result.accepted).map((result) => result.actionId),
    wrongObjectIds: [...new Set(results.flatMap((result) => result.wrongObjectIds))],
    wrongSlotIds: [...new Set(results.flatMap((result) => result.wrongSlotIds))],
    commands: results.filter((result) => result.accepted).flatMap((result) => result.commands),
    boardCommands: results.filter((result) => result.accepted).flatMap((result) => result.boardCommands),
  };
}
