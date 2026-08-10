import type { AuthoredActionTemplate } from "../../../shared/actionRuntime";
import type { TopicActionProjection, TopicResolvedScenario } from "../../../shared/topicPractice";
import { SOLUTION_BOARD_SCHEMA_VERSION, type SolutionBoardScript } from "../../../shared/solutionBoard";
import { capabilityIdsForTopicStep } from "../../../shared/similarityLearningMap";

function base(
  step: TopicActionProjection,
  actionId: string,
  kind: string,
  capabilities: string[],
  submitOnComplete: boolean,
  input: Record<string, unknown>,
  teachingInput?: Record<string, unknown>,
): AuthoredActionTemplate {
  return {
    actionId,
    sourceStepId: step.id,
    kind,
    version: 1,
    title: step.title,
    instruction: step.promptLatex || step.goal,
    input,
    teachingInput,
    capabilities: [...capabilities, "agent:select-object", "agent:set-answer", "agent:back", "agent:clear"],
    answerSlots: [],
    submitOnComplete,
    presentation: step.presentation,
    coach: step.coach,
  };
}

/**
 * Offline authoring projection. It runs before bundle validation/publication;
 * runtime bootstrap never invokes it. Its output is the versioned action JSON
 * stored in every scenario record.
 */
export function authorTopicActionTemplates(scenario: TopicResolvedScenario): AuthoredActionTemplate[] {
  return scenario.steps.flatMap((step, sourceIndex): AuthoredActionTemplate[] => {
    const capabilities = capabilityIdsForTopicStep(scenario.taskId, step.primitive, sourceIndex);
    const interaction = step.interaction;
    const availableSegments = interaction?.availableSegments || interaction?.geometry?.segments.map((segment) => segment.id) || [];
    const availablePoints = interaction?.geometry?.points.map((point) => point.id) || scenario.promptGeometry?.points.map((point) => point.id) || [];
    switch (step.primitive) {
      case "construct-parallel": {
        const construction = interaction?.construction;
        const outputLineId = `action:${step.id}:parallel`;
        const outputCarrierLineId = `action:${step.id}:carrier`;
        const outputLineLabel = construction?.throughPoint && construction.resultPoint
          ? `${construction.throughPoint}${construction.resultPoint}`
          : undefined;
        return [
          {
            ...base(step, `${step.id}/make-parallel`, "make-parallel", capabilities, false, {
              availablePointIds: availablePoints,
              availableLineIds: availableSegments,
              outputLineId,
              outputLineLabel,
            }, {
              throughPointId: construction?.throughPoint,
              referenceLineId: construction?.parallelSegment,
            }),
            title: "确定平行关系",
            instruction: "先点击辅助线要经过的点，再点击作为平行参照的线段。",
            answerSlots: [
              { id: "through-point", label: "过线点", kind: "object", required: true },
              { id: "reference-line", label: "平行参照线", kind: "object", required: true },
            ],
          },
          {
            ...base(step, `${step.id}/intersect-carriers`, "intersect-carriers", capabilities, true, {
              availablePointIds: availablePoints,
              parallelLineId: outputLineId,
              outputCarrierLineId,
              outputPointId: construction?.resultPoint || `action:${step.id}:intersection`,
            }, {
              carrierPointIds: construction?.carrierPoints,
              resultPointId: construction?.resultPoint,
            }),
            title: "作载体并求交",
            instruction: "再依次点击载体直线上的两个点，系统会延长直线并标出交点。",
            answerSlots: [
              { id: "carrier-0", label: "载体点一", kind: "object", required: true },
              { id: "carrier-1", label: "载体点二", kind: "object", required: true },
            ],
          },
        ];
      }
      case "mark-segments":
        return [{
          ...base(step, step.id, "mark-segment-values", capabilities, true, {
            labels: [],
            availableSegmentIds: availableSegments,
            requiredCount: interaction?.expectedLabels?.length || step.presentation?.requiredInputCount || 1,
            autoFocusSequence: Boolean(step.presentation?.autoFocusSequence),
          }, { labels: interaction?.expectedLabels || [] }),
          instruction: "在图中点击需要标注的线段，再输入对应数值；已完成的标注会保留在图上。",
          answerSlots: [{ id: "segment-values", label: "线段标注", kind: "number", required: true }],
        }];
      case "mark-ratio":
        return [{
          ...base(step, step.id, "pair-segments", capabilities, true, {
            availableSegmentIds: availableSegments,
            pairCount: Math.max(1, Math.ceil((interaction?.expectedOrder?.length || 4) / 2)),
          }, { expectedOrder: interaction?.expectedOrder }),
          instruction: "按顺序点击每组对应边；配成一组后，图上会显示相同的对应刻痕。",
          answerSlots: [{ id: "segment-pairs", label: "对应边", kind: "object", required: true }],
        }];
      case "ratio-scratch": {
        const scratch = interaction?.ratioScratch;
        return [{
          ...base(step, step.id, "ratio-scratch", capabilities, true, {
            availableSegmentIds: availableSegments,
            firstDisplayName: scratch?.firstDisplayName || "第一条边",
            firstValueLatex: scratch?.firstValueLatex || "",
            secondDisplayName: scratch?.secondDisplayName || "第二条边",
            secondValueLatex: scratch?.secondValueLatex || "",
          }, {
            expectedOrder: interaction?.expectedOrder,
            simplifiedRatio: scratch ? [scratch.simplifiedFirstLatex, scratch.simplifiedSecondLatex] : undefined,
          }),
          instruction: "依次点击要比较的两条边，填写化简后的前项和后项；份数会同步标到图上。",
          answerSlots: [
            { id: "ratio-first", label: "最简比前项", kind: "number", required: true },
            { id: "ratio-second", label: "最简比后项", kind: "number", required: true },
          ],
        }];
      }
      case "convert-collinear": {
        const collinear = interaction?.collinear;
        return [{
          ...base(step, step.id, "convert-collinear", capabilities, true, {
            availableSegmentIds: availableSegments,
            relationLatex: collinear?.relationLatex || "",
            wholeSegment: "",
            targetSegment: "",
            knownSegment: "",
          }, {
            expectedOrder: interaction?.expectedOrder,
            wholeSegment: collinear?.wholeSegment || "",
            targetSegment: collinear?.targetSegment || "",
            knownSegment: collinear?.knownSegment || "",
          }),
          instruction: "依次点击整段、目标分段和已知分段，建立三点共线的线段加法关系。",
          answerSlots: [
            { id: "whole-segment", label: "整段", kind: "object", required: true },
            { id: "target-segment", label: "目标分段", kind: "object", required: true },
            { id: "known-segment", label: "已知分段", kind: "object", required: true },
          ],
        }];
      }
      case "equation": {
        const equation = interaction?.equation;
        return [{
          ...base(step, step.id, "enter-equation", capabilities, true, {
            availableSegmentIds: availableSegments,
            targetLatex: equation?.targetLatex || "",
            factorSlots: equation?.factorSlots || ["known", "numerator", "denominator"],
          }, {
            expectedOrder: interaction?.expectedOrder,
            shareValues: equation?.shareValues,
            knownValueLatex: equation?.knownValueLatex,
            expectedResult: step.acceptedAnswers[0]?.split("|")[1],
          }),
          instruction: "点击已知边，填写未知份数、已知份数和计算结果，组成完整比例式。",
          answerSlots: [
            { id: "known-factor", label: "已知边", kind: "object", required: true },
            { id: "numerator", label: "未知份数", kind: "number", required: true },
            { id: "denominator", label: "已知份数", kind: "number", required: true },
            { id: "result", label: "结果", kind: "number", required: true },
          ],
        }];
      }
      case "select":
        return [{
          ...base(step, step.id, "select-option", capabilities, true, { options: step.options || [] }, { expectedValue: step.acceptedAnswers[0] }),
          answerSlots: [{ id: "choice", label: step.title, kind: "text", required: true, options: step.options || [] }],
        }];
      case "input":
        return [{
          ...base(step, step.id, "enter-text", capabilities, true, { placeholder: "写出规范答案" }, { expectedValues: step.acceptedAnswers }),
          instruction: "根据图上的标注写出最终结论；确认后会补全为规范解答。",
          answerSlots: [{ id: "value", label: step.title, kind: "text", required: true, placeholder: "写出规范答案" }],
        }];
    }
  });
}

/**
 * Compiles reviewed expectedLatex into an ordered teacher document. These rows
 * are Learn-only until an author supplies public, slot-based Guided templates.
 */
export function authorTopicSolutionBoard(
  scenario: TopicResolvedScenario,
  actions: AuthoredActionTemplate[],
): SolutionBoardScript {
  const placeholder = (slotId: string) => `{{${slotId}}}`;
  const slot = (stepId: string, role: string) => `${stepId}.${role}`;
  const setTargets = (action: AuthoredActionTemplate | undefined, stepId: string, roles: string[]) => {
    if (!action) return;
    action.boardTargets = Object.fromEntries(roles.map((role) => [role, slot(stepId, role)]));
  };

  const expressionTemplate = (step: TopicResolvedScenario["steps"][number]) => {
    const owned = actions.filter((action) => action.sourceStepId === step.id);
    const action = owned[0];
    const make = owned.find((candidate) => candidate.kind === "make-parallel");
    const intersect = owned.find((candidate) => candidate.kind === "intersect-carriers");

    if (make && intersect) {
      setTargets(make, step.id, ["throughPoint", "helperLine", "referenceLine"]);
      setTargets(intersect, step.id, ["carrierLine", "intersectionPoint"]);
      return `过 $${placeholder(slot(step.id, "throughPoint"))}$ 作 $${placeholder(slot(step.id, "helperLine"))}\\parallel ${placeholder(slot(step.id, "referenceLine"))}$，交直线 $${placeholder(slot(step.id, "carrierLine"))}$ 于点 $${placeholder(slot(step.id, "intersectionPoint"))}$。`;
    }

    if (action?.kind === "mark-segment-values") {
      const labels = (action.teachingInput?.labels as Array<{ segmentId: string; displayName: string; valueLatex: string }> | undefined) || [];
      const roles = labels.map((label) => `segment.${label.segmentId}`);
      setTargets(action, step.id, roles);
      const suffix = /份/.test(step.title) || /份/.test(step.expectedLatex || "") ? "\\text{ 份}" : "";
      const statements = labels.map((label) => `$${label.displayName}=${placeholder(slot(step.id, `segment.${label.segmentId}`))}${suffix}$`);
      return statements.length ? `由题意，在图中标出 ${statements.join("，")}。` : step.expectedLatex;
    }

    if (action?.kind === "pair-segments") {
      setTargets(action, step.id, ["correspondence"]);
      return `由相似关系，对应边为 $${placeholder(slot(step.id, "correspondence"))}$。`;
    }

    if (action?.kind === "ratio-scratch") {
      setTargets(action, step.id, ["firstSegment", "secondSegment", "ratioFirst", "ratioSecond"]);
      return `约分得 $${placeholder(slot(step.id, "firstSegment"))}:${placeholder(slot(step.id, "secondSegment"))}=${placeholder(slot(step.id, "ratioFirst"))}:${placeholder(slot(step.id, "ratioSecond"))}$。`;
    }

    if (action?.kind === "convert-collinear") {
      setTargets(action, step.id, ["wholeSegment", "targetSegment", "knownSegment"]);
      return `由三点共线，$${placeholder(slot(step.id, "wholeSegment"))}=${placeholder(slot(step.id, "targetSegment"))}+${placeholder(slot(step.id, "knownSegment"))}$。`;
    }

    if (action?.kind === "enter-equation") {
      setTargets(action, step.id, ["knownFactor", "numerator", "denominator", "result"]);
      const target = String(action.input.targetLatex || "x");
      return `代入比例关系，$${target}=${placeholder(slot(step.id, "knownFactor"))}\\times\\dfrac{${placeholder(slot(step.id, "numerator"))}}{${placeholder(slot(step.id, "denominator"))}}=${placeholder(slot(step.id, "result"))}$。`;
    }

    if (action?.kind === "select-option") {
      setTargets(action, step.id, ["value"]);
      return `选择 ${placeholder(slot(step.id, "value"))}。`;
    }

    if (action?.kind === "enter-text") {
      setTargets(action, step.id, ["value"]);
      return `因此，${placeholder(slot(step.id, "value"))}`;
    }

    return step.expectedLatex;
  };
  return {
    schemaVersion: SOLUTION_BOARD_SCHEMA_VERSION,
    documentId: `${scenario.id || scenario.sourceQuestionId}/solution`,
    headingLatex: "解：",
    expressions: scenario.steps.map((step) => ({
      expressionId: `${step.id}/expression`,
      sourceStepId: step.id,
      ownerActionIds: actions.filter((action) => action.sourceStepId === step.id).map((action) => action.actionId),
      latexTemplate: expressionTemplate(step),
      modes: ["learn"],
    })),
  };
}
